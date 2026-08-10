// ---------------------------------------------------------------------------
// push.ts — Web Push notifications to the installed HQ app (and Android/desktop
// browsers). Subscriptions live in KV; sendPush fans out to every device and
// prunes dead ones. Degrades to a no-op until the VAPID env vars are set.
//
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — the keypair (generate once)
//   VAPID_SUBJECT — a mailto: or https: contact (defaults to a mailto)
// ---------------------------------------------------------------------------
import webpush from "web-push";
import { kv } from "@vercel/kv";

const KEY = "push-subscriptions";

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  staffId?: number;
  subscribedAt: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification lands. */
  url?: string;
  /** Collapse key — a new notification with the same tag replaces the old. */
  tag?: string;
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (!pushConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:hq@tilthockey.com",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
    vapidReady = true;
  }
  return true;
}

export async function getSubscriptions(): Promise<PushSub[]> {
  try {
    return (await kv.get<PushSub[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function saveSubscription(sub: PushSub): Promise<void> {
  const all = await getSubscriptions();
  const next = [...all.filter((s) => s.endpoint !== sub.endpoint), sub];
  try {
    await kv.set(KEY, next);
  } catch {
    /* best-effort */
  }
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const all = await getSubscriptions();
  try {
    await kv.set(
      KEY,
      all.filter((s) => s.endpoint !== endpoint)
    );
  } catch {
    /* best-effort */
  }
}

/**
 * Send a notification to every subscribed device. Best-effort and non-throwing:
 * a failed send never breaks the caller. Dead subscriptions (404/410) are pruned.
 */
export async function sendPush(payload: PushPayload): Promise<void> {
  if (!ensureVapid()) return;
  const subs = await getSubscriptions();
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          body
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
        else console.warn("[push] send failed:", (err as Error)?.message ?? err);
      }
    })
  );

  if (dead.length) {
    try {
      await kv.set(
        KEY,
        subs.filter((s) => !dead.includes(s.endpoint))
      );
    } catch {
      /* best-effort */
    }
  }
}
