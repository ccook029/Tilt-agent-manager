import type { Metadata } from "next";
import ToolFrame from "@/components/tool-frame";

export const metadata: Metadata = { title: "SOX Creator" };

export default function SoxToolPage() {
  return (
    <ToolFrame
      title="SOX Creator"
      subtitle="Team sock renders in the team's colors — the quickest merch win there is."
      src="/api/catalog/launch?product=socks&title=SOX%20Creator"
    />
  );
}
