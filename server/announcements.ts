import { Hono } from "hono";
import { db, sqlite } from "./db.js";
import { announcements, announcementReads } from "../shared/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const announce = new Hono();

// All announcement routes require auth
announce.use("/*", requireAuth);

// ══════════════════════════════════════════════════════════════════
// MANAGEMENT ROUTES (send + list from web app)
// ══════════════════════════════════════════════════════════════════

// POST /api/announcements — send a new announcement + push notifications
announce.post("/", requireRole("foreman", "pm", "admin"), async (c) => {
  const user = c.get("user") as any;
  const companyId = getCompanyId(c);
  const { title, body, priority, audience, targetJobId, targetEmployeeId } = await c.req.json();

  if (!title?.trim() || !body?.trim()) {
    return c.json({ error: "Title and body are required" }, 400);
  }
  if (!["company", "job", "individual"].includes(audience)) {
    return c.json({ error: "Invalid audience type" }, 400);
  }
  if (audience === "job" && !targetJobId) {
    return c.json({ error: "Job ID required for job-wide announcements" }, 400);
  }
  if (audience === "individual" && !targetEmployeeId) {
    return c.json({ error: "Employee ID required for individual announcements" }, 400);
  }

  // Insert announcement
  const result = db.insert(announcements).values({
    companyId,
    sentBy: user.id,
    title: title.trim(),
    body: body.trim(),
    priority: priority === "urgent" ? "urgent" : "normal",
    audience,
    targetJobId: audience === "job" ? targetJobId : null,
    targetEmployeeId: audience === "individual" ? targetEmployeeId : null,
  }).returning().get();

  // Collect push tokens based on audience
  let tokens: { token: string; employeeId: number }[] = [];

  if (audience === "company") {
    // All active push tokens for this company
    tokens = sqlite.query(`
      SELECT pt.token, pt.employee_id as employeeId
      FROM push_tokens pt
      WHERE pt.company_id = ? AND pt.is_active = 1
    `).all(companyId) as any[];
  } else if (audience === "job") {
    // Tokens for employees assigned to the target job
    tokens = sqlite.query(`
      SELECT pt.token, pt.employee_id as employeeId
      FROM push_tokens pt
      JOIN job_assignments ja ON ja.employee_id = pt.employee_id
      WHERE pt.company_id = ? AND pt.is_active = 1 AND ja.job_id = ?
    `).all(companyId, targetJobId) as any[];
  } else if (audience === "individual") {
    // Tokens for a specific employee
    tokens = sqlite.query(`
      SELECT pt.token, pt.employee_id as employeeId
      FROM push_tokens pt
      WHERE pt.company_id = ? AND pt.is_active = 1 AND pt.employee_id = ?
    `).all(companyId, targetEmployeeId) as any[];
  }

  // Send push notifications
  let pushSent = 0;
  let pushFailed = 0;

  if (tokens.length > 0) {
    const messages = tokens.map(t => ({
      to: t.token,
      title: priority === "urgent" ? `🔴 ${title.trim()}` : title.trim(),
      body: body.trim(),
      sound: "default" as const,
      priority: priority === "urgent" ? "high" : "high",  // always high so it pops as banner
      channelId: "announcements",
      data: { screen: "announcements", announcementId: result.id },
    }));

    // Send in batches of 100
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(batch),
        });

        if (res.ok) {
          const data = await res.json();
          for (const ticket of (data.data || [])) {
            if (ticket.status === "ok") {
              pushSent++;
            } else {
              pushFailed++;
              // Deactivate dead tokens
              if (ticket.details?.error === "DeviceNotRegistered") {
                const msg = batch.find(m => m.to === ticket.to);
                if (msg) {
                  sqlite.run(`UPDATE push_tokens SET is_active = 0 WHERE token = ?`, [msg.to]);
                }
              }
            }
          }
        } else {
          pushFailed += batch.length;
        }
      } catch {
        pushFailed += batch.length;
      }
    }

    // Update announcement with delivery stats
    sqlite.run(
      `UPDATE announcements SET push_sent = ?, push_failed = ? WHERE id = ?`,
      [pushSent, pushFailed, result.id]
    );
  }

  return c.json({
    id: result.id,
    pushSent,
    pushFailed,
    totalTokens: tokens.length,
  });
});

// GET /api/announcements — list sent announcements (management view)
announce.get("/", requireRole("foreman", "pm", "admin"), async (c) => {
  const companyId = getCompanyId(c);

  const rows = sqlite.query(`
    SELECT a.*,
           u.display_name as sent_by_name,
           j.job_number || ' - ' || j.name as target_job_name,
           e.first_name || ' ' || e.last_name as target_employee_name,
           (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id) as read_count
    FROM announcements a
    LEFT JOIN users u ON u.id = a.sent_by
    LEFT JOIN jobs j ON j.id = a.target_job_id
    LEFT JOIN employees e ON e.id = a.target_employee_id
    WHERE a.company_id = ?
    ORDER BY a.sent_at DESC
    LIMIT 100
  `).all(companyId);

  return c.json(rows);
});


// ══════════════════════════════════════════════════════════════════
// FIELD ROUTES (mobile app inbox)
// ══════════════════════════════════════════════════════════════════

// GET /api/announcements/inbox — get announcements for the logged-in employee
announce.get("/inbox", async (c) => {
  const user = c.get("user") as any;
  const companyId = getCompanyId(c);
  const employeeId = user.employeeId;

  if (!employeeId) {
    return c.json({ error: "No employee link" }, 400);
  }

  // Get announcements targeted at this employee:
  // 1. Company-wide announcements
  // 2. Job-wide for any job they're assigned to
  // 3. Individual announcements for them specifically
  const rows = sqlite.query(`
    SELECT a.*,
           u.display_name as sent_by_name,
           j.job_number || ' - ' || j.name as target_job_name,
           (SELECT 1 FROM announcement_reads ar
            WHERE ar.announcement_id = a.id AND ar.employee_id = ?) as is_read
    FROM announcements a
    LEFT JOIN users u ON u.id = a.sent_by
    LEFT JOIN jobs j ON j.id = a.target_job_id
    WHERE a.company_id = ?
      AND (
        a.audience = 'company'
        OR (a.audience = 'job' AND a.target_job_id IN (
          SELECT ja.job_id FROM job_assignments ja WHERE ja.employee_id = ?
        ))
        OR (a.audience = 'individual' AND a.target_employee_id = ?)
      )
    ORDER BY a.sent_at DESC
    LIMIT 50
  `).all(employeeId, companyId, employeeId, employeeId);

  return c.json(rows);
});

// POST /api/announcements/:id/read — mark announcement as read
announce.post("/:id/read", async (c) => {
  const user = c.get("user") as any;
  const announcementId = parseInt(c.req.param("id"));
  const employeeId = user.employeeId;

  if (!employeeId) {
    return c.json({ error: "No employee link" }, 400);
  }

  try {
    sqlite.run(
      `INSERT OR IGNORE INTO announcement_reads (announcement_id, employee_id) VALUES (?, ?)`,
      [announcementId, employeeId]
    );
  } catch { /* unique constraint — already read */ }

  return c.json({ ok: true });
});

export default announce;
