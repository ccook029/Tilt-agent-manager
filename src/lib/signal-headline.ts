// ---------------------------------------------------------------------------
// signal-headline.ts — distill an agent's long report into a one-line headline
// for the shared signals feed. Cheap + deterministic (no model call): prefer
// the first content line that carries a number, else the first real sentence.
// ---------------------------------------------------------------------------
export function headlineFrom(report: string, max = 180): string {
  const clean = (l: string) =>
    l
      .replace(/^#{1,6}\s*/, "") // markdown header
      .replace(/\*\*/g, "") // bold
      .replace(/`/g, "") // code ticks
      .replace(/^[-*+]\s+/, "") // list bullet (space required, so it won't eat bold)
      .replace(/^[*_~\s]+/, "") // any leftover leading emphasis/space
      .trim();

  const lines = report.split("\n");
  let first = "";
  for (const raw of lines) {
    const c = clean(raw);
    if (!c) continue;
    // Skip pure markdown headers that carry no data.
    if (/^#{1,6}\s/.test(raw.trim()) && !/\d/.test(c)) continue;
    if (!first) first = c; // remember the first content line as a fallback
    if (/\d/.test(c)) return c.slice(0, max); // prefer a line with a number
  }
  return (first || report.trim()).slice(0, max);
}
