"use client";

// ---------------------------------------------------------------------------
// StrategyKnowledge — the standing brief Sterling reads in every conversation.
// Chris pastes his Tilt Business Strategist project (instructions + key docs)
// here; it's persisted via /api/strategy/knowledge.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";

interface Knowledge {
  content: string;
  updatedAt: string;
  updatedBy?: string;
}

export default function StrategyKnowledge() {
  const [content, setContent] = useState("");
  const [meta, setMeta] = useState<Knowledge | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/strategy/knowledge")
      .then((r) => r.json())
      .then((d) => {
        const k: Knowledge | null = d.knowledge ?? null;
        setMeta(k);
        setContent(k?.content ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/strategy/knowledge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.knowledge) setMeta(data.knowledge);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-gray-400 leading-relaxed">
          Paste your Tilt Business Strategist project — its instructions and key
          docs. Sterling reads this in every conversation.
        </p>
        {meta?.updatedAt && (
          <p className="mt-1 text-xs text-gray-600">
            Last updated {new Date(meta.updatedAt).toLocaleString()}
            {meta.updatedBy ? ` by ${meta.updatedBy}` : ""}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            placeholder="Paste your Tilt Business Strategist instructions and key documents here…"
            className="w-full min-h-[360px] rounded-2xl border border-gray-800/80 bg-[#101010]/80 px-4 py-3 font-mono text-sm text-gray-200 leading-relaxed focus:border-[#00d6ff] focus:outline-none"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-[#00d6ff] px-5 py-2 text-sm font-semibold text-[#06232b] transition-colors hover:bg-[#33e0ff] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && (
              <span className="text-sm text-emerald-400">Saved ✓</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
