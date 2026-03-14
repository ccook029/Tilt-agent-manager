// ---------------------------------------------------------------------------
// pdf.tsx — Tilt-branded PDF report generator using @react-pdf/renderer
//
// Parses Claude's text output and renders it as a polished, branded PDF.
// ---------------------------------------------------------------------------
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
  Font,
} from "@react-pdf/renderer";

// ---- Tilt Brand Colors ---------------------------------------------------
const BRAND = {
  black: "#0A0A0A",
  darkGray: "#1A1A1A",
  midGray: "#4A4A4A",
  lightGray: "#E5E5E5",
  white: "#FFFFFF",
  accent: "#2563EB",    // blue for highlights
  high: "#DC2626",      // red for high priority
  medium: "#D97706",    // amber for medium priority
  low: "#16A34A",       // green for low priority
  urgent: "#DC2626",    // red for urgent flags
};

// ---- Register a clean sans-serif font ------------------------------------
Font.register({
  family: "Helvetica",
  fonts: [
    { src: "Helvetica" },
    { src: "Helvetica-Bold", fontWeight: "bold" },
    { src: "Helvetica-Oblique", fontStyle: "italic" },
  ],
});

// ---- Styles --------------------------------------------------------------
const styles = StyleSheet.create({
  page: {
    padding: 48,
    paddingTop: 36,
    paddingBottom: 60,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: BRAND.darkGray,
    lineHeight: 1.5,
  },
  // Header bar
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    paddingBottom: 12,
    borderBottomWidth: 3,
    borderBottomColor: BRAND.black,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: BRAND.black,
    letterSpacing: 4,
  },
  headerSubtitle: {
    fontSize: 9,
    color: BRAND.midGray,
    textAlign: "right",
  },
  // Report metadata
  metaBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.lightGray,
  },
  metaText: {
    fontSize: 9,
    color: BRAND.midGray,
  },
  // Section headings
  h2: {
    fontSize: 14,
    fontWeight: "bold",
    color: BRAND.black,
    marginTop: 16,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomColor: BRAND.accent,
  },
  h3: {
    fontSize: 11,
    fontWeight: "bold",
    color: BRAND.darkGray,
    marginTop: 12,
    marginBottom: 6,
  },
  // Body text
  paragraph: {
    fontSize: 10,
    marginBottom: 6,
    color: BRAND.darkGray,
    lineHeight: 1.6,
  },
  // Bullet items
  bulletRow: {
    flexDirection: "row",
    marginBottom: 4,
    paddingLeft: 8,
  },
  bulletDot: {
    width: 12,
    fontSize: 10,
    color: BRAND.midGray,
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    color: BRAND.darkGray,
    lineHeight: 1.5,
  },
  // Priority badges
  priorityHigh: {
    color: BRAND.high,
    fontWeight: "bold",
  },
  priorityMedium: {
    color: BRAND.medium,
    fontWeight: "bold",
  },
  priorityLow: {
    color: BRAND.low,
    fontWeight: "bold",
  },
  // Highlight box (for executive summary or urgent items)
  highlightBox: {
    backgroundColor: "#F0F7FF",
    borderLeftWidth: 4,
    borderLeftColor: BRAND.accent,
    padding: 12,
    marginBottom: 12,
    marginTop: 4,
  },
  urgentBox: {
    backgroundColor: "#FEF2F2",
    borderLeftWidth: 4,
    borderLeftColor: BRAND.urgent,
    padding: 12,
    marginBottom: 12,
    marginTop: 4,
  },
  // Table styles
  table: {
    marginBottom: 12,
    marginTop: 4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: BRAND.black,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    flex: 1,
    fontSize: 9,
    fontWeight: "bold",
    color: BRAND.white,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.lightGray,
  },
  tableRowAlt: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: "#F9FAFB",
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.lightGray,
  },
  tableCell: {
    flex: 1,
    fontSize: 9,
    color: BRAND.darkGray,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: BRAND.lightGray,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 8,
    color: BRAND.midGray,
  },
});

// ---- Parse report text into structured blocks ----------------------------

interface Block {
  type: "h2" | "h3" | "paragraph" | "bullet" | "table" | "urgent" | "highlight";
  content: string;
  rows?: string[][];   // for tables
  priority?: "high" | "medium" | "low";
}

function parseReportToBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
  let isExecutiveSummary = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      if (inTable && tableRows.length > 0) {
        blocks.push({ type: "table", content: "", rows: tableRows });
        tableRows = [];
        inTable = false;
      }
      isExecutiveSummary = false;
      continue;
    }

    // Table detection (lines with | separators)
    if (trimmed.includes("|") && trimmed.split("|").length >= 3) {
      // Skip separator rows (--- | ---)
      if (/^[\s|:-]+$/.test(trimmed)) continue;
      inTable = true;
      const cells = trimmed
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c);
      tableRows.push(cells);
      continue;
    }

    if (inTable && tableRows.length > 0) {
      blocks.push({ type: "table", content: "", rows: tableRows });
      tableRows = [];
      inTable = false;
    }

    // H2 headings (## or **HEADING**)
    if (trimmed.startsWith("## ")) {
      const heading = trimmed.replace(/^##\s*/, "").replace(/\*\*/g, "");
      blocks.push({ type: "h2", content: heading });
      if (heading.toLowerCase().includes("executive summary")) {
        isExecutiveSummary = true;
      }
      continue;
    }

    // H3 headings (### or bold lines)
    if (trimmed.startsWith("### ")) {
      blocks.push({
        type: "h3",
        content: trimmed.replace(/^###\s*/, "").replace(/\*\*/g, ""),
      });
      continue;
    }

    // Bold-only lines as H3
    if (/^\*\*[^*]+\*\*:?$/.test(trimmed)) {
      blocks.push({
        type: "h3",
        content: trimmed.replace(/\*\*/g, "").replace(/:$/, ""),
      });
      continue;
    }

    // Urgent items
    if (trimmed.includes("🚨")) {
      blocks.push({
        type: "urgent",
        content: trimmed.replace(/🚨/g, "[ALERT]").replace(/^[-*]\s*/, ""),
      });
      continue;
    }

    // Bullet items with priority
    if (/^[-*]\s/.test(trimmed)) {
      const bulletContent = trimmed.replace(/^[-*]\s*/, "");
      let priority: "high" | "medium" | "low" | undefined;

      if (/🔴|High/i.test(bulletContent)) priority = "high";
      else if (/🟡|Medium/i.test(bulletContent)) priority = "medium";
      else if (/🟢|Low/i.test(bulletContent)) priority = "low";

      const cleanContent = bulletContent
        .replace(/🔴|🟡|🟢/g, "")
        .replace(/\*\*/g, "")
        .trim();

      if (isExecutiveSummary) {
        blocks.push({ type: "highlight", content: cleanContent, priority });
      } else {
        blocks.push({ type: "bullet", content: cleanContent, priority });
      }
      continue;
    }

    // Regular paragraph
    blocks.push({
      type: "paragraph",
      content: trimmed.replace(/\*\*/g, "").replace(/\*/g, ""),
    });
  }

  // Flush remaining table
  if (tableRows.length > 0) {
    blocks.push({ type: "table", content: "", rows: tableRows });
  }

  return blocks;
}

// ---- PDF Document Component ----------------------------------------------

interface ReportPDFProps {
  title: string;
  subtitle: string;
  reportDate: string;
  agentName: string;
  reportText: string;
}

function PriorityBadge({ priority }: { priority?: "high" | "medium" | "low" }) {
  if (!priority) return null;
  const style =
    priority === "high"
      ? styles.priorityHigh
      : priority === "medium"
        ? styles.priorityMedium
        : styles.priorityLow;
  const label = priority === "high" ? "HIGH" : priority === "medium" ? "MED" : "LOW";
  return <Text style={style}>[{label}] </Text>;
}

function ReportPDF({ title, subtitle, reportDate, agentName, reportText }: ReportPDFProps) {
  const blocks = parseReportToBlocks(reportText);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>TILT</Text>
          <View>
            <Text style={styles.headerSubtitle}>{title}</Text>
            <Text style={styles.headerSubtitle}>{subtitle}</Text>
          </View>
        </View>

        {/* Meta bar */}
        <View style={styles.metaBar}>
          <Text style={styles.metaText}>Report Date: {reportDate}</Text>
          <Text style={styles.metaText}>Agent: {agentName}</Text>
          <Text style={styles.metaText}>CONFIDENTIAL</Text>
        </View>

        {/* Report body */}
        {blocks.map((block, idx) => {
          switch (block.type) {
            case "h2":
              return <Text key={idx} style={styles.h2}>{block.content}</Text>;

            case "h3":
              return <Text key={idx} style={styles.h3}>{block.content}</Text>;

            case "paragraph":
              return <Text key={idx} style={styles.paragraph}>{block.content}</Text>;

            case "highlight":
              return (
                <View key={idx} style={styles.highlightBox}>
                  <View style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>●</Text>
                    <Text style={styles.bulletText}>
                      <PriorityBadge priority={block.priority} />
                      {block.content}
                    </Text>
                  </View>
                </View>
              );

            case "urgent":
              return (
                <View key={idx} style={styles.urgentBox}>
                  <Text style={[styles.paragraph, { color: BRAND.urgent, fontWeight: "bold" }]}>
                    ⚠ {block.content}
                  </Text>
                </View>
              );

            case "bullet":
              return (
                <View key={idx} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>
                    <PriorityBadge priority={block.priority} />
                    {block.content}
                  </Text>
                </View>
              );

            case "table":
              if (!block.rows || block.rows.length === 0) return null;
              const [header, ...dataRows] = block.rows;
              return (
                <View key={idx} style={styles.table}>
                  <View style={styles.tableHeader}>
                    {header.map((cell, ci) => (
                      <Text key={ci} style={styles.tableHeaderCell}>
                        {cell}
                      </Text>
                    ))}
                  </View>
                  {dataRows.map((row, ri) => (
                    <View
                      key={ri}
                      style={ri % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
                    >
                      {row.map((cell, ci) => (
                        <Text key={ci} style={styles.tableCell}>
                          {cell}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              );

            default:
              return null;
          }
        })}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Tilt Hockey — Corporate Headquarters
          </Text>
          <Text style={styles.footerText}>
            Generated {new Date().toISOString().slice(0, 10)} | tiltsports.com
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

// ---- Public API ----------------------------------------------------------

export interface GeneratePDFOptions {
  title: string;       // e.g. "Competitor Intelligence Report"
  subtitle: string;    // e.g. "Weekly Scan"
  reportDate: string;  // e.g. "2026-03-14"
  agentName: string;   // e.g. "Competitor Intelligence Agent"
  reportText: string;  // Claude's raw text output
}

/**
 * Generate a Tilt-branded PDF report and return it as a Buffer.
 */
export async function generateReportPDF(
  opts: GeneratePDFOptions
): Promise<Buffer> {
  const buffer = await renderToBuffer(
    <ReportPDF
      title={opts.title}
      subtitle={opts.subtitle}
      reportDate={opts.reportDate}
      agentName={opts.agentName}
      reportText={opts.reportText}
    />
  );

  return Buffer.from(buffer);
}
