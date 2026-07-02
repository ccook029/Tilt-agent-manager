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

export interface InteracSearchDetail {
  user: string;
  host: string;
  /** Every selectable folder searched, with its Interac hit count. */
  foldersSearched: { folder: string; hits: number }[];
  notifications: InteracNotification[];
}

/**
 * Search the WHOLE mailbox (every selectable folder) for Interac e-Transfer
 * notifications, matching on sender OR subject — filters/archiving can't hide
 * them. Returns full detail for diagnostics. Newest first.
 */
export async function fetchInteracDetailed(opts?: {
  sinceDays?: number;
  max?: number;
}): Promise<InteracSearchDetail> {
  const user = process.env.INBOX_USER!;
  const host = process.env.IMAP_HOST ?? defaultImapHost(user);
  const empty: InteracSearchDetail = { user, host, foldersSearched: [], notifications: [] };
  if (!isInboxConfigured()) return empty;

  const sinceDays = opts?.sinceDays ?? 730; // 2 years — the backlog is old
  const max = opts?.max ?? 150;

  const client = new ImapFlow({
    host,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user, pass: process.env.INBOX_APP_PASSWORD! },
    logger: false,
  });

  await client.connect();
  try {
    const since = new Date(Date.now() - sinceDays * 86_400_000);

    // Enumerate folders. On Gmail, All Mail already contains everything.
    const boxes = await client.list();
    const selectable = boxes.filter((b) => !b.flags?.has("\\Noselect"));
    const gmailAll = selectable.find(
      (b) => b.specialUse === "\\All" || /all mail/i.test(b.path)
    );
    const targets = gmailAll ? [gmailAll] : selectable;

    const foldersSearched: { folder: string; hits: number }[] = [];
    const out: InteracNotification[] = [];

    for (const box of targets) {
      if (out.length >= max) break;
      let uids: number[] = [];
      try {
        await client.mailboxOpen(box.path, { readOnly: true });
        uids =
          (await client.search(
            // sender OR subject mentions interac (covers bank-branded senders)
            { since, or: [{ from: "interac" }, { subject: "interac" }] },
            { uid: true }
          )) || [];
      } catch {
        continue; // unreadable folder — skip it
      }
      foldersSearched.push({ folder: box.path, hits: uids.length });
      if (uids.length === 0) continue;

      const selected = uids.slice(-(max - out.length)); // most recent N
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
    }

    out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return { user, host, foldersSearched, notifications: out };
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Notifications only — the shape the categorization engine consumes. */
export async function fetchInteracNotifications(opts?: {
  sinceDays?: number;
  max?: number;
}): Promise<InteracNotification[]> {
  return (await fetchInteracDetailed(opts)).notifications;
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
