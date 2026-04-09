import { Hono } from "hono";
import { sqlite } from "./db.js";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";

/**
 * Seed endpoint — generates realistic time tracking test data.
 * POST /api/seed/time-tracking — super_admin only, safe to run multiple times.
 * Clears existing time_entries with source='mobile' or 'tablet' first.
 */

const seedTimeTrackingRoutes = new Hono();
seedTimeTrackingRoutes.use("/*", requireAuth);

seedTimeTrackingRoutes.post("/time-tracking", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);

  // Get real employees and jobs from the database
  const employees = sqlite.query(
    `SELECT id, first_name, last_name FROM employees WHERE company_id = ? AND status = 'active' LIMIT 15`
  ).all(companyId) as any[];

  const jobs = sqlite.query(
    `SELECT id, name, address, latitude, longitude FROM jobs WHERE company_id = ? AND status = 'active' LIMIT 8`
  ).all(companyId) as any[];

  if (employees.length === 0) return c.json({ error: "No active employees found" }, 400);
  if (jobs.length === 0) return c.json({ error: "No active jobs found" }, 400);

  // Clear previous seed data
  sqlite.run(`DELETE FROM time_entries WHERE company_id = ? AND source IN ('mobile', 'tablet')`, [companyId]);
  sqlite.run(`DELETE FROM live_locations WHERE company_id = ?`, [companyId]);

  const sources: string[] = ["mobile", "mobile", "mobile", "tablet"]; // weighted toward mobile
  const workDescriptions = [
    "Ran conduit in ceiling grid, 2nd floor",
    "Pulled wire through main trunk line",
    "Installed panel board in electrical room",
    "Terminated receptacles in offices 201-208",
    "Mounted light fixtures in hallway",
    "Rough-in for restroom circuits",
    "Installed disconnect switches at rooftop units",
    "Fire alarm device installation, floors 1-2",
    "Low voltage cabling, conference rooms",
    "Switchgear terminations in main electrical room",
    "Ran MC cable for lobby lighting",
    "Installed GFI receptacles in kitchen area",
    "Branch circuit wiring for cubicle power",
    "Emergency lighting installation",
    "Generator connection and transfer switch wiring",
  ];

  // Pueblo, CO area coordinates for realistic GPS data
  const puebloCenter = { lat: 38.2544, lng: -104.6091 };

  function jitter(base: number, range: number) {
    return base + (Math.random() - 0.5) * range;
  }

  function randomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // UTC offset for seed times — server runs in UTC, but we want clock-in/out
  // times to look correct in the user's local timezone. This offset converts
  // "local hour" to UTC. E.g. 6 = UTC-6 (MDT) means 6 AM local → 12 PM UTC.
  // In production, real clock-ins capture actual UTC from the device, so this
  // only matters for seed data. Reads from SEED_TZ_OFFSET env or defaults to 6 (MDT).
  const tzOffset = parseInt(process.env.SEED_TZ_OFFSET || "6", 10);

  // Generate 2 weeks of data (past 14 days)
  const today = new Date();
  const entries: any[] = [];
  let entryCount = 0;

  for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
    const date = new Date(today);
    date.setDate(date.getDate() - dayOffset);

    // Skip weekends
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;

    const dateStr = date.toISOString().split("T")[0];

    // Each day, pick 4-8 employees who work
    const numWorkers = Math.min(employees.length, 4 + Math.floor(Math.random() * 5));
    const dayWorkers = [...employees].sort(() => Math.random() - 0.5).slice(0, numWorkers);

    for (const emp of dayWorkers) {
      const job = randomItem(jobs);
      const source = randomItem(sources);

      // Clock in between 5:30 AM and 7:30 AM local time
      const clockInHour = 5 + Math.floor(Math.random() * 2) + tzOffset;
      const clockInMin = Math.floor(Math.random() * 60);
      const clockIn = new Date(date);
      clockIn.setHours(clockInHour, clockInMin, Math.floor(Math.random() * 60));

      // Work 8-11 hours
      const workHours = 8 + Math.random() * 3;
      const clockOut = new Date(clockIn.getTime() + workHours * 3600000);

      // GPS near job location or Pueblo center
      const jobLat = job.latitude || puebloCenter.lat;
      const jobLng = job.longitude || puebloCenter.lng;
      const clockInLat = jitter(jobLat, 0.003);  // ~150m radius
      const clockInLng = jitter(jobLng, 0.003);
      const clockOutLat = jitter(jobLat, 0.003);
      const clockOutLng = jitter(jobLng, 0.003);

      // 85% of the time, clock in inside geofence
      const inGeofence = Math.random() < 0.85;
      const outGeofence = Math.random() < 0.85;

      // Calculate hours
      const totalHours = workHours;
      const breakMins = Math.random() < 0.7 ? 30 : 0;
      const netHours = totalHours - (breakMins / 60);
      const regular = Math.min(netHours, 8);
      const overtime = Math.min(Math.max(netHours - 8, 0), 4);
      const double = Math.max(netHours - 12, 0);

      // Lunch break in the middle
      const lunchOut = new Date(clockIn.getTime() + 4 * 3600000 + Math.random() * 3600000);
      const lunchIn = new Date(lunchOut.getTime() + breakMins * 60000);

      // Address strings
      const clockInAddr = job.address || `${Math.floor(1000 + Math.random() * 9000)} Industrial Blvd, Pueblo, CO`;
      const clockOutAddr = clockInAddr;

      sqlite.run(`
        INSERT INTO time_entries (
          company_id, job_id, employee_id, report_date,
          hours_regular, hours_overtime, hours_double,
          clock_in, clock_out,
          clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng,
          clock_in_inside_geofence, clock_out_inside_geofence,
          clock_in_address, clock_out_address,
          source, break_minutes, lunch_out, lunch_in,
          work_performed, notes,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        companyId, job.id, emp.id, dateStr,
        Math.round(regular * 100) / 100,
        Math.round(overtime * 100) / 100,
        Math.round(double * 100) / 100,
        clockIn.toISOString(), clockOut.toISOString(),
        Math.round(clockInLat * 100000) / 100000,
        Math.round(clockInLng * 100000) / 100000,
        Math.round(clockOutLat * 100000) / 100000,
        Math.round(clockOutLng * 100000) / 100000,
        inGeofence ? 1 : 0, outGeofence ? 1 : 0,
        clockInAddr, clockOutAddr,
        source, breakMins,
        breakMins > 0 ? lunchOut.toISOString() : null,
        breakMins > 0 ? lunchIn.toISOString() : null,
        randomItem(workDescriptions),
        Math.random() < 0.2 ? "Weather delay early morning" : null,
        clockIn.toISOString(), clockOut.toISOString(),
      ]);

      entryCount++;
    }
  }

  // ── Guarantee Trevor Terra has a full week of data ──────────
  const trevorTerra = employees.find(
    (e: any) => e.first_name === "Trevor" && e.last_name === "Terra"
  );
  if (trevorTerra) {
    // Get Monday of this week
    const dow = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((dow + 6) % 7));

    // Also seed last week (Mon-Fri) so weekly hours look realistic even early in the week
    const lastMonday = new Date(monday);
    lastMonday.setDate(monday.getDate() - 7);

    const trevorDays: { date: Date; dateStr: string }[] = [];
    // Last week Mon-Fri
    for (let i = 0; i < 5; i++) {
      const d = new Date(lastMonday);
      d.setDate(lastMonday.getDate() + i);
      if (d < today) trevorDays.push({ date: d, dateStr: d.toISOString().split("T")[0] });
    }
    // This week Mon-Fri (up to yesterday)
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = d.toISOString().split("T")[0];
      if (d < today && d.getDay() !== 0 && d.getDay() !== 6) {
        trevorDays.push({ date: d, dateStr: ds });
      }
    }

    for (const { date, dateStr } of trevorDays) {
      const job = randomItem(jobs);
      // Trevor clocks in 6:00-6:30 AM local, works 9-10.5 hours
      const clockInHour = 6 + tzOffset;
      const clockInMin = Math.floor(Math.random() * 30);
      const clockIn = new Date(date);
      clockIn.setHours(clockInHour, clockInMin, Math.floor(Math.random() * 60));

      const workHours = 9 + Math.random() * 1.5;
      const clockOut = new Date(clockIn.getTime() + workHours * 3600000);

      const jobLat = job.latitude || puebloCenter.lat;
      const jobLng = job.longitude || puebloCenter.lng;

      const breakMins = 30;
      const netHours = workHours - 0.5;
      const regular = Math.min(netHours, 8);
      const overtime = Math.min(Math.max(netHours - 8, 0), 4);
      const double = Math.max(netHours - 12, 0);

      const lunchOut = new Date(clockIn.getTime() + 4 * 3600000);
      const lunchIn = new Date(lunchOut.getTime() + breakMins * 60000);

      sqlite.run(`
        INSERT INTO time_entries (
          company_id, job_id, employee_id, report_date,
          hours_regular, hours_overtime, hours_double,
          clock_in, clock_out,
          clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng,
          clock_in_inside_geofence, clock_out_inside_geofence,
          clock_in_address, clock_out_address,
          source, break_minutes, lunch_out, lunch_in,
          work_performed, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, 'mobile', ?, ?, ?, ?, ?, ?, ?)
      `, [
        companyId, job.id, trevorTerra.id, dateStr,
        Math.round(regular * 100) / 100,
        Math.round(overtime * 100) / 100,
        Math.round(double * 100) / 100,
        clockIn.toISOString(), clockOut.toISOString(),
        jitter(jobLat, 0.001), jitter(jobLng, 0.001),
        jitter(jobLat, 0.001), jitter(jobLng, 0.001),
        job.address || "Pueblo, CO", job.address || "Pueblo, CO",
        breakMins,
        lunchOut.toISOString(), lunchIn.toISOString(),
        randomItem(workDescriptions),
        null,
        clockIn.toISOString(), clockOut.toISOString(),
      ]);
      entryCount++;
    }
  }

  // ── Split-shift days: multiple clock in/out per day ─────────
  // Trevor + 2 other employees get a few days where they clock out
  // for lunch and clock back in on a different job in the afternoon.
  const splitCandidates = [trevorTerra, employees[1], employees[2]].filter(Boolean);
  let splitCount = 0;

  for (const emp of splitCandidates) {
    if (!emp) continue;

    // Pick 2-3 recent weekdays for split shifts
    const numSplitDays = emp === trevorTerra ? 3 : 2;
    let splitsAdded = 0;

    for (let dayOffset = 2; dayOffset <= 8 && splitsAdded < numSplitDays; dayOffset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - dayOffset);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const dateStr = d.toISOString().split("T")[0];

      // Delete any existing single entry for this emp+date (we'll replace with split)
      sqlite.run(
        `DELETE FROM time_entries WHERE company_id = ? AND employee_id = ? AND report_date = ? AND source IN ('mobile','tablet')`,
        [companyId, emp.id, dateStr]
      );

      // Pick two different jobs
      const job1 = jobs[splitsAdded % jobs.length];
      const job2 = jobs[(splitsAdded + 1) % jobs.length];
      const job1Lat = job1.latitude || puebloCenter.lat;
      const job1Lng = job1.longitude || puebloCenter.lng;
      const job2Lat = job2.latitude || puebloCenter.lat;
      const job2Lng = job2.longitude || puebloCenter.lng;

      // Morning shift: 6:00 AM → 11:30 AM local (5.5 hrs, no break)
      const amIn = new Date(d);
      amIn.setHours(6 + tzOffset, Math.floor(Math.random() * 15), 0);
      const amOut = new Date(d);
      amOut.setHours(11 + tzOffset, 30 + Math.floor(Math.random() * 15), 0);
      const amHrs = (amOut.getTime() - amIn.getTime()) / 3600000;

      sqlite.run(`
        INSERT INTO time_entries (
          company_id, job_id, employee_id, report_date,
          hours_regular, hours_overtime, hours_double,
          clock_in, clock_out,
          clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng,
          clock_in_inside_geofence, clock_out_inside_geofence,
          clock_in_address, clock_out_address,
          source, break_minutes, work_performed, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, 'mobile', 0, ?, ?, ?, ?)
      `, [
        companyId, job1.id, emp.id, dateStr,
        Math.round(amHrs * 100) / 100,
        amIn.toISOString(), amOut.toISOString(),
        jitter(job1Lat, 0.001), jitter(job1Lng, 0.001),
        jitter(job1Lat, 0.001), jitter(job1Lng, 0.001),
        job1.address || "Pueblo, CO", job1.address || "Pueblo, CO",
        randomItem(workDescriptions),
        "Morning shift",
        amIn.toISOString(), amOut.toISOString(),
      ]);

      // Afternoon shift: 12:00 PM → 3:30-4:30 PM local (different job)
      const pmIn = new Date(d);
      pmIn.setHours(12 + tzOffset, Math.floor(Math.random() * 15), 0);
      const pmHrs = 3.5 + Math.random();
      const pmOut = new Date(pmIn.getTime() + pmHrs * 3600000);
      const totalDay = amHrs + pmHrs;
      const pmReg = Math.min(pmHrs, Math.max(8 - amHrs, 0));
      const pmOT = Math.min(Math.max(totalDay - 8, 0), 4) - Math.max(Math.min(amHrs - 8, 4), 0);

      sqlite.run(`
        INSERT INTO time_entries (
          company_id, job_id, employee_id, report_date,
          hours_regular, hours_overtime, hours_double,
          clock_in, clock_out,
          clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng,
          clock_in_inside_geofence, clock_out_inside_geofence,
          clock_in_address, clock_out_address,
          source, break_minutes, work_performed, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, 'mobile', 0, ?, ?, ?, ?)
      `, [
        companyId, job2.id, emp.id, dateStr,
        Math.round(Math.max(pmReg, 0) * 100) / 100,
        Math.round(Math.max(pmOT, 0) * 100) / 100,
        pmIn.toISOString(), pmOut.toISOString(),
        jitter(job2Lat, 0.001), jitter(job2Lng, 0.001),
        jitter(job2Lat, 0.001), jitter(job2Lng, 0.001),
        job2.address || "Pueblo, CO", job2.address || "Pueblo, CO",
        randomItem(workDescriptions),
        "Afternoon — moved to different job",
        pmIn.toISOString(), pmOut.toISOString(),
      ]);

      splitCount += 2;
      splitsAdded++;
    }
  }
  entryCount += splitCount;

  // Seed a few "currently clocked in" entries for today (no clock_out)
  const todayStr = today.toISOString().split("T")[0];
  const activeWorkers = employees.slice(0, Math.min(3, employees.length));
  let activeCount = 0;

  for (const emp of activeWorkers) {
    const job = randomItem(jobs);
    const clockIn = new Date(today);
    clockIn.setHours(6 + tzOffset + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0);

    // Only create if clock-in is in the past
    if (clockIn > today) continue;

    const jobLat = job.latitude || puebloCenter.lat;
    const jobLng = job.longitude || puebloCenter.lng;

    sqlite.run(`
      INSERT INTO time_entries (
        company_id, job_id, employee_id, report_date,
        hours_regular, hours_overtime, hours_double,
        clock_in, clock_in_lat, clock_in_lng,
        clock_in_inside_geofence, clock_in_address,
        source, work_performed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 1, ?, 'mobile', ?, ?, ?)
    `, [
      companyId, job.id, emp.id, todayStr,
      clockIn.toISOString(),
      jitter(jobLat, 0.002), jitter(jobLng, 0.002),
      job.address || "Pueblo, CO",
      randomItem(workDescriptions),
      clockIn.toISOString(), clockIn.toISOString(),
    ]);

    // Also add a live_location entry for the crew map
    sqlite.run(`
      INSERT INTO live_locations (
        company_id, employee_id, latitude, longitude,
        accuracy, battery_level, is_charging,
        address, job_id, inside_geofence, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `, [
      companyId, emp.id,
      jitter(jobLat, 0.001), jitter(jobLng, 0.001),
      Math.round(5 + Math.random() * 20),
      Math.round(40 + Math.random() * 55),
      Math.random() < 0.3 ? 1 : 0,
      job.address || "Pueblo, CO",
      job.id,
      new Date().toISOString(),
    ]);

    activeCount++;
  }

  return c.json({
    success: true,
    seeded: {
      timeEntries: entryCount,
      splitShiftEntries: splitCount,
      activeClockIns: activeCount,
      liveLocations: activeCount,
      employees: employees.length,
      jobs: jobs.length,
      dateRange: {
        from: new Date(today.getTime() - 13 * 86400000).toISOString().split("T")[0],
        to: todayStr,
      },
    },
  });
});

export { seedTimeTrackingRoutes };
