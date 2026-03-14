import Link from "next/link";
import { getAllPersonas } from "@/lib/personas";

export default function Home() {
  const team = getAllPersonas();

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="text-center py-8">
        <h1 className="text-3xl font-bold tracking-tight mb-3">
          Tilt Corporate Headquarters
        </h1>
        <p className="text-gray-400 max-w-xl mx-auto">
          Meet the team that runs Tilt behind the scenes. Each department is
          powered by an AI agent that works autonomously — delivering reports,
          scanning competitors, and building product specs.
        </p>
      </div>

      {/* Team Grid */}
      <div>
        <h2 className="text-lg font-semibold text-gray-300 mb-4">
          The Team
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {team.map((person) => (
            <Link
              key={person.agentId}
              href={`/dashboard/${person.agentId}`}
              className="group block rounded-xl border border-gray-800 p-6 hover:border-gray-600 hover:bg-gray-900/50 transition-all"
            >
              {/* Avatar + Name */}
              <div className="flex items-center gap-4 mb-4">
                <div
                  className={`w-14 h-14 rounded-full ${person.avatarColor} ring-2 ${person.avatarAccent} flex items-center justify-center text-lg font-bold text-white shadow-lg`}
                >
                  {person.avatarInitials}
                </div>
                <div>
                  <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors">
                    {person.name}
                  </h3>
                  <p className="text-xs text-gray-500">{person.title}</p>
                </div>
              </div>

              {/* Department badge */}
              <div className="mb-3">
                <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                  {person.department}
                </span>
              </div>

              {/* Bio */}
              <p className="text-sm text-gray-400 leading-relaxed mb-4">
                {person.bio}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{person.schedule}</span>
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
                        ? "bg-green-500 animate-pulse"
                        : "bg-gray-600"
                    }`}
                  />
                  {person.status === "active" ? "Active" : "Standby"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/dashboard"
          className="block rounded-lg border border-gray-800 p-5 hover:border-gray-600 transition-colors"
        >
          <h3 className="font-semibold mb-1">Operations Dashboard</h3>
          <p className="text-sm text-gray-500">
            View agent run history, outputs, and performance metrics.
          </p>
        </Link>
        <div className="rounded-lg border border-gray-800 p-5">
          <h3 className="font-semibold mb-1">API Access</h3>
          <p className="text-sm text-gray-500">
            Trigger agents via{" "}
            <code className="text-xs bg-gray-800 px-1 rounded">
              POST /api/agents/run
            </code>{" "}
            or individual endpoints.
          </p>
        </div>
      </div>
    </div>
  );
}
