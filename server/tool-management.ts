import { Hono } from "hono";
import { db } from "./db.js";
import { assets, toolReports, toolHistory, employees, jobs, users } from "../shared/schema.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";
import { mkdirSync, writeFileSync } from "fs";

const toolMgmtRoutes = new Hono();
toolMgmtRoutes.use("/*", requireAuth);

// ══════════════════════════════════════════════════════════════════
// TOOL MANAGEMENT API — issue reporting, history, resolution
// ══════════════════════════════════════════════════════════════════

// ── Helper: log a tool history event ─────────────────────────────
export async function logToolEvent(params: {
  companyId: number;
  assetId: number;
  eventType: string;
  employeeId?: number | null;
  jobId?: number | null;
  fromEmployeeId?: number | null;
  toEmployeeId?: number | null;
  note?: string | null;
  reportId?: number | null;
  performedBy?: number | null;
  lat?: number | null;
  lng?: number | null;
}) {
  await db.insert(toolHistory).values({
    companyId: params.companyId,
    assetId: params.assetId,
    eventType: params.eventType as any,
    employeeId: params.employeeId || null,
    jobId: params.jobId || null,
    fromEmployeeId: params.fromEmployeeId || null,
    toEmployeeId: params.toEmployeeId || null,
    note: params.note || null,
    reportId: params.reportId || null,
    performedBy: params.performedBy || null,
    lat: params.lat || null,
    lng: params.lng || null,
  });
}

// ── GET /tool-reports — List all reports (management) ────────────
toolMgmtRoutes.get("/tool-reports", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const status = c.req.query("status"); // open, acknowledged, in_repair, resolved
  const reportType = c.req.query("type"); // damaged, lost, stolen, etc.

  let query = db
    .select({
      id: toolReports.id,
      assetId: toolReports.assetId,
      assetDescription: assets.description,
      assetIdentifier: assets.identifier,
      assetType: assets.type,
      assetCategory: assets.category,
      assetManufacturer: assets.manufacturer,
      assetModel: assets.model,
      reportType: toolReports.reportType,
      severity: toolReports.severity,
      description: toolReports.description,
      photoUrl: toolReports.photoUrl,
      lat: toolReports.lat,
      lng: toolReports.lng,
      status: toolReports.status,
      resolvedAt: toolReports.resolvedAt,
      resolutionNote: toolReports.resolutionNote,
      createdAt: toolReports.createdAt,
      reporterFirstName: employees.firstName,
      reporterLastName: employees.lastName,
      reportedBy: toolReports.reportedBy,
    })
    .from(toolReports)
    .innerJoin(assets, eq(toolReports.assetId, assets.id))
    .innerJoin(employees, eq(toolReports.reportedBy, employees.id))
    .where(eq(toolReports.companyId, companyId))
    .orderBy(desc(toolReports.createdAt));

  const results = await query;

  // Filter in JS (Drizzle doesn't chain .where easily for optional filters on SQLite)
  let filtered = results;
  if (status) filtered = filtered.filter((r) => r.status === status);
  if (reportType) filtered = filtered.filter((r) => r.reportType === reportType);

  return c.json(filtered);
});

// ── GET /tool-reports/stats — Dashboard counts ───────────────────
toolMgmtRoutes.get("/tool-reports/stats", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);

  const all = await db
    .select({
      status: toolReports.status,
      severity: toolReports.severity,
      reportType: toolReports.reportType,
    })
    .from(toolReports)
    .where(eq(toolReports.companyId, companyId));

  const stats = {
    total: all.length,
    open: all.filter((r) => r.status === "open").length,
    acknowledged: all.filter((r) => r.status === "acknowledged").length,
    inRepair: all.filter((r) => r.status === "in_repair").length,
    resolved: all.filter((r) => r.status === "resolved").length,
    bySeverity: {
      safetyHazard: all.filter((r) => r.severity === "safety_hazard" && r.status !== "resolved").length,
      outOfService: all.filter((r) => r.severity === "out_of_service" && r.status !== "resolved").length,
      canStillUse: all.filter((r) => r.severity === "can_still_use" && r.status !== "resolved").length,
    },
    byType: {
      damaged: all.filter((r) => r.reportType === "damaged" && r.status !== "resolved").length,
      lost: all.filter((r) => r.reportType === "lost" && r.status !== "resolved").length,
      stolen: all.filter((r) => r.reportType === "stolen" && r.status !== "resolved").length,
      needsMaintenance: all.filter((r) => r.reportType === "needs_maintenance" && r.status !== "resolved").length,
      needsCalibration: all.filter((r) => r.reportType === "needs_calibration" && r.status !== "resolved").length,
    },
  };

  return c.json(stats);
});

// ── POST /tool-reports/:id/acknowledge — Manager acknowledges ────
toolMgmtRoutes.post("/tool-reports/:id/acknowledge", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const id = Number(c.req.param("id"));

  const [report] = await db
    .select()
    .from(toolReports)
    .where(and(eq(toolReports.id, id), eq(toolReports.companyId, companyId)));

  if (!report) return c.json({ error: "Report not found" }, 404);
  if (report.status !== "open") return c.json({ error: "Report is not in open status" }, 400);

  await db
    .update(toolReports)
    .set({ status: "acknowledged" })
    .where(eq(toolReports.id, id));

  return c.json({ success: true });
});

// ── POST /tool-reports/:id/send-to-repair — Mark as in repair ────
toolMgmtRoutes.post("/tool-reports/:id/send-to-repair", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));

  const [report] = await db
    .select()
    .from(toolReports)
    .where(and(eq(toolReports.id, id), eq(toolReports.companyId, companyId)));

  if (!report) return c.json({ error: "Report not found" }, 404);

  await db
    .update(toolReports)
    .set({ status: "in_repair" })
    .where(eq(toolReports.id, id));

  // Update asset status to maintenance
  await db
    .update(assets)
    .set({ status: "maintenance", condition: "poor" })
    .where(eq(assets.id, report.assetId));

  // Log history
  await logToolEvent({
    companyId,
    assetId: report.assetId,
    eventType: "sent_to_repair",
    reportId: id,
    note: body.note || null,
    performedBy: (c.get("user") as any)?.id,
  });

  return c.json({ success: true });
});

// ── POST /tool-reports/:id/resolve — Resolve a report ────────────
toolMgmtRoutes.post("/tool-reports/:id/resolve", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const id = Number(c.req.param("id"));
  const body = await c.req.json();

  if (!body.resolutionNote?.trim()) {
    return c.json({ error: "Resolution note is required" }, 400);
  }

  const [report] = await db
    .select()
    .from(toolReports)
    .where(and(eq(toolReports.id, id), eq(toolReports.companyId, companyId)));

  if (!report) return c.json({ error: "Report not found" }, 404);
  if (report.status === "resolved") return c.json({ error: "Already resolved" }, 400);

  const userId = (c.get("user") as any)?.id;

  await db
    .update(toolReports)
    .set({
      status: "resolved",
      resolvedBy: userId,
      resolvedAt: new Date().toISOString(),
      resolutionNote: body.resolutionNote.trim(),
    })
    .where(eq(toolReports.id, id));

  // Optionally update asset status/condition
  if (body.newStatus) {
    const updates: any = { status: body.newStatus };
    if (body.newCondition) updates.condition = body.newCondition;
    await db.update(assets).set(updates).where(eq(assets.id, report.assetId));
  }

  // Log history
  const eventType = report.reportType === "damaged" || report.reportType === "needs_maintenance"
    ? "repaired"
    : "status_changed";

  await logToolEvent({
    companyId,
    assetId: report.assetId,
    eventType,
    reportId: id,
    note: body.resolutionNote.trim(),
    performedBy: userId,
  });

  return c.json({ success: true });
});

// ── GET /tool-history/:assetId — Full history timeline for a tool ─
toolMgmtRoutes.get("/tool-history/:assetId", async (c) => {
  const companyId = getCompanyId(c);
  const assetId = Number(c.req.param("assetId"));

  // Verify asset belongs to company
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.companyId, companyId)));

  if (!asset) return c.json({ error: "Asset not found" }, 404);

  const history = await db
    .select({
      id: toolHistory.id,
      eventType: toolHistory.eventType,
      employeeId: toolHistory.employeeId,
      jobId: toolHistory.jobId,
      fromEmployeeId: toolHistory.fromEmployeeId,
      toEmployeeId: toolHistory.toEmployeeId,
      note: toolHistory.note,
      reportId: toolHistory.reportId,
      performedBy: toolHistory.performedBy,
      lat: toolHistory.lat,
      lng: toolHistory.lng,
      createdAt: toolHistory.createdAt,
    })
    .from(toolHistory)
    .where(and(eq(toolHistory.assetId, assetId), eq(toolHistory.companyId, companyId)))
    .orderBy(desc(toolHistory.createdAt));

  // Collect employee IDs to resolve names
  const empIds = new Set<number>();
  history.forEach((h) => {
    if (h.employeeId) empIds.add(h.employeeId);
    if (h.fromEmployeeId) empIds.add(h.fromEmployeeId);
    if (h.toEmployeeId) empIds.add(h.toEmployeeId);
  });

  const empMap = new Map<number, string>();
  if (empIds.size > 0) {
    const emps = await db
      .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(inArray(employees.id, [...empIds]));
    emps.forEach((e) => empMap.set(e.id, `${e.firstName} ${e.lastName}`));
  }

  // Resolve job names
  const jobIds = new Set<number>();
  history.forEach((h) => { if (h.jobId) jobIds.add(h.jobId); });
  const jobMap = new Map<number, string>();
  if (jobIds.size > 0) {
    const jbs = await db
      .select({ id: jobs.id, jobNumber: jobs.jobNumber, description: jobs.description })
      .from(jobs)
      .where(inArray(jobs.id, [...jobIds]));
    jbs.forEach((j) => jobMap.set(j.id, `${j.jobNumber} — ${j.description}`));
  }

  // Resolve user names (for performedBy)
  const userIds = new Set<number>();
  history.forEach((h) => { if (h.performedBy) userIds.add(h.performedBy); });
  const userMap = new Map<number, string>();
  if (userIds.size > 0) {
    const usrs = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, [...userIds]));
    usrs.forEach((u) => userMap.set(u.id, u.displayName));
  }

  const enriched = history.map((h) => ({
    ...h,
    employeeName: h.employeeId ? empMap.get(h.employeeId) || null : null,
    fromEmployeeName: h.fromEmployeeId ? empMap.get(h.fromEmployeeId) || null : null,
    toEmployeeName: h.toEmployeeId ? empMap.get(h.toEmployeeId) || null : null,
    jobName: h.jobId ? jobMap.get(h.jobId) || null : null,
    performedByName: h.performedBy ? userMap.get(h.performedBy) || null : null,
  }));

  return c.json(enriched);
});

// ── GET /tool-reports/:assetId/reports — Reports for a specific tool ─
toolMgmtRoutes.get("/tool-reports/by-asset/:assetId", async (c) => {
  const companyId = getCompanyId(c);
  const assetId = Number(c.req.param("assetId"));

  const reports = await db
    .select({
      id: toolReports.id,
      reportType: toolReports.reportType,
      severity: toolReports.severity,
      description: toolReports.description,
      photoUrl: toolReports.photoUrl,
      status: toolReports.status,
      resolutionNote: toolReports.resolutionNote,
      createdAt: toolReports.createdAt,
      resolvedAt: toolReports.resolvedAt,
      reporterFirstName: employees.firstName,
      reporterLastName: employees.lastName,
    })
    .from(toolReports)
    .innerJoin(employees, eq(toolReports.reportedBy, employees.id))
    .where(and(eq(toolReports.assetId, assetId), eq(toolReports.companyId, companyId)))
    .orderBy(desc(toolReports.createdAt));

  return c.json(reports);
});

export { toolMgmtRoutes };
