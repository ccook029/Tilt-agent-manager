import Link from "next/link";
import { getCatalogStats, listAssets } from "@/lib/social/queries";
import type { Asset } from "@/lib/social/db/schema";

export const dynamic = "force-dynamic";

type Search = { [key: string]: string | string[] | undefined };

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const typeFilter =
    params.type === "photo" || params.type === "video"
      ? (params.type as "photo" | "video")
      : undefined;

  let stats: Awaited<ReturnType<typeof getCatalogStats>> | null = null;
  let rows: Asset[] = [];
  let error: string | null = null;

  try {
    [stats, rows] = await Promise.all([
      getCatalogStats(),
      listAssets({ type: typeFilter }),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="container">
      <p className="tagline">Library</p>
      <h1>Asset Catalog</h1>
      <p style={{ color: "var(--tilt-muted)" }}>
        Verify tagging quality before the planning brain starts matching assets
        to posts.
      </p>

      {error ? (
        <div className="empty">
          <p>Could not load the catalog.</p>
          <p style={{ fontSize: "0.8rem" }}>{error}</p>
          <p>
            Set <code>DATABASE_URL</code>, then initialize and sync from{" "}
            <Link href="/studio/social/setup">Setup</Link>.
          </p>
        </div>
      ) : (
        <>
          {stats && (
            <div className="stats">
              <Stat num={stats.total} label="Total" />
              <Stat num={stats.photos} label="Photos" />
              <Stat num={stats.videos} label="Videos" />
              <Stat num={stats.tagged} label="Tagged" />
              <Stat num={stats.untagged} label="Untagged" />
            </div>
          )}

          <div className="filters">
            <FilterLink label="All" href="/studio/social/catalog" active={!typeFilter} />
            <FilterLink
              label="Photos"
              href="/studio/social/catalog?type=photo"
              active={typeFilter === "photo"}
            />
            <FilterLink
              label="Videos"
              href="/studio/social/catalog?type=video"
              active={typeFilter === "video"}
            />
          </div>

          {rows.length === 0 ? (
            <div className="empty">
              <p>No assets yet.</p>
              <p>
                Run a sync from <Link href="/studio/social/setup">Setup</Link>{" "}
                to mirror the WorkDrive library and tag it.
              </p>
            </div>
          ) : (
            <div className="grid">
              {rows.map((a) => (
                <AssetCard key={a.id} asset={a} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ num, label }: { num: number; label: string }) {
  return (
    <div className="stat">
      <div className="num">{num}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link href={href} className={active ? "active" : ""}>
      {label}
    </Link>
  );
}

const PILLAR_NAMES: Record<number, string> = {
  1: "Proof",
  2: "Sheep",
  3: "Athletes",
  4: "Product",
  5: "Community",
  6: "Fit",
};

function AssetCard({ asset }: { asset: Asset }) {
  const tags = asset.tags ?? {};
  return (
    <div className="card">
      <div className="media">
        {asset.type === "photo" && asset.blobUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.blobUrl} alt={tags.description ?? asset.filename} />
        ) : asset.type === "video" ? (
          <div className="video-badge">▶ Video</div>
        ) : (
          <div className="placeholder">No preview</div>
        )}
      </div>
      <div className="body">
        <div className="filename">{asset.filename}</div>
        {tags.description && <div className="desc">{tags.description}</div>}
        <div className="tags">
          {!asset.taggedAt && <span className="chip warn">untagged</span>}
          {tags.action && <span className="chip">{tags.action}</span>}
          {tags.product && <span className="chip">{tags.product}</span>}
          {tags.person && <span className="chip">{tags.person}</span>}
          {tags.setting && <span className="chip">{tags.setting}</span>}
          {(tags.pillars ?? []).map((p) => (
            <span key={p} className="chip cyan">
              {PILLAR_NAMES[p] ?? `P${p}`}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
