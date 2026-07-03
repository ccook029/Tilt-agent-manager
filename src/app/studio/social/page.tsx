import type { Metadata } from "next";
import ToolFrame from "@/components/tool-frame";

export const metadata: Metadata = { title: "Social Content" };

export default function SocialToolPage() {
  return (
    <ToolFrame
      title="Social Content"
      subtitle="The Social Studio — content plan, drafted posts, branded visuals, and the shot list."
      src="/api/modules/launch?m=social"
    />
  );
}
