import { sql as raw } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { assets, type AssetTags, type NewAsset } from "./db/schema";
import {
  listAllFiles,
  downloadFile,
  classifyAssetType,
  type WorkDriveFile,
} from "./workdrive";
import { blobKeyFor, blobExists, mirrorToBlob } from "./blob";
import { tagPhoto, tagVideoStub } from "./tagging";
// Signals go straight into the hub's KV inbox now that the studio runs
// natively inside HQ (no HTTP hop / TILT_HQ_URL indirection).
import { postSignal } from "@/lib/signals";

/**
 * Phase 1 pipeline orchestrator.
 *
 * `syncCatalog` implements the "load-or-build" requirement (Section 7):
 *  - If a pre-tagged catalog JSON is supplied, import it directly.
 *  - Otherwise: list WorkDrive → mirror to Blob → run the vision tagging pass →
 *    upsert into `assets`.
 *
 * Re-runnable: existing assets are matched by workdrive_id; already-mirrored
 * files skip re-upload, and already-tagged files skip re-tagging unless
 * `retag` is set.
 */

export type SyncOptions = {
  rootFolderId?: string;
  /** Pre-tagged catalog to import instead of pulling from WorkDrive. */
  prebuilt?: PrebuiltCatalogEntry[];
  /** Re-run the vision tagging pass even for already-tagged assets. */
  retag?: boolean;
  /** Cap the number of files processed (useful for a first smoke test). */
  limit?: number;
  /** Tag photos with the vision model (set false to mirror only). */
  tag?: boolean;
  onProgress?: (msg: string) => void;
};

export type PrebuiltCatalogEntry = {
  workdriveId: string;
  filename: string;
  type: "photo" | "video";
  blobUrl?: string;
  workdrivePath?: string;
  mimeType?: string;
  tags?: AssetTags;
  suitablePostTypes?: string[];
};

export type SyncSummary = {
  scanned: number;
  mirrored: number;
  tagged: number;
  skipped: number;
  errors: { file: string; error: string }[];
};

export async function syncCatalog(opts: SyncOptions = {}): Promise<SyncSummary> {
  const log = opts.onProgress ?? (() => {});
  const summary: SyncSummary = {
    scanned: 0,
    mirrored: 0,
    tagged: 0,
    skipped: 0,
    errors: [],
  };

  if (opts.prebuilt?.length) {
    log(`Importing ${opts.prebuilt.length} pre-tagged catalog entries…`);
    for (const entry of opts.prebuilt) {
      await upsertAsset({
        workdriveId: entry.workdriveId,
        filename: entry.filename,
        type: entry.type,
        blobUrl: entry.blobUrl ?? null,
        workdrivePath: entry.workdrivePath ?? null,
        mimeType: entry.mimeType ?? null,
        tags: entry.tags ?? {},
        suitablePostTypes: entry.suitablePostTypes ?? [],
        taggedAt: entry.tags ? new Date() : null,
        taggingModel: entry.tags ? "imported" : null,
      });
      summary.scanned++;
      summary.tagged += entry.tags ? 1 : 0;
    }
    return summary;
  }

  const rootFolderId =
    opts.rootFolderId ?? process.env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    throw new Error(
      "No rootFolderId and ZOHO_WORKDRIVE_ROOT_FOLDER_ID is not set.",
    );
  }

  log(`Listing WorkDrive folder ${rootFolderId}…`);
  let files = await listAllFiles(rootFolderId);
  files = files.filter(
    (f) => classifyAssetType(f.name) !== "other",
  );
  if (opts.limit) files = files.slice(0, opts.limit);
  log(`Found ${files.length} media files.`);

  const shouldTag = opts.tag ?? true;

  for (const file of files) {
    summary.scanned++;
    try {
      await processFile(file, { ...opts, tag: shouldTag }, summary, log);
    } catch (err) {
      summary.errors.push({
        file: file.path ?? file.name,
        error: err instanceof Error ? err.message : String(err),
      });
      log(`  ! error on ${file.name}: ${err}`);
    }
  }

  if (summary.mirrored + summary.tagged > 0) {
    // Fire-and-forget: a missing KV store must never fail a sync.
    await postSignal({
      source: "social-studio",
      headline: `Asset catalog synced: ${summary.mirrored} new files mirrored, ${summary.tagged} tagged (${summary.scanned} scanned)`,
      detail: summary.errors.length
        ? `${summary.errors.length} file(s) errored`
        : undefined,
    }).catch(() => {});
  }

  return summary;
}

async function processFile(
  file: WorkDriveFile,
  opts: SyncOptions,
  summary: SyncSummary,
  log: (m: string) => void,
) {
  const type = classifyAssetType(file.name) as "photo" | "video";
  const existing = await db
    .select()
    .from(assets)
    .where(eq(assets.workdriveId, file.id))
    .limit(1);
  const prior = existing[0];

  // 1) Mirror to Blob (skip if already mirrored).
  let blobUrl = prior?.blobUrl ?? null;
  const key = blobKeyFor(file.id, file.name);
  if (!blobUrl) {
    const existingBlob = await blobExists(key);
    if (existingBlob) {
      blobUrl = existingBlob;
    } else {
      log(`  ↑ mirroring ${file.name}…`);
      const { buffer, contentType } = await downloadFile(file.id);
      blobUrl = await mirrorToBlob({ key, buffer, contentType });
      summary.mirrored++;
    }
  }

  // 2) Tag (skip if already tagged unless retag).
  let tags: AssetTags = prior?.tags ?? {};
  let suitablePostTypes = prior?.suitablePostTypes ?? [];
  let taggedAt = prior?.taggedAt ?? null;
  let taggingModel = prior?.taggingModel ?? null;

  const needsTag = opts.tag && (!prior?.taggedAt || opts.retag);
  if (needsTag) {
    if (type === "video") {
      const result = tagVideoStub(file.name);
      tags = result.tags;
      suitablePostTypes = result.suitablePostTypes;
      taggingModel = result.model;
      taggedAt = new Date();
    } else {
      log(`  ⊙ tagging ${file.name}…`);
      const { buffer, contentType } = await downloadFile(file.id);
      const result = await tagPhoto({
        buffer,
        mimeType: contentType,
        filename: file.name,
      });
      tags = result.tags;
      suitablePostTypes = result.suitablePostTypes;
      taggingModel = result.model;
      taggedAt = new Date();
      summary.tagged++;
    }
  } else if (prior?.taggedAt) {
    summary.skipped++;
  }

  await upsertAsset({
    workdriveId: file.id,
    filename: file.name,
    type,
    blobUrl,
    workdrivePath: file.path ?? null,
    mimeType: file.mimeType ?? null,
    bytes: file.sizeBytes != null ? String(file.sizeBytes) : null,
    tags,
    suitablePostTypes,
    taggedAt,
    taggingModel,
  });
}

async function upsertAsset(
  values: Omit<NewAsset, "id" | "createdAt" | "updatedAt">,
) {
  await db
    .insert(assets)
    .values(values)
    .onConflictDoUpdate({
      target: assets.workdriveId,
      set: {
        filename: values.filename,
        blobUrl: values.blobUrl,
        workdrivePath: values.workdrivePath,
        mimeType: values.mimeType,
        bytes: values.bytes,
        tags: values.tags,
        suitablePostTypes: values.suitablePostTypes,
        taggedAt: values.taggedAt,
        taggingModel: values.taggingModel,
        updatedAt: raw`now()`,
      },
    });
}
