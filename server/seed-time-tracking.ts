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

      // Clock in between 5:30 AM and 7:30 AM
      const clockInHour = 5 + Math.floor(Math.random() * 2);
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

  // Seed a few "currently clocked in" entries for today (no clock_out)
  const todayStr = today.toISOString().split("T")[0];
  const activeWorkers = employees.slice(0, Math.min(3, employees.length));
  let activeCount = 0;

  for (const emp of activeWorkers) {
    const job = randomItem(jobs);
    const clockIn = new Date(today);
    clockIn.setHours(6 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0);

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
