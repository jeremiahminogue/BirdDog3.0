import { Hono } from "hono";
import { sqlite } from "./db.js";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";
import { createHash } from "crypto";

const toolboxTalkRoutes = new Hono();
toolboxTalkRoutes.use("/*", requireAuth);

// ══════════════════════════════════════════════════════════════════
// TOOLBOX TALKS — weekly safety meetings for job crews
// Backend API only — UI lives in the native field app
// Permissions: admin, pm, foreman (not general users)
// ══════════════════════════════════════════════════════════════════

const ALLOWED_ROLES = ["super_admin", "admin", "pm", "foreman"] as const;

// ── OSHA topic library for electrical contractors ────────────────
const OSHA_TOPICS: Array<{
  topic: string;
  oshaStandard: string;
  category: string;
}> = [
  // Electrical-specific (29 CFR 1926 Subpart K)
  { topic: "Arc Flash Protection & Boundaries", oshaStandard: "29 CFR 1926.431, NFPA 70E", category: "Electrical" },
  { topic: "Lockout/Tagout (LOTO) Procedures", oshaStandard: "29 CFR 1910.147, 1926.417", category: "Electrical" },
  { topic: "Working on Energized Circuits", oshaStandard: "29 CFR 1926.416(a)(1)", category: "Electrical" },
  { topic: "Ground-Fault Protection (GFCI)", oshaStandard: "29 CFR 1926.404(b)(1)", category: "Electrical" },
  { topic: "Electrical PPE Selection & Inspection", oshaStandard: "29 CFR 1926.95, NFPA 70E Art. 130", category: "Electrical" },
  { topic: "Overhead Power Line Safety", oshaStandard: "29 CFR 1926.416(a)(1), 1926.1408", category: "Electrical" },
  { topic: "Temporary Wiring & Extension Cords", oshaStandard: "29 CFR 1926.405(a)", category: "Electrical" },
  { topic: "Wet Location Electrical Safety", oshaStandard: "29 CFR 1926.404(b)(1)(ii)", category: "Electrical" },
  { topic: "Conduit & Cable Pulling Hazards", oshaStandard: "29 CFR 1926.416, NFPA 70 Ch 3", category: "Electrical" },
  { topic: "Panel & Switchgear Safety", oshaStandard: "29 CFR 1926.403(b), NFPA 70E", category: "Electrical" },
  { topic: "Battery & UPS System Safety", oshaStandard: "29 CFR 1926.441", category: "Electrical" },
  { topic: "Grounding & Bonding Requirements", oshaStandard: "29 CFR 1926.404(f)", category: "Electrical" },

  // General Construction Safety
  { topic: "Fall Protection — Ladders, Scaffolds, Roofs", oshaStandard: "29 CFR 1926.501, 1926.1053", category: "General" },
  { topic: "Trenching & Excavation Safety", oshaStandard: "29 CFR 1926.651, 1926.652", category: "General" },
  { topic: "Confined Space Entry", oshaStandard: "29 CFR 1926.1201-1213", category: "General" },
  { topic: "Scaffolding Safety", oshaStandard: "29 CFR 1926.451", category: "General" },
  { topic: "Hand & Power Tool Safety", oshaStandard: "29 CFR 1926.300-307", category: "General" },
  { topic: "Fire Prevention on Jobsites", oshaStandard: "29 CFR 1926.150-159", category: "General" },
  { topic: "Silica Dust Exposure", oshaStandard: "29 CFR 1926.1153", category: "General" },
  { topic: "Heat Illness Prevention", oshaStandard: "OSHA General Duty Clause, Sec 5(a)(1)", category: "General" },
  { topic: "Cold Stress & Hypothermia", oshaStandard: "OSHA General Duty Clause, Sec 5(a)(1)", category: "General" },
  { topic: "Housekeeping & Slip/Trip/Fall Prevention", oshaStandard: "29 CFR 1926.25", category: "General" },
  { topic: "Personal Protective Equipment (PPE)", oshaStandard: "29 CFR 1926.95-107", category: "General" },
  { topic: "Hazard Communication (HazCom/GHS)", oshaStandard: "29 CFR 1926.59, 1910.1200", category: "General" },

  // Emergency & First Aid
  { topic: "First Aid for Electrical Burns & Shock", oshaStandard: "29 CFR 1926.50", category: "Emergency" },
  { topic: "Emergency Action Plans", oshaStandard: "29 CFR 1926.35", category: "Emergency" },
  { topic: "CPR & AED Use on Jobsite", oshaStandard: "29 CFR 1926.50(c)", category: "Emergency" },

  // Rigging & Material Handling
  { topic: "Rigging & Crane Safety", oshaStandard: "29 CFR 1926.1400-1442", category: "Rigging" },
  { topic: "Manual Material Handling & Back Safety", oshaStandard: "OSHA Ergonomics Guidelines", category: "Rigging" },
  { topic: "Forklift & Aerial Lift Safety", oshaStandard: "29 CFR 1926.602, 1926.453", category: "Rigging" },
];


// ══════════════════════════════════════════════════════════════════
// READ ENDPOINTS
// ══════════════════════════════════════════════════════════════════

// ── GET / — list toolbox talks with filters ─────────────────────
toolboxTalkRoutes.get("/", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const jobId = c.req.query("jobId");
  const status = c.req.query("status");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");

  let query = `
    SELECT
      tt.*,
      j.name AS job_name, j.job_number, j.address AS job_address,
      e.first_name AS presenter_first_name, e.last_name AS presenter_last_name,
      (SELECT COUNT(*) FROM toolbox_talk_attendees tta WHERE tta.talk_id = tt.id) AS attendee_count,
      (SELECT COUNT(*) FROM toolbox_talk_attendees tta WHERE tta.talk_id = tt.id AND tta.signed_at IS NOT NULL) AS signed_count
    FROM toolbox_talks tt
    LEFT JOIN jobs j ON tt.job_id = j.id
    LEFT JOIN employees e ON tt.presented_by = e.id
    WHERE tt.company_id = ?
  `;
  const params: any[] = [companyId];

  if (jobId) { query += " AND tt.job_id = ?"; params.push(parseInt(jobId)); }
  if (status) { query += " AND tt.status = ?"; params.push(status); }
  if (dateFrom) { query += " AND tt.scheduled_date >= ?"; params.push(dateFrom); }
  if (dateTo) { query += " AND tt.scheduled_date <= ?"; params.push(dateTo); }

  query += " ORDER BY tt.scheduled_date DESC";

  return c.json(sqlite.prepare(query).all(...params));
});

// ── GET /stats/summary — counts by status (BEFORE /:id) ────────
toolboxTalkRoutes.get("/stats/summary", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const row: any = sqlite.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft,
      COALESCE(SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END), 0) AS scheduled,
      COALESCE(SUM(CASE WHEN status = 'presented' THEN 1 ELSE 0 END), 0) AS presented,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed
    FROM toolbox_talks WHERE company_id = ?
  `).get(companyId);
  return c.json(row || { total: 0, draft: 0, scheduled: 0, presented: 0, completed: 0 });
});

// ── GET /topics — OSHA topic library (BEFORE /:id) ─────────────
toolboxTalkRoutes.get("/topics", requireRole(...ALLOWED_ROLES), async (c) => {
  return c.json(OSHA_TOPICS);
});

// ── GET /topics/suggestions — flat topic list for backward compat
toolboxTalkRoutes.get("/topics/suggestions", requireRole(...ALLOWED_ROLES), async (c) => {
  return c.json(OSHA_TOPICS.map(t => t.topic));
});

// ── GET /crew/:jobId — crew from clock-ins, fallback to board ───
toolboxTalkRoutes.get("/crew/:jobId", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const jobId = parseInt(c.req.param("jobId"));
  const date = c.req.query("date") || new Date().toISOString().split("T")[0];

  // First try: employees who clocked in at this job on this date
  let crew: any[] = sqlite.prepare(`
    SELECT DISTINCT
      e.id, e.first_name, e.last_name, e.employee_number,
      c.name AS classification_name,
      'clock_in' AS source
    FROM time_entries te
    JOIN employees e ON te.employee_id = e.id
    LEFT JOIN classifications c ON e.classification_id = c.id
    WHERE te.job_id = ? AND te.company_id = ?
      AND date(te.clock_in) = ?
      AND e.status = 'active'
    ORDER BY e.last_name, e.first_name
  `).all(jobId, companyId, date);

  // Fallback: active assignments from workforce board
  if (crew.length === 0) {
    crew = sqlite.prepare(`
      SELECT DISTINCT
        e.id, e.first_name, e.last_name, e.employee_number,
        c.name AS classification_name,
        'assignment' AS source
      FROM job_assignments ja
      JOIN employees e ON ja.employee_id = e.id
      LEFT JOIN classifications c ON e.classification_id = c.id
      WHERE ja.job_id = ? AND ja.is_active = 1
        AND e.status = 'active' AND e.company_id = ?
      ORDER BY e.last_name, e.first_name
    `).all(jobId, companyId);
  }

  return c.json({
    crew,
    source: crew.length > 0 && crew[0].source === "clock_in" ? "time_entries" : "assignments",
  });
});

// ── GET /:id — single talk with attendees ───────────────────────
toolboxTalkRoutes.get("/:id", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  const talk: any = sqlite.prepare(`
    SELECT tt.*,
      j.name AS job_name, j.job_number, j.address AS job_address,
      e.first_name AS presenter_first_name, e.last_name AS presenter_last_name
    FROM toolbox_talks tt
    LEFT JOIN jobs j ON tt.job_id = j.id
    LEFT JOIN employees e ON tt.presented_by = e.id
    WHERE tt.id = ? AND tt.company_id = ?
  `).get(id, companyId);
  if (!talk) return c.json({ error: "Toolbox talk not found" }, 404);

  const attendees = sqlite.prepare(`
    SELECT tta.id, tta.talk_id, tta.employee_id, tta.signed_at, tta.signed_by_name, tta.signature_hash,
      e.first_name, e.last_name, e.employee_number, e.photo_url,
      c.name AS classification_name
    FROM toolbox_talk_attendees tta
    LEFT JOIN employees e ON tta.employee_id = e.id
    LEFT JOIN classifications c ON e.classification_id = c.id
    WHERE tta.talk_id = ?
    ORDER BY e.last_name, e.first_name
  `).all(id);

  return c.json({ ...talk, attendees });
});


// ══════════════════════════════════════════════════════════════════
// WRITE ENDPOINTS
// ══════════════════════════════════════════════════════════════════

// ── POST / — create toolbox talk ────────────────────────────────
toolboxTalkRoutes.post("/", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();

  if (!body.topic?.trim()) return c.json({ error: "Topic is required" }, 400);
  if (!body.scheduledDate) return c.json({ error: "Scheduled date is required" }, 400);

  // Auto-lookup OSHA standard from topic library
  const topicEntry = OSHA_TOPICS.find(t => t.topic === body.topic);
  const oshaStandard = body.oshaStandard || topicEntry?.oshaStandard || null;

  const result = sqlite.prepare(`
    INSERT INTO toolbox_talks (
      company_id, job_id, scheduled_date, topic, osha_standard,
      generated_content, presented_by, status, duration, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    companyId,
    body.jobId || null,
    body.scheduledDate,
    body.topic.trim(),
    oshaStandard,
    body.generatedContent || null,
    body.presentedBy || null,
    body.status || "draft",
    body.duration || 15,
    body.notes || null
  );

  const talkId = result.lastInsertRowid as number;

  // Auto-populate crew if jobId provided (unless explicitly disabled)
  if (body.jobId && body.autoPopulateCrew !== false) {
    const date = body.scheduledDate || new Date().toISOString().split("T")[0];

    // Try clock-ins first, fallback to assignments
    let crewIds: any[] = sqlite.prepare(`
      SELECT DISTINCT te.employee_id
      FROM time_entries te JOIN employees e ON te.employee_id = e.id
      WHERE te.job_id = ? AND te.company_id = ? AND date(te.clock_in) = ? AND e.status = 'active'
    `).all(body.jobId, companyId, date);

    if (crewIds.length === 0) {
      crewIds = sqlite.prepare(`
        SELECT DISTINCT ja.employee_id
        FROM job_assignments ja JOIN employees e ON ja.employee_id = e.id
        WHERE ja.job_id = ? AND ja.is_active = 1 AND e.status = 'active' AND e.company_id = ?
      `).all(body.jobId, companyId);
    }

    const ins = sqlite.prepare("INSERT INTO toolbox_talk_attendees (talk_id, employee_id) VALUES (?, ?)");
    for (const row of crewIds) ins.run(talkId, row.employee_id);
  }

  // Return full talk with JOINs (same shape as GET /:id)
  const talk: any = sqlite.prepare(`
    SELECT tt.*,
      j.name AS job_name, j.job_number, j.address AS job_address,
      e.first_name AS presenter_first_name, e.last_name AS presenter_last_name
    FROM toolbox_talks tt
    LEFT JOIN jobs j ON tt.job_id = j.id
    LEFT JOIN employees e ON tt.presented_by = e.id
    WHERE tt.id = ?
  `).get(talkId);
  const attendees = sqlite.prepare(`
    SELECT tta.id, tta.talk_id, tta.employee_id, tta.signed_at, tta.signed_by_name, tta.signature_hash,
      e.first_name, e.last_name, e.employee_number, e.photo_url,
      c.name AS classification_name
    FROM toolbox_talk_attendees tta
    LEFT JOIN employees e ON tta.employee_id = e.id
    LEFT JOIN classifications c ON e.classification_id = c.id
    WHERE tta.talk_id = ?
    ORDER BY e.last_name, e.first_name
  `).all(talkId);

  return c.json({ ...talk, attendees }, 201);
});

// ── PUT /:id — update toolbox talk ──────────────────────────────
toolboxTalkRoutes.put("/:id", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  const talk = sqlite.prepare("SELECT id FROM toolbox_talks WHERE id = ? AND company_id = ?").get(id, companyId);
  if (!talk) return c.json({ error: "Toolbox talk not found" }, 404);

  const fields: string[] = [];
  const values: any[] = [];

  if (body.jobId !== undefined)            { fields.push("job_id = ?"); values.push(body.jobId || null); }
  if (body.scheduledDate !== undefined)    { fields.push("scheduled_date = ?"); values.push(body.scheduledDate); }
  if (body.topic !== undefined)            { fields.push("topic = ?"); values.push(body.topic); }
  if (body.oshaStandard !== undefined)     { fields.push("osha_standard = ?"); values.push(body.oshaStandard || null); }
  if (body.generatedContent !== undefined) { fields.push("generated_content = ?"); values.push(body.generatedContent || null); }
  if (body.presentedBy !== undefined)      { fields.push("presented_by = ?"); values.push(body.presentedBy || null); }
  if (body.status !== undefined)           { fields.push("status = ?"); values.push(body.status); }
  if (body.duration !== undefined)         { fields.push("duration = ?"); values.push(body.duration || null); }
  if (body.notes !== undefined)            { fields.push("notes = ?"); values.push(body.notes || null); }
  if (body.completedAt !== undefined)      { fields.push("completed_at = ?"); values.push(body.completedAt || null); }

  if (fields.length === 0) return c.json({ ok: true });

  fields.push("updated_at = datetime('now')");
  values.push(id, companyId);

  try {
    sqlite.prepare(`UPDATE toolbox_talks SET ${fields.join(", ")} WHERE id = ? AND company_id = ?`).run(...values);

    // Return full talk with JOINs (same shape as GET /:id)
    const updated: any = sqlite.prepare(`
      SELECT tt.*,
        j.name AS job_name, j.job_number, j.address AS job_address,
        e.first_name AS presenter_first_name, e.last_name AS presenter_last_name
      FROM toolbox_talks tt
      LEFT JOIN jobs j ON tt.job_id = j.id
      LEFT JOIN employees e ON tt.presented_by = e.id
      WHERE tt.id = ? AND tt.company_id = ?
    `).get(id, companyId);
    const attendees = sqlite.prepare(`
      SELECT tta.id, tta.talk_id, tta.employee_id, tta.signed_at, tta.signed_by_name, tta.signature_hash,
        e.first_name, e.last_name, e.employee_number, e.photo_url,
        c.name AS classification_name
      FROM toolbox_talk_attendees tta
      LEFT JOIN employees e ON tta.employee_id = e.id
      LEFT JOIN classifications c ON e.classification_id = c.id
      WHERE tta.talk_id = ?
      ORDER BY e.last_name, e.first_name
    `).all(id);

    return c.json({ ...updated, attendees });
  } catch (err: any) {
    console.error("PUT /toolbox-talks/:id error:", err?.message, err?.stack);
    return c.json({ error: "Update failed", detail: err?.message }, 500);
  }
});

// ── DELETE /:id — delete toolbox talk (admin only) ──────────────
toolboxTalkRoutes.delete("/:id", requireRole("super_admin", "admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const talk = sqlite.prepare("SELECT id FROM toolbox_talks WHERE id = ? AND company_id = ?").get(id, companyId);
  if (!talk) return c.json({ error: "Toolbox talk not found" }, 404);
  sqlite.prepare("DELETE FROM toolbox_talks WHERE id = ? AND company_id = ?").run(id, companyId);
  return c.json({ ok: true });
});


// ══════════════════════════════════════════════════════════════════
// ATTENDEES
// ══════════════════════════════════════════════════════════════════

// ── POST /:id/attendees — add single attendee ───────────────────
toolboxTalkRoutes.post("/:id/attendees", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  const talk = sqlite.prepare("SELECT id FROM toolbox_talks WHERE id = ? AND company_id = ?").get(id, companyId);
  if (!talk) return c.json({ error: "Toolbox talk not found" }, 404);

  // Prevent duplicates
  const existing = sqlite.prepare("SELECT id FROM toolbox_talk_attendees WHERE talk_id = ? AND employee_id = ?").get(id, body.employeeId);
  if (existing) return c.json({ error: "Employee already added" }, 409);

  const result = sqlite.prepare("INSERT INTO toolbox_talk_attendees (talk_id, employee_id) VALUES (?, ?)").run(id, body.employeeId);

  const attendee = sqlite.prepare(`
    SELECT tta.*, e.first_name, e.last_name, e.employee_number
    FROM toolbox_talk_attendees tta LEFT JOIN employees e ON tta.employee_id = e.id
    WHERE tta.id = ?
  `).get(result.lastInsertRowid);

  return c.json(attendee, 201);
});

// ── POST /:id/attendees/batch — auto-populate from crew ─────────
toolboxTalkRoutes.post("/:id/attendees/batch", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  const talk: any = sqlite.prepare("SELECT job_id, scheduled_date FROM toolbox_talks WHERE id = ? AND company_id = ?").get(id, companyId);
  if (!talk) return c.json({ error: "Toolbox talk not found" }, 404);
  if (!talk.job_id) return c.json({ error: "Talk must have a job to batch add crew" }, 400);

  const date = talk.scheduled_date || new Date().toISOString().split("T")[0];

  // Clock-ins first, fallback to assignments
  let crewIds: any[] = sqlite.prepare(`
    SELECT DISTINCT te.employee_id
    FROM time_entries te JOIN employees e ON te.employee_id = e.id
    WHERE te.job_id = ? AND te.company_id = ? AND date(te.clock_in) = ? AND e.status = 'active'
  `).all(talk.job_id, companyId, date);

  if (crewIds.length === 0) {
    crewIds = sqlite.prepare(`
      SELECT DISTINCT ja.employee_id
      FROM job_assignments ja JOIN employees e ON ja.employee_id = e.id
      WHERE ja.job_id = ? AND ja.is_active = 1 AND e.status = 'active' AND e.company_id = ?
    `).all(talk.job_id, companyId);
  }

  const added: any[] = [];
  const ins = sqlite.prepare("INSERT INTO toolbox_talk_attendees (talk_id, employee_id) VALUES (?, ?)");

  for (const row of crewIds) {
    const exists = sqlite.prepare("SELECT id FROM toolbox_talk_attendees WHERE talk_id = ? AND employee_id = ?").get(id, row.employee_id);
    if (exists) continue;
    const result = ins.run(id, row.employee_id);
    const att = sqlite.prepare(`
      SELECT tta.*, e.first_name, e.last_name, e.employee_number
      FROM toolbox_talk_attendees tta LEFT JOIN employees e ON tta.employee_id = e.id WHERE tta.id = ?
    `).get(result.lastInsertRowid);
    added.push(att);
  }

  return c.json({ added }, 201);
});

// ── DELETE /:id/attendees/:attendeeId — remove attendee ─────────
toolboxTalkRoutes.delete("/:id/attendees/:attendeeId", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const attendeeId = parseInt(c.req.param("attendeeId"));

  const talk = sqlite.prepare("SELECT id FROM toolbox_talks WHERE id = ? AND company_id = ?").get(id, companyId);
  if (!talk) return c.json({ error: "Toolbox talk not found" }, 404);

  sqlite.prepare("DELETE FROM toolbox_talk_attendees WHERE id = ? AND talk_id = ?").run(attendeeId, id);
  return c.json({ ok: true });
});

// ── PUT /:id/attendees/:attendeeId/sign — tap-to-acknowledge ────
toolboxTalkRoutes.put("/:id/attendees/:attendeeId/sign", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const attendeeId = parseInt(c.req.param("attendeeId"));

  const talk = sqlite.prepare("SELECT id FROM toolbox_talks WHERE id = ? AND company_id = ?").get(id, companyId);
  if (!talk) return c.json({ error: "Toolbox talk not found" }, 404);

  // Get employee + talk content for hash
  const att: any = sqlite.prepare(`
    SELECT tta.employee_id, e.first_name, e.last_name
    FROM toolbox_talk_attendees tta LEFT JOIN employees e ON tta.employee_id = e.id
    WHERE tta.id = ? AND tta.talk_id = ?
  `).get(attendeeId, id);
  if (!att) return c.json({ error: "Attendee not found" }, 404);

  const talkData: any = sqlite.prepare("SELECT generated_content FROM toolbox_talks WHERE id = ?").get(id);
  const signedName = `${att.first_name} ${att.last_name}`;
  const signedAt = new Date().toISOString();

  // Tamper-evident signature hash: SHA-256(empId|talkId|contentHash|timestamp)
  const contentHash = createHash("sha256").update(talkData?.generated_content || "").digest("hex").slice(0, 16);
  const sigPayload = `${att.employee_id}|${id}|${contentHash}|${signedAt}`;
  const signatureHash = createHash("sha256").update(sigPayload).digest("hex");

  sqlite.prepare(`
    UPDATE toolbox_talk_attendees SET signed_at = ?, signed_by_name = ?, signature_hash = ?
    WHERE id = ? AND talk_id = ?
  `).run(signedAt, signedName, signatureHash, attendeeId, id);

  // Auto-complete talk when all attendees have signed
  const unsigned: any = sqlite.prepare(
    "SELECT COUNT(*) AS cnt FROM toolbox_talk_attendees WHERE talk_id = ? AND signed_at IS NULL"
  ).get(id);

  if (unsigned.cnt === 0) {
    sqlite.prepare(
      "UPDATE toolbox_talks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(id);
  }

  const updated = sqlite.prepare(`
    SELECT tta.*, e.first_name, e.last_name, e.employee_number
    FROM toolbox_talk_attendees tta LEFT JOIN employees e ON tta.employee_id = e.id WHERE tta.id = ?
  `).get(attendeeId);

  return c.json(updated);
});


// ══════════════════════════════════════════════════════════════════
// AI CONTENT GENERATION
// ══════════════════════════════════════════════════════════════════

// ── POST /:id/generate — AI-generated talk via Anthropic API ────
toolboxTalkRoutes.post("/:id/generate", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  const talk: any = sqlite.prepare(`
    SELECT tt.*, j.name AS job_name, j.job_number, j.address AS job_address
    FROM toolbox_talks tt LEFT JOIN jobs j ON tt.job_id = j.id
    WHERE tt.id = ? AND tt.company_id = ?
  `).get(id, companyId);
  if (!talk) return c.json({ error: "Toolbox talk not found" }, 404);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const content = generateTemplateContent(talk);
    sqlite.prepare("UPDATE toolbox_talks SET generated_content = ?, updated_at = datetime('now') WHERE id = ?").run(content, id);
    return c.json({ generatedContent: content, source: "template" });
  }

  const topicEntry = OSHA_TOPICS.find(t => t.topic === talk.topic);
  const oshaRef = talk.osha_standard || topicEntry?.oshaStandard || "General Duty Clause";

  const prompt = `You are a safety training content generator for Pueblo Electrics, a Colorado electrical contracting company. Generate a complete, ready-to-present toolbox talk for a field crew.

TOPIC: ${talk.topic}
OSHA STANDARD: ${oshaRef}
JOB: ${talk.job_name || "General"} ${talk.job_number ? `(#${talk.job_number})` : ""}
${talk.job_address ? `LOCATION: ${talk.job_address}` : ""}
TARGET DURATION: ${talk.duration || 15} minutes

Generate the talk in this exact structure:

1. OPENING (1-2 min): Why this matters today. Make it relevant to electrical construction work.

2. OSHA REQUIREMENTS: Cite the specific OSHA standard(s) and what they require. Be precise with CFR references.

3. HAZARDS & RISKS: List 4-6 specific hazards related to this topic that an electrical crew would encounter on a construction jobsite. Include real-world examples.

4. SAFE WORK PRACTICES: Step-by-step procedures. Be specific to electrical work — mention actual tools, materials, and situations the crew deals with.

5. DISCUSSION QUESTIONS: 3 questions to engage the crew. Ask about their experiences and what they'd do in specific scenarios.

6. KEY TAKEAWAYS: 3-4 bullet points summarizing the critical safety points.

Write in plain language that a foreman can read aloud to a crew. No jargon that field workers wouldn't know. Be specific and practical, not generic. Keep it concise enough to present in ${talk.duration || 15} minutes.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error("Anthropic API error:", await res.text());
      const content = generateTemplateContent(talk);
      sqlite.prepare("UPDATE toolbox_talks SET generated_content = ?, updated_at = datetime('now') WHERE id = ?").run(content, id);
      return c.json({ generatedContent: content, source: "template" });
    }

    const data = await res.json() as any;
    const content = data.content?.[0]?.text || generateTemplateContent(talk);

    sqlite.prepare("UPDATE toolbox_talks SET generated_content = ?, updated_at = datetime('now') WHERE id = ?").run(content, id);
    return c.json({ generatedContent: content, source: "ai" });
  } catch (err) {
    console.error("AI generation error:", err);
    const content = generateTemplateContent(talk);
    sqlite.prepare("UPDATE toolbox_talks SET generated_content = ?, updated_at = datetime('now') WHERE id = ?").run(content, id);
    return c.json({ generatedContent: content, source: "template" });
  }
});

// Template fallback when AI is unavailable
function generateTemplateContent(talk: any): string {
  const topicEntry = OSHA_TOPICS.find(t => t.topic === talk.topic);
  const oshaRef = talk.osha_standard || topicEntry?.oshaStandard || "See applicable OSHA standards";

  return `TOOLBOX TALK: ${talk.topic}
Job: ${talk.job_name || "N/A"} ${talk.job_number ? `(#${talk.job_number})` : ""}
Date: ${talk.scheduled_date}
OSHA Reference: ${oshaRef}

OPENING
Today we're covering ${talk.topic}. This is critical for our crew's safety on this jobsite.

OSHA REQUIREMENTS
Reference: ${oshaRef}
[Presenter: Review the specific requirements of this standard as they apply to today's work.]

HAZARDS & RISKS
- Identify specific hazards related to ${talk.topic} on this jobsite
- Discuss recent incidents or near-misses
- Review consequences of improper procedures

SAFE WORK PRACTICES
1. Pre-work assessment and hazard identification
2. Proper PPE selection and inspection
3. Correct procedures and techniques
4. Post-work verification and cleanup

DISCUSSION
- Has anyone encountered a hazard related to ${talk.topic} recently?
- What would you do if you saw an unsafe condition?
- How can we improve our practices on this site?

KEY TAKEAWAYS
- Always follow established safety procedures
- Stop work if conditions are unsafe
- Report hazards immediately
- Look out for each other

All attendees acknowledge understanding of today's safety topic.`;
}


// ══════════════════════════════════════════════════════════════════
// PDF / PRINTABLE EXPORT
// ══════════════════════════════════════════════════════════════════

// ── GET /:id/export — printable HTML for PDF generation ─────────
// The native app can open this in a webview and use OS print-to-PDF
toolboxTalkRoutes.get("/:id/export", requireRole(...ALLOWED_ROLES), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  const talk: any = sqlite.prepare(`
    SELECT tt.*,
      j.name AS job_name, j.job_number, j.address AS job_address,
      e.first_name AS presenter_first_name, e.last_name AS presenter_last_name
    FROM toolbox_talks tt
    LEFT JOIN jobs j ON tt.job_id = j.id
    LEFT JOIN employees e ON tt.presented_by = e.id
    WHERE tt.id = ? AND tt.company_id = ?
  `).get(id, companyId);
  if (!talk) return c.json({ error: "Toolbox talk not found" }, 404);

  const attendees: any[] = sqlite.prepare(`
    SELECT tta.*, e.first_name, e.last_name, e.employee_number, c.name AS classification_name
    FROM toolbox_talk_attendees tta
    LEFT JOIN employees e ON tta.employee_id = e.id
    LEFT JOIN classifications c ON e.classification_id = c.id
    WHERE tta.talk_id = ? ORDER BY e.last_name, e.first_name
  `).all(id);

  const company: any = sqlite.prepare("SELECT name FROM companies WHERE id = ?").get(companyId);
  const companyName = company?.name || "Pueblo Electrics";
  const presenterName = talk.presenter_first_name
    ? `${talk.presenter_first_name} ${talk.presenter_last_name}` : "N/A";

  const fmtDate = (d: string | null) => {
    if (!d) return "N/A";
    return new Date(d).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  };
  const fmtDateTime = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const contentHtml = talk.generated_content
    ? esc(talk.generated_content).replace(/\n/g, "<br>")
    : "<em>No content generated</em>";

  const attRows = attendees.map(a => `
    <tr>
      <td>${a.employee_number || ""}</td>
      <td>${a.first_name} ${a.last_name}</td>
      <td>${a.classification_name || ""}</td>
      <td style="text-align:center">${a.signed_at ? "&#10003;" : ""}</td>
      <td>${a.signed_by_name || ""}</td>
      <td>${a.signed_at ? fmtDateTime(a.signed_at) : ""}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Toolbox Talk — ${esc(talk.topic)}</title>
<style>
  @media print { body { margin: 0; } .no-print { display: none; } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 800px; margin: 0 auto; padding: 32px 24px; color: #1d1d1f; font-size: 13px; line-height: 1.5; }
  .header { border-bottom: 2px solid #1d1d1f; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 20px; margin: 0 0 4px 0; }
  .header .company { font-size: 14px; color: #666; margin: 0; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; background: #f5f5f7;
    border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; }
  .meta dt { font-weight: 600; color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta dd { margin: 0 0 8px 0; font-weight: 500; }
  .osha { display: inline-block; background: #fff3cd; color: #856404; padding: 2px 8px;
    border-radius: 4px; font-size: 12px; font-weight: 600; }
  .section { margin-bottom: 24px; }
  .section h2 { font-size: 14px; font-weight: 700; border-bottom: 1px solid #e5e5ea;
    padding-bottom: 6px; margin: 0 0 12px 0; }
  .content { white-space: pre-wrap; font-size: 13px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #f5f5f7; text-align: left; padding: 8px 12px; font-size: 11px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #666; border-bottom: 2px solid #e5e5ea; }
  td { padding: 8px 12px; border-bottom: 1px solid #e5e5ea; font-size: 13px; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5ea;
    font-size: 11px; color: #8e8e93; text-align: center; }
</style>
</head>
<body>
<div class="header">
  <p class="company">${esc(companyName)}</p>
  <h1>Toolbox Talk: ${esc(talk.topic)}</h1>
</div>
<dl class="meta">
  <dt>Date</dt><dd>${fmtDate(talk.scheduled_date)}</dd>
  <dt>Job</dt><dd>${talk.job_name ? `${esc(talk.job_name)} (#${talk.job_number || ""})` : "N/A"}</dd>
  <dt>Presenter</dt><dd>${esc(presenterName)}</dd>
  <dt>Duration</dt><dd>${talk.duration || 15} minutes</dd>
  <dt>OSHA Reference</dt><dd><span class="osha">${esc(talk.osha_standard || "N/A")}</span></dd>
  <dt>Status</dt><dd>${talk.status}${talk.completed_at ? ` — ${fmtDateTime(talk.completed_at)}` : ""}</dd>
</dl>
<div class="section">
  <h2>Talk Content</h2>
  <div class="content">${contentHtml}</div>
</div>
<div class="section">
  <h2>Attendee Sign-Off (${attendees.filter(a => a.signed_at).length}/${attendees.length})</h2>
  <p style="font-size:12px;color:#666;">By acknowledging, each crew member confirms they received and understood this safety talk.</p>
  <table>
    <thead><tr><th>Emp #</th><th>Name</th><th>Classification</th><th>Signed</th><th>Acknowledged By</th><th>Date/Time</th></tr></thead>
    <tbody>${attRows || '<tr><td colspan="6" style="text-align:center;color:#8e8e93;">No attendees</td></tr>'}</tbody>
  </table>
</div>
<div class="footer">
  <p>OSHA requires employers to instruct employees in the recognition and avoidance of unsafe conditions (29 CFR 1926.21(b)(2)).</p>
  <p>This document serves as a record of safety training conducted by ${esc(companyName)}.</p>
  <p>Generated by BirdDog — ${new Date().toLocaleDateString("en-US")}</p>
</div>
</body>
</html>`;

  return c.html(html);
});


export { toolboxTalkRoutes };
