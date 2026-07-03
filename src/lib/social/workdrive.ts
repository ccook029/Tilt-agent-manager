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
export function workdriveEnv(name: "CLIENT_ID" | "CLIENT_SECRET" | "REFRESH_TOKEN"): string | undefined {
  return process.env[`ZOHO_WORKDRIVE_${name}`] ?? process.env[`ZOHO_${name}`];
}

function requireWorkdriveEnv(name: "CLIENT_ID" | "CLIENT_SECRET" | "REFRESH_TOKEN"): string {
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

  const res = await fetch(`${accountsDomain}/oauth/v2/token?${params}`, {
    method: "POST",
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

async function workdriveFetch(path: string): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: "application/vnd.api+json",
    },
  });
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
    const children = await listChildren(folderId, path);
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

/** Downloads a file's raw bytes from WorkDrive. */
export async function downloadFile(fileId: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/download/${fileId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
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
