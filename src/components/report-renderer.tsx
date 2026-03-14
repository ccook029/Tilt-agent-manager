"use client";

// ---------------------------------------------------------------------------
// ReportRenderer — Renders Claude's markdown report output as a branded,
// structured view matching the PDF report style. Used in the Report History
// tab so it looks polished instead of raw <pre> text.
// ---------------------------------------------------------------------------

interface ReportRendererProps {
  text: string;
  agentName?: string;
  date?: string;
}

interface Block {
  type: "h2" | "h3" | "paragraph" | "bullet" | "numbered" | "table" | "urgent" | "highlight";
  content: string;
  rows?: string[][];
  priority?: "high" | "medium" | "low";
  number?: number;
}

function parseToBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
  let isExecSummary = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (inTable && tableRows.length > 0) {
        blocks.push({ type: "table", content: "", rows: tableRows });
        tableRows = [];
        inTable = false;
      }
      isExecSummary = false;
      continue;
    }

    // Table rows
    if (trimmed.includes("|") && trimmed.split("|").length >= 3) {
      if (/^[\s|:-]+$/.test(trimmed)) continue;
      inTable = true;
      tableRows.push(
        trimmed
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c)
      );
      continue;
    }

    if (inTable && tableRows.length > 0) {
      blocks.push({ type: "table", content: "", rows: tableRows });
      tableRows = [];
      inTable = false;
    }

    // H2
    if (trimmed.startsWith("## ")) {
      const h = trimmed.replace(/^##\s*/, "").replace(/\*\*/g, "");
      blocks.push({ type: "h2", content: h });
      if (h.toLowerCase().includes("executive summary")) isExecSummary = true;
      continue;
    }

    // H3
    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "h3", content: trimmed.replace(/^###\s*/, "").replace(/\*\*/g, "") });
      continue;
    }

    // Bold-only line as H3
    if (/^\*\*[^*]+\*\*:?$/.test(trimmed)) {
      blocks.push({ type: "h3", content: trimmed.replace(/\*\*/g, "").replace(/:$/, "") });
      continue;
    }

    // Urgent
    if (trimmed.includes("🚨")) {
      blocks.push({ type: "urgent", content: trimmed.replace(/🚨/g, "").replace(/^[-*]\s*/, "").trim() });
      continue;
    }

    // Numbered list
    const numMatch = trimmed.match(/^(\d+)[.)]\s+(.*)/);
    if (numMatch) {
      const c = numMatch[2];
      let p: "high" | "medium" | "low" | undefined;
      if (/🔴|\bHigh\b/i.test(c)) p = "high";
      else if (/🟡|\bMedium\b/i.test(c)) p = "medium";
      else if (/🟢|\bLow\b/i.test(c)) p = "low";
      blocks.push({
        type: "numbered",
        content: c.replace(/🔴|🟡|🟢/g, "").replace(/\*\*/g, "").trim(),
        number: parseInt(numMatch[1]),
        priority: p,
      });
      continue;
    }

    // Bullet
    if (/^[-*]\s/.test(trimmed)) {
      const c = trimmed.replace(/^[-*]\s*/, "");
      let p: "high" | "medium" | "low" | undefined;
      if (/🔴|\bHigh\b/i.test(c)) p = "high";
      else if (/🟡|\bMedium\b/i.test(c)) p = "medium";
      else if (/🟢|\bLow\b/i.test(c)) p = "low";
      const clean = c.replace(/🔴|🟡|🟢/g, "").replace(/\*\*/g, "").trim();
      blocks.push({
        type: isExecSummary ? "highlight" : "bullet",
        content: clean,
        priority: p,
      });
      continue;
    }

    blocks.push({ type: "paragraph", content: trimmed.replace(/\*\*/g, "").replace(/\*/g, "") });
  }

  if (tableRows.length > 0) blocks.push({ type: "table", content: "", rows: tableRows });
  return blocks;
}

function PriorityBadge({ priority }: { priority?: "high" | "medium" | "low" }) {
  if (!priority) return null;
  const colors = {
    high: "bg-red-600 text-white",
    medium: "bg-amber-600 text-white",
    low: "bg-green-600 text-white",
  };
  const labels = { high: "HIGH", medium: "MED", low: "LOW" };
  return (
    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded mr-2 ${colors[priority]}`}>
      {labels[priority]}
    </span>
  );
}

/** Render inline bold fragments — turns **text** into <strong> */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="text-gray-100 font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export default function ReportRenderer({ text, agentName, date }: ReportRendererProps) {
  const blocks = parseToBlocks(text);

  return (
    <div className="space-y-1">
      {/* Report header bar */}
      {(agentName || date) && (
        <div className="flex items-center justify-between border-b border-[#e4002b]/30 pb-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-6 bg-[#e4002b] rounded-full" />
            {agentName && (
              <span className="text-sm font-semibold text-gray-200">{agentName}</span>
            )}
          </div>
          {date && (
            <span className="text-xs text-gray-500">
              {new Date(date).toLocaleDateString("en-US", {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      )}

      {blocks.map((block, idx) => {
        switch (block.type) {
          case "h2":
            return (
              <h2
                key={idx}
                className="text-base font-bold text-white mt-5 mb-2 pb-1.5 border-b-2 border-[#e4002b]/50"
              >
                {block.content}
              </h2>
            );

          case "h3":
            return (
              <h3 key={idx} className="text-sm font-semibold text-gray-200 mt-4 mb-1.5">
                {block.content}
              </h3>
            );

          case "paragraph":
            return (
              <p key={idx} className="text-sm text-gray-400 leading-relaxed mb-1.5">
                <InlineText text={block.content} />
              </p>
            );

          case "highlight":
            return (
              <div
                key={idx}
                className="border-l-4 border-[#e4002b]/60 bg-[#e4002b]/5 px-4 py-2.5 mb-2 rounded-r"
              >
                <div className="flex items-start gap-2">
                  <PriorityBadge priority={block.priority} />
                  <span className="text-sm text-gray-300 leading-relaxed">
                    <InlineText text={block.content} />
                  </span>
                </div>
              </div>
            );

          case "urgent":
            return (
              <div
                key={idx}
                className="border-l-4 border-red-600 bg-red-900/20 px-4 py-2.5 mb-2 rounded-r"
              >
                <span className="text-sm text-red-300 font-semibold">
                  ALERT: {block.content}
                </span>
              </div>
            );

          case "bullet":
            return (
              <div key={idx} className="flex items-start gap-2.5 pl-2 mb-1">
                <span className="text-[#e4002b] mt-1.5 text-xs leading-none select-none shrink-0">
                  {"\u25CF"}
                </span>
                <div className="flex items-start gap-1 flex-1 min-w-0">
                  <PriorityBadge priority={block.priority} />
                  <span className="text-sm text-gray-400 leading-relaxed">
                    <InlineText text={block.content} />
                  </span>
                </div>
              </div>
            );

          case "numbered":
            return (
              <div key={idx} className="flex items-start gap-2.5 pl-2 mb-1">
                <span className="text-[#e4002b] text-xs font-bold mt-0.5 w-5 text-right shrink-0">
                  {block.number}.
                </span>
                <div className="flex items-start gap-1 flex-1 min-w-0">
                  <PriorityBadge priority={block.priority} />
                  <span className="text-sm text-gray-400 leading-relaxed">
                    <InlineText text={block.content} />
                  </span>
                </div>
              </div>
            );

          case "table":
            if (!block.rows || block.rows.length === 0) return null;
            const [header, ...dataRows] = block.rows;
            return (
              <div key={idx} className="my-3 overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#111]">
                      {header.map((cell, ci) => (
                        <th
                          key={ci}
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-300 border-b border-gray-700"
                        >
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.map((row, ri) => (
                      <tr
                        key={ri}
                        className={ri % 2 === 0 ? "" : "bg-gray-900/30"}
                      >
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="px-3 py-2 text-gray-400 border-b border-gray-800/50"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
