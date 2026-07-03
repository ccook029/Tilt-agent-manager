// ---------------------------------------------------------------------------
// Social Studio module home — compact replacement for the standalone app's
// landing page (the hub layout + the module sub-nav provide the chrome).
// ---------------------------------------------------------------------------
import Link from "next/link";

// Match the rest of the module (and let the layout's demo banner reflect the
// runtime environment rather than whatever was set at build time).
export const dynamic = "force-dynamic";

export default function SocialStudioHome() {
  return (
    <div className="container">
      <section className="hero">
        <p className="tagline">Tilt Hockey · Social Command Center</p>
        <h1>
          Plan it. Brand it.{" "}
          <span style={{ color: "var(--tilt-cyan)" }}>Go full tilt.</span>
        </h1>
        <p className="sub">
          The content engine keeps a living 6-month plan, writes
          platform-specific copy, and builds branded visuals from the real
          shoot library — every post reviewed by you before it ships. It now
          runs natively inside Tilt HQ.
        </p>
        <div className="btn-row">
          <Link href="/studio/social/posts" className="btn">
            Review the posts
          </Link>
          <Link href="/studio/social/setup" className="btn btn--ghost">
            Setup (no terminal)
          </Link>
        </div>
      </section>

      <div style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: "1.1rem" }}>Build roadmap</h2>
        <ol className="roadmap">
          <li>
            <strong>Asset catalog</strong> — WorkDrive → Blob mirror + vision
            tagging. <span className="badge">done</span>
          </li>
          <li>
            <strong>KB config + planning brain</strong> — 6-month skeleton,
            locked window, per-platform copy, gap report.{" "}
            <span className="badge">done</span>
          </li>
          <li>
            <strong>Static render pipeline</strong> — Nano Banana Pro treats the
            real photo; code composites the TILT logo.{" "}
            <span className="badge">done</span>
          </li>
          <li>
            <strong>Absorbed into Tilt HQ</strong> — one front door, one login,
            signals flow straight into the Morning Brief.{" "}
            <span className="badge">current</span>
          </li>
          <li>Video pipeline (Shotstack)</li>
          <li>Weekly email digest</li>
          <li>Later — scheduled publisher (Meta + TikTok)</li>
        </ol>
      </div>
    </div>
  );
}
