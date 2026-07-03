// ---------------------------------------------------------------------------
// Social Studio module layout — the absorbed tilt-social-media-manager app
// (docs/SOCIAL_STUDIO_ABSORPTION.md, Stage 3). The hub's root layout provides
// the global chrome (header, aurora backdrop, max-w-6xl main); this layout
// adds the module's scoped styles, its sub-nav, and the demo-mode banner.
// ---------------------------------------------------------------------------
import type { Metadata } from "next";
import "./social.css";
import SocialNav from "./nav";
import { isDemoMode } from "@/lib/social/demo-data";

export const metadata: Metadata = {
  title: { default: "Social Studio", template: "%s · Social Studio · Tilt HQ" },
};

export default function SocialStudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="social-studio">
      <SocialNav />
      {isDemoMode() && (
        <div className="demo-banner">
          Preview mode · showing sample data — no database connected
        </div>
      )}
      {children}
    </div>
  );
}
