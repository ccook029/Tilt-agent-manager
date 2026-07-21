# Tilt promo video template

The motion-graphics template behind the "TILT X1" launch spot (18s, 1080×1350,
30fps): kinetic Barlow Condensed type, cyan-on-black, macro product close-ups,
name reveal, "Don't be a sheep." end card. Everything is rendered from
`page.html` — a deterministic `seek(t)` drives every animation, so frames are
reproducible.

## Regenerate the video

```bash
cd promo-video
mkdir -p assets frames

# Stage brand assets (transparent PNGs) and fonts from the repo
cp "../public/brand/Holo White.png"        assets/holo-white.png
cp "../public/brand/X1 Holo 1.png"         assets/x1-holo.png
cp "../public/brand/stick-shaft-white.png" assets/shaft.png
cp "../public/brand/stick-holo-white.png"  assets/stick-diag.png
cp "../public/brand/tilt-logo.png"         assets/logo.png
cp ../fonts/BarlowCondensed-{Bold,ExtraBold,Medium}.ttf assets/

npm install playwright-core @ffmpeg-installer/ffmpeg
node render.js   # renders frames/ (uses the sandbox Chromium at /opt/pw-browsers/chromium;
                 # elsewhere, point executablePath in render.js at any Chrome/Chromium)

# Encode
FF=$(node -e "console.log(require('@ffmpeg-installer/ffmpeg').path)")
"$FF" -y -framerate 30 -i frames/f%04d.jpg -c:v libx264 -crf 18 \
  -pix_fmt yuv420p -movflags +faststart tilt-x1.mp4
```

## Make a new video from this template

- **Change copy/scenes**: edit the scene markup + the `seek(t)` scene blocks in
  `page.html`. Scene timing lives in the `CUT1..CUT6/END` constants; update
  `DURATION` in `render.js` to match `END`.
- **Swap in real shoot footage**: replace a graphic scene with a `<video>`
  frame-stepped via `seek` (set `video.currentTime` from `t`), or simply
  render the type scenes here and intercut real clips in an editor. The
  template is deliberately editor-friendly: every scene stands alone.
- **Music**: none is baked in — add a track in the editor and nudge `CUT*`
  values to land cuts on beats.

Brand rules still apply (see `src/lib/social/brand.ts`): real product imagery
only, logo never AI-generated, Tilt cyan `#00BFFF` on black `#0D0D0D`.
