import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Welcome</h2>
      <p className="text-gray-400">
        The Tilt Agent Orchestrator manages AI agents that run on scheduled
        intervals, summarises their outputs, and delivers digests via email.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/dashboard"
          className="block rounded-lg border border-gray-800 p-6 hover:border-gray-600 transition-colors"
        >
          <h3 className="font-semibold mb-1">Dashboard</h3>
          <p className="text-sm text-gray-500">
            View agent run history and outputs.
          </p>
        </Link>
        <div className="rounded-lg border border-gray-800 p-6">
          <h3 className="font-semibold mb-1">Agents</h3>
          <p className="text-sm text-gray-500">
            Add agents by dropping config files into{" "}
            <code className="text-xs bg-gray-800 px-1 rounded">
              src/agents/
            </code>
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 p-6">
          <h3 className="font-semibold mb-1">API</h3>
          <p className="text-sm text-gray-500">
            <code className="text-xs bg-gray-800 px-1 rounded">
              POST /api/agents/run
            </code>{" "}
            to trigger manually.
          </p>
        </div>
      </div>
    </div>
  );
}
