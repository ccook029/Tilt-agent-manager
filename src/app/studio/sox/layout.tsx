// ---------------------------------------------------------------------------
// Design Studio builder layout — the standalone builder tools absorbed from
// tilt-social-media-manager (blanket fundraiser, sock creator, announcement
// creator). Loads the module's scoped styles and the demo banner; the hub's
// root layout still provides the global chrome.
// ---------------------------------------------------------------------------
import "../social/social.css";
import { isDemoMode } from "@/lib/social/demo-data";

export default function StudioBuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="social-studio">
      {isDemoMode() && (
        <div className="demo-banner">
          Preview mode · showing sample data — no database connected
        </div>
      )}
      {children}
    </div>
  );
}
