"use client";

// ---------------------------------------------------------------------------
// /studio/announcements — the native Announcement Creator. Describe what's
// happening; get platform-ready copy + a visual brief in the Tilt voice.
// ---------------------------------------------------------------------------
import { useState } from "react";
import Link from "next/link";
import ReportRenderer from "@/components/report-renderer";
import PageHeader from "@/components/page-header";

const KINDS = [
  "Product drop",
  "Sale / promo",
  "Event",
  "Partnership",
  "Team signing",
  "Milestone",
  "General",
];

export default function AnnouncementsPage() {
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState(KINDS[0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/announcement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, kind, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Generation failed.");
        return;
      }
      setResult(data.text);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <Link href="/studio" className="hover:text-[#00d6ff] transition-colors">
              Design Studio
            </Link>{" "}
            /
          </>
        }
        title="Announcement Creator"
        subtitle="Say what's happening — get on-brand copy for Instagram, Facebook, and TikTok, plus a visual brief for the designer."
      />

      <form
        onSubmit={generate}
        className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5 space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              What are we announcing?
            </label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
              rows={3}
              placeholder="e.g. The new TILT INT 18K stick drops Friday — 40g lighter, same kick point, $199."
              className="w-full rounded-lg bg-[#0a0a0a] border border-gray-800 px-3 py-2 text-sm focus:border-[#00d6ff] focus:outline-none resize-y"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              Type
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full rounded-lg bg-[#0a0a0a] border border-gray-800 px-3 py-2 text-sm focus:border-[#00d6ff] focus:outline-none"
            >
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Extra context <span className="text-gray-700">(optional)</span>
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="dates, links, do/don't mentions…"
            className="w-full rounded-lg bg-[#0a0a0a] border border-gray-800 px-3 py-2 text-sm focus:border-[#00d6ff] focus:outline-none"
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 border border-red-900/60 bg-red-950/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[#00d6ff] text-black font-semibold px-5 py-2 text-sm hover:bg-[#33e0ff] transition-colors disabled:opacity-50"
        >
          {busy ? "Drafting…" : "Draft announcement"}
        </button>
      </form>

      {result && (
        <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-wider text-gray-500">
              Draft
            </h2>
            <button
              onClick={copy}
              className="text-xs border border-gray-800 rounded-lg px-3 py-1.5 text-gray-400 hover:text-[#00d6ff] hover:border-[#00d6ff]/50 transition-colors"
            >
              {copied ? "Copied ✓" : "Copy markdown"}
            </button>
          </div>
          <ReportRenderer text={result} agentName="Design Studio" />
        </div>
      )}
    </div>
  );
}
