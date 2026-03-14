import Link from "next/link";
import { getAllPersonas } from "@/lib/personas";
import {
  IceRinkPattern,
  StickSilhouette,
  HockeyStickIcon,
  CrossedSticksIcon,
} from "@/components/hockey-icons";

export default function Home() {
  const team = getAllPersonas();

  return (
    <div className="space-y-12 relative">
      {/* Background decorations */}
      <IceRinkPattern />
      <StickSilhouette className="right-0 top-0 rotate-12 text-white" />
      <StickSilhouette className="left-0 top-[400px] -rotate-12 text-white" />

      {/* Hero */}
      <div className="text-center py-12 relative">
        <div className="flex items-center justify-center gap-3 mb-4">
          <CrossedSticksIcon className="w-10 h-10 text-[#e4002b]/60" />
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

      {/* Team Grid */}
      <div>
        <div className="flex items-center gap-2 mb-5">
          <HockeyStickIcon className="w-5 h-5 text-[#e4002b]" />
          <h2 className="text-lg font-semibold text-gray-300 uppercase tracking-wider text-sm">
            The Team
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {team.map((person) => (
            <Link
              key={person.agentId}
              href={`/dashboard/${person.agentId}`}
              className="group block rounded-xl border border-gray-800/60 p-6 hover:border-[#e4002b]/40 bg-[#111]/50 hover:bg-[#111]/80 transition-all relative overflow-hidden"
            >
              {/* Red glow on hover */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#e4002b]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

              <div className="relative">
                {/* Avatar + Name */}
                <div className="flex items-center gap-4 mb-4">
                  <div
                    className={`w-14 h-14 rounded-full ${person.avatarColor} ring-2 ${person.avatarAccent} flex items-center justify-center text-lg font-bold text-white shadow-lg`}
                  >
                    {person.avatarInitials}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white group-hover:text-[#e4002b] transition-colors">
                      {person.name}
                    </h3>
                    <p className="text-xs text-gray-500">{person.title}</p>
                  </div>
                </div>

                {/* Department badge */}
                <div className="mb-3">
                  <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-800/60 text-gray-400 border border-gray-700/50">
                    {person.department}
                  </span>
                </div>

                {/* Bio */}
                <p className="text-sm text-gray-400 leading-relaxed mb-4">
                  {person.bio}
                </p>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{person.schedule}</span>
                  <span
                    className={`flex items-center gap-1.5 ${
                      person.status === "active"
                        ? "text-green-400"
                        : "text-gray-500"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        person.status === "active"
                          ? "bg-green-500 tilt-pulse"
                          : "bg-gray-600"
                      }`}
                    />
                    {person.status === "active" ? "Active" : "Standby"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/dashboard"
          className="block rounded-lg border border-gray-800/60 p-5 hover:border-[#e4002b]/30 bg-[#111]/30 transition-colors"
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
