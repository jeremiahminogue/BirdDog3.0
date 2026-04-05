import { Hono } from "hono";
import { db, sqlite } from "./db.js";
import { projectFinanceData, jobs } from "../shared/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const importRoutes = new Hono();

// Require auth for all import routes
importRoutes.use("/*", requireAuth);

// Finance data: admin and super_admin only (no PM)
importRoutes.get("/finance-data", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const rows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE (pfd.report_type = 'detail' OR pfd.report_type IS NULL) AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId);
  return c.json(rows);
});

// POST upload + import A-Systems PDF
importRoutes.post("/asystems", requireRole("admin"), async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    return c.json({ error: "No PDF file uploaded" }, 400);
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return c.json({ error: "File must be a PDF" }, 400);
  }

  // Save uploaded file to temp location
  const dataDir = process.env.DB_PATH ? dirname(process.env.DB_PATH) : join(__dirname, "..", "data");
  const tmpDir = join(dataDir, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, `asystems-${Date.now()}.pdf`);

  try {
    const buffer = await file.arrayBuffer();
    writeFileSync(tmpPath, Buffer.from(buffer));

    // Call Python parser
    const proc = Bun.spawnSync(["python3", join(__dirname, "parse-asystems.py"), tmpPath], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = proc.stdout.toString().trim();
    const stderr = proc.stderr.toString().trim();

    if (proc.exitCode !== 0) {
      // Q-02: Log the full error server-side but don't leak to client
      console.error("Python parser stderr:", stderr);
      return c.json({ error: "PDF parsing failed — check the file format and try again" }, 500);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return c.json({ error: "Failed to parse Python output as JSON" }, 500);
    }

    if (parsed.error) {
      return c.json({ error: parsed.error }, 500);
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return c.json({ error: "No job records found in PDF" }, 400);
    }

    // Look up job IDs by job_number, scoped to company
    const companyId = getCompanyId(c);
    const allJobs = await db.select({ id: jobs.id, jobNumber: jobs.jobNumber }).from(jobs).where(eq(jobs.companyId, companyId));
    const jobMap = new Map(allJobs.map(j => [j.jobNumber, j.id]));

    const matched: any[] = [];
    const unmatched: string[] = [];

    for (const record of parsed) {
      const jobId = jobMap.get(record.jobNumber);
      if (jobId) {
        matched.push({ ...record, jobId });
      } else {
        unmatched.push(record.jobNumber);
      }
    }

    // Delete only detail-type records for this company, preserve summary records
    sqlite.run(`DELETE FROM project_finance_data WHERE (report_type = 'detail' OR report_type IS NULL) AND job_id IN (SELECT id FROM jobs WHERE company_id = ?)`, [companyId]);

    const insertStmt = sqlite.prepare(`
      INSERT INTO project_finance_data (
        job_id, job_number, job_name, report_type,
        hour_budget, hours_used,
        labor_budget, labor_cost,
        material_budget, material_cost,
        general_budget, general_cost,
        total_contract
      ) VALUES (?, ?, ?, 'detail', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const r of matched) {
      insertStmt.run(
        r.jobId, r.jobNumber, r.jobName,
        r.hourBudget, r.hoursUsed,
        r.laborBudget, r.laborCost,
        r.materialBudget, r.materialCost,
        r.generalBudget, r.generalCost,
        r.totalContract
      );
    }

    return c.json({
      success: true,
      imported: matched.length,
      unmatched: unmatched.length > 0 ? unmatched : undefined,
      message: `Imported ${matched.length} jobs.${unmatched.length > 0 ? ` ${unmatched.length} job number(s) not found in BirdDog: ${unmatched.join(", ")}` : ""}`,
    });

  } finally {
    // Clean up temp file
    try { unlinkSync(tmpPath); } catch {}
  }
});

// POST upload + import A-Systems Comprehensive Job Summary PDF
importRoutes.post("/asystems-summary", requireRole("admin"), async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    return c.json({ error: "No PDF file uploaded" }, 400);
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return c.json({ error: "File must be a PDF" }, 400);
  }

  const dataDir = process.env.DB_PATH ? dirname(process.env.DB_PATH) : join(__dirname, "..", "data");
  const tmpDir = join(dataDir, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, `summary-${Date.now()}.pdf`);

  try {
    const buffer = await file.arrayBuffer();
    writeFileSync(tmpPath, Buffer.from(buffer));

    // Call Python parser for summary report
    const proc = Bun.spawnSync(["python3", join(__dirname, "parse-summary.py"), tmpPath], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = proc.stdout.toString().trim();
    const stderr = proc.stderr.toString().trim();

    if (proc.exitCode !== 0) {
      console.error("Summary parser stderr:", stderr);
      return c.json({ error: "PDF parsing failed — check the file format and try again" }, 500);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return c.json({ error: "Failed to parse Python output as JSON" }, 500);
    }

    if (parsed.error) {
      return c.json({ error: parsed.error }, 500);
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return c.json({ error: "No job records found in PDF" }, 400);
    }

    const companyId = getCompanyId(c);
    const allJobs = await db.select({ id: jobs.id, jobNumber: jobs.jobNumber }).from(jobs).where(eq(jobs.companyId, companyId));
    const jobMap = new Map(allJobs.map(j => [j.jobNumber, j.id]));

    const matched: any[] = [];
    const unmatched: string[] = [];

    for (const record of parsed) {
      const jobId = jobMap.get(record.jobNumber);
      if (jobId) {
        matched.push({ ...record, jobId });
      } else {
        unmatched.push(record.jobNumber);
      }
    }

    // Delete only summary-type records for this company, preserve detail records
    sqlite.run(`DELETE FROM project_finance_data WHERE report_type = 'summary' AND job_id IN (SELECT id FROM jobs WHERE company_id = ?)`, [companyId]);

    // Only store hard actuals — BirdDog computes projections/margins dynamically
    const insertStmt = sqlite.prepare(`
      INSERT INTO project_finance_data (
        job_id, job_number, job_name, report_type,
        revised_contract_price, percent_complete,
        billed_to_date, cost_to_date, earned_to_date,
        received_to_date, paid_out_to_date,
        labor_pct_complete, material_pct_complete, subcontract_pct_complete, equipment_pct_complete, general_pct_complete,
        labor_orig_budget, material_orig_budget, subcontract_orig_budget, equipment_orig_budget, general_orig_budget,
        labor_curr_budget, material_curr_budget, subcontract_curr_budget, equipment_curr_budget, general_curr_budget,
        labor_cost_to_date, material_cost_to_date, subcontract_cost_to_date, equipment_cost_to_date, general_cost_to_date
      ) VALUES (${Array(31).fill("?").join(", ")})
    `);

    for (const r of matched) {
      insertStmt.run(
        r.jobId, r.jobNumber, r.jobName, "summary",
        r.revisedContractPrice ?? null, r.percentComplete ?? null,
        r.billedToDate ?? null, r.costToDate ?? null, r.earnedToDate ?? null,
        r.receivedToDate ?? null, r.paidOutToDate ?? null,
        r.laborPctComplete ?? null, r.materialPctComplete ?? null, r.subcontractPctComplete ?? null, r.equipmentPctComplete ?? null, r.generalPctComplete ?? null,
        r.laborOrigBudget ?? null, r.materialOrigBudget ?? null, r.subcontractOrigBudget ?? null, r.equipmentOrigBudget ?? null, r.generalOrigBudget ?? null,
        r.laborCurrBudget ?? null, r.materialCurrBudget ?? null, r.subcontractCurrBudget ?? null, r.equipmentCurrBudget ?? null, r.generalCurrBudget ?? null,
        r.laborCostToDate ?? null, r.materialCostToDate ?? null, r.subcontractCostToDate ?? null, r.equipmentCostToDate ?? null, r.generalCostToDate ?? null,
      );
    }

    return c.json({
      success: true,
      imported: matched.length,
      unmatched: unmatched.length > 0 ? unmatched : undefined,
      message: `Imported ${matched.length} job summaries.${unmatched.length > 0 ? ` ${unmatched.length} job number(s) not found in BirdDog: ${unmatched.join(", ")}` : ""}`,
    });

  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
});

// GET summary data separately
importRoutes.get("/finance-summary", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const rows = sqlite.query(`
    SELECT pfd.*, j.name as matched_job_name, j.status as job_status
    FROM project_finance_data pfd
    LEFT JOIN jobs j ON j.id = pfd.job_id
    WHERE pfd.report_type = 'summary' AND j.company_id = ?
    ORDER BY pfd.job_number
  `).all(companyId);
  return c.json(rows);
});

// DELETE clear all finance data
importRoutes.delete("/finance-data", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  sqlite.run(`DELETE FROM project_finance_data WHERE job_id IN (SELECT id FROM jobs WHERE company_id = ?)`, [companyId]);
  return c.json({ success: true, message: "All finance data cleared" });
});
