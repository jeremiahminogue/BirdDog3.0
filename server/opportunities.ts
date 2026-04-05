import { Hono } from "hono";
import { sqlite } from "./db.js";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";

const opportunities = new Hono();
opportunities.use("/*", requireAuth);

// ── Pipeline stage definitions ───────────────────────────────────
const STAGES = [
  "Solicitation Received", "Initial Review", "GC Outreach", "Supplier Bidder Check",
  "Go / No-Go", "Site Walk Required", "Site Walk Complete", "Takeoff",
  "Final Pricing", "Estimate Review", "Management Approval", "Proposal Prepared",
  "Bid Submitted", "Post-Bid Clarification", "Negotiation", "Verbal Award Pending",
  "Awarded", "Lost", "No-Bid", "On Hold", "Cancelled", "Closed",
];

const SYSTEM_TYPES = ["Electrical", "Controls", "Fire Alarm", "Solar", "Data"];

// ── GET /stages — return valid stages ────────────────────────────
opportunities.get("/stages", (c) => c.json({ stages: STAGES, systemTypes: SYSTEM_TYPES }));

// ── GET /gc-companies — all GC companies ─────────────────────────
opportunities.get("/gc-companies", (c) => {
  const companyId = getCompanyId(c);
  const rows = sqlite.prepare("SELECT * FROM gc_companies WHERE company_id = ? ORDER BY sort_order, name").all(companyId);
  return c.json(rows);
});

// ── POST /gc-companies — create GC company ───────────────────────
opportunities.post("/gc-companies", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const { name, phone, website, notes } = await c.req.json();
  if (!name?.trim()) return c.json({ error: "Name is required" }, 400);
  const max = sqlite.prepare("SELECT MAX(sort_order) as mx FROM gc_companies WHERE company_id = ?").get(companyId) as any;
  const nextSort = (max?.mx ?? -1) + 1;
  const result = sqlite.prepare(
    "INSERT INTO gc_companies (company_id, name, phone, website, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(companyId, name.trim(), phone || null, website || null, notes || null, nextSort);
  return c.json({ id: result.lastInsertRowid, name: name.trim() }, 201);
});

// ── Static GC routes BEFORE parameterized /:id ──────────────────
// ── PUT /gc-companies/reorder — batch reorder ───────────────────
opportunities.put("/gc-companies/reorder", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const { order } = await c.req.json();
  if (!Array.isArray(order)) return c.json({ error: "order array required" }, 400);
  const stmt = sqlite.prepare("UPDATE gc_companies SET sort_order = ? WHERE id = ? AND company_id = ?");
  for (const item of order) stmt.run(item.sortOrder, item.id, companyId);
  return c.json({ ok: true });
});

// ── POST /gc-companies/batch-delete — delete multiple GCs ───────
opportunities.post("/gc-companies/batch-delete", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "ids array required" }, 400);
  const errors: string[] = [];
  const deleted: number[] = [];
  for (const id of ids) {
    const inUse = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM opportunity_gcs WHERE gc_company_id = ? AND company_id = ?"
    ).get(id, companyId) as any;
    if (inUse?.cnt > 0) {
      const gc = sqlite.prepare("SELECT name FROM gc_companies WHERE id = ? AND company_id = ?").get(id, companyId) as any;
      errors.push(`${gc?.name || id}: used by ${inUse.cnt} bid(s)`);
    } else {
      sqlite.prepare("DELETE FROM gc_companies WHERE id = ? AND company_id = ?").run(id, companyId);
      deleted.push(id);
    }
  }
  return c.json({ deleted, errors });
});

// ── PUT /gc-companies/:id ────────────────────────────────────────
opportunities.put("/gc-companies/:id", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const { name, phone, website, notes } = await c.req.json();
  if (!name?.trim()) return c.json({ error: "Name is required" }, 400);
  sqlite.prepare(
    "UPDATE gc_companies SET name = ?, phone = ?, website = ?, notes = ? WHERE id = ? AND company_id = ?"
  ).run(name.trim(), phone || null, website || null, notes || null, id, companyId);
  return c.json({ ok: true });
});

// ── DELETE /gc-companies/:id ─────────────────────────────────────
opportunities.delete("/gc-companies/:id", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const inUse = sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM opportunity_gcs WHERE gc_company_id = ? AND company_id = ?"
  ).get(id, companyId) as any;
  if (inUse?.cnt > 0) return c.json({ error: `Cannot delete — used by ${inUse.cnt} bid(s)` }, 400);
  sqlite.prepare("DELETE FROM gc_companies WHERE id = ? AND company_id = ?").run(id, companyId);
  return c.json({ ok: true });
});

// ── GET /suppliers — all suppliers ───────────────────────────────
opportunities.get("/suppliers", (c) => {
  const companyId = getCompanyId(c);
  const rows = sqlite.prepare("SELECT * FROM suppliers WHERE company_id = ? ORDER BY sort_order, name").all(companyId);
  return c.json(rows);
});

// ── POST /suppliers — create supplier ────────────────────────────
opportunities.post("/suppliers", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const { name, phone, website, notes } = await c.req.json();
  if (!name?.trim()) return c.json({ error: "Name is required" }, 400);
  const max = sqlite.prepare("SELECT MAX(sort_order) as mx FROM suppliers WHERE company_id = ?").get(companyId) as any;
  const nextSort = (max?.mx ?? -1) + 1;
  const result = sqlite.prepare(
    "INSERT INTO suppliers (company_id, name, phone, website, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(companyId, name.trim(), phone || null, website || null, notes || null, nextSort);
  return c.json({ id: result.lastInsertRowid, name: name.trim() }, 201);
});

// ── Static supplier routes BEFORE parameterized /:id ────────────
// ── PUT /suppliers/reorder — batch reorder ──────────────────────
opportunities.put("/suppliers/reorder", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const { order } = await c.req.json();
  if (!Array.isArray(order)) return c.json({ error: "order array required" }, 400);
  const stmt = sqlite.prepare("UPDATE suppliers SET sort_order = ? WHERE id = ? AND company_id = ?");
  for (const item of order) stmt.run(item.sortOrder, item.id, companyId);
  return c.json({ ok: true });
});

// ── POST /suppliers/batch-delete — delete multiple suppliers ────
opportunities.post("/suppliers/batch-delete", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "ids array required" }, 400);
  const errors: string[] = [];
  const deleted: number[] = [];
  for (const id of ids) {
    const inUse = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM opportunity_suppliers WHERE supplier_id = ? AND company_id = ?"
    ).get(id, companyId) as any;
    if (inUse?.cnt > 0) {
      const s = sqlite.prepare("SELECT name FROM suppliers WHERE id = ? AND company_id = ?").get(id, companyId) as any;
      errors.push(`${s?.name || id}: used by ${inUse.cnt} opportunity(ies)`);
    } else {
      sqlite.prepare("DELETE FROM suppliers WHERE id = ? AND company_id = ?").run(id, companyId);
      deleted.push(id);
    }
  }
  return c.json({ deleted, errors });
});

// ── PUT /suppliers/:id ───────────────────────────────────────────
opportunities.put("/suppliers/:id", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const { name, phone, website, notes } = await c.req.json();
  if (!name?.trim()) return c.json({ error: "Name is required" }, 400);
  sqlite.prepare(
    "UPDATE suppliers SET name = ?, phone = ?, website = ?, notes = ? WHERE id = ? AND company_id = ?"
  ).run(name.trim(), phone || null, website || null, notes || null, id, companyId);
  return c.json({ ok: true });
});

// ── DELETE /suppliers/:id ────────────────────────────────────────
opportunities.delete("/suppliers/:id", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const inUse = sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM opportunity_suppliers WHERE supplier_id = ? AND company_id = ?"
  ).get(id, companyId) as any;
  if (inUse?.cnt > 0) return c.json({ error: `Cannot delete — used by ${inUse.cnt} opportunity(ies)` }, 400);
  sqlite.prepare("DELETE FROM suppliers WHERE id = ? AND company_id = ?").run(id, companyId);
  return c.json({ ok: true });
});

// ── GET / — list opportunities (with GC + supplier data) ─────────
opportunities.get("/", (c) => {
  const companyId = getCompanyId(c);
  const status = c.req.query("status"); // optional filter

  let query = `
    SELECT o.*,
      e.first_name || ' ' || e.last_name AS estimator_name,
      j.job_number AS converted_job_number
    FROM opportunities o
    LEFT JOIN employees e ON o.estimator_id = e.id
    LEFT JOIN jobs j ON o.converted_job_id = j.id
    WHERE o.company_id = ?
  `;
  const params: any[] = [companyId];

  if (status) {
    query += " AND o.status = ?";
    params.push(status);
  }

  query += " ORDER BY o.bid_date DESC, o.created_at DESC";

  const rows = sqlite.prepare(query).all(...params) as any[];

  // Fetch GCs for all returned opportunities
  const oppIds = rows.map((r) => r.id);
  let gcsMap: Record<number, any[]> = {};
  let suppMap: Record<number, any[]> = {};

  if (oppIds.length > 0) {
    const placeholders = oppIds.map(() => "?").join(",");

    const gcs = sqlite.prepare(`
      SELECT og.*, gc.name AS gc_name
      FROM opportunity_gcs og
      JOIN gc_companies gc ON og.gc_company_id = gc.id
      WHERE og.opportunity_id IN (${placeholders})
      ORDER BY og.is_primary DESC, og.created_at ASC
    `).all(...oppIds) as any[];

    for (const gc of gcs) {
      if (!gcsMap[gc.opportunity_id]) gcsMap[gc.opportunity_id] = [];
      gcsMap[gc.opportunity_id].push(gc);
    }

    const supps = sqlite.prepare(`
      SELECT os.*, s.name AS supplier_name
      FROM opportunity_suppliers os
      JOIN suppliers s ON os.supplier_id = s.id
      WHERE os.opportunity_id IN (${placeholders})
      ORDER BY s.name ASC
    `).all(...oppIds) as any[];

    for (const s of supps) {
      if (!suppMap[s.opportunity_id]) suppMap[s.opportunity_id] = [];
      suppMap[s.opportunity_id].push(s);
    }
  }

  // Attach GCs and suppliers, compute primary bid value for table display
  const result = rows.map((r) => {
    const gcs = gcsMap[r.id] || [];
    const suppliers = suppMap[r.id] || [];
    const primaryGc = gcs.find((g: any) => g.is_primary) || gcs[0] || null;
    return {
      ...r,
      gcs,
      suppliers,
      primaryGcName: primaryGc?.gc_name || null,
      primaryBidValue: primaryGc?.bid_value || null,
      gcCount: gcs.length,
      suppliersSentCount: suppliers.filter((s: any) => s.sent_drawings).length,
      suppliersTotal: suppliers.length,
    };
  });

  return c.json(result);
});

// ── GET /:id — single opportunity with full details ──────────────
opportunities.get("/:id", (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  const opp = sqlite.prepare(`
    SELECT o.*,
      e.first_name || ' ' || e.last_name AS estimator_name
    FROM opportunities o
    LEFT JOIN employees e ON o.estimator_id = e.id
    WHERE o.id = ? AND o.company_id = ?
  `).get(id, companyId) as any;

  if (!opp) return c.json({ error: "Not found" }, 404);

  const gcs = sqlite.prepare(`
    SELECT og.*, gc.name AS gc_name
    FROM opportunity_gcs og
    JOIN gc_companies gc ON og.gc_company_id = gc.id
    WHERE og.opportunity_id = ?
    ORDER BY og.is_primary DESC, og.created_at ASC
  `).all(id) as any[];

  const suppliers = sqlite.prepare(`
    SELECT os.*, s.name AS supplier_name
    FROM opportunity_suppliers os
    JOIN suppliers s ON os.supplier_id = s.id
    WHERE os.opportunity_id = ?
    ORDER BY s.name ASC
  `).all(id) as any[];

  return c.json({ ...opp, gcs, suppliers });
});

// ── POST / — create opportunity ──────────────────────────────────
opportunities.post("/", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();

  const result = sqlite.prepare(`
    INSERT INTO opportunities (
      company_id, name, system_type, status, stage, estimator_id,
      bid_date, bid_time, dwgs_specs_received, pre_bid_meeting, addenda_count,
      project_start_date, project_end_date, scope_notes, notes,
      follow_up_date, follow_up_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    companyId, body.name, body.systemType || null,
    body.status || "open", body.stage || null, body.estimatorId || null,
    body.bidDate || null, body.bidTime || null,
    body.dwgsSpecsReceived ? 1 : 0, body.preBidMeeting || null, body.addendaCount || 0,
    body.projectStartDate || null, body.projectEndDate || null,
    body.scopeNotes || null, body.notes || null,
    body.followUpDate || null, body.followUpNotes || null,
  );

  const oppId = result.lastInsertRowid as number;

  // Create GC bids if provided
  if (body.gcs?.length) {
    const stmt = sqlite.prepare(`
      INSERT INTO opportunity_gcs (
        company_id, opportunity_id, gc_company_id, contact_name, contact_email, contact_phone,
        bid_value, is_primary, collaboration_letter_sent, sent_drawings_to_gc, outcome, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const gc of body.gcs) {
      stmt.run(
        companyId, oppId, gc.gcCompanyId,
        gc.contactName || null, gc.contactEmail || null, gc.contactPhone || null,
        gc.bidValue || null, gc.isPrimary ? 1 : 0,
        gc.collaborationLetterSent ? 1 : 0, gc.sentDrawingsToGc ? 1 : 0,
        gc.outcome || "pending", gc.notes || null,
      );
    }
  }

  // Create supplier checkboxes if provided
  if (body.suppliers?.length) {
    const stmt = sqlite.prepare(
      "INSERT INTO opportunity_suppliers (company_id, opportunity_id, supplier_id, sent_drawings) VALUES (?, ?, ?, ?)"
    );
    for (const s of body.suppliers) {
      stmt.run(companyId, oppId, s.supplierId, s.sentDrawings ? 1 : 0);
    }
  }

  return c.json({ id: oppId }, 201);
});

// ── PUT /:id — update opportunity ────────────────────────────────
opportunities.put("/:id", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  sqlite.prepare(`
    UPDATE opportunities SET
      name = ?, system_type = ?, status = ?, stage = ?, estimator_id = ?,
      bid_date = ?, bid_time = ?, dwgs_specs_received = ?, pre_bid_meeting = ?, addenda_count = ?,
      project_start_date = ?, project_end_date = ?, scope_notes = ?, notes = ?,
      follow_up_date = ?, follow_up_notes = ?,
      updated_at = datetime('now')
    WHERE id = ? AND company_id = ?
  `).run(
    body.name, body.systemType || null,
    body.status || "open", body.stage || null, body.estimatorId || null,
    body.bidDate || null, body.bidTime || null,
    body.dwgsSpecsReceived ? 1 : 0, body.preBidMeeting || null, body.addendaCount || 0,
    body.projectStartDate || null, body.projectEndDate || null,
    body.scopeNotes || null, body.notes || null,
    body.followUpDate || null, body.followUpNotes || null,
    id, companyId,
  );

  return c.json({ ok: true });
});

// ── DELETE /:id — delete opportunity ─────────────────────────────
opportunities.delete("/:id", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  sqlite.prepare("DELETE FROM opportunities WHERE id = ? AND company_id = ?").run(id, companyId);
  return c.json({ ok: true });
});

// ── POST /:id/gcs — add GC bid to opportunity ───────────────────
opportunities.post("/:id/gcs", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const oppId = parseInt(c.req.param("id"));
  const gc = await c.req.json();

  if (!gc.gcCompanyId) return c.json({ error: "GC company is required" }, 400);

  const result = sqlite.prepare(`
    INSERT INTO opportunity_gcs (
      company_id, opportunity_id, gc_company_id, contact_name, contact_email, contact_phone,
      bid_value, is_primary, collaboration_letter_sent, sent_drawings_to_gc, outcome, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    companyId, oppId, gc.gcCompanyId,
    gc.contactName || null, gc.contactEmail || null, gc.contactPhone || null,
    gc.bidValue || null, gc.isPrimary ? 1 : 0,
    gc.collaborationLetterSent ? 1 : 0, gc.sentDrawingsToGc ? 1 : 0,
    gc.outcome || "pending", gc.notes || null,
  );

  return c.json({ id: result.lastInsertRowid }, 201);
});

// ── PUT /gcs/:gcId — update a GC bid ────────────────────────────
opportunities.put("/gcs/:gcId", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const gcId = parseInt(c.req.param("gcId"));
  const gc = await c.req.json();

  sqlite.prepare(`
    UPDATE opportunity_gcs SET
      gc_company_id = ?, contact_name = ?, contact_email = ?, contact_phone = ?,
      bid_value = ?, is_primary = ?, collaboration_letter_sent = ?,
      sent_drawings_to_gc = ?, outcome = ?, notes = ?
    WHERE id = ? AND company_id = ?
  `).run(
    gc.gcCompanyId, gc.contactName || null, gc.contactEmail || null, gc.contactPhone || null,
    gc.bidValue || null, gc.isPrimary ? 1 : 0,
    gc.collaborationLetterSent ? 1 : 0, gc.sentDrawingsToGc ? 1 : 0,
    gc.outcome || "pending", gc.notes || null,
    gcId, companyId,
  );

  return c.json({ ok: true });
});

// ── DELETE /gcs/:gcId — remove a GC bid ──────────────────────────
opportunities.delete("/gcs/:gcId", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const gcId = parseInt(c.req.param("gcId"));
  sqlite.prepare("DELETE FROM opportunity_gcs WHERE id = ? AND company_id = ?").run(gcId, companyId);
  return c.json({ ok: true });
});

// ── PUT /:id/suppliers — bulk update supplier checkboxes ─────────
opportunities.put("/:id/suppliers", requireRole("admin", "pm"), async (c) => {
  const companyId = getCompanyId(c);
  const oppId = parseInt(c.req.param("id"));
  const { suppliers: suppList } = await c.req.json() as { suppliers: Array<{ supplierId: number; sentDrawings: boolean }> };

  // Delete existing and re-insert (simple bulk update)
  sqlite.prepare("DELETE FROM opportunity_suppliers WHERE opportunity_id = ? AND company_id = ?").run(oppId, companyId);

  if (suppList?.length) {
    const stmt = sqlite.prepare(
      "INSERT INTO opportunity_suppliers (company_id, opportunity_id, supplier_id, sent_drawings) VALUES (?, ?, ?, ?)"
    );
    for (const s of suppList) {
      stmt.run(companyId, oppId, s.supplierId, s.sentDrawings ? 1 : 0);
    }
  }

  return c.json({ ok: true });
});

// ── POST /:id/convert — convert won opportunity to job ───────────
opportunities.post("/:id/convert", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  const opp = sqlite.prepare(
    "SELECT * FROM opportunities WHERE id = ? AND company_id = ?"
  ).get(id, companyId) as any;

  if (!opp) return c.json({ error: "Opportunity not found" }, 404);
  if (opp.converted_job_id) return c.json({ error: "Already converted to a job" }, 400);

  // Get the winning GC bid for gc_contact
  const winningGc = sqlite.prepare(`
    SELECT og.*, gc.name AS gc_name
    FROM opportunity_gcs og
    JOIN gc_companies gc ON og.gc_company_id = gc.id
    WHERE og.opportunity_id = ? AND og.outcome = 'won'
    LIMIT 1
  `).get(id) as any;

  // Build gc_contact string
  let gcContact = "";
  if (winningGc) {
    gcContact = winningGc.gc_name;
    if (winningGc.contact_name) gcContact += ` (${winningGc.contact_name})`;
  }

  // Create the job
  const body = await c.req.json().catch(() => ({})) as any;
  const jobResult = sqlite.prepare(`
    INSERT INTO jobs (
      company_id, job_number, name, address, gc_contact, status,
      start_date, end_date, scope_of_work, original_contract, current_contract, show_on_board
    ) VALUES (?, ?, ?, ?, ?, 'planning', ?, ?, ?, ?, ?, 1)
  `).run(
    companyId,
    body.jobNumber || "",
    opp.name,
    body.address || "",
    gcContact,
    opp.project_start_date || null,
    opp.project_end_date || null,
    opp.scope_notes || "",
    winningGc?.bid_value || 0,
    winningGc?.bid_value || 0,
  );

  const jobId = jobResult.lastInsertRowid as number;

  // Link opportunity to job
  sqlite.prepare(
    "UPDATE opportunities SET converted_job_id = ?, status = 'won', updated_at = datetime('now') WHERE id = ?"
  ).run(jobId, id);

  return c.json({ jobId, message: "Job created from opportunity" }, 201);
});

export { opportunities };
