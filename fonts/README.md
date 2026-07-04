# Bundled fonts

These TTFs are shipped with the app so the **code-composited graphics**
(announcements, fundraiser/sock flyers, studio renders) can typeset text in
serverless environments that have **no system fonts installed** (e.g. Vercel
functions). Without them, `sharp`/librsvg renders every glyph as an empty
"tofu" box. See `src/lib/render/fonts.ts` for how they're registered with
fontconfig at runtime, and `next.config.ts` for how they're traced into the
serverless bundle.

## Barlow Condensed

- Family: **Barlow Condensed** (the TILT brand display font)
- Weights bundled: Regular (400), Medium (500), SemiBold (600), Bold (700),
  ExtraBold (800)
- Designer: Jeremy Tribby
- License: **SIL Open Font License 1.1** — free to bundle and redistribute
- Source: https://fonts.google.com/specimen/Barlow+Condensed
