// ---------------------------------------------------------------------------
// speakable.ts — turn a chat reply into something that reads well OUT LOUD.
//
// Strips markdown, code fences, and the agent's control blocks (```assign /
// ```webchange / ```json) so text-to-speech doesn't read punctuation soup or
// spell out JSON. Shared by the on-screen "Listen" buttons and the hands-free
// Voice Mode so they speak identically.
// ---------------------------------------------------------------------------

/** Max characters we hand to a TTS provider in one go (keeps latency + cost
 *  bounded; the server route also clamps to 2600). */
const MAX_SPOKEN_CHARS = 2600;

export function speakableText(text: string): string {
  return text
    // Control blocks become a short spoken note, not read verbatim.
    .replace(/```assign[\s\S]*?```/g, " I've drafted that as a work order — it's on your screen to confirm. ")
    .replace(/```webchange[\s\S]*?```/g, " I've drafted that website change — it's on your screen to confirm. ")
    .replace(/```json[\s\S]*?```/g, " ")
    .replace(/```[\s\S]*?```/g, " — the details are on your screen — ")
    // Links → just the visible text.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Headings / emphasis / table pipes → gone.
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SPOKEN_CHARS);
}
