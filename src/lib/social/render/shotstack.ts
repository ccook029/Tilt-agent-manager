import { BRAND } from "@/lib/social/brand";
import { mirrorToBlob, blobExists } from "@/lib/social/blob";
import { anchorBandFor } from "./overlay";
import { RENDER_EPOCH } from "./version";

/**
 * Shotstack auto-reel client (the video pipeline).
 *
 * Assembles a vertical (9:16) reel from a REAL clip in the library: trims/fits
 * the source video, fades it in/out, drops an optional cyan lower-third
 * caption, and pins the SAME brand anchor the statics get (black band + cyan
 * rule + centered wordmark) along the bottom for the full cut. The logo is a
 * fixed PNG composite — never AI-rendered — and no AI invents footage; the
 * template is deterministic.
 *
 * Uses the REST API directly. Env: SHOTSTACK_API_KEY (required),
 * SHOTSTACK_ENV ("stage" sandbox = free but watermarked | "v1" production,
 * default "stage").
 */

const ENV = process.env.SHOTSTACK_ENV ?? "stage";
const API_BASE = process.env.SHOTSTACK_API_BASE ?? `https://api.shotstack.io/${ENV}`;

const REEL_W = 1080;
const REEL_H = 1920;
const DEFAULT_LENGTH = 10; // seconds — short, feed-friendly cut
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 240_000; // stay under the route's 300s maxDuration

export type ReelSpec = {
  /** Public URL of the source clip (Vercel Blob mirror). */
  videoUrl: string;
  /** Optional cyan lower-third caption (e.g. the post CTA). */
  caption?: string;
  /** Cap the cut length in seconds (default 10). */
  durationSec?: number;
};

export function shotstackConfigured(): boolean {
  return Boolean(process.env.SHOTSTACK_API_KEY);
}

function apiKey(): string {
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) {
    throw new Error("SHOTSTACK_API_KEY is not set — the video pipeline needs it.");
  }
  return key;
}

/**
 * Publishes the 9:16 anchor band to Blob (Shotstack fetches overlay assets by
 * URL). Keyed by branding epoch so a brand change rebuilds it exactly once.
 */
async function ensureAnchorUrl(): Promise<string | null> {
  const key = `brand/anchor-${REEL_W}x${REEL_H}-${RENDER_EPOCH}.png`;
  const existing = await blobExists(key);
  if (existing) return existing;

  const band = await anchorBandFor(REEL_W, REEL_H);
  return mirrorToBlob({ key, buffer: band.buffer, contentType: "image/png" });
}

/**
 * Auth probe for preflight: asks for a render id that can't exist. A valid key
 * gets a 404/400 from the render API; a bad or mismatched key is rejected by
 * the gateway with 401/403 before the lookup happens.
 */
export async function probeShotstack(): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(`${API_BASE}/render/00000000-0000-0000-0000-000000000000`, {
    headers: { "x-api-key": apiKey() },
  });
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      detail: `Key rejected (${res.status}) for environment "${ENV}" — the key must match SHOTSTACK_ENV (sandbox key ↔ "stage", production key ↔ "v1").`,
    };
  }
  if (res.ok || res.status === 404 || res.status === 400) {
    return {
      ok: true,
      detail: `Authenticated against "${ENV}"${ENV === "stage" ? " (sandbox — output is watermarked)" : ""}.`,
    };
  }
  return {
    ok: false,
    detail: `Unexpected Shotstack response ${res.status}: ${(await res.text()).slice(0, 120)}`,
  };
}

function buildEdit(spec: ReelSpec, anchorUrl: string | null) {
  const length = spec.durationSec ?? DEFAULT_LENGTH;

  // Tracks render top-first: anchor band on top, caption beneath, video back.
  const tracks: Record<string, unknown>[] = [];

  if (anchorUrl) {
    tracks.push({
      clips: [
        {
          asset: { type: "image", src: anchorUrl },
          start: 0,
          length,
          fit: "none", // PNG is exactly 1080 wide — fills the bottom edge-to-edge
          position: "bottom",
        },
      ],
    });
  }

  if (spec.caption) {
    tracks.push({
      clips: [
        {
          asset: {
            type: "title",
            text: spec.caption,
            style: "minimal",
            color: BRAND.colors.cyan,
            size: "small",
            position: "bottom",
          },
          start: 0,
          length,
          // Lift the caption clear of the anchor band (~11% of height).
          offset: { y: 0.14 },
          transition: { in: "fade", out: "fade" },
        },
      ],
    });
  }

  tracks.push({
    clips: [
      {
        asset: { type: "video", src: spec.videoUrl, volume: 1 },
        start: 0,
        length,
        fit: "cover",
        transition: { in: "fade", out: "fade" },
      },
    ],
  });

  return {
    timeline: { background: BRAND.colors.black, tracks },
    output: {
      format: "mp4",
      fps: 30,
      size: { width: REEL_W, height: REEL_H },
    },
  };
}

/** Submits a reel render; returns the Shotstack job id (renders run server-side). */
export async function submitReel(spec: ReelSpec): Promise<string> {
  const anchorUrl = await ensureAnchorUrl();
  const edit = buildEdit(spec, anchorUrl);
  const res = await fetch(`${API_BASE}/render`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey() },
    body: JSON.stringify(edit),
  });
  if (!res.ok) {
    throw new Error(`Shotstack submit failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { success?: boolean; response?: { id?: string } };
  const id = data.response?.id;
  if (!id) throw new Error("Shotstack returned no render id.");
  return id;
}

/** Polls a render to completion and returns the hosted MP4 URL. */
async function pollRender(id: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${API_BASE}/render/${id}`, {
      headers: { "x-api-key": apiKey() },
    });
    if (!res.ok) {
      throw new Error(`Shotstack status failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      response?: { status?: string; url?: string; error?: string };
    };
    const status = data.response?.status;
    if (status === "done" && data.response?.url) return data.response.url;
    if (status === "failed") {
      throw new Error(`Shotstack render failed: ${data.response?.error ?? "unknown"}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Shotstack render timed out.");
}

/**
 * Waits for a submitted job and returns the MP4 bytes (the caller mirrors them
 * to Blob — Shotstack's hosted URLs, especially in sandbox, are temporary).
 */
export async function fetchReelResult(jobId: string): Promise<Buffer> {
  const hostedUrl = await pollRender(jobId);
  const res = await fetch(hostedUrl);
  if (!res.ok) throw new Error(`Fetching rendered reel failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
