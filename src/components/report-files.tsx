"use client";

import { useEffect, useState, useCallback } from "react";

interface ReportEntry {
  id: string;
  agentId: string;
  agentName: string;
  date: string;
  durationMs: number;
  tokensUsed?: number;
  preview: string;
}

export default function ReportFiles({ agentId }: { agentId: string }) {
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports?agentId=${agentId}`);
      const data = await res.json();
      setReports(data.reports ?? []);
    } catch {
      console.error("Failed to fetch reports");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const downloadPDF = async (reportId: string, date: string) => {
    setDownloading(reportId);
    try {
      const res = await fetch("/api/reports/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId }),
      });

      if (!res.ok) throw new Error("Download failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tilt-report-${date.slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      console.error("Failed to download PDF");
    } finally {
      setDownloading(null);
    }
  };

  if (loading) {
    return <p className="text-gray-500 text-sm">Loading reports...</p>;
  }

  if (reports.length === 0) {
    return (
      <div className="text-center py-8 text-gray-600">
        <p className="text-sm">No reports generated yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {reports.map((report) => (
        <div
          key={report.id}
          className="flex items-center justify-between px-4 py-3 border border-gray-800 rounded-lg hover:border-gray-700 hover:bg-gray-900/30 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* PDF icon */}
            <div className="w-9 h-9 rounded bg-[#e4002b]/10 border border-[#e4002b]/20 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-[#e4002b]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>

            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">
                {report.agentName}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {new Date(report.date).toLocaleString()} &middot;{" "}
                {(report.durationMs / 1000).toFixed(1)}s
                {report.tokensUsed != null && (
                  <> &middot; {report.tokensUsed.toLocaleString()} tokens</>
                )}
              </p>
            </div>
          </div>

          <button
            onClick={() => downloadPDF(report.id, report.date)}
            disabled={downloading === report.id}
            className="px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-md text-gray-300 transition-colors disabled:opacity-50 shrink-0 ml-3"
          >
            {downloading === report.id ? "..." : "Download PDF"}
          </button>
        </div>
      ))}
    </div>
  );
}
