// ---------------------------------------------------------------------------
// Org Stick Programs layout — same scoped styles + demo banner as the other
// Design Studio builder tools; the hub's root layout provides the chrome.
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
