"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { getPersonaByAgentId } from "@/lib/personas";
import { useRunPipeline } from "@/components/run-pipeline";
import { EASE_OUT } from "@/lib/motion";
import { ChevronDownIcon } from "@/components/icons";
import RunStats from "@/components/run-stats";
import MayaChat from "@/components/maya-chat";
import CfoChat from "@/components/cfo-chat";
import PennyChat from "@/components/penny-chat";
import GenericAgentChat from "@/components/generic-agent-chat";
import ActionLedger from "@/components/action-ledger";
import ReportFiles from "@/components/report-files";
import ReportRenderer from "@/components/report-renderer";

interface RunLog {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "error";
  output: string;
  model: string;
  tokensUsed?: number;
}

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params.agentId as string;
  const persona = getPersonaByAgentId(agentId);
  const isMaya = agentId === "product-design";
  const isCfo = agentId === "accounting-manager";
  const isPenny = agentId === "accounting";
  const isExternal = persona?.external === true;
  // Staffed employees who take work orders through their boss (no run/chat).
  const isStaff = Boolean(persona?.assignHref);
  // Every other internal agent gets the generic "talk to them" chat.
  const isGenericChat =
    Boolean(persona) && !isExternal && !isStaff && !isMaya && !isCfo && !isPenny;

  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [innovating, setInnovating] = useState(false);
  const showLedger = isPenny || isCfo;
  const [activeTab, setActiveTab] = useState<"history" | "files" | "chat" | "ledger">(
    isMaya || isCfo || isPenny || isGenericChat ? "chat" : "history"
  );
  const firstName = persona?.name?.split(" ")[0] ?? "This teammate";
  // Non-owners may not open the CFO/Penny agents (their routes are gated too).
  const [acctAllowed, setAcctAllowed] = useState(true);
  useEffect(() => {
    if (!isCfo && !isPenny) return;
    fetch("/api/os/me")
      .then((r) => r.json())
      .then((d) => setAcctAllowed(!d.authEnabled || Boolean(d.isAccountingOwner)))
      .catch(() => {});
  }, [isCfo, isPenny]);
  const { run } = useRunPipeline();
  const reduce = useReducedMotion();

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/logs?agentId=${agentId}`);
      const data = await res.json();
      setLogs(data.logs ?? []);
    } catch {
      console.error("Failed to fetch logs");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const triggerRun = () => {
    if (!persona) return;
    setRunning(true);
    run(persona.name, async () => {
      // For agents with task-based endpoints, default to the weekly report
      const isInventory = agentId === "inventory";
      const endpoint = isInventory ? "/api/inventory/weekly" : persona.runEndpoint;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await fetchLogs();
      return { ok: res.ok };
    }).finally(() => setRunning(false));
  };

  const triggerTask = (task: string) => {
    if (!persona) return;
    setRunningTask(task);
    const label = task
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    run(label, async () => {
      const res = await fetch(persona.runEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      await fetchLogs();
      return { ok: res.ok };
    }).finally(() => setRunningTask(null));
  };

  const triggerInnovation = () => {
    setInnovating(true);
    run("New Concept", async () => {
      const res = await fetch("/api/product-design/innovate", { method: "POST" });
      await fetchLogs();
      return { ok: res.ok };
    }).finally(() => setInnovating(false));
  };

  const displayName = persona?.name ?? logs[0]?.agentName ?? agentId;

  return (
    <div className="space-y-6">
      {/* Header with persona */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-5">
          <Link
            href={persona && !persona.external ? `/org/${agentId}` : "/org"}
            className="text-gray-500 hover:text-[#00d6ff] transition-colors mt-2"
          >
            &larr;
          </Link>

          {persona && (
            <div
              className={`w-16 h-16 rounded-full ${persona.avatarColor} ring-2 ${persona.avatarAccent} flex items-center justify-center text-xl font-bold text-white shadow-lg shrink-0`}
            >
              {persona.avatarInitials}
            </div>
          )}

          <div>
            <h2 className="font-display text-4xl font-bold uppercase tracking-wide">
              {displayName}
            </h2>
            {persona && (
              <p className="text-sm text-gray-500 mt-0.5">
                {persona.title} &middot; {persona.department}
              </p>
            )}
            {persona && (
              <p className="text-sm text-gray-400 mt-2 max-w-2xl leading-relaxed">
                {persona.bio}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Stockton gets a link to the native Stick Inventory module */}
          {agentId === "inventory" && (
            <a
              href="/inventory"
              className="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              Inventory App
              <svg
                className="w-3.5 h-3.5 opacity-70"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </a>
          )}
          {/* Maya gets an "Innovate" button */}
          {isMaya && (
            <button
              onClick={triggerInnovation}
              disabled={innovating}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              {innovating ? "Thinking..." : "Generate Concept"}
            </button>
          )}
          {/* External tools (e.g. Catalog Builder) open in a new tab via a
              server-side launch route that injects the access key. */}
          {isExternal && persona?.launchUrl && (
            <a
              href={persona.launchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              Open {persona.name}
              <svg
                className="w-3.5 h-3.5 opacity-70"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </a>
          )}
          {/* Staffed employees are handed work through their boss — link to
              the department's assign-work surface instead of Run/Open. */}
          {isStaff && persona?.assignHref && (
            <Link
              href={persona.assignHref}
              className="px-4 py-2 bg-[#0094b8] hover:bg-[#00a8d1] rounded-lg text-sm font-semibold text-white transition-colors"
            >
              Assign work
            </Link>
          )}
          {!isExternal && !isStaff && (
            <button
              onClick={triggerRun}
              disabled={running}
              className="px-4 py-2 bg-[#00d6ff] hover:bg-[#00a6c9] text-[#06232b] disabled:opacity-50 rounded-lg text-sm font-semibold transition-colors"
            >
              {running ? "Running..." : "Run Now"}
            </button>
          )}
        </div>
      </div>

      {/* Meta bar */}
      {persona && (
        <div className="flex items-center gap-4 text-xs text-gray-500 border-b border-gray-800/60 pb-4">
          <span className="text-gray-600">Schedule: {persona.schedule}</span>
          <span
            className={`flex items-center gap-1.5 ${
              persona.status === "active" ? "text-green-400" : "text-gray-500"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                persona.status === "active"
                  ? "bg-green-500 tilt-pulse"
                  : "bg-gray-600"
              }`}
            />
            {persona.status === "active" ? "Active" : "Standby"}
          </span>
          {persona.taskTypes && (
            <span>
              Tasks:{" "}
              {persona.taskTypes.map((t) => (
                <code
                  key={t}
                  className="bg-gray-800/60 px-1.5 py-0.5 rounded text-gray-400 mr-1 text-[10px]"
                >
                  {t}
                </code>
              ))}
            </span>
          )}
        </div>
      )}

      {/* Task action buttons for agents with task types (e.g. Stockton) */}
      {persona?.taskTypes && !isMaya && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Quick Actions
          </h3>
          <div className="flex flex-wrap gap-2">
            {persona.taskTypes.map((task) => (
              <button
                key={task}
                onClick={() => triggerTask(task)}
                disabled={runningTask !== null}
                className="px-4 py-2 bg-gray-800/80 hover:bg-gray-700 border border-gray-700/60 hover:border-[#00d6ff]/40 disabled:opacity-50 rounded-lg text-sm font-medium transition-all"
              >
                {runningTask === task ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                    Running...
                  </span>
                ) : (
                  task
                    .split("-")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" ")
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tools & workspaces this person works in. */}
      {persona?.tools && persona.tools.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Tools &amp; Workspaces
          </h3>
          <div className="flex flex-wrap gap-2">
            {persona.tools.map((tool) => (
              <a
                key={tool.label}
                href={tool.href}
                target={tool.external ? "_blank" : undefined}
                rel={tool.external ? "noopener noreferrer" : undefined}
                title={tool.description}
                className="group px-4 py-2 bg-indigo-950/40 hover:bg-indigo-900/50 border border-indigo-800/50 hover:border-indigo-500/50 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5"
              >
                {tool.label}
                <svg
                  className="w-3.5 h-3.5 opacity-50 group-hover:opacity-80"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                  />
                </svg>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Accounting agents are restricted to the accounting owner. */}
      {(isCfo || isPenny) && !acctAllowed ? (
        <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-8 text-center">
          <p className="text-lg text-gray-300 mb-1">Restricted</p>
          <p className="text-sm text-gray-500">
            {persona?.name} and the accounting console are limited to the
            accounting owner. If a specific question was assigned to you, you&apos;ll
            find it under{" "}
            <Link href="/questions" className="text-[#00d6ff] hover:underline">
              Questions
            </Link>
            .
          </p>
        </div>
      ) : isStaff ? (
        <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6">
          <p className="text-sm text-gray-300">
            {firstName} is on the{" "}
            <Link href={persona?.assignHref ?? "/org"} className="text-[#00d6ff] hover:underline">
              {persona?.department}
            </Link>{" "}
            team and takes work through their boss.
          </p>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed">
            Give {firstName} something to do with the{" "}
            <span className="font-medium text-[#00d6ff]">Assign work</span>{" "}
            button above (or let the boss dispatch the whole team from the Org
            page). {firstName}&apos;s draft goes through their boss&apos;s review, then
            lands in your{" "}
            <Link href="/review" className="text-[#00d6ff] hover:underline">
              Review queue
            </Link>{" "}
            for your approval. Their tools are listed above.
          </p>
        </div>
      ) : isExternal ? (
        <div className="rounded-xl border border-gray-800/60 bg-[#111]/40 p-6">
          <p className="text-sm text-gray-400 leading-relaxed">
            {persona?.name} is a live, on-demand tool — it doesn&apos;t run on a
            schedule or post reports here. Use the{" "}
            <span className="text-sky-400 font-medium">
              Open {persona?.name}
            </span>{" "}
            button above to launch it in a new tab.
          </p>
        </div>
      ) : (
        <>
      {/* Tab navigation — sliding red underline */}
      <div className="flex gap-1 border-b border-gray-800/60 overflow-x-auto [&>*]:shrink-0">
        {([
          ...(isMaya ? [{ id: "chat" as const, label: "Talk to Maya" }] : []),
          ...(isCfo ? [{ id: "chat" as const, label: "Talk to Sterling" }] : []),
          ...(isPenny ? [{ id: "chat" as const, label: "Talk to Penny" }] : []),
          ...(isGenericChat
            ? [{ id: "chat" as const, label: `Talk to ${persona?.name?.split(" ")[0] ?? "agent"}` }]
            : []),
          ...(showLedger ? [{ id: "ledger" as const, label: "Ledger" }] : []),
          { id: "history" as const, label: "Report History" },
          { id: "files" as const, label: "Files" },
        ]).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                active ? "text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.label}
              {active &&
                (reduce ? (
                  <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-[#00d6ff]" />
                ) : (
                  <motion.span
                    layoutId="tabUnderline"
                    className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-[#00d6ff]"
                    transition={{ duration: 0.3, ease: EASE_OUT }}
                  />
                ))}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "chat" && isMaya && (
        <div>
          <MayaChat />
        </div>
      )}

      {activeTab === "chat" && isCfo && (
        <div>
          <CfoChat />
        </div>
      )}

      {activeTab === "chat" && isPenny && (
        <div>
          <PennyChat />
        </div>
      )}

      {activeTab === "chat" && isGenericChat && (
        <div>
          <GenericAgentChat agentId={agentId} name={persona?.name ?? agentId} />
        </div>
      )}

      {activeTab === "ledger" && showLedger && (
        <div>
          <ActionLedger />
        </div>
      )}

      {activeTab === "files" && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
            Downloadable Reports
          </h3>
          <ReportFiles agentId={agentId} />
        </div>
      )}

      {activeTab === "history" && (
        <div>
          {!loading && logs.length > 0 && <RunStats logs={logs} />}

          <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
            Report History
          </h3>

          {loading ? (
            <p className="text-gray-500">Loading...</p>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-gray-600">
              <p className="text-lg mb-2">No reports yet</p>
              <p className="text-sm">
                {persona
                  ? `${persona.name} hasn't delivered any reports yet.`
                  : "This agent hasn't produced any reports yet."}
              </p>
            </div>
          ) : (
            <motion.div layout={!reduce} className="space-y-2">
              <AnimatePresence initial={false}>
                {logs.map((log) => (
                  <motion.div
                    key={log.id}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? {} : { opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.35, ease: EASE_OUT }}
                    className="border border-gray-800/60 hover:border-gray-700 rounded-lg overflow-hidden transition-colors"
                  >
                    <button
                      onClick={() =>
                        setExpanded(expanded === log.id ? null : log.id)
                      }
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#111] transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            log.status === "success"
                              ? "bg-green-500"
                              : "bg-red-500"
                          }`}
                        />
                        <span className="font-medium">{log.agentName}</span>
                        <span className="text-xs text-gray-600">{log.model}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span>{(log.durationMs / 1000).toFixed(1)}s</span>
                        {log.tokensUsed != null && (
                          <span>
                            {log.tokensUsed.toLocaleString()} tokens
                          </span>
                        )}
                        <span>
                          {new Date(log.startedAt).toLocaleString()}
                        </span>
                        <motion.span
                          animate={{ rotate: expanded === log.id ? 180 : 0 }}
                          transition={{ duration: 0.25, ease: EASE_OUT }}
                          className="text-gray-600 inline-flex text-base"
                        >
                          <ChevronDownIcon />
                        </motion.span>
                      </div>
                    </button>
                    <AnimatePresence initial={false}>
                      {expanded === log.id && (
                        <motion.div
                          key="body"
                          initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                          animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                          transition={{ duration: 0.32, ease: EASE_OUT }}
                          className="overflow-hidden"
                        >
                          <div className="px-6 py-5 border-t border-gray-800/60 bg-[#0d0d0d] max-h-[700px] overflow-y-auto chat-scroll">
                            <ReportRenderer
                              text={log.output}
                              agentName={log.agentName}
                              date={log.startedAt}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}
