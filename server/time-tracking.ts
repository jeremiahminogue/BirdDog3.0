import { Hono } from "hono";
import { db, sqlite } from "./db.js";
import {
  timeEntries, liveLocations, jobs, employees, classifications
} from "../shared/schema.js";
import { eq, and, desc, sql, gte, lte, isNull, isNotNull } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";
import { mkdirSync, writeFileSync } from "fs";

const timeTrackingRoutes = new Hono();
timeTrackingRoutes.use("/*", requireAuth);

// ══════════════════════════════════════════════════════════════════
// TIME TRACKING API — serves both office web app and mobile app
// ══════════════════════════════════════════════════════════════════


// ── CLOCK IN ────────────────────────────────────────────────────
// Mobile/tablet sends: jobId, GPS coords, optional photo
// Returns the new time entry (open — no clock_out yet)
timeTrackingRoutes.post("/clock-in", async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();
  const user = c.get("user" as any) as any;

  const {
    employeeId, jobId, classificationId,
    latitude, longitude, accuracy,
    photoBase64, photoFilename,
  } = body;

  if (!employeeId || !jobId) {
    return c.json({ error: "employeeId and jobId are required" }, 400);
  }

  // Check if employee already has an open clock-in
  const openEntry = sqlite.query(`
    SELECT id, job_id FROM time_entries
    WHERE company_id = ? AND employee_id = ? AND clock_in IS NOT NULL AND clock_out IS NULL
    LIMIT 1
  `).get(companyId, employeeId) as any;

  if (openEntry) {
    return c.json({
      error: "Employee already clocked in",
      activeEntry: { id: openEntry.id, jobId: openEntry.job_id }
    }, 409);
  }

  // Check geofence if job has coordinates
  let insideGeofence: boolean | null = null;
  if (latitude && longitude) {
    const job = sqlite.query(`
      SELECT latitude, longitude, geofence_radius FROM jobs WHERE id = ? AND company_id = ?
    `).get(jobId, companyId) as any;

    if (job?.latitude && job?.longitude) {
      const distFeet = haversineDistanceFeet(latitude, longitude, job.latitude, job.longitude);
      insideGeofence = distFeet <= (job.geofence_radius || 300);
    }
  }

  // Save clock-in photo if provided
  let photoUrl: string | null = null;
  if (photoBase64) {
    photoUrl = savePhoto(companyId, employeeId, "clock-in", photoBase64, photoFilename);
  }

  // Reverse geocode address (placeholder — will integrate Google Maps API)
  const clockInAddress = body.address || null;

  const now = new Date().toISOString();
  const reportDate = now.split("T")[0]; // YYYY-MM-DD

  const result = sqlite.query(`
    INSERT INTO time_entries (
      company_id, job_id, employee_id, report_date, classification_id,
      clock_in, clock_in_lat, clock_in_lng,
      clock_in_photo_url, clock_in_inside_geofence, clock_in_address,
      source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    companyId, jobId, employeeId, reportDate, classificationId || null,
    now, latitude || null, longitude || null,
    photoUrl, insideGeofence !== null ? (insideGeofence ? 1 : 0) : null,
    clockInAddress,
    body.source || "mobile", now, now
  ) as any;

  return c.json({ success: true, entry: result });
});


// ── CLOCK OUT ───────────────────────────────────────────────────
// Closes the open time entry, calculates hours
timeTrackingRoutes.post("/clock-out", async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();

  const { timeEntryId, employeeId, latitude, longitude, photoBase64, photoFilename } = body;

  // Find open entry — by ID or by employee's latest open
  let entryId = timeEntryId;
  if (!entryId && employeeId) {
    const open = sqlite.query(`
      SELECT id FROM time_entries
      WHERE company_id = ? AND employee_id = ? AND clock_in IS NOT NULL AND clock_out IS NULL
      ORDER BY clock_in DESC LIMIT 1
    `).get(companyId, employeeId) as any;
    entryId = open?.id;
  }

  if (!entryId) {
    return c.json({ error: "No open time entry found" }, 404);
  }

  const entry = sqlite.query(`
    SELECT * FROM time_entries WHERE id = ? AND company_id = ?
  `).get(entryId, companyId) as any;

  if (!entry) return c.json({ error: "Time entry not found" }, 404);
  if (entry.clock_out) return c.json({ error: "Already clocked out" }, 409);

  // Geofence check
  let insideGeofence: boolean | null = null;
  if (latitude && longitude) {
    const job = sqlite.query(`
      SELECT latitude, longitude, geofence_radius FROM jobs WHERE id = ?
    `).get(entry.job_id) as any;

    if (job?.latitude && job?.longitude) {
      const distFeet = haversineDistanceFeet(latitude, longitude, job.latitude, job.longitude);
      insideGeofence = distFeet <= (job.geofence_radius || 300);
    }
  }

  // Save clock-out photo
  let photoUrl: string | null = null;
  if (photoBase64) {
    photoUrl = savePhoto(companyId, entry.employee_id, "clock-out", photoBase64, photoFilename);
  }

  const now = new Date().toISOString();
  const clockIn = new Date(entry.clock_in);
  const clockOut = new Date(now);
  const totalMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000);
  const breakMins = entry.break_minutes || 0;
  const workedMinutes = Math.max(0, totalMinutes - breakMins);

  // Calculate hours buckets (8hr regular, then OT, then double after 12)
  const workedHours = workedMinutes / 60;
  const hoursRegular = Math.min(workedHours, 8);
  const hoursOvertime = Math.min(Math.max(workedHours - 8, 0), 4);
  const hoursDouble = Math.max(workedHours - 12, 0);

  const clockOutAddress = body.address || null;

  sqlite.query(`
    UPDATE time_entries SET
      clock_out = ?, clock_out_lat = ?, clock_out_lng = ?,
      clock_out_photo_url = ?, clock_out_inside_geofence = ?,
      clock_out_address = ?,
      hours_regular = ?, hours_overtime = ?, hours_double = ?,
      end_time = ?, updated_at = ?
    WHERE id = ?
  `).run(
    now, latitude || null, longitude || null,
    photoUrl, insideGeofence !== null ? (insideGeofence ? 1 : 0) : null,
    clockOutAddress,
    Math.round(hoursRegular * 100) / 100,
    Math.round(hoursOvertime * 100) / 100,
    Math.round(hoursDouble * 100) / 100,
    clockOut.toISOString().slice(11, 16), // HH:MM for legacy compat
    now, entryId
  );

  const updated = sqlite.query(`SELECT * FROM time_entries WHERE id = ?`).get(entryId);
  return c.json({ success: true, entry: updated });
});


// ── BREAK / LUNCH ───────────────────────────────────────────────
timeTrackingRoutes.post("/break", async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();
  const { timeEntryId, employeeId, action } = body; // action: "lunch-start" | "lunch-end" | "add-break"

  let entryId = timeEntryId;
  if (!entryId && employeeId) {
    const open = sqlite.query(`
      SELECT id FROM time_entries
      WHERE company_id = ? AND employee_id = ? AND clock_in IS NOT NULL AND clock_out IS NULL
      ORDER BY clock_in DESC LIMIT 1
    `).get(companyId, employeeId) as any;
    entryId = open?.id;
  }
  if (!entryId) return c.json({ error: "No open time entry found" }, 404);

  const now = new Date().toISOString();

  if (action === "lunch-start") {
    sqlite.query(`UPDATE time_entries SET lunch_out = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(now, now, entryId, companyId);
  } else if (action === "lunch-end") {
    const entry = sqlite.query(`SELECT lunch_out FROM time_entries WHERE id = ? AND company_id = ?`)
      .get(entryId, companyId) as any;
    if (entry?.lunch_out) {
      const lunchMinutes = Math.round((new Date(now).getTime() - new Date(entry.lunch_out).getTime()) / 60000);
      sqlite.query(`UPDATE time_entries SET lunch_in = ?, break_minutes = COALESCE(break_minutes, 0) + ?, updated_at = ? WHERE id = ? AND company_id = ?`)
        .run(now, lunchMinutes, now, entryId, companyId);
    }
  } else if (action === "add-break") {
    const minutes = body.minutes || 15;
    sqlite.query(`UPDATE time_entries SET break_minutes = COALESCE(break_minutes, 0) + ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(minutes, now, entryId, companyId);
  }

  const updated = sqlite.query(`SELECT * FROM time_entries WHERE id = ?`).get(entryId);
  return c.json({ success: true, entry: updated });
});


// ── LOCATION PING ───────────────────────────────────────────────
// Mobile sends periodic GPS updates while clocked in
timeTrackingRoutes.post("/location-ping", async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();

  const {
    employeeId, latitude, longitude, accuracy, altitude,
    heading, speed, batteryLevel, isCharging, address
  } = body;

  if (!employeeId || !latitude || !longitude) {
    return c.json({ error: "employeeId, latitude, longitude required" }, 400);
  }

  // Find active time entry and assigned job
  const activeEntry = sqlite.query(`
    SELECT te.id, te.job_id FROM time_entries te
    WHERE te.company_id = ? AND te.employee_id = ? AND te.clock_in IS NOT NULL AND te.clock_out IS NULL
    ORDER BY te.clock_in DESC LIMIT 1
  `).get(companyId, employeeId) as any;

  // Geofence check against job
  let insideGeofence: boolean | null = null;
  let jobId = activeEntry?.job_id || null;
  if (jobId && latitude && longitude) {
    const job = sqlite.query(`
      SELECT latitude, longitude, geofence_radius FROM jobs WHERE id = ?
    `).get(jobId) as any;
    if (job?.latitude && job?.longitude) {
      const distFeet = haversineDistanceFeet(latitude, longitude, job.latitude, job.longitude);
      insideGeofence = distFeet <= (job.geofence_radius || 300);
    }
  }

  sqlite.query(`
    INSERT INTO live_locations (
      company_id, employee_id, latitude, longitude, accuracy, altitude,
      heading, speed, battery_level, is_charging, address,
      job_id, inside_geofence, time_entry_id, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    companyId, employeeId, latitude, longitude, accuracy || null, altitude || null,
    heading || null, speed || null, batteryLevel || null,
    isCharging !== undefined ? (isCharging ? 1 : 0) : null,
    address || null,
    jobId, insideGeofence !== null ? (insideGeofence ? 1 : 0) : null,
    activeEntry?.id || null,
    new Date().toISOString()
  );

  return c.json({ success: true });
});


// ══════════════════════════════════════════════════════════════════
// OFFICE / ADMIN ENDPOINTS
// ══════════════════════════════════════════════════════════════════


// ── CREW MAP — who's where right now ────────────────────────────
timeTrackingRoutes.get("/crew-map", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);

  // Latest location per employee who has clocked in today
  const locations = sqlite.query(`
    SELECT
      ll.employee_id,
      e.first_name, e.last_name, e.employee_number, e.photo_url AS employee_photo,
      ll.latitude, ll.longitude, ll.accuracy, ll.battery_level, ll.is_charging,
      ll.speed, ll.heading, ll.address, ll.inside_geofence,
      ll.recorded_at,
      j.name AS job_name, j.job_number, j.address AS job_address,
      te.clock_in, te.source
    FROM live_locations ll
    INNER JOIN (
      SELECT employee_id, MAX(id) AS max_id
      FROM live_locations
      WHERE company_id = ?
      GROUP BY employee_id
    ) latest ON ll.id = latest.max_id
    LEFT JOIN employees e ON ll.employee_id = e.id
    LEFT JOIN jobs j ON ll.job_id = j.id
    LEFT JOIN time_entries te ON ll.time_entry_id = te.id
    WHERE ll.company_id = ?
      AND ll.recorded_at >= datetime('now', '-8 hours')
    ORDER BY e.last_name, e.first_name
  `).all(companyId, companyId);

  // Also get job pins for the map
  const jobPins = sqlite.query(`
    SELECT id, name, job_number, address, latitude, longitude, geofence_radius, status
    FROM jobs
    WHERE company_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
      AND status IN ('active', 'planning')
  `).all(companyId);

  return c.json({ locations, jobPins });
});


// ── ACTIVE CLOCKS — who's clocked in right now ─────────────────
timeTrackingRoutes.get("/active", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);

  const active = sqlite.query(`
    SELECT
      te.id, te.employee_id, te.job_id, te.clock_in, te.source,
      te.clock_in_lat, te.clock_in_lng, te.clock_in_inside_geofence,
      te.clock_in_photo_url, te.clock_in_address,
      te.break_minutes, te.lunch_out,
      e.first_name, e.last_name, e.employee_number, e.photo_url AS employee_photo,
      j.name AS job_name, j.job_number,
      c.name AS classification_name
    FROM time_entries te
    LEFT JOIN employees e ON te.employee_id = e.id
    LEFT JOIN jobs j ON te.job_id = j.id
    LEFT JOIN classifications c ON te.classification_id = c.id
    WHERE te.company_id = ? AND te.clock_in IS NOT NULL AND te.clock_out IS NULL
    ORDER BY te.clock_in DESC
  `).all(companyId);

  return c.json({ active, count: active.length });
});


// ── TIME ENTRIES LIST — filterable, office review ───────────────
timeTrackingRoutes.get("/entries", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const jobId = c.req.query("jobId");
  const employeeId = c.req.query("employeeId");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");
  const source = c.req.query("source");
  const flagged = c.req.query("flagged"); // "true" = outside geofence

  let query = `
    SELECT
      te.*,
      e.first_name, e.last_name, e.employee_number,
      j.name AS job_name, j.job_number,
      c.name AS classification_name
    FROM time_entries te
    LEFT JOIN employees e ON te.employee_id = e.id
    LEFT JOIN jobs j ON te.job_id = j.id
    LEFT JOIN classifications c ON te.classification_id = c.id
    WHERE te.company_id = ?
  `;
  const params: any[] = [companyId];

  if (jobId) { query += ` AND te.job_id = ?`; params.push(Number(jobId)); }
  if (employeeId) { query += ` AND te.employee_id = ?`; params.push(Number(employeeId)); }
  if (dateFrom) { query += ` AND te.report_date >= ?`; params.push(dateFrom); }
  if (dateTo) { query += ` AND te.report_date <= ?`; params.push(dateTo); }
  if (source) { query += ` AND te.source = ?`; params.push(source); }
  if (flagged === "true") {
    query += ` AND (
      te.clock_in IS NULL OR te.clock_in = ''
      OR te.clock_out IS NULL OR te.clock_out = ''
      OR te.clock_in_inside_geofence = 0
      OR te.clock_out_inside_geofence = 0
      OR ((COALESCE(te.hours_regular,0) + COALESCE(te.hours_overtime,0) + COALESCE(te.hours_double,0)) >= 6 AND COALESCE(te.break_minutes, 0) = 0)
      OR (COALESCE(te.hours_regular,0) + COALESCE(te.hours_overtime,0) + COALESCE(te.hours_double,0)) > 16
    )`;
  }

  query += ` ORDER BY te.report_date DESC, te.clock_in DESC LIMIT 500`;

  const entries = sqlite.query(query).all(...params);
  return c.json({ entries });
});


// ── SINGLE ENTRY — detail view ──────────────────────────────────
timeTrackingRoutes.get("/entries/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = Number(c.req.param("id"));

  const entry = sqlite.query(`
    SELECT
      te.*,
      e.first_name, e.last_name, e.employee_number, e.photo_url AS employee_photo,
      j.name AS job_name, j.job_number, j.address AS job_address,
      j.latitude AS job_lat, j.longitude AS job_lng, j.geofence_radius,
      c.name AS classification_name
    FROM time_entries te
    LEFT JOIN employees e ON te.employee_id = e.id
    LEFT JOIN jobs j ON te.job_id = j.id
    LEFT JOIN classifications c ON te.classification_id = c.id
    WHERE te.id = ? AND te.company_id = ?
  `).get(id, companyId);

  if (!entry) return c.json({ error: "Not found" }, 404);

  // Get location trail for this entry
  const locationTrail = sqlite.query(`
    SELECT latitude, longitude, accuracy, speed, battery_level, recorded_at
    FROM live_locations
    WHERE time_entry_id = ? AND company_id = ?
    ORDER BY recorded_at ASC
  `).all(id, companyId);

  return c.json({ entry, locationTrail });
});


// ── MANUAL ENTRY — office creates time entry ────────────────────
timeTrackingRoutes.post("/entries", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();
  const now = new Date().toISOString();

  const {
    employeeId, jobId, reportDate, classificationId,
    hoursRegular, hoursOvertime, hoursDouble,
    startTime, endTime, workPerformed, notes
  } = body;

  if (!employeeId || !jobId || !reportDate) {
    return c.json({ error: "employeeId, jobId, reportDate required" }, 400);
  }

  const result = sqlite.query(`
    INSERT INTO time_entries (
      company_id, job_id, employee_id, report_date, classification_id,
      hours_regular, hours_overtime, hours_double,
      start_time, end_time, work_performed, notes,
      source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
    RETURNING *
  `).get(
    companyId, jobId, employeeId, reportDate, classificationId || null,
    hoursRegular || 0, hoursOvertime || 0, hoursDouble || 0,
    startTime || null, endTime || null, workPerformed || null, notes || null,
    now, now
  );

  return c.json({ success: true, entry: result });
});


// ── EDIT ENTRY — office adjusts hours/notes ─────────────────────
timeTrackingRoutes.put("/entries/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const now = new Date().toISOString();

  const fields: string[] = [];
  const params: any[] = [];

  const allowedFields: Record<string, string> = {
    jobId: "job_id", employeeId: "employee_id", reportDate: "report_date",
    classificationId: "classification_id",
    hoursRegular: "hours_regular", hoursOvertime: "hours_overtime", hoursDouble: "hours_double",
    startTime: "start_time", endTime: "end_time",
    clockIn: "clock_in", clockOut: "clock_out",
    breakMinutes: "break_minutes",
    workPerformed: "work_performed", notes: "notes",
  };

  for (const [jsKey, dbCol] of Object.entries(allowedFields)) {
    if (body[jsKey] !== undefined) {
      fields.push(`${dbCol} = ?`);
      params.push(body[jsKey]);
    }
  }

  if (fields.length === 0) return c.json({ error: "No fields to update" }, 400);

  fields.push("updated_at = ?");
  params.push(now);
  params.push(id, companyId);

  sqlite.query(`UPDATE time_entries SET ${fields.join(", ")} WHERE id = ? AND company_id = ?`).run(...params);

  const updated = sqlite.query(`SELECT * FROM time_entries WHERE id = ?`).get(id);
  return c.json({ success: true, entry: updated });
});


// ── ADJUST ENTRY (with audit trail) ─────────────────────────────
// Changes fields AND logs who changed what and why
timeTrackingRoutes.post("/entries/:id/adjust", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = Number(c.req.param("id"));
  const user = c.get("user") as any;
  const userId = user?.employeeId || user?.id || 0;
  const body = await c.req.json();
  const { changes, reason } = body;

  if (!reason || !reason.trim()) return c.json({ error: "Reason is required for adjustments" }, 400);
  if (!changes || Object.keys(changes).length === 0) return c.json({ error: "No changes provided" }, 400);

  // Get current entry
  const current = sqlite.query(
    `SELECT * FROM time_entries WHERE id = ? AND company_id = ?`
  ).get(id, companyId) as any;
  if (!current) return c.json({ error: "Entry not found" }, 404);

  const allowedFields: Record<string, string> = {
    clockIn: "clock_in", clockOut: "clock_out",
    hoursRegular: "hours_regular", hoursOvertime: "hours_overtime", hoursDouble: "hours_double",
    breakMinutes: "break_minutes", jobId: "job_id",
    workPerformed: "work_performed", notes: "notes",
  };

  const updateFields: string[] = [];
  const updateParams: any[] = [];

  for (const [jsKey, dbCol] of Object.entries(allowedFields)) {
    if (changes[jsKey] !== undefined) {
      const oldVal = current[dbCol];
      const newVal = changes[jsKey];

      // Log the adjustment
      sqlite.run(
        `INSERT INTO time_entry_adjustments (time_entry_id, adjusted_by, field_changed, old_value, new_value, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, userId || 0, dbCol, String(oldVal ?? ""), String(newVal ?? ""), reason.trim()]
      );

      updateFields.push(`${dbCol} = ?`);
      updateParams.push(newVal);
    }
  }

  if (updateFields.length === 0) return c.json({ error: "No valid fields to adjust" }, 400);

  updateFields.push("updated_at = ?");
  updateParams.push(new Date().toISOString());
  updateParams.push(id, companyId);

  sqlite.query(`UPDATE time_entries SET ${updateFields.join(", ")} WHERE id = ? AND company_id = ?`).run(...updateParams);

  const updated = sqlite.query(`SELECT * FROM time_entries WHERE id = ?`).get(id);
  return c.json({ success: true, entry: updated });
});


// ── GET ADJUSTMENTS for an entry ────────────────────────────────
timeTrackingRoutes.get("/entries/:id/adjustments", requireRole("super_admin"), async (c) => {
  const id = Number(c.req.param("id"));

  const adjustments = sqlite.query(`
    SELECT a.*, e.first_name, e.last_name
    FROM time_entry_adjustments a
    LEFT JOIN employees e ON a.adjusted_by = e.id
    WHERE a.time_entry_id = ?
    ORDER BY a.adjusted_at DESC
  `).all(id);

  return c.json({ adjustments });
});


// ── DELETE ENTRY ─────────────────────────────────────────────────
timeTrackingRoutes.delete("/entries/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = Number(c.req.param("id"));

  sqlite.query(`DELETE FROM time_entries WHERE id = ? AND company_id = ?`).run(id, companyId);
  return c.json({ success: true });
});


// ── STATS / SUMMARY ─────────────────────────────────────────────
timeTrackingRoutes.get("/stats/summary", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const dateFrom = c.req.query("dateFrom") || new Date().toISOString().split("T")[0];
  const dateTo = c.req.query("dateTo") || dateFrom;

  const stats = sqlite.query(`
    SELECT
      COUNT(*) AS total_entries,
      COUNT(CASE WHEN clock_in IS NOT NULL AND clock_out IS NULL THEN 1 END) AS currently_clocked_in,
      COUNT(DISTINCT employee_id) AS unique_employees,
      COUNT(DISTINCT job_id) AS unique_jobs,
      COALESCE(SUM(hours_regular), 0) AS total_regular,
      COALESCE(SUM(hours_overtime), 0) AS total_overtime,
      COALESCE(SUM(hours_double), 0) AS total_double,
      COALESCE(SUM(hours_regular + hours_overtime + hours_double), 0) AS total_hours,
      COUNT(CASE WHEN clock_in_inside_geofence = 0 THEN 1 END) AS flagged_clock_ins,
      COUNT(CASE WHEN clock_out_inside_geofence = 0 THEN 1 END) AS flagged_clock_outs,
      COUNT(CASE WHEN source = 'mobile' THEN 1 END) AS mobile_entries,
      COUNT(CASE WHEN source = 'tablet' THEN 1 END) AS tablet_entries,
      COUNT(CASE WHEN source = 'manual' THEN 1 END) AS manual_entries
    FROM time_entries
    WHERE company_id = ? AND report_date >= ? AND report_date <= ?
  `).get(companyId, dateFrom, dateTo) as any;

  return c.json({
    totalEntries: stats.total_entries,
    currentlyClockedIn: stats.currently_clocked_in,
    uniqueEmployees: stats.unique_employees,
    uniqueJobs: stats.unique_jobs,
    hours: {
      regular: Math.round(stats.total_regular * 100) / 100,
      overtime: Math.round(stats.total_overtime * 100) / 100,
      double: Math.round(stats.total_double * 100) / 100,
      total: Math.round(stats.total_hours * 100) / 100,
    },
    flagged: {
      clockIns: stats.flagged_clock_ins,
      clockOuts: stats.flagged_clock_outs,
    },
    sources: {
      mobile: stats.mobile_entries,
      tablet: stats.tablet_entries,
      manual: stats.manual_entries,
    },
  });
});


// ── EMPLOYEE STATUS — who's on/off the clock ────────────────────
timeTrackingRoutes.get("/employee-status", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);

  const statuses = sqlite.query(`
    SELECT
      e.id, e.first_name, e.last_name, e.employee_number, e.photo_url,
      e.classification_id,
      cl.name AS classification_name,
      te.id AS active_entry_id,
      te.job_id AS active_job_id,
      te.clock_in AS active_clock_in,
      te.source AS active_source,
      j.name AS active_job_name,
      j.job_number AS active_job_number
    FROM employees e
    LEFT JOIN classifications cl ON e.classification_id = cl.id
    LEFT JOIN time_entries te ON te.employee_id = e.id
      AND te.clock_in IS NOT NULL AND te.clock_out IS NULL
    LEFT JOIN jobs j ON te.job_id = j.id
    WHERE e.company_id = ? AND e.status = 'active'
    ORDER BY te.clock_in IS NULL, e.last_name, e.first_name
  `).all(companyId);

  return c.json({ employees: statuses });
});


// ── JOB GEOCODE — set lat/lng for a job from address ────────────
// For now, accepts manual coordinates. Will integrate Google Geocoding API.
timeTrackingRoutes.put("/jobs/:id/location", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const jobId = Number(c.req.param("id"));
  const body = await c.req.json();
  const { latitude, longitude, geofenceRadius } = body;

  if (!latitude || !longitude) {
    return c.json({ error: "latitude and longitude required" }, 400);
  }

  const fields = ["latitude = ?", "longitude = ?", "updated_at = ?"];
  const params: any[] = [latitude, longitude, new Date().toISOString()];

  if (geofenceRadius !== undefined) {
    fields.push("geofence_radius = ?");
    params.push(geofenceRadius);
  }

  params.push(jobId, companyId);
  sqlite.query(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ? AND company_id = ?`).run(...params);

  const updated = sqlite.query(`SELECT id, name, job_number, address, latitude, longitude, geofence_radius FROM jobs WHERE id = ?`).get(jobId);
  return c.json({ success: true, job: updated });
});


// ── LOCATION HISTORY — GPS trail for an employee on a date ──────
timeTrackingRoutes.get("/location-history/:employeeId", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const employeeId = Number(c.req.param("employeeId"));
  const date = c.req.query("date") || new Date().toISOString().split("T")[0];

  const trail = sqlite.query(`
    SELECT ll.latitude, ll.longitude, ll.accuracy, ll.speed, ll.heading,
           ll.battery_level, ll.address, ll.inside_geofence, ll.recorded_at,
           j.name AS job_name, j.job_number
    FROM live_locations ll
    LEFT JOIN jobs j ON ll.job_id = j.id
    WHERE ll.company_id = ? AND ll.employee_id = ?
      AND date(ll.recorded_at) = ?
    ORDER BY ll.recorded_at ASC
  `).all(companyId, employeeId, date);

  return c.json({ trail });
});


// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════

// Haversine distance in feet between two GPS coordinates
function haversineDistanceFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Save base64 photo to disk, return URL path
function savePhoto(companyId: number, employeeId: number, type: string, base64: string, filename?: string): string {
  const dir = `/app/data/photos/time-tracking`;
  mkdirSync(dir, { recursive: true });
  const ext = filename?.split(".").pop() || "jpg";
  const ts = Date.now();
  const fname = `${type}-${employeeId}-${ts}.${ext}`;
  const buffer = Buffer.from(base64, "base64");
  writeFileSync(`${dir}/${fname}`, buffer);
  return `/api/photos/time-tracking/${fname}`;
}


export { timeTrackingRoutes };
