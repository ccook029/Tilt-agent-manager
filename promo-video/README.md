# Tilt Promo Video Builder

Spec-driven motion-graphics video builder. A single JSON cut spec — scenes,
copy, real shoot footage, stills, transitions, audio — renders
deterministically (same spec → same frames) to finished MP4s:

```bash
cd promo-video
node build.js specs/tilt-x1-15s.json
# -> tilt-x1-15s.mp4          1080×1350 4:5 master (IG feed)
# -> tilt-x1-15s-916.mp4      9:16 blurred-bar reframe (Reels/TikTok/Stories)
# -> tilt-x1-15s-poster.jpg   poster/thumbnail frame
```

The pipeline: `build.js` validates the spec and resolves the timeline →
renders every frame via a deterministic `seek(t)` over `engine.html`
(Playwright/Chromium; footage is frame-stepped `<video>`) → `post-fx.py`
treats each cut (glitch / RGB-split / zoom-blur, curves ported from the
open-source [claude-code-video-toolkit](https://github.com/digitalsamba/claude-code-video-toolkit))
→ `build-audio.py` synthesizes a sparse royalty-free sound-design bed (or a
supplied licensed track is used) → ffmpeg encodes, loudness-mastered to
−14 LUFS / 48 kHz.

This is an in-house Tilt Design Studio tool. The Tilt Design Agent is wired
to hand off to it (see `src/agents/tilt-design-agent.config.ts` and
`.claude/skills/promo-builder/SKILL.md` for the agent-facing guide).

**Web version:** `/studio/social/promo` (Social Studio → Promo Video tab, for
the social media team) and `/studio/promo` (Design Studio) both run the same
engine live in the
browser — edit the JSON spec, Apply, and play/scrub the comp. The engine is
shared: `public/promo-engine/engine.html` is used by both this CLI (via
`file://` + injected spec) and the studio page (same-origin iframe). Brand
renders and fonts are deployed; shoot footage/stills are not (media stays out
of git), so those tiles show labelled placeholders on the web — type scenes
and product renders preview pixel-exact, and the final MP4 (with transition
post-FX + audio) always comes from `node build.js`.

## One-time setup

```bash
npm install playwright-core @ffmpeg-installer/ffmpeg   # repo root is fine
pip install pillow numpy
# Chromium: the sandbox build under /opt/pw-browsers is found automatically;
# elsewhere set CHROMIUM_PATH to any Chrome/Chromium binary.
```

## Stage the media (once per machine)

All media lives under `promo-video/` in gitignored folders:

```bash
mkdir -p assets shoot/stills

# Brand assets (transparent PNGs) + fonts from the repo
cp "../public/brand/Holo White.png"        assets/holo-white.png
cp "../public/brand/X1 Holo 1.png"         assets/x1-holo.png
cp "../public/brand/stick-shaft-white.png" assets/shaft.png
cp "../public/brand/stick-holo-white.png"  assets/stick-diag.png
cp "../public/brand/tilt-logo.png"         assets/logo.png
cp ../fonts/BarlowCondensed-{Bold,ExtraBold,Medium}.ttf assets/

# Footage: download clips from the WorkDrive "TILT HOCKEY SHOOT/EXPORTS"
# folder into shoot/ (rename spaces to dashes), then cut the VP9 segments the
# specs reference (the render Chromium has no H.264 decoder):
bash stage-footage.sh

# Stills: pick from the WorkDrive player/PRODUCT/GROUP subfolders, resize to
# <=2000px JPEG, save under shoot/stills/ with the names the spec uses
# (w01..w12.jpg + group.jpg for the wall, pd1..pd3.jpg for product macros).
```

## The spec

Start from `specs/tilt-x1-15s.json`. In big-type fields, `|text|` renders
that span in Tilt cyan.

| Scene type      | What it renders                                            | Key fields |
| --------------- | ---------------------------------------------------------- | ---------- |
| `typeOpen`      | brand open: kicker + two slam lines                        | `kicker`, `line1`, `line2`, `logo` |
| `footage`       | real shoot clips, frame-stepped, graded + vignetted        | `shots[]` (`file`, `in`, `ramp [t1,r1,r2]`, `dur` if multiple), `big`, `callout`, `textPos` |
| `macroPan`      | white product-render macro pan                             | `image`, `big`, `callout` |
| `productStills` | full-bleed product photos, Ken Burns push                  | `stills[]`, `big`, `callout` |
| `typeWall`      | scrolling type rows + skewed panel + diagonal product      | `rows[]` (`text`, `style: dim|white|hot`), `panelImage` |
| `stillsWall`    | rapid duotone flash stills → full-colour hold + tagline    | `flash[]`, `hold`, `big`, `callout`, `flashDur` |
| `hero`          | product hero fly-in + name reveal                          | `image`, `chip`, `name`, `sub` |
| `endCard`       | logo, optional tagline, CTA chip, handle                   | `logo`, `tag`, `cta`, `handle` |

- `transitions[]` — one per cut: `glitch`, `rgbsplit`, `zoomblur`, or `none`.
  Effects peak at the cut midpoint and are seeded per frame (reproducible).
- `audio` — `{"mode":"accents","hits":[s,...]}` synthesizes the sparse bed
  (riser + sub-boom per cut, whoosh on zoom cuts, crash into the last cut,
  thumps at `hits`). It is deliberately not music — no beat, no melody,
  nothing to license. `{"mode":"none"}` renders silent;
  `{"track":"file.wav"}` muxes a licensed track instead.
- `output` — `{"file":"name.mp4","vertical":true,"posterAt":seconds}`.
- Speed ramps: `"ramp": [t1, r1, r2]` plays the source at `r1`× for the first
  `t1` seconds of scene time, then `r2`× (e.g. slow-mo deke → full-speed snap).
  Keep `in + ramped source time` inside the staged segment length (2.0s).

## Brand guardrails

Hard rules from `src/lib/social/brand.ts` apply to every cut: real footage
and photos only (never AI-generate players or product), the logo is a fixed
PNG composited by code, Tilt cyan `#00BFFF` on black `#0D0D0D`, Barlow
Condensed display type, no internal pricing/costs, Tilt Hockey only.
Real product tech terms: **Response Rezin**, **Tilt Core Energy Spine**.
Tagline: **"Don't be a sheep."**

## Verifying a build

Frames land in `build/frames/` — sample a few (`f0000.jpg`…) to check copy
and crops before shipping; `build/spec.gen.json` is the resolved timeline
(cut times) the FX and audio passes consumed.
