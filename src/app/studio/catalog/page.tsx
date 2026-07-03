import type { Metadata } from "next";
import ToolFrame from "@/components/tool-frame";

export const metadata: Metadata = { title: "Catalog Builder" };

export default function CatalogToolPage() {
  return (
    <ToolFrame
      title="Catalog Builder"
      subtitle="Team name + colors + a logo in, a rendered team-colorway Tilt catalog out."
      src="/api/catalog/launch"
    />
  );
}
