"use client";

// ---------------------------------------------------------------------------
// HqVoiceLauncher — the default "walk in and talk" entry point.
//
// A floating button that opens hands-free Voice Mode landing on Reese, your
// Chief of Staff (whole-company view), with Sterling (CFO) one tap away via the
// in-overlay switcher. Both stream through /api/agents/voice-chat.
// ---------------------------------------------------------------------------
import { useState } from "react";
import CarVoiceMode, { type VoiceAgent } from "@/components/voice/car-voice-mode";

// Order matters — the FIRST is the default you land on.
const VOICES: VoiceAgent[] = [
  { agentId: "chief-of-staff", agentName: "Reese" },
  { agentId: "sterling", agentName: "Sterling" },
];

export default function HqVoiceLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Talk to your team, hands-free — starts with Reese, your Chief of Staff"
        aria-label="Open voice mode"
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-[#00d6ff] px-5 py-3.5 text-sm font-semibold text-black shadow-lg shadow-[#00d6ff]/20 transition-transform hover:bg-[#33e0ff] active:scale-95"
      >
        <span className="text-lg leading-none">🎙</span> Talk to HQ
      </button>
      {open && <CarVoiceMode voices={VOICES} onClose={() => setOpen(false)} />}
    </>
  );
}
