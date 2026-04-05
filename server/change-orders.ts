import { Hono } from "hono";
import { db, sqlite } from "./db.js";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";

const changeOrderRoutes = new Hono();
changeOrderRoutes.use("/*", requireAuth);

// ══════════════════════════════════════════════════════════════════
// CHANGE ORDER REQUESTS — manage scope changes, estimate assignments
// ══════════════════════════════════════════════════════════════════

// ── Get summary stats (total counts, by status, by priority) ───────
changeOrderRoutes.get("/stats/summary", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);

  const row: any = sqlite.prepare(`
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_count,
      COALESCE(SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END), 0) AS submitted_count,
      COALESCE(SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END), 0) AS assigned_count,
      COALESCE(SUM(CASE WHEN status = 'estimated' THEN 1 ELSE 0 END), 0) AS estimated_count,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
      COALESCE(SUM(CASE WHEN status NOT IN ('rejected') THEN estimated_cost ELSE 0 END), 0) AS total_estimated_cost,
      COALESCE(SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END), 0) AS priority_low,
      COALESCE(SUM(CASE WHEN priority = 'normal' THEN 1 ELSE 0 END), 0) AS priority_normal,
      COALESCE(SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END), 0) AS priority_high,
      COALESCE(SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END), 0) AS priority_urgent
    FROM change_order_requests
    WHERE company_id = ?
  `).get(companyId);

  // Map to shape the frontend expects
  return c.json({
    total: row?.total_count || 0,
    draft: row?.draft_count || 0,
    submitted: row?.submitted_count || 0,
    assigned: row?.assigned_count || 0,
    estimated: row?.estimated_count || 0,
    approved: row?.approved_count || 0,
    rejected: row?.rejected_count || 0,
    totalEstimatedCost: row?.total_estimated_cost || 0,
    priorities: {
      low: row?.priority_low || 0,
      normal: row?.priority_normal || 0,
      high: row?.priority_high || 0,
      urgent: row?.priority_urgent || 0,
    },
  });
});

// ── Get next change order request number for a job ────────────────
changeOrderRoutes.get("/next-number/:jobId", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const jobId = parseInt(c.req.param("jobId"));

  const result = sqlite.prepare(`
    SELECT MAX(request_number) AS max_number
    FROM change_order_requests
    WHERE job_id = ? AND company_id = ?
  `).get(jobId, companyId);

  const maxNumber = result?.max_number || 0;
  const nextNumber = maxNumber + 1;
  const formattedNumber = `COR-${String(nextNumber).padStart(3, "0")}`;

  return c.json({ nextNumber: formattedNumber, requestNumber: nextNumber });
});

// ── Get list of active estimators (employees for assignment) ───────
changeOrderRoutes.get("/estimators", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);

  const estimators = sqlite.prepare(`
    SELECT
      id,
      first_name,
      last_name
    FROM employees
    WHERE company_id = ? AND status = 'active'
    ORDER BY last_name, first_name
  `).all(companyId);

  return c.json(estimators);
});

// ── List change orders with optional filters ──────────────────────
changeOrderRoutes.get("/", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const jobId = c.req.query("jobId");
  const status = c.req.query("status");
  const assignedTo = c.req.query("assignedTo");
  const priority = c.req.query("priority");

  let query = `
    SELECT
      cor.*,
      j.name AS job_name, j.job_number,
      e_requested.first_name AS requested_by_first, e_requested.last_name AS requested_by_last,
      e_assigned.first_name AS assigned_to_first, e_assigned.last_name AS assigned_to_last,
      u_assigned.display_name AS assigned_by_name,
      u_approved.display_name AS approved_by_name,
      (SELECT COUNT(*) FROM change_order_photos cop WHERE cop.change_order_id = cor.id) AS photo_count
    FROM change_order_requests cor
    LEFT JOIN jobs j ON cor.job_id = j.id
    LEFT JOIN employees e_requested ON cor.requested_by = e_requested.id
    LEFT JOIN employees e_assigned ON cor.assigned_to = e_assigned.id
    LEFT JOIN users u_assigned ON cor.assigned_by = u_assigned.id
    LEFT JOIN users u_approved ON cor.approved_by = u_approved.id
    WHERE cor.company_id = ?
  `;
  const params: any[] = [companyId];

  if (jobId) { query += " AND cor.job_id = ?"; params.push(parseInt(jobId)); }
  if (status) { query += " AND cor.status = ?"; params.push(status); }
  if (assignedTo) { query += " AND cor.assigned_to = ?"; params.push(parseInt(assignedTo)); }
  if (priority) { query += " AND cor.priority = ?"; params.push(priority); }

  query += " ORDER BY cor.created_at DESC";

  const rows = sqlite.prepare(query).all(...params);
  return c.json(rows);
});

// ── Get single change order with full details and photos ──────────
changeOrderRoutes.get("/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  const changeOrder = sqlite.prepare(`
    SELECT
      cor.*,
      j.name AS job_name, j.job_number, j.address AS job_address,
      e_requested.first_name AS requested_by_first, e_requested.last_name AS requested_by_last,
      e_assigned.first_name AS assigned_to_first, e_assigned.last_name AS assigned_to_last,
      u_assigned.display_name AS assigned_by_name,
      u_approved.display_name AS approved_by_name
    FROM change_order_requests cor
    LEFT JOIN jobs j ON cor.job_id = j.id
    LEFT JOIN employees e_requested ON cor.requested_by = e_requested.id
    LEFT JOIN employees e_assigned ON cor.assigned_to = e_assigned.id
    LEFT JOIN users u_assigned ON cor.assigned_by = u_assigned.id
    LEFT JOIN users u_approved ON cor.approved_by = u_approved.id
    WHERE cor.id = ? AND cor.company_id = ?
  `).get(id, companyId);

  if (!changeOrder) return c.json({ error: "Change order not found" }, 404);

  // Get photos for this change order
  const photos = sqlite.prepare(`
    SELECT
      cop.*
    FROM change_order_photos cop
    WHERE cop.change_order_id = ? AND cop.company_id = ?
    ORDER BY cop.created_at
  `).all(id, companyId);

  return c.json({ changeOrder, photos });
});

// ── Create change order request ──────────────────────────────────
changeOrderRoutes.post("/", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.json();

  // Generate next request number
  const maxResult = sqlite.prepare(`
    SELECT MAX(request_number) AS max_number
    FROM change_order_requests
    WHERE job_id = ? AND company_id = ?
  `).get(body.jobId, companyId);

  const maxNumber = maxResult?.max_number || 0;
  const nextRequestNumber = maxNumber + 1;

  const result = sqlite.prepare(`
    INSERT INTO change_order_requests (
      company_id, job_id, request_number, title, description,
      requested_by, assigned_to, assigned_by, status, priority,
      estimated_cost, estimated_hours, estimate_notes,
      location_desc, due_date, approved_by, approved_at,
      rejection_reason, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    companyId,
    body.jobId,
    nextRequestNumber,
    body.title,
    body.description || null,
    body.requestedBy || null,
    null, // assigned_to
    null, // assigned_by
    body.status || "draft",
    body.priority || "normal",
    null, // estimated_cost
    null, // estimated_hours
    null, // estimate_notes
    body.locationDesc || null,
    body.dueDate || null,
    null, // approved_by
    null, // approved_at
    null, // rejection_reason
    body.notes || null,
    new Date().toISOString(),
    new Date().toISOString()
  );

  const created = sqlite.prepare(`
    SELECT * FROM change_order_requests WHERE id = ?
  `).get(result.lastInsertRowid);

  return c.json(created, 201);
});

// ── Update change order ──────────────────────────────────────────
changeOrderRoutes.put("/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const user = c.get("user");

  // Verify change order belongs to this company
  const existing = sqlite.prepare(`
    SELECT * FROM change_order_requests WHERE id = ? AND company_id = ?
  `).get(id, companyId);

  if (!existing) return c.json({ error: "Change order not found" }, 404);

  // Build update query based on provided fields
  const updates: string[] = [];
  const params: any[] = [];

  if (body.title !== undefined) { updates.push("title = ?"); params.push(body.title); }
  if (body.description !== undefined) { updates.push("description = ?"); params.push(body.description); }
  if (body.requestedBy !== undefined) { updates.push("requested_by = ?"); params.push(body.requestedBy); }
  if (body.priority !== undefined) { updates.push("priority = ?"); params.push(body.priority); }
  if (body.locationDesc !== undefined) { updates.push("location_desc = ?"); params.push(body.locationDesc); }
  if (body.dueDate !== undefined) { updates.push("due_date = ?"); params.push(body.dueDate); }
  if (body.notes !== undefined) { updates.push("notes = ?"); params.push(body.notes); }

  // Handle status transitions
  if (body.status !== undefined) {
    updates.push("status = ?");
    params.push(body.status);

    // If assigning, set assigned_by to current user
    if (body.status === "assigned" && body.assignedTo !== undefined) {
      updates.push("assigned_to = ?");
      params.push(body.assignedTo);
      updates.push("assigned_by = ?");
      params.push(user.id);
    }

    // If estimating, require cost and hours
    if (body.status === "estimated") {
      if (body.estimatedCost === undefined || body.estimatedHours === undefined) {
        return c.json({ error: "estimatedCost and estimatedHours required for estimated status" }, 400);
      }
      updates.push("estimated_cost = ?");
      params.push(body.estimatedCost);
      updates.push("estimated_hours = ?");
      params.push(body.estimatedHours);
      if (body.estimateNotes !== undefined) {
        updates.push("estimate_notes = ?");
        params.push(body.estimateNotes);
      }
    }

    // If approving, set approved_by and approved_at
    if (body.status === "approved") {
      updates.push("approved_by = ?");
      params.push(user.id);
      updates.push("approved_at = ?");
      params.push(new Date().toISOString());
    }

    // If rejecting, require rejection_reason
    if (body.status === "rejected") {
      if (body.rejectionReason === undefined) {
        return c.json({ error: "rejectionReason required for rejected status" }, 400);
      }
      updates.push("rejection_reason = ?");
      params.push(body.rejectionReason);
    }
  }

  // Always update updated_at
  updates.push("updated_at = ?");
  params.push(new Date().toISOString());

  if (updates.length === 1) {
    // Only updated_at, no other changes
    return c.json({ success: true });
  }

  params.push(id);
  params.push(companyId);

  const query = `
    UPDATE change_order_requests
    SET ${updates.join(", ")}
    WHERE id = ? AND company_id = ?
  `;

  sqlite.prepare(query).run(...params);
  return c.json({ success: true });
});

// ── Delete change order ──────────────────────────────────────────
changeOrderRoutes.delete("/:id", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));

  // Verify change order belongs to this company
  const existing = sqlite.prepare(`
    SELECT * FROM change_order_requests WHERE id = ? AND company_id = ?
  `).get(id, companyId);

  if (!existing) return c.json({ error: "Change order not found" }, 404);

  sqlite.prepare(`DELETE FROM change_order_requests WHERE id = ? AND company_id = ?`).run(id, companyId);
  return c.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// PHOTOS — add and remove photos for change order requests
// ══════════════════════════════════════════════════════════════════

// ── Add photo to change order ────────────────────────────────────
changeOrderRoutes.post("/:id/photos", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  // Verify change order belongs to this company
  const existing = sqlite.prepare(`
    SELECT * FROM change_order_requests WHERE id = ? AND company_id = ?
  `).get(id, companyId);

  if (!existing) return c.json({ error: "Change order not found" }, 404);

  const result = sqlite.prepare(`
    INSERT INTO change_order_photos (change_order_id, company_id, photo_url, caption, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    companyId,
    body.photoUrl,
    body.caption || null,
    new Date().toISOString()
  );

  const photo = sqlite.prepare(`
    SELECT * FROM change_order_photos WHERE id = ?
  `).get(result.lastInsertRowid);

  return c.json(photo, 201);
});

// ── Remove photo from change order ──────────────────────────────
changeOrderRoutes.delete("/:id/photos/:photoId", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);
  const id = parseInt(c.req.param("id"));
  const photoId = parseInt(c.req.param("photoId"));

  // Verify photo belongs to this company
  const existing = sqlite.prepare(`
    SELECT * FROM change_order_photos WHERE id = ? AND company_id = ?
  `).get(photoId, companyId);

  if (!existing) return c.json({ error: "Photo not found" }, 404);

  sqlite.prepare(`DELETE FROM change_order_photos WHERE id = ? AND company_id = ?`).run(photoId, companyId);
  return c.json({ success: true });
});

export { changeOrderRoutes };
