// ---------------------------------------------------------------------------
// GET /api/org/directory — The org chart as data: departments, employees,
// reporting lines. Auth: Tilt OS middleware.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import {
  getDepartments,
  getEmployees,
  getEmployeesByDepartment,
} from "@/lib/org/directory";

export async function GET() {
  const departments = getDepartments().map((d) => ({
    ...d,
    members: getEmployeesByDepartment(d.id).map((e) => e.id),
  }));
  return NextResponse.json({
    departments,
    employees: getEmployees(),
  });
}
