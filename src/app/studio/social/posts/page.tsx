import { listPostsWithAssets, type PostWithAsset } from "@/lib/social/queries";
import { isDemoMode } from "@/lib/social/demo-data";
import { adminTokenConfigured } from "@/lib/social/admin-auth";
import { shotstackConfigured } from "@/lib/social/render/shotstack";
import { rollForwardSchedule } from "@/lib/social/planner/rollforward";
import PostsBoard from "./PostsBoard";

export const dynamic = "force-dynamic";

export default async function PostsPage() {
  let posts: PostWithAsset[] = [];
  let error: string | null = null;
  try {
    if (!isDemoMode()) await rollForwardSchedule().catch(() => {});
    posts = await listPostsWithAssets();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="container">
        <p className="tagline">Locked window · next 14 days</p>
        <h1>Posts</h1>
        <div className="empty">
          <p>Couldn&apos;t load posts.</p>
          <p style={{ fontSize: "0.8rem" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <PostsBoard
      initialPosts={posts}
      demo={isDemoMode()}
      adminProtected={adminTokenConfigured()}
      videoConfigured={shotstackConfigured()}
    />
  );
}
