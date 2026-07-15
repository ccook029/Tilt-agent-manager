#!/usr/bin/env node
// Tilt Promo Builder — one command from a cut spec to finished MP4(s).
//
//   node build.js specs/tilt-x1-15s.json
//
// Pipeline: validate spec -> resolve timeline -> render frames (deterministic
// Playwright seek over engine.html) -> transition post-FX (post-fx.py) ->
// sound-design bed (build-audio.py, unless audio.mode==="none" or a track is
// supplied) -> encode 4:5 master (+ optional 9:16 reframe + poster frame).
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const specPath = process.argv[2];
if (!specPath) {
  console.error("usage: node build.js <spec.json>");
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));

// ---- validate + resolve timeline ----
const TYPES = ["typeOpen", "footage", "macroPan", "productStills", "typeWall", "stillsWall", "hero", "endCard"];
if (!Array.isArray(spec.scenes) || !spec.scenes.length) throw new Error("spec.scenes required");
for (const sc of spec.scenes) {
  if (!TYPES.includes(sc.type)) throw new Error(`unknown scene type: ${sc.type}`);
  if (!(sc.dur > 0)) throw new Error(`scene ${sc.type} needs dur > 0`);
  if (sc.type === "footage") {
    if (!sc.shots || !sc.shots.length) throw new Error("footage scene needs shots[]");
    const declared = sc.shots.reduce((a, s) => a + (s.dur || sc.dur), 0);
    if (sc.shots.length > 1 && Math.abs(declared - sc.dur) > 1e-6)
      throw new Error(`footage shots durs (${declared}) must sum to scene dur (${sc.dur})`);
    for (const s of sc.shots)
      if (!fs.existsSync(path.join(ROOT, s.file))) throw new Error(`missing footage: ${s.file}`);
  }
  for (const key of ["image", "logo", "hold", "panelImage"])
    if (sc[key] && !fs.existsSync(path.join(ROOT, sc[key]))) throw new Error(`missing asset: ${sc[key]}`);
  for (const key of ["stills", "flash"])
    if (sc[key]) for (const f of sc[key])
      if (!fs.existsSync(path.join(ROOT, f))) throw new Error(`missing still: ${f}`);
}
const nCuts = spec.scenes.length - 1;
const transitions = spec.transitions || Array(nCuts).fill("none");
if (transitions.length !== nCuts)
  throw new Error(`transitions length ${transitions.length} != scene cuts ${nCuts}`);

const fps = spec.fps || 30;
const starts = [];
let acc = 0;
for (const sc of spec.scenes) { starts.push(acc); acc += sc.dur; }
const DURATION = acc;
const FRAMES = Math.round(DURATION * fps);
const cuts = transitions.map((fx, i) => ({ t: starts[i + 1], fx })).filter((c) => c.fx !== "none");

const resolved = {
  ...spec,
  fps,
  duration: DURATION,
  cuts,
  accents: spec.audio && spec.audio.accents ? spec.audio.accents : null,
};

// ---- workspace ----
const buildDir = path.join(ROOT, "build");
const framesDir = path.join(buildDir, "frames");
fs.mkdirSync(framesDir, { recursive: true });
for (const f of fs.readdirSync(framesDir)) fs.unlinkSync(path.join(framesDir, f));
fs.writeFileSync(path.join(buildDir, "spec.gen.json"), JSON.stringify(resolved, null, 1));

// the engine is shared with the web preview (/studio/promo) and lives in public/
const ENGINE = path.join(ROOT, "..", "public", "promo-engine", "engine.html");
// media in the spec is relative to promo-video/
resolved.baseUrl = "file://" + ROOT + "/";
resolved.fontsBase = "fonts/"; // next to engine.html

const CHROME = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  ...(fs.existsSync("/opt/pw-browsers")
    ? fs.readdirSync("/opt/pw-browsers")
        .filter((d) => d.startsWith("chromium"))
        .map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)
    : []),
].find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile());
if (!CHROME) throw new Error("no Chromium found — set CHROMIUM_PATH");

(async () => {
  console.log(`[build] ${spec.name || path.basename(specPath)} — ${DURATION.toFixed(1)}s, ${FRAMES} frames`);

  // ---- 1. render frames ----
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  await page.addInitScript(`window.SPEC = ${JSON.stringify(resolved)};`);
  await page.goto("file://" + ENGINE);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 60000 }
  );
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("video")).every((v) => v.readyState >= 2),
    { timeout: 120000 }
  );
  for (let f = 0; f < FRAMES; f++) {
    await page.evaluate((tt) => window.seek(tt), f / fps);
    await page.screenshot({
      path: path.join(framesDir, `f${String(f).padStart(4, "0")}.jpg`),
      type: "jpeg", quality: 92,
      clip: { x: 0, y: 0, width: 1080, height: 1350 },
    });
    if (f % 90 === 0) console.log(`[render] frame ${f}/${FRAMES}`);
  }
  await browser.close();

  // ---- 2. transition post-FX ----
  execFileSync("python3", [path.join(ROOT, "post-fx.py"), path.join(buildDir, "spec.gen.json")], { stdio: "inherit" });

  // ---- 3. audio ----
  const audio = spec.audio || { mode: "accents" };
  let audioSrc = null;
  if (audio.track) {
    audioSrc = path.resolve(ROOT, audio.track);
    if (!fs.existsSync(audioSrc)) throw new Error(`missing audio track: ${audio.track}`);
  } else if (audio.mode !== "none") {
    execFileSync("python3", [path.join(ROOT, "build-audio.py"), path.join(buildDir, "spec.gen.json")], { stdio: "inherit" });
    audioSrc = path.join(buildDir, "audio.wav");
  }

  // ---- 4. encode ----
  const FF = require("@ffmpeg-installer/ffmpeg").path;
  const outName = (spec.output && spec.output.file) || `${spec.name || "promo"}.mp4`;
  const out = path.join(ROOT, outName);
  const vArgs = ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(framesDir, "f%04d.jpg")];
  const encArgs = audioSrc
    ? [...vArgs, "-i", audioSrc, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000",
       "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", out]
    : [...vArgs, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out];
  execFileSync(FF, encArgs, { stdio: "inherit" });
  console.log(`[out] ${outName}`);

  // ---- 5. optional 9:16 reframe + poster ----
  if (spec.output && spec.output.vertical) {
    const out916 = out.replace(/\.mp4$/, "-916.mp4");
    execFileSync(FF, ["-y", "-loglevel", "error", "-i", out, "-filter_complex",
      "[0:v]split=2[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=42:2,eq=brightness=-0.28:saturation=0.9[bgb];[fg]scale=1080:1350[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]",
      "-map", "[v]", ...(audioSrc ? ["-map", "0:a", "-c:a", "copy"] : []),
      "-c:v", "libx264", "-crf", "19", "-movflags", "+faststart", out916], { stdio: "inherit" });
    console.log(`[out] ${path.basename(out916)}`);
  }
  if (spec.output && typeof spec.output.posterAt === "number") {
    const poster = out.replace(/\.mp4$/, "-poster.jpg");
    execFileSync(FF, ["-y", "-loglevel", "error", "-i", out, "-ss", String(spec.output.posterAt),
      "-frames:v", "1", "-q:v", "2", poster], { stdio: "inherit" });
    console.log(`[out] ${path.basename(poster)}`);
  }
  console.log("[build] done");
})().catch((e) => { console.error(e); process.exit(1); });
