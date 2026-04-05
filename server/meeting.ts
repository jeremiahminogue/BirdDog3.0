import { Hono } from "hono";
import { db } from "./db.js";
import {
  actionItems, jobTemplates, templateItems, jobs, settings, employees,
  jobAssignments, projectFinanceData, classifications
} from "../shared/schema.js";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";

const meeting = new Hono();
meeting.use("/*", requireAuth);

// ── Action Items CRUD ──────────────────────────────────────────

// Get items for a job
meeting.get("/items", async (c) => {
  const jobId = parseInt(c.req.query("jobId") || "0");
  const status = c.req.query("status"); // "open", "done", or omit for all
  if (!jobId) return c.json({ error: "jobId required" }, 400);

  const companyId = getCompanyId(c);
  const conditions = [eq(actionItems.jobId, jobId), eq(actionItems.companyId, companyId)];
  if (status === "open" || status === "done") {
    conditions.push(eq(actionItems.status, status));
  }

  const rows = await db
    .select({
      id: actionItems.id,
      companyId: actionItems.companyId,
      jobId: actionItems.jobId,
      description: actionItems.description,
      assignedToId: actionItems.assignedToId,
      assignedTo: actionItems.assignedTo,
      assignedFirstName: employees.firstName,
      assignedLastName: employees.lastName,
      priority: actionItems.priority,
      status: actionItems.status,
      dueDate: actionItems.dueDate,
      notes: actionItems.notes,
      sortOrder: actionItems.sortOrder,
      createdBy: actionItems.createdBy,
      completedAt: actionItems.completedAt,
      completedBy: actionItems.completedBy,
      createdAt: actionItems.createdAt,
      updatedAt: actionItems.updatedAt,
    })
    .from(actionItems)
    .leftJoin(employees, eq(actionItems.assignedToId, employees.id))
    .where(and(...conditions))
    .orderBy(actionItems.status, asc(actionItems.sortOrder), desc(actionItems.createdAt));

  // Return with computed assignedName for display
  const result = rows.map(r => ({
    ...r,
    assignedName: r.assignedFirstName && r.assignedLastName
      ? `${r.assignedFirstName} ${r.assignedLastName}`
      : r.assignedTo || null,
  }));

  return c.json(result);
});

// Create item
meeting.post("/items", requireRole("admin", "pm"), async (c) => {
  const data = await c.req.json();
  const companyId = getCompanyId(c);
  const [row] = await db.insert(actionItems).values({
    jobId: data.jobId,
    description: data.description,
    assignedToId: data.assignedToId || null,
    assignedTo: data.assignedTo || null,
    priority: data.priority || "normal",
    dueDate: data.dueDate || null,
    notes: data.notes || null,
    createdBy: data.createdBy || null,
    companyId,
  }).returning();
  return c.json(row, 201);
});

// Batch reorder items (MUST be before /items/:id to avoid route collision)
meeting.put("/items/reorder", requireRole("admin", "pm"), async (c) => {
  const { order } = await c.req.json();
  if (!Array.isArray(order)) return c.json({ error: "order array required" }, 400);
  for (const entry of order) {
    await db.update(actionItems)
      .set({ sortOrder: entry.sortOrder, updatedAt: new Date().toISOString() })
      .where(eq(actionItems.id, entry.id));
  }
  return c.json({ ok: true });
});

// Update item (edit, toggle status, add notes)
meeting.put("/items/:id", requireRole("admin", "pm"), async (c) => {
  const id = parseInt(c.req.param("id"));
  const companyId = getCompanyId(c);
  const data = await c.req.json();
  data.updatedAt = new Date().toISOString();

  // If marking done, set completedAt + completedBy
  const currentUser = c.get("user");
  if (data.status === "done" && !data.completedAt) {
    data.completedAt = new Date().toISOString();
    data.completedBy = currentUser?.displayName || null;
  }
  if (data.status === "open") {
    data.completedAt = null;
    data.completedBy = null;
  }

  const [row] = await db.update(actionItems).set(data).where(and(eq(actionItems.id, id), eq(actionItems.companyId, companyId))).returning();
  return c.json(row);
});

// Delete item
meeting.delete("/items/:id", requireRole("admin", "pm"), async (c) => {
  const id = parseInt(c.req.param("id"));
  const companyId = getCompanyId(c);
  await db.delete(actionItems).where(and(eq(actionItems.id, id), eq(actionItems.companyId, companyId)));
  return c.json({ ok: true });
});

// Quick toggle status
meeting.patch("/items/:id/toggle", requireRole("admin", "pm"), async (c) => {
  const id = parseInt(c.req.param("id"));
  const companyId = getCompanyId(c);
  const [existing] = await db.select().from(actionItems).where(and(eq(actionItems.id, id), eq(actionItems.companyId, companyId))).limit(1);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const newStatus = existing.status === "open" ? "done" : "open";
  const currentUser = c.get("user");
  const [row] = await db.update(actionItems).set({
    status: newStatus,
    completedAt: newStatus === "done" ? new Date().toISOString() : null,
    completedBy: newStatus === "done" ? (currentUser?.displayName || null) : null,
    updatedAt: new Date().toISOString(),
  }).where(and(eq(actionItems.id, id), eq(actionItems.companyId, companyId))).returning();
  return c.json(row);
});

// ── Templates ──────────────────────────────────────────────────

meeting.get("/templates", async (c) => {
  const companyId = getCompanyId(c);
  const rows = await db.select().from(jobTemplates).where(eq(jobTemplates.companyId, companyId)).orderBy(jobTemplates.name);
  return c.json(rows);
});

meeting.get("/templates/:id/items", async (c) => {
  const id = parseInt(c.req.param("id"));
  const rows = await db.select().from(templateItems)
    .where(eq(templateItems.templateId, id))
    .orderBy(asc(templateItems.sortOrder));
  return c.json(rows);
});

meeting.post("/templates", requireRole("admin", "pm"), async (c) => {
  const data = await c.req.json();
  const companyId = getCompanyId(c);
  const [row] = await db.insert(jobTemplates).values({
    name: data.name,
    description: data.description || null,
    companyId,
  }).returning();
  return c.json(row, 201);
});

meeting.post("/templates/:id/items", requireRole("admin", "pm"), async (c) => {
  const templateId = parseInt(c.req.param("id"));
  const data = await c.req.json();
  const [row] = await db.insert(templateItems).values({
    templateId,
    description: data.description,
    assignedTo: data.assignedTo || null,
    priority: data.priority || "normal",
    sortOrder: data.sortOrder || 0,
  }).returning();
  return c.json(row, 201);
});

// Update template name/description
meeting.put("/templates/:id", requireRole("admin", "pm"), async (c) => {
  const id = parseInt(c.req.param("id"));
  const companyId = getCompanyId(c);
  const data = await c.req.json();
  const [row] = await db.update(jobTemplates).set({
    name: data.name,
    description: data.description ?? null,
  }).where(and(eq(jobTemplates.id, id), eq(jobTemplates.companyId, companyId))).returning();
  return c.json(row);
});

meeting.delete("/templates/:id", requireRole("admin"), async (c) => {
  const id = parseInt(c.req.param("id"));
  const companyId = getCompanyId(c);
  await db.delete(templateItems).where(eq(templateItems.templateId, id));
  await db.delete(jobTemplates).where(and(eq(jobTemplates.id, id), eq(jobTemplates.companyId, companyId)));
  return c.json({ ok: true });
});

// Update a template item
meeting.put("/template-items/:id", requireRole("admin", "pm"), async (c) => {
  const id = parseInt(c.req.param("id"));
  const data = await c.req.json();
  const [row] = await db.update(templateItems).set({
    description: data.description,
    assignedTo: data.assignedTo ?? null,
    priority: data.priority || "normal",
    sortOrder: data.sortOrder ?? 0,
  }).where(eq(templateItems.id, id)).returning();
  return c.json(row);
});

// Delete a template item
meeting.delete("/template-items/:id", requireRole("admin", "pm"), async (c) => {
  const id = parseInt(c.req.param("id"));
  await db.delete(templateItems).where(eq(templateItems.id, id));
  return c.json({ ok: true });
});

// ── Apply template to a job (seed action items) ────────────────

meeting.post("/apply-template", requireRole("admin", "pm"), async (c) => {
  const { jobId, templateId } = await c.req.json();
  const companyId = getCompanyId(c);
  const items = await db.select().from(templateItems)
    .where(eq(templateItems.templateId, templateId))
    .orderBy(asc(templateItems.sortOrder));

  const created = [];
  for (const item of items) {
    const [row] = await db.insert(actionItems).values({
      jobId,
      description: item.description,
      assignedTo: item.assignedTo,
      priority: item.priority,
      sortOrder: item.sortOrder,
      companyId,
    }).returning();
    created.push(row);
  }
  return c.json({ count: created.length, items: created });
});

// ── Per-Job Metrics for Mini Dashboard ─────────────────────────

meeting.get("/job-metrics", async (c) => {
  const jobId = parseInt(c.req.query("jobId") || "0");
  if (!jobId) return c.json({ error: "jobId required" }, 400);
  const companyId = getCompanyId(c);

  // Fetch detail record (hours, labor, material budgets)
  const [detail] = await db.select().from(projectFinanceData)
    .where(and(
      eq(projectFinanceData.jobId, jobId),
      eq(projectFinanceData.reportType, "detail")
    ))
    .limit(1);

  // Fetch summary record (percent complete, billed, earned, cost, category breakdowns)
  const [summary] = await db.select().from(projectFinanceData)
    .where(and(
      eq(projectFinanceData.jobId, jobId),
      eq(projectFinanceData.reportType, "summary")
    ))
    .limit(1);

  // Crew: active assignments + foreman name + photos for avatar stack
  const crewRows = await db
    .select({
      empId: jobAssignments.employeeId,
      role: jobAssignments.role,
      firstName: employees.firstName,
      lastName: employees.lastName,
      photoUrl: employees.photoUrl,
      classificationName: classifications.name,
    })
    .from(jobAssignments)
    .leftJoin(employees, eq(jobAssignments.employeeId, employees.id))
    .leftJoin(classifications, eq(employees.classificationId, classifications.id))
    .where(and(eq(jobAssignments.jobId, jobId), eq(jobAssignments.isActive, true)));

  const crewCount = crewRows.length;
  const foreman = crewRows.find(r => r.role?.toLowerCase().includes("foreman") || r.role?.toLowerCase().includes("lead"));
  const foremanName = foreman ? `${foreman.firstName} ${foreman.lastName}` : null;
  const crewMembers = crewRows.map(r => ({
    id: r.empId,
    firstName: r.firstName,
    lastName: r.lastName,
    photoUrl: r.photoUrl,
    role: r.role,
    classification: r.classificationName,
  }));

  // Hours
  const hourBudget = detail?.hourBudget || 0;
  const hoursUsed = detail?.hoursUsed || 0;
  const hourPct = hourBudget > 0 ? (hoursUsed / hourBudget) * 100 : 0;

  // CPI (Cost Performance Index) = earned / cost — needs summary
  let cpi: number | null = null;
  if (summary && summary.earnedToDate && summary.costToDate && summary.costToDate > 0) {
    cpi = Math.round((summary.earnedToDate / summary.costToDate) * 100) / 100;
  }

  // Percent complete
  const pctComplete = summary?.percentComplete ?? null;

  // ── Composite Health Score (same algorithm as job-health report) ──
  // Factors: Budget (30%), Hours (20%), Profit (25%), CPI (15%), Cash (10%)
  const factors: { weight: number; score: number }[] = [];

  // 1. Budget factor — total budget vs total cost
  const totalBudget = (detail?.laborBudget || 0) + (detail?.materialBudget || 0) + (detail?.generalBudget || 0);
  const totalCost = (detail?.laborCost || 0) + (detail?.materialCost || 0) + (detail?.generalCost || 0);
  if (totalBudget > 0) {
    const budgetRatio = totalCost / totalBudget;
    const budgetScore = budgetRatio <= 0.85 ? 100 : budgetRatio <= 1.0 ? 100 - ((budgetRatio - 0.85) / 0.15) * 40 : Math.max(0, 60 - (budgetRatio - 1.0) * 200);
    factors.push({ weight: 30, score: budgetScore });
  }

  // 2. Hours factor
  if (hourBudget > 0) {
    const hRatio = hoursUsed / hourBudget;
    const hScore = hRatio <= 0.85 ? 100 : hRatio <= 1.0 ? 100 - ((hRatio - 0.85) / 0.15) * 40 : Math.max(0, 60 - (hRatio - 1.0) * 200);
    factors.push({ weight: 20, score: hScore });
  }

  // 3. Profit factor
  if (detail?.totalContract && totalCost > 0) {
    const margin = ((detail.totalContract - totalCost) / detail.totalContract) * 100;
    const profScore = margin >= 20 ? 100 : margin >= 10 ? 70 + (margin - 10) * 3 : margin >= 0 ? 40 + margin * 3 : Math.max(0, 40 + margin * 4);
    factors.push({ weight: 25, score: profScore });
  }

  // 4. CPI factor
  if (cpi !== null) {
    const cpiScore = cpi >= 1.0 ? 100 : cpi >= 0.9 ? 60 + (cpi - 0.9) * 400 : Math.max(0, cpi * 66.7);
    factors.push({ weight: 15, score: cpiScore });
  }

  // 5. Cash factor — received vs billed
  if (summary && summary.billedToDate && summary.billedToDate > 0 && summary.receivedToDate !== null) {
    const collRatio = (summary.receivedToDate || 0) / summary.billedToDate;
    const cashScore = collRatio >= 0.95 ? 100 : collRatio >= 0.80 ? 60 + (collRatio - 0.80) / 0.15 * 40 : Math.max(0, collRatio * 75);
    factors.push({ weight: 10, score: cashScore });
  }

  // Re-normalize weights
  let healthScore: number | null = null;
  let healthLabel = "N/A";
  let healthColor = "#9ca3af";
  if (factors.length > 0) {
    const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
    healthScore = Math.round(factors.reduce((s, f) => s + f.score * (f.weight / totalWeight), 0));
    if (healthScore >= 90) { healthLabel = "Excellent"; healthColor = "#16a34a"; }
    else if (healthScore >= 70) { healthLabel = "Good"; healthColor = "#2563eb"; }
    else if (healthScore >= 50) { healthLabel = "Fair"; healthColor = "#f59e0b"; }
    else if (healthScore >= 25) { healthLabel = "Poor"; healthColor = "#ea580c"; }
    else { healthLabel = "Critical"; healthColor = "#dc2626"; }
  }

  // Risk flags
  const risks: string[] = [];
  if (hourBudget > 0 && hoursUsed / hourBudget > 1.0) risks.push("Hours Over Budget");
  if (totalBudget > 0 && totalCost / totalBudget > 1.0) risks.push("Cost Over Budget");
  if (cpi !== null && cpi < 0.9) risks.push("Low CPI");
  if (summary && summary.billedToDate && summary.billedToDate > 0) {
    const collRatio = (summary.receivedToDate || 0) / summary.billedToDate;
    if (collRatio < 0.7) risks.push("Low Collections");
  }
  if (detail?.totalContract && totalCost > 0) {
    const margin = ((detail.totalContract - totalCost) / detail.totalContract) * 100;
    if (margin < 5) risks.push("Thin Margin");
  }

  return c.json({
    jobId,
    hourBudget, hoursUsed, hourPct: Math.round(hourPct),
    crewCount, foremanName, crewMembers,
    cpi,
    pctComplete,
    healthScore, healthLabel, healthColor,
    risks,
    hasDetail: !!detail,
    hasSummary: !!summary,
  });
});

// ── Meeting Snapshot (HTML report) ─────────────────────────────

meeting.get("/snapshot", async (c) => {
  const jobId = parseInt(c.req.query("jobId") || "0");
  if (!jobId) return c.json({ error: "jobId required" }, 400);

  const companyId = getCompanyId(c);
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId))).limit(1);
  if (!job) return c.json({ error: "Job not found" }, 404);

  const settingsRows = await db.select().from(settings).where(eq(settings.companyId, companyId));
  const settingsMap: Record<string, string> = {};
  for (const r of settingsRows) settingsMap[r.key] = r.value;
  const company = settingsMap.companyName || "BirdDog";

  const rawItems = await db
    .select({
      id: actionItems.id,
      description: actionItems.description,
      assignedToId: actionItems.assignedToId,
      assignedTo: actionItems.assignedTo,
      assignedFirstName: employees.firstName,
      assignedLastName: employees.lastName,
      priority: actionItems.priority,
      status: actionItems.status,
      dueDate: actionItems.dueDate,
      notes: actionItems.notes,
      completedAt: actionItems.completedAt,
    })
    .from(actionItems)
    .leftJoin(employees, eq(actionItems.assignedToId, employees.id))
    .where(and(eq(actionItems.jobId, jobId), eq(actionItems.companyId, companyId)))
    .orderBy(actionItems.status, asc(actionItems.sortOrder), desc(actionItems.createdAt));

  const items = rawItems.map(r => ({
    ...r,
    assignedName: r.assignedFirstName && r.assignedLastName
      ? `${r.assignedFirstName} ${r.assignedLastName}`
      : r.assignedTo || null,
  }));

  const openItems = items.filter(i => i.status === "open");
  const doneItems = items.filter(i => i.status === "done");

  // Group open items by assignee
  const byAssignee = new Map<string, typeof openItems>();
  for (const item of openItems) {
    const key = item.assignedName || "Unassigned";
    const arr = byAssignee.get(key) || [];
    arr.push(item);
    byAssignee.set(key, arr);
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const priorityBadge = (p: string) => {
    const colors: Record<string, string> = { urgent: "#dc2626", high: "#ea580c", normal: "#2563eb", low: "#6b7280" };
    return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:600;color:#fff;background:${colors[p] || colors.normal}">${p.toUpperCase()}</span>`;
  };

  const fmtDue = (d: string | null) => {
    if (!d) return "";
    const due = new Date(d + "T12:00:00");
    const diff = Math.ceil((due.getTime() - now.getTime()) / 86400000);
    const label = due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (diff < 0) return `<span style="color:#dc2626;font-weight:600">${label} (OVERDUE)</span>`;
    if (diff <= 3) return `<span style="color:#ea580c">${label}</span>`;
    return label;
  };

  let assigneeSections = "";
  for (const [assignee, assigneeItems] of [...byAssignee.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rows = assigneeItems.map(item => `<tr>
      <td style="padding:4px 8px">${priorityBadge(item.priority)}</td>
      <td style="padding:4px 8px">${item.description}</td>
      <td style="padding:4px 8px">${fmtDue(item.dueDate)}</td>
      <td style="padding:4px 8px;font-size:10px;color:#888">${item.notes || ""}</td>
    </tr>`).join("\n");

    assigneeSections += `
      <h3 style="font-size:13px;font-weight:600;color:#1d5191;margin:16px 0 6px;padding-bottom:3px;border-bottom:1px solid #eee">${assignee} <span style="font-weight:400;color:#999">(${assigneeItems.length})</span></h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
        <thead><tr style="background:#f5f7fa">
          <th style="padding:4px 8px;text-align:left;font-size:9px;text-transform:uppercase;color:#666;border-bottom:2px solid #ddd;width:70px">Priority</th>
          <th style="padding:4px 8px;text-align:left;font-size:9px;text-transform:uppercase;color:#666;border-bottom:2px solid #ddd">Item</th>
          <th style="padding:4px 8px;text-align:left;font-size:9px;text-transform:uppercase;color:#666;border-bottom:2px solid #ddd;width:90px">Due</th>
          <th style="padding:4px 8px;text-align:left;font-size:9px;text-transform:uppercase;color:#666;border-bottom:2px solid #ddd;width:180px">Notes</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Meeting Notes — ${job.jobNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; color: #1a1a1a; padding: 0.5in; }
    tr:nth-child(even) { background: #fafbfc; }
    @media print { body { padding: 0.25in; } }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1d5191;padding-bottom:8px;margin-bottom:16px">
    <div>
      <h1 style="font-size:18px;color:#1d5191">${job.jobNumber} — ${job.name}</h1>
      <p style="font-size:11px;color:#666;margin-top:2px">Open Items Summary</p>
    </div>
    <div style="text-align:right;font-size:10px;color:#777">
      <div style="font-weight:600">${company}</div>
      <div>${dateStr}</div>
    </div>
  </div>

  <div style="display:flex;gap:16px;margin-bottom:16px">
    <div style="flex:1;background:#f0f4f8;border-radius:6px;padding:10px 14px">
      <div style="font-size:9px;text-transform:uppercase;color:#666">Open</div>
      <div style="font-size:22px;font-weight:700;color:#1d5191">${openItems.length}</div>
    </div>
    <div style="flex:1;background:#f0f4f8;border-radius:6px;padding:10px 14px">
      <div style="font-size:9px;text-transform:uppercase;color:#666">Completed</div>
      <div style="font-size:22px;font-weight:700;color:#16a34a">${doneItems.length}</div>
    </div>
    <div style="flex:1;background:#f0f4f8;border-radius:6px;padding:10px 14px">
      <div style="font-size:9px;text-transform:uppercase;color:#666">Overdue</div>
      <div style="font-size:22px;font-weight:700;color:#dc2626">${openItems.filter(i => i.dueDate && i.dueDate < now.toISOString().slice(0,10)).length}</div>
    </div>
  </div>

  ${assigneeSections || '<p style="color:#999;text-align:center;padding:20px">No open items</p>'}

  ${doneItems.length > 0 ? `
    <h3 style="font-size:13px;font-weight:600;color:#16a34a;margin:20px 0 6px;padding-bottom:3px;border-bottom:1px solid #eee">Completed (${doneItems.length})</h3>
    <table style="width:100%;border-collapse:collapse">
      <tbody>${doneItems.map(i => `<tr style="opacity:0.5"><td style="padding:3px 8px;text-decoration:line-through">${i.description}</td><td style="padding:3px 8px;font-size:10px;color:#888">${i.assignedName || ""}</td></tr>`).join("\n")}</tbody>
    </table>
  ` : ""}
</body>
</html>`;

  return c.html(html);
});

export { meeting };
