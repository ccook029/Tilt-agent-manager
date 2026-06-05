"use client";

// Page transition — every route mounts through this, giving a soft fade-up
// as you navigate. (App Router re-renders template.tsx on each navigation.)
import { motion } from "framer-motion";
import { EASE_OUT } from "@/lib/motion";

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
