// ---------------------------------------------------------------------------
// zoho-documents.ts — the Zoho Books "Documents" inbox (uploaded/emailed bills).
//
// This is where AP bills land before they're entered: Chris (or a vendor) emails
// or uploads a PDF, Zoho autoscans it, and it sits in the Files inbox until
// someone turns it into a Bill/Expense. Penny needs to SEE this inbox so she can
// read each bill and propose the entry.
//
// Slice 1 (this module): list the inbox + download a document's bytes, so Penny
// can read the PDF and the diagnostic can confirm the inbox is reachable. The
// propose → approve → create-in-Zoho pipeline builds on top of this.
//
// Everything is best-effort: a missing/renamed endpoint degrades to an empty
// list + a captured error, never throws into a run.
// ---------------------------------------------------------------------------
import { getAccessToken, getEnvOrThrow, invalidateTokenCache } from "./zoho";

function booksBase(): string {
  return process.env.ZOHO_DOMAIN ?? "https://www.zohoapis.com";
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return { Authorization: `Zoho-oauthtoken ${token}` };
}

export interface InboxDocument {
  id: string;
  fileName: string;
  fileType?: string;
  uploadedDate?: string;
  status?: string; // e.g. "processed" / "unprocessed"
  // Autoscan-extracted hints, when Zoho includes them on the list row.
  vendor?: string;
  amount?: number;
  date?: string;
  reference?: string;
}

// Zoho's field names vary across accounts/versions, so map defensively.
function mapDoc(d: Record<string, unknown>): InboxDocument {
  const s = (k: string) => (typeof d[k] === "string" && d[k] ? (d[k] as string) : undefined);
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : undefined);
  return {
    id: String(d.document_id ?? d.documentId ?? d.id ?? ""),
    fileName: s("file_name") ?? s("filename") ?? s("name") ?? "(unnamed)",
    fileType: s("file_type") ?? s("filetype"),
    uploadedDate:
      s("uploaded_on") ?? s("uploaded_date") ?? s("uploaded_time") ?? s("created_time"),
    status: s("status") ?? s("document_status"),
    vendor: s("vendor_name") ?? s("vendor"),
    amount: n("amount") ?? n("total"),
    date: s("date") ?? s("document_date"),
    reference: s("reference_number") ?? s("reference"),
  };
}

export interface InboxResult {
  reachable: boolean;
  documents: InboxDocument[];
  error?: string;
}

/** List documents in the Books inbox. Best-effort — captures the error instead of throwing. */
export async function fetchInboxDocuments(opts?: { max?: number }): Promise<InboxResult> {
  try {
    const orgId = getEnvOrThrow("ZOHO_ORGANIZATION_ID");
    const url = new URL(`${booksBase()}/books/v3/documents`);
    url.searchParams.set("organization_id", orgId);
    url.searchParams.set("per_page", String(opts?.max ?? 50));
    const res = await fetch(url.toString(), { headers: await authHeader() });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) await invalidateTokenCache();
      const body = await res.text();
      return { reachable: false, documents: [], error: `Zoho /documents ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = (await res.json()) as { documents?: Record<string, unknown>[] };
    const rows = Array.isArray(data.documents) ? data.documents : [];
    return { reachable: true, documents: rows.map(mapDoc).filter((d) => d.id) };
  } catch (err) {
    return { reachable: false, documents: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** Download a document's raw bytes (base64) so Penny can read the PDF/image. */
export async function downloadDocument(
  id: string
): Promise<{ base64: string; contentType: string } | null> {
  try {
    const orgId = getEnvOrThrow("ZOHO_ORGANIZATION_ID");
    const url = new URL(`${booksBase()}/books/v3/documents/${encodeURIComponent(id)}`);
    url.searchParams.set("organization_id", orgId);
    url.searchParams.set("inline", "true");
    const res = await fetch(url.toString(), { headers: await authHeader() });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    // A JSON body here means we got metadata, not the file — Slice 2 refines the
    // exact download path per Zoho's response; for now signal "no bytes".
    if (contentType.includes("application/json")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString("base64"), contentType };
  } catch {
    return null;
  }
}

/** Prose snapshot of the AP inbox for Penny's context. */
export async function renderApInboxSnapshot(max = 15): Promise<string> {
  const res = await fetchInboxDocuments({ max });
  if (!res.reachable) {
    return `(Zoho Books Documents inbox not reachable this run${res.error ? `: ${res.error}` : ""})`;
  }
  if (res.documents.length === 0) {
    return "(no documents in the Zoho Books inbox right now)";
  }
  const rows = res.documents.map((d, i) => {
    const bits = [
      d.vendor ? `vendor: ${d.vendor}` : null,
      d.amount != null ? `$${d.amount}` : null,
      d.date ? `dated ${d.date}` : null,
      d.reference ? `ref ${d.reference}` : null,
      d.status ? `[${d.status}]` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `${i + 1}. [${d.id}] ${d.fileName}${bits ? ` — ${bits}` : ""}`;
  });
  return [
    "## Zoho Books Documents Inbox — AP bills & receipts awaiting entry",
    "Uploaded/emailed bills that haven't been turned into a Bill/Expense yet. Read each one and propose the entry (vendor, date, amount, expense account); Bill if unpaid, Expense if already paid.",
    ...rows,
  ].join("\n");
}
