import type { Metadata } from "next";
import ToolFrame from "@/components/tool-frame";

export const metadata: Metadata = { title: "Blanket Fundraiser" };

export default function BlanketToolPage() {
  return (
    <ToolFrame
      title="Blanket Fundraiser"
      subtitle="Team-branded blanket renders for fundraiser one-pagers and order forms."
      src="/api/catalog/launch?product=blanket&title=Blanket%20Fundraiser%20Creator"
    />
  );
}
