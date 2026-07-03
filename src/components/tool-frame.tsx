// ---------------------------------------------------------------------------
// ToolFrame — chrome for an embedded Design Studio tool: title bar with an
// "open full screen" escape hatch, and the tool itself in a full-height
// iframe. Modules keep running on their own deployments; the OS provides the
// one front door (launch routes inject access keys server-side).
// ---------------------------------------------------------------------------
import Link from "next/link";

export default function ToolFrame({
  title,
  subtitle,
  src,
}: {
  title: string;
  subtitle: string;
  src: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-600">
            <Link href="/studio" className="hover:text-[#00d6ff] transition-colors">
              Design Studio
            </Link>{" "}
            /
          </p>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-gray-500">{subtitle}</p>
        </div>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-500 hover:text-[#00d6ff] transition-colors border border-gray-800 rounded-lg px-3 py-1.5"
        >
          Open full screen ↗
        </a>
      </div>
      <iframe
        src={src}
        title={title}
        className="w-full h-[calc(100vh-16rem)] min-h-[540px] rounded-xl border border-gray-800 bg-[#0d0d0d]"
        allow="clipboard-write"
      />
    </div>
  );
}
