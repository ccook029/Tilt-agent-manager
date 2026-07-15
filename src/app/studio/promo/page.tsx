import type { Metadata } from "next";
import PromoBuilder from "./PromoBuilder";

export const metadata: Metadata = { title: "Promo Video Builder" };

export default function PromoBuilderPage() {
  return <PromoBuilder crumb={{ href: "/studio", label: "Design Studio", tag: "Native" }} />;
}
