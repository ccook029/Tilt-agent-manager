// Renders page.html frame-by-frame (deterministic seek(t)) to JPEGs.
const { chromium } = require("playwright-core");
const path = require("path");

const FPS = 30;
const DURATION = 18.0;
const FRAMES = Math.round(FPS * DURATION);

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  await page.goto("file://" + path.join(__dirname, "page.html"));
  await page.evaluate(() => document.fonts.ready);
  // Let images decode
  await page.waitForFunction(() =>
    Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0)
  );

  for (let f = 0; f < FRAMES; f++) {
    const t = f / FPS;
    await page.evaluate((tt) => window.seek(tt), t);
    await page.screenshot({
      path: path.join(__dirname, "frames", `f${String(f).padStart(4, "0")}.jpg`),
      type: "jpeg",
      quality: 92,
      clip: { x: 0, y: 0, width: 1080, height: 1350 },
    });
    if (f % 60 === 0) console.log(`frame ${f}/${FRAMES}`);
  }
  await browser.close();
  console.log("done");
})();
