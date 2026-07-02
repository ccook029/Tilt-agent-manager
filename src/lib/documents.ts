// ---------------------------------------------------------------------------
// documents.ts — Reference documents Chris uploads for the Accounting team
//
// Chris attaches Excel/CSV files (bank statements, detail exports, the master
// sheet, etc.) in Sterling's chat. They're parsed to text tables and stored in
// KV, then injected into BOTH Sterling's chat context and Penny's task context
// — so "check this against what's in Books" actually has the document in hand.
//
// Limits: KV values are size-capped, so each document's text is truncated to
// MAX_TEXT_PER_DOC and only the most recent MAX_DOCS are kept. Truncation is
// always disclosed in the rendered block so nobody assumes full coverage.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const DOCS_KEY = "accounting-documents";
const MAX_DOCS = 5;
const MAX_TEXT_PER_DOC = 150_000;

export interface AccountingDocument {
  id: string;
  filename: string;
  uploadedAt: string;
  sheets: number;
  rows: number;
  /** Parsed text (CSV per sheet), possibly truncated. */
  text: string;
  /** Original character count before truncation. */
  originalChars: number;
}

export async function getDocuments(): Promise<AccountingDocument[]> {
  return (await kv.get<AccountingDocument[]>(DOCS_KEY)) ?? [];
}

export async function saveDocument(input: {
  filename: string;
  sheets: number;
  rows: number;
  text: string;
}): Promise<AccountingDocument> {
  const docs = await getDocuments();
  const doc: AccountingDocument = {
    id: `doc-${Date.now()}`,
    filename: input.filename,
    uploadedAt: new Date().toISOString(),
    sheets: input.sheets,
    rows: input.rows,
    text: input.text.slice(0, MAX_TEXT_PER_DOC),
    originalChars: input.text.length,
  };
  // Newest first; keep the most recent MAX_DOCS.
  const merged = [doc, ...docs].slice(0, MAX_DOCS);
  await kv.set(DOCS_KEY, merged);
  return doc;
}

export async function deleteDocument(id: string): Promise<boolean> {
  const docs = await getDocuments();
  const filtered = docs.filter((d) => d.id !== id);
  if (filtered.length === docs.length) return false;
  await kv.set(DOCS_KEY, filtered);
  return true;
}

/**
 * Render the stored documents as a prompt block. Caps per-document injection
 * so a huge sheet doesn't blow the context; discloses any truncation.
 */
export function renderDocumentsBlock(
  docs: AccountingDocument[],
  maxCharsPerDoc = 12_000
): string {
  if (docs.length === 0) return "(none uploaded)";
  return docs
    .map((d) => {
      const shown = d.text.slice(0, maxCharsPerDoc);
      const truncated =
        d.originalChars > shown.length
          ? `\n[NOTE: truncated — showing first ${shown.length.toLocaleString()} of ${d.originalChars.toLocaleString()} characters. Findings from this document may be partial; say so when relevant.]`
          : "";
      return `### 📎 ${d.filename} (uploaded ${d.uploadedAt.slice(0, 10)}, ${d.sheets} sheet(s), ~${d.rows} rows)\n${shown}${truncated}`;
    })
    .join("\n\n---\n\n");
}
