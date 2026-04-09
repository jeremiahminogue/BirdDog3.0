import { Hono } from "hono";
import { db, sqlite } from "./db.js";
import {
  employees,
  jobs,
  jobAssignments,
  timeEntries,
  classifications,
  assets,
  jobCodes,
  toolReports,
  toolHistory,
} from "../shared/schema.js";
import { eq, and, desc, gte, lte, isNull } from "drizzle-orm";
import { logToolEvent } from "./tool-management.js";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";
import { dirname, resolve } from "path";

const field = new Hono();

// All field routes require auth
field.use("/*", requireAuth);

// Field routes accessible by: field_staff, foreman, pm, admin, super_admin
field.use("/*", requireRole("field_staff", "foreman", "pm", "admin"));

// ── Helper: get employeeId from user ────────────────────────────
function getEmployeeId(c: any): number {
  const user = c.get("user");
  if (!user?.employeeId) {
    throw new Error("NO_EMPLOYEE_LINK");
  }
  return user.employeeId;
}

// ── GET /field/my-day — Home screen data ────────────────────────
field.get("/my-day", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    // Get employee info
    const [emp] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);

    if (!emp) return c.json({ error: "Employee not found" }, 404);

    // Get active assignment
    const activeAssignment = await db
      .select({
        id: jobAssignments.id,
        jobId: jobs.id,
        jobNumber: jobs.jobNumber,
        jobName: jobs.name,
        address: jobs.address,
      })
      .from(jobAssignments)
      .innerJoin(jobs, eq(jobAssignments.jobId, jobs.id))
      .where(
        and(
          eq(jobAssignments.employeeId, employeeId),
          eq(jobAssignments.isActive, true)
        )
      )
      .limit(1);

    // Get today's time entry (clock-based)
    const today = new Date().toISOString().split("T")[0];
    const todayEntries = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.reportDate, today)
        )
      );

    // Find active clock-in (has clockIn but no clockOut)
    const activeEntry = todayEntries.find((e) => e.clockIn && !e.clockOut);

    // Sum today's hours
    const todayHours = todayEntries.reduce(
      (sum, e) =>
        sum +
        (e.hoursRegular || 0) +
        (e.hoursOvertime || 0) +
        (e.hoursDouble || 0),
      0
    );

    // Get week hours (Mon-Sun)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    const mondayStr = monday.toISOString().split("T")[0];

    const weekEntries = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.companyId, companyId),
          gte(timeEntries.reportDate, mondayStr),
          lte(timeEntries.reportDate, today)
        )
      );

    const weeklyHours = weekEntries.reduce(
      (sum, e) =>
        sum +
        (e.hoursRegular || 0) +
        (e.hoursOvertime || 0) +
        (e.hoursDouble || 0),
      0
    );

    // Get unresolved issues (for banner)
    const unresolvedIssues = sqlite.query(`
      SELECT i.id, i.issue_type, i.issue_details, i.status, i.report_date,
             te.clock_in, te.clock_out, j.job_number, j.name as job_name
      FROM time_entry_issues i
      LEFT JOIN time_entries te ON i.time_entry_id = te.id
      LEFT JOIN jobs j ON te.job_id = j.id
      WHERE i.company_id = ? AND i.employee_id = ?
        AND i.status IN ('pending', 'rejected')
      ORDER BY i.report_date DESC
      LIMIT 5
    `).all(companyId, employeeId);

    return c.json({
      employee: {
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        photoUrl: null, // TODO: wire up photo path
      },
      currentAssignment: activeAssignment[0]
        ? {
            jobId: activeAssignment[0].jobId,
            jobNumber: activeAssignment[0].jobNumber,
            jobName: activeAssignment[0].jobName,
            address: activeAssignment[0].address,
            foremanName: null, // TODO: look up foreman
          }
        : null,
      todayEntry: activeEntry
        ? {
            id: activeEntry.id,
            clockInTime: activeEntry.clockIn,
            clockOutTime: activeEntry.clockOut,
            regularHours: activeEntry.hoursRegular || 0,
            overtimeHours: activeEntry.hoursOvertime || 0,
            status: activeEntry.source || "mobile",
          }
        : null,
      todayHours,
      weeklyHours,
      unresolvedIssues,
      checklistCount: 0, // TODO: wire up when checklist is built
    });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json(
        { error: "Your user account is not linked to an employee record. Ask your admin to link it." },
        400
      );
    }
    throw err;
  }
});

// ── GET /field/my-assignments — Active job assignments ──────────
field.get("/my-assignments", async (c) => {
  try {
    const employeeId = getEmployeeId(c);

    const assignments = await db
      .select({
        id: jobAssignments.id,
        jobId: jobs.id,
        jobNumber: jobs.jobNumber,
        jobName: jobs.name,
        address: jobs.address,
        lat: jobs.latitude,
        lng: jobs.longitude,
      })
      .from(jobAssignments)
      .innerJoin(jobs, eq(jobAssignments.jobId, jobs.id))
      .where(
        and(
          eq(jobAssignments.employeeId, employeeId),
          eq(jobAssignments.isActive, true)
        )
      );

    return c.json({
      assignments: assignments.map((a) => ({
        ...a,
        foremanName: null,
        geofenceRadius: null,
      })),
    });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── GET /field/all-jobs — Every active job in the company ───────
field.get("/all-jobs", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    // All active/planning jobs for this company
    const allJobs = await db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        jobName: jobs.name,
        address: jobs.address,
        lat: jobs.latitude,
        lng: jobs.longitude,
        geofenceRadius: jobs.geofenceRadius,
        status: jobs.status,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, companyId),
          // include active + planning
        )
      )
      .orderBy(jobs.jobNumber);

    // Filter to active/planning only (SQLite doesn't have IN with drizzle easily)
    const activeJobs = allJobs.filter(
      (j) => j.status === "active" || j.status === "planning"
    );

    // Get this employee's assigned job IDs
    const myAssignments = await db
      .select({ jobId: jobAssignments.jobId })
      .from(jobAssignments)
      .where(
        and(
          eq(jobAssignments.employeeId, employeeId),
          eq(jobAssignments.isActive, true)
        )
      );
    const assignedJobIds = new Set(myAssignments.map((a) => a.jobId));

    return c.json({
      jobs: activeJobs.map((j) => ({
        id: j.id,
        jobNumber: j.jobNumber,
        jobName: j.jobName,
        address: j.address,
        lat: j.lat,
        lng: j.lng,
        geofenceRadius: j.geofenceRadius,
        isAssigned: assignedJobIds.has(j.id),
      })),
    });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── GET /field/job-codes — Active job codes for clock-in picker ─
field.get("/job-codes", async (c) => {
  const companyId = getCompanyId(c);
  const rows = await db
    .select({
      id: jobCodes.id,
      code: jobCodes.code,
      description: jobCodes.description,
      sortOrder: jobCodes.sortOrder,
    })
    .from(jobCodes)
    .where(
      and(
        eq(jobCodes.companyId, companyId),
        eq(jobCodes.isActive, true)
      )
    )
    .orderBy(jobCodes.sortOrder, jobCodes.code);
  return c.json({ jobCodes: rows });
});

// ── GET /field/clock-status — Am I clocked in? ──────────────────
field.get("/clock-status", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    // Find ANY open entry (not just today — catches forgot-to-clock-out)
    const entries = await db
      .select({
        id: timeEntries.id,
        jobId: timeEntries.jobId,
        clockIn: timeEntries.clockIn,
        clockOut: timeEntries.clockOut,
        jobNumber: jobs.jobNumber,
        jobName: jobs.name,
      })
      .from(timeEntries)
      .innerJoin(jobs, eq(timeEntries.jobId, jobs.id))
      .where(
        and(
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.companyId, companyId),
          isNull(timeEntries.clockOut)
        )
      );

    const active = entries.find((e) => e.clockIn && !e.clockOut);

    return c.json({
      clockedIn: !!active,
      currentEntry: active
        ? {
            id: active.id,
            jobId: active.jobId,
            jobNumber: active.jobNumber,
            jobName: active.jobName,
            clockInTime: active.clockIn,
          }
        : null,
    });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ clockedIn: false, currentEntry: null });
    }
    throw err;
  }
});

// ── POST /field/clock-in — Clock in with GPS ────────────────────
field.post("/clock-in", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);
    const { jobId, lat, lng, jobCodeId, outsideGeofence, deviceTimestamp } = await c.req.json();

    if (!jobId) return c.json({ error: "jobId required" }, 400);

    // Use device timestamp if provided (offline sync), otherwise server time
    const now = deviceTimestamp || new Date().toISOString();
    const today = now.split("T")[0];

    // Only block if there's an OPEN entry (not clocked out yet).
    // Multiple completed entries per day are fine — lunch, split shifts, etc.
    const openEntries = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.companyId, companyId),
          isNull(timeEntries.clockOut)
        )
      );

    const openEntry = openEntries.find((e) => e.clockIn && !e.clockOut);
    if (openEntry) {
      return c.json(
        { error: "Already clocked in. Clock out first." },
        400
      );
    }

    // Get employee's classification
    const [emp] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);

    // Geofence: calculate server-side from job GPS + employee GPS
    let insideGeofence: boolean | null = null;
    if (lat && lng) {
      const [job] = await db
        .select({ lat: jobs.latitude, lng: jobs.longitude, radius: jobs.geofenceRadius })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (job && job.lat && job.lng && !(job.lat === 0 && job.lng === 0)) {
        const R = 6371000;
        const dLat = ((job.lat - lat) * Math.PI) / 180;
        const dLng = ((job.lng - lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((lat * Math.PI) / 180) *
            Math.cos((job.lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const radius = job.radius || 150;
        insideGeofence = dist <= radius;
      }
    }

    // If mobile flagged as outside, trust that too
    if (outsideGeofence === true || outsideGeofence === "true") {
      insideGeofence = false;
    }

    const result = await db
      .insert(timeEntries)
      .values({
        companyId,
        employeeId,
        jobId,
        reportDate: today,
        classificationId: emp?.classificationId || null,
        jobCodeId: jobCodeId || null,
        clockIn: now,
        clockInLat: lat || null,
        clockInLng: lng || null,
        clockInInsideGeofence: insideGeofence,
        source: "mobile",
        hoursRegular: 0,
        hoursOvertime: 0,
        hoursDouble: 0,
      })
      .returning({ id: timeEntries.id });

    return c.json({
      timeEntryId: result[0].id,
      clockedInAt: now,
      geofenceStatus: insideGeofence === null ? "unknown" : insideGeofence ? "inside" : "outside",
    });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── POST /field/clock-out — Clock out with GPS + auto-calc hours
field.post("/clock-out", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);
    const { timeEntryId, lat, lng, deviceTimestamp } = await c.req.json();

    if (!timeEntryId) return c.json({ error: "timeEntryId required" }, 400);

    // Use device timestamp if provided (offline sync), otherwise server time
    const now = deviceTimestamp || new Date().toISOString();

    // Find the entry
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.id, timeEntryId),
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.companyId, companyId)
        )
      )
      .limit(1);

    if (!entry) return c.json({ error: "Time entry not found" }, 404);
    if (!entry.clockIn) return c.json({ error: "Not clocked in" }, 400);
    if (entry.clockOut) return c.json({ error: "Already clocked out" }, 400);

    const clockInTime = new Date(entry.clockIn).getTime();
    const clockOutTime = new Date(now).getTime();
    const totalMinutes = (clockOutTime - clockInTime) / 60000;
    let breakMins = entry.breakMinutes || 0;

    // Auto-deduct 30-minute lunch for 6+ hour shifts (if enabled)
    let lunchDeducted = false;
    const lunchSetting = sqlite.query(
      `SELECT value FROM settings WHERE company_id = ? AND key = 'autoDeductLunch'`
    ).get(companyId) as any;
    if (lunchSetting?.value === "true" && totalMinutes >= 300 && breakMins === 0) {
      breakMins = 30;
      lunchDeducted = true;
    }

    const workedMinutes = Math.max(0, totalMinutes - breakMins);
    const workedHours = workedMinutes / 60;

    // Split into regular/OT/DT (8hr regular, next 2 OT, rest DT)
    const regularHours = Math.min(workedHours, 8);
    const overtimeHours = Math.min(Math.max(workedHours - 8, 0), 2);
    const doubleTimeHours = Math.max(workedHours - 10, 0);

    // Geofence: calculate server-side for clock-out too
    let outInsideGeofence: boolean | null = null;
    if (lat && lng) {
      const [job] = await db
        .select({ lat: jobs.latitude, lng: jobs.longitude, radius: jobs.geofenceRadius })
        .from(jobs)
        .where(eq(jobs.id, entry.jobId))
        .limit(1);

      if (job && job.lat && job.lng && !(job.lat === 0 && job.lng === 0)) {
        const R = 6371000;
        const dLat = ((job.lat - lat) * Math.PI) / 180;
        const dLng = ((job.lng - lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((lat * Math.PI) / 180) *
            Math.cos((job.lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const radius = job.radius || 150;
        outInsideGeofence = dist <= radius;
      }
    }

    await db
      .update(timeEntries)
      .set({
        clockOut: now,
        clockOutLat: lat || null,
        clockOutLng: lng || null,
        clockOutInsideGeofence: outInsideGeofence,
        breakMinutes: breakMins,
        hoursRegular: Math.round(regularHours * 100) / 100,
        hoursOvertime: Math.round(overtimeHours * 100) / 100,
        hoursDouble: Math.round(doubleTimeHours * 100) / 100,
      })
      .where(eq(timeEntries.id, timeEntryId));

    const totalHours =
      Math.round((regularHours + overtimeHours + doubleTimeHours) * 100) / 100;

    return c.json({
      regularHours: Math.round(regularHours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
      doubleTimeHours: Math.round(doubleTimeHours * 100) / 100,
      totalHours,
      lunchDeducted,
      breakMinutes: breakMins,
    });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── POST /field/clock-photo/:id — Upload clock-in/out photo ─────
field.post("/clock-photo/:id", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);
    const entryId = parseInt(c.req.param("id"));

    // Verify ownership
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.id, entryId),
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.companyId, companyId)
        )
      )
      .limit(1);

    if (!entry) return c.json({ error: "Time entry not found" }, 404);

    const body = await c.req.parseBody();
    const file = body["photo"];
    // Explicit type from mobile: "clock-in" or "clock-out"
    const photoType = (body["type"] as string) || c.req.query("type") || "";

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No photo uploaded" }, 400);
    }

    // Save to data/photos directory
    const dataDir = process.env.DB_PATH
      ? dirname(process.env.DB_PATH)
      : "./data";
    const photosDir = resolve(`${dataDir}/photos`);
    const ext = file.name?.split(".").pop() || "jpg";
    const filename = `clock-${entryId}-${Date.now()}.${ext}`;
    const filepath = resolve(photosDir, filename);

    // Ensure photos directory exists
    const { mkdir } = await import("fs/promises");
    await mkdir(photosDir, { recursive: true });

    const buffer = await file.arrayBuffer();
    await Bun.write(filepath, buffer);

    const photoUrl = `/api/photos/${filename}`;

    // Use explicit type if provided, otherwise fall back to state detection
    const isClockOut = photoType === "clock-out" || (photoType !== "clock-in" && !!entry.clockOut);

    if (isClockOut) {
      await db
        .update(timeEntries)
        .set({ clockOutPhotoUrl: photoUrl })
        .where(eq(timeEntries.id, entryId));
    } else {
      await db
        .update(timeEntries)
        .set({ clockInPhotoUrl: photoUrl })
        .where(eq(timeEntries.id, entryId));
    }

    return c.json({ url: photoUrl, type: isClockOut ? "clock-out" : "clock-in" });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── GET /field/my-week — Day-by-day hours for current + last week ──
field.get("/my-week", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const dayOfWeek = now.getDay();

    // Monday of this week
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    const mondayStr = monday.toISOString().split("T")[0];

    // Monday of last week
    const lastMonday = new Date(monday);
    lastMonday.setDate(monday.getDate() - 7);
    const lastMondayStr = lastMonday.toISOString().split("T")[0];

    // Sunday of last week
    const lastSunday = new Date(monday);
    lastSunday.setDate(monday.getDate() - 1);
    const lastSundayStr = lastSunday.toISOString().split("T")[0];

    // This week entries
    const thisWeekEntries = await db
      .select({
        reportDate: timeEntries.reportDate,
        regular: timeEntries.hoursRegular,
        overtime: timeEntries.hoursOvertime,
        double: timeEntries.hoursDouble,
        jobNumber: jobs.jobNumber,
        jobName: jobs.name,
        clockIn: timeEntries.clockIn,
        clockOut: timeEntries.clockOut,
      })
      .from(timeEntries)
      .innerJoin(jobs, eq(timeEntries.jobId, jobs.id))
      .where(
        and(
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.companyId, companyId),
          gte(timeEntries.reportDate, mondayStr),
          lte(timeEntries.reportDate, today)
        )
      )
      .orderBy(timeEntries.reportDate);

    // Last week entries
    const lastWeekEntries = await db
      .select({
        reportDate: timeEntries.reportDate,
        regular: timeEntries.hoursRegular,
        overtime: timeEntries.hoursOvertime,
        double: timeEntries.hoursDouble,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.employeeId, employeeId),
          eq(timeEntries.companyId, companyId),
          gte(timeEntries.reportDate, lastMondayStr),
          lte(timeEntries.reportDate, lastSundayStr)
        )
      );

    // Group this week by day
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const thisWeekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const dayEntries = thisWeekEntries.filter(
        (e) => e.reportDate === dateStr
      );
      const regular = dayEntries.reduce(
        (s, e) => s + (e.regular || 0), 0
      );
      const overtime = dayEntries.reduce(
        (s, e) => s + (e.overtime || 0), 0
      );
      const double = dayEntries.reduce(
        (s, e) => s + (e.double || 0), 0
      );
      const total = regular + overtime + double;
      const jobNumber = dayEntries[0]?.jobNumber || null;
      const jobName = dayEntries[0]?.jobName || null;

      thisWeekDays.push({
        date: dateStr,
        dayName: dayNames[i],
        regular: Math.round(regular * 100) / 100,
        overtime: Math.round(overtime * 100) / 100,
        double: Math.round(double * 100) / 100,
        total: Math.round(total * 100) / 100,
        jobNumber,
        jobName,
        isPast: dateStr < today,
        isToday: dateStr === today,
        isFuture: dateStr > today,
      });
    }

    // Last week totals
    const lastWeekRegular = lastWeekEntries.reduce(
      (s, e) => s + (e.regular || 0), 0
    );
    const lastWeekOT = lastWeekEntries.reduce(
      (s, e) => s + (e.overtime || 0), 0
    );
    const lastWeekDouble = lastWeekEntries.reduce(
      (s, e) => s + (e.double || 0), 0
    );
    const lastWeekTotal = lastWeekRegular + lastWeekOT + lastWeekDouble;

    // This week totals
    const thisWeekRegular = thisWeekDays.reduce((s, d) => s + d.regular, 0);
    const thisWeekOT = thisWeekDays.reduce((s, d) => s + d.overtime, 0);
    const thisWeekDouble = thisWeekDays.reduce((s, d) => s + d.double, 0);
    const thisWeekTotal = thisWeekRegular + thisWeekOT + thisWeekDouble;

    return c.json({
      thisWeek: {
        weekOf: mondayStr,
        days: thisWeekDays,
        totalRegular: Math.round(thisWeekRegular * 100) / 100,
        totalOvertime: Math.round(thisWeekOT * 100) / 100,
        totalDouble: Math.round(thisWeekDouble * 100) / 100,
        totalHours: Math.round(thisWeekTotal * 100) / 100,
      },
      lastWeek: {
        weekOf: lastMondayStr,
        totalRegular: Math.round(lastWeekRegular * 100) / 100,
        totalOvertime: Math.round(lastWeekOT * 100) / 100,
        totalDouble: Math.round(lastWeekDouble * 100) / 100,
        totalHours: Math.round(lastWeekTotal * 100) / 100,
      },
    });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── GET /field/my-tools — Assigned tools, equipment & vehicles ────
field.get("/my-tools", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    const myAssets = await db
      .select({
        id: assets.id,
        type: assets.type,
        category: assets.category,
        description: assets.description,
        manufacturer: assets.manufacturer,
        model: assets.model,
        serialNumber: assets.serialNumber,
        identifier: assets.identifier,
        status: assets.status,
        condition: assets.condition,
        photoUrl: assets.photoUrl,
      })
      .from(assets)
      .where(
        and(
          eq(assets.companyId, companyId),
          eq(assets.assignedToEmployee, employeeId),
          eq(assets.status, "assigned")
        )
      )
      .orderBy(assets.type, assets.description);

    // Split by type
    const vehicle = myAssets.find((a) => a.type === "vehicle") || null;
    const tools = myAssets.filter((a) => a.type === "tool");
    const equipment = myAssets.filter((a) => a.type === "equipment");

    return c.json({
      vehicle,
      tools,
      equipment,
      totalCount: myAssets.length,
    });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ══════════════════════════════════════════════════════════════════
// ── TIME ENTRY ISSUES — field worker resolution flow ─────────────
// ══════════════════════════════════════════════════════════════════

// ── GET /field/my-issues — unresolved issues for current user ────
field.get("/my-issues", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    const issues = sqlite.query(`
      SELECT i.*, te.clock_in, te.clock_out, te.hours_regular, te.hours_overtime,
             j.job_number, j.name as job_name
      FROM time_entry_issues i
      LEFT JOIN time_entries te ON i.time_entry_id = te.id
      LEFT JOIN jobs j ON te.job_id = j.id
      WHERE i.company_id = ? AND i.employee_id = ?
        AND i.status IN ('pending', 'rejected')
      ORDER BY i.report_date DESC
    `).all(companyId, employeeId);

    return c.json({ issues });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── GET /field/my-issues/count — badge count for unresolved issues ──
field.get("/my-issues/count", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    const result = sqlite.query(`
      SELECT COUNT(*) as count FROM time_entry_issues
      WHERE company_id = ? AND employee_id = ? AND status IN ('pending', 'rejected')
    `).get(companyId, employeeId) as any;

    return c.json({ count: result?.count || 0 });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── POST /field/issues/:id/resolve — employee submits a note ─────
field.post("/issues/:id/resolve", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);
    const issueId = Number(c.req.param("id"));
    const { note } = await c.req.json();

    if (!note || typeof note !== "string" || !note.trim()) {
      return c.json({ error: "A note explaining the issue is required" }, 400);
    }
    if (note.trim().length > 5000) {
      return c.json({ error: "Note must be under 5,000 characters" }, 400);
    }

    // Verify the issue belongs to this employee
    const issue = sqlite.query(`
      SELECT id, status FROM time_entry_issues
      WHERE id = ? AND company_id = ? AND employee_id = ?
    `).get(issueId, companyId, employeeId) as any;

    if (!issue) return c.json({ error: "Issue not found" }, 404);
    if (issue.status === "approved") return c.json({ error: "Issue already resolved" }, 400);

    const now = new Date().toISOString();
    sqlite.run(`
      UPDATE time_entry_issues
      SET employee_note = ?, employee_noted_at = ?, status = 'noted'
      WHERE id = ?
    `, [note.trim(), now, issueId]);

    return c.json({ success: true, status: "noted" });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── POST /field/push-token — register Expo push token ────────────
field.post("/push-token", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);
    const { token, platform } = await c.req.json();

    if (!token || typeof token !== "string") {
      return c.json({ error: "Token is required" }, 400);
    }
    if (!token.startsWith("ExponentPushToken[")) {
      return c.json({ error: "Invalid push token format" }, 400);
    }
    if (platform && !["ios", "android"].includes(platform)) {
      return c.json({ error: "Platform must be ios or android" }, 400);
    }

    // Upsert: deactivate old tokens for this employee, then insert/activate
    sqlite.run(`
      UPDATE push_tokens SET is_active = 0
      WHERE employee_id = ? AND company_id = ? AND token != ?
    `, [employeeId, companyId, token]);

    const existing = sqlite.query(`
      SELECT id FROM push_tokens WHERE employee_id = ? AND token = ?
    `).get(employeeId, token) as any;

    if (existing) {
      sqlite.run(`
        UPDATE push_tokens SET is_active = 1, platform = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [platform || null, existing.id]);
    } else {
      sqlite.run(`
        INSERT OR IGNORE INTO push_tokens (company_id, employee_id, token, platform)
        VALUES (?, ?, ?, ?)
      `, [companyId, employeeId, token, platform || null]);
    }

    return c.json({ success: true });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── DELETE /field/push-token — deactivate token on logout ─────────
field.delete("/push-token", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);
    const { token } = await c.req.json();

    if (token) {
      sqlite.run(`DELETE FROM push_tokens WHERE employee_id = ? AND company_id = ? AND token = ?`,
        [employeeId, companyId, token]);
    } else {
      // No token specified — deactivate all for this employee
      sqlite.run(`UPDATE push_tokens SET is_active = 0 WHERE employee_id = ? AND company_id = ?`,
        [employeeId, companyId]);
    }

    return c.json({ success: true });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ══════════════════════════════════════════════════════════════════
// ── TIME CORRECTION REQUESTS — employee self-service ─────────────
// ══════════════════════════════════════════════════════════════════

// ── POST /field/corrections — submit a time correction request ───
field.post("/corrections", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);
    const body = await c.req.json();
    const { timeEntryId, issueId, correctionType, requestedClockIn, requestedClockOut, requestedJobId, note, reportDate } = body;

    if (!note || typeof note !== "string" || !note.trim()) {
      return c.json({ error: "A note explaining the correction is required" }, 400);
    }
    if (!correctionType || !["missed_clock_out", "wrong_time", "wrong_job", "other"].includes(correctionType)) {
      return c.json({ error: "Invalid correction type" }, 400);
    }
    if (!reportDate) {
      return c.json({ error: "Report date is required" }, 400);
    }

    // If linked to a time entry, verify ownership
    if (timeEntryId) {
      const entry = sqlite.query(`
        SELECT id FROM time_entries WHERE id = ? AND employee_id = ? AND company_id = ?
      `).get(timeEntryId, employeeId, companyId) as any;
      if (!entry) return c.json({ error: "Time entry not found" }, 404);
    }

    // If linked to an issue, verify ownership
    if (issueId) {
      const issue = sqlite.query(`
        SELECT id FROM time_entry_issues WHERE id = ? AND employee_id = ? AND company_id = ?
      `).get(issueId, employeeId, companyId) as any;
      if (!issue) return c.json({ error: "Issue not found" }, 404);
    }

    // Prevent duplicate pending requests for same entry
    if (timeEntryId) {
      const existing = sqlite.query(`
        SELECT id FROM time_correction_requests
        WHERE time_entry_id = ? AND employee_id = ? AND status = 'pending'
      `).get(timeEntryId, employeeId) as any;
      if (existing) return c.json({ error: "You already have a pending correction for this entry" }, 400);
    }

    sqlite.run(`
      INSERT INTO time_correction_requests
        (company_id, time_entry_id, issue_id, employee_id, correction_type,
         requested_clock_in, requested_clock_out, requested_job_id, note, report_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      companyId,
      timeEntryId || null,
      issueId || null,
      employeeId,
      correctionType,
      requestedClockIn || null,
      requestedClockOut || null,
      requestedJobId || null,
      note.trim(),
      reportDate,
    ]);

    // If linked to an issue, also mark the issue as "noted"
    if (issueId) {
      sqlite.run(`
        UPDATE time_entry_issues
        SET employee_note = ?, employee_noted_at = datetime('now'), status = 'noted'
        WHERE id = ? AND employee_id = ?
      `, [note.trim(), issueId, employeeId]);
    }

    return c.json({ success: true });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── GET /field/corrections — employee's correction history ───────
field.get("/corrections", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    const corrections = sqlite.query(`
      SELECT cr.*, te.clock_in, te.clock_out, j.job_number, j.name as job_name
      FROM time_correction_requests cr
      LEFT JOIN time_entries te ON cr.time_entry_id = te.id
      LEFT JOIN jobs j ON te.job_id = j.id
      WHERE cr.company_id = ? AND cr.employee_id = ?
      ORDER BY cr.created_at DESC
      LIMIT 30
    `).all(companyId, employeeId);

    return c.json({ corrections });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ══════════════════════════════════════════════════════════════════
// ── TIME OFF / SICK LEAVE / GENERAL REQUESTS (mobile → office) ──
// ══════════════════════════════════════════════════════════════════

// ── POST /field/time-off — submit a time off / sick / general request ─
field.post("/time-off", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);
    const body = await c.req.json();

    const { requestType, startDate, endDate, hoursRequested, note } = body;

    if (!requestType || !["paid_sick_leave", "time_off", "general_note"].includes(requestType)) {
      return c.json({ error: "Invalid request type" }, 400);
    }
    if (!startDate) return c.json({ error: "Start date is required" }, 400);
    if (!note?.trim()) return c.json({ error: "A note is required" }, 400);

    const result = sqlite.query(`
      INSERT INTO time_off_requests
        (company_id, employee_id, request_type, start_date, end_date, hours_requested, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      companyId, employeeId, requestType,
      startDate, endDate || null,
      hoursRequested || null, note.trim()
    );

    return c.json({ success: true, request: result });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── GET /field/time-off — employee's own requests ─────────────────
field.get("/time-off", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    const requests = sqlite.query(`
      SELECT tor.*,
        u.display_name AS resolver_name
      FROM time_off_requests tor
      LEFT JOIN users u ON u.id = tor.resolved_by
      WHERE tor.company_id = ? AND tor.employee_id = ?
      ORDER BY tor.created_at DESC
      LIMIT 30
    `).all(companyId, employeeId);

    return c.json({ requests });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── GET /field/pto-balance — employee's own PTO/sick balance ──────
field.get("/pto-balance", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    const balances = sqlite.query(`
      SELECT *,
        (accrued_hours + adjusted_hours - used_hours) AS available_hours
      FROM employee_pto_balances
      WHERE company_id = ? AND employee_id = ?
    `).all(companyId, employeeId);

    return c.json({ balances });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ══════════════════════════════════════════════════════════════════
// ── TOOL REPORTS — field worker reports damaged/lost/stolen tools ─
// ══════════════════════════════════════════════════════════════════

// ── POST /field/tool-report — Submit a tool issue report ─────────
field.post("/tool-report", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);
    const body = await c.req.json();

    const { assetId, reportType, severity, description, lat, lng } = body;

    if (!assetId || !reportType || !severity || !description?.trim()) {
      return c.json({ error: "Missing required fields: assetId, reportType, severity, description" }, 400);
    }

    const validTypes = ["damaged", "lost", "stolen", "needs_maintenance", "needs_calibration"];
    const validSeverities = ["can_still_use", "out_of_service", "safety_hazard"];
    if (!validTypes.includes(reportType)) return c.json({ error: "Invalid reportType" }, 400);
    if (!validSeverities.includes(severity)) return c.json({ error: "Invalid severity" }, 400);

    // Verify asset belongs to company
    const [asset] = await db
      .select({ id: assets.id, assignedToEmployee: assets.assignedToEmployee })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.companyId, companyId)));

    if (!asset) return c.json({ error: "Tool not found" }, 404);

    // Check for duplicate open report on same asset by same employee
    const existing = await db
      .select({ id: toolReports.id })
      .from(toolReports)
      .where(
        and(
          eq(toolReports.assetId, assetId),
          eq(toolReports.reportedBy, employeeId),
          eq(toolReports.companyId, companyId),
          eq(toolReports.status, "open")
        )
      );

    if (existing.length > 0) {
      return c.json({ error: "You already have an open report for this tool" }, 409);
    }

    // Create the report
    const result = await db.insert(toolReports).values({
      companyId,
      assetId,
      reportedBy: employeeId,
      reportType: reportType as any,
      severity: severity as any,
      description: description.trim(),
      lat: lat || null,
      lng: lng || null,
    }).returning({ id: toolReports.id });

    const reportId = result[0].id;

    // Log to tool history
    const eventMap: Record<string, string> = {
      damaged: "reported_damaged",
      lost: "reported_lost",
      stolen: "reported_stolen",
      needs_maintenance: "reported_maintenance",
      needs_calibration: "reported_calibration",
    };

    await logToolEvent({
      companyId,
      assetId,
      eventType: eventMap[reportType],
      employeeId,
      reportId,
      note: description.trim(),
      lat: lat || null,
      lng: lng || null,
    });

    // If severity is out_of_service or safety_hazard, update asset status
    if (severity === "out_of_service" || severity === "safety_hazard") {
      await db
        .update(assets)
        .set({ status: "maintenance" })
        .where(eq(assets.id, assetId));
    }

    return c.json({ id: reportId, success: true });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── POST /field/tool-report/:id/photo — Upload photo for report ──
field.post("/tool-report/:id/photo", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);
    const id = Number(c.req.param("id"));

    const [report] = await db
      .select({ id: toolReports.id, reportedBy: toolReports.reportedBy })
      .from(toolReports)
      .where(and(eq(toolReports.id, id), eq(toolReports.companyId, companyId)));

    if (!report) return c.json({ error: "Report not found" }, 404);
    if (report.reportedBy !== employeeId) return c.json({ error: "Not your report" }, 403);

    const formData = await c.req.formData();
    const file = formData.get("photo") as File;
    if (!file) return c.json({ error: "No photo provided" }, 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) return c.json({ error: "Photo too large (5MB max)" }, 400);

    // Validate image type (magic bytes)
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (!isJpg && !isPng && !isWebp) return c.json({ error: "Invalid image format" }, 400);

    const ext = isJpg ? "jpg" : isPng ? "png" : "webp";
    const filename = `tool_report_${id}_${Date.now()}.${ext}`;
    const dir = resolve(dirname(new URL(import.meta.url).pathname), "../data/photos");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, filename), bytes);

    const photoUrl = `/data/photos/${filename}`;
    await db.update(toolReports).set({ photoUrl }).where(eq(toolReports.id, id));

    return c.json({ photoUrl });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

// ── GET /field/my-tool-reports — My submitted reports ─────────────
field.get("/my-tool-reports", async (c) => {
  try {
    const companyId = getCompanyId(c);
    const employeeId = getEmployeeId(c);

    const reports = await db
      .select({
        id: toolReports.id,
        assetId: toolReports.assetId,
        assetDescription: assets.description,
        assetIdentifier: assets.identifier,
        reportType: toolReports.reportType,
        severity: toolReports.severity,
        description: toolReports.description,
        photoUrl: toolReports.photoUrl,
        status: toolReports.status,
        resolutionNote: toolReports.resolutionNote,
        createdAt: toolReports.createdAt,
        resolvedAt: toolReports.resolvedAt,
      })
      .from(toolReports)
      .innerJoin(assets, eq(toolReports.assetId, assets.id))
      .where(and(eq(toolReports.reportedBy, employeeId), eq(toolReports.companyId, companyId)))
      .orderBy(desc(toolReports.createdAt))
      .limit(30);

    return c.json({ reports });
  } catch (err: any) {
    if (err.message === "NO_EMPLOYEE_LINK") {
      return c.json({ error: "User not linked to employee" }, 400);
    }
    throw err;
  }
});

export { field as fieldRoutes };
