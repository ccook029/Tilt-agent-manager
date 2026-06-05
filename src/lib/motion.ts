// ---------------------------------------------------------------------------
// Shared motion language for the Tilt HQ dashboard.
//
// One easing curve, one set of entrance variants — so every surface animates
// with the same "feel". Keep it tasteful: short durations, ease-out on enter.
// Reduced-motion is handled at the component level via useReducedMotion().
// ---------------------------------------------------------------------------
import type { Variants } from "framer-motion";

// Expo-out-ish: quick start, soft landing. Feels premium, never bouncy.
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Container that reveals its children one after another. */
export const staggerContainer = (stagger = 0.07, delay = 0.04): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stagger, delayChildren: delay },
  },
});

/** Fade + rise used by cards, rows, and metric tiles as they enter. */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT },
  },
};
