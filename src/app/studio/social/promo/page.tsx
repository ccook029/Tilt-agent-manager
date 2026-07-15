// ---------------------------------------------------------------------------
// /studio/social/promo — the Promo Video Builder inside the Social Studio,
// so the social media team builds launch spots where they plan and draft
// posts. Same shared component (and engine) as /studio/promo.
// ---------------------------------------------------------------------------
import type { Metadata } from "next";
import PromoBuilder from "../../promo/PromoBuilder";

export const metadata: Metadata = { title: "Promo Video" };

export default function SocialPromoPage() {
  return <PromoBuilder crumb={{ href: "/studio/social", label: "Social Studio", tag: "Video" }} />;
}
