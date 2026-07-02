// ---------------------------------------------------------------------------
// /api/accounting/documents — Reference-document uploads for the CFO chat
//
// POST multipart/form-data { file } — accepts .xlsx / .xls / .csv, parses every
//   sheet to a text table, stores it (KV) for Sterling's chat + Penny's tasks.
// GET               → list stored documents (metadata only).
// DELETE ?id=doc-…  → remove a document.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getDocuments, saveDocument, deleteDocument } from "@/lib/documents";
import { resolveEscalation } from "@/lib/policy-ledger";

export const maxDuration = 60;

const ACCEPTED = [".xlsx", ".xls", ".csv", ".txt"];
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel body limit is ~4.5MB

export async function GET() {
  const docs = await getDocuments();
  return NextResponse.json({
    ok: true,
    documents: docs.map(({ id, filename, uploadedAt, sheets, rows, originalChars }) => ({
      id,
      filename,
      uploadedAt,
      sheets,
      rows,
      originalChars,
    })),
  });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const removed = await deleteDocument(id);
  return NextResponse.json({ ok: removed });
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Attach a file in the 'file' field." }, { status: 400 });
    }

    const name = file.name || "upload";
    const lower = name.toLowerCase();
    if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
      return NextResponse.json(
        { error: `Unsupported file type. Accepted: ${ACCEPTED.join(", ")}` },
        { status: 400 }
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "File too large (4MB max). Export a smaller range or save as CSV." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    let text = "";
    let sheets = 1;
    let rows = 0;

    if (lower.endsWith(".txt")) {
      text = buf.toString("utf-8");
      rows = text.split(/\r?\n/).filter((l) => l.trim()).length;
    } else {
      // XLSX.read handles .xlsx, .xls, and .csv buffers alike.
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "buffer" });
      sheets = wb.SheetNames.length;

      // Answered-questions round trip: if this is the exported questions sheet
      // with the YOUR ANSWER column filled in, record each answer as standing
      // policy instead of storing the file as a reference document.
      let recorded = 0;
      let alreadyResolved = 0;
      for (const sheetName of wb.SheetNames) {
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]);
        for (const row of json) {
          const keys = Object.keys(row);
          const idKey = keys.find((k) => /question\s*id/i.test(k));
          const answerKey = keys.find((k) => /your\s*answer|^answer$/i.test(k));
          if (!idKey || !answerKey) break; // not a questions sheet
          const id = String(row[idKey] ?? "").trim();
          const answer = String(row[answerKey] ?? "").trim();
          if (!id.startsWith("esc-") || !answer) continue;
          const policy = await resolveEscalation(id, answer);
          if (policy) recorded++;
          else alreadyResolved++;
        }
      }
      if (recorded > 0 || alreadyResolved > 0) {
        return NextResponse.json({
          ok: true,
          answersRecorded: recorded,
          answersSkipped: alreadyResolved,
        });
      }

      const parts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        rows += csv.split(/\r?\n/).filter((l) => l.trim()).length;
        parts.push(`## Sheet: ${sheetName}\n${csv}`);
      }
      text = parts.join("\n\n");
    }

    const doc = await saveDocument({ filename: name, sheets, rows, text });

    return NextResponse.json({
      ok: true,
      document: {
        id: doc.id,
        filename: doc.filename,
        uploadedAt: doc.uploadedAt,
        sheets: doc.sheets,
        rows: doc.rows,
        truncated: doc.originalChars > doc.text.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[accounting/documents] Upload failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
