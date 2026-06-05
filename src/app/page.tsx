import Link from "next/link";
import Image from "next/image";
import { getAllPersonas, getLeadership } from "@/lib/personas";
import HqMetrics from "@/components/hq-metrics";
import TeamGrid from "@/components/team-grid";
import TiltCard from "@/components/tilt-card";
import Hero from "@/components/hero";
import ScrollReveal from "@/components/scroll-reveal";
import { Stagger, StaggerItem } from "@/components/motion-primitives";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="h-6 w-1 rounded-full bg-[#e4002b]" />
      <h2 className="font-display text-2xl font-semibold uppercase tracking-wide text-gray-200">
        {children}
      </h2>
    </div>
  );
}

export default function Home() {
  const team = getAllPersonas();
  const founders = getLeadership();

  return (
    <div className="space-y-16 relative">
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
        <Image src="/images/tilt-shield.png" alt="" width={300} height={360} />
      </div>

      {/* Cinematic hero */}
      <Hero />

      {/* Key Metrics */}
      <ScrollReveal>
        <HqMetrics />
      </ScrollReveal>

      {/* Leadership — Co-Founders */}
      <ScrollReveal>
        <SectionLabel>Leadership</SectionLabel>
        <Stagger className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-2">
          {founders.map((founder) => (
            <StaggerItem key={founder.name}>
              <TiltCard
                max={6}
                className="group rounded-xl border border-[#e4002b]/20 hover:border-[#e4002b]/40 p-6 bg-[#111]/60 relative overflow-hidden"
              >
                {/* Subtle red gradient top edge */}
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#e4002b]/60 to-transparent" />

                <div className="flex items-center gap-5">
                  <div
                    className={`w-16 h-16 rounded-full ${founder.avatarColor} ring-2 ${founder.avatarAccent} flex items-center justify-center text-xl font-bold text-white shadow-lg`}
                  >
                    {founder.avatarInitials}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {founder.name}
                    </h3>
                    <p className="text-sm text-[#e4002b]">{founder.title}</p>
                  </div>
                </div>
              </TiltCard>
            </StaggerItem>
          ))}
        </Stagger>

        {/* Connector line from leadership to team */}
        <div className="flex justify-center py-3">
          <div className="w-px h-8 bg-gradient-to-b from-[#e4002b]/40 to-gray-800/40" />
        </div>
      </ScrollReveal>

      {/* Team Grid */}
      <ScrollReveal>
        <div id="team" className="scroll-mt-24">
          <SectionLabel>The Team</SectionLabel>
          <TeamGrid team={team} />
        </div>
      </ScrollReveal>

      {/* Quick Links */}
      <ScrollReveal>
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
      </ScrollReveal>
    </div>
  );
}
