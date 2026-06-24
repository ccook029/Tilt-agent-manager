# Zoho Books MCP — Setup Guide

This guide connects the **Accounting team** (Sterling Vance, CFO + Penny Quill,
Staff Accountant) to your Zoho Books organization so Penny can read the books
and propose cleanup work.

Two connection paths exist, and they work together:

| Path | When it's used | What you need |
|------|----------------|---------------|
| **MCP connector** (preferred) | When `ZOHO_BOOKS_MCP_URL` is set | Zoho Books MCP enabled + an OAuth token |
| **REST fallback** (always on) | Whenever MCP isn't configured, or for the read-only snapshot that grounds every run | Your existing `ZOHO_*` OAuth vars, with a Books scope |

You can run the whole system on the **REST fallback alone** — the MCP step is an
upgrade, not a prerequisite. Start with REST, add MCP when you're ready.

> **Safety model (v1): propose-only.** Penny never writes to your books. We
> enforce this in two places: (1) only **read** tools are enabled on the Zoho
> side, and (2) the agents are prompted to recommend, never post. Keep write
> tools disabled until you explicitly decide to turn graduation on.

---

## Part A — REST fallback (do this first, ~5 minutes)

The app already uses a Zoho OAuth refresh token for Inventory (Stockton). The
Accounting team reuses the **same** token — you just need to make sure its scope
also covers Books.

1. Go to the **Zoho API Console**: https://api-console.zoho.com/
2. Open your existing **Self Client** (the one already used for Inventory), or
   create a new Self Client if you don't have one.
3. Generate an authorization code with a scope that includes Books, e.g.:
   ```
   ZohoInventory.fullaccess.all,ZohoSheet.dataAPI.READ,ZohoBooks.fullaccess.all
   ```
   (Read-only is enough for v1. If you prefer least-privilege, use
   `ZohoBooks.invoices.READ,ZohoBooks.bills.READ,ZohoBooks.banking.READ,ZohoBooks.chartofaccounts.READ`.)
4. Exchange the code for a **refresh token** (same flow you used for Inventory).
5. In **Vercel → Project → Settings → Environment Variables**, confirm these are
   set (they already exist for Inventory — just verify the refresh token has the
   Books scope from step 3):
   ```
   ZOHO_CLIENT_ID=1000.xxxx
   ZOHO_CLIENT_SECRET=xxxx
   ZOHO_REFRESH_TOKEN=1000.xxxx        # must include a Books scope
   ZOHO_ORGANIZATION_ID=123456789
   ```
6. Redeploy. You can now run **Penny Quill → Books Health Report** from the
   dashboard and get a real read-only diagnostic.

> Find your `ZOHO_ORGANIZATION_ID` in Zoho Books under **Settings → Organizations**.

---

## Part B — Zoho Books MCP connector (the upgrade)

This gives Penny live, structured tool access to Zoho Books (instead of only the
pre-fetched REST snapshot).

### B1. Enable MCP in Zoho Books

1. Sign in to **Zoho Books** as an **admin**.
2. Go to **Settings → MCP** (also surfaced under Zoho's connectors/integrations;
   Zoho's exact label may shift — see their help page linked at the bottom).
3. **Enable the MCP server** for your organization.
4. **Choose which tools are exposed.** For v1, enable **read tools only** —
   things like list/get invoices, bills, expenses, bank transactions, chart of
   accounts, and reports. **Leave every write/create/update/delete tool OFF.**
   This is what enforces propose-only at the source.
5. Approve the connection (Zoho requires admin approval before any tool can run).

### B2. Get the MCP server URL + an OAuth access token

The Anthropic MCP connector talks to a **remote, HTTPS** MCP endpoint and
authenticates with an **OAuth bearer token**.

1. Copy the **MCP server URL** Zoho shows you when you enable MCP (it will start
   with `https://`). This becomes `ZOHO_BOOKS_MCP_URL`.
2. Obtain an OAuth **access token** for that server. The easiest way to get one
   for setup/testing is the MCP Inspector:
   ```bash
   npx @modelcontextprotocol/inspector
   ```
   - Set **Transport type** to `Streamable HTTP` (or `SSE`).
   - Enter the Zoho MCP server URL from step 1.
   - Click **Open Auth Settings → Quick OAuth Flow**, authorize with your Zoho
     login, and step through until "Authentication complete".
   - Copy the `access_token`. This becomes `ZOHO_BOOKS_MCP_TOKEN`.

> **Token lifetime:** OAuth access tokens expire. For a long-running production
> setup you'll want to script a refresh of `ZOHO_BOOKS_MCP_TOKEN` (Zoho issues a
> refresh token alongside the access token). For getting started, a manually
> pasted token is fine — if Penny suddenly can't reach Books via MCP, refresh
> the token first. The app automatically falls back to REST in the meantime.

### B3. Add the env vars

In **Vercel → Settings → Environment Variables**:

```
ZOHO_BOOKS_MCP_URL=https://<the-url-zoho-gave-you>
ZOHO_BOOKS_MCP_TOKEN=<the-access-token-from-the-inspector>
```

Redeploy. From now on, Penny's runs will drive Zoho Books through the MCP
connector, with the REST snapshot still attached as grounding/fallback.

---

## How the app uses these

- `src/lib/zoho-books.ts` → `getZohoBooksMcpConfig()` returns the MCP server
  config **only when `ZOHO_BOOKS_MCP_URL` is set**; otherwise the code path uses
  the REST snapshot (`fetchBooksSnapshot()`).
- `src/lib/anthropic.ts` → `callClaude({ mcpServers })` passes the server to
  Anthropic's MCP connector (beta header `mcp-client-2025-11-20`) and references
  it with an `mcp_toolset` entry.
- `src/lib/accounting-loop.ts` → wires it all into the worker → CFO cycle.

## Tightening to read-only in code (optional, belt-and-suspenders)

Read-only is already enforced by enabling read tools only in the Zoho admin
(Part B1.4). If you also want to denylist specific write tools in code once you
know their exact names, add a `configs` block to the `mcp_toolset` in
`src/lib/anthropic.ts`, e.g.:

```ts
tools: opts.mcpServers.map((s) => ({
  type: "mcp_toolset",
  mcp_server_name: s.name,
  configs: {
    create_invoice: { enabled: false },
    update_invoice: { enabled: false },
    delete_invoice: { enabled: false },
    // ...any other write/destructive tool names
  },
})),
```

## Quick test checklist

- [ ] Part A done → **Books Health Report** returns real numbers (not the
      "Zoho Books Data Unavailable" diagnostic).
- [ ] `ZOHO_BOOKS_MCP_URL` set → a Penny run shows MCP tool activity (and still
      works if the token is removed, via REST fallback).
- [ ] No write tools enabled in Zoho → Penny only ever *proposes*.

## References

- Zoho Books MCP help: https://www.zoho.com/in/books/help/mcp/zoho-books-mcp.html
- Zoho MCP overview: https://www.zoho.com/mcp/
- Anthropic MCP connector: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
