// ---------------------------------------------------------------------------
// notify.ts — email a finished announcement to the team.
//
// Used when an ambassador announcement is generated automatically (e.g. the
// tiltweb approval → photo-upload flow calls the generator server-to-server):
// Chris and Jeremy get the caption + the branded graphic as an attachment, so
// it lands in their inbox without anyone opening the app. The generated image
// lives in the private Blob store, so we attach the bytes rather than linking a
// login-gated URL.
// ---------------------------------------------------------------------------
import { Resend } from "resend";
import { readBlobBytes } from "@/lib/social/blob";
import type { Announcement } from "@/lib/social/db/schema";

/** Chris + Jeremy, parsed from MORNING_BRIEF_RECIPIENTS ("email=tag, …"). */
function teamRecipients(): string[] {
  const raw =
    process.env.ANNOUNCEMENT_NOTIFY ??
    process.env.MORNING_BRIEF_RECIPIENTS ??
    process.env.EMAIL_TO ??
    "";
  const emails = raw
    .split(",")
    .map((s) => s.split("=")[0].trim())
    .filter((s) => s.includes("@"));
  return emails.length ? Array.from(new Set(emails)) : ["chris@tilthockey.com"];
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/**
 * Email a generated ambassador/partner announcement to the team. Best-effort —
 * never throws (a missing key or Resend hiccup must not fail generation).
 */
export async function notifyAnnouncement(a: Announcement): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const from = process.env.EMAIL_FROM ?? "agents@tilthockey.com";
  const to = teamRecipients();
  const kindLabel = a.kind === "ambassador" ? "ambassador" : "partnership";

  const attachments: { filename: string; content: string }[] = [];
  if (a.imageUrl) {
    try {
      const { buf } = await readBlobBytes(a.imageUrl);
      attachments.push({
        filename: `${slug(a.name) || "announcement"}-${a.kind}.png`,
        content: buf.toString("base64"),
      });
    } catch {
      /* attachment is best-effort; the caption still goes out */
    }
  }

  const tags = (a.hashtags ?? []).join(" ");
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">
      <p style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#00A7E1;margin:0 0 4px">
        New ${kindLabel} announcement
      </p>
      <h2 style="margin:0 0 12px">${a.name}</h2>
      <p style="white-space:pre-wrap;line-height:1.5;color:#222">${a.copy ?? ""}</p>
      ${tags ? `<p style="color:#00A7E1;font-size:14px">${tags}</p>` : ""}
      ${a.cta ? `<p style="color:#444;font-size:14px">${a.cta}</p>` : ""}
      <p style="color:#888;font-size:13px;margin-top:16px">
        The branded graphic is attached. Review or tweak it anytime in
        Design&nbsp;Studio → Announcements.
      </p>
    </div>`;

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from,
    to,
    subject: `New ${kindLabel} announcement — ${a.name}`,
    html,
    attachments: attachments.length ? attachments : undefined,
  });
}
