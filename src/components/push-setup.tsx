"use client";

// ---------------------------------------------------------------------------
// PushSetup — registers the service worker and a one-tap "Enable alerts" toggle.
// Subscribes this device to Web Push so agent updates ping the phone even when
// the app is closed. Renders nothing where push isn't supported.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "off" | "on" | "denied" | "working";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushSetup() {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unsupported");
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    (async () => {
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? "on" : "off");
      } catch {
        setState("off");
      }
    })();
  }, []);

  const enable = async () => {
    setState("working");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const { publicKey } = await fetch("/api/push/vapid").then((r) => r.json());
      if (!publicKey) {
        setState("off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setState("on");
    } catch {
      setState("off");
    }
  };

  const disable = async () => {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      setState("off");
    } catch {
      setState("on");
    }
  };

  if (state === "loading" || state === "unsupported") return null;

  const base =
    "text-sm transition-colors inline-flex items-center gap-1.5";
  if (state === "denied") {
    return (
      <span
        title="Notifications are blocked. Enable them for this site in your browser/app settings."
        className={`${base} text-gray-600`}
      >
        🔕 Alerts blocked
      </span>
    );
  }
  if (state === "on") {
    return (
      <button onClick={disable} title="Alerts are on — tap to turn off" className={`${base} text-[#00d6ff] hover:text-[#33e0ff]`}>
        🔔 Alerts on
      </button>
    );
  }
  return (
    <button
      onClick={enable}
      disabled={state === "working"}
      title="Get a phone notification when an agent finishes work, needs a decision, or something needs you"
      className={`${base} text-gray-500 hover:text-gray-200 disabled:opacity-50`}
    >
      🔔 {state === "working" ? "…" : "Enable alerts"}
    </button>
  );
}
