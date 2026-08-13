// ---------------------------------------------------------------------------
// /work — where every live piece of work currently sits.
//
// /review answers "what needs me?". This answers the other question: when Reese
// hands something to Harper and Harper hands it to Cutter, where is it now?
// Every live work order, grouped by who is holding it, with how long they've
// had it. Read-only on purpose — acting on work still happens in /review.
// ---------------------------------------------------------------------------
import Link from "next/link";
import { listWorkOrders } from "@/lib/org/work-orders";
import { getDepartmentById, getEmployeeById } from "@/lib/org/directory";
import {
  LIVE_STATUSES,
  ageLabel,
  isStalled,
  whoHolds,
} from "@/lib/org/work-status";
import type { WorkOrder } from "@/lib/org/types";
import ResumeButton from "./resume-button";
import WorkPipeline from "@/components/work-pipeline";

export const dynamic = "force-dynamic";

function Card({ order }: { order: WorkOrder }) {
  const holder = whoHolds(order);
  const dept = getDepartmentById(order.departmentId);
  const assignee = getEmployeeById(order.assigneeId);
  const stalled = isStalled(order);
  const createdBy = getEmployeeById(order.createdBy);

  return (
    <div
      className={`rounded-xl border p-3.5 ${
        stalled
          ? "border-amber-500/40 bg-amber-500/[0.06]"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium leading-snug text-gray-100">{order.title}</p>
        <span
          className={`shrink-0 text-[11px] tabular-nums ${
            stalled ? "font-semibold text-amber-400" : "text-gray-500"
          }`}
          title={`Last moved ${order.updatedAt}`}
        >
          {ageLabel(order.updatedAt)}
        </span>
      </div>

      <p className="mt-1.5 text-xs text-gray-400">{holder.what}</p>

      {/* The engine runs its rounds inside one request; if that request died
          partway the order is parked here with nothing to restart it. These are
          the two states it can legitimately be picked back up from. */}
      {(order.status === "revision" || order.status === "queued") && (
        <div className="mt-2.5">
          <ResumeButton orderId={order.id} />
          {stalled && (
            <p className="mt-1.5 text-[11px] text-amber-400/90">
              It hasn&apos;t moved in {ageLabel(order.updatedAt)} — the run probably
              stopped partway. Resume picks it up where it left off.
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
        <span>{dept?.name ?? order.departmentId}</span>
        <span aria-hidden>·</span>
        <span>{assignee?.name ?? order.assigneeId}</span>
        {createdBy && (
          <>
            <span aria-hidden>·</span>
            <span>from {createdBy.name}</span>
          </>
        )}
        {stalled && (
          <>
            <span aria-hidden>·</span>
            <span className="font-semibold text-amber-400">sat here 2+ days</span>
          </>
        )}
      </div>
    </div>
  );
}

export default async function WorkBoardPage() {
  // The live pipeline goes first: watching a piece move is the thing this page
  // exists for, and it was the thing it couldn't do. The by-holder grouping
  // below stays — "Harper has 3" is a different question, and a stage column
  // can't answer it.
  const orders = await listWorkOrders({ status: LIVE_STATUSES, limit: 200 }).catch(
    () => [] as WorkOrder[]
  );

  // Group by who is holding it, not by status — "Harper has 3" is the thing a
  // founder wants to see, and it's what a status column can't show.
  const groups = new Map<string, { name: string; needsFounder: boolean; orders: WorkOrder[] }>();
  for (const o of orders) {
    const h = whoHolds(o);
    const g = groups.get(h.holderId) ?? {
      name: h.holderName,
      needsFounder: h.needsFounder,
      orders: [],
    };
    g.orders.push(o);
    groups.set(h.holderId, g);
  }

  // Founders first (they're the blocker), then the biggest queues, so the
  // page opens on what's actually holding the company up.
  const ordered = [...groups.entries()].sort((a, b) => {
    if (a[1].needsFounder !== b[1].needsFounder) return a[1].needsFounder ? -1 : 1;
    return b[1].orders.length - a[1].orders.length;
  });

  const stalledCount = orders.filter(isStalled).length;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      {/* The live board, first. Watching a piece move between stages is what
          this page is for, and it's exactly what it couldn't do before. */}
      <WorkPipeline />

      <div className="mt-12 flex items-baseline justify-between gap-4 border-t border-gray-800/70 pt-8">
        <h1 className="text-xl font-semibold tracking-tight text-white">By who&apos;s holding it</h1>
        <Link href="/review" className="text-xs font-semibold text-[#00d6ff] hover:underline">
          Review queue →
        </Link>
      </div>
      <p className="mt-1.5 text-sm text-gray-400">
        The same work, grouped by person — &ldquo;Harper has 3&rdquo; is a question a
        stage column can&apos;t answer.
        {orders.length > 0 && (
          <>
            {" "}
            {orders.length} in flight
            {stalledCount > 0 && (
              <span className="text-amber-400"> · {stalledCount} sat 2+ days</span>
            )}
            .
          </>
        )}
      </p>

      {orders.length === 0 ? (
        <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-sm text-gray-300">Nothing in flight.</p>
          <p className="mt-1 text-xs text-gray-500">
            Work appears here the moment it&apos;s assigned — from a chat, a department
            dispatch, or the cron. Ask Reese for something and it&apos;ll show up.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {ordered.map(([holderId, group]) => (
            <section key={holderId}>
              <h2 className="flex items-baseline gap-2 text-sm font-semibold text-gray-200">
                {group.needsFounder ? (
                  <span className="text-[#00d6ff]">{group.name}</span>
                ) : (
                  group.name
                )}
                <span className="text-[11px] font-normal text-gray-500">
                  {group.orders.length} item{group.orders.length === 1 ? "" : "s"}
                </span>
                {group.needsFounder && (
                  <span className="text-[11px] font-normal text-[#00d6ff]">
                    — waiting on you
                  </span>
                )}
              </h2>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                {group.orders.map((o) => (
                  <Card key={o.id} order={o} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
