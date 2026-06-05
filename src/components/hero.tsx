"use client";

// ---------------------------------------------------------------------------
// Cinematic HQ hero: a mouse-reactive ember field, a glowing floating shield,
// a kinetic word-by-word headline with a red shimmer, and magnetic CTAs.
// Everything degrades gracefully under reduced motion.
// ---------------------------------------------------------------------------
import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import Magnetic from "@/components/magnetic";
import { EASE_OUT } from "@/lib/motion";

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
}

function EmberField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const parent = canvas.parentElement!;
    const resize = () => {
      w = parent.clientWidth;
      h = parent.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const mouse = { x: -9999, y: -9999 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);

    const COUNT = 70;
    const spawn = (initial = false): Ember => {
      const maxLife = 200 + Math.random() * 200;
      return {
        x: Math.random() * w,
        y: initial ? Math.random() * h : h + 10,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -(0.3 + Math.random() * 0.7),
        size: 0.6 + Math.random() * 2,
        life: initial ? Math.random() * maxLife : 0,
        maxLife,
      };
    };
    let embers: Ember[] = Array.from({ length: COUNT }, () => spawn(true));

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < embers.length; i++) {
        const p = embers[i];
        // gentle attraction toward the cursor
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 26000) {
          const f = (1 - d2 / 26000) * 0.06;
          p.vx += (dx / Math.sqrt(d2 + 0.01)) * f;
          p.vy += (dy / Math.sqrt(d2 + 0.01)) * f;
        }
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.life++;
        if (p.life > p.maxLife || p.y < -10) {
          embers[i] = spawn(false);
          continue;
        }
        const t = p.life / p.maxLife;
        const alpha = Math.sin(t * Math.PI) * 0.8;
        const near = d2 < 16000;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = near
          ? `rgba(210,248,255,${alpha})`
          : `rgba(0,214,255,${alpha})`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = "rgba(0,214,255,0.6)";
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 h-full w-full"
    />
  );
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};
const lineUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE_OUT } },
};

export default function Hero() {
  const reduce = useReducedMotion();

  return (
    <section className="relative -mx-6 overflow-hidden px-6 pb-10 pt-14 md:pt-20">
      {/* Ember field */}
      <div className="pointer-events-none absolute inset-0 opacity-90">
        {!reduce && <EmberField />}
      </div>
      {/* Radial floor glow */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-[radial-gradient(ellipse_at_50%_120%,rgba(0,214,255,0.12),transparent_70%)]" />

      <div className="relative flex flex-col items-center text-center">
        {/* Shield */}
        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
          className="relative mb-8"
        >
          <div className="absolute inset-0 -z-10 blur-3xl bg-[radial-gradient(circle,rgba(0,214,255,0.45),transparent_65%)]" />
          <motion.div
            animate={reduce ? undefined : { y: [0, -10, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            <Image
              src="/images/tilt-shield.png"
              alt="Tilt Hockey"
              width={150}
              height={188}
              priority
              className="drop-shadow-[0_0_45px_rgba(0,214,255,0.35)]"
            />
          </motion.div>
        </motion.div>

        {/* Eyebrow */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.05 }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#00d6ff]/30 bg-[#00d6ff]/5 px-3.5 py-1.5"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#00d6ff] tilt-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-300">
            AI-Powered Operations
          </span>
        </motion.div>

        {/* Kinetic headline */}
        <motion.h1
          variants={reduce ? undefined : container}
          initial={reduce ? undefined : "hidden"}
          animate={reduce ? undefined : "show"}
          className="font-display text-6xl font-bold uppercase leading-[0.9] tracking-tight md:text-8xl"
        >
          <motion.span variants={reduce ? undefined : lineUp} className="block text-white">
            Corporate
          </motion.span>
          <motion.span variants={reduce ? undefined : lineUp} className="block text-shimmer">
            Headquarters
          </motion.span>
        </motion.h1>

        {/* Subcopy */}
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.45 }}
          className="mx-auto mt-6 max-w-xl leading-relaxed text-gray-400"
        >
          The team behind Tilt. Each department is powered by an autonomous AI
          agent — delivering analytics, scanning competitors, and designing the
          next generation of hockey equipment.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.6 }}
          className="mt-9 flex items-center gap-4"
        >
          <Magnetic>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-[#00d6ff] px-6 py-3 text-sm font-semibold text-[#06232b] shadow-[0_10px_30px_-10px_rgba(0,214,255,0.7)] transition-colors hover:bg-[#00a6c9]"
            >
              Enter the Dashboard
              <span aria-hidden>→</span>
            </Link>
          </Magnetic>
          <Magnetic strength={0.25}>
            <a
              href="#team"
              className="inline-flex items-center rounded-lg border border-gray-700 px-6 py-3 text-sm font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
            >
              Meet the Team
            </a>
          </Magnetic>
        </motion.div>
      </div>
    </section>
  );
}
