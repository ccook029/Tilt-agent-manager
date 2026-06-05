import Link from "next/link";
import Image from "next/image";
import { getAllPersonas, getLeadership } from "@/lib/personas";
import HqMetrics from "@/components/hq-metrics";
import TeamGrid from "@/components/team-grid";
import { Stagger, StaggerItem } from "@/components/motion-primitives";

export default function Home() {
  const team = getAllPersonas();
  const founders = getLeadership();

  return (
    <div className="space-y-12 relative">
      {/* Background: stick product photo */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <Image
          src="/images/tilt-sticks.jpg"
          alt=""
          fill
          className="object-cover opacity-[0.06]"
          priority
        />
      </div>

      {/* T-Shield watermark */}
      <div className="fixed bottom-8 right-8 pointer-events-none z-0 opacity-[0.04]">
        <Image
          src="/images/tilt-shield.png"
          alt=""
          width={300}
          height={360}
        />
      </div>

      {/* Hero */}
      <div className="text-center py-16 relative">
        <div className="flex items-center justify-center mb-8">
          <Image
            src="/images/tilt-shield.png"
            alt="Tilt Hockey"
            width={140}
            height={175}
            className="drop-shadow-[0_0_40px_rgba(228,0,43,0.15)]"
            priority
          />
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          Corporate <span className="text-[#e4002b]">Headquarters</span>
        </h1>
        <p className="text-gray-500 max-w-xl mx-auto leading-relaxed">
          The team behind Tilt. Each department is powered by an AI agent
          that works autonomously — delivering analytics, scanning competitors,
          and designing the next generation of hockey equipment.
        </p>
      </div>

      {/* Key Metrics */}
      <HqMetrics />

      {/* Leadership — Co-Founders */}
      <div>
        <div className="flex items-center gap-2 mb-5">
          <Image src="/images/tilt-shield.png" alt="" width={20} height={24} className="opacity-70" />
          <h2 className="font-semibold text-gray-300 uppercase tracking-wider text-sm">
            Leadership
          </h2>
        </div>
        <Stagger className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-2">
          {founders.map((founder) => (
            <StaggerItem key={founder.name}>
              <div className="lift rounded-xl border border-[#e4002b]/20 hover:border-[#e4002b]/40 p-6 bg-[#111]/60 relative overflow-hidden">
                {/* Subtle red gradient top edge */}
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#e4002b]/60 to-transparent" />

                <div className="flex items-center gap-5">
                  <div
                    className={`w-16 h-16 rounded-full ${founder.avatarColor} ring-2 ${founder.avatarAccent} flex items-center justify-center text-xl font-bold text-white shadow-lg`}
                  >
                    {founder.avatarInitials}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{founder.name}</h3>
                    <p className="text-sm text-[#e4002b]">{founder.title}</p>
                  </div>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        {/* Connector line from leadership to team */}
        <div className="flex justify-center py-3">
          <div className="w-px h-8 bg-gradient-to-b from-[#e4002b]/40 to-gray-800/40" />
        </div>
      </div>

      {/* Team Grid */}
      <div>
        <div className="flex items-center gap-2 mb-5">
          <Image src="/images/tilt-shield.png" alt="" width={20} height={24} className="opacity-70" />
          <h2 className="font-semibold text-gray-300 uppercase tracking-wider text-sm">
            The Team
          </h2>
        </div>
        <TeamGrid team={team} />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/dashboard"
          className="lift block rounded-lg border border-gray-800/60 p-5 hover:border-[#e4002b]/30 bg-[#111]/30"
        >
          <h3 className="font-semibold mb-1">Operations Dashboard</h3>
          <p className="text-sm text-gray-500">
            View agent run history, reports, and performance metrics.
          </p>
        </Link>
        <div className="rounded-lg border border-gray-800/60 p-5 bg-[#111]/30">
          <h3 className="font-semibold mb-1">API Access</h3>
          <p className="text-sm text-gray-500">
            Trigger agents via{" "}
            <code className="text-xs bg-gray-800 px-1 rounded text-[#e4002b]/80">
              POST /api/agents/run
            </code>{" "}
            or individual endpoints.
          </p>
        </div>
      </div>
    </div>
  );
}
