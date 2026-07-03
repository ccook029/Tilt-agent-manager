# Brand assets

Drop the real Tilt assets here and they'll flow through the whole app.

- **`tilt-logo.svg`** (or `tilt-logo.png`) — the primary logo shown in the
  header. Currently a placeholder wordmark; replace with the real file.
- Add team crests (e.g. the Komoka crown) here too as PNGs — Phase 3's render
  pipeline composites these over visuals as fixed overlays (never AI-rendered).

The `<Logo>` component (`src/components/Logo.tsx`) points at
`/brand/tilt-logo.svg`. If you drop a PNG instead, update that one path.

Brand colors and fonts live in `src/lib/brand.ts` and `src/app/globals.css`.
