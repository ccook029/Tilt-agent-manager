"use client";

// ---------------------------------------------------------------------------
// /files — the staff file cabinet. Upload, browse, download, delete —
// the shared documents every staff member should be able to reach from
// anywhere in the OS. Backed by Vercel Blob via /api/files.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";

interface StaffFile {
  name: string;
  url: string;
  size: number;
  uploadedAt: string;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesPage() {
  const [files, setFiles] = useState<StaffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/files");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data.error ?? "Could not load files.");
        return;
      }
      setNotice(null);
      setFiles(data.files ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (picked: FileList | null) => {
    if (!picked?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(picked)) {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch("/api/files", { method: "POST", body: form });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setNotice(data.error ?? `Upload failed for ${f.name}.`);
        }
      }
      await load();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (f: StaffFile) => {
    if (!confirm(`Delete "${f.name}" for everyone?`)) return;
    await fetch(`/api/files?url=${encodeURIComponent(f.url)}`, {
      method: "DELETE",
    });
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-600">
            Tilt OS
          </p>
          <h1 className="text-2xl font-semibold">Files</h1>
          <p className="text-sm text-gray-500">
            Shared staff documents — everything the team needs, one place.
          </p>
        </div>
        <label className="rounded-lg bg-[#00d6ff] text-black font-semibold px-5 py-2 text-sm hover:bg-[#33e0ff] transition-colors cursor-pointer">
          {busy ? "Uploading…" : "Upload files"}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => upload(e.target.files)}
          />
        </label>
      </div>

      {notice && (
        <p className="text-sm text-amber-300 border border-amber-900/60 bg-amber-950/20 rounded-lg px-4 py-3">
          {notice}
        </p>
      )}

      <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 overflow-x-auto">
        {loading ? (
          <p className="px-5 py-8 text-sm text-gray-600">Loading…</p>
        ) : files.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-600">
            No files yet — upload the first one.
          </p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800/70">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium w-24">Size</th>
                <th className="px-5 py-3 font-medium w-32">Uploaded</th>
                <th className="px-5 py-3 w-28" />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr
                  key={f.url}
                  className="border-b border-gray-900 last:border-0 hover:bg-gray-900/40"
                >
                  <td className="px-5 py-3 text-gray-200 break-all">{f.name}</td>
                  <td className="px-5 py-3 text-gray-500">{fmtSize(f.size)}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {new Date(f.uploadedAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#00d6ff] hover:underline mr-3"
                    >
                      Open
                    </a>
                    <button
                      onClick={() => remove(f)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
