"use client";

// ---------------------------------------------------------------------------
// StrategyContracts — Sterling's deal pipeline. Add / edit / delete the
// contracts that feed the revenue projection. Backed by /api/strategy/contracts.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";

type Cadence = "one-time" | "monthly" | "annual";
type Status = "pipeline" | "won" | "lost";

interface Contract {
  id: string;
  name: string;
  counterparty?: string;
  amount: number;
  cadence: Cadence;
  probability: number;
  expectedStart: string;
  termMonths?: number;
  status: Status;
  category?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  name: string;
  counterparty: string;
  amount: string;
  cadence: Cadence;
  probability: string;
  expectedStart: string;
  termMonths: string;
  status: Status;
  category: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  counterparty: "",
  amount: "",
  cadence: "monthly",
  probability: "50",
  expectedStart: "",
  termMonths: "12",
  status: "pipeline",
  category: "",
  notes: "",
};

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function moneyLine(c: Contract): string {
  if (c.cadence === "one-time") return `${money(c.amount)} one-time`;
  const unit = c.cadence === "monthly" ? "/mo" : "/yr";
  const term = c.termMonths ? ` × ${c.termMonths}mo` : "";
  return `${money(c.amount)}${unit}${term}`;
}

const STATUS_PILL: Record<Status, string> = {
  pipeline: "border-cyan-900/60 text-[#00d6ff]",
  won: "border-emerald-900/60 text-emerald-400",
  lost: "border-gray-700 text-gray-500",
};

export default function StrategyContracts({
  onChange,
}: {
  onChange?: () => void;
}) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/strategy/contracts");
      const data = await res.json().catch(() => ({}));
      setContracts(data.contracts ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const startEdit = (c: Contract) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      counterparty: c.counterparty ?? "",
      amount: String(c.amount ?? ""),
      cadence: c.cadence,
      probability: String(c.probability ?? 50),
      expectedStart: c.expectedStart,
      termMonths: String(c.termMonths ?? 12),
      status: c.status,
      category: c.category ?? "",
      notes: c.notes ?? "",
    });
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    if (!form.name.trim() || !form.expectedStart) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        counterparty: form.counterparty.trim() || undefined,
        amount: Number(form.amount) || 0,
        cadence: form.cadence,
        probability: Number(form.probability) || 0,
        expectedStart: form.expectedStart,
        status: form.status,
        category: form.category.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      if (form.cadence !== "one-time") {
        payload.termMonths = Number(form.termMonths) || undefined;
      }
      if (editingId) {
        await fetch("/api/strategy/contracts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...payload }),
        });
      } else {
        await fetch("/api/strategy/contracts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      resetForm();
      await load();
      onChange?.();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Contract) => {
    if (!confirm(`Delete "${c.name}"?`)) return;
    await fetch(`/api/strategy/contracts?id=${encodeURIComponent(c.id)}`, {
      method: "DELETE",
    });
    if (editingId === c.id) resetForm();
    await load();
    onChange?.();
  };

  const inputCls =
    "w-full rounded-md border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm text-gray-200 focus:border-[#00d6ff] focus:outline-none";
  const labelCls = "text-xs text-gray-500";

  return (
    <div className="space-y-6">
      {/* Add / edit form */}
      <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-200">
          {editingId ? "Edit deal" : "Add deal"}
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1">
            <span className={labelCls}>Name *</span>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. League sponsorship"
              className={inputCls}
            />
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Counterparty</span>
            <input
              value={form.counterparty}
              onChange={(e) => set("counterparty", e.target.value)}
              placeholder="Who it's with"
              className={inputCls}
            />
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Amount</span>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="0"
              className={inputCls}
            />
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Cadence</span>
            <select
              value={form.cadence}
              onChange={(e) => set("cadence", e.target.value as Cadence)}
              className={inputCls}
            >
              <option value="one-time">one-time</option>
              <option value="monthly">monthly</option>
              <option value="annual">annual</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Probability (0-100)</span>
            <input
              type="number"
              min={0}
              max={100}
              value={form.probability}
              onChange={(e) => set("probability", e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Expected start *</span>
            <input
              type="date"
              value={form.expectedStart}
              onChange={(e) => set("expectedStart", e.target.value)}
              className={inputCls}
            />
          </label>
          {form.cadence !== "one-time" && (
            <label className="space-y-1">
              <span className={labelCls}>Term (months)</span>
              <input
                type="number"
                value={form.termMonths}
                onChange={(e) => set("termMonths", e.target.value)}
                className={inputCls}
              />
            </label>
          )}
          <label className="space-y-1">
            <span className={labelCls}>Status</span>
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value as Status)}
              className={inputCls}
            >
              <option value="pipeline">pipeline</option>
              <option value="won">won</option>
              <option value="lost">lost</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Category</span>
            <input
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder="e.g. Sponsorship"
              className={inputCls}
            />
          </label>
          <label className="space-y-1 sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Notes</span>
            <input
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Anything Sterling should know"
              className={inputCls}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={saving || !form.name.trim() || !form.expectedStart}
            className="rounded-lg bg-[#00d6ff] px-5 py-2 text-sm font-semibold text-[#06232b] transition-colors hover:bg-[#33e0ff] disabled:opacity-50"
          >
            {saving ? "Saving…" : editingId ? "Update deal" : "Add deal"}
          </button>
          {editingId && (
            <button
              onClick={resetForm}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : contracts.length === 0 ? (
        <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-6 text-sm text-gray-500">
          No deals yet — add your first one above to start building projections.
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-200">{c.name}</span>
                    {c.counterparty && (
                      <span className="text-sm text-gray-500">
                        ({c.counterparty})
                      </span>
                    )}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_PILL[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-amber-400">{moneyLine(c)}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    {c.probability}% · starts {c.expectedStart}
                    {c.category ? ` · ${c.category}` : ""}
                  </p>
                  {c.notes && (
                    <p className="mt-1 text-xs text-gray-500">{c.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <button
                    onClick={() => startEdit(c)}
                    className="text-[#00d6ff] hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(c)}
                    className="text-gray-600 transition-colors hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
