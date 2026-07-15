"use client";

// ---------------------------------------------------------------------------
// PromoBuilder — the Promo Video Builder client component, shared by
// /studio/promo (Design Studio) and /studio/social/promo (Social Studio).
//
// The same deterministic engine that renders the final MP4 frames
// (public/promo-engine/engine.html) runs here in an iframe: edit the JSON cut
// spec on the left, scrub/play the comp on the right. Brand renders and fonts
// are served from public/; shoot footage and stills are not deployed (media
// stays out of git), so those tiles show labelled placeholders — timing,
// copy, and layout preview exactly. Final MP4s (with transition post-FX and
// the sound-design bed) render via CLI: `node build.js specs/<spec>.json`.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import defaultSpec from "../../../../promo-video/specs/tilt-x1-15s.json";

// media that IS deployed — the engine's resolver checks this map first
const WEB_MEDIA_MAP: Record<string, string> = {
  "assets/logo.png": "/brand/tilt-logo.png",
  "assets/shaft.png": "/brand/stick-shaft-white.png",
  "assets/stick-diag.png": "/brand/stick-holo-white.png",
  "assets/x1-holo.png": encodeURI("/brand/X1 Holo 1.png"),
  "assets/holo-white.png": encodeURI("/brand/Holo White.png"),
};

type Scene = { type: string; dur: number; [k: string]: unknown };
type Spec = { name?: string; scenes: Scene[]; transitions?: string[]; [k: string]: unknown };

export default function PromoBuilder({
  crumb = { href: "/studio", label: "Design Studio", tag: "Native" },
}: {
  crumb?: { href: string; label: string; tag: string };
}) {
  const [specText, setSpecText] = useState(() => JSON.stringify(defaultSpec, null, 2));
  const [spec, setSpec] = useState<Spec>(defaultSpec as unknown as Spec);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState(0.35);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTick = useRef<number>(0);

  const duration = useMemo(
    () => spec.scenes.reduce((a, s) => a + (Number(s.dur) || 0), 0),
    [spec]
  );
  const sceneStarts = useMemo(() => {
    const out: { t: number; label: string }[] = [];
    let acc = 0;
    for (const s of spec.scenes) {
      out.push({ t: acc, label: s.type });
      acc += Number(s.dur) || 0;
    }
    return out;
  }, [spec]);

  const pushSpec = useCallback((s: Spec) => {
    const win = iframeRef.current?.contentWindow as
      | (Window & { initEngine?: (sp: unknown) => void; seek?: (x: number) => void; SPEC?: unknown })
      | null;
    if (!win) return false;
    const webSpec = { ...s, map: WEB_MEDIA_MAP, baseUrl: "" };
    if (win.initEngine) {
      win.initEngine(webSpec);
      win.seek?.(0);
      return true;
    }
    win.postMessage({ type: "tilt-promo-spec", spec: webSpec }, "*");
    return false;
  }, []);

  // The iframe usually finishes loading before React hydrates (so onLoad never
  // fires) — poll until the engine is up and has the current spec.
  useEffect(() => {
    const iv = setInterval(() => {
      const win = iframeRef.current?.contentWindow as (Window & { SPEC?: unknown }) | null;
      if (win && win.SPEC) { clearInterval(iv); return; }
      pushSpec(spec);
    }, 250);
    return () => clearInterval(iv);
  }, [spec, pushSpec]);

  const seek = useCallback((tt: number) => {
    const win = iframeRef.current?.contentWindow as
      | (Window & { seek?: (x: number) => void })
      | null;
    win?.seek?.(tt);
  }, []);

  // apply editor -> live spec
  const apply = useCallback(() => {
    try {
      const parsed = JSON.parse(specText) as Spec;
      if (!Array.isArray(parsed.scenes) || !parsed.scenes.length)
        throw new Error("spec.scenes must be a non-empty array");
      const nCuts = parsed.scenes.length - 1;
      if (parsed.transitions && parsed.transitions.length !== nCuts)
        throw new Error(`transitions has ${parsed.transitions.length} entries; needs ${nCuts} (one per cut)`);
      setSpec(parsed);
      setError(null);
      setT(0);
      pushSpec(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [specText, pushSpec]);

  // playback loop
  useEffect(() => {
    if (!playing) return;
    lastTick.current = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastTick.current) / 1000;
      lastTick.current = now;
      setT((prev) => {
        const next = prev + dt;
        return next >= duration ? 0 : next;
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, duration]);

  useEffect(() => {
    seek(t);
  }, [t, seek]);

  // fit the 1080x1350 stage to the holder width
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1080));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-600">
            <Link href={crumb.href} className="hover:text-gray-400">{crumb.label}</Link> / {crumb.tag}
          </p>
          <h1 className="text-3xl font-semibold">Promo Video Builder</h1>
          <p className="text-gray-500 mt-1 max-w-3xl">
            Edit the JSON cut spec, hit Apply, and scrub the comp — this is the
            exact engine the final render uses, live in your browser. Footage
            and shoot stills aren&apos;t deployed to the web (media stays out of
            git), so those tiles show labelled placeholders; type scenes and
            product renders preview pixel-exact.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* spec editor */}
        <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-wider text-gray-400">Cut spec</h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSpecText(JSON.stringify(defaultSpec, null, 2));
                  setError(null);
                }}
                className="text-xs rounded-lg border border-gray-700 px-3 py-1.5 text-gray-400 hover:border-gray-500"
              >
                Reset
              </button>
              <button
                onClick={apply}
                className="text-xs rounded-lg bg-[#00d6ff] px-4 py-1.5 font-semibold text-black hover:bg-[#7be9ff]"
              >
                Apply
              </button>
            </div>
          </div>
          {error && (
            <p className="text-xs text-red-400 border border-red-900/60 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <textarea
            value={specText}
            onChange={(e) => setSpecText(e.target.value)}
            spellCheck={false}
            className="w-full h-[560px] rounded-xl bg-black/60 border border-gray-800 p-3 font-mono text-[11px] leading-relaxed text-gray-300 focus:outline-none focus:border-[#00d6ff]/60"
          />
          <p className="text-xs text-gray-600 leading-relaxed">
            Scene types: typeOpen, footage, macroPan, productStills, typeWall,
            stillsWall, hero, endCard. <code>|text|</code> renders that span in
            Tilt cyan. One transition per cut: glitch / rgbsplit / zoomblur /
            none. Full reference: <code>promo-video/README.md</code>.
          </p>
        </div>

        {/* preview */}
        <div className="rounded-2xl border border-gray-800/80 bg-[#101010]/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-wider text-gray-400">
              Preview — {spec.name || "untitled"} · {duration.toFixed(1)}s · 1080×1350
            </h2>
            <span className="text-[10px] uppercase tracking-wider border rounded-full px-2 py-0.5 text-[#00d6ff] border-cyan-900/60">
              Live engine
            </span>
          </div>

          <div ref={holderRef} className="w-full rounded-xl overflow-hidden border border-gray-800 bg-black">
            <div style={{ height: 1350 * scale }}>
              <iframe
                ref={iframeRef}
                src="/promo-engine/engine.html"
                title="Promo engine preview"
                onLoad={() => {
                  pushSpec(spec);
                  seek(t);
                }}
                style={{
                  width: 1080,
                  height: 1350,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  border: 0,
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="rounded-lg bg-[#00d6ff] px-4 py-1.5 text-sm font-semibold text-black hover:bg-[#7be9ff] w-20"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.001)}
              step={1 / 30}
              value={t}
              onChange={(e) => {
                setPlaying(false);
                setT(Number(e.target.value));
              }}
              className="flex-1 accent-[#00d6ff]"
            />
            <span className="text-xs text-gray-500 tabular-nums w-24 text-right">
              {t.toFixed(2)}s / {duration.toFixed(1)}s
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {sceneStarts.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setPlaying(false);
                  setT(s.t + 0.6);
                }}
                className="text-[10px] uppercase tracking-wider rounded-full border border-gray-800 px-2 py-0.5 text-gray-500 hover:text-[#00d6ff] hover:border-cyan-900"
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-gray-800 bg-black/40 p-3 text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-300 font-semibold">Render the finished MP4</span>{" "}
            (with glitch/RGB-split/zoom-blur cut treatment and the sound-design
            bed — preview shows scenes only):
            <pre className="mt-1 text-[11px] text-gray-400 overflow-x-auto">
              cd promo-video && node build.js specs/tilt-x1-15s.json
            </pre>
            Outputs the 4:5 master, a 9:16 reframe, and a poster frame. Media
            staging (WorkDrive footage/stills) is documented in
            promo-video/README.md; the Tilt Design Agent knows this tool via
            its Tool Handoff registry.
          </div>
        </div>
      </div>
    </div>
  );
}
