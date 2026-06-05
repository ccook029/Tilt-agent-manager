"use client";

// ---------------------------------------------------------------------------
// CountUp — animates a number from 0 to `value` the first time it scrolls into
// view. Honors prefers-reduced-motion (snaps straight to the final value).
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

interface CountUpProps {
  value: number;
  /** Animation duration in seconds. */
  duration?: number;
  /** Format the (possibly fractional) in-flight number for display. */
  format?: (n: number) => string;
  className?: string;
}

export function CountUp({
  value,
  duration = 1.2,
  format,
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce || duration <= 0) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduce]);

  const text = format
    ? format(display)
    : Math.round(display).toLocaleString();

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
