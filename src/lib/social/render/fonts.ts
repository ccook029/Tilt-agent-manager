import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Serverless font bootstrap.
 *
 * All of our code-composited graphics (flyer.ts, announce/compose.ts) typeset
 * text as SVG `<text>` and let libvips/librsvg lay it out via fontconfig. On a
 * normal machine that Just Works, but Vercel's serverless runtime ships with NO
 * fonts installed — not even a generic sans fallback — so every glyph renders
 * as a "tofu" box (□□□□).
 *
 * Fix: we bundle the brand font (Barlow Condensed, `/fonts/*.ttf`, included in
 * the serverless trace via next.config) and point fontconfig at it by writing a
 * tiny config to /tmp and exporting FONTCONFIG_FILE. This module MUST be
 * imported before any text is rendered; importing it for its side effect (see
 * flyer.ts / announce/compose.ts) sets the env var while fontconfig is still
 * un-initialized, so the first render already sees the bundled font.
 */

/** Absolute path to the bundled font directory (traced into the deployment). */
export const FONTS_DIR = join(process.cwd(), "fonts");

let bootstrapped = false;

function bootstrapFonts(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    const cacheDir = join(tmpdir(), "tilt-fontcache");
    mkdirSync(cacheDir, { recursive: true });
    const confPath = join(tmpdir(), "tilt-fonts.conf");
    // Map the generic families the SVGs request onto the bundled brand font so
    // that even a fallback lookup ("sans-serif", "Arial") still resolves.
    const conf =
      `<?xml version="1.0"?>\n` +
      `<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n` +
      `<fontconfig>\n` +
      `  <dir>${FONTS_DIR}</dir>\n` +
      `  <cachedir>${cacheDir}</cachedir>\n` +
      `  <match target="pattern">\n` +
      `    <test name="family"><string>sans-serif</string></test>\n` +
      `    <edit name="family" mode="prepend" binding="strong"><string>Barlow Condensed</string></edit>\n` +
      `  </match>\n` +
      `</fontconfig>\n`;
    writeFileSync(confPath, conf);
    // Only set it if nothing else already configured fontconfig for us.
    if (!process.env.FONTCONFIG_FILE) process.env.FONTCONFIG_FILE = confPath;
  } catch {
    /* best-effort: on a machine with system fonts this is a no-op anyway */
  }
}

bootstrapFonts();
