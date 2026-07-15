// ---------------------------------------------------------------------------
// publish/index.ts — the publisher registry + append-only publish log
//
// One entry point for the app: getConnectionStatus() (what's wired), and
// publishRequest() (post one piece, routing to the right platform provider).
// Every attempt is recorded in a KV log so the publish history is visible and
// nothing is double-posted blindly.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";
import {
  PLATFORMS,
  type Platform,
  type ProviderStatus,
  type PublishProvider,
  type PublishRequest,
  type PublishResult,
} from "./types";
import { instagramProvider, facebookProvider } from "./providers/meta";
import { tiktokProvider } from "./providers/tiktok";

const providers: Record<Platform, PublishProvider> = {
  instagram: instagramProvider,
  facebook: facebookProvider,
  tiktok: tiktokProvider,
};

const LOG_KEY = "publish-log";
const MAX_LOG = 500;

export interface PublishLogEntry extends PublishResult {
  at: string;
  caption: string;
  /** Origin, e.g. a social post id or work-order id. */
  sourceId?: string;
}

export function getConnectionStatus(): ProviderStatus[] {
  return PLATFORMS.map((p) => providers[p].status());
}

export function anyPlatformConnected(): boolean {
  return getConnectionStatus().some((s) => s.connected);
}

async function appendLog(entry: PublishLogEntry): Promise<void> {
  const list = (await kv.get<PublishLogEntry[]>(LOG_KEY)) ?? [];
  await kv.set(LOG_KEY, [...list, entry].slice(-MAX_LOG));
}

export async function getPublishLog(limit = 100): Promise<PublishLogEntry[]> {
  const list = (await kv.get<PublishLogEntry[]>(LOG_KEY)) ?? [];
  return list.slice(-limit).reverse();
}

/** Post one piece to its platform and record the attempt. */
export async function publishRequest(
  req: PublishRequest,
  sourceId?: string
): Promise<PublishResult> {
  const provider = providers[req.platform];
  const result = provider
    ? await provider.publish(req)
    : { ok: false, platform: req.platform, error: `Unknown platform: ${req.platform}` };

  await appendLog({
    ...result,
    at: new Date().toISOString(),
    caption: req.caption.slice(0, 280),
    sourceId,
  }).catch(() => {});

  return result;
}
