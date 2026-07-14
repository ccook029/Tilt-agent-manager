# Tilt Design Portal

A standalone, Tilt-branded Gemini portal for the design team. It works like
normal Gemini — chat, upload images, generate and edit designs with Nano
Banana (Gemini's image model) — but lives on a Tilt site behind a shared
passcode, so the designer never needs their own Gemini account. The Gemini
"brains" are ported from the agent manager's Social Studio
(`src/lib/social/render/nano.ts`).

## Features

- **Per-user login** — users are `email:password` pairs in the
  `PORTAL_USERS` env var (no database); a shared `PORTAL_PASSCODE` also
  works as a fallback. Sessions are 30-day signed httpOnly cookies. The
  portal fails closed until at least one login is configured.
- **Design mode (Nano Banana)** — text-to-image and image editing with the
  Gemini image model, with an aspect-ratio picker (1:1, 4:5, 3:4, 16:9, 9:16).
- **Chat mode** — plain Gemini text chat for briefs, copy, and ideas.
- **Uploads** — attach button, drag & drop anywhere, or paste from the
  clipboard. Big images are downscaled client-side before sending.
- **Iterate on results** — every generated image has **Download** and
  **Edit this** (feeds it back as the source for the next prompt).
- **Conversations** — saved in the browser (IndexedDB), with a sidebar to
  switch, resume, and delete chats. Nothing is stored server-side.

## Deploy on Vercel

This app is intentionally its own deployment, separate from the agent
manager, so the designer only ever gets access to this portal.

1. In Vercel, **Add New → Project** and import the `Tilt-agent-manager` repo
   (again — it's fine to have two projects on one repo).
2. Set **Root Directory** to `designer-portal`.
3. Add environment variables:

   | Variable | Required | Notes |
   | --- | --- | --- |
   | `GEMINI_API_KEY` | ✅ | Same Google AI key the agent manager uses |
   | `PORTAL_USERS` | ✅ | `email:password` pairs, comma-separated — e.g. `gino@example.com:long-password` |
   | `PORTAL_PASSCODE` | optional | Shared team passcode that works alongside `PORTAL_USERS` |
   | `PORTAL_SESSION_SECRET` | recommended | Dedicated cookie-signing secret; rotate to force re-login |
   | `GEMINI_IMAGE_MODEL` | optional | Default `gemini-3-pro-image-preview` |
   | `GEMINI_TEXT_MODEL` | optional | Default `gemini-2.5-flash` |
   | `GEMINI_API_BASE` | optional | Default `https://generativelanguage.googleapis.com/v1beta` |

4. Deploy, then optionally attach a domain like `design.tilthockey.com`.
5. Send the designer the URL + their email/password. That's it — no Google
   account needed on their side. To revoke access, remove their entry from
   `PORTAL_USERS` and rotate `PORTAL_SESSION_SECRET`.

## Local development

```bash
cd designer-portal
npm install
cp .env.example .env.local   # fill in GEMINI_API_KEY + PORTAL_USERS
npm run dev
```

## Notes

- **Costs**: every Design-mode message calls the Gemini image model on your
  API key. If credits run out, the portal shows a friendly "top up billing"
  message instead of failing silently.
- **Privacy**: conversations live only in the designer's browser. Clearing
  site data clears their history. The server is a stateless proxy — no
  database, no blob storage.
- **Request size**: history sent to Gemini is trimmed (last 12 messages,
  images only from the last 4) to stay under Vercel's request-body limit.
- **Sessions**: 30 days. Rotate `PORTAL_SESSION_SECRET` (or the credential
  vars) to lock the portal or force everyone to log in again.
