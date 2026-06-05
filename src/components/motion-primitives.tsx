"use client";

// ---------------------------------------------------------------------------
// Small motion building blocks shared across pages.
//
// <Stagger> reveals its <StaggerItem> children in sequence on mount.
// Both collapse to plain divs when the user prefers reduced motion, so the
// content is always present and accessible — motion is purely additive.
// ---------------------------------------------------------------------------
import { motion, useReducedMotion } from "framer-motion";
import { fadeRise, staggerContainer } from "@/lib/motion";

interface StaggerProps {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}

export function Stagger({ children, className, stagger, delay }: StaggerProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={staggerContainer(stagger, delay)}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps {
  children: React.ReactNode;
  className?: string;
}

export function StaggerItem({ children, className }: StaggerItemProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={fadeRise}>
      {children}
    </motion.div>
  );
}
