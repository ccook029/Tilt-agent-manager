"use client";

// ---------------------------------------------------------------------------
// Lightweight canvas confetti. <Confetti/> mounts a full-screen canvas in the
// root layout and listens for a window event; call fireConfetti() from anywhere
// (e.g. after a successful agent run) to set it off. No-ops under reduced motion.
// ---------------------------------------------------------------------------
import { useEffect, useRef } from "react";

const EVENT = "tilt:confetti";

export function fireConfetti() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  life: number;
}

export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const colors = ["#00d6ff", "#ffffff", "#7be9ff", "#00a6c9", "#9aa0a6"];
    let particles: Particle[] = [];
    let raf = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles = particles.filter((p) => p.life > 0 && p.y < canvas.height + 40);
      for (const p of particles) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.006;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (particles.length > 0) {
        raf = requestAnimationFrame(loop);
      } else {
        cancelAnimationFrame(raf);
        raf = 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    const burst = () => {
      if (reduce) return;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight * 0.3;
      for (let i = 0; i < 150; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 9;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 4,
          g: 0.18 + Math.random() * 0.1,
          size: 4 + Math.random() * 5,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: colors[i % colors.length],
          life: 1,
        });
      }
      if (!raf) raf = requestAnimationFrame(loop);
    };

    window.addEventListener(EVENT, burst);
    return () => {
      window.removeEventListener(EVENT, burst);
      window.removeEventListener("resize", resize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[150]"
    />
  );
}
