---
name: promo-builder
description: "Tilt Promo Video Builder — build branded motion-graphics promo videos (MP4) from a JSON cut spec. Actions: create, edit, re-cut, retime, re-copy promo/social videos from real shoot footage + stills + brand type scenes. Scene types: typeOpen, footage, macroPan, productStills, typeWall, stillsWall, hero, endCard. Transitions: glitch, rgbsplit, zoomblur. Outputs 1080x1350 (IG 4:5) master + optional 9:16 reframe + poster frame, with a synthesized royalty-free sound-design bed or a supplied licensed track. Use for: promo video, launch spot, social video, video ad, recut, X1 spot."
---

# Tilt Promo Video Builder

Spec-driven video builder in `promo-video/`. A single JSON file describes the
cut — scenes, copy, footage segments, stills, transitions, audio — and
`build.js` renders the finished MP4(s) deterministically (same spec → same
frames). Built for the Tilt design workflow: art-direct by editing JSON, not
timelines.

## Web preview

`/studio/social/promo` (Social Studio tab) and `/studio/promo` (Design Studio)
run the same engine in the browser: paste/edit the
spec, Apply, scrub. Shoot media isn't deployed, so those tiles show labelled
placeholders there — final renders and full-fidelity checks happen via the CLI
below.

## Build a video

```bash
cd promo-video
node build.js specs/tilt-x1-15s.json
# -> tilt-x1-15s.mp4 (1080x1350 4:5 master)
# -> tilt-x1-15s-916.mp4 (9:16 blurred-bar reframe, if output.vertical)
# -> tilt-x1-15s-poster.jpg (if output.posterAt)
```

One-time setup per machine: `npm install playwright-core @ffmpeg-installer/ffmpeg`
and `pip install pillow numpy`. Footage/stills staging is documented in
`promo-video/README.md` (WorkDrive → `shoot/`, `stage-footage.sh` cuts VP9
segments because the render Chromium has no H.264 decoder).

## The spec (start from `specs/tilt-x1-15s.json`)

- `scenes[]` — ordered; each has `type`, `dur` (seconds), and type-specific
  fields. In big-type fields, `|text|` renders that span in Tilt cyan.
  - `typeOpen` — kicker + two slam lines (brand open).
  - `footage` — real shoot clips, frame-stepped `<video>`; `shots[]` each with
    `file` (VP9 webm segment), `in` (source offset), optional `ramp`
    `[t1, r1, r2]` = play at `r1`x speed for `t1`s of scene time then `r2`x
    (slow-mo → snap). Optional `big`, `callout`, `textPos: "top"|"bottom"`.
  - `macroPan` — white product-render macro pan (`image`), `big`, `callout`.
  - `productStills` — full-bleed product photos with Ken Burns push;
    `stills[]`, `big`, `callout`.
  - `typeWall` — scrolling Lighter/Faster/Meaner rows + skewed panel.
  - `stillsWall` — rapid duotone flash stills (`flash[]`) ending on a
    full-colour `hold` still with `big` + `callout`.
  - `hero` — product hero fly-in (`image`, `chip`, `name`, `sub`).
  - `endCard` — logo + optional `tag`, `cta` chip, `handle`.
- `transitions[]` — one per cut (`scenes.length - 1`): `glitch`, `rgbsplit`,
  `zoomblur`, or `none`.
- `audio` — `{ "mode": "accents", "hits": [s, ...] }` for the synthesized
  sound-design bed (risers + sub-boom impacts on cuts, whooshes on zoom cuts,
  crash into the last cut, thumps at `hits`; deliberately not music, nothing
  to license), `{ "mode": "none" }` for silent, or `{ "track": "path.wav" }`
  to mux a licensed track. Output is loudness-mastered to −14 LUFS.
- `output` — `{ "file": "name.mp4", "vertical": true, "posterAt": seconds }`.

## Brand guardrails (enforced by src/lib/social/brand.ts — do not violate)

- Real assets only: footage/stills come from the shoot library; never
  AI-generate players or product. The logo is a fixed PNG, never regenerated.
- Tilt cyan `#00BFFF` on black `#0D0D0D`; Barlow Condensed display type.
- Product tech naming that is real: "Response Rezin", "Tilt Core Energy
  Spine". No invented buzzword tech names.
- Tagline: "Don't be a sheep." CTA: Shop the X1 → tilthockey.com / @tilthockey.
- Never expose internal costs/margins/wholesale; Tilt Hockey content only.

## Verify before delivering

Sample frames from `build/frames/` (e.g. every ~60th) and eyeball copy,
legibility, and crops; probe the MP4 duration/streams with ffprobe. The
render is deterministic, so a re-run after a spec tweak only changes what
you edited.
