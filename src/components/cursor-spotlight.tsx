"use client";

// ---------------------------------------------------------------------------
// CursorSpotlight — a soft red light that trails the pointer across the whole
// app (screen blend, so it gently lifts whatever it passes over). Skipped on
// touch devices and under reduced-motion.
// ---------------------------------------------------------------------------
import { useEffect, useRef } from "react";

export default function CursorSpotlight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 2;
    let cx = tx;
    let cy = ty;

    const loop = () => {
      cx += (tx - cx) * 0.16;
      cy += (ty - cy) * 0.16;
      el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      if (Math.abs(tx - cx) > 0.4 || Math.abs(ty - cy) > 0.4) {
        raf = requestAnimationFrame(loop);
      } else {
        raf = 0;
      }
    };
    const move = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      el.style.opacity = "1";
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const leave = () => {
      el.style.opacity = "0";
    };

    window.addEventListener("pointermove", move);
    document.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[55] opacity-0 mix-blend-screen transition-opacity duration-500 will-change-transform"
    >
      <div
        className="-ml-[300px] -mt-[300px] h-[600px] w-[600px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(0,214,255,0.12), rgba(0,214,255,0.04) 35%, transparent 62%)",
        }}
      />
    </div>
  );
}
