// GET /api/accounting/ap/doc?id=<documentId> → streams the source PDF/image so
// Chris can eyeball the original bill while reviewing Penny's proposal.
// Auth: accounting owner.
import { NextRequest, NextResponse } from "next/server";
import { downloadDocument } from "@/lib/zoho-documents";
import { guardAccountingOwner } from "@/lib/os-identity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await guardAccountingOwner(request);
  if (denied) return denied;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const dl = await downloadDocument(id);
  if (!dl) return NextResponse.json({ error: "Document not available" }, { status: 404 });

  const bytes = Buffer.from(dl.base64, "base64");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": dl.contentType.split(";")[0] || "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
