"use client";

// ---------------------------------------------------------------------------
// IntroOverlay — a brief branded shield reveal on first load of a session.
// Shows once per session (sessionStorage) and is skipped under reduced motion.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export default function IntroOverlay() {
  const reduce = useReducedMotion();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (sessionStorage.getItem("tilt.intro.seen")) return;
    sessionStorage.setItem("tilt.intro.seen", "1");
    setShow(true);
    const t = setTimeout(() => setShow(false), 1500);
    return () => clearTimeout(t);
  }, []);

  if (reduce) return null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-[#0a0a0a]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,214,255,0.12),transparent_60%)]" />
          <motion.div
            initial={{ scale: 0.8, opacity: 0, filter: "blur(8px)" }}
            animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <div className="absolute inset-0 -z-10 blur-3xl bg-[radial-gradient(circle,rgba(0,214,255,0.5),transparent_65%)]" />
            <Image
              src="/images/tilt-shield.png"
              alt="Tilt Hockey"
              width={120}
              height={150}
              priority
              className="drop-shadow-[0_0_45px_rgba(0,214,255,0.4)]"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
