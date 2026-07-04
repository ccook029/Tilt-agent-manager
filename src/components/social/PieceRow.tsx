import type { PostWithAsset } from "@/lib/social/queries";

const PLATFORM_SHORT: Record<string, string> = {
  instagram: "IG",
  tiktok: "TT",
  facebook: "FB",
};

/** One content piece = one slot (date + pillar) with its platform variants. */
export type Piece = {
  date: string;
  pillar: string;
  format: string | null;
  variants: PostWithAsset[];
};

export function groupPieces(posts: PostWithAsset[]): Piece[] {
  const map = new Map<string, Piece>();
  for (const p of posts) {
    if (!p.scheduledDate) continue;
    const key = `${p.scheduledDate}|${p.pillar}`;
    const piece = map.get(key) ?? {
      date: p.scheduledDate,
      pillar: p.pillar,
      format: p.format,
      variants: [],
    };
    piece.variants.push(p);
    map.set(key, piece);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Compact row for a content piece: thumbnail, slot info, per-platform status. */
export function PieceRow({ piece, showDay = true }: { piece: Piece; showDay?: boolean }) {
  const thumb =
    piece.variants.find((v) => v.renderUrl && !v.renderUrl.split("?")[0].endsWith(".mp4"))
      ?.renderUrl ?? null;
  const photo = piece.variants.find((v) => v.assetType === "photo")?.assetUrl ?? null;
  const img = thumb ?? photo;
  const approved = piece.variants.filter(
    (v) => v.status === "approved" || v.status === "published",
  ).length;
  const total = piece.variants.length;

  return (
    <div className="locked-piece">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="locked-piece__thumb" src={img} alt="" />
      ) : (
        <div className="locked-piece__thumb locked-piece__thumb--empty">
          {piece.format === "reel" ? "🎬" : "—"}
        </div>
      )}
      <div className="locked-piece__meta">
        <div className="locked-piece__top">
          {showDay && <span className="locked-piece__day">{formatDay(piece.date)}</span>}
          <span className="chip cyan">{piece.pillar}</span>
          {piece.format && <span className="chip">{piece.format}</span>}
        </div>
        <div className="locked-piece__platforms">
          {piece.variants.map((v) => (
            <span key={v.id} className={`status status--${v.status}`}>
              {PLATFORM_SHORT[v.platform] ?? v.platform}
              {v.status === "approved" || v.status === "published" ? " ✓" : ""}
            </span>
          ))}
        </div>
      </div>
      <span className={`status ${approved === total ? "status--approved" : "status--needs_review"}`}>
        {approved}/{total} approved
      </span>
    </div>
  );
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
