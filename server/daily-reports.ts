import { Hono } from "hono";
import { db, sqlite } from "./db.js";
import {
  dailyReports, timeEntries, jobPhotos, jobs, employees, classifications, jobAssignments
} from "../shared/schema.js";
import { eq, and, desc, asc, sql, gte, lte } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";

const dailyReportRoutes = new Hono();
dailyReportRoutes.use("/*", requireAuth);

// ══════════════════════════════════════════════════════════════════
// DAILY REPORTS — office-side management
// Currently super_admin only — will open up when field app launches
// ══════════════════════════════════════════════════════════════════

// ── List daily reports (with filters) ─────────────────────────────
dailyReportRoutes.get("/", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const jobId = c.req.query("jobId");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");
  const status = c.req.query("status");
  const submittedBy = c.req.query("submittedBy");

  let query = `
    SELECT
      dr.*,
      j.name AS job_name, j.job_number,
      e.first_name AS submitter_first, e.last_name AS submitter_last, e.employee_number AS submitter_number,
      u.display_name AS reviewer_name,
      (SELECT COUNT(*) FROM time_entries te WHERE te.daily_report_id = dr.id) AS time_entry_count,
      (SELECT COALESCE(SUM(te.hours_regular + te.hours_overtime + te.hours_double), 0) FROM time_entries te WHERE te.daily_report_id = dr.id) AS total_hours,
      (SELECT COUNT(*) FROM job_photos jp WHERE jp.daily_report_id = dr.id) AS photo_count
    FROM daily_reports dr
    LEFT JOIN jobs j ON dr.job_id = j.id
    LEFT JOIN employees e ON dr.submitted_by = e.id
    LEFT JOIN users u ON dr.reviewed_by = u.id
    WHERE dr.company_id = ?
  `;
  const params: any[] = [companyId];

  if (jobId) { query += " AND dr.job_id = ?"; params.push(parseInt(jobId)); }
  if (dateFrom) { query += " AND dr.report_date >= ?"; params.push(dateFrom); }
  if (dateTo) { query += " AND dr.report_date <= ?"; params.push(dateTo); }
  if (status) { query += " AND dr.status = ?"; params.push(status); }
  if (submittedBy) { query += " AND dr.submitted_by = ?"; params.push(parseInt(submittedBy)); }

  query += " ORDER BY dr.report_date DESC, j.name ASC";

  const rows = sqlite.prepare(query).all(...params);
  return c.json(rows);
});

// ── Get single daily report with time entries and photos ──────────
dailyReportRoutes.get("/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  const report = sqlite.prepare(`
    SELECT
      dr.*,
      j.name AS job_name, j.job_number, j.address AS job_address,
      e.first_name AS submitter_first, e.last_name AS submitter_last,
      e.employee_number AS submitter_number,
      u.display_name AS reviewer_name
    FROM daily_reports dr
    LEFT JOIN jobs j ON dr.job_id = j.id
    LEFT JOIN employees e ON dr.submitted_by = e.id
    LEFT JOIN users u ON dr.reviewed_by = u.id
    WHERE dr.id = ? AND dr.company_id = ?
  `).get(id, companyId);

  if (!report) return c.json({ error: "Report not found" }, 404);

  // Get time entries for this report
  const entries = sqlite.prepare(`
    SELECT
      te.*,
      e.first_name, e.last_name, e.employee_number,
      c.name AS classification_name
    FROM time_entries te
    LEFT JOIN employees e ON te.employee_id = e.id
    LEFT JOIN classifications c ON te.classification_id = c.id
    WHERE te.daily_report_id = ? AND te.company_id = ?
    ORDER BY e.last_name, e.first_name
  `).all(id, companyId);

  // Get photos for this report
  const photos = sqlite.prepare(`
    SELECT
      jp.*,
      e.first_name AS uploader_first, e.last_name AS uploader_last
    FROM job_photos jp
    LEFT JOIN employees e ON jp.uploaded_by = e.id
    WHERE jp.daily_report_id = ? AND jp.company_id = ?
    ORDER BY jp.created_at
  `).all(id, companyId);

  // Get assigned crew for this job
  const crew = sqlite.prepare(`
    SELECT
      e.id, e.first_name, e.last_name, e.photo_url, e.phone,
      c.name AS classification_name,
      ja.role
    FROM job_assignments ja
    JOIN employees e ON ja.employee_id = e.id
    LEFT JOIN classifications c ON e.classification_id = c.id
    WHERE ja.job_id = ? AND ja.is_active = 1 AND e.company_id = ?
    ORDER BY ja.role DESC, e.last_name, e.first_name
  `).all(report.job_id, companyId);

  return c.json({ report, timeEntries: entries, photos, crew });
});

// ── Create daily report (office can create on behalf of foreman) ──
dailyReportRoutes.post("/", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();

  const result = await db.insert(dailyReports).values({
    companyId,
    jobId: body.jobId,
    reportDate: body.reportDate,
    submittedBy: body.submittedBy,
    status: body.status || "draft",
    weatherCondition: body.weatherCondition || null,
    weatherTemp: body.weatherTemp || null,
    weatherImpact: body.weatherImpact || "none",
    workPerformed: body.workPerformed || null,
    areasWorked: body.areasWorked || null,
    delayNotes: body.delayNotes || null,
    delayType: body.delayType || "none",
    visitors: body.visitors || null,
    safetyNotes: body.safetyNotes || null,
    materialNotes: body.materialNotes || null,
    notes: body.notes || null,
  }).returning();

  return c.json(result[0], 201);
});

// ── Update daily report ──────────────────────────────────────────
dailyReportRoutes.put("/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  // Build update object — only set fields that were provided
  const updates: any = { updatedAt: sql`(datetime('now'))` };
  const fields = [
    "jobId", "reportDate", "submittedBy", "status",
    "weatherCondition", "weatherTemp", "weatherImpact",
    "workPerformed", "areasWorked", "delayNotes", "delayType",
    "visitors", "safetyNotes", "materialNotes", "notes",
    "reviewNotes"
  ];
  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f] || null;
  }

  // If marking as reviewed, set reviewer info
  if (body.status === "reviewed") {
    const user = c.get("user");
    updates.reviewedBy = user.id;
    updates.reviewedAt = new Date().toISOString();
  }

  await db.update(dailyReports)
    .set(updates)
    .where(and(eq(dailyReports.id, id), eq(dailyReports.companyId, companyId)));

  return c.json({ success: true });
});

// ── Delete daily report ──────────────────────────────────────────
dailyReportRoutes.delete("/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  await db.delete(dailyReports)
    .where(and(eq(dailyReports.id, id), eq(dailyReports.companyId, companyId)));

  return c.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// TIME ENTRIES
// ══════════════════════════════════════════════════════════════════

// ── Get time entries (by report or by date range) ────────────────
dailyReportRoutes.get("/time-entries/by-date", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");
  const jobId = c.req.query("jobId");
  const employeeId = c.req.query("employeeId");

  let query = `
    SELECT
      te.*,
      e.first_name, e.last_name, e.employee_number,
      c.name AS classification_name,
      j.name AS job_name, j.job_number
    FROM time_entries te
    LEFT JOIN employees e ON te.employee_id = e.id
    LEFT JOIN classifications c ON te.classification_id = c.id
    LEFT JOIN jobs j ON te.job_id = j.id
    WHERE te.company_id = ?
  `;
  const params: any[] = [companyId];

  if (dateFrom) { query += " AND te.report_date >= ?"; params.push(dateFrom); }
  if (dateTo) { query += " AND te.report_date <= ?"; params.push(dateTo); }
  if (jobId) { query += " AND te.job_id = ?"; params.push(parseInt(jobId)); }
  if (employeeId) { query += " AND te.employee_id = ?"; params.push(parseInt(employeeId)); }

  query += " ORDER BY te.report_date DESC, e.last_name, e.first_name";

  const rows = sqlite.prepare(query).all(...params);
  return c.json(rows);
});

// ── Add time entry ───────────────────────────────────────────────
dailyReportRoutes.post("/time-entries", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();

  const result = await db.insert(timeEntries).values({
    companyId,
    dailyReportId: body.dailyReportId || null,
    jobId: body.jobId,
    employeeId: body.employeeId,
    reportDate: body.reportDate,
    classificationId: body.classificationId || null,
    hoursRegular: body.hoursRegular || 0,
    hoursOvertime: body.hoursOvertime || 0,
    hoursDouble: body.hoursDouble || 0,
    startTime: body.startTime || null,
    endTime: body.endTime || null,
    workPerformed: body.workPerformed || null,
    notes: body.notes || null,
  }).returning();

  return c.json(result[0], 201);
});

// ── Batch add time entries (for filling crew from assignments) ────
dailyReportRoutes.post("/time-entries/batch", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();
  const entries = body.entries as any[];

  if (!entries?.length) return c.json({ error: "No entries provided" }, 400);

  const results = [];
  for (const entry of entries) {
    const result = await db.insert(timeEntries).values({
      companyId,
      dailyReportId: entry.dailyReportId || null,
      jobId: entry.jobId,
      employeeId: entry.employeeId,
      reportDate: entry.reportDate,
      classificationId: entry.classificationId || null,
      hoursRegular: entry.hoursRegular || 0,
      hoursOvertime: entry.hoursOvertime || 0,
      hoursDouble: entry.hoursDouble || 0,
      startTime: entry.startTime || null,
      endTime: entry.endTime || null,
      workPerformed: entry.workPerformed || null,
      notes: entry.notes || null,
    }).returning();
    results.push(result[0]);
  }

  return c.json(results, 201);
});

// ── Update time entry ────────────────────────────────────────────
dailyReportRoutes.put("/time-entries/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  const updates: any = { updatedAt: sql`(datetime('now'))` };
  const fields = [
    "employeeId", "classificationId", "hoursRegular", "hoursOvertime", "hoursDouble",
    "startTime", "endTime", "workPerformed", "notes"
  ];
  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }

  await db.update(timeEntries)
    .set(updates)
    .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)));

  return c.json({ success: true });
});

// ── Delete time entry ────────────────────────────────────────────
dailyReportRoutes.delete("/time-entries/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  await db.delete(timeEntries)
    .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)));

  return c.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// HELPERS — crew lookup for populating time entries
// ══════════════════════════════════════════════════════════════════

// ── Get active crew for a job (for auto-populating time entries) ──
dailyReportRoutes.get("/crew/:jobId", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const jobId = parseInt(c.req.param("jobId"));

  const crew = sqlite.prepare(`
    SELECT
      e.id, e.first_name, e.last_name, e.employee_number,
      e.classification_id,
      c.name AS classification_name,
      ja.role
    FROM job_assignments ja
    JOIN employees e ON ja.employee_id = e.id
    LEFT JOIN classifications c ON e.classification_id = c.id
    WHERE ja.job_id = ? AND ja.is_active = 1 AND e.company_id = ?
    ORDER BY e.last_name, e.first_name
  `).all(jobId, companyId);

  return c.json(crew);
});

// ══════════════════════════════════════════════════════════════════
// SUMMARY / DASHBOARD STATS
// ══════════════════════════════════════════════════════════════════

dailyReportRoutes.get("/stats/summary", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");

  let dateFilter = "";
  const params: any[] = [companyId];

  if (dateFrom && dateTo) {
    dateFilter = " AND dr.report_date BETWEEN ? AND ?";
    params.push(dateFrom, dateTo);
  }

  const stats = sqlite.prepare(`
    SELECT
      COUNT(*) AS total_reports,
      SUM(CASE WHEN dr.status = 'draft' THEN 1 ELSE 0 END) AS draft_count,
      SUM(CASE WHEN dr.status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
      SUM(CASE WHEN dr.status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed_count,
      (SELECT COUNT(DISTINCT te.employee_id) FROM time_entries te WHERE te.company_id = ?) AS unique_workers,
      (SELECT COALESCE(SUM(te.hours_regular + te.hours_overtime + te.hours_double), 0)
       FROM time_entries te
       JOIN daily_reports dr2 ON te.daily_report_id = dr2.id
       WHERE te.company_id = ?${dateFilter ? dateFilter.replace('dr.', 'dr2.') : ''}) AS total_hours
    FROM daily_reports dr
    WHERE dr.company_id = ?${dateFilter}
  `).get(companyId, companyId, ...params.slice(1), companyId, ...params.slice(1));

  return c.json(stats);
});

export { dailyReportRoutes };
