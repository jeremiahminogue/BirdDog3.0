import { Hono } from "hono";
import { db } from "./db.js";
import {
  dailyLog, scheduledMoves, jobAssignments, employees, jobs,
  classifications
} from "../shared/schema.js";
import { eq, and, lte, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";

const schedule = new Hono();

schedule.use("/*", requireAuth);

// ── Apply pending moves (auto-runs on look-ahead load) ───────────
// Finds scheduled_moves where effective_date <= today and applied = 0,
// executes each move against job_assignments, marks applied.
async function applyPendingMoves(companyId: number): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const pending = await db
    .select()
    .from(scheduledMoves)
    .where(and(lte(scheduledMoves.effectiveDate, today), eq(scheduledMoves.applied, false), eq(scheduledMoves.companyId, companyId)));

  let applied = 0;
  for (const move of pending) {
    // Deactivate all current active assignments for this employee
    await db
      .update(jobAssignments)
      .set({ isActive: false })
      .where(and(eq(jobAssignments.employeeId, move.employeeId), eq(jobAssignments.isActive, true)));

    // If moving to a job (not bench), create or reactivate assignment
    if (move.toJobId) {
      const [existing] = await db
        .select()
        .from(jobAssignments)
        .where(and(eq(jobAssignments.jobId, move.toJobId), eq(jobAssignments.employeeId, move.employeeId)))
        .limit(1);

      if (existing) {
        await db
          .update(jobAssignments)
          .set({ isActive: true, assignedAt: new Date().toISOString() })
          .where(eq(jobAssignments.id, existing.id));
      } else {
        await db
          .insert(jobAssignments)
          .values({ jobId: move.toJobId, employeeId: move.employeeId });
      }
    }

    // Mark move as applied
    await db
      .update(scheduledMoves)
      .set({ applied: true })
      .where(eq(scheduledMoves.id, move.id));
    applied++;
  }
  return applied;
}

// ── Auto-commit today's assignments to daily_log ─────────────────
// Snapshots the current board state so there's always a historical record.
// Runs once per day (skips if already committed for today).
async function autoCommitToday(companyId: number): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);

  // Already committed today? Skip.
  const [existing] = await db
    .select({ id: dailyLog.id })
    .from(dailyLog)
    .where(and(eq(dailyLog.date, today), eq(dailyLog.companyId, companyId)))
    .limit(1);
  if (existing) return false;

  const activeEmps = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.status, "active"), eq(employees.companyId, companyId)));

  const activeAssigns = await db
    .select()
    .from(jobAssignments)
    .where(eq(jobAssignments.isActive, true));

  const assignMap = new Map<number, number>();
  for (const a of activeAssigns) assignMap.set(a.employeeId, a.jobId);

  const values = activeEmps.map((emp) => ({
    date: today,
    employeeId: emp.id,
    jobId: assignMap.get(emp.id) || null,
    companyId,
  }));

  if (values.length > 0) await db.insert(dailyLog).values(values);
  return true;
}

// Keep legacy endpoint for backward compat
schedule.get("/apply-pending", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const count = await applyPendingMoves(companyId);
  return c.json({ applied: count });
});

// ── Commit Today (legacy — auto-commit handles this now) ─────────
schedule.post("/commit-day", requireRole("admin", "pm"), async (c) => {
  const { date } = await c.req.json();
  const commitDate = date || new Date().toISOString().slice(0, 10);
  const companyId = getCompanyId(c);

  await db.delete(dailyLog).where(and(eq(dailyLog.date, commitDate), eq(dailyLog.companyId, companyId)));

  const activeEmps = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.status, "active"), eq(employees.companyId, companyId)));

  const activeAssigns = await db
    .select()
    .from(jobAssignments)
    .where(eq(jobAssignments.isActive, true));

  const assignMap = new Map<number, number>();
  for (const a of activeAssigns) assignMap.set(a.employeeId, a.jobId);

  const values = activeEmps.map((emp) => ({
    date: commitDate,
    employeeId: emp.id,
    jobId: assignMap.get(emp.id) || null,
    companyId,
  }));

  if (values.length > 0) await db.insert(dailyLog).values(values);
  return c.json({ date: commitDate, count: values.length });
});

// ── Get committed log for a date range ───────────────────────────
schedule.get("/log", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const companyId = getCompanyId(c);

  if (!from || !to) {
    return c.json({ error: "from and to required (YYYY-MM-DD)" }, 400);
  }

  const rows = await db
    .select({
      id: dailyLog.id,
      date: dailyLog.date,
      employeeId: dailyLog.employeeId,
      jobId: dailyLog.jobId,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeNumber: employees.employeeNumber,
      classificationName: classifications.name,
      classificationColor: classifications.color,
      jobNumber: jobs.jobNumber,
      jobName: jobs.name,
    })
    .from(dailyLog)
    .leftJoin(employees, eq(dailyLog.employeeId, employees.id))
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .leftJoin(jobs, eq(dailyLog.jobId, jobs.id))
    .where(sql`${dailyLog.date} >= ${from} AND ${dailyLog.date} <= ${to} AND ${dailyLog.companyId} = ${companyId}`)
    .orderBy(dailyLog.date, employees.lastName);

  const committedDates = [...new Set(rows.map(r => r.date))];
  return c.json({ entries: rows, committedDates });
});

// ── Scheduled Moves CRUD ─────────────────────────────────────────
schedule.get("/moves", async (c) => {
  const companyId = getCompanyId(c);
  const rows = await db
    .select({
      id: scheduledMoves.id,
      employeeId: scheduledMoves.employeeId,
      toJobId: scheduledMoves.toJobId,
      effectiveDate: scheduledMoves.effectiveDate,
      applied: scheduledMoves.applied,
      notes: scheduledMoves.notes,
      createdAt: scheduledMoves.createdAt,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeNumber: employees.employeeNumber,
      classificationName: classifications.name,
      classificationColor: classifications.color,
      jobNumber: jobs.jobNumber,
      jobName: jobs.name,
    })
    .from(scheduledMoves)
    .leftJoin(employees, eq(scheduledMoves.employeeId, employees.id))
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .leftJoin(jobs, eq(scheduledMoves.toJobId, jobs.id))
    .where(and(eq(scheduledMoves.applied, false), eq(scheduledMoves.companyId, companyId)))
    .orderBy(scheduledMoves.effectiveDate);

  return c.json(rows);
});

schedule.post("/moves", requireRole("admin", "pm"), async (c) => {
  const data = await c.req.json();
  const companyId = getCompanyId(c);



  // Delete any existing unapplied move for this employee on this date (overwrite)
  const deleted = await db.delete(scheduledMoves).where(
    and(
      eq(scheduledMoves.employeeId, data.employeeId),
      eq(scheduledMoves.effectiveDate, data.effectiveDate),
      eq(scheduledMoves.applied, false),
      eq(scheduledMoves.companyId, companyId)
    )
  );

  const [row] = await db.insert(scheduledMoves).values({
    employeeId: data.employeeId,
    toJobId: data.toJobId || null,
    effectiveDate: data.effectiveDate,
    notes: data.notes || null,
    companyId,
  }).returning();
  return c.json(row, 201);
});

// Bulk-clear unapplied moves for an employee in a date range (used before drag-save)
// MUST be before /moves/:id to avoid :id matching "clear-range"
schedule.delete("/moves/clear-range", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const empId = parseInt(c.req.query("employeeId") || "0");
  const from = c.req.query("from") || "";
  const to = c.req.query("to") || "";
  if (!empId || !from || !to) return c.json({ error: "Missing params" }, 400);

  await db.delete(scheduledMoves).where(
    and(
      eq(scheduledMoves.employeeId, empId),
      eq(scheduledMoves.applied, false),
      eq(scheduledMoves.companyId, companyId),
      sql`${scheduledMoves.effectiveDate} >= ${from}`,
      sql`${scheduledMoves.effectiveDate} <= ${to}`,
    )
  );
  return c.json({ ok: true });
});

schedule.delete("/moves/:id", requireRole("admin", "pm"), async (c) => {
  const id = parseInt(c.req.param("id"));
  const companyId = getCompanyId(c);
  await db.delete(scheduledMoves).where(and(eq(scheduledMoves.id, id), eq(scheduledMoves.companyId, companyId)));
  return c.json({ ok: true });
});

// ── Look-ahead: swim-lane timeline ───────────────────────────────
// Accepts ?start=YYYY-MM-DD (Monday of desired week) and ?weeks=1|2|3
// Returns per-employee, per-date grid for the swim-lane UI.
// Auto-applies pending moves and auto-commits today on every load.
schedule.get("/look-ahead", async (c) => {
  const companyId = getCompanyId(c);

  // Auto-apply pending moves + auto-commit today
  // Skip apply after drag saves to prevent moves on past dates from
  // permanently mutating job_assignments before the grid renders.
  const skipApply = c.req.query("skipApply") === "1";
  const applied = skipApply ? 0 : await applyPendingMoves(companyId);
  if (!skipApply) await autoCommitToday(companyId);

  // ── Week navigation ──
  const startParam = c.req.query("start");
  const weeks = Math.min(Math.max(parseInt(c.req.query("weeks") || "2") || 2, 1), 4);

  let weekStart: Date;
  if (startParam) {
    weekStart = new Date(startParam + "T12:00:00");
  } else {
    // Default to current week's Monday
    const now = new Date();
    const day = now.getDay();
    weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  }

  // Generate weekday dates (Mon-Fri) for the requested weeks
  const dates: string[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }

  // Active employees
  const emps = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeNumber: employees.employeeNumber,
      classificationId: employees.classificationId,
      classificationName: classifications.name,
      classificationColor: classifications.color,
      department: classifications.department,
    })
    .from(employees)
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .where(and(eq(employees.status, "active"), eq(employees.companyId, companyId)))
    .orderBy(classifications.name, employees.lastName);

  // Current active assignments
  const assigns = await db
    .select({
      employeeId: jobAssignments.employeeId,
      jobId: jobAssignments.jobId,
      jobNumber: jobs.jobNumber,
      jobName: jobs.name,
    })
    .from(jobAssignments)
    .leftJoin(jobs, eq(jobAssignments.jobId, jobs.id))
    .where(eq(jobAssignments.isActive, true));

  const assignMap = new Map<number, { jobId: number; jobNumber: string; jobName: string }>();
  for (const a of assigns) {
    assignMap.set(a.employeeId, { jobId: a.jobId, jobNumber: a.jobNumber || "", jobName: a.jobName || "" });
  }

  // Pending scheduled moves
  const moves = await db
    .select({
      id: scheduledMoves.id,
      employeeId: scheduledMoves.employeeId,
      toJobId: scheduledMoves.toJobId,
      effectiveDate: scheduledMoves.effectiveDate,
      notes: scheduledMoves.notes,
      jobNumber: jobs.jobNumber,
      jobName: jobs.name,
    })
    .from(scheduledMoves)
    .leftJoin(jobs, eq(scheduledMoves.toJobId, jobs.id))
    .where(and(eq(scheduledMoves.applied, false), eq(scheduledMoves.companyId, companyId)))
    .orderBy(scheduledMoves.effectiveDate);

  for (const m of moves) {
  }

  // Build per-employee schedule grid
  const grid = emps.map(emp => {
    const currentAssignment = assignMap.get(emp.id);
    const empMoves = moves
      .filter(m => m.employeeId === emp.id)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

    const schedule = dates.map(date => {
      let job = currentAssignment || null;
      for (const m of empMoves) {
        if (m.effectiveDate <= date) {
          job = m.toJobId
            ? { jobId: m.toJobId, jobNumber: m.jobNumber || "", jobName: m.jobName || "" }
            : null;
        }
      }
      const moveOnDate = empMoves.find(m => m.effectiveDate === date);
      return {
        date,
        job,
        moveId: moveOnDate?.id || null,
        isMove: !!moveOnDate,
      };
    });

    return { ...emp, schedule };
  });

  // Committed dates in range
  const logRows = dates.length > 0
    ? await db
        .select({ date: dailyLog.date })
        .from(dailyLog)
        .where(sql`${dailyLog.date} >= ${dates[0]} AND ${dailyLog.date} <= ${dates[dates.length - 1]} AND ${dailyLog.companyId} = ${companyId}`)
        .groupBy(dailyLog.date)
    : [];

  const committedDates = logRows.map(r => r.date);

  // Active jobs for dropdowns
  const activeJobs = await db
    .select({ id: jobs.id, jobNumber: jobs.jobNumber, name: jobs.name })
    .from(jobs)
    .where(sql`${jobs.status} IN ('planning', 'active') AND ${jobs.companyId} = ${companyId}`)
    .orderBy(jobs.jobNumber);

  return c.json({ dates, employees: grid, committedDates, jobs: activeJobs, autoApplied: applied });
});

export { schedule };
