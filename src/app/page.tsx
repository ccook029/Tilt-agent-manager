import Link from "next/link";
import Image from "next/image";
import { getLeadership, getPersonaByAgentId } from "@/lib/personas";
import { getDepartments, getEmployeesByDepartment } from "@/lib/org/directory";
import type { Employee } from "@/lib/org/types";
import HqMetrics from "@/components/hq-metrics";
import CompanyTree, {
  type DepartmentView,
  type MemberView,
} from "@/components/team-grid";
import TiltCard from "@/components/tilt-card";
import Hero from "@/components/hero";
import ScrollReveal from "@/components/scroll-reveal";
import { Stagger, StaggerItem } from "@/components/motion-primitives";

// Build the org-chart view: directory (structure) + personas (faces/bios).
function toMemberView(e: Employee, isBoss: boolean): MemberView {
  const persona = e.personaId ? getPersonaByAgentId(e.personaId) : undefined;
  return {
    id: e.id,
    name: e.name,
    title: e.title,
    initials:
      persona?.avatarInitials ??
      e.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2),
    color: persona?.avatarColor ?? "bg-gray-700",
    accent: persona?.avatarAccent ?? "ring-gray-500",
    bio: persona?.bio ?? e.charter,
    href: `/org/${e.id}`,
    isBoss,
  };
}

function buildDepartmentViews(): DepartmentView[] {
  return getDepartments().map((d) => {
    const members = getEmployeesByDepartment(d.id).filter((e) => e.enabled);
    const boss = members.find((e) => e.id === d.managerId) ?? null;
    return {
      id: d.id,
      name: d.name,
      mission: d.mission,
      boss: boss ? toMemberView(boss, true) : null,
      members: members
        .filter((e) => e.id !== d.managerId)
        .map((e) => toMemberView(e, false)),
      tools: d.tools ?? [],
    };
  });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="h-6 w-1 rounded-full bg-[#00d6ff]" />
      <h2 className="font-display text-2xl font-semibold uppercase tracking-wide text-gray-200">
        {children}
      </h2>
    </div>
  );
}

export default function Home() {
  const departments = buildDepartmentViews();
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
                className="group rounded-xl border border-[#00d6ff]/20 hover:border-[#00d6ff]/40 p-6 bg-[#111]/60 relative overflow-hidden"
              >
                {/* Subtle red gradient top edge */}
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#00d6ff]/60 to-transparent" />

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
                    <p className="text-sm text-[#00d6ff]">{founder.title}</p>
                  </div>
                </div>
              </TiltCard>
            </StaggerItem>
          ))}
        </Stagger>

        {/* Connector line from leadership to team */}
        <div className="flex justify-center py-3">
          <div className="w-px h-8 bg-gradient-to-b from-[#00d6ff]/40 to-gray-800/40" />
        </div>
      </ScrollReveal>

      {/* The Company — departments, reporting lines, and tools */}
      <ScrollReveal>
        <div id="team" className="scroll-mt-24">
          <SectionLabel>The Company</SectionLabel>
          <CompanyTree departments={departments} />
        </div>
      </ScrollReveal>

      {/* Quick Links */}
      <ScrollReveal>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/dashboard"
            className="lift block rounded-lg border border-gray-800/60 p-5 hover:border-[#00d6ff]/30 bg-[#111]/30"
          >
            <h3 className="font-semibold mb-1">Operations Dashboard</h3>
            <p className="text-sm text-gray-500">
              View agent run history, reports, and performance metrics.
            </p>
          </Link>
          <Link
            href="/staff"
            className="lift block rounded-lg border border-gray-800/60 p-5 hover:border-[#00d6ff]/30 bg-[#111]/30"
          >
            <h3 className="font-semibold mb-1">Staff Tools</h3>
            <p className="text-sm text-gray-500">
              The storefront back office — ambassadors, partners, retailers, and
              registrations — reachable straight from HQ.
            </p>
          </Link>
        </div>
      </ScrollReveal>
    </div>
  );
}
