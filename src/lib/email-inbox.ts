// ---------------------------------------------------------------------------
// email-inbox.ts — Interac e-Transfer notifications from Chris's email
//
// Interac e-Transfers land in the bank feed as anonymous deposits, but the
// notification email carries the SENDER'S NAME and often a message ("stick
// payment"). This module connects to the inbox over IMAP (Gmail App Password —
// no OAuth flow needed) and pulls ONLY Interac notification emails, so Penny
// can identify who each e-Transfer came from and categorize it correctly.
//
// Scope discipline: the search is restricted to Interac senders. Nothing else
// in the inbox is read, fetched, or stored.
//
// Env: INBOX_USER, INBOX_APP_PASSWORD.
//   Zoho Mail (Tilt's provider): enable IMAP in Zoho Mail settings, create an
//   app password at accounts.zoho.com → Security → App Passwords.
//   Host auto-detects: @gmail.com → imap.gmail.com; @zoho.com → imap.zoho.com;
//   custom-domain Zoho org (e.g. @tilthockey.com) → imappro.zoho.com.
//   Override with IMAP_HOST / IMAP_PORT if needed.
// ---------------------------------------------------------------------------
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface InteracNotification {
  date: string; // YYYY-MM-DD
  name?: string;
  amount?: number;
  message?: string;
  subject: string;
  direction: "received" | "sent" | "other";
}

export function isInboxConfigured(): boolean {
  return !!(process.env.INBOX_USER && process.env.INBOX_APP_PASSWORD);
}

function defaultImapHost(user: string): string {
  const domain = user.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "imap.gmail.com";
  if (domain === "zoho.com" || domain === "zohomail.com") return "imap.zoho.com";
  // Custom-domain mailboxes hosted on Zoho Mail (Tilt's setup) use imappro.
  return "imappro.zoho.com";
}

/**
 * Fetch Interac e-Transfer notification emails. Searches only messages from
 * Interac's notification senders. Newest first.
 */
export async function fetchInteracNotifications(opts?: {
  sinceDays?: number;
  max?: number;
}): Promise<InteracNotification[]> {
  if (!isInboxConfigured()) return [];

  const sinceDays = opts?.sinceDays ?? 730; // 2 years — the backlog is old
  const max = opts?.max ?? 150;

  const user = process.env.INBOX_USER!;
  const client = new ImapFlow({
    host: process.env.IMAP_HOST ?? defaultImapHost(user),
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: {
      user,
      pass: process.env.INBOX_APP_PASSWORD!,
    },
    logger: false,
  });

  await client.connect();
  try {
    // Gmail's All Mail covers archived messages; other providers use INBOX.
    try {
      await client.mailboxOpen("[Gmail]/All Mail", { readOnly: true });
    } catch {
      await client.mailboxOpen("INBOX", { readOnly: true });
    }

    const since = new Date(Date.now() - sinceDays * 86_400_000);
    const uids = await client.search(
      { from: "interac", since },
      { uid: true }
    );
    if (!uids || uids.length === 0) return [];

    const selected = uids.slice(-max); // most recent N
    const out: InteracNotification[] = [];

    for await (const msg of client.fetch(
      selected,
      { uid: true, envelope: true, source: true },
      { uid: true }
    )) {
      try {
        const parsed = msg.source ? await simpleParser(msg.source) : null;
        const subject = parsed?.subject ?? msg.envelope?.subject ?? "";
        const text = (parsed?.text ?? "").slice(0, 3000);
        const haystack = `${subject}\n${text}`;

        const amountMatch = haystack.match(/\$\s?([\d,]+\.\d{2})/);
        // "John Smith sent you money" / "INTERAC e-Transfer: John Smith has sent you $50.00"
        const nameMatch =
          subject.match(/(?:e-?Transfer:?\s*)?(.+?)\s+(?:sent you|has sent you)/i) ??
          text.match(/(?:^|\n)\s*(.+?)\s+(?:sent you|has sent you)/i);
        const messageMatch = text.match(/Message:?\s*([^\n]+)/i);

        const direction: InteracNotification["direction"] = /sent you|has sent you/i.test(haystack)
          ? "received"
          : /you sent|transfer to|has been deposited by/i.test(haystack)
            ? "sent"
            : "other";

        const dateObj = parsed?.date ?? msg.envelope?.date ?? null;

        out.push({
          date: dateObj ? new Date(dateObj).toISOString().slice(0, 10) : "",
          name: nameMatch?.[1]?.trim().slice(0, 60),
          amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : undefined,
          message: messageMatch?.[1]?.trim().slice(0, 120),
          subject: subject.slice(0, 140),
          direction,
        });
      } catch {
        // Skip an unparseable message rather than failing the whole pull.
      }
    }

    // Newest first
    return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Render notifications as a prompt table. */
export function renderInteracBlock(notifications: InteracNotification[]): string {
  if (notifications.length === 0) return "";
  const rows = notifications.map(
    (n) =>
      `| ${n.date} | ${n.direction} | ${n.name ?? "?"} | ${n.amount != null ? `$${n.amount.toFixed(2)}` : "?"} | ${n.message ?? ""} |`
  );
  return [
    "## Interac e-Transfer Notification Emails (from Chris's inbox — use these to identify who bank-feed e-Transfers are from; match on amount + date)",
    "| Date | Direction | Name | Amount | Message |",
    "|------|-----------|------|--------|---------|",
    ...rows,
    notifications.length >= 150
      ? "[NOTE: capped at the 150 most recent notifications — older transfers may not be listed.]"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
