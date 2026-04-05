/**
 * One-time seed: Import opportunities from Projects Bidding.xlsx
 * POST /api/import/opportunities — accepts multipart XLSX upload
 * Super-admin only. Wipes existing opportunity data and re-seeds.
 */
import { Hono } from "hono";
import { sqlite } from "./db.js";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";
import * as XLSX from "xlsx";

export const importOpportunities = new Hono();
importOpportunities.use("/*", requireAuth);

// ─── GC NAME NORMALIZATION ─────────────────────────────────────────────────

const GC_MERGE: Record<string, string> = {
  "B&M": "B&M Construction",
  "B&M Construction Barbara Myrick": "B&M Construction",
  "B&M Construction, Inc": "B&M Construction",
  "B & M Construction": "B&M Construction",
  "Houston": "HW Houston",
  "HW Houston Construction": "HW Houston",
  "Houston Nunn": "HW Houston / Nunn Construction",
  "NUNN": "Nunn Construction",
  "Nunn": "Nunn Construction",
  "Nunn Construction,Inc": "Nunn Construction",
  "IS West": "IS West Inc.",
  "IS West Inc": "IS West Inc.",
  "iicon": "iicon Construction",
  "Vision": "Vision Mechanical",
  "HE Whitlock": "Whitlock",
  "HE Whitlock Construction": "Whitlock",
  "Rocky Mnt. ATS": "ATS Rocky Mountain",
  "Rocky Mtn. ATS": "ATS Rocky Mountain",
  "Happel Associates": "Happel Associates Commercial Builders",
  "GH Phipps Construction": "GH Phipps",
  "Pueblo School District #60": "Pueblo School District 60",
  "Deployed Global Solutions": "Deployed Global Solutions LLC",
  "Arc Valley Construction": "Arc Valley",
  "Bassett": "Bassett Construction",
  "EVRAZ North America": "EVRAZ",
  "Johnson Controls": "JCI",
  "Adolph & Peterson": "A&P Construction",
  "A&P": "A&P Construction",
  "Meridian FA": "Meridian Fire & Security",
  "Caisson": "Caisson Co.",
  "Caisson Company": "Caisson Co.",
};

function normalizeGcName(rawPart: string): string | null {
  let s = rawPart.trim();
  s = s.replace(/[\w\.-]+@[\w\.-]+\.\w+/g, "");
  s = s.replace(/\(?\d{3}\)?[\s\-\.]*\d{3}[\s\-\.]*\d{4}/g, "");
  s = s.replace(/\d{1,2}\/\d{1,2}\s*@\s*\d{1,2}:\d{2}/g, "");
  s = s.replace(/\d{1,2}-\d{1,2}:\d{2}/g, "");
  s = s.replace(/\([^)]*\)/g, "");
  s = s.replace(/\s+/g, " ").trim().replace(/,+$/, "").replace(/\.+$/, "").trim();
  if (["inc", "inc.", "llc", "llc.", ""].includes(s.toLowerCase()) || s.length < 2) return null;
  s = s.replace(/,?\s*(Inc\.?|LLC\.?)$/, "").trim();
  return GC_MERGE[s] ?? s;
}

function extractContact(rawPart: string): string | null {
  const m = rawPart.match(/\(([^)]+)\)/);
  if (!m) return null;
  const c = m[1].trim();
  if (c.includes("@") || /\d{3}/.test(c) || /\d+\/\d+|am|pm|noon/i.test(c)) return null;
  return c;
}

function extractEmail(rawPart: string): string | null {
  const m = rawPart.match(/([\w\.-]+@[\w\.-]+\.\w+)/);
  return m ? m[1] : null;
}

function extractPhone(rawPart: string): string | null {
  const m = rawPart.match(/\(?\d{3}\)?[\s\-\.]*\d{3}[\s\-\.]*\d{4}/);
  return m ? m[0] : null;
}

function splitGcField(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0, current = "";
  for (const ch of raw) {
    if (ch === "(") { depth++; current += ch; }
    else if (ch === ")") { depth--; current += ch; }
    else if (ch === "," && depth === 0) { parts.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// ─── SUPPLIER NORMALIZATION (whitelist-based) ──────────────────────────────

// Canonical supplier names — the actual supply houses PE works with
const SUPPLIER_WHITELIST: Record<string, string> = {
  // Exact matches and known abbreviations → canonical name
  "blazer": "Blazer",
  "blz.": "Blazer",
  "blz": "Blazer",
  "american": "American",
  "am.": "American",
  "am": "American",
  "america": "American",
  "amerian": "American",
  "americam": "American",
  "rexel": "Rexel",
  "rex.": "Rexel",
  "rex": "Rexel",
  "essi": "ESSI",
  "jci": "JCI",
  "wsfp": "WSFP",
  "special systems": "Special Systems",
  "special sys.": "Special Systems",
  "spec. sys.": "Special Systems",
  "specialty systems": "Special Systems",
  "graybar": "Graybar",
  "wesco": "Wesco",
  "caisson co.": "Caisson Co.",
  "caisson co": "Caisson Co.",
  "caisson": "Caisson Co.",
  "caisson company": "Caisson Co.",
  "abm": "ABM",
  "smith power": "Smith Power",
  "dvl": "DVL",
  "cummins": "Cummins",
  "power systems west": "Power Systems West",
  "pwr. sys. west": "Power Systems West",
  "power sys. west": "Power Systems West",
  "power sys west": "Power Systems West",
  "psw": "Power Systems West",
  "wagner": "Wagner",
  "wagner equipment": "Wagner",
  "wagnor equipment": "Wagner",
  "dynamic power": "Dynamic Power",
  "dynamic": "Dynamic Power",
  "tech. electronics": "Tech Electronics",
  "vfc": "VFC",
  "colorado security": "Colorado Security",
  "colo. security": "Colorado Security",
  "co. security": "Colorado Security",
  "co. securitiy": "Colorado Security",
  "convergent": "Convergent",
  "hixxa": "Hixxa",
  "old castle": "Old Castle",
  "generac": "Generac",
  "conklin": "Conklin",
  "siemens": "Siemens",
  "honeywell": "Honeywell",
  "baha": "BAHA",
  "meridian fire & security": "Meridian Fire & Security",
  "meridian fa": "Meridian Fire & Security",
  "lonestar": "Lonestar Electric Supply",
  "timberline electric": "Timberline Electric",
  "timberline abm": "Timberline Electric",
  "old castle": "Old Castle",
  "kohler": "Kohler",
  "musco": "Musco",
  "corsentino": "Corsentino",
  "phillips fire design": "Phillips Fire Design",
  "phillips fire design llc": "Phillips Fire Design",
  "high point": "High Point Network",
  "high point network": "High Point Network",
  "vevo tech": "Vevo Tech",
  "solar max led lighting": "Solar Max LED Lighting",
};

function parseSuppliers(raw: any): string[] {
  if (raw == null || raw === "") return [];
  const s = String(raw).trim();
  if (!s) return [];
  const result: string[] = [];
  // Split on comma, then try to match each token against whitelist
  for (const p of s.split(",")) {
    let name = p.replace(/\([^)]*\)/g, "").trim().replace(/\s+/g, " ");
    if (!name || name.length < 2) continue;
    const key = name.toLowerCase().replace(/\.?\s*$/, "").trim();
    const canonical = SUPPLIER_WHITELIST[key];
    if (canonical && !result.includes(canonical)) {
      result.push(canonical);
    }
  }
  return result;
}

// ─── STATUS / FIELD MAPPING ────────────────────────────────────────────────

function mapStatus(row: any): string {
  const active = String(row["Active"] ?? "").trim().toLowerCase();
  const bidding = String(row["Bidding"] ?? "").trim().toLowerCase();
  const awarded = String(row["Job Awarded to PE"] ?? "").trim().toLowerCase();
  const stage = String(row["Stage"] ?? "").trim().toLowerCase();
  if (awarded === "yes") return "won";
  if (bidding === "no") return "no_bid";
  if (active === "yes") return "open";
  if (stage === "no-bid" || stage === "no bid") return "no_bid";
  if (stage === "awarded") return "won";
  if (bidding === "yes" && awarded === "no") return "lost";
  return "lost";
}

const STAGE_MAP: Record<string, string> = {
  "Bid Submitted": "Bid Submitted",
  "Go / No-Go": "Go/No-Go",
  "Takeoff": "Takeoff",
  "Awarded": "Awarded",
  "No-Bid": "No-Bid",
  "Final Pricing": "Final Pricing",
  "Estimate Review": "Estimate Review",
  "GC Outreach": "GC Outreach",
  "Site Walk Required": "Site Walk Required",
  "Initial Review": "Initial Review",
};

function mapStage(raw: any): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s || s === "undefined" || s === "null") return null;
  return STAGE_MAP[s] ?? s;
}

function parseDate(raw: any): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return raw.toISOString().split("T")[0];
  }
  const s = String(raw).trim();
  if (!s || s === "undefined" || s === "null" || s === "NaN") return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

function parseTime(raw: any): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    const h = raw.getHours().toString().padStart(2, "0");
    const m = raw.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }
  const s = String(raw).trim();
  const m = s.match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : null;
}

function parseBidValue(raw: any): number | null {
  if (raw == null || raw === "") return null;
  const v = Number(raw);
  return isNaN(v) || v <= 0 ? null : v;
}

// ─── ENDPOINT ──────────────────────────────────────────────────────────────

importOpportunities.post("/", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    return c.json({ error: "No XLSX file uploaded" }, 400);
  }

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
    const sheet = wb.Sheets["Project Bidding List"];
    if (!sheet) {
      return c.json({ error: "Sheet 'Project Bidding List' not found" }, 400);
    }
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows.length) {
      return c.json({ error: "No data rows found" }, 400);
    }

    // Build employee lookup for estimators
    const employees = sqlite.query(
      `SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ?`
    ).all(companyId) as { id: number; name: string }[];
    const empMap: Record<string, number> = {};
    for (const e of employees) empMap[e.name.trim().toLowerCase()] = e.id;

    // Map estimator names
    const estimatorMap: Record<string, number | null> = {};
    const uniqueEstimators = [...new Set(rows.map(r => String(r["Estimator"] ?? "").trim()).filter(Boolean))];
    for (const name of uniqueEstimators) {
      const key = name.toLowerCase();
      if (empMap[key]) { estimatorMap[name] = empMap[key]; continue; }
      const lastName = key.split(/\s+/).pop() ?? "";
      const match = Object.entries(empMap).find(([n]) => n.includes(lastName));
      estimatorMap[name] = match ? match[1] : null;
    }

    // Phase 1: Collect all GC companies and suppliers
    const gcNames = new Set<string>();
    for (const row of rows) {
      const raw = String(row["General Contractors"] ?? "").trim();
      if (!raw) continue;
      for (const part of splitGcField(raw)) {
        const name = normalizeGcName(part);
        if (name) gcNames.add(name);
      }
    }
    const supplierNames = new Set<string>();
    for (const row of rows) {
      for (const s of parseSuppliers(row["Vendors"])) supplierNames.add(s);
    }

    // Phase 2: Wipe and re-seed
    sqlite.run("DELETE FROM opportunity_suppliers WHERE company_id = ?", [companyId]);
    sqlite.run("DELETE FROM opportunity_gcs WHERE company_id = ?", [companyId]);
    sqlite.run("DELETE FROM opportunities WHERE company_id = ?", [companyId]);
    sqlite.run("DELETE FROM gc_companies WHERE company_id = ?", [companyId]);
    sqlite.run("DELETE FROM suppliers WHERE company_id = ?", [companyId]);

    // Insert GC companies
    const gcIdMap: Record<string, number> = {};
    const insertGc = sqlite.prepare("INSERT INTO gc_companies (company_id, name) VALUES (?, ?)");
    for (const name of [...gcNames].sort()) {
      const info = insertGc.run(companyId, name);
      gcIdMap[name] = Number(info.lastInsertRowid);
    }

    // Insert suppliers
    const supIdMap: Record<string, number> = {};
    const insertSup = sqlite.prepare("INSERT INTO suppliers (company_id, name) VALUES (?, ?)");
    for (const name of [...supplierNames].sort()) {
      const info = insertSup.run(companyId, name);
      supIdMap[name] = Number(info.lastInsertRowid);
    }

    // Phase 3: Insert opportunities
    const insertOpp = sqlite.prepare(`
      INSERT INTO opportunities (
        company_id, name, system_type, status, stage, estimator_id,
        bid_date, bid_time, dwgs_specs_received, pre_bid_meeting,
        addenda_count, project_start_date, project_end_date,
        notes, follow_up_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertGcBid = sqlite.prepare(`
      INSERT INTO opportunity_gcs (
        company_id, opportunity_id, gc_company_id,
        contact_name, contact_email, contact_phone,
        bid_value, is_primary, collaboration_letter_sent,
        sent_drawings_to_gc, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertOppSup = sqlite.prepare(`
      INSERT INTO opportunity_suppliers (company_id, opportunity_id, supplier_id, sent_drawings)
      VALUES (?, ?, ?, 1)
    `);

    const stats = { opportunities: 0, gcBids: 0, supplierLinks: 0, skipped: 0,
      won: 0, lost: 0, open: 0, no_bid: 0, submitted: 0, on_hold: 0 };
    const warnings: string[] = [];
    const unmatchedEstimators: string[] = [];

    const txn = sqlite.transaction(() => {
      for (const row of rows) {
        const jobName = String(row["Job Name"] ?? "").trim();
        if (!jobName) { stats.skipped++; continue; }

        const status = mapStatus(row);
        const stage = mapStage(row["Stage"]);
        const systemType = String(row["System Type"] ?? "").trim() || null;
        const estName = String(row["Estimator"] ?? "").trim();
        const estimatorId = estName ? (estimatorMap[estName] ?? null) : null;
        if (estName && !estimatorId && !unmatchedEstimators.includes(estName)) {
          unmatchedEstimators.push(estName);
        }

        const bidDate = parseDate(row["Bid Date"]);
        const bidTime = parseTime(row["Bid Time"]);
        const dwgs = String(row["Dwgs/Specs"] ?? "").trim().toUpperCase() === "X" ? 1 : 0;
        const preBid = String(row["Pre-Bid Meeting"] ?? "").trim() || null;
        const addenda = Number(row["Adden."]) || 0;
        const projStart = parseDate(row["Project Start Date"]);
        const projEnd = parseDate(row["Project End Date "] ?? row["Project End Date"]);
        const notes = String(row["Notes"] ?? "").trim() || null;
        const followUp = parseDate(row["Last Follow up Date"]);
        const bidValue = parseBidValue(row["Final Bid Value"]);
        const collabLetter = row["Send Collaboration Opportunity Letter"] ? 1 : 0;
        const sentDwgsToGc = ["yes", "y"].includes(
          String(row["Sent Dwgs. To Vendors "] ?? row["Sent Dwgs. To Vendors"] ?? "").trim().toLowerCase()
        ) ? 1 : 0;

        const info = insertOpp.run(
          companyId, jobName, systemType, status, stage, estimatorId,
          bidDate, bidTime, dwgs, preBid, addenda, projStart, projEnd,
          notes, followUp
        );
        const oppId = Number(info.lastInsertRowid);
        stats.opportunities++;
        (stats as any)[status] = ((stats as any)[status] || 0) + 1;

        // GC bids
        const rawGc = String(row["General Contractors"] ?? "").trim();
        if (rawGc) {
          const parts = splitGcField(rawGc);
          for (let i = 0; i < parts.length; i++) {
            const gcName = normalizeGcName(parts[i]);
            if (!gcName || !gcIdMap[gcName]) continue;
            const contact = extractContact(parts[i]);
            const email = extractEmail(parts[i]);
            const phone = extractPhone(parts[i]);
            const isPrimary = i === 0 ? 1 : 0;

            let outcome = "pending";
            if (status === "won" && isPrimary) outcome = "won";
            else if (status === "lost") outcome = "lost";
            else if (status === "no_bid") outcome = "no_bid";

            insertGcBid.run(
              companyId, oppId, gcIdMap[gcName],
              contact, email, phone,
              isPrimary ? bidValue : null,
              isPrimary, isPrimary ? collabLetter : 0,
              isPrimary ? sentDwgsToGc : 0, outcome
            );
            stats.gcBids++;
          }
        }

        // Supplier checkboxes
        for (const supName of parseSuppliers(row["Vendors"])) {
          if (supIdMap[supName]) {
            insertOppSup.run(companyId, oppId, supIdMap[supName]);
            stats.supplierLinks++;
          }
        }
      }
    });

    txn();

    return c.json({
      success: true,
      stats: {
        ...stats,
        gcCompanies: Object.keys(gcIdMap).length,
        suppliers: Object.keys(supIdMap).length,
      },
      unmatchedEstimators,
      warnings,
    });
  } catch (err: any) {
    return c.json({ error: err.message, stack: err.stack }, 500);
  }
});

// GET status — check current opportunity counts
importOpportunities.get("/status", requireRole("admin"), async (c) => {
  const companyId = getCompanyId(c);
  const oppCount = sqlite.query("SELECT COUNT(*) as c FROM opportunities WHERE company_id = ?").get(companyId) as any;
  const gcCount = sqlite.query("SELECT COUNT(*) as c FROM gc_companies WHERE company_id = ?").get(companyId) as any;
  const supCount = sqlite.query("SELECT COUNT(*) as c FROM suppliers WHERE company_id = ?").get(companyId) as any;
  const gcBidCount = sqlite.query("SELECT COUNT(*) as c FROM opportunity_gcs WHERE company_id = ?").get(companyId) as any;
  const supLinkCount = sqlite.query("SELECT COUNT(*) as c FROM opportunity_suppliers WHERE company_id = ?").get(companyId) as any;
  return c.json({
    opportunities: oppCount?.c ?? 0,
    gcCompanies: gcCount?.c ?? 0,
    suppliers: supCount?.c ?? 0,
    gcBids: gcBidCount?.c ?? 0,
    supplierLinks: supLinkCount?.c ?? 0,
  });
});
