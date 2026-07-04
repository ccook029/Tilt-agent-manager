/**
 * Minimal Zoho WorkDrive client (Phase 1).
 *
 * Auth: OAuth2 refresh-token flow. We exchange the long-lived refresh token for
 * a short-lived access token, then call the WorkDrive REST API.
 * Docs: https://www.zoho.com/workdrive/help/api/
 *
 * Scope used: WorkDrive.files.READ / WorkDrive.team.READ.
 */

export type WorkDriveFile = {
  id: string;
  name: string;
  /** "file" | "folder" */
  type: "file" | "folder";
  isFolder: boolean;
  mimeType?: string;
  extn?: string;
  sizeBytes?: number;
  /** Path of parent folder names for human-readable provenance. */
  path?: string;
};

const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "avi", "webm", "mkv"]);
const PHOTO_EXTS = new Set(["jpg", "jpeg", "png", "heic", "webp", "tiff", "gif"]);

export function classifyAssetType(
  nameOrExt: string,
): "photo" | "video" | "other" {
  const ext = nameOrExt.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (PHOTO_EXTS.has(ext)) return "photo";
  return "other";
}

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

/**
 * The hub already uses ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN
 * for its Books/Inventory OAuth client. The WorkDrive Self Client may be a
 * DIFFERENT Zoho app, so prefer the ZOHO_WORKDRIVE_-prefixed vars and fall
 * back to the plain ZOHO_* names when they are not set.
 */
export function workdriveEnv(
  name: "CLIENT_ID" | "CLIENT_SECRET" | "REFRESH_TOKEN",
): string | undefined {
  return process.env[`ZOHO_WORKDRIVE_${name}`] ?? process.env[`ZOHO_${name}`];
}

function requireWorkdriveEnv(
  name: "CLIENT_ID" | "CLIENT_SECRET" | "REFRESH_TOKEN",
): string {
  const v = workdriveEnv(name);
  if (!v) {
    throw new Error(
      `ZOHO_WORKDRIVE_${name} (or ZOHO_${name}) is not set (Zoho WorkDrive credentials).`,
    );
  }
  return v;
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.token;
  }

  const accountsDomain =
    process.env.ZOHO_ACCOUNTS_DOMAIN ?? "https://accounts.zoho.com";
  const params = new URLSearchParams({
    refresh_token: requireWorkdriveEnv("REFRESH_TOKEN"),
    client_id: requireWorkdriveEnv("CLIENT_ID"),
    client_secret: requireWorkdriveEnv("CLIENT_SECRET"),
    grant_type: "refresh_token",
  });

  // Credentials go in the form body, not the query string — secrets in URLs
  // get captured by proxy/access logs.
  const res = await fetch(`${accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Zoho token exchange failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!data.access_token) {
    throw new Error(`Zoho token exchange returned no token: ${data.error}`);
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return tokenCache.token;
}

const API_BASE =
  process.env.ZOHO_WORKDRIVE_API_BASE ??
  "https://www.zohoapis.com/workdrive/api/v1";

// File CONTENT download is not always served from the JSON:API base; some data
// centers serve it from a separate host. Configurable so it can be corrected
// (e.g. https://download.zoho.com/v1/workdrive/download) without a code change.
const DOWNLOAD_BASE =
  process.env.ZOHO_WORKDRIVE_DOWNLOAD_BASE ?? `${API_BASE}/download`;

async function workdriveFetch(path: string): Promise<Response> {
  const doFetch = async () =>
    fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${await getAccessToken()}`,
        Accept: "application/vnd.api+json",
      },
    });
  let res = await doFetch();
  if (res.status === 401) {
    // Token revoked/invalidated before its cached expiry — refresh once & retry.
    tokenCache = null;
    res = await doFetch();
  }
  return res;
}

type WorkDriveApiResource = {
  id: string;
  attributes?: {
    name?: string;
    display_attr_name?: string;
    type?: string;
    is_folder?: boolean;
    mime_type?: string;
    extn?: string;
    storage_info?: { size_in_bytes?: number };
  };
};

function toFile(r: WorkDriveApiResource, parentPath: string): WorkDriveFile {
  const a = r.attributes ?? {};
  const name = a.name ?? a.display_attr_name ?? r.id;
  const isFolder = Boolean(a.is_folder) || a.type === "folder";
  return {
    id: r.id,
    name,
    type: isFolder ? "folder" : "file",
    isFolder,
    mimeType: a.mime_type,
    extn: a.extn,
    sizeBytes: a.storage_info?.size_in_bytes,
    path: parentPath ? `${parentPath}/${name}` : name,
  };
}

/** Lists the immediate children of a folder (paginated). */
async function listChildren(
  folderId: string,
  parentPath: string,
): Promise<WorkDriveFile[]> {
  const out: WorkDriveFile[] = [];
  let offset = 0;
  const limit = 50;

  // Paginate until fewer than `limit` rows come back.
  // WorkDrive uses JSON:API style page[offset]/page[limit].
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await workdriveFetch(
      `/files/${folderId}/files?page%5Blimit%5D=${limit}&page%5Boffset%5D=${offset}`,
    );
    if (!res.ok) {
      throw new Error(
        `WorkDrive listChildren failed for ${folderId}: ${res.status} ${await res.text()}`,
      );
    }
    const body = (await res.json()) as { data?: WorkDriveApiResource[] };
    const rows = body.data ?? [];
    out.push(...rows.map((r) => toFile(r, parentPath)));
    if (rows.length < limit) break;
    offset += limit;
  }
  return out;
}

/**
 * Recursively walks a WorkDrive folder tree and returns every FILE (not folder),
 * with a human-readable path. Used as the source list for the Blob mirror.
 */
export async function listAllFiles(rootFolderId: string): Promise<WorkDriveFile[]> {
  const files: WorkDriveFile[] = [];

  async function walk(folderId: string, path: string) {
    let children: WorkDriveFile[];
    try {
      children = await listChildren(folderId, path);
    } catch (err) {
      // One unreadable/throttled subfolder must not abort the whole sync.
      console.warn(
        `WorkDrive: skipping folder "${path || folderId}" — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }
    for (const child of children) {
      if (child.isFolder) {
        await walk(child.id, child.path ?? child.name);
      } else {
        files.push(child);
      }
    }
  }

  await walk(rootFolderId, "");
  return files;
}

export type WorkdriveProbe = {
  auth: { ok: boolean; detail: string };
  folder: { ok: boolean; detail: string };
  download: { ok: boolean; detail: string; skipped?: boolean };
};

const short = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 240);

/**
 * Live diagnostics for the WorkDrive link, used by the preflight check. Tests
 * the three things that actually break a real sync, in order, stopping at the
 * first failure: (1) can we mint an access token (creds + region)? (2) can we
 * read the root folder (folder id + scope)? (3) does the file-content download
 * endpoint actually return bytes (the data-center download-host gotcha)?
 */
export async function probeWorkdrive(): Promise<WorkdriveProbe> {
  const result: WorkdriveProbe = {
    auth: { ok: false, detail: "not run" },
    folder: { ok: false, detail: "not run" },
    download: { ok: false, detail: "not run" },
  };

  try {
    await getAccessToken();
    result.auth = { ok: true, detail: "Access token minted from refresh token." };
  } catch (e) {
    result.auth = { ok: false, detail: short(e) };
    return result;
  }

  const rootId = process.env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID;
  if (!rootId) {
    result.folder = { ok: false, detail: "ZOHO_WORKDRIVE_ROOT_FOLDER_ID is not set." };
    return result;
  }

  let firstFileId: string | undefined;
  try {
    const res = await workdriveFetch(
      `/files/${rootId}/files?page%5Blimit%5D=5&page%5Boffset%5D=0`,
    );
    if (!res.ok) {
      result.folder = {
        ok: false,
        detail: `Listing root folder failed: ${res.status} ${(await res.text()).slice(0, 160)}`,
      };
      return result;
    }
    const body = (await res.json()) as { data?: WorkDriveApiResource[] };
    const rows = body.data ?? [];
    firstFileId = rows.map((r) => toFile(r, "")).find((f) => !f.isFolder)?.id;
    result.folder = {
      ok: true,
      detail: `Root folder readable (${rows.length} item(s) in first page).`,
    };
  } catch (e) {
    result.folder = { ok: false, detail: short(e) };
    return result;
  }

  if (!firstFileId) {
    result.download = {
      ok: true,
      skipped: true,
      detail: "No file in the first page to test the download endpoint.",
    };
    return result;
  }

  try {
    const res = await fetch(`${DOWNLOAD_BASE}/${firstFileId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${await getAccessToken()}` },
    });
    const ct = res.headers.get("content-type") ?? "";
    if (res.ok && !ct.includes("json") && !ct.includes("html")) {
      result.download = { ok: true, detail: `Download endpoint returns bytes (content-type: ${ct || "unknown"}).` };
    } else {
      result.download = {
        ok: false,
        detail: `Download probe returned ${res.status} (${ct || "no content-type"}). If files won't download, set ZOHO_WORKDRIVE_DOWNLOAD_BASE for your data center.`,
      };
    }
    // Don't drain the body.
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
  } catch (e) {
    result.download = { ok: false, detail: short(e) };
  }

  return result;
}

/** Downloads a file's raw bytes from WorkDrive. */
export async function downloadFile(fileId: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const doDownload = async () =>
    fetch(`${DOWNLOAD_BASE}/${fileId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${await getAccessToken()}` },
    });
  let res = await doDownload();
  if (res.status === 401) {
    tokenCache = null;
    res = await doDownload();
  }
  if (!res.ok) {
    throw new Error(
      `WorkDrive download failed for ${fileId}: ${res.status} ${await res.text()}`,
    );
  }
  const arrayBuf = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuf),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
