import { listGaps } from "@/lib/social/queries";
import { isDemoMode } from "@/lib/social/demo-data";
import { adminTokenConfigured } from "@/lib/social/admin-auth";
import type { Gap } from "@/lib/social/db/schema";
import GapsBoard from "./GapsBoard";

export const dynamic = "force-dynamic";

export default async function GapsPage() {
  let gaps: Gap[] = [];
  let error: string | null = null;
  try {
    gaps = await listGaps();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="container">
        <p className="tagline">First-class deliverable</p>
        <h1>Gap Report — Shot List</h1>
        <div className="empty">
          <p>Couldn&apos;t load gaps.</p>
          <p style={{ fontSize: "0.8rem" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <GapsBoard
      initialGaps={gaps}
      demo={isDemoMode()}
      adminProtected={adminTokenConfigured()}
    />
  );
}
