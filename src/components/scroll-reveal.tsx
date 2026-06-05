"use client";

// ---------------------------------------------------------------------------
// ScrollReveal — fade + rise the first time an element scrolls into view.
// ---------------------------------------------------------------------------
import { motion, useReducedMotion } from "framer-motion";
import { EASE_OUT } from "@/lib/motion";

export default function ScrollReveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.6, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}
