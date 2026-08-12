"use client";

// ---------------------------------------------------------------------------
// Resume — restart a work order that stopped mid-flight.
//
// The engine runs worker → boss review → (revise → worker again) inside a
// SINGLE request, up to 3 rounds. If that request dies partway — a Vercel
// timeout on a long brief is the usual way — the order is left sitting in
// "revision" and nothing ever picks it up again. It waits forever, which is
// exactly the invisible-handoff problem this board exists to show.
//
// runWorkOrder already accepts "queued" and "revision" and rejects everything
// else, so the API itself is the guard — this button can't double-run an order
// that's genuinely mid-flight.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ResumeButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    setState("busy");
    setNote(null);
    try {
      const res = await fetch(`/api/org/work-orders/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        router.refresh();
        return;
      }
      setState("error");
      setNote(d.error ?? "Couldn't resume it.");
    } catch {
      setState("error");
      setNote("Network error — try again.");
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={state === "busy"}
        className="rounded-md border border-[#0094b8]/50 bg-[#0094b8]/15 px-2.5 py-1 text-[11px] font-semibold text-[#00d6ff] transition-colors hover:bg-[#0094b8]/25 disabled:opacity-50"
      >
        {state === "busy" ? "Picking it back up (a minute)…" : "Resume"}
      </button>
      {note && <span className="text-[11px] text-red-400">{note}</span>}
    </span>
  );
}
