// ---------------------------------------------------------------------------
// /api/org/work-orders — List and create work orders
//
// GET  ?department=&assignee=&status=&limit=   (status may be comma-separated;
//      omit all filters for the newest 100; ?queue=owner for Chris's queue)
// POST { assigneeId, title, brief, deliverableType?, run? }
//      Department is derived from the assignee. run: true executes the full
//      worker → boss cycle before responding.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { getEmployeeById } from "@/lib/org/directory";
import {
  createWorkOrder,
  getOwnerQueue,
  listWorkOrders,
} from "@/lib/org/work-orders";
import { runWorkOrder } from "@/lib/org/engine";
import type { WorkOrderStatus } from "@/lib/org/types";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get("queue") === "owner") {
    return NextResponse.json({ orders: await getOwnerQueue() });
  }
  const status = params.get("status");
  const orders = await listWorkOrders({
    departmentId: params.get("department") ?? undefined,
    assigneeId: params.get("assignee") ?? undefined,
    status: status ? (status.split(",") as WorkOrderStatus[]) : undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
  });
  return NextResponse.json({ orders });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      assigneeId?: string;
      title?: string;
      brief?: string;
      deliverableType?: string;
      createdBy?: string;
      run?: boolean;
    };

    if (!body.assigneeId || !body.title?.trim() || !body.brief?.trim()) {
      return NextResponse.json(
        { error: "assigneeId, title, and brief are required." },
        { status: 400 }
      );
    }
    const employee = getEmployeeById(body.assigneeId);
    if (!employee) {
      return NextResponse.json(
        { error: `Unknown employee: ${body.assigneeId}` },
        { status: 404 }
      );
    }
    if (!employee.enabled || !employee.staffed) {
      return NextResponse.json(
        {
          error: `${employee.name} (${employee.title}) isn't staffed yet — this position is filled in a later phase.`,
        },
        { status: 409 }
      );
    }

    let order = await createWorkOrder({
      departmentId: employee.departmentId,
      assigneeId: employee.id,
      title: body.title,
      brief: body.brief,
      deliverableType: body.deliverableType,
      createdBy: body.createdBy,
    });

    if (body.run) {
      order = (await runWorkOrder(order.id)).order;
    }
    return NextResponse.json({ ok: true, order });
  } catch (err) {
    console.error("[api] org/work-orders POST failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
