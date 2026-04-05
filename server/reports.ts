import { Hono } from "hono";
import { db, sqlite } from "./db.js";
import {
  employees, classifications, jobs, jobAssignments,
  jurisdictions, jurisdictionRates, settings, assets, dailyLog
} from "../shared/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";

const reports = new Hono();

// All reports require auth + at least pm role
reports.use("/*", requireAuth);
reports.use("/*", requireRole("admin", "pm"));

// ── Shared helpers ──────────────────────────────────────────────

async function getSettings(companyId: number): Promise<Record<string, string>> {
  const rows = await db.select().from(settings).where(eq(settings.companyId, companyId));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

async function getCompanyName(companyId: number): Promise<string> {
  const s = await getSettings(companyId);
  return s.companyName || "BirdDog";
}

function reportShell(title: string, company: string, body: string, subtitle?: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — ${company}</title>
  <style>
    /* ── Reset & Base ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.4;
      color: #1a1a1a;
      background: #fff;
      padding: 0.5in;
    }

    /* ── Header ── */
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #1d5191;
      padding-bottom: 8px;
      margin-bottom: 16px;
    }
    .report-header h1 {
      font-size: 18px;
      font-weight: 700;
      color: #1d5191;
    }
    .report-header .subtitle {
      font-size: 12px;
      color: #555;
      margin-top: 2px;
    }
    .report-header .company {
      font-size: 13px;
      font-weight: 600;
      color: #333;
    }
    .report-header .meta {
      text-align: right;
      font-size: 10px;
      color: #777;
    }

    /* ── Tables ── */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    th, td {
      padding: 4px 8px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background: #f0f4f8;
      font-weight: 600;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: #555;
      border-bottom: 2px solid #ccc;
    }
    tr:nth-child(even) { background: #fafbfc; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .font-mono { font-family: "SF Mono", "Consolas", "Monaco", monospace; font-size: 10px; }
    .font-bold { font-weight: 700; }
    .text-muted { color: #888; }
    .text-accent { color: #1d5191; }

    /* ── Section headers ── */
    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: #1d5191;
      margin: 20px 0 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #dde;
    }

    /* ── Summary cards ── */
    .summary-row {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
    }
    .summary-card {
      flex: 1;
      background: #f0f4f8;
      border-radius: 6px;
      padding: 10px 14px;
      border-left: 3px solid #1d5191;
    }
    .summary-card .label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.3px; }
    .summary-card .value { font-size: 20px; font-weight: 700; color: #1d5191; }
    .summary-card .detail { font-size: 10px; color: #888; }

    /* ── Badge ── */
    .badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 600;
      color: #fff;
    }

    /* ── Footer ── */
    .report-footer {
      margin-top: 24px;
      padding-top: 8px;
      border-top: 1px solid #ddd;
      font-size: 9px;
      color: #999;
      display: flex;
      justify-content: space-between;
    }

    /* ── Print ── */
    @media print {
      body { padding: 0; font-size: 10px; }
      .no-print { display: none !important; }
      .summary-card { break-inside: avoid; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
      .report-footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 4px 0.5in; }
      @page { margin: 0.5in; size: landscape; }
    }
  </style>
</head>
<body>
  <!-- Print button (hidden on print) -->
  <div class="no-print" style="margin-bottom: 12px;">
    <button onclick="window.print()" style="padding: 6px 16px; background: #1d5191; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
      Print / Save as PDF
    </button>
    <button onclick="window.close()" style="padding: 6px 16px; background: #eee; color: #333; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 4px;">
      Close
    </button>
  </div>

  <div class="report-header">
    <div>
      <h1>${title}</h1>
      ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ""}
    </div>
    <div class="meta">
      <div class="company">${company}</div>
      <div>${dateStr}</div>
      <div>${timeStr}</div>
    </div>
  </div>

  ${body}

  <div class="report-footer">
    <span>BirdDog — ${company}</span>
    <span>Generated ${dateStr} at ${timeStr}</span>
  </div>
</body>
</html>`;
}

function money(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ═══════════════════════════════════════════════════════════════
// REPORT 1: Workforce Roster
// ═══════════════════════════════════════════════════════════════
reports.get("/workforce-roster", async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const format = c.req.query("format");

  // Get all active employees with classification + rate info
  const allEmps = await db
    .select({
      id: employees.id,
      employeeNumber: employees.employeeNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      classificationId: employees.classificationId,
      classificationName: classifications.name,
      classificationColor: classifications.color,
      department: classifications.department,
      hasLicense: classifications.hasLicense,
      phone: employees.phone,
      dateOfHire: employees.dateOfHire,
    })
    .from(employees)
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .where(and(eq(employees.status, "active"), eq(employees.companyId, companyId)))
    .orderBy(employees.lastName, employees.firstName);

  // Get active assignments with job info (including jurisdiction for rate overrides)
  const activeAssigns = await db
    .select({
      employeeId: jobAssignments.employeeId,
      jobId: jobAssignments.jobId,
      jobName: jobs.name,
      jobNumber: jobs.jobNumber,
      jurisdictionId: jobs.jurisdictionId,
    })
    .from(jobAssignments)
    .innerJoin(jobs, eq(jobAssignments.jobId, jobs.id))
    .where(eq(jobAssignments.isActive, true));

  // Jurisdiction rate overrides
  const allJurRates = await db.select().from(jurisdictionRates).where(eq(jurisdictionRates.companyId, companyId));
  const rateMap = new Map<string, { hourlyRate: number; totalCostRate: number }>();
  for (const r of allJurRates) {
    rateMap.set(`${Number(r.jurisdictionId)}:${Number(r.classificationId)}`, {
      hourlyRate: r.hourlyRate, totalCostRate: r.totalCostRate,
    });
  }

  // Build assignment map: employeeId → job info
  const assignMap = new Map<number, typeof activeAssigns[0]>();
  for (const a of activeAssigns) assignMap.set(a.employeeId, a);

  // Get effective rate for an employee on a specific job (rates come from jurisdiction)
  function getRate(emp: typeof allEmps[0], jurId: number | null) {
    if (jurId && emp.classificationId) {
      const jr = rateMap.get(`${Number(jurId)}:${Number(emp.classificationId)}`);
      if (jr) return jr;
    }
    return { hourlyRate: 0, totalCostRate: 0 };
  }

  function fmtRate(n: number) { return n > 0 ? `$${n.toFixed(2)}` : "—"; }

  // Group employees by job
  const jobMap = new Map<number, { jobNumber: string; jobName: string; jurisdictionId: number | null; crew: typeof allEmps }>();
  for (const a of activeAssigns) {
    if (!jobMap.has(a.jobId)) {
      jobMap.set(a.jobId, { jobNumber: a.jobNumber, jobName: a.jobName, jurisdictionId: a.jurisdictionId, crew: [] });
    }
  }
  for (const emp of allEmps) {
    const a = assignMap.get(emp.id);
    if (a && jobMap.has(a.jobId)) {
      jobMap.get(a.jobId)!.crew.push(emp);
    }
  }
  const bench = allEmps.filter(e => !assignMap.has(e.id));
  const totalAssigned = allEmps.length - bench.length;
  const totalLicensed = allEmps.filter(e => e.hasLicense).length;

  // Sort jobs by job number
  const sortedJobs = [...jobMap.entries()].sort((a, b) => a[1].jobNumber.localeCompare(b[1].jobNumber));

  if (format === "excel") {
    const excelHead = `<thead><tr><th>Emp #</th><th>Name</th><th>Classification</th><th>Licensed</th><th>Hourly</th><th>Total Cost</th><th>Daily</th><th>Phone</th></tr></thead>`;

    let excelBody = "";
    for (const [_, job] of sortedJobs) {
      const crew = job.crew;
      const crewCount = crew.length;
      const licensed = crew.filter(e => e.hasLicense).length;
      const nonLicensed = crewCount - licensed;
      const ratioStr = licensed === 0
        ? (nonLicensed > 0 ? `0 : ${nonLicensed}` : "—")
        : `1 : ${Math.round((nonLicensed / licensed) * 100) / 100}`;
      const rates = crew.map(e => getRate(e, job.jurisdictionId));
      const avgHourly = crewCount > 0 ? rates.reduce((s, r) => s + r.hourlyRate, 0) / crewCount : 0;
      const dailyLabor = rates.reduce((s, r) => s + r.totalCostRate * 8, 0);

      excelBody += `<tr><td colspan="8" style="font-weight:bold;background:#e8e8ed;">#${esc(job.jobNumber)} — ${esc(job.jobName)}  |  ${crewCount} crew  |  Ratio ${ratioStr}  |  Composite $${avgHourly.toFixed(2)}/hr  |  Daily $${Math.round(dailyLabor)}</td></tr>`;
      for (const e of crew) {
        const r = getRate(e, job.jurisdictionId);
        const daily = r.totalCostRate * 8;
        excelBody += `<tr>
          <td>${esc(e.employeeNumber)}</td>
          <td>${esc(e.lastName)}, ${esc(e.firstName)}</td>
          <td>${esc(e.classificationName) || ""}</td>
          <td>${e.hasLicense ? "Yes" : ""}</td>
          <td>${r.hourlyRate || ""}</td>
          <td>${r.totalCostRate || ""}</td>
          <td>${daily > 0 ? daily.toFixed(0) : ""}</td>
          <td>${esc(e.phone) || ""}</td>
        </tr>`;
      }
    }

    // Bench section
    if (bench.length > 0) {
      excelBody += `<tr><td colspan="8" style="font-weight:bold;background:#e8e8ed;">Bench (Unassigned)  |  ${bench.length} employees</td></tr>`;
      for (const e of bench) {
        const r = getRate(e, null);
        const daily = r.totalCostRate * 8;
        excelBody += `<tr>
          <td>${esc(e.employeeNumber)}</td>
          <td>${esc(e.lastName)}, ${esc(e.firstName)}</td>
          <td>${esc(e.classificationName) || ""}</td>
          <td>${e.hasLicense ? "Yes" : ""}</td>
          <td>${r.hourlyRate || ""}</td>
          <td>${r.totalCostRate || ""}</td>
          <td>${daily > 0 ? daily.toFixed(0) : ""}</td>
          <td>${esc(e.phone) || ""}</td>
        </tr>`;
      }
    }

    return excelResponse(c, "workforce-roster.xls", `<table>${excelHead}<tbody>${excelBody}</tbody></table>`);
  }

  // Shared colgroup for consistent column widths across all job tables
  const colgroup = `<colgroup>
    <col style="width:60px"><col style="width:auto"><col style="width:130px">
    <col style="width:55px"><col style="width:70px"><col style="width:75px"><col style="width:75px">
  </colgroup>`;
  const tableHead = `<thead><tr>
    <th>Emp #</th><th>Name</th><th>Classification</th>
    <th style="text-align:center;">Lic</th><th style="text-align:right;">Hourly</th>
    <th style="text-align:right;">Total Cost</th><th style="text-align:right;">Daily</th>
  </tr></thead>`;

  // Build per-job sections
  const jobSections = sortedJobs.map(([_, job]) => {
    const crew = job.crew;
    const crewCount = crew.length;
    const licensed = crew.filter(e => e.hasLicense).length;
    const nonLicensed = crewCount - licensed;
    const ratioStr = licensed === 0
      ? (nonLicensed > 0 ? `0 : ${nonLicensed}` : "—")
      : `1 : ${Math.round((nonLicensed / licensed) * 100) / 100}`;

    const rates = crew.map(e => getRate(e, job.jurisdictionId));
    const avgHourly = crewCount > 0
      ? rates.reduce((s, r) => s + r.hourlyRate, 0) / crewCount : 0;
    const dailyLabor = rates.reduce((s, r) => s + r.totalCostRate * 8, 0);

    const empRows = crew.map(e => {
      const r = getRate(e, job.jurisdictionId);
      const daily = r.totalCostRate * 8;
      return `<tr>
        <td class="font-mono">${esc(e.employeeNumber)}</td>
        <td>${esc(e.firstName)} ${esc(e.lastName)}</td>
        <td><span class="badge" style="background:${e.classificationColor || '#64748b'}">${esc(e.classificationName)}</span></td>
        <td class="text-center">${e.hasLicense ? "Yes" : ""}</td>
        <td style="text-align:right;">${fmtRate(r.hourlyRate)}</td>
        <td style="text-align:right;">${fmtRate(r.totalCostRate)}</td>
        <td style="text-align:right;">${daily > 0 ? `$${daily.toFixed(0)}` : "—"}</td>
      </tr>`;
    }).join("");

    return `
      <div style="margin-top:18px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #1d5191;padding-bottom:4px;">
        <span style="font-size:13px;font-weight:700;color:#1d1d1f;">#${esc(job.jobNumber)} — ${esc(job.jobName)}</span>
        <span style="font-size:12px;font-weight:600;color:#424245;">
          ${crewCount} crew &nbsp;&middot;&nbsp; Ratio ${ratioStr} &nbsp;&middot;&nbsp; Composite ${fmtRate(avgHourly)}/hr &nbsp;&middot;&nbsp; Daily $${Math.round(dailyLabor).toLocaleString()}
        </span>
      </div>
      <table>${colgroup}${tableHead}
        <tbody>${empRows}</tbody>
      </table>`;
  }).join("");

  // Bench section
  const benchRows = bench.map(e => {
    const r = getRate(e, null);
    const daily = r.totalCostRate * 8;
    return `<tr>
      <td class="font-mono">${esc(e.employeeNumber)}</td>
      <td>${esc(e.firstName)} ${esc(e.lastName)}</td>
      <td><span class="badge" style="background:${e.classificationColor || '#64748b'}">${esc(e.classificationName)}</span></td>
      <td class="text-center">${e.hasLicense ? "Yes" : ""}</td>
      <td style="text-align:right;">${fmtRate(r.hourlyRate)}</td>
      <td style="text-align:right;">${fmtRate(r.totalCostRate)}</td>
      <td style="text-align:right;">${daily > 0 ? `$${daily.toFixed(0)}` : "—"}</td>
    </tr>`;
  }).join("");

  let body = `
    <div class="summary-row">
      <div class="summary-card"><div class="label">Total Active</div><div class="value">${allEmps.length}</div></div>
      <div class="summary-card"><div class="label">Assigned</div><div class="value">${totalAssigned}</div></div>
      <div class="summary-card"><div class="label">Bench</div><div class="value">${bench.length}</div></div>
      <div class="summary-card"><div class="label">Licensed</div><div class="value">${totalLicensed}</div></div>
    </div>

    ${jobSections}

    <div style="margin-top:18px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #86868b;padding-bottom:4px;">
      <span style="font-size:13px;font-weight:700;color:#1d1d1f;">Bench (Unassigned)</span>
      <span style="font-size:12px;font-weight:600;color:#424245;">${bench.length} employees</span>
    </div>
    <table>${colgroup}${tableHead}
      <tbody>${benchRows}</tbody>
    </table>`;

  return c.html(reportShell("Workforce Roster", company, body, `${allEmps.length} active employees — ${sortedJobs.length} jobs`));
});

// ═══════════════════════════════════════════════════════════════
// REPORT 2: Job Labor Cost (per job — daily/weekly/monthly)
// ═══════════════════════════════════════════════════════════════
reports.get("/job-labor-cost", async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const jobId = c.req.query("jobId");
  const format = c.req.query("format");

  // Get active jobs for the report
  const condition = jobId
    ? and(eq(jobs.id, parseInt(jobId)), eq(jobs.companyId, companyId))
    : and(sql`${jobs.status} IN ('planning', 'active')`, eq(jobs.companyId, companyId));

  const activeJobs = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      name: jobs.name,
      jurisdictionId: jobs.jurisdictionId,
      jurisdictionName: jurisdictions.name,
      status: jobs.status,
    })
    .from(jobs)
    .leftJoin(jurisdictions, eq(jobs.jurisdictionId, jurisdictions.id))
    .where(condition)
    .orderBy(jobs.jobNumber);

  // Get all active assignments with employee + classification info
  const allAssignments = await db
    .select({
      jobId: jobAssignments.jobId,
      employeeId: jobAssignments.employeeId,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeNumber: employees.employeeNumber,
      classificationId: employees.classificationId,
      classificationName: classifications.name,
      classificationColor: classifications.color,
      hasLicense: classifications.hasLicense,
    })
    .from(jobAssignments)
    .innerJoin(employees, eq(jobAssignments.employeeId, employees.id))
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .where(eq(jobAssignments.isActive, true));

  // Get jurisdiction rates
  const allRates = await db.select().from(jurisdictionRates).where(eq(jurisdictionRates.companyId, companyId));
  const rateMap = new Map<string, { hourlyRate: number; totalCostRate: number }>();
  for (const r of allRates) {
    rateMap.set(`${Number(r.jurisdictionId)}:${Number(r.classificationId)}`, {
      hourlyRate: r.hourlyRate,
      totalCostRate: r.totalCostRate,
    });
  }

  let totalAllJobsDaily = 0;
  let totalAllJobsWeekly = 0;
  let totalAllJobsMonthly = 0;

  // Excel export — flat table with all crew across all jobs
  if (format === "excel") {
    let excelRows = "";
    for (const job of activeJobs) {
      const crew = allAssignments.filter((a) => a.jobId === job.id);
      if (crew.length === 0 && !jobId) continue;
      for (const e of crew) {
        let hourly = 0, costRate = 0;
        if (job.jurisdictionId && e.classificationId) {
          const rate = rateMap.get(`${Number(job.jurisdictionId)}:${Number(e.classificationId)}`);
          if (rate) { hourly = rate.hourlyRate; costRate = rate.totalCostRate; }
        }
        const daily = costRate * 8;
        excelRows += `<tr>
          <td>${esc(job.jobNumber)}</td><td>${esc(job.name)}</td><td>${esc(job.jurisdictionName) || ""}</td>
          <td>${esc(e.employeeNumber)}</td><td>${esc(e.firstName)} ${esc(e.lastName)}</td>
          <td>${esc(e.classificationName) || ""}</td><td>${e.hasLicense ? "Yes" : "No"}</td>
          <td>${hourly.toFixed(2)}</td><td>${costRate.toFixed(2)}</td><td>${daily.toFixed(2)}</td>
          <td>${(daily * 5).toFixed(2)}</td><td>${(daily * 21.67).toFixed(2)}</td>
        </tr>`;
      }
    }
    return excelResponse(c, "job-labor-cost.xls", `<table>
      <thead><tr><th>Job #</th><th>Job Name</th><th>Jurisdiction</th><th>Emp #</th><th>Name</th><th>Classification</th><th>Licensed</th><th>Hourly Rate</th><th>Cost Rate</th><th>Daily (8hr)</th><th>Weekly</th><th>Monthly</th></tr></thead>
      <tbody>${excelRows}</tbody>
    </table>`);
  }

  let jobSections = "";

  for (const job of activeJobs) {
    const crew = allAssignments.filter((a) => a.jobId === job.id);
    if (crew.length === 0 && !jobId) continue; // skip empty jobs in overview

    let jobDailyCost = 0;
    const crewRows = crew.map((e) => {
      let hourly = 0;
      let costRate = 0;
      if (job.jurisdictionId && e.classificationId) {
        const key = `${Number(job.jurisdictionId)}:${Number(e.classificationId)}`;
        const rate = rateMap.get(key);
        if (rate) {
          hourly = rate.hourlyRate;
          costRate = rate.totalCostRate;
        }
      }
      const daily = costRate * 8;
      jobDailyCost += daily;

      return `<tr>
        <td class="font-mono">${esc(e.employeeNumber)}</td>
        <td>${esc(e.firstName)} ${esc(e.lastName)}</td>
        <td><span class="badge" style="background:${e.classificationColor || '#64748b'}">${esc(e.classificationName)}</span></td>
        <td class="text-center">${e.hasLicense ? "Yes" : ""}</td>
        <td class="text-right font-mono">${money(hourly)}</td>
        <td class="text-right font-mono">${money(costRate)}</td>
        <td class="text-right font-mono font-bold">${money(daily)}</td>
      </tr>`;
    });

    const weeklyLaborCost = jobDailyCost * 5;
    const monthlyLaborCost = jobDailyCost * 21.67; // avg working days per month
    const compositeHourly = crew.length > 0
      ? crew.reduce((s, e) => {
          if (!job.jurisdictionId || !e.classificationId) return s;
          const rate = rateMap.get(`${Number(job.jurisdictionId)}:${Number(e.classificationId)}`);
          return s + (rate?.hourlyRate || 0);
        }, 0) / crew.length
      : 0;

    const licensedCount = crew.filter((e) => e.hasLicense).length;
    const nonLicensedCount = crew.length - licensedCount;
    let ratioStr = "—";
    if (crew.length > 0) {
      if (licensedCount === 0) {
        ratioStr = `0 / ${nonLicensedCount}`;
      } else {
        const r = Math.round((nonLicensedCount / licensedCount) * 100) / 100;
        ratioStr = `1 / ${r}`;
      }
    }

    totalAllJobsDaily += jobDailyCost;
    totalAllJobsWeekly += weeklyLaborCost;
    totalAllJobsMonthly += monthlyLaborCost;

    jobSections += `
      <div class="section-title">${esc(job.jobNumber)} — ${esc(job.name)}</div>
      <div style="font-size:10px; color:#666; margin-bottom:6px;">
        Jurisdiction: <strong>${esc(job.jurisdictionName) || "None"}</strong>
        &nbsp;|&nbsp; Crew: <strong>${crew.length}</strong>
        &nbsp;|&nbsp; Ratio: <strong>${ratioStr}</strong>
        &nbsp;|&nbsp; Composite Hourly: <strong>${money(compositeHourly)}</strong>
      </div>

      ${crew.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Emp #</th>
            <th>Name</th>
            <th>Classification</th>
            <th class="text-center">Licensed</th>
            <th class="text-right">Hourly Rate</th>
            <th class="text-right">Cost Rate</th>
            <th class="text-right">Daily (8hr)</th>
          </tr>
        </thead>
        <tbody>
          ${crewRows.join("")}
        </tbody>
        <tfoot>
          <tr style="border-top: 2px solid #999;">
            <td colspan="4"></td>
            <td class="text-right font-bold" colspan="2">Total Daily</td>
            <td class="text-right font-mono font-bold text-accent">${money(jobDailyCost)}</td>
          </tr>
          <tr>
            <td colspan="4"></td>
            <td class="text-right font-bold" colspan="2">Weekly (5 day)</td>
            <td class="text-right font-mono font-bold">${money(weeklyLaborCost)}</td>
          </tr>
          <tr>
            <td colspan="4"></td>
            <td class="text-right font-bold" colspan="2">Monthly (avg)</td>
            <td class="text-right font-mono font-bold">${money(monthlyLaborCost)}</td>
          </tr>
        </tfoot>
      </table>` : `<p class="text-muted" style="margin-bottom:12px;">No crew assigned</p>`}
    `;
  }

  // Grand total summary (only if showing multiple jobs)
  let summaryHtml = "";
  if (!jobId && activeJobs.length > 1) {
    summaryHtml = `
      <div class="summary-row">
        <div class="summary-card">
          <div class="label">Jobs with Crew</div>
          <div class="value">${activeJobs.filter((j) => allAssignments.some((a) => a.jobId === j.id)).length}</div>
        </div>
        <div class="summary-card">
          <div class="label">Total Daily Labor</div>
          <div class="value">${money(totalAllJobsDaily)}</div>
        </div>
        <div class="summary-card">
          <div class="label">Total Weekly Labor</div>
          <div class="value">${money(totalAllJobsWeekly)}</div>
        </div>
        <div class="summary-card">
          <div class="label">Total Monthly Labor</div>
          <div class="value">${money(totalAllJobsMonthly)}</div>
        </div>
      </div>`;
  }

  const subtitle = jobId
    ? `${activeJobs[0]?.jobNumber} — ${activeJobs[0]?.name}`
    : `All active jobs`;

  return c.html(reportShell("Job Labor Cost Report", company, summaryHtml + jobSections, subtitle));
});

// ═══════════════════════════════════════════════════════════════
// REPORT 3: Manpower Summary (all active jobs at a glance)
// ═══════════════════════════════════════════════════════════════
reports.get("/manpower-summary", async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const format = c.req.query("format");

  const activeJobs = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      name: jobs.name,
      jurisdictionId: jobs.jurisdictionId,
      jurisdictionName: jurisdictions.name,
    })
    .from(jobs)
    .leftJoin(jurisdictions, eq(jobs.jurisdictionId, jurisdictions.id))
    .where(and(sql`${jobs.status} IN ('planning', 'active')`, eq(jobs.companyId, companyId)))
    .orderBy(jobs.jobNumber);

  const allAssignments = await db
    .select({
      jobId: jobAssignments.jobId,
      employeeId: jobAssignments.employeeId,
      classificationId: employees.classificationId,
      hasLicense: classifications.hasLicense,
    })
    .from(jobAssignments)
    .innerJoin(employees, eq(jobAssignments.employeeId, employees.id))
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .where(eq(jobAssignments.isActive, true));

  const allRates = await db.select().from(jurisdictionRates).where(eq(jurisdictionRates.companyId, companyId));
  const rateMap = new Map<string, { hourlyRate: number; totalCostRate: number }>();
  for (const r of allRates) {
    rateMap.set(`${Number(r.jurisdictionId)}:${Number(r.classificationId)}`, {
      hourlyRate: r.hourlyRate,
      totalCostRate: r.totalCostRate,
    });
  }

  const totalActiveEmployees = (await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.status, "active"), eq(employees.companyId, companyId)))).length;

  const assignedSet = new Set(allAssignments.map((a) => a.employeeId));
  let totalWeeklyCost = 0;

  // Compute per-job stats
  const jobStats = activeJobs.map((job) => {
    const crew = allAssignments.filter((a) => a.jobId === job.id);
    const licensed = crew.filter((e) => e.hasLicense).length;
    const nonLicensed = crew.length - licensed;

    let compositeHourly = 0;
    let weeklyCost = 0;
    for (const e of crew) {
      if (job.jurisdictionId && e.classificationId) {
        const rate = rateMap.get(`${Number(job.jurisdictionId)}:${Number(e.classificationId)}`);
        if (rate) {
          compositeHourly += rate.hourlyRate;
          weeklyCost += rate.totalCostRate * 40;
        }
      }
    }
    compositeHourly = crew.length > 0 ? compositeHourly / crew.length : 0;
    totalWeeklyCost += weeklyCost;

    let ratioStr = "—";
    if (crew.length > 0) {
      if (licensed === 0) ratioStr = `0/${nonLicensed}`;
      else ratioStr = `1/${(Math.round((nonLicensed / licensed) * 100) / 100)}`;
    }

    return { job, crewCount: crew.length, licensed, ratioStr, compositeHourly, weeklyCost };
  });

  if (format === "excel") {
    const excelRows = jobStats.map(s => `<tr>
      <td>${esc(s.job.jobNumber)}</td>
      <td>${esc(s.job.name)}</td>
      <td>${esc(s.job.jurisdictionName) || ""}</td>
      <td>${s.crewCount}</td>
      <td>${s.licensed}</td>
      <td>${s.ratioStr}</td>
      <td>${s.compositeHourly.toFixed(2)}</td>
      <td>${s.weeklyCost.toFixed(2)}</td>
    </tr>`).join("\n");
    return excelResponse(c, "manpower-summary.xls", `<table>
      <thead><tr><th>Job #</th><th>Job Name</th><th>Jurisdiction</th><th>Crew</th><th>Licensed</th><th>Ratio</th><th>Composite $/hr</th><th>Weekly Cost</th></tr></thead>
      <tbody>${excelRows}</tbody>
    </table>`);
  }

  const rows = jobStats.map(s => `<tr>
      <td class="font-mono">${esc(s.job.jobNumber)}</td>
      <td class="font-bold">${esc(s.job.name)}</td>
      <td>${esc(s.job.jurisdictionName)}</td>
      <td class="text-center">${s.crewCount}</td>
      <td class="text-center">${s.licensed}</td>
      <td class="text-center">${s.ratioStr}</td>
      <td class="text-right font-mono">${money(s.compositeHourly)}</td>
      <td class="text-right font-mono">${money(s.weeklyCost)}</td>
    </tr>`);

  const body = `
    <div class="summary-row">
      <div class="summary-card">
        <div class="label">Active Employees</div>
        <div class="value">${totalActiveEmployees}</div>
      </div>
      <div class="summary-card">
        <div class="label">Assigned</div>
        <div class="value">${assignedSet.size}</div>
      </div>
      <div class="summary-card">
        <div class="label">Bench</div>
        <div class="value">${totalActiveEmployees - assignedSet.size}</div>
      </div>
      <div class="summary-card">
        <div class="label">Total Weekly Labor</div>
        <div class="value">${money(totalWeeklyCost)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Job #</th>
          <th>Job Name</th>
          <th>Jurisdiction</th>
          <th class="text-center">Crew</th>
          <th class="text-center">Licensed</th>
          <th class="text-center">Ratio</th>
          <th class="text-right">Composite $/hr</th>
          <th class="text-right">Weekly Cost</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join("")}
      </tbody>
      <tfoot>
        <tr style="border-top: 2px solid #999;">
          <td colspan="3" class="font-bold">Totals</td>
          <td class="text-center font-bold">${assignedSet.size}</td>
          <td colspan="3"></td>
          <td class="text-right font-mono font-bold text-accent">${money(totalWeeklyCost)}</td>
        </tr>
      </tfoot>
    </table>`;

  return c.html(reportShell("Manpower Summary", company, body, `${activeJobs.length} active jobs`));
});

// ═══════════════════════════════════════════════════════════════
// REPORT 4: Employee Profile (printable personnel file)
// ═══════════════════════════════════════════════════════════════
reports.get("/employee-profile", async (c) => {
  const companyId = getCompanyId(c);
  const empId = c.req.query("id");
  if (!empId) return c.text("Missing employee id", 400);

  const s = await getSettings(companyId);
  const company = s.companyName || "BirdDog";
  const logoUrl = s.companyLogo || "";

  // Get the employee with classification
  const [row] = await db
    .select({
      id: employees.id,
      employeeNumber: employees.employeeNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      status: employees.status,
      phone: employees.phone,
      pePhone: employees.pePhone,
      personalEmail: employees.personalEmail,
      workEmail: employees.workEmail,
      address: employees.address,
      emergencyContactName: employees.emergencyContactName,
      emergencyContactPhone: employees.emergencyContactPhone,
      dateOfHire: employees.dateOfHire,
      dateOfBirth: employees.dateOfBirth,
      placeOfBirth: employees.placeOfBirth,
      shirtSize: employees.shirtSize,
      jacketSize: employees.jacketSize,
      elecLicense: employees.elecLicense,
      dlNumber: employees.dlNumber,
      backgroundCheck: employees.backgroundCheck,
      backgroundCheckDate: employees.backgroundCheckDate,
      reasonForLeaving: employees.reasonForLeaving,
      photoUrl: employees.photoUrl,
      notes: employees.notes,
      classificationName: classifications.name,
      classificationColor: classifications.color,
      department: classifications.department,
    })
    .from(employees)
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .where(and(eq(employees.id, parseInt(empId)), eq(employees.companyId, companyId)))
    .limit(1);

  if (!row) return c.text("Employee not found", 404);

  // Get current job assignments
  const assigns = await db
    .select({
      jobNumber: jobs.jobNumber,
      jobName: jobs.name,
    })
    .from(jobAssignments)
    .innerJoin(jobs, eq(jobAssignments.jobId, jobs.id))
    .where(and(eq(jobAssignments.employeeId, row.id), eq(jobAssignments.isActive, true)));

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const statusBadge = row.status === "active"
    ? '<span style="display:inline-block;padding:2px 10px;border-radius:10px;background:#16a34a;color:#fff;font-size:11px;font-weight:600;">Active</span>'
    : '<span style="display:inline-block;padding:2px 10px;border-radius:10px;background:#94a3b8;color:#fff;font-size:11px;font-weight:600;">Inactive</span>';

  const classBadge = row.classificationName
    ? `<span style="display:inline-block;padding:2px 10px;border-radius:4px;background:${row.classificationColor || '#64748b'};color:#fff;font-size:11px;font-weight:600;">${esc(row.classificationName)}</span>`
    : '<span style="color:#999;">—</span>';

  const photoHtml = row.photoUrl
    ? `<img src="${row.photoUrl}" style="width:140px;height:140px;border-radius:12px;object-fit:cover;border:2px solid #ddd;" />`
    : `<div style="width:140px;height:140px;border-radius:12px;background:#334155;color:#fff;display:flex;align-items:center;justify-content:center;font-size:48px;font-weight:700;border:2px solid #ddd;">
        ${(row.firstName?.[0] || "").toUpperCase()}${(row.lastName?.[0] || "").toUpperCase()}
      </div>`;

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" style="max-height:50px;max-width:180px;object-fit:contain;" />`
    : "";

  function field(label: string, value: string | null | undefined): string {
    return `<tr>
      <td style="padding:5px 12px 5px 0;color:#666;font-size:11px;white-space:nowrap;vertical-align:top;width:140px;">${label}</td>
      <td style="padding:5px 0;font-size:12px;font-weight:500;">${esc(value) || '<span style="color:#ccc;">—</span>'}</td>
    </tr>`;
  }

  function formatDate(d: string | null | undefined): string {
    if (!d) return "";
    try {
      return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch { return d; }
  }

  const assignmentsList = assigns.length > 0
    ? assigns.map(a => `${esc(a.jobNumber)} — ${esc(a.jobName)}`).join("<br/>")
    : '<span style="color:#999;">Unassigned</span>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Employee Profile — ${esc(row.firstName)} ${esc(row.lastName)} — ${esc(company)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      color: #1a1a1a;
      background: #fff;
      padding: 0.4in;
    }

    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #1d5191;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .header-bar .title-side h1 {
      font-size: 20px;
      color: #1d5191;
      font-weight: 700;
    }
    .header-bar .title-side .sub {
      font-size: 11px;
      color: #888;
      margin-top: 2px;
    }
    .header-bar .logo-side {
      text-align: right;
    }
    .header-bar .logo-side .company-name {
      font-size: 14px;
      font-weight: 700;
      color: #333;
    }
    .header-bar .logo-side .date {
      font-size: 10px;
      color: #888;
    }

    .profile-top {
      display: flex;
      gap: 24px;
      margin-bottom: 20px;
      padding: 16px;
      background: #f8fafc;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
    }
    .profile-top .photo-col {
      flex-shrink: 0;
    }
    .profile-top .info-col {
      flex: 1;
    }
    .profile-top .emp-name {
      font-size: 22px;
      font-weight: 700;
      color: #1e293b;
    }
    .profile-top .emp-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 4px;
      flex-wrap: wrap;
    }
    .profile-top .emp-number {
      font-family: "SF Mono", Consolas, monospace;
      font-size: 13px;
      color: #64748b;
    }
    .quick-stats {
      display: flex;
      gap: 20px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .quick-stats .stat {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 14px;
      min-width: 120px;
    }
    .quick-stats .stat .stat-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
      font-weight: 600;
    }
    .quick-stats .stat .stat-value {
      font-size: 13px;
      font-weight: 600;
      color: #1e293b;
      margin-top: 1px;
    }

    .sections {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .section {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px 16px;
      background: #fff;
    }
    .section-full {
      grid-column: 1 / -1;
    }
    .section h3 {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #1d5191;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #e2e8f0;
    }
    .section table {
      width: 100%;
      border-collapse: collapse;
    }

    .report-footer {
      margin-top: 24px;
      padding-top: 8px;
      border-top: 1px solid #ddd;
      font-size: 9px;
      color: #999;
      display: flex;
      justify-content: space-between;
    }

    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      .profile-top { break-inside: avoid; }
      .section { break-inside: avoid; }
      @page { margin: 0.4in; size: portrait; }
      .report-footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 4px 0.4in; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:12px;">
    <button onclick="window.print()" style="padding:6px 16px;background:#1d5191;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
      Print / Save as PDF
    </button>
    <button onclick="window.close()" style="padding:6px 16px;background:#eee;color:#333;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:12px;margin-left:4px;">
      Close
    </button>
  </div>

  <div class="header-bar">
    <div class="title-side">
      <h1>Employee Profile</h1>
      <div class="sub">Personnel Record — Confidential</div>
    </div>
    <div class="logo-side">
      ${logoHtml}
      <div class="company-name">${esc(company)}</div>
      <div class="date">${dateStr}</div>
    </div>
  </div>

  <div class="profile-top">
    <div class="photo-col">${photoHtml}</div>
    <div class="info-col">
      <div class="emp-name">${esc(row.firstName)} ${esc(row.lastName)}</div>
      <div class="emp-meta">
        <span class="emp-number">#${esc(row.employeeNumber)}</span>
        ${classBadge}
        ${row.department ? `<span style="font-size:11px;color:#64748b;">${esc(row.department)}</span>` : ""}
        ${statusBadge}
      </div>
      <div class="quick-stats">
        <div class="stat">
          <div class="stat-label">Date of Hire</div>
          <div class="stat-value">${formatDate(row.dateOfHire) || "—"}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Elec License</div>
          <div class="stat-value" style="font-family:monospace;">${esc(row.elecLicense) || "—"}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Current Assignment</div>
          <div class="stat-value" style="font-size:11px;">${assignmentsList}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="sections">
    <!-- Contact Information -->
    <div class="section">
      <h3>Contact Information</h3>
      <table>
        ${field("Home Phone", row.phone)}
        ${field("PE Cell", row.pePhone)}
        ${field("Personal Email", row.personalEmail)}
        ${field("Work Email", row.workEmail)}
        ${field("Address", row.address)}
      </table>
    </div>

    <!-- Personal Information -->
    <div class="section">
      <h3>Personal Information</h3>
      <table>
        ${field("Date of Birth", formatDate(row.dateOfBirth))}
        ${field("Place of Birth", row.placeOfBirth)}
        ${field("Shirt Size", row.shirtSize)}
        ${field("Jacket Size", row.jacketSize)}
      </table>
    </div>

    <!-- License & Compliance -->
    <div class="section">
      <h3>License & Compliance</h3>
      <table>
        ${field("Electrical License", row.elecLicense)}
        ${field("Driver's License", row.dlNumber)}
        ${field("Background Check", row.backgroundCheck)}
        ${field("BG Check Date", formatDate(row.backgroundCheckDate))}
      </table>
    </div>

    <!-- Emergency Contact -->
    <div class="section">
      <h3>Emergency Contact</h3>
      <table>
        ${field("Contact Name", row.emergencyContactName)}
        ${field("Contact Phone", row.emergencyContactPhone)}
      </table>
    </div>

    <!-- Notes -->
    ${row.notes || row.reasonForLeaving ? `
    <div class="section section-full">
      <h3>Notes & Additional Info</h3>
      <table>
        ${row.reasonForLeaving ? field("Reason for Leaving", row.reasonForLeaving) : ""}
        ${row.notes ? field("Notes", row.notes) : ""}
      </table>
    </div>` : ""}
  </div>

  <div class="report-footer">
    <span>BirdDog — ${esc(company)} — Confidential Personnel Record</span>
    <span>Generated ${dateStr} at ${timeStr}</span>
  </div>
</body>
</html>`;

  return c.html(html);
});

// ═══════════════════════════════════════════════════════════════
// ── Excel export helper (HTML table → .xls) ──────────────────
// ═══════════════════════════════════════════════════════════════

function excelResponse(c: any, filename: string, tableHtml: string) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:spreadsheet" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><style>td,th{mso-number-format:\\@;}</style></head>
<body>${tableHtml}</body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "application/vnd.ms-excel",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return d; }
}

// ═══════════════════════════════════════════════════════════════
// ── Employee Directory ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

reports.get("/employee-directory", async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const format = c.req.query("format");

  const rows = await db
    .select({
      employeeNumber: employees.employeeNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      phone: employees.phone,
      pePhone: employees.pePhone,
      personalEmail: employees.personalEmail,
      workEmail: employees.workEmail,
      classificationName: classifications.name,
      classificationColor: classifications.color,
      department: classifications.department,
    })
    .from(employees)
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .where(and(eq(employees.status, "active"), eq(employees.companyId, companyId)))
    .orderBy(employees.lastName, employees.firstName);

  const tableRows = rows.map(r => `<tr>
    <td class="font-mono">${esc(r.employeeNumber)}</td>
    <td class="font-bold">${esc(r.lastName)}, ${esc(r.firstName)}</td>
    <td>${r.classificationName ? `<span class="badge" style="background:${r.classificationColor || '#64748b'}">${esc(r.classificationName)}</span>` : "—"}</td>
    <td>${esc(r.department) || "—"}</td>
    <td>${esc(r.phone) || "—"}</td>
    <td>${esc(r.pePhone) || "—"}</td>
    <td>${esc(r.personalEmail) || "—"}</td>
    <td>${esc(r.workEmail) || "—"}</td>
  </tr>`).join("\n");

  const table = `<table>
    <thead><tr>
      <th>Emp #</th><th>Name</th><th>Classification</th><th>Department</th>
      <th>Home Phone</th><th>PE Cell</th><th>Personal Email</th><th>Work Email</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>`;

  if (format === "excel") {
    return excelResponse(c, "employee-directory.xls", table);
  }

  const body = `
    <div class="summary-row">
      <div class="summary-card"><div class="label">Active Employees</div><div class="value">${rows.length}</div></div>
    </div>
    ${table}`;

  return c.html(reportShell("Employee Directory", company, body, "Active employee contact information"));
});

// ═══════════════════════════════════════════════════════════════
// ── License & Certification Tracker ─────────────────────────
// ═══════════════════════════════════════════════════════════════

reports.get("/license-tracker", async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const format = c.req.query("format");

  const rows = await db
    .select({
      employeeNumber: employees.employeeNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      elecLicense: employees.elecLicense,
      dlNumber: employees.dlNumber,
      dlState: employees.dlState,
      dlExpiration: employees.dlExpiration,
      backgroundCheck: employees.backgroundCheck,
      backgroundCheckDate: employees.backgroundCheckDate,
      classificationName: classifications.name,
      hasLicense: classifications.hasLicense,
    })
    .from(employees)
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .where(and(eq(employees.status, "active"), eq(employees.companyId, companyId)))
    .orderBy(employees.lastName, employees.firstName);

  const today = new Date().toISOString().split("T")[0];
  const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  function dlStatus(exp: string | null): string {
    if (!exp) return '<span class="text-muted">No exp. date</span>';
    if (exp < today) return '<span style="color:#dc2626;font-weight:600;">EXPIRED</span>';
    if (exp < thirtyDays) return '<span style="color:#d97706;font-weight:600;">Expiring Soon</span>';
    return '<span style="color:#16a34a;">Current</span>';
  }

  function dlStatusText(exp: string | null): string {
    if (!exp) return "No exp. date";
    if (exp < today) return "EXPIRED";
    if (exp < thirtyDays) return "Expiring Soon";
    return "Current";
  }

  const withElec = rows.filter(r => r.elecLicense);
  const withDL = rows.filter(r => r.dlNumber);
  const expiredDL = rows.filter(r => r.dlExpiration && r.dlExpiration < today);
  const expiringSoonDL = rows.filter(r => r.dlExpiration && r.dlExpiration >= today && r.dlExpiration < thirtyDays);

  const tableRows = rows.map(r => `<tr>
    <td class="font-mono">${esc(r.employeeNumber)}</td>
    <td class="font-bold">${esc(r.lastName)}, ${esc(r.firstName)}</td>
    <td>${esc(r.classificationName) || "—"}</td>
    <td class="font-mono">${esc(r.elecLicense) || "—"}</td>
    <td class="font-mono">${esc(r.dlNumber) || "—"}</td>
    <td>${esc(r.dlState) || "—"}</td>
    <td>${fmtDate(r.dlExpiration)}</td>
    <td>${format === "excel" ? dlStatusText(r.dlExpiration) : dlStatus(r.dlExpiration)}</td>
    <td>${esc(r.backgroundCheck) || "—"}</td>
    <td>${fmtDate(r.backgroundCheckDate)}</td>
  </tr>`).join("\n");

  const table = `<table>
    <thead><tr>
      <th>Emp #</th><th>Name</th><th>Classification</th><th>Elec License</th>
      <th>DL Number</th><th>DL State</th><th>DL Expiration</th><th>DL Status</th>
      <th>BG Check</th><th>BG Date</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>`;

  if (format === "excel") {
    return excelResponse(c, "license-tracker.xls", table);
  }

  const body = `
    <div class="summary-row">
      <div class="summary-card"><div class="label">Electrical Licenses</div><div class="value">${withElec.length}</div><div class="detail">of ${rows.length} active employees</div></div>
      <div class="summary-card"><div class="label">Driver's Licenses on File</div><div class="value">${withDL.length}</div></div>
      <div class="summary-card" ${expiredDL.length > 0 ? 'style="border-left-color:#dc2626"' : ""}><div class="label">Expired DL</div><div class="value" ${expiredDL.length > 0 ? 'style="color:#dc2626"' : ""}>${expiredDL.length}</div></div>
      <div class="summary-card" ${expiringSoonDL.length > 0 ? 'style="border-left-color:#d97706"' : ""}><div class="label">Expiring in 30 Days</div><div class="value" ${expiringSoonDL.length > 0 ? 'style="color:#d97706"' : ""}>${expiringSoonDL.length}</div></div>
    </div>
    ${table}`;

  return c.html(reportShell("License & Certification Tracker", company, body, "Active employee licenses and compliance"));
});

// ═══════════════════════════════════════════════════════════════
// ── Tool Assignment Report ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════

reports.get("/tool-assignment", async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const format = c.req.query("format");

  const rows = await db
    .select({
      id: assets.id,
      description: assets.description,
      category: assets.category,
      manufacturer: assets.manufacturer,
      model: assets.model,
      serialNumber: assets.serialNumber,
      identifier: assets.identifier,
      status: assets.status,
      condition: assets.condition,
      assignedToEmployee: assets.assignedToEmployee,
      empFirstName: employees.firstName,
      empLastName: employees.lastName,
      empNumber: employees.employeeNumber,
    })
    .from(assets)
    .leftJoin(employees, eq(assets.assignedToEmployee, employees.id))
    .where(and(eq(assets.type, "tool"), eq(assets.companyId, companyId)))
    .orderBy(employees.lastName, employees.firstName, assets.description);

  const catLabels: Record<string, string> = {
    power_tool: "Power Tool", specialty: "Specialty", hand_tool: "Hand Tool",
    safety: "Safety", testing: "Testing / Meter", other: "Other",
  };

  // Group by employee
  const assigned = rows.filter(r => r.assignedToEmployee);
  const unassigned = rows.filter(r => !r.assignedToEmployee);

  // Group assigned by person
  const byPerson = new Map<string, typeof rows>();
  for (const r of assigned) {
    const key = `${r.empLastName}, ${r.empFirstName} (${r.empNumber})`;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key)!.push(r);
  }

  if (format === "excel") {
    const excelRows = rows.map(r => `<tr>
      <td>${esc(r.empLastName ? `${r.empLastName}, ${r.empFirstName}` : "Unassigned")}</td>
      <td>${esc(r.empNumber) || ""}</td>
      <td>${esc(r.description)}</td>
      <td>${catLabels[r.category || ""] || r.category || ""}</td>
      <td>${esc(r.manufacturer) || ""}</td>
      <td>${esc(r.serialNumber) || esc(r.identifier) || ""}</td>
      <td>${r.status || ""}</td>
      <td>${r.condition || ""}</td>
    </tr>`).join("\n");

    return excelResponse(c, "tool-assignment.xls", `<table>
      <thead><tr><th>Assigned To</th><th>Emp #</th><th>Description</th><th>Category</th><th>Manufacturer</th><th>Serial/Tag</th><th>Status</th><th>Condition</th></tr></thead>
      <tbody>${excelRows}</tbody>
    </table>`);
  }

  let body = `
    <div class="summary-row">
      <div class="summary-card"><div class="label">Total Tools</div><div class="value">${rows.length}</div></div>
      <div class="summary-card"><div class="label">Assigned</div><div class="value">${assigned.length}</div></div>
      <div class="summary-card"><div class="label">Unassigned</div><div class="value">${unassigned.length}</div></div>
      <div class="summary-card"><div class="label">People with Tools</div><div class="value">${byPerson.size}</div></div>
    </div>`;

  for (const [person, tools] of byPerson) {
    body += `<div class="section-title">${esc(person)} <span class="text-muted" style="font-weight:400;font-size:11px;">(${tools.length} tools)</span></div>`;
    body += `<table><thead><tr>
      <th>Description</th><th>Category</th><th>Manufacturer</th><th>Serial / Tag</th><th>Status</th><th>Condition</th>
    </tr></thead><tbody>`;
    for (const t of tools) {
      body += `<tr>
        <td>${esc(t.description)}</td>
        <td>${catLabels[t.category || ""] || esc(t.category) || "—"}</td>
        <td>${esc(t.manufacturer) || "—"}</td>
        <td class="font-mono">${esc(t.serialNumber) || esc(t.identifier) || "—"}</td>
        <td>${t.status || "—"}</td>
        <td>${t.condition || "—"}</td>
      </tr>`;
    }
    body += `</tbody></table>`;
  }

  if (unassigned.length > 0) {
    body += `<div class="section-title">Unassigned <span class="text-muted" style="font-weight:400;font-size:11px;">(${unassigned.length} tools)</span></div>`;
    body += `<table><thead><tr>
      <th>Description</th><th>Category</th><th>Manufacturer</th><th>Serial / Tag</th><th>Status</th><th>Condition</th>
    </tr></thead><tbody>`;
    for (const t of unassigned) {
      body += `<tr>
        <td>${esc(t.description)}</td>
        <td>${catLabels[t.category || ""] || esc(t.category) || "—"}</td>
        <td>${esc(t.manufacturer) || "—"}</td>
        <td class="font-mono">${esc(t.serialNumber) || esc(t.identifier) || "—"}</td>
        <td>${t.status || "—"}</td>
        <td>${t.condition || "—"}</td>
      </tr>`;
    }
    body += `</tbody></table>`;
  }

  return c.html(reportShell("Tool Assignment Report", company, body, `${rows.length} tools across ${byPerson.size} employees`));
});

// ═══════════════════════════════════════════════════════════════
// ── Vehicle Fleet Report ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

reports.get("/vehicle-fleet", async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const format = c.req.query("format");

  const rows = await db
    .select({
      id: assets.id,
      description: assets.description,
      category: assets.category,
      manufacturer: assets.manufacturer,
      model: assets.model,
      serialNumber: assets.serialNumber,
      identifier: assets.identifier,
      status: assets.status,
      condition: assets.condition,
      notes: assets.notes,
      assignedToEmployee: assets.assignedToEmployee,
      empFirstName: employees.firstName,
      empLastName: employees.lastName,
      empNumber: employees.employeeNumber,
    })
    .from(assets)
    .leftJoin(employees, eq(assets.assignedToEmployee, employees.id))
    .where(and(eq(assets.type, "vehicle"), eq(assets.companyId, companyId)))
    .orderBy(assets.model, assets.description);

  const catLabels: Record<string, string> = {
    truck: "Truck", van: "Van", suv: "SUV", trailer: "Trailer", other: "Other",
  };

  const assigned = rows.filter(r => r.assignedToEmployee);
  const available = rows.filter(r => r.status === "available");
  const retired = rows.filter(r => r.status === "retired");

  const tableRows = rows.map(r => `<tr>
    <td class="font-mono font-bold">${esc(r.model) || "—"}</td>
    <td>${esc(r.description)}</td>
    <td>${catLabels[r.category || ""] || esc(r.category) || "—"}</td>
    <td>${esc(r.manufacturer) || "—"}</td>
    <td class="font-mono">${esc(r.serialNumber) || "—"}</td>
    <td class="font-mono">${esc(r.identifier) || "—"}</td>
    <td>${r.assignedToEmployee ? `${esc(r.empLastName)}, ${esc(r.empFirstName)}` : '<span class="text-muted">—</span>'}</td>
    <td>${r.status || "—"}</td>
    <td>${r.condition || "—"}</td>
  </tr>`).join("\n");

  const table = `<table>
    <thead><tr>
      <th>Vehicle #</th><th>Description</th><th>Type</th><th>Make</th>
      <th>VIN (last 4)</th><th>Plate</th><th>Assigned To</th><th>Status</th><th>Condition</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>`;

  if (format === "excel") {
    return excelResponse(c, "vehicle-fleet.xls", table);
  }

  const body = `
    <div class="summary-row">
      <div class="summary-card"><div class="label">Total Vehicles</div><div class="value">${rows.length}</div></div>
      <div class="summary-card"><div class="label">Assigned</div><div class="value">${assigned.length}</div></div>
      <div class="summary-card"><div class="label">Available</div><div class="value">${available.length}</div></div>
      <div class="summary-card"><div class="label">Retired</div><div class="value">${retired.length}</div></div>
    </div>
    ${table}`;

  return c.html(reportShell("Vehicle Fleet Report", company, body, `${rows.length} vehicles in fleet`));
});

// ═══════════════════════════════════════════════════════════════
// ── Daily Manpower Log ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

reports.get("/daily-manpower-log", async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const format = c.req.query("format");
  const dateParam = c.req.query("date"); // single date or empty for last 5 committed days

  // Get committed log entries
  let rows;
  let dateLabel: string;

  if (dateParam) {
    rows = await db
      .select({
        date: dailyLog.date,
        employeeId: dailyLog.employeeId,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeNumber: employees.employeeNumber,
        classificationName: classifications.name,
        jobNumber: jobs.jobNumber,
        jobName: jobs.name,
      })
      .from(dailyLog)
      .leftJoin(employees, eq(dailyLog.employeeId, employees.id))
      .leftJoin(classifications, eq(employees.classificationId, classifications.id))
      .leftJoin(jobs, eq(dailyLog.jobId, jobs.id))
      .where(and(eq(dailyLog.date, dateParam), eq(dailyLog.companyId, companyId)))
      .orderBy(employees.lastName, employees.firstName);
    dateLabel = dateParam;
  } else {
    // Get last 5 committed dates
    const recentDates = await db
      .select({ date: dailyLog.date })
      .from(dailyLog)
      .where(eq(dailyLog.companyId, companyId))
      .groupBy(dailyLog.date)
      .orderBy(sql`${dailyLog.date} DESC`)
      .limit(5);

    if (recentDates.length === 0) {
      return c.html(reportShell("Daily Manpower Log", company,
        `<p style="padding:20px;text-align:center;color:#888;">No committed days found. Use the Schedule page to commit a day first.</p>`,
        "No data"
      ));
    }

    const dates = recentDates.map(r => r.date);
    dateLabel = `${dates[dates.length - 1]} to ${dates[0]}`;

    rows = await db
      .select({
        date: dailyLog.date,
        employeeId: dailyLog.employeeId,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeNumber: employees.employeeNumber,
        classificationName: classifications.name,
        jobNumber: jobs.jobNumber,
        jobName: jobs.name,
      })
      .from(dailyLog)
      .leftJoin(employees, eq(dailyLog.employeeId, employees.id))
      .leftJoin(classifications, eq(employees.classificationId, classifications.id))
      .leftJoin(jobs, eq(dailyLog.jobId, jobs.id))
      .where(and(sql`${dailyLog.date} IN (${sql.join(dates.map(d => sql`${d}`), sql`,`)})`, eq(dailyLog.companyId, companyId)))
      .orderBy(dailyLog.date, employees.lastName);
  }

  // Group by date for display
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byDate.get(r.date) || [];
    arr.push(r);
    byDate.set(r.date, arr);
  }

  let sections = "";
  for (const [date, entries] of [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const onJob = entries.filter(e => e.jobNumber);
    const onBench = entries.filter(e => !e.jobNumber);

    const tableRows = entries.map(r => `<tr>
      <td>${r.employeeNumber || "—"}</td>
      <td>${r.lastName}, ${r.firstName}</td>
      <td>${r.classificationName || "—"}</td>
      <td>${r.jobNumber ? `${r.jobNumber} — ${r.jobName}` : '<span class="text-muted">Bench</span>'}</td>
    </tr>`).join("\n");

    const d = new Date(date + "T12:00:00");
    const dayName = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });

    sections += `
      <h3 class="section-title">${dayName} <span style="font-weight:400;font-size:11px;color:#888;margin-left:8px;">${onJob.length} on jobs, ${onBench.length} on bench</span></h3>
      <table>
        <thead><tr><th>Emp #</th><th>Name</th><th>Classification</th><th>Assignment</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>`;
  }

  if (format === "excel") {
    // Flat table for Excel
    const excelRows = rows.map(r => `<tr>
      <td>${r.date}</td>
      <td>${r.employeeNumber || ""}</td>
      <td>${r.lastName}, ${r.firstName}</td>
      <td>${r.classificationName || ""}</td>
      <td>${r.jobNumber || "Bench"}</td>
      <td>${r.jobName || ""}</td>
    </tr>`).join("\n");
    const excelTable = `<table>
      <thead><tr><th>Date</th><th>Emp #</th><th>Name</th><th>Classification</th><th>Job #</th><th>Job Name</th></tr></thead>
      <tbody>${excelRows}</tbody>
    </table>`;
    return excelResponse(c, "daily-manpower-log.xls", excelTable);
  }

  const totalEntries = rows.length;
  const uniqueDates = byDate.size;
  const body = `
    <div class="summary-row">
      <div class="summary-card"><div class="label">Days Shown</div><div class="value">${uniqueDates}</div></div>
      <div class="summary-card"><div class="label">Total Entries</div><div class="value">${totalEntries}</div></div>
    </div>
    ${sections}`;

  return c.html(reportShell("Daily Manpower Log", company, body, dateLabel));
});

// ── Classification Totals ──────────────────────────────────────
reports.get("/classification-totals", async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);

  // Per-classification counts
  const rows = await db
    .select({
      classificationName: classifications.name,
      classificationGroup: classifications.classificationGroup,
      count: sql<number>`count(*)`,
    })
    .from(employees)
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .where(and(eq(employees.status, "active"), eq(employees.companyId, companyId)))
    .groupBy(classifications.name, classifications.classificationGroup)
    .orderBy(sql`count(*) desc`);

  const total = rows.reduce((s, r) => s + r.count, 0);

  // Group by classificationGroup — items with a group get rolled up, items without stay flat
  interface Bucket { label: string; count: number; detail: string[] }
  const groupMap = new Map<string, { count: number; detail: string[] }>();
  const ungrouped: Bucket[] = [];

  for (const r of rows) {
    const name = r.classificationName || "Unclassified";
    const group = r.classificationGroup?.trim();
    if (group) {
      if (!groupMap.has(group)) groupMap.set(group, { count: 0, detail: [] });
      const g = groupMap.get(group)!;
      g.count += r.count;
      g.detail.push(`${name}: ${r.count}`);
    } else {
      ungrouped.push({ label: name, count: r.count, detail: [] });
    }
  }

  const buckets: Bucket[] = [];
  for (const [key, val] of groupMap.entries()) {
    buckets.push({ label: key, count: val.count, detail: val.detail });
  }
  buckets.push(...ungrouped);
  buckets.sort((a, b) => b.count - a.count);

  // Build grouped sections: roll-ups show sub-items indented, singles show flat
  const sectionHtml = buckets.map(b => {
    if (b.detail.length > 0) {
      const subRows = b.detail.map(d => {
        const [name, cnt] = d.split(": ");
        return `<div style="display:flex;justify-content:space-between;padding:2px 0 2px 16px;font-size:10px;color:#86868b;">
          <span>${name}</span><span>${cnt}</span>
        </div>`;
      }).join("");
      return `<div style="border-bottom:1px solid #f0f0f2;padding:6px 0;">
        <div style="display:flex;justify-content:space-between;font-size:11px;">
          <span style="font-weight:600;color:#1d1d1f;">${b.label}</span>
          <span style="font-weight:700;color:#1d1d1f;">${b.count}</span>
        </div>
        ${subRows}
      </div>`;
    } else {
      return `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #f0f0f2;padding:6px 0;font-size:11px;">
        <span style="font-weight:600;color:#1d1d1f;">${b.label}</span>
        <span style="font-weight:700;color:#1d1d1f;">${b.count}</span>
      </div>`;
    }
  }).join("");

  const body = `
    <div style="max-width:400px;">
      ${sectionHtml}
      <div style="display:flex;justify-content:space-between;padding:8px 0 0;margin-top:4px;border-top:2px solid #1d5191;font-size:12px;">
        <span style="font-weight:700;color:#1d1d1f;">Total Active Workforce</span>
        <span style="font-weight:700;color:#1d5191;">${total}</span>
      </div>
    </div>`;

  return c.html(reportShell("Workforce Classification Totals", company, body));
});

// ── Shared CSS + JS for all financial reports ──────────────────
function financeCSS(): string {
  return `
  :root {
    --bg: #f5f5f7; --card: #ffffff; --border: #e8e8ed;
    --text: #1d1d1f; --text2: #424245; --text3: #86868b;
    --blue: #1d5191; --green: #30d158; --red: #ff3b30;
    --orange: #ff9f0a; --cyan: #0071e3; --purple: #af52de;
    --teal: #30b0c7; --pink: #ff375f; --indigo: #5856d6;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--text); padding:2rem; -webkit-font-smoothing:antialiased; }
  .header { display:flex; align-items:flex-end; justify-content:space-between; margin-bottom:2rem; padding-bottom:1.5rem; border-bottom:1px solid var(--border); }
  .header h1 { font-size:2rem; font-weight:700; letter-spacing:-0.02em; }
  .header p { font-size:0.875rem; color:var(--text3); margin-top:0.25rem; }
  .header .date { font-size:0.8125rem; color:var(--text3); text-align:right; }
  .nav-pills { display:flex; gap:0.5rem; margin-bottom:2rem; flex-wrap:wrap; }
  .nav-pill { padding:0.375rem 1rem; border-radius:100px; font-size:0.75rem; font-weight:500; border:1px solid var(--border); background:var(--card); color:var(--text2); cursor:pointer; text-decoration:none; transition:all 0.15s; }
  .nav-pill:hover { border-color:var(--blue); color:var(--blue); }
  .nav-pill.active { background:var(--blue); color:#fff; border-color:var(--blue); }
  .kpi-strip { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:1rem; margin-bottom:2rem; }
  .kpi { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:1.25rem; box-shadow:0 2px 8px rgba(0,0,0,0.04); }
  .kpi-label { font-size:0.6875rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--text3); margin-bottom:0.375rem; }
  .kpi-value { font-size:1.5rem; font-weight:700; letter-spacing:-0.02em; }
  .kpi-sub { font-size:0.75rem; color:var(--text3); margin-top:0.25rem; }
  .kpi-value.green { color:var(--green); } .kpi-value.red { color:var(--red); }
  .kpi-value.orange { color:var(--orange); } .kpi-value.blue { color:var(--blue); }
  .kpi-value.teal { color:var(--teal); } .kpi-value.purple { color:var(--purple); }
  .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; margin-bottom:1.5rem; }
  .grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:1.5rem; margin-bottom:1.5rem; }
  .full-width { grid-column:1/-1; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:1.5rem; box-shadow:0 2px 8px rgba(0,0,0,0.04); }
  .card h2 { font-size:0.9375rem; font-weight:700; color:var(--text); margin-bottom:1rem; letter-spacing:-0.01em; }
  .chart-container { position:relative; height:300px; }
  .chart-container.tall { height:400px; }
  table { width:100%; border-collapse:collapse; font-size:0.8125rem; }
  th { text-align:left; font-weight:600; font-size:0.6875rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--text3); padding:0.5rem 0.75rem; border-bottom:1px solid var(--border); white-space:nowrap; }
  th.right,td.right { text-align:right; }
  th.sortable { cursor:pointer; user-select:none; position:relative; padding-right:1.25rem; }
  th.sortable:hover { color:var(--text); }
  th.sortable::after { content:'\\2195'; position:absolute; right:0.25rem; top:50%; transform:translateY(-50%); font-size:0.5rem; opacity:0.3; }
  th.sortable.asc::after { content:'\\2191'; opacity:0.7; }
  th.sortable.desc::after { content:'\\2193'; opacity:0.7; }
  td { padding:0.625rem 0.75rem; border-bottom:1px solid #f0f0f2; color:var(--text2); }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:#fafafa; }
  .tabnum { font-variant-numeric:tabular-nums; font-family:'SF Mono',ui-monospace,monospace; font-size:0.75rem; }
  .profit { color:var(--green); font-weight:600; }
  .loss { color:var(--red); font-weight:600; }
  .warn { color:var(--orange); font-weight:600; }
  .tag { display:inline-block; padding:0.125rem 0.5rem; border-radius:100px; font-size:0.6875rem; font-weight:500; }
  .tag-active { background:#e8f5e9; color:#2e7d32; }
  .tag-completed { background:#e3f2fd; color:#1565c0; }
  .tag-planning { background:#fff3e0; color:#e65100; }
  .bar-track { height:6px; background:#eee; border-radius:3px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:3px; transition:width 0.3s; }
  .bar-fill.green { background:var(--green); } .bar-fill.orange { background:var(--orange); } .bar-fill.red { background:var(--red); } .bar-fill.blue { background:var(--blue); } .bar-fill.teal { background:var(--teal); }
  .health-badge { display:inline-flex; align-items:center; gap:0.25rem; padding:0.25rem 0.625rem; border-radius:100px; font-size:0.6875rem; font-weight:600; letter-spacing:0.02em; }
  .health-excellent { background:#dcfce7; color:#166534; }
  .health-good { background:#e0f2fe; color:#075985; }
  .health-fair { background:#fef3c7; color:#92400e; }
  .health-poor { background:#fee2e2; color:#991b1b; }
  .health-critical { background:#991b1b; color:#fff; }
  .health-dot { width:6px; height:6px; border-radius:50%; }
  .health-excellent .health-dot { background:#22c55e; }
  .health-good .health-dot { background:#0ea5e9; }
  .health-fair .health-dot { background:#f59e0b; }
  .health-poor .health-dot { background:#ef4444; }
  .health-critical .health-dot { background:#fff; }
  .score-ring { display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:50%; font-size:0.875rem; font-weight:700; border:3px solid; }
  .empty { color:var(--text3); font-style:italic; text-align:center; padding:2rem; }
  @media (max-width:900px) { .grid-2,.grid-3 { grid-template-columns:1fr; } body { padding:1rem; } }
  @media print { body { padding:0.5in; } .card { break-inside:avoid; } .nav-pills { display:none; } }
  `;
}

function financeJS(): string {
  return `
function totalCost(r){return(r.labor_cost||0)+(r.material_cost||0)+(r.general_cost||0)}
function totalBudget(r){return(r.labor_budget||0)+(r.material_budget||0)+(r.general_budget||0)}
function profit(r){return r.total_contract?r.total_contract-totalCost(r):null}
function margin(r){const p=profit(r);return(p!==null&&r.total_contract)?p/r.total_contract:null}
function pct(u,b){return b>0?u/b:null}
function fmtD(v){if(v==null)return'—';const n=v<0;const a=Math.abs(v);if(a>=1e6)return(n?'-':'')+'$'+(a/1e6).toFixed(1)+'M';if(a>=1e3)return(n?'-':'')+'$'+(a/1e3).toFixed(0)+'K';return(n?'-':'')+'$'+a.toFixed(0)}
function fmtD2(v){if(v==null)return'—';return(v<0?'-':'')+'$'+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}
function fmtP(v){if(v==null)return'—';return(v*100).toFixed(1)+'%'}
function fmtN(v){if(v==null)return'—';return v.toLocaleString('en-US',{maximumFractionDigits:0})}
function shortName(r){return r.matched_job_name||r.job_name?.replace(/^\\d+\\s+/,'')||r.job_number}
function jobCell(r){return'<span style="color:var(--blue);font-weight:600">'+r.job_number+'</span> <span style="font-size:0.6875rem;color:var(--text3)">'+shortName(r)+'</span>'}
function statusTag(s){const c=s==='active'?'tag-active':s==='completed'?'tag-completed':'tag-planning';return'<span class="tag '+c+'">'+s+'</span>'}
function makeSortable(tableId){
  const table=document.getElementById(tableId);if(!table)return;
  table.querySelectorAll('th.sortable').forEach(th=>{
    th.addEventListener('click',()=>{
      const col=th.dataset.col;const wasAsc=th.classList.contains('asc');
      table.querySelectorAll('th.sortable').forEach(h=>{h.classList.remove('asc','desc')});
      th.classList.add(wasAsc?'desc':'asc');const dir=wasAsc?-1:1;
      const tbody=table.querySelector('tbody');const rows=[...tbody.querySelectorAll('tr')];
      rows.sort((a,b)=>{const aV=a.dataset[col]||'';const bV=b.dataset[col]||'';
        const aN=parseFloat(aV);const bN=parseFloat(bV);
        if(!isNaN(aN)&&!isNaN(bN))return(aN-bN)*dir;return aV.localeCompare(bV)*dir;});
      rows.forEach(r=>tbody.appendChild(r));
    });
  });
}
function kpiHTML(kpis){return kpis.map(k=>'<div class="kpi"><div class="kpi-label">'+k.label+'</div><div class="kpi-value '+(k.cls||'')+'">'+k.value+'</div>'+(k.sub?'<div class="kpi-sub">'+k.sub+'</div>':'')+'</div>').join('')}
// Total cost paid out = sum of all 5 category cost_to_date from summary (the real "paid out")
function sumCatCost(s){if(!s)return 0;return(s.labor_cost_to_date||0)+(s.material_cost_to_date||0)+(s.subcontract_cost_to_date||0)+(s.equipment_cost_to_date||0)+(s.general_cost_to_date||0)}
  `;
}

function financeNav(active: string): string {
  const links = [
    { id: "financial-dashboard", label: "Executive Dashboard" },
    { id: "job-health", label: "Job Health Scores" },
    { id: "cash-position", label: "Cash Position" },
    { id: "earned-value", label: "Earned Value" },
    { id: "budget-variance", label: "Budget Variance" },
    { id: "backlog-projections", label: "Backlog & Projections" },
  ];
  return links.map(l =>
    `<a class="nav-pill${l.id === active ? ' active' : ''}" href="/api/reports/${l.id}">${l.label}</a>`
  ).join("");
}

// ── Financial Dashboard ────────────────────────────────────────
// Admin / super_admin only — overrides the general pm-level middleware
reports.get("/financial-dashboard", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Pull both detail AND summary records
  const detailRows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE (pfd.report_type = 'detail' OR pfd.report_type IS NULL) AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const summaryRows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE pfd.report_type = 'summary' AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const detailJson = JSON.stringify(detailRows);
  const summaryJson = JSON.stringify(summaryRows);
  const hasSummary = summaryRows.length > 0;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Executive Financial Dashboard — ${company}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>${financeCSS()}</style>
</head><body>
<div class="header">
  <div><h1>${company}</h1><p>Executive Financial Dashboard</p></div>
  <div class="date">Report generated: ${dateStr}<br>${detailRows.length} jobs tracked${hasSummary ? '<br>Summary data available' : ''}</div>
</div>
<nav class="nav-pills">${financeNav("financial-dashboard")}</nav>
<div class="kpi-strip" id="kpis"></div>
<div class="grid-2">
  <div class="card"><h2>Profit / Loss by Job</h2><div class="chart-container tall"><canvas id="profitChart"></canvas></div></div>
  <div class="card"><h2>Budget vs. Actual — Top 15 by Contract</h2><div class="chart-container tall"><canvas id="budgetVsActualChart"></canvas></div></div>
</div>
<div class="grid-3">
  <div class="card"><h2>Cost Breakdown — Active Jobs</h2><div class="chart-container"><canvas id="costBreakdownChart"></canvas></div></div>
  <div class="card"><h2>Hours: Budget vs. Used</h2><div class="chart-container"><canvas id="hoursChart"></canvas></div></div>
  <div class="card"><h2>Budget Utilization Scatter</h2><div class="chart-container"><canvas id="utilizationChart"></canvas></div></div>
</div>
${hasSummary ? `<div class="grid-2">
  <div class="card"><h2>Cash Position — Billed vs. Received</h2><div class="chart-container tall"><canvas id="cashChart"></canvas></div></div>
  <div class="card"><h2>Earned Value — Top Jobs</h2><div class="chart-container tall"><canvas id="evChart"></canvas></div></div>
</div>` : ''}
<div class="grid-2">
  <div class="card"><h2 style="color:var(--red)">Jobs Over Budget</h2><table id="overBudgetTable"><thead><tr><th class="sortable" data-col="job">Job</th><th class="right sortable" data-col="budget">Budget</th><th class="right sortable" data-col="actual">Actual</th><th class="right sortable" data-col="over">Over By</th><th class="right sortable" data-col="pct">%</th></tr></thead><tbody></tbody></table></div>
  <div class="card"><h2 style="color:var(--green)">Most Profitable Jobs</h2><table id="profitableTable"><thead><tr><th class="sortable" data-col="job">Job</th><th class="right sortable" data-col="contract">Contract</th><th class="right sortable" data-col="costs">Costs</th><th class="right sortable" data-col="profit">Profit</th><th class="right sortable" data-col="margin">Margin</th></tr></thead><tbody></tbody></table></div>
</div>
<div class="grid-2">
  <div class="card"><h2 style="color:var(--orange)">Hours Over Budget</h2><table id="hoursOverTable"><thead><tr><th class="sortable" data-col="job">Job</th><th class="right sortable" data-col="budget">Budgeted</th><th class="right sortable" data-col="used">Used</th><th class="right sortable" data-col="over">Over By</th><th class="right sortable" data-col="pct">%</th></tr></thead><tbody></tbody></table></div>
  <div class="card"><h2>Hours Remaining — Active</h2><table id="hoursRemainingTable"><thead><tr><th class="sortable" data-col="job">Job</th><th class="right sortable" data-col="budget">Budget</th><th class="right sortable" data-col="used">Used</th><th class="right sortable" data-col="remaining">Remaining</th><th class="sortable" data-col="pct">Progress</th></tr></thead><tbody></tbody></table></div>
</div>
<div class="card full-width" style="margin-top:1.5rem;">
  <h2>All Jobs — Financial Summary</h2>
  <div style="overflow-x:auto;">
    <table id="fullTable">
      <thead><tr>
        <th class="sortable" data-col="job_number">Job #</th><th class="sortable" data-col="name">Name</th><th class="sortable" data-col="status">Status</th>
        <th class="right sortable" data-col="contract">Contract</th><th class="right sortable" data-col="cost">Total Cost</th>
        <th class="right sortable" data-col="profit">Profit</th><th class="right sortable" data-col="margin">Margin</th>
        <th class="right sortable" data-col="hr_budget">Hr Budget</th><th class="right sortable" data-col="hr_used">Hr Used</th><th class="right sortable" data-col="hr_pct">Hr %</th>
        <th class="right sortable" data-col="labor_pct">Labor %</th><th class="right sortable" data-col="mat_pct">Material %</th><th class="right sortable" data-col="gen_pct">General %</th>
        ${hasSummary ? '<th class="right sortable" data-col="pct_complete">% Complete</th><th class="right sortable" data-col="billed">Billed</th><th class="right sortable" data-col="received">Received</th>' : ''}
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>
</div>
<script>
${financeJS()}
const DETAIL=${detailJson};
const SUMMARY=${summaryJson};
const HAS_SUMMARY=${hasSummary};

// Build summary lookup by job_number
const sumMap={};SUMMARY.forEach(s=>{sumMap[s.job_number]=s});

// Merge: detail as base, attach summary fields. paid_out = sum of category costs (not the unreliable PDF field)
const DATA=DETAIL.map(d=>{const s=sumMap[d.job_number];return{...d,s_pct_complete:s?.percent_complete,s_billed:s?.billed_to_date,s_received:s?.received_to_date,s_paid_out:s?sumCatCost(s):0,s_cost:s?.cost_to_date,s_earned:s?.earned_to_date,s_revised_contract:s?.revised_contract_price}});
const activeJobs=DATA.filter(r=>r.job_status==='active');
const completedJobs=DATA.filter(r=>r.job_status==='completed');

// KPIs
const totalContracts=activeJobs.reduce((s,r)=>s+(r.total_contract||0),0);
const totalCosts=activeJobs.reduce((s,r)=>s+totalCost(r),0);
const totalProfit=totalContracts-totalCosts;
const totalMargin=totalContracts>0?totalProfit/totalContracts:0;
const totalHrBudget=activeJobs.reduce((s,r)=>s+(r.hour_budget||0),0);
const totalHrUsed=activeJobs.reduce((s,r)=>s+(r.hours_used||0),0);
const jobsOverBudget=activeJobs.filter(r=>{const tb=totalBudget(r);return tb>0&&totalCost(r)>tb});
const jobsOverHours=activeJobs.filter(r=>r.hour_budget>0&&r.hours_used>r.hour_budget);

const kpis=[
  {label:'Active Contracts',value:fmtD(totalContracts),cls:'blue',sub:activeJobs.length+' active / '+completedJobs.length+' completed'},
  {label:'Total Costs',value:fmtD(totalCosts),sub:fmtP(totalCosts/totalContracts)+' of contracts'},
  {label:'Projected Profit',value:fmtD(totalProfit),cls:totalProfit>=0?'green':'red',sub:fmtP(totalMargin)+' margin'},
  {label:'Hours Used',value:fmtN(totalHrUsed),sub:'of '+fmtN(totalHrBudget)+' ('+fmtP(pct(totalHrUsed,totalHrBudget))+')'},
  {label:'Over Budget',value:jobsOverBudget.length,cls:jobsOverBudget.length>0?'orange':'green',sub:jobsOverHours.length+' over on hours'},
];
if(HAS_SUMMARY){
  const totBilled=activeJobs.reduce((s,r)=>s+(r.s_billed||0),0);
  const totReceived=activeJobs.reduce((s,r)=>s+(r.s_received||0),0);
  const totPaidOut=activeJobs.reduce((s,r)=>s+(r.s_paid_out||0),0);
  const cashPos=totReceived-totPaidOut;
  kpis.push({label:'Cash Position',value:fmtD(cashPos),cls:cashPos>=0?'teal':'red',sub:'Recv '+fmtD(totReceived)+' / Paid '+fmtD(totPaidOut)});
  kpis.push({label:'Billed to Date',value:fmtD(totBilled),cls:'purple',sub:'Collections: '+fmtP(pct(totReceived,totBilled))});
}
document.getElementById('kpis').innerHTML=kpiHTML(kpis);

// Charts
Chart.defaults.font.family="-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif";
Chart.defaults.font.size=11;Chart.defaults.color='#86868b';

// Profit/Loss
const profitData=activeJobs.filter(r=>r.total_contract>0).map(r=>({name:shortName(r),num:r.job_number,profit:profit(r),contract:r.total_contract})).sort((a,b)=>a.profit-b.profit);
new Chart(document.getElementById('profitChart'),{type:'bar',data:{labels:profitData.map(d=>d.num),datasets:[{data:profitData.map(d=>d.profit),backgroundColor:profitData.map(d=>d.profit>=0?'rgba(48,209,88,0.7)':'rgba(255,59,48,0.7)'),borderRadius:3}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>profitData[i[0].dataIndex].name,label:i=>{const d=profitData[i.dataIndex];return['Profit: '+fmtD2(d.profit),'Contract: '+fmtD2(d.contract),'Margin: '+fmtP(d.profit/d.contract)]}}}},scales:{x:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}},y:{ticks:{font:{size:9,family:'ui-monospace,monospace'}},grid:{display:false}}}}});

// Budget vs Actual
const top15=[...activeJobs].filter(r=>r.total_contract>0).sort((a,b)=>b.total_contract-a.total_contract).slice(0,15);
new Chart(document.getElementById('budgetVsActualChart'),{type:'bar',data:{labels:top15.map(r=>r.job_number),datasets:[{label:'Total Budget',data:top15.map(r=>totalBudget(r)),backgroundColor:'rgba(29,81,145,0.25)',borderColor:'rgba(29,81,145,0.6)',borderWidth:1,borderRadius:3},{label:'Actual Cost',data:top15.map(r=>totalCost(r)),backgroundColor:'rgba(255,159,10,0.6)',borderColor:'rgba(255,159,10,0.8)',borderWidth:1,borderRadius:3},{label:'Contract',data:top15.map(r=>r.total_contract),type:'line',borderColor:'#30d158',borderWidth:2,pointRadius:3,pointBackgroundColor:'#30d158',fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{title:i=>shortName(top15[i[0].dataIndex]),label:i=>i.dataset.label+': '+fmtD2(i.raw)}}},scales:{x:{ticks:{font:{size:9,family:'ui-monospace,monospace'}}},y:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}}}}});

// Cost Breakdown
const totalLabor=activeJobs.reduce((s,r)=>s+(r.labor_cost||0),0);
const totalMat=activeJobs.reduce((s,r)=>s+(r.material_cost||0),0);
const totalGen=activeJobs.reduce((s,r)=>s+(r.general_cost||0),0);
new Chart(document.getElementById('costBreakdownChart'),{type:'doughnut',data:{labels:['Labor','Material','General'],datasets:[{data:[totalLabor,totalMat,totalGen],backgroundColor:['#1d5191','#ff9f0a','#af52de'],borderWidth:0,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'bottom',labels:{padding:16}},tooltip:{callbacks:{label:i=>i.label+': '+fmtD2(i.raw)+' ('+fmtP(i.raw/(totalLabor+totalMat+totalGen))+')'}}}}});

// Hours
const hrData=activeJobs.filter(r=>r.hour_budget>0).map(r=>({...r,pctH:r.hours_used/r.hour_budget})).sort((a,b)=>b.pctH-a.pctH).slice(0,15);
new Chart(document.getElementById('hoursChart'),{type:'bar',data:{labels:hrData.map(r=>r.job_number),datasets:[{label:'Budget',data:hrData.map(r=>r.hour_budget),backgroundColor:'rgba(29,81,145,0.25)',borderRadius:3},{label:'Used',data:hrData.map(r=>r.hours_used),backgroundColor:hrData.map(r=>r.hours_used>r.hour_budget?'rgba(255,59,48,0.6)':'rgba(48,209,88,0.6)'),borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{title:i=>shortName(hrData[i[0].dataIndex])}}},scales:{x:{ticks:{font:{size:9,family:'ui-monospace,monospace'}}},y:{ticks:{callback:v=>fmtN(v)},grid:{color:'#f0f0f2'}}}}});

// Utilization Bubble
const activeUtil=activeJobs.filter(r=>totalBudget(r)>0).map(r=>({x:pct(totalCost(r),totalBudget(r))*100,y:r.hour_budget>0?pct(r.hours_used,r.hour_budget)*100:0,r:Math.max(4,Math.sqrt(r.total_contract||0)/50),name:shortName(r),num:r.job_number}));
new Chart(document.getElementById('utilizationChart'),{type:'bubble',data:{datasets:[{data:activeUtil,backgroundColor:activeUtil.map(d=>(d.x>100||d.y>100)?'rgba(255,59,48,0.5)':d.x>80?'rgba(255,159,10,0.5)':'rgba(48,209,88,0.5)'),borderColor:activeUtil.map(d=>(d.x>100||d.y>100)?'rgba(255,59,48,0.8)':d.x>80?'rgba(255,159,10,0.8)':'rgba(48,209,88,0.8)'),borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:i=>{const d=activeUtil[i.dataIndex];return['#'+d.num+' '+d.name,'Cost: '+d.x.toFixed(0)+'% of budget','Hours: '+d.y.toFixed(0)+'% of budget']}}}},scales:{x:{title:{display:true,text:'Cost Utilization %'},grid:{color:'#f0f0f2'}},y:{title:{display:true,text:'Hours Utilization %'},grid:{color:'#f0f0f2'}}}}});

// Cash Position chart (if summary data)
if(HAS_SUMMARY){
  const cashData=activeJobs.filter(r=>r.s_billed>0).sort((a,b)=>(b.s_billed||0)-(a.s_billed||0)).slice(0,15);
  new Chart(document.getElementById('cashChart'),{type:'bar',data:{labels:cashData.map(r=>r.job_number),datasets:[
    {label:'Billed',data:cashData.map(r=>r.s_billed||0),backgroundColor:'rgba(88,86,214,0.5)',borderRadius:3},
    {label:'Received',data:cashData.map(r=>r.s_received||0),backgroundColor:'rgba(48,176,199,0.6)',borderRadius:3},
    {label:'Paid Out',data:cashData.map(r=>r.s_paid_out||0),backgroundColor:'rgba(255,55,95,0.5)',borderRadius:3}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{title:i=>shortName(cashData[i[0].dataIndex]),label:i=>i.dataset.label+': '+fmtD2(i.raw)}}},scales:{x:{ticks:{font:{size:9,family:'ui-monospace,monospace'}}},y:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}}}}});

  // Earned Value chart
  const evData=activeJobs.filter(r=>r.s_earned>0&&r.s_cost>0).sort((a,b)=>(b.s_earned||0)-(a.s_earned||0)).slice(0,15);
  new Chart(document.getElementById('evChart'),{type:'bar',data:{labels:evData.map(r=>r.job_number),datasets:[
    {label:'Earned',data:evData.map(r=>r.s_earned||0),backgroundColor:'rgba(48,209,88,0.6)',borderRadius:3},
    {label:'Cost to Date',data:evData.map(r=>r.s_cost||0),backgroundColor:'rgba(255,59,48,0.4)',borderRadius:3},
    {label:'Revised Contract',data:evData.map(r=>r.s_revised_contract||r.total_contract||0),type:'line',borderColor:'#5856d6',borderWidth:2,pointRadius:3,pointBackgroundColor:'#5856d6',fill:false}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{title:i=>shortName(evData[i[0].dataIndex]),label:i=>{const d=evData[i.dataIndex];const cpi=d.s_earned&&d.s_cost?(d.s_earned/d.s_cost):null;return i.dataset.label+': '+fmtD2(i.raw)+(cpi!==null?' (CPI: '+cpi.toFixed(2)+')':'')}}}},scales:{x:{ticks:{font:{size:9,family:'ui-monospace,monospace'}}},y:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}}}}});
}

// Tables
const overBudget=DATA.filter(r=>{const tb=totalBudget(r);return tb>0&&totalCost(r)>tb}).map(r=>({...r,overAmt:totalCost(r)-totalBudget(r),overPct:(totalCost(r)-totalBudget(r))/totalBudget(r)})).sort((a,b)=>b.overAmt-a.overAmt);
const obTb=document.querySelector('#overBudgetTable tbody');
overBudget.forEach(r=>{const tr=document.createElement('tr');tr.dataset.job=r.job_number;tr.dataset.budget=totalBudget(r);tr.dataset.actual=totalCost(r);tr.dataset.over=r.overAmt;tr.dataset.pct=r.overPct;tr.innerHTML='<td>'+jobCell(r)+'</td><td class="right tabnum">'+fmtD2(totalBudget(r))+'</td><td class="right tabnum">'+fmtD2(totalCost(r))+'</td><td class="right tabnum loss">'+fmtD2(r.overAmt)+'</td><td class="right tabnum loss">'+fmtP(r.overPct)+'</td>';obTb.appendChild(tr)});
if(!overBudget.length)obTb.innerHTML='<tr><td colspan="5" class="empty">No jobs over budget</td></tr>';
makeSortable('overBudgetTable');

const profitable=DATA.filter(r=>profit(r)!==null&&profit(r)>0).sort((a,b)=>profit(b)-profit(a)).slice(0,12);
const prTb=document.querySelector('#profitableTable tbody');
profitable.forEach(r=>{const m=margin(r);const tr=document.createElement('tr');tr.dataset.job=r.job_number;tr.dataset.contract=r.total_contract;tr.dataset.costs=totalCost(r);tr.dataset.profit=profit(r);tr.dataset.margin=m||0;tr.innerHTML='<td>'+jobCell(r)+'</td><td class="right tabnum">'+fmtD2(r.total_contract)+'</td><td class="right tabnum">'+fmtD2(totalCost(r))+'</td><td class="right tabnum profit">'+fmtD2(profit(r))+'</td><td class="right tabnum profit">'+fmtP(m)+'</td>';prTb.appendChild(tr)});
makeSortable('profitableTable');

const hoursOver=DATA.filter(r=>r.hour_budget>0&&r.hours_used>r.hour_budget).map(r=>({...r,overHrs:r.hours_used-r.hour_budget,overPct:(r.hours_used-r.hour_budget)/r.hour_budget})).sort((a,b)=>b.overPct-a.overPct);
const hoTb=document.querySelector('#hoursOverTable tbody');
hoursOver.forEach(r=>{const tr=document.createElement('tr');tr.dataset.job=r.job_number;tr.dataset.budget=r.hour_budget;tr.dataset.used=r.hours_used;tr.dataset.over=r.overHrs;tr.dataset.pct=r.overPct;tr.innerHTML='<td>'+jobCell(r)+'</td><td class="right tabnum">'+fmtN(r.hour_budget)+'</td><td class="right tabnum">'+fmtN(r.hours_used)+'</td><td class="right tabnum warn">+'+fmtN(r.overHrs)+'</td><td class="right tabnum warn">+'+fmtP(r.overPct)+'</td>';hoTb.appendChild(tr)});
makeSortable('hoursOverTable');

const hoursRemaining=activeJobs.filter(r=>r.hour_budget>0&&r.hours_used<r.hour_budget).map(r=>({...r,rem:r.hour_budget-r.hours_used,pctUsed:r.hours_used/r.hour_budget})).sort((a,b)=>b.pctUsed-a.pctUsed);
const hrTb=document.querySelector('#hoursRemainingTable tbody');
hoursRemaining.forEach(r=>{const p=r.pctUsed*100;const c=p>90?'red':p>70?'orange':'green';const tr=document.createElement('tr');tr.dataset.job=r.job_number;tr.dataset.budget=r.hour_budget;tr.dataset.used=r.hours_used;tr.dataset.remaining=r.rem;tr.dataset.pct=r.pctUsed;tr.innerHTML='<td>'+jobCell(r)+'</td><td class="right tabnum">'+fmtN(r.hour_budget)+'</td><td class="right tabnum">'+fmtN(r.hours_used)+'</td><td class="right tabnum" style="font-weight:600">'+fmtN(r.rem)+'</td><td style="min-width:100px"><div class="bar-track"><div class="bar-fill '+c+'" style="width:'+Math.min(p,100)+'%"></div></div><div style="font-size:0.625rem;color:var(--text3);margin-top:2px">'+fmtP(r.pctUsed)+'</div></td>';hrTb.appendChild(tr)});
makeSortable('hoursRemainingTable');

// Full job table
const ftBody=document.querySelector('#fullTable tbody');
const pCls=v=>v!==null?(v>1?'loss':v>0.9?'warn':''):'';
[...DATA].sort((a,b)=>(b.total_contract||0)-(a.total_contract||0)).forEach(r=>{
  const p=profit(r);const m=margin(r);const hrPc=pct(r.hours_used,r.hour_budget);const labP=pct(r.labor_cost,r.labor_budget);const matP=pct(r.material_cost,r.material_budget);const genP=pct(r.general_cost,r.general_budget);const pC=p!==null?(p>=0?'profit':'loss'):'';
  const tr=document.createElement('tr');
  tr.dataset.job_number=r.job_number;tr.dataset.name=shortName(r).toLowerCase();tr.dataset.status=r.job_status;tr.dataset.contract=r.total_contract||0;tr.dataset.cost=totalCost(r);tr.dataset.profit=p!==null?p:0;tr.dataset.margin=m!==null?m:0;tr.dataset.hr_budget=r.hour_budget||0;tr.dataset.hr_used=r.hours_used||0;tr.dataset.hr_pct=hrPc!==null?hrPc:0;tr.dataset.labor_pct=labP!==null?labP:0;tr.dataset.mat_pct=matP!==null?matP:0;tr.dataset.gen_pct=genP!==null?genP:0;
  if(HAS_SUMMARY){tr.dataset.pct_complete=r.s_pct_complete||0;tr.dataset.billed=r.s_billed||0;tr.dataset.received=r.s_received||0}
  let html='<td class="tabnum" style="color:var(--blue);font-weight:600">'+r.job_number+'</td><td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+shortName(r)+'</td><td>'+statusTag(r.job_status)+'</td><td class="right tabnum">'+fmtD2(r.total_contract)+'</td><td class="right tabnum">'+fmtD2(totalCost(r))+'</td><td class="right tabnum '+pC+'">'+(p!==null?fmtD2(p):'—')+'</td><td class="right tabnum '+pC+'">'+fmtP(m)+'</td><td class="right tabnum">'+fmtN(r.hour_budget)+'</td><td class="right tabnum">'+fmtN(r.hours_used)+'</td><td class="right tabnum '+pCls(hrPc)+'">'+fmtP(hrPc)+'</td><td class="right tabnum '+pCls(labP)+'">'+fmtP(labP)+'</td><td class="right tabnum '+pCls(matP)+'">'+fmtP(matP)+'</td><td class="right tabnum '+pCls(genP)+'">'+fmtP(genP)+'</td>';
  if(HAS_SUMMARY){html+='<td class="right tabnum">'+fmtP(r.s_pct_complete!=null?r.s_pct_complete/100:null)+'</td><td class="right tabnum">'+fmtD2(r.s_billed)+'</td><td class="right tabnum">'+fmtD2(r.s_received)+'</td>'}
  tr.innerHTML=html;
  ftBody.appendChild(tr);
});
makeSortable('fullTable');
<\/script></body></html>`;

  return c.html(html);
});

// ── Job Health Scores ──────────────────────────────────────────
reports.get("/job-health", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const detailRows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE (pfd.report_type = 'detail' OR pfd.report_type IS NULL) AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const summaryRows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE pfd.report_type = 'summary' AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Job Health Scores — ${company}</title>
<style>${financeCSS()}</style>
</head><body>
<div class="header">
  <div><h1>${company}</h1><p>Job Health Scores — Composite Risk Assessment</p></div>
  <div class="date">Report generated: ${dateStr}</div>
</div>
<nav class="nav-pills">${financeNav("job-health")}</nav>
<div class="kpi-strip" id="kpis"></div>
<div class="card" style="margin-bottom:1.5rem;">
  <h2>How Health Scores Work</h2>
  <p style="font-size:0.8125rem;color:var(--text2);line-height:1.6;">
    Each job gets a composite score (0–100) based on five weighted factors:
    <strong>Budget Utilization</strong> (30%) — are costs within budget?
    <strong>Hours Performance</strong> (20%) — are labor hours on track?
    <strong>Profit Margin</strong> (25%) — projected profit vs. contract.
    <strong>Schedule Performance</strong> (15%) — % complete vs. % cost spent (CPI proxy).
    <strong>Cash Flow</strong> (10%) — billing coverage and collection rate.
    Jobs without budget data are scored only on available metrics.
  </p>
</div>
<div class="card full-width">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
    <h2 style="margin-bottom:0">All Jobs — Health Overview</h2>
    <div style="display:flex;gap:0.5rem;font-size:0.6875rem;color:var(--text3);">
      <span class="health-badge health-excellent"><span class="health-dot"></span>90–100</span>
      <span class="health-badge health-good"><span class="health-dot"></span>70–89</span>
      <span class="health-badge health-fair"><span class="health-dot"></span>50–69</span>
      <span class="health-badge health-poor"><span class="health-dot"></span>25–49</span>
      <span class="health-badge health-critical"><span class="health-dot"></span>0–24</span>
    </div>
  </div>
  <div style="overflow-x:auto;">
    <table id="healthTable">
      <thead><tr>
        <th class="sortable" data-col="score">Score</th>
        <th class="sortable" data-col="job_number">Job #</th>
        <th class="sortable" data-col="name">Name</th>
        <th class="sortable" data-col="status">Status</th>
        <th class="right sortable" data-col="budget_score">Budget</th>
        <th class="right sortable" data-col="hours_score">Hours</th>
        <th class="right sortable" data-col="profit_score">Profit</th>
        <th class="right sortable" data-col="schedule_score">Schedule</th>
        <th class="right sortable" data-col="cash_score">Cash</th>
        <th class="right sortable" data-col="contract">Contract</th>
        <th class="right sortable" data-col="margin">Margin</th>
        <th>Risk Flags</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>
</div>
<script>
${financeJS()}
const DETAIL=${JSON.stringify(detailRows)};
const SUMMARY=${JSON.stringify(summaryRows)};
const sumMap={};SUMMARY.forEach(s=>{sumMap[s.job_number]=s});
const DATA=DETAIL.map(d=>{const s=sumMap[d.job_number];return{...d,s_pct_complete:s?.percent_complete,s_billed:s?.billed_to_date,s_received:s?.received_to_date,s_paid_out:s?sumCatCost(s):0,s_cost:s?.cost_to_date,s_earned:s?.earned_to_date,s_revised_contract:s?.revised_contract_price}});

// Health score calculator
function healthScore(r){
  const scores=[];const flags=[];
  const tb=totalBudget(r);const tc=totalCost(r);
  // 1. Budget Utilization (30%)
  if(tb>0){
    const util=tc/tb;
    let bs=util<=0.85?100:util<=1.0?100-((util-0.85)/0.15)*50:Math.max(0,50-((util-1.0)/0.3)*50);
    scores.push({w:0.30,s:bs,label:'budget'});
    if(util>1.0)flags.push('Over budget ('+fmtP(util-1)+')');
  }
  // 2. Hours Performance (20%)
  if(r.hour_budget>0){
    const hUtil=r.hours_used/r.hour_budget;
    let hs=hUtil<=0.85?100:hUtil<=1.0?100-((hUtil-0.85)/0.15)*50:Math.max(0,50-((hUtil-1.0)/0.3)*50);
    scores.push({w:0.20,s:hs,label:'hours'});
    if(hUtil>1.0)flags.push('Hours exceeded (+'+fmtN(r.hours_used-r.hour_budget)+')');
  }
  // 3. Profit Margin (25%)
  if(r.total_contract>0){
    const m=(r.total_contract-tc)/r.total_contract;
    let ps=m>=0.20?100:m>=0.10?75:m>=0?50:Math.max(0,50+m*200);
    scores.push({w:0.25,s:ps,label:'profit'});
    if(m<0)flags.push('Negative margin ('+fmtP(m)+')');
    else if(m<0.05)flags.push('Thin margin ('+fmtP(m)+')');
  }
  // 4. Schedule Performance (15%) — CPI proxy: earned/cost
  if(r.s_earned>0&&r.s_cost>0){
    const cpi=r.s_earned/r.s_cost;
    let ss=cpi>=1.0?100:cpi>=0.9?75:cpi>=0.8?50:Math.max(0,cpi*50);
    scores.push({w:0.15,s:ss,label:'schedule'});
    if(cpi<0.9)flags.push('CPI '+cpi.toFixed(2)+' (behind schedule)');
  } else if(r.s_pct_complete!=null&&tb>0){
    const pctCost=tc/tb;const pctDone=r.s_pct_complete/100;
    if(pctDone>0){const ratio=pctDone/pctCost;let ss=ratio>=1?100:ratio>=0.85?75:ratio>=0.7?50:Math.max(0,ratio*60);scores.push({w:0.15,s:ss,label:'schedule'})}
  }
  // 5. Cash Flow (10%)
  if(r.s_billed>0){
    const collRate=r.s_received/r.s_billed;
    let cs=collRate>=0.9?100:collRate>=0.7?75:collRate>=0.5?50:Math.max(0,collRate*80);
    scores.push({w:0.10,s:cs,label:'cash'});
    if(collRate<0.7)flags.push('Low collections ('+fmtP(collRate)+')');
  }

  if(scores.length===0)return{total:null,budget:null,hours:null,profit:null,schedule:null,cash:null,flags:['No budget data']};
  // Re-normalize weights
  const totalW=scores.reduce((s,x)=>s+x.w,0);
  const total=scores.reduce((s,x)=>s+x.s*(x.w/totalW),0);
  const byLabel={};scores.forEach(x=>{byLabel[x.label]=Math.round(x.s)});
  return{total:Math.round(total),budget:byLabel.budget??null,hours:byLabel.hours??null,profit:byLabel.profit??null,schedule:byLabel.schedule??null,cash:byLabel.cash??null,flags};
}

function healthClass(s){if(s==null)return'';if(s>=90)return'health-excellent';if(s>=70)return'health-good';if(s>=50)return'health-fair';if(s>=25)return'health-poor';return'health-critical'}
function scoreBadge(s){if(s==null)return'<span style="color:var(--text3)">—</span>';return'<span class="health-badge '+healthClass(s)+'"><span class="health-dot"></span>'+s+'</span>'}
function miniScore(s){if(s==null)return'<span style="color:var(--text3)">—</span>';const c=s>=70?'var(--green)':s>=50?'var(--orange)':'var(--red)';return'<span class="tabnum" style="color:'+c+';font-weight:600">'+s+'</span>'}

const scored=DATA.map(r=>({...r,health:healthScore(r)}));

// KPIs
const withScores=scored.filter(r=>r.health.total!==null);
const avgScore=withScores.length?Math.round(withScores.reduce((s,r)=>s+r.health.total,0)/withScores.length):0;
const excellent=withScores.filter(r=>r.health.total>=90).length;
const good=withScores.filter(r=>r.health.total>=70&&r.health.total<90).length;
const fair=withScores.filter(r=>r.health.total>=50&&r.health.total<70).length;
const poor=withScores.filter(r=>r.health.total<50).length;
document.getElementById('kpis').innerHTML=kpiHTML([
  {label:'Average Health',value:avgScore,cls:avgScore>=70?'green':avgScore>=50?'orange':'red',sub:withScores.length+' jobs scored'},
  {label:'Excellent (90+)',value:excellent,cls:'green'},
  {label:'Good (70–89)',value:good,cls:'blue'},
  {label:'Fair (50–69)',value:fair,cls:'orange'},
  {label:'Needs Attention (<50)',value:poor,cls:poor>0?'red':'green',sub:poor>0?'Review immediately':'All clear'},
]);

// Table
const tbody=document.querySelector('#healthTable tbody');
scored.sort((a,b)=>(a.health.total??-1)-(b.health.total??-1)).forEach(r=>{
  const h=r.health;const m=margin(r);
  const tr=document.createElement('tr');
  tr.dataset.score=h.total??-1;tr.dataset.job_number=r.job_number;tr.dataset.name=shortName(r).toLowerCase();tr.dataset.status=r.job_status;
  tr.dataset.budget_score=h.budget??-1;tr.dataset.hours_score=h.hours??-1;tr.dataset.profit_score=h.profit??-1;tr.dataset.schedule_score=h.schedule??-1;tr.dataset.cash_score=h.cash??-1;
  tr.dataset.contract=r.total_contract||0;tr.dataset.margin=m??0;
  const flagsHtml=h.flags.length?h.flags.map(f=>'<span style="display:inline-block;padding:0.125rem 0.5rem;border-radius:100px;font-size:0.625rem;background:#fee2e2;color:#991b1b;margin:1px 2px">'+f+'</span>').join(''):'<span style="color:var(--text3);font-size:0.6875rem">None</span>';
  tr.innerHTML='<td>'+scoreBadge(h.total)+'</td><td class="tabnum" style="color:var(--blue);font-weight:600">'+r.job_number+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+shortName(r)+'</td><td>'+statusTag(r.job_status)+'</td><td class="right">'+miniScore(h.budget)+'</td><td class="right">'+miniScore(h.hours)+'</td><td class="right">'+miniScore(h.profit)+'</td><td class="right">'+miniScore(h.schedule)+'</td><td class="right">'+miniScore(h.cash)+'</td><td class="right tabnum">'+fmtD2(r.total_contract)+'</td><td class="right tabnum">'+(m!==null?fmtP(m):'—')+'</td><td style="max-width:300px">'+flagsHtml+'</td>';
  tbody.appendChild(tr);
});
makeSortable('healthTable');
<\/script></body></html>`;

  return c.html(html);
});

// ── Cash Position Report ───────────────────────────────────────
reports.get("/cash-position", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const summaryRows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE pfd.report_type = 'summary' AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const detailRows = sqlite.query(`
    SELECT pfd.job_number, pfd.total_contract, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE (pfd.report_type = 'detail' OR pfd.report_type IS NULL) AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const hasSummary = summaryRows.length > 0;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Cash Position — ${company}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>${financeCSS()}</style>
</head><body>
<div class="header">
  <div><h1>${company}</h1><p>Cash Position — Billing, Collections & Disbursements</p></div>
  <div class="date">Report generated: ${dateStr}</div>
</div>
<nav class="nav-pills">${financeNav("cash-position")}</nav>
${!hasSummary ? '<div class="card" style="text-align:center;padding:3rem;"><h2 style="color:var(--orange)">No Summary Data Available</h2><p style="color:var(--text3)">Import a Comprehensive Job Summary PDF from A-Systems to see cash position data.</p></div>' : `
<div class="kpi-strip" id="kpis"></div>
<div class="grid-2">
  <div class="card"><h2>Cash Flow by Job</h2><div class="chart-container tall"><canvas id="cashFlowChart"></canvas></div></div>
  <div class="card"><h2>Collections Rate</h2><div class="chart-container tall"><canvas id="collectionsChart"></canvas></div></div>
</div>
<div class="grid-2">
  <div class="card"><h2>Net Cash Position by Job</h2><div class="chart-container tall"><canvas id="netCashChart"></canvas></div></div>
  <div class="card"><h2>Outstanding Receivables — Billed but Uncollected</h2><div class="chart-container tall"><canvas id="arChart"></canvas></div></div>
</div>
<div class="card full-width" style="margin-top:1.5rem;">
  <h2>Cash Position Detail — All Jobs</h2>
  <div style="overflow-x:auto;">
    <table id="cashTable">
      <thead><tr>
        <th class="sortable" data-col="job_number">Job #</th>
        <th class="sortable" data-col="name">Name</th>
        <th class="sortable" data-col="status">Status</th>
        <th class="right sortable" data-col="contract">Contract</th>
        <th class="right sortable" data-col="billed">Billed</th>
        <th class="right sortable" data-col="received">Received</th>
        <th class="right sortable" data-col="paid_out">Paid Out</th>
        <th class="right sortable" data-col="net_cash">Net Cash</th>
        <th class="right sortable" data-col="coll_rate">Collection %</th>
        <th class="right sortable" data-col="ar">Outstanding AR</th>
        <th class="right sortable" data-col="bill_pct">% Billed</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>
</div>
`}
<script>
${financeJS()}
const SUMMARY=${JSON.stringify(summaryRows)};
const DETAIL_CONTRACTS={};${JSON.stringify(detailRows)}.forEach(d=>{DETAIL_CONTRACTS[d.job_number]=d.total_contract});
const HAS_SUMMARY=${hasSummary};
if(!HAS_SUMMARY) { /* nothing to render */ } else {
// Compute paid_out from sum of all 5 category cost_to_date (not the unreliable PDF field)
const DATA=SUMMARY.map(r=>({...r,contract:r.revised_contract_price||DETAIL_CONTRACTS[r.job_number]||0,_paid_out:sumCatCost(r)}));

const totBilled=DATA.reduce((s,r)=>s+(r.billed_to_date||0),0);
const totReceived=DATA.reduce((s,r)=>s+(r.received_to_date||0),0);
const totPaidOut=DATA.reduce((s,r)=>s+r._paid_out,0);
const netCash=totReceived-totPaidOut;
const ar=totBilled-totReceived;
const collRate=totBilled>0?totReceived/totBilled:0;
const totContract=DATA.reduce((s,r)=>s+r.contract,0);

document.getElementById('kpis').innerHTML=kpiHTML([
  {label:'Net Cash Position',value:fmtD(netCash),cls:netCash>=0?'teal':'red',sub:'Received minus paid out'},
  {label:'Total Billed',value:fmtD(totBilled),cls:'purple',sub:fmtP(totBilled/totContract)+' of contracts billed'},
  {label:'Total Received',value:fmtD(totReceived),cls:'green',sub:fmtP(collRate)+' collection rate'},
  {label:'Outstanding AR',value:fmtD(ar),cls:ar>0?'orange':'green',sub:'Billed but not yet received'},
  {label:'Total Paid Out',value:fmtD(totPaidOut),cls:'red',sub:fmtP(totPaidOut/totContract)+' of contracts'},
  {label:'Total Contracts',value:fmtD(totContract),cls:'blue',sub:DATA.length+' jobs'},
]);

Chart.defaults.font.family="-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif";
Chart.defaults.font.size=11;Chart.defaults.color='#86868b';

// Cash Flow stacked bar
const cf=DATA.filter(r=>(r.billed_to_date||0)>0).sort((a,b)=>(b.billed_to_date||0)-(a.billed_to_date||0)).slice(0,15);
new Chart(document.getElementById('cashFlowChart'),{type:'bar',data:{labels:cf.map(r=>r.job_number),datasets:[
  {label:'Billed',data:cf.map(r=>r.billed_to_date||0),backgroundColor:'rgba(88,86,214,0.5)',borderRadius:3},
  {label:'Received',data:cf.map(r=>r.received_to_date||0),backgroundColor:'rgba(48,176,199,0.6)',borderRadius:3},
  {label:'Paid Out',data:cf.map(r=>r._paid_out||0),backgroundColor:'rgba(255,55,95,0.5)',borderRadius:3},
]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{title:i=>shortName(cf[i[0].dataIndex]),label:i=>i.dataset.label+': '+fmtD2(i.raw)}}},scales:{x:{ticks:{font:{size:9,family:'ui-monospace,monospace'}}},y:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}}}}});

// Collections rate scatter
const collData=DATA.filter(r=>(r.billed_to_date||0)>0).map(r=>({x:(r.billed_to_date||0),y:r.billed_to_date>0?(r.received_to_date||0)/r.billed_to_date*100:0,r:6,name:shortName(r),num:r.job_number}));
new Chart(document.getElementById('collectionsChart'),{type:'bubble',data:{datasets:[{data:collData,backgroundColor:collData.map(d=>d.y>=90?'rgba(48,209,88,0.5)':d.y>=70?'rgba(255,159,10,0.5)':'rgba(255,59,48,0.5)'),borderColor:collData.map(d=>d.y>=90?'rgba(48,209,88,0.8)':d.y>=70?'rgba(255,159,10,0.8)':'rgba(255,59,48,0.8)'),borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:i=>{const d=collData[i.dataIndex];return['#'+d.num+' '+d.name,'Billed: '+fmtD2(d.x),'Collection: '+d.y.toFixed(1)+'%']}}}},scales:{x:{title:{display:true,text:'Total Billed ($)'},ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}},y:{title:{display:true,text:'Collection Rate %'},grid:{color:'#f0f0f2'},suggestedMin:0,suggestedMax:110}}}});

// Net Cash bar (horizontal)
const ncData=DATA.filter(r=>(r.received_to_date||0)>0||r._paid_out>0).map(r=>({...r,netCash:(r.received_to_date||0)-r._paid_out})).sort((a,b)=>a.netCash-b.netCash);
new Chart(document.getElementById('netCashChart'),{type:'bar',data:{labels:ncData.map(r=>r.job_number),datasets:[{data:ncData.map(r=>r.netCash),backgroundColor:ncData.map(r=>r.netCash>=0?'rgba(48,176,199,0.6)':'rgba(255,59,48,0.6)'),borderRadius:3}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>shortName(ncData[i[0].dataIndex]),label:i=>'Net Cash: '+fmtD2(i.raw)}}},scales:{x:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}},y:{ticks:{font:{size:9,family:'ui-monospace,monospace'}},grid:{display:false}}}}});

// Outstanding AR
const arData=DATA.filter(r=>(r.billed_to_date||0)>(r.received_to_date||0)).map(r=>({...r,arAmt:(r.billed_to_date||0)-(r.received_to_date||0)})).sort((a,b)=>b.arAmt-a.arAmt).slice(0,15);
new Chart(document.getElementById('arChart'),{type:'bar',data:{labels:arData.map(r=>r.job_number),datasets:[{data:arData.map(r=>r.arAmt),backgroundColor:'rgba(255,159,10,0.6)',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>shortName(arData[i[0].dataIndex]),label:i=>'Outstanding: '+fmtD2(i.raw)}}},scales:{x:{ticks:{font:{size:9,family:'ui-monospace,monospace'}}},y:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}}}}});

// Table
const tbody=document.querySelector('#cashTable tbody');
[...DATA].sort((a,b)=>((b.received_to_date||0)-b._paid_out)-((a.received_to_date||0)-a._paid_out)).forEach(r=>{
  const nc=(r.received_to_date||0)-r._paid_out;
  const arAmt=(r.billed_to_date||0)-(r.received_to_date||0);
  const cr=r.billed_to_date>0?(r.received_to_date||0)/r.billed_to_date:null;
  const billPct=r.contract>0?(r.billed_to_date||0)/r.contract:null;
  const tr=document.createElement('tr');
  tr.dataset.job_number=r.job_number;tr.dataset.name=shortName(r).toLowerCase();tr.dataset.status=r.job_status;
  tr.dataset.contract=r.contract;tr.dataset.billed=r.billed_to_date||0;tr.dataset.received=r.received_to_date||0;
  tr.dataset.paid_out=r._paid_out;tr.dataset.net_cash=nc;tr.dataset.coll_rate=cr||0;
  tr.dataset.ar=arAmt;tr.dataset.bill_pct=billPct||0;
  const ncCls=nc>=0?'profit':'loss';
  tr.innerHTML='<td class="tabnum" style="color:var(--blue);font-weight:600">'+r.job_number+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+shortName(r)+'</td><td>'+statusTag(r.job_status)+'</td><td class="right tabnum">'+fmtD2(r.contract)+'</td><td class="right tabnum">'+fmtD2(r.billed_to_date)+'</td><td class="right tabnum">'+fmtD2(r.received_to_date)+'</td><td class="right tabnum">'+fmtD2(r._paid_out)+'</td><td class="right tabnum '+ncCls+'">'+fmtD2(nc)+'</td><td class="right tabnum">'+(cr!==null?fmtP(cr):'—')+'</td><td class="right tabnum '+(arAmt>0?'warn':'')+'">'+fmtD2(arAmt)+'</td><td class="right tabnum">'+fmtP(billPct)+'</td>';
  tbody.appendChild(tr);
});
makeSortable('cashTable');
}
<\/script></body></html>`;

  return c.html(html);
});

// ── Earned Value & Billing Analysis ────────────────────────────
reports.get("/earned-value", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const summaryRows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE pfd.report_type = 'summary' AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const detailRows = sqlite.query(`
    SELECT pfd.job_number, pfd.total_contract, pfd.labor_budget, pfd.labor_cost, pfd.material_budget, pfd.material_cost, pfd.general_budget, pfd.general_cost, pfd.hour_budget, pfd.hours_used
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE (pfd.report_type = 'detail' OR pfd.report_type IS NULL) AND j.company_id = ?
  `).all(companyId) as any[];

  const hasSummary = summaryRows.length > 0;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Earned Value Analysis — ${company}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>${financeCSS()}</style>
</head><body>
<div class="header">
  <div><h1>${company}</h1><p>Earned Value & Billing Analysis</p></div>
  <div class="date">Report generated: ${dateStr}</div>
</div>
<nav class="nav-pills">${financeNav("earned-value")}</nav>
${!hasSummary ? '<div class="card" style="text-align:center;padding:3rem;"><h2 style="color:var(--orange)">No Summary Data Available</h2><p style="color:var(--text3)">Import a Comprehensive Job Summary PDF from A-Systems to see earned value data.</p></div>' : `
<div class="card" style="margin-bottom:1.5rem;">
  <h2>Understanding Earned Value</h2>
  <p style="font-size:0.8125rem;color:var(--text2);line-height:1.6;">
    <strong>CPI</strong> (Cost Performance Index) = Earned / Cost. CPI > 1.0 means you're earning more value per dollar spent.
    <strong>Billing Gap</strong> = Billed - Earned. Positive means you've billed ahead of earned value (favorable).
    <strong>Profit at Completion</strong> = Contract - (Cost / % Complete). Projects the final profit based on current burn rate.
  </p>
</div>
<div class="kpi-strip" id="kpis"></div>
<div class="grid-2">
  <div class="card"><h2>CPI Distribution — Active Jobs</h2><div class="chart-container tall"><canvas id="cpiChart"></canvas></div></div>
  <div class="card"><h2>Earned vs. Cost — Top Jobs</h2><div class="chart-container tall"><canvas id="evChart"></canvas></div></div>
</div>
<div class="grid-2">
  <div class="card"><h2>Billing Gap (Billed - Earned)</h2><div class="chart-container tall"><canvas id="billingGapChart"></canvas></div></div>
  <div class="card"><h2>Projected Profit at Completion</h2><div class="chart-container tall"><canvas id="eacChart"></canvas></div></div>
</div>
<div class="card full-width" style="margin-top:1.5rem;">
  <h2>Earned Value Detail</h2>
  <div style="overflow-x:auto;">
    <table id="evTable">
      <thead><tr>
        <th class="sortable" data-col="job_number">Job #</th>
        <th class="sortable" data-col="name">Name</th>
        <th class="sortable" data-col="status">Status</th>
        <th class="right sortable" data-col="contract">Contract</th>
        <th class="right sortable" data-col="pct_complete">% Complete</th>
        <th class="right sortable" data-col="earned">Earned</th>
        <th class="right sortable" data-col="cost">Cost to Date</th>
        <th class="right sortable" data-col="cpi">CPI</th>
        <th class="right sortable" data-col="billed">Billed</th>
        <th class="right sortable" data-col="billing_gap">Billing Gap</th>
        <th class="right sortable" data-col="eac">Est. at Completion</th>
        <th class="right sortable" data-col="proj_profit">Proj. Profit</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>
</div>
`}
<script>
${financeJS()}
const SUMMARY=${JSON.stringify(summaryRows)};
const DETAIL_MAP={};${JSON.stringify(detailRows)}.forEach(d=>{DETAIL_MAP[d.job_number]=d});
const HAS_SUMMARY=${hasSummary};
if(HAS_SUMMARY){
const DATA=SUMMARY.map(r=>{
  const d=DETAIL_MAP[r.job_number]||{};
  const contract=r.revised_contract_price||d.total_contract||0;
  const earned=r.earned_to_date||0;const cost=r.cost_to_date||0;
  const cpi=cost>0?earned/cost:null;
  const billed=r.billed_to_date||0;
  const billingGap=billed-earned;
  const pctComplete=r.percent_complete||0;
  const eac=cpi&&cpi>0?cost/cpi*(100/pctComplete||1):null; // Estimate at completion
  const eacSimple=pctComplete>0?cost/(pctComplete/100):null;
  const projProfit=eacSimple?contract-eacSimple:null;
  return{...r,contract,earned,cost,cpi,billed,billingGap,pctComplete,eacSimple,projProfit};
});
const active=DATA.filter(r=>r.job_status==='active');

// KPIs
const totEarned=active.reduce((s,r)=>s+r.earned,0);
const totCost=active.reduce((s,r)=>s+r.cost,0);
const avgCPI=totCost>0?totEarned/totCost:0;
const totBilled=active.reduce((s,r)=>s+r.billed,0);
const totBillingGap=totBilled-totEarned;
const jobsBelowCPI=active.filter(r=>r.cpi!==null&&r.cpi<1.0).length;
const totContract=active.reduce((s,r)=>s+r.contract,0);
const totProjProfit=active.reduce((s,r)=>s+(r.projProfit||0),0);

document.getElementById('kpis').innerHTML=kpiHTML([
  {label:'Portfolio CPI',value:avgCPI.toFixed(2),cls:avgCPI>=1.0?'green':avgCPI>=0.9?'orange':'red',sub:'Earned '+fmtD(totEarned)+' / Cost '+fmtD(totCost)},
  {label:'Billing Gap',value:fmtD(totBillingGap),cls:totBillingGap>=0?'green':'red',sub:totBillingGap>=0?'Billed ahead of earned':'Behind on billing'},
  {label:'Jobs Below CPI 1.0',value:jobsBelowCPI,cls:jobsBelowCPI>3?'red':jobsBelowCPI>0?'orange':'green',sub:'Costing more than earning'},
  {label:'Projected Profit',value:fmtD(totProjProfit),cls:totProjProfit>=0?'green':'red',sub:'Based on current burn rate'},
  {label:'Active Contracts',value:fmtD(totContract),cls:'blue',sub:active.length+' jobs'},
]);

Chart.defaults.font.family="-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif";
Chart.defaults.font.size=11;Chart.defaults.color='#86868b';

// CPI Distribution
const cpiData=active.filter(r=>r.cpi!==null).sort((a,b)=>a.cpi-b.cpi);
new Chart(document.getElementById('cpiChart'),{type:'bar',data:{labels:cpiData.map(r=>r.job_number),datasets:[{data:cpiData.map(r=>r.cpi),backgroundColor:cpiData.map(r=>r.cpi>=1.0?'rgba(48,209,88,0.6)':r.cpi>=0.9?'rgba(255,159,10,0.6)':'rgba(255,59,48,0.6)'),borderRadius:3}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>shortName(cpiData[i[0].dataIndex]),label:i=>'CPI: '+cpiData[i.dataIndex].cpi.toFixed(3)}},annotation:{annotations:{line1:{type:'line',xMin:1,xMax:1,borderColor:'#30d158',borderWidth:2,borderDash:[5,3]}}}},scales:{x:{title:{display:true,text:'CPI (> 1.0 = good)'},grid:{color:'#f0f0f2'}},y:{ticks:{font:{size:9,family:'ui-monospace,monospace'}},grid:{display:false}}}}});

// Earned vs Cost
const evData=active.filter(r=>r.earned>0).sort((a,b)=>b.earned-a.earned).slice(0,15);
new Chart(document.getElementById('evChart'),{type:'bar',data:{labels:evData.map(r=>r.job_number),datasets:[
  {label:'Earned Value',data:evData.map(r=>r.earned),backgroundColor:'rgba(48,209,88,0.6)',borderRadius:3},
  {label:'Cost to Date',data:evData.map(r=>r.cost),backgroundColor:'rgba(255,59,48,0.4)',borderRadius:3},
  {label:'Contract',data:evData.map(r=>r.contract),type:'line',borderColor:'#5856d6',borderWidth:2,pointRadius:3,pointBackgroundColor:'#5856d6',fill:false}
]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{title:i=>shortName(evData[i[0].dataIndex]),label:i=>i.dataset.label+': '+fmtD2(i.raw)}}},scales:{x:{ticks:{font:{size:9,family:'ui-monospace,monospace'}}},y:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}}}}});

// Billing Gap
const bgData=active.filter(r=>r.billed>0||r.earned>0).sort((a,b)=>a.billingGap-b.billingGap);
new Chart(document.getElementById('billingGapChart'),{type:'bar',data:{labels:bgData.map(r=>r.job_number),datasets:[{data:bgData.map(r=>r.billingGap),backgroundColor:bgData.map(r=>r.billingGap>=0?'rgba(48,209,88,0.6)':'rgba(255,59,48,0.6)'),borderRadius:3}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>shortName(bgData[i[0].dataIndex]),label:i=>{const d=bgData[i.dataIndex];return['Gap: '+fmtD2(d.billingGap),'Billed: '+fmtD2(d.billed),'Earned: '+fmtD2(d.earned)]}}}},scales:{x:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}},y:{ticks:{font:{size:9,family:'ui-monospace,monospace'}},grid:{display:false}}}}});

// Projected Profit
const ppData=active.filter(r=>r.projProfit!==null).sort((a,b)=>a.projProfit-b.projProfit);
new Chart(document.getElementById('eacChart'),{type:'bar',data:{labels:ppData.map(r=>r.job_number),datasets:[{data:ppData.map(r=>r.projProfit),backgroundColor:ppData.map(r=>r.projProfit>=0?'rgba(48,209,88,0.6)':'rgba(255,59,48,0.6)'),borderRadius:3}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>shortName(ppData[i[0].dataIndex]),label:i=>{const d=ppData[i.dataIndex];return['Proj. Profit: '+fmtD2(d.projProfit),'Contract: '+fmtD2(d.contract),'Est. at Completion: '+fmtD2(d.eacSimple)]}}}},scales:{x:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}},y:{ticks:{font:{size:9,family:'ui-monospace,monospace'}},grid:{display:false}}}}});

// Table
const tbody=document.querySelector('#evTable tbody');
[...DATA].sort((a,b)=>(a.cpi||0)-(b.cpi||0)).forEach(r=>{
  const tr=document.createElement('tr');
  tr.dataset.job_number=r.job_number;tr.dataset.name=shortName(r).toLowerCase();tr.dataset.status=r.job_status;
  tr.dataset.contract=r.contract;tr.dataset.pct_complete=r.pctComplete;tr.dataset.earned=r.earned;tr.dataset.cost=r.cost;
  tr.dataset.cpi=r.cpi||0;tr.dataset.billed=r.billed;tr.dataset.billing_gap=r.billingGap;
  tr.dataset.eac=r.eacSimple||0;tr.dataset.proj_profit=r.projProfit||0;
  const cpiCls=r.cpi!==null?(r.cpi>=1.0?'profit':r.cpi>=0.9?'warn':'loss'):'';
  const bgCls=r.billingGap>=0?'profit':'loss';
  const ppCls=r.projProfit!==null?(r.projProfit>=0?'profit':'loss'):'';
  tr.innerHTML='<td class="tabnum" style="color:var(--blue);font-weight:600">'+r.job_number+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+shortName(r)+'</td><td>'+statusTag(r.job_status)+'</td><td class="right tabnum">'+fmtD2(r.contract)+'</td><td class="right tabnum">'+fmtP(r.pctComplete/100)+'</td><td class="right tabnum">'+fmtD2(r.earned)+'</td><td class="right tabnum">'+fmtD2(r.cost)+'</td><td class="right tabnum '+cpiCls+'">'+(r.cpi!==null?r.cpi.toFixed(2):'—')+'</td><td class="right tabnum">'+fmtD2(r.billed)+'</td><td class="right tabnum '+bgCls+'">'+fmtD2(r.billingGap)+'</td><td class="right tabnum">'+(r.eacSimple?fmtD2(r.eacSimple):'—')+'</td><td class="right tabnum '+ppCls+'">'+(r.projProfit!==null?fmtD2(r.projProfit):'—')+'</td>';
  tbody.appendChild(tr);
});
makeSortable('evTable');
}
<\/script></body></html>`;

  return c.html(html);
});

// ── Budget Variance Report ─────────────────────────────────────
reports.get("/budget-variance", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const summaryRows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE pfd.report_type = 'summary' AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const detailRows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE (pfd.report_type = 'detail' OR pfd.report_type IS NULL) AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const hasSummary = summaryRows.length > 0;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Budget Variance — ${company}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>${financeCSS()}
  .expand-btn { background:none; border:none; cursor:pointer; font-size:0.75rem; color:var(--blue); padding:0.125rem 0.375rem; border-radius:4px; }
  .expand-btn:hover { background:#e8f0fe; }
  .detail-row { display:none; }
  .detail-row.open { display:table-row; }
  .detail-row td { background:#fafbfc; padding:0.375rem 0.75rem; font-size:0.75rem; }
  .cat-label { font-weight:600; color:var(--text2); text-transform:uppercase; font-size:0.625rem; letter-spacing:0.06em; }
  .variance-bar { display:inline-block; height:4px; border-radius:2px; vertical-align:middle; margin-left:0.375rem; }
  .co-badge { display:inline-block; padding:0.0625rem 0.375rem; border-radius:100px; font-size:0.5625rem; font-weight:600; background:#e0f2fe; color:#075985; margin-left:0.25rem; }
</style>
</head><body>
<div class="header">
  <div><h1>${company}</h1><p>Budget Variance Report — Original vs. Current vs. Actual by Category</p></div>
  <div class="date">Report generated: ${dateStr}<br>${hasSummary ? summaryRows.length + ' jobs with category data' : 'Summary data required'}</div>
</div>
<nav class="nav-pills">${financeNav("budget-variance")}</nav>
${!hasSummary ? '<div class="card" style="text-align:center;padding:3rem;"><h2 style="color:var(--orange)">No Summary Data Available</h2><p style="color:var(--text3)">Import a Comprehensive Job Summary PDF from A-Systems to see budget variance data.<br>The summary report contains original budgets, current (revised) budgets, and cost-to-date per category.</p></div>' : `
<div class="kpi-strip" id="kpis"></div>
<div class="grid-2">
  <div class="card"><h2>Budget Variance by Category — All Active Jobs</h2><div class="chart-container tall"><canvas id="catVarChart"></canvas></div></div>
  <div class="card"><h2>Change Orders — Original vs. Current Budget</h2><div class="chart-container tall"><canvas id="coChart"></canvas></div></div>
</div>
<div class="grid-3">
  <div class="card"><h2>Labor: Budget vs. Actual</h2><div class="chart-container"><canvas id="laborChart"></canvas></div></div>
  <div class="card"><h2>Material: Budget vs. Actual</h2><div class="chart-container"><canvas id="materialChart"></canvas></div></div>
  <div class="card"><h2>Subcontract: Budget vs. Actual</h2><div class="chart-container"><canvas id="subChart"></canvas></div></div>
</div>
<div class="grid-2">
  <div class="card"><h2>Equipment: Budget vs. Actual</h2><div class="chart-container"><canvas id="equipChart"></canvas></div></div>
  <div class="card"><h2>General: Budget vs. Actual</h2><div class="chart-container"><canvas id="genChart"></canvas></div></div>
</div>
<div class="card full-width" style="margin-top:1.5rem;">
  <h2>Budget Variance Summary — Click a row to expand category detail</h2>
  <div style="overflow-x:auto;">
    <table id="varTable">
      <thead><tr>
        <th style="width:30px"></th>
        <th class="sortable" data-col="job_number">Job #</th>
        <th class="sortable" data-col="name">Name</th>
        <th class="sortable" data-col="status">Status</th>
        <th class="right sortable" data-col="orig_total">Orig Budget</th>
        <th class="right sortable" data-col="curr_total">Curr Budget</th>
        <th class="right sortable" data-col="co_amt">Change Orders</th>
        <th class="right sortable" data-col="actual_total">Actual Cost</th>
        <th class="right sortable" data-col="variance">Variance</th>
        <th class="right sortable" data-col="var_pct">Var %</th>
        <th class="right sortable" data-col="pct_used">% Used</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>
</div>
`}
<script>
${financeJS()}
const SUMMARY=${JSON.stringify(summaryRows)};
const DETAIL_MAP={};${JSON.stringify(detailRows)}.forEach(d=>{DETAIL_MAP[d.job_number]=d});
const HAS_SUMMARY=${hasSummary};
if(HAS_SUMMARY){
const CATS=['labor','material','subcontract','equipment','general'];
const DATA=SUMMARY.map(r=>{
  const d=DETAIL_MAP[r.job_number]||{};
  const cats=CATS.map(c=>({
    name:c,
    orig:r[c+'_orig_budget']||0,
    curr:r[c+'_curr_budget']||0,
    actual:r[c+'_cost_to_date']||0,
  }));
  const origTotal=cats.reduce((s,c)=>s+c.orig,0);
  const currTotal=cats.reduce((s,c)=>s+c.curr,0);
  const actualTotal=cats.reduce((s,c)=>s+c.actual,0);
  const coAmt=currTotal-origTotal;
  const variance=currTotal-actualTotal;
  return{...r,contract:r.revised_contract_price||d.total_contract||0,cats,origTotal,currTotal,actualTotal,coAmt,variance};
});
const active=DATA.filter(r=>r.job_status==='active');

// KPIs
const totOrig=active.reduce((s,r)=>s+r.origTotal,0);
const totCurr=active.reduce((s,r)=>s+r.currTotal,0);
const totActual=active.reduce((s,r)=>s+r.actualTotal,0);
const totCO=totCurr-totOrig;
const totVar=totCurr-totActual;
const catsOver=active.filter(r=>r.variance<0).length;
// Category totals
const catTotals=CATS.map(c=>{
  const orig=active.reduce((s,r)=>s+(r.cats.find(x=>x.name===c)?.orig||0),0);
  const curr=active.reduce((s,r)=>s+(r.cats.find(x=>x.name===c)?.curr||0),0);
  const actual=active.reduce((s,r)=>s+(r.cats.find(x=>x.name===c)?.actual||0),0);
  return{name:c,orig,curr,actual,variance:curr-actual};
});

document.getElementById('kpis').innerHTML=kpiHTML([
  {label:'Original Budget',value:fmtD(totOrig),cls:'blue',sub:'Sum of all original category budgets'},
  {label:'Current Budget',value:fmtD(totCurr),cls:'purple',sub:totCO>=0?'+'+fmtD(totCO)+' in change orders':fmtD(totCO)+' in reductions'},
  {label:'Actual Cost',value:fmtD(totActual),sub:fmtP(totActual/totCurr)+' of current budget'},
  {label:'Total Variance',value:fmtD(totVar),cls:totVar>=0?'green':'red',sub:totVar>=0?'Under budget':'Over budget'},
  {label:'Jobs Over Budget',value:catsOver,cls:catsOver>0?'red':'green',sub:'Of '+active.length+' active jobs'},
  {label:'Change Order Impact',value:fmtD(totCO),cls:totCO>0?'orange':'green',sub:fmtP(Math.abs(totCO)/totOrig)+' budget change'},
]);

Chart.defaults.font.family="-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif";
Chart.defaults.font.size=11;Chart.defaults.color='#86868b';

// Category variance grouped bar
const catColors={labor:'#1d5191',material:'#ff9f0a',subcontract:'#30b0c7',equipment:'#af52de',general:'#ff375f'};
new Chart(document.getElementById('catVarChart'),{type:'bar',data:{
  labels:catTotals.map(c=>c.name.charAt(0).toUpperCase()+c.name.slice(1)),
  datasets:[
    {label:'Original',data:catTotals.map(c=>c.orig),backgroundColor:'rgba(29,81,145,0.2)',borderRadius:3},
    {label:'Current',data:catTotals.map(c=>c.curr),backgroundColor:'rgba(88,86,214,0.4)',borderRadius:3},
    {label:'Actual',data:catTotals.map(c=>c.actual),backgroundColor:catTotals.map(c=>c.actual>c.curr?'rgba(255,59,48,0.6)':'rgba(48,209,88,0.6)'),borderRadius:3},
  ]
},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{label:i=>i.dataset.label+': '+fmtD2(i.raw)}}},scales:{y:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}}}}});

// Change orders chart
const coJobs=active.filter(r=>Math.abs(r.coAmt)>0).sort((a,b)=>b.coAmt-a.coAmt).slice(0,15);
new Chart(document.getElementById('coChart'),{type:'bar',data:{labels:coJobs.map(r=>r.job_number),datasets:[
  {label:'Original',data:coJobs.map(r=>r.origTotal),backgroundColor:'rgba(29,81,145,0.25)',borderRadius:3},
  {label:'Current (after COs)',data:coJobs.map(r=>r.currTotal),backgroundColor:'rgba(88,86,214,0.5)',borderRadius:3},
]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{title:i=>shortName(coJobs[i[0].dataIndex]),label:i=>{const r=coJobs[i.dataIndex];return[i.dataset.label+': '+fmtD2(i.raw),'CO Amount: '+fmtD2(r.coAmt)]}}}},scales:{x:{ticks:{font:{size:9,family:'ui-monospace,monospace'}}},y:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}}}}});

// Per-category budget vs actual charts
function catChart(canvasId,catName,color){
  const cd=active.filter(r=>{const c=r.cats.find(x=>x.name===catName);return c&&c.curr>0}).map(r=>{const c=r.cats.find(x=>x.name===catName);return{...r,catCurr:c.curr,catActual:c.actual,catPct:c.actual/c.curr}}).sort((a,b)=>b.catPct-a.catPct).slice(0,12);
  if(!cd.length)return;
  new Chart(document.getElementById(canvasId),{type:'bar',data:{labels:cd.map(r=>r.job_number),datasets:[
    {label:'Budget',data:cd.map(r=>r.catCurr),backgroundColor:'rgba(29,81,145,0.2)',borderRadius:3},
    {label:'Actual',data:cd.map(r=>r.catActual),backgroundColor:cd.map(r=>r.catActual>r.catCurr?'rgba(255,59,48,0.6)':color),borderRadius:3},
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{title:i=>shortName(cd[i[0].dataIndex]),label:i=>i.dataset.label+': '+fmtD2(i.raw)}}},scales:{x:{ticks:{font:{size:9,family:'ui-monospace,monospace'}}},y:{ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}}}}});
}
catChart('laborChart','labor','rgba(29,81,145,0.5)');
catChart('materialChart','material','rgba(255,159,10,0.5)');
catChart('subChart','subcontract','rgba(48,176,199,0.5)');
catChart('equipChart','equipment','rgba(175,82,222,0.5)');
catChart('genChart','general','rgba(255,55,95,0.4)');

// Expandable table
const tbody=document.querySelector('#varTable tbody');
let rowIdx=0;
[...DATA].sort((a,b)=>a.variance-b.variance).forEach(r=>{
  const idx=rowIdx++;
  const varCls=r.variance>=0?'profit':'loss';
  const coCls=r.coAmt>0?'warn':'';
  const pctUsed=r.currTotal>0?r.actualTotal/r.currTotal:0;
  const varPct=r.currTotal>0?r.variance/r.currTotal:0;
  // Summary row
  const tr=document.createElement('tr');
  tr.style.cursor='pointer';
  tr.dataset.job_number=r.job_number;tr.dataset.name=shortName(r).toLowerCase();tr.dataset.status=r.job_status;
  tr.dataset.orig_total=r.origTotal;tr.dataset.curr_total=r.currTotal;tr.dataset.co_amt=r.coAmt;
  tr.dataset.actual_total=r.actualTotal;tr.dataset.variance=r.variance;tr.dataset.var_pct=varPct;tr.dataset.pct_used=pctUsed;
  tr.innerHTML='<td><button class="expand-btn" data-idx="'+idx+'">+</button></td><td class="tabnum" style="color:var(--blue);font-weight:600">'+r.job_number+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+shortName(r)+'</td><td>'+statusTag(r.job_status)+'</td><td class="right tabnum">'+fmtD2(r.origTotal)+'</td><td class="right tabnum">'+fmtD2(r.currTotal)+(r.coAmt!==0?'<span class="co-badge">'+(r.coAmt>0?'+':'')+fmtD(r.coAmt)+'</span>':'')+'</td><td class="right tabnum '+coCls+'">'+fmtD2(r.coAmt)+'</td><td class="right tabnum">'+fmtD2(r.actualTotal)+'</td><td class="right tabnum '+varCls+'">'+fmtD2(r.variance)+'</td><td class="right tabnum '+varCls+'">'+fmtP(varPct)+'</td><td class="right"><div style="display:flex;align-items:center;justify-content:flex-end;gap:0.375rem"><span class="tabnum">'+fmtP(pctUsed)+'</span><div class="bar-track" style="width:60px"><div class="bar-fill '+(pctUsed>1?'red':pctUsed>0.85?'orange':'green')+'" style="width:'+Math.min(pctUsed*100,100)+'%"></div></div></div></td>';
  tr.addEventListener('click',()=>{document.querySelectorAll('.detail-row.g'+idx).forEach(dr=>dr.classList.toggle('open'));const btn=tr.querySelector('.expand-btn');btn.textContent=btn.textContent==='+'?'−':'+'});
  tbody.appendChild(tr);
  // Detail rows (5 categories)
  r.cats.forEach(cat=>{
    const dr=document.createElement('tr');
    dr.className='detail-row g'+idx;
    const co=cat.curr-cat.orig;const v=cat.curr-cat.actual;const pu=cat.curr>0?cat.actual/cat.curr:0;
    dr.innerHTML='<td></td><td></td><td><span class="cat-label">'+cat.name+'</span></td><td></td><td class="right tabnum" style="color:var(--text3)">'+fmtD2(cat.orig)+'</td><td class="right tabnum" style="color:var(--text3)">'+fmtD2(cat.curr)+(co!==0?'<span class="co-badge">'+(co>0?'+':'')+fmtD(co)+'</span>':'')+'</td><td class="right tabnum '+(co>0?'warn':'')+'">'+fmtD2(co)+'</td><td class="right tabnum">'+fmtD2(cat.actual)+'</td><td class="right tabnum '+(v>=0?'profit':'loss')+'">'+fmtD2(v)+'</td><td class="right tabnum '+(v>=0?'profit':'loss')+'">'+fmtP(cat.curr>0?v/cat.curr:0)+'</td><td class="right"><div style="display:flex;align-items:center;justify-content:flex-end;gap:0.375rem"><span class="tabnum" style="font-size:0.6875rem;color:var(--text3)">'+fmtP(pu)+'</span><div class="bar-track" style="width:60px"><div class="bar-fill '+(pu>1?'red':pu>0.85?'orange':'green')+'" style="width:'+Math.min(pu*100,100)+'%"></div></div></div></td>';
    tbody.appendChild(dr);
  });
});
makeSortable('varTable');
}
<\/script></body></html>`;

  return c.html(html);
});

// ── Backlog & Projections Report ───────────────────────────────
reports.get("/backlog-projections", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const company = await getCompanyName(companyId);
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const summaryRows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE pfd.report_type = 'summary' AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const detailRows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE (pfd.report_type = 'detail' OR pfd.report_type IS NULL) AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId) as any[];

  const hasSummary = summaryRows.length > 0;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Backlog & Projections — ${company}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>${financeCSS()}
  .proj-card { display:flex; flex-direction:column; align-items:center; padding:1.5rem; }
  .proj-ring { width:80px; height:80px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.25rem; font-weight:700; border:4px solid; margin-bottom:0.5rem; }
</style>
</head><body>
<div class="header">
  <div><h1>${company}</h1><p>Backlog & Projections — Revenue Pipeline & Margin Forecast</p></div>
  <div class="date">Report generated: ${dateStr}</div>
</div>
<nav class="nav-pills">${financeNav("backlog-projections")}</nav>
${!hasSummary ? '<div class="card" style="text-align:center;padding:3rem;"><h2 style="color:var(--orange)">No Summary Data Available</h2><p style="color:var(--text3)">Import a Comprehensive Job Summary PDF from A-Systems to see backlog and projection data.</p></div>' : `
<div class="kpi-strip" id="kpis"></div>
<div class="grid-2">
  <div class="card"><h2>Revenue Backlog by Job</h2><div class="chart-container tall"><canvas id="backlogChart"></canvas></div></div>
  <div class="card"><h2>Projected Margin on Remaining Work</h2><div class="chart-container tall"><canvas id="marginChart"></canvas></div></div>
</div>
<div class="grid-2">
  <div class="card"><h2>Remaining Cost by Category</h2><div class="chart-container"><canvas id="remCostChart"></canvas></div></div>
  <div class="card"><h2>% Complete vs. % Billed</h2><div class="chart-container"><canvas id="compVsBillChart"></canvas></div></div>
</div>
<div class="card full-width" style="margin-top:1.5rem;">
  <h2>Backlog Detail — All Active Jobs</h2>
  <div style="overflow-x:auto;">
    <table id="blTable">
      <thead><tr>
        <th class="sortable" data-col="job_number">Job #</th>
        <th class="sortable" data-col="name">Name</th>
        <th class="right sortable" data-col="contract">Contract</th>
        <th class="right sortable" data-col="pct_complete">% Complete</th>
        <th class="right sortable" data-col="billed">Billed</th>
        <th class="right sortable" data-col="backlog">Backlog (To Bill)</th>
        <th class="right sortable" data-col="curr_budget">Curr Budget</th>
        <th class="right sortable" data-col="cost_to_date">Cost to Date</th>
        <th class="right sortable" data-col="rem_cost">Remaining Cost</th>
        <th class="right sortable" data-col="rem_revenue">Remaining Revenue</th>
        <th class="right sortable" data-col="rem_margin">Remaining Margin</th>
        <th class="right sortable" data-col="rem_margin_pct">Margin %</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>
</div>
`}
<script>
${financeJS()}
const SUMMARY=${JSON.stringify(summaryRows)};
const DETAIL_MAP={};${JSON.stringify(detailRows)}.forEach(d=>{DETAIL_MAP[d.job_number]=d});
const HAS_SUMMARY=${hasSummary};
if(HAS_SUMMARY){
const CATS=['labor','material','subcontract','equipment','general'];
const DATA=SUMMARY.filter(r=>r.job_status==='active').map(r=>{
  const d=DETAIL_MAP[r.job_number]||{};
  const contract=r.revised_contract_price||d.total_contract||0;
  const billed=r.billed_to_date||0;
  const backlog=Math.max(0,contract-billed);
  const pctComplete=r.percent_complete||0;
  const costToDate=sumCatCost(r);
  const currBudget=CATS.reduce((s,c)=>s+(r[c+'_curr_budget']||0),0);
  const remCost=Math.max(0,currBudget-costToDate);
  // Remaining revenue = contract * (1 - pctComplete/100) — what's left to earn
  const remRevenue=contract*(1-pctComplete/100);
  const remMargin=remRevenue-remCost;
  const remMarginPct=remRevenue>0?remMargin/remRevenue:0;
  // Category remaining
  const catRemaining=CATS.map(c=>({name:c,rem:Math.max(0,(r[c+'_curr_budget']||0)-(r[c+'_cost_to_date']||0))}));
  return{...r,contract,billed,backlog,pctComplete,costToDate,currBudget,remCost,remRevenue,remMargin,remMarginPct,catRemaining};
});

// KPIs
const totContract=DATA.reduce((s,r)=>s+r.contract,0);
const totBacklog=DATA.reduce((s,r)=>s+r.backlog,0);
const totRemCost=DATA.reduce((s,r)=>s+r.remCost,0);
const totRemRevenue=DATA.reduce((s,r)=>s+r.remRevenue,0);
const totRemMargin=totRemRevenue-totRemCost;
const totRemMarginPct=totRemRevenue>0?totRemMargin/totRemRevenue:0;
const totBilled=DATA.reduce((s,r)=>s+r.billed,0);
const avgPctComplete=DATA.length?DATA.reduce((s,r)=>s+r.pctComplete,0)/DATA.length:0;

document.getElementById('kpis').innerHTML=kpiHTML([
  {label:'Total Backlog',value:fmtD(totBacklog),cls:'blue',sub:'Revenue remaining to bill'},
  {label:'Remaining Cost',value:fmtD(totRemCost),cls:'orange',sub:'Budget minus spent to date'},
  {label:'Projected Remaining Margin',value:fmtD(totRemMargin),cls:totRemMargin>=0?'green':'red',sub:fmtP(totRemMarginPct)+' on remaining work'},
  {label:'Avg. % Complete',value:fmtP(avgPctComplete/100),cls:'teal',sub:DATA.length+' active jobs'},
  {label:'Active Contracts',value:fmtD(totContract),cls:'purple',sub:fmtD(totBilled)+' billed ('+fmtP(totBilled/totContract)+')'},
]);

Chart.defaults.font.family="-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif";
Chart.defaults.font.size=11;Chart.defaults.color='#86868b';

// Backlog by job (horizontal bar sorted largest first)
const blSorted=[...DATA].filter(r=>r.backlog>0).sort((a,b)=>b.backlog-a.backlog).slice(0,20);
new Chart(document.getElementById('backlogChart'),{type:'bar',data:{labels:blSorted.map(r=>r.job_number),datasets:[
  {label:'Already Billed',data:blSorted.map(r=>r.billed),backgroundColor:'rgba(48,209,88,0.4)',borderRadius:3},
  {label:'Remaining Backlog',data:blSorted.map(r=>r.backlog),backgroundColor:'rgba(29,81,145,0.6)',borderRadius:3},
]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true,ticks:{callback:v=>fmtD(v)},grid:{color:'#f0f0f2'}},y:{stacked:true,ticks:{font:{size:9,family:'ui-monospace,monospace'}},grid:{display:false}}},plugins:{tooltip:{callbacks:{title:i=>shortName(blSorted[i[0].dataIndex]),label:i=>{const r=blSorted[i.dataIndex];return[i.dataset.label+': '+fmtD2(i.raw),'Contract: '+fmtD2(r.contract),'% Complete: '+fmtP(r.pctComplete/100)]}}}}}});

// Projected margin on remaining
const mSorted=[...DATA].filter(r=>r.remRevenue>0).sort((a,b)=>a.remMarginPct-b.remMarginPct);
new Chart(document.getElementById('marginChart'),{type:'bar',data:{labels:mSorted.map(r=>r.job_number),datasets:[{data:mSorted.map(r=>r.remMarginPct*100),backgroundColor:mSorted.map(r=>r.remMarginPct>=0.15?'rgba(48,209,88,0.6)':r.remMarginPct>=0?'rgba(255,159,10,0.6)':'rgba(255,59,48,0.6)'),borderRadius:3}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>shortName(mSorted[i[0].dataIndex]),label:i=>{const r=mSorted[i.dataIndex];return['Remaining Margin: '+fmtP(r.remMarginPct),'Remaining Revenue: '+fmtD2(r.remRevenue),'Remaining Cost: '+fmtD2(r.remCost),'Margin $: '+fmtD2(r.remMargin)]}}}},scales:{x:{title:{display:true,text:'Projected Margin %'},grid:{color:'#f0f0f2'}},y:{ticks:{font:{size:9,family:'ui-monospace,monospace'}},grid:{display:false}}}}});

// Remaining cost by category doughnut
const catRem=CATS.map(c=>DATA.reduce((s,r)=>s+(r.catRemaining.find(x=>x.name===c)?.rem||0),0));
const catColors=['#1d5191','#ff9f0a','#30b0c7','#af52de','#ff375f'];
new Chart(document.getElementById('remCostChart'),{type:'doughnut',data:{labels:['Labor','Material','Subcontract','Equipment','General'],datasets:[{data:catRem,backgroundColor:catColors,borderWidth:0,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'bottom',labels:{padding:16}},tooltip:{callbacks:{label:i=>i.label+': '+fmtD2(i.raw)+' ('+fmtP(i.raw/catRem.reduce((a,b)=>a+b,0))+')'}}}}});

// % Complete vs % Billed scatter
const scData=DATA.filter(r=>r.contract>0).map(r=>({x:r.pctComplete,y:r.billed/r.contract*100,r:Math.max(4,Math.sqrt(r.contract)/50),name:shortName(r),num:r.job_number}));
new Chart(document.getElementById('compVsBillChart'),{type:'bubble',data:{datasets:[{data:scData,backgroundColor:scData.map(d=>d.y>d.x+10?'rgba(48,209,88,0.5)':d.y<d.x-10?'rgba(255,59,48,0.5)':'rgba(88,86,214,0.5)'),borderColor:scData.map(d=>d.y>d.x+10?'rgba(48,209,88,0.8)':d.y<d.x-10?'rgba(255,59,48,0.8)':'rgba(88,86,214,0.8)'),borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:i=>{const d=scData[i.dataIndex];return['#'+d.num+' '+d.name,'% Complete: '+d.x.toFixed(1)+'%','% Billed: '+d.y.toFixed(1)+'%',d.y>d.x?'Billed ahead (+'+((d.y-d.x).toFixed(1))+'%)':'Behind on billing ('+(d.y-d.x).toFixed(1)+'%)']}}}},scales:{x:{title:{display:true,text:'% Complete'},grid:{color:'#f0f0f2'},suggestedMin:0,suggestedMax:100},y:{title:{display:true,text:'% Billed'},grid:{color:'#f0f0f2'},suggestedMin:0,suggestedMax:100}}}});

// Table
const tBody=document.querySelector('#blTable tbody');
[...DATA].sort((a,b)=>b.backlog-a.backlog).forEach(r=>{
  const tr=document.createElement('tr');
  tr.dataset.job_number=r.job_number;tr.dataset.name=shortName(r).toLowerCase();
  tr.dataset.contract=r.contract;tr.dataset.pct_complete=r.pctComplete;tr.dataset.billed=r.billed;
  tr.dataset.backlog=r.backlog;tr.dataset.curr_budget=r.currBudget;tr.dataset.cost_to_date=r.costToDate;
  tr.dataset.rem_cost=r.remCost;tr.dataset.rem_revenue=r.remRevenue;tr.dataset.rem_margin=r.remMargin;tr.dataset.rem_margin_pct=r.remMarginPct;
  const mCls=r.remMargin>=0?'profit':'loss';
  tr.innerHTML='<td class="tabnum" style="color:var(--blue);font-weight:600">'+r.job_number+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+shortName(r)+'</td><td class="right tabnum">'+fmtD2(r.contract)+'</td><td class="right tabnum">'+fmtP(r.pctComplete/100)+'</td><td class="right tabnum">'+fmtD2(r.billed)+'</td><td class="right tabnum" style="color:var(--blue);font-weight:600">'+fmtD2(r.backlog)+'</td><td class="right tabnum">'+fmtD2(r.currBudget)+'</td><td class="right tabnum">'+fmtD2(r.costToDate)+'</td><td class="right tabnum">'+fmtD2(r.remCost)+'</td><td class="right tabnum">'+fmtD2(r.remRevenue)+'</td><td class="right tabnum '+mCls+'">'+fmtD2(r.remMargin)+'</td><td class="right tabnum '+mCls+'">'+fmtP(r.remMarginPct)+'</td>';
  tBody.appendChild(tr);
});
makeSortable('blTable');
}
<\/script></body></html>`;

  return c.html(html);
});

export { reports };
