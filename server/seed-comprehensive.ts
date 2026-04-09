import { Hono } from "hono";
import { sqlite } from "./db.js";
import { requireAuth, requireRole } from "./auth.js";
import { getCompanyId } from "./tenant.js";

/**
 * Comprehensive seed endpoint — fills in ALL remaining tables with realistic data.
 * POST /api/seed/comprehensive — super_admin only, idempotent (clears & re-seeds).
 *
 * Covers: GC companies, suppliers, opportunities, daily reports, toolbox talks,
 * change orders, action items, certifications, subcontracts, employee notes,
 * job costs, and scheduled moves.
 *
 * Prerequisites: core seed.ts must have run (companies, users, employees, jobs,
 * classifications, jurisdictions exist).
 */

const seedComprehensiveRoutes = new Hono();
seedComprehensiveRoutes.use("/*", requireAuth);

seedComprehensiveRoutes.post("/comprehensive", requireRole("super_admin"), async (c) => {
  const companyId = getCompanyId(c);

  // ── Helpers ──────────────────────────────────────────────────
  function randomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function randomDate(daysBack: number, daysForward = 0): string {
    const d = new Date();
    const offset = randomInt(-daysBack, daysForward);
    d.setDate(d.getDate() + offset);
    return d.toISOString().split("T")[0];
  }
  function dateStr(daysOffset: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return d.toISOString().split("T")[0];
  }

  // ── Load existing data ───────────────────────────────────────
  const employees = sqlite.query(
    `SELECT id, first_name, last_name, classification_id FROM employees WHERE company_id = ? AND status = 'active'`
  ).all(companyId) as any[];

  const allEmployees = sqlite.query(
    `SELECT id, first_name, last_name FROM employees WHERE company_id = ?`
  ).all(companyId) as any[];

  const jobs = sqlite.query(
    `SELECT id, job_number, name, address, jurisdiction_id, status FROM jobs WHERE company_id = ?`
  ).all(companyId) as any[];

  const activeJobs = jobs.filter((j: any) => j.status === "active");

  const classifications = sqlite.query(
    `SELECT id, name FROM classifications WHERE company_id = ?`
  ).all(companyId) as any[];

  const users_ = sqlite.query(
    `SELECT id, display_name, role FROM users WHERE company_id = ?`
  ).all(companyId) as any[];

  if (employees.length === 0) return c.json({ error: "No employees — run core seed first" }, 400);
  if (jobs.length === 0) return c.json({ error: "No jobs — run core seed first" }, 400);

  const counts: Record<string, number> = {};

  // ══════════════════════════════════════════════════════════════
  // 1. GC COMPANIES
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM gc_companies WHERE company_id = ?`, [companyId]);

  const gcData = [
    { name: "Nunn Construction", phone: "(719) 545-0712", website: "https://nunnconstruction.com", notes: "Long-term partner, majority of commercial bids" },
    { name: "HW Houston", phone: "(719) 564-1212", website: "https://hwhoustonconstruction.com", notes: "Good relationship, fair on change orders" },
    { name: "B&M Construction", phone: "(719) 543-0805", website: null, notes: "Barbara Myrick — responsive, pays on time" },
    { name: "GH Phipps", phone: "(719) 630-7000", website: "https://ghphipps.com", notes: "Large commercial GC, Denver/COS based" },
    { name: "Hensel Phelps", phone: "(970) 352-6565", website: "https://henselphelps.com", notes: "Federal/institutional work, strict safety reqs" },
    { name: "iicon Construction", phone: "(719) 596-6789", website: null, notes: "COS based, K-12 school projects" },
    { name: "IS West Inc.", phone: "(719) 543-1850", website: null, notes: "Local Pueblo GC, small-medium commercial" },
    { name: "Whitlock", phone: "(719) 546-1111", website: null, notes: "HE Whitlock, residential & light commercial" },
    { name: "FCI Constructors", phone: "(970) 221-4195", website: "https://fciol.com", notes: "Large CM/GC, hospital & university work" },
    { name: "A&P Construction", phone: "(303) 778-1000", website: "https://a-p.com", notes: "Adolph & Peterson, school district work" },
    { name: "Caisson Co.", phone: "(719) 543-4499", website: null, notes: "Pueblo local, good for smaller projects" },
    { name: "ATS Rocky Mountain", phone: "(719) 542-8000", website: null, notes: "Fire alarm / security overlap" },
  ];

  for (let i = 0; i < gcData.length; i++) {
    const gc = gcData[i];
    sqlite.run(
      `INSERT INTO gc_companies (company_id, name, phone, website, notes, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [companyId, gc.name, gc.phone, gc.website, gc.notes, i + 1]
    );
  }
  counts.gcCompanies = gcData.length;

  // ══════════════════════════════════════════════════════════════
  // 2. SUPPLIERS
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM suppliers WHERE company_id = ?`, [companyId]);

  const supplierData = [
    { name: "Graybar Electric", phone: "(719) 544-7471", website: "https://graybar.com", notes: "Primary supply house — Pueblo branch" },
    { name: "Werner Electric", phone: "(719) 545-0005", website: "https://wernerelectric.com", notes: "Secondary supply, good on switchgear pricing" },
    { name: "Wesco International", phone: "(719) 564-4900", website: "https://wesco.com", notes: "Industrial supply, wire & cable" },
    { name: "Sonepar / Springfield", phone: "(719) 542-3080", website: null, notes: "Springfield Electric, local branch" },
    { name: "HD Supply", phone: "(719) 566-0100", website: "https://hdsupply.com", notes: "Good for MRO and maintenance supplies" },
    { name: "Platt Electric", phone: "(719) 543-1234", website: "https://platt.com", notes: "Rexel group, good lighting pricing" },
    { name: "Consolidated Electrical", phone: "(719) 561-2200", website: "https://ced.com", notes: "CED — fast delivery, competitive pricing" },
    { name: "Border States Electric", phone: "(719) 553-7700", website: "https://borderstates.com", notes: "Good for large project material packages" },
  ];

  for (let i = 0; i < supplierData.length; i++) {
    const s = supplierData[i];
    sqlite.run(
      `INSERT INTO suppliers (company_id, name, phone, website, notes, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [companyId, s.name, s.phone, s.website, s.notes, i + 1]
    );
  }
  counts.suppliers = supplierData.length;

  // ══════════════════════════════════════════════════════════════
  // 3. OPPORTUNITIES (Bid Pipeline)
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM opportunity_suppliers WHERE company_id = ?`, [companyId]);
  sqlite.run(`DELETE FROM opportunity_gcs WHERE company_id = ?`, [companyId]);
  sqlite.run(`DELETE FROM opportunities WHERE company_id = ?`, [companyId]);

  const gcIds = (sqlite.query(`SELECT id FROM gc_companies WHERE company_id = ?`).all(companyId) as any[]).map((r: any) => r.id);
  const supplierIds = (sqlite.query(`SELECT id FROM suppliers WHERE company_id = ?`).all(companyId) as any[]).map((r: any) => r.id);
  const estimatorIds = employees.slice(0, Math.min(3, employees.length)).map((e: any) => e.id);

  const systemTypes = ["Power Distribution", "Lighting", "Fire Alarm", "Low Voltage", "Solar PV", "Full Electrical", "Service Upgrade", "Generator", "EV Charging"];
  const oppStatuses = ["open", "submitted", "won", "lost", "no_bid", "on_hold"];
  const stages = ["Estimating", "Drawings Review", "Bid Prep", "Submitted", "Awarded", "Closed"];

  const oppNames = [
    "Pueblo Convention Center Renovation", "CMHIP Building 142 Remodel", "Parkview ER Expansion",
    "CSU Pueblo Science Building", "District 60 Central HS HVAC Electrical", "Pueblo Mall Anchor Tenant Buildout",
    "Midtown Shopping Center", "Pueblo Chemical Depot Demolition Support", "St. Mary-Corwin MRI Suite",
    "CDOT Region 2 Maintenance Facility", "Evraz Steel Mill Motor Control Upgrade", "Pueblo West Fire Station #2",
    "Bessemer Academy Renovation", "Minnequa Works Office Conversion", "Canon City Federal Prison Camp",
    "Fremont RE-1 New Elementary", "Fountain Creek Wastewater Treatment", "Pueblo Airport Terminal Expansion",
    "Heritage Townhomes Phase III", "Rocky Ford School District Gym",
  ];

  let oppCount = 0;
  for (const oppName of oppNames) {
    const status = randomItem(oppStatuses);
    const stage = status === "won" ? "Awarded" : status === "lost" ? "Closed" : status === "no_bid" ? "Closed" : randomItem(stages);
    const bidDate = randomDate(90, 60);

    const oppId = sqlite.run(
      `INSERT INTO opportunities (company_id, name, system_type, status, stage, estimator_id, bid_date, bid_time,
       dwgs_specs_received, pre_bid_meeting, addenda_count, project_start_date, project_end_date,
       scope_notes, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        companyId, oppName, randomItem(systemTypes), status, stage,
        randomItem(estimatorIds), bidDate, randomItem(["10:00", "14:00", "09:00", "11:00", null]),
        Math.random() < 0.7 ? 1 : 0,
        Math.random() < 0.4 ? 1 : 0,
        randomInt(0, 3),
        dateStr(randomInt(30, 180)),
        dateStr(randomInt(180, 540)),
        `${randomItem(systemTypes)} scope for ${oppName}`,
        Math.random() < 0.3 ? "Competitive bid, tight timeline" : null,
      ]
    ).lastInsertRowid;

    // Add 1-3 GCs per opportunity
    const numGcs = randomInt(1, 3);
    const usedGcs = new Set<number>();
    for (let g = 0; g < numGcs; g++) {
      let gcId: number;
      do { gcId = randomItem(gcIds); } while (usedGcs.has(gcId));
      usedGcs.add(gcId);

      const bidValue = status === "no_bid" ? null : randomInt(50000, 2500000);
      const outcome = status === "won" ? (g === 0 ? "won" : "lost") : status === "lost" ? "lost" : status === "no_bid" ? "no_bid" : "pending";
      sqlite.run(
        `INSERT INTO opportunity_gcs (company_id, opportunity_id, gc_company_id, contact_name, bid_value, is_primary, outcome, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [companyId, oppId, gcId, randomItem(["John", "Mike", "Sarah", "Tom", "Lisa"]) + " " + randomItem(["Smith", "Garcia", "Johnson", "Martinez"]),
         bidValue, g === 0 ? 1 : 0, outcome]
      );
    }

    // Add 1-3 suppliers per opportunity
    const numSuppliers = randomInt(1, 3);
    const usedSuppliers = new Set<number>();
    for (let s = 0; s < numSuppliers; s++) {
      let suppId: number;
      do { suppId = randomItem(supplierIds); } while (usedSuppliers.has(suppId));
      usedSuppliers.add(suppId);
      sqlite.run(
        `INSERT INTO opportunity_suppliers (company_id, opportunity_id, supplier_id, sent_drawings)
         VALUES (?, ?, ?, ?)`,
        [companyId, oppId, suppId, Math.random() < 0.6 ? 1 : 0]
      );
    }

    oppCount++;
  }
  counts.opportunities = oppCount;

  // ══════════════════════════════════════════════════════════════
  // 4. DAILY REPORTS
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM daily_reports WHERE company_id = ?`, [companyId]);

  const weatherConditions = ["Clear", "Partly Cloudy", "Overcast", "Rain", "Snow", "Windy", "Hot"];
  const workDescriptions = [
    "Ran 3/4\" and 1\" EMT conduit through ceiling grid on 2nd floor east wing.",
    "Pulled #10 THHN through existing conduit runs, north corridor.",
    "Installed 200A panel board PB-2A in electrical room 104.",
    "Terminated receptacles and switches in offices 201-208.",
    "Mounted 2x4 LED troffers in main hallway and lobby.",
    "Rough-in for restroom circuits — home runs pulled to panel.",
    "Installed disconnect switches at rooftop AHU units.",
    "Fire alarm device installation and wiring, floors 1-2.",
    "Low voltage cabling (Cat6A) for conference rooms A and B.",
    "Switchgear terminations — main bus connections and feeder landing.",
    "Generator pad prep and conduit stub-ups for backup power.",
    "Emergency lighting circuit installation and battery unit mounting.",
    "Underground PVC conduit installation from transformer pad to building.",
    "Motor control center bucket wiring and VFD installation.",
    "Temporary power distribution for construction phase 2.",
  ];
  const delayTypes = ["weather", "material", "gc_schedule", "inspection", "design", null];

  let drCount = 0;
  for (let dayOffset = 30; dayOffset >= 1; dayOffset--) {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    if (d.getDay() === 0 || d.getDay() === 6) continue; // skip weekends

    const reportDate = d.toISOString().split("T")[0];

    // 2-4 active jobs get daily reports
    const numReports = Math.min(activeJobs.length, randomInt(2, 4));
    const reportJobs = [...activeJobs].sort(() => Math.random() - 0.5).slice(0, numReports);

    for (const job of reportJobs) {
      const submitter = randomItem(employees);
      const reviewer = Math.random() < 0.6 ? randomItem(users_) : null;
      const status = reviewer ? "reviewed" : (Math.random() < 0.7 ? "submitted" : "draft");
      const temp = randomInt(25, 95);
      const delay = Math.random() < 0.2 ? randomItem(delayTypes.filter(Boolean)) : null;

      sqlite.run(
        `INSERT OR IGNORE INTO daily_reports (company_id, job_id, report_date, submitted_by, status,
         weather_condition, weather_temp, weather_impact, work_performed, areas_worked,
         delay_notes, delay_type, visitors, safety_notes, material_notes,
         reviewed_by, reviewed_at, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          companyId, job.id, reportDate, submitter.id, status,
          randomItem(weatherConditions), temp,
          temp < 32 ? "Cold weather protocol in effect" : temp > 90 ? "Heat advisory — extra water breaks" : null,
          randomItem(workDescriptions) + "\n" + randomItem(workDescriptions),
          randomItem(["1st Floor", "2nd Floor", "Basement", "Electrical Room", "Rooftop", "East Wing", "West Wing"]),
          delay ? `${delay} — ${randomItem(["2 hour delay", "Lost half day", "Waiting on inspection", "Material not delivered"])}` : null,
          delay,
          Math.random() < 0.15 ? randomItem(["Building inspector", "Fire marshal", "Owner rep", "Architect"]) : null,
          Math.random() < 0.3 ? randomItem(["Toolbox talk completed", "Near-miss reported and addressed", "New crew member safety orientation", "All PPE verified"]) : null,
          Math.random() < 0.25 ? randomItem(["Wire delivery scheduled for tomorrow", "Waiting on panel board — 2 week lead time", "Light fixtures received, staging in storage", "Conduit fittings running low"]) : null,
          reviewer?.id || null,
          reviewer ? d.toISOString() : null,
          Math.random() < 0.2 ? "Progressing on schedule" : null,
        ]
      );
      drCount++;
    }
  }
  counts.dailyReports = drCount;

  // ══════════════════════════════════════════════════════════════
  // 5. TOOLBOX TALKS
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM toolbox_talk_attendees WHERE talk_id IN (SELECT id FROM toolbox_talks WHERE company_id = ?)`, [companyId]);
  sqlite.run(`DELETE FROM toolbox_talks WHERE company_id = ?`, [companyId]);

  const tbtTopics = [
    "Electrical Safety — Arc Flash Awareness", "Fall Protection on Ladders and Scaffolds",
    "Lockout/Tagout (LOTO) Procedures", "Personal Protective Equipment (PPE) Review",
    "Heat Illness Prevention", "Cold Weather Safety",
    "Trench & Excavation Safety", "Fire Extinguisher Use & Location",
    "Silica Dust Exposure Prevention", "Hand & Power Tool Safety",
    "Housekeeping & Slip/Trip/Fall Prevention", "Confined Space Entry Awareness",
    "Back Injury Prevention — Proper Lifting", "Scaffold Safety & Inspection",
    "Electrical Grounding & Bonding Safety", "Emergency Action Plan Review",
    "Hazard Communication (HazCom / GHS)", "Portable Generator Safety",
    "Vehicle & Equipment Safety", "Distracted Driving Awareness",
  ];

  let tbtCount = 0;
  for (let weekOffset = 8; weekOffset >= 0; weekOffset--) {
    const d = new Date();
    d.setDate(d.getDate() - (weekOffset * 7) - d.getDay() + 1); // Monday of each week
    const talkDate = d.toISOString().split("T")[0];

    // 1-2 talks per week across different jobs
    const numTalks = randomInt(1, 2);
    for (let t = 0; t < numTalks; t++) {
      const job = activeJobs.length > 0 ? randomItem(activeJobs) : null;
      const presenter = randomItem(employees);
      const topic = tbtTopics[tbtCount % tbtTopics.length];
      const status = weekOffset === 0 ? randomItem(["scheduled", "completed"]) : "completed";

      const talkId = sqlite.run(
        `INSERT INTO toolbox_talks (company_id, job_id, scheduled_date, topic, generated_content,
         presented_by, status, duration, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          companyId, job?.id || null, talkDate, topic,
          `## ${topic}\n\n### Key Points\n- Always follow proper procedures\n- Report hazards immediately\n- Know your emergency contacts\n\n### Discussion Questions\n1. Has anyone experienced this hazard on site?\n2. What additional precautions should we take?`,
          presenter.id, status, randomInt(10, 20),
          Math.random() < 0.3 ? "Good crew participation" : null,
        ]
      ).lastInsertRowid;

      // Add 3-8 attendees per talk
      if (status === "completed") {
        const numAttendees = Math.min(employees.length, randomInt(3, 8));
        const attendees = [...employees].sort(() => Math.random() - 0.5).slice(0, numAttendees);
        for (const att of attendees) {
          const signedAt = new Date(d);
          signedAt.setHours(6 + randomInt(0, 1), randomInt(0, 59));
          sqlite.run(
            `INSERT INTO toolbox_talk_attendees (talk_id, employee_id, signed_at) VALUES (?, ?, ?)`,
            [talkId, att.id, signedAt.toISOString()]
          );
        }
      }
      tbtCount++;
    }
  }
  counts.toolboxTalks = tbtCount;

  // ══════════════════════════════════════════════════════════════
  // 6. CHANGE ORDER REQUESTS
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM change_order_photos WHERE company_id = ?`, [companyId]);
  sqlite.run(`DELETE FROM change_order_requests WHERE company_id = ?`, [companyId]);

  const coTitles = [
    "Additional receptacles — owner request", "Relocate panel per architect RFI",
    "Add emergency lighting to stairwells", "Upgrade service from 200A to 400A",
    "Fire alarm devices — revised layout", "Add data drops to conference room",
    "Exterior lighting upgrade — LED conversion", "Generator connection for IT room",
    "Underground conduit reroute — conflict with plumbing", "Add EV charger circuits to parking garage",
    "Security camera power feeds — 12 locations", "Kitchen equipment circuit additions",
    "Roof-mounted solar conduit pathway", "Temporary power extension — Phase 2 area",
  ];
  const coStatuses = ["draft", "submitted", "assigned", "estimated", "approved", "rejected"];
  const coPriorities = ["low", "normal", "high", "urgent"];

  let coCount = 0;
  for (const title of coTitles) {
    const job = randomItem(activeJobs.length > 0 ? activeJobs : jobs);
    const status = randomItem(coStatuses);
    const requestor = randomItem(employees);
    const assignee = status === "draft" ? null : randomItem(employees);

    sqlite.run(
      `INSERT INTO change_order_requests (company_id, job_id, request_number, title, description,
       requested_by, assigned_to, status, priority, estimated_cost, estimated_hours,
       estimate_notes, location_desc, due_date, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        companyId, job.id, `CO-${String(coCount + 1).padStart(3, "0")}`, title,
        `Field request: ${title}. Per ${randomItem(["architect", "owner", "GC", "inspector", "engineer"])} direction.`,
        requestor.id, assignee?.id || null, status, randomItem(coPriorities),
        status === "estimated" || status === "approved" ? randomInt(2000, 85000) : null,
        status === "estimated" || status === "approved" ? randomInt(8, 200) : null,
        status === "estimated" ? "Includes material and labor" : null,
        randomItem(["1st Floor", "2nd Floor", "Basement", "Electrical Room", "Exterior", "Rooftop", "Parking Garage"]),
        dateStr(randomInt(7, 60)),
        Math.random() < 0.2 ? "Waiting on architect response" : null,
      ]
    );
    coCount++;
  }
  counts.changeOrders = coCount;

  // ══════════════════════════════════════════════════════════════
  // 7. ACTION ITEMS (Project Meeting Items)
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM action_items WHERE company_id = ?`, [companyId]);

  const aiDescriptions = [
    "Submit O&M manuals to GC", "Order panel board — 6 week lead time",
    "Schedule rough-in inspection", "Get updated drawings from architect",
    "Submit RFI on grounding detail", "Coordinate with plumber on ceiling space",
    "Confirm light fixture selections with owner", "Review as-built drawings — mark up changes",
    "Send COI renewal to GC", "Follow up on permit status",
    "Verify underground conduit routing", "Order fire alarm panel",
    "Schedule pre-pour inspection", "Coordinate meter installation with XCEL",
    "Review change order pricing with PM", "Set up temp power for Phase 2",
    "Update labor projections for next month", "Confirm transformer delivery date",
    "Get approval on VFD submittals", "Schedule final walkthrough with inspector",
    "Order emergency exit signs", "Submit warranty documentation",
    "Review punch list items", "Coordinate rooftop equipment setting",
    "Verify conduit fill calculations", "Order special-order fittings",
    "Schedule fire alarm acceptance test", "Get close-out documents to GC",
    "Review final billing with accounting", "Submit lien waiver",
  ];
  const aiStatuses = ["open", "done"];
  const aiPriorities = ["low", "normal", "high", "urgent"];

  let aiCount = 0;
  for (const job of (activeJobs.length > 0 ? activeJobs : jobs).slice(0, 6)) {
    const numItems = randomInt(3, 8);
    for (let i = 0; i < numItems; i++) {
      const desc = aiDescriptions[(aiCount + i) % aiDescriptions.length];
      const status = Math.random() < 0.4 ? "done" : "open";
      const assignee = randomItem(employees);

      sqlite.run(
        `INSERT INTO action_items (company_id, job_id, description, assigned_to_id, assigned_to,
         priority, status, due_date, notes, sort_order, created_by,
         completed_at, completed_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          companyId, job.id, desc, assignee.id, `${assignee.first_name} ${assignee.last_name}`,
          randomItem(aiPriorities), status, dateStr(randomInt(-7, 30)),
          Math.random() < 0.2 ? "See email thread for details" : null,
          i + 1, randomItem(users_)?.id || null,
          status === "done" ? new Date().toISOString() : null,
          status === "done" ? randomItem(users_)?.id || null : null,
        ]
      );
      aiCount++;
    }
  }
  counts.actionItems = aiCount;

  // ══════════════════════════════════════════════════════════════
  // 8. CERTIFICATIONS
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM certifications WHERE employee_id IN (SELECT id FROM employees WHERE company_id = ?)`, [companyId]);

  const certTypes = [
    { name: "OSHA 10-Hour Construction", body: "OSHA" },
    { name: "OSHA 30-Hour Construction", body: "OSHA" },
    { name: "CPR / First Aid", body: "American Red Cross" },
    { name: "NFPA 70E Arc Flash Safety", body: "NFPA" },
    { name: "Aerial Lift / Scissor Lift", body: "OSHA" },
    { name: "Forklift Operator", body: "OSHA" },
    { name: "Confined Space Entry", body: "OSHA" },
    { name: "Fire Alarm — NICET Level I", body: "NICET" },
    { name: "Fire Alarm — NICET Level II", body: "NICET" },
    { name: "Colorado Journeyman Electrician", body: "State of Colorado" },
    { name: "Colorado Master Electrician", body: "State of Colorado" },
    { name: "Trenching & Excavation Competent Person", body: "OSHA" },
  ];

  let certCount = 0;
  for (const emp of employees) {
    // Each employee gets 2-5 certs
    const numCerts = randomInt(2, 5);
    const empCerts = [...certTypes].sort(() => Math.random() - 0.5).slice(0, numCerts);
    for (const cert of empCerts) {
      const issued = randomDate(730, 0); // within last 2 years
      const issuedDate = new Date(issued);
      const expiresDate = new Date(issuedDate);
      expiresDate.setFullYear(expiresDate.getFullYear() + randomInt(1, 3));

      sqlite.run(
        `INSERT INTO certifications (employee_id, name, issuing_body, date_issued, date_expires) VALUES (?, ?, ?, ?, ?)`,
        [emp.id, cert.name, cert.body, issued, expiresDate.toISOString().split("T")[0]]
      );
      certCount++;
    }
  }
  counts.certifications = certCount;

  // ══════════════════════════════════════════════════════════════
  // 9. SUBCONTRACTS
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM subcontracts WHERE job_id IN (SELECT id FROM jobs WHERE company_id = ?)`, [companyId]);

  const subScopes = [
    { company: "Mountain View Fire Protection", scope: "Fire alarm device installation and wiring" },
    { company: "Southern Colorado Security", scope: "Access control and security camera rough-in" },
    { company: "Peak Telecom Services", scope: "Fiber optic backbone installation" },
    { company: "Colorado Solar Installers", scope: "Rooftop solar panel mounting and DC wiring" },
    { company: "Rocky Mountain Low Voltage", scope: "Structured cabling — Cat6A and fiber" },
    { company: "Pueblo Trenching LLC", scope: "Underground conduit excavation and backfill" },
  ];
  const subStatuses = ["active", "completed", "cancelled"];

  let subCount = 0;
  for (const job of activeJobs.slice(0, Math.min(5, activeJobs.length))) {
    const numSubs = randomInt(1, 3);
    const jobSubs = [...subScopes].sort(() => Math.random() - 0.5).slice(0, numSubs);
    for (const sub of jobSubs) {
      const original = randomInt(15000, 250000);
      const status = randomItem(subStatuses);

      sqlite.run(
        `INSERT INTO subcontracts (job_id, company_name, contact_name, contact_phone, scope,
         original_amount, current_amount, cost_to_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          job.id, sub.company,
          randomItem(["Juan", "Mike", "Chris", "Dave", "Maria"]) + " " + randomItem(["Rodriguez", "Thompson", "Park", "Wilson"]),
          `(719) ${randomInt(500, 599)}-${String(randomInt(1000, 9999))}`,
          sub.scope, original, original + randomInt(-5000, 20000),
          status === "completed" ? original + randomInt(-2000, 5000) : randomInt(0, original),
          status,
        ]
      );
      subCount++;
    }
  }
  counts.subcontracts = subCount;

  // ══════════════════════════════════════════════════════════════
  // 10. EMPLOYEE NOTES
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM employee_notes WHERE company_id = ?`, [companyId]);

  const noteCategories = ["general", "disciplinary", "contact"];
  const noteContents: Record<string, string[]> = {
    general: [
      "Completed foreman training program", "Transferred from Local 113", "Spanish-speaking — useful for bilingual crews",
      "Prefers early shift start", "Has CDL — can drive crew truck", "Excellent conduit bending skills",
      "Interested in PM track", "Good mentor for apprentices",
    ],
    disciplinary: [
      "Verbal warning — late 3 times this month", "Written warning — PPE violation on 3/15",
      "Counseling — phone use during work hours",
    ],
    contact: [
      "Alternate phone: spouse (719) 555-0199", "Emergency contact updated — see HR file",
    ],
  };

  let noteCount = 0;
  const someEmployees = employees.slice(0, Math.min(10, employees.length));
  for (const emp of someEmployees) {
    const numNotes = randomInt(1, 3);
    for (let n = 0; n < numNotes; n++) {
      const category = randomItem(noteCategories);
      const content = randomItem(noteContents[category]);
      sqlite.run(
        `INSERT INTO employee_notes (company_id, employee_id, category, content, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [companyId, emp.id, category, content, randomItem(users_)?.display_name || "System"]
      );
      noteCount++;
    }
  }
  counts.employeeNotes = noteCount;

  // ══════════════════════════════════════════════════════════════
  // 11. JOB COSTS (actual cost tracking entries)
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM job_costs WHERE job_id IN (SELECT id FROM jobs WHERE company_id = ?)`, [companyId]);

  const costCategories = ["labor", "material", "equipment", "general", "subcontract"];
  const costCodes: Record<string, string[]> = {
    labor: ["100-10 Rough-In", "100-20 Trim", "100-30 Testing", "100-40 Temp Power", "100-50 Fire Alarm"],
    material: ["200-10 Wire & Cable", "200-20 Conduit & Fittings", "200-30 Panels & Breakers", "200-40 Fixtures", "200-50 Devices"],
    equipment: ["300-10 Lift Rental", "300-20 Tools", "300-30 Generator"],
    general: ["400-10 Permits", "400-20 Insurance", "400-30 Bonds"],
    subcontract: ["500-10 Fire Alarm Sub", "500-20 Low Voltage Sub", "500-30 Trenching Sub"],
  };

  let costCount = 0;
  for (const job of activeJobs.slice(0, Math.min(6, activeJobs.length))) {
    // 5-15 cost entries per job across categories
    const numCosts = randomInt(5, 15);
    for (let i = 0; i < numCosts; i++) {
      const cat = randomItem(costCategories);
      const codes = costCodes[cat];
      sqlite.run(
        `INSERT INTO job_costs (job_id, category, cost_code, description, amount, date_recorded, week_ending, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          job.id, cat, randomItem(codes),
          `${cat.charAt(0).toUpperCase() + cat.slice(1)} cost — ${randomItem(["week 1", "week 2", "week 3", "week 4"])}`,
          Math.round(randomInt(500, 25000) * 100) / 100,
          randomDate(30, 0),
          randomDate(30, 0),
          Math.random() < 0.2 ? "Verified against PO" : null,
        ]
      );
      costCount++;
    }
  }
  counts.jobCosts = costCount;

  // ══════════════════════════════════════════════════════════════
  // 12. SCHEDULED MOVES
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM scheduled_moves WHERE company_id = ?`, [companyId]);

  let moveCount = 0;
  // Create a few future crew moves
  for (let i = 0; i < Math.min(5, employees.length); i++) {
    const emp = employees[i];
    const toJob = Math.random() < 0.2 ? null : randomItem(activeJobs.length > 0 ? activeJobs : jobs);

    sqlite.run(
      `INSERT INTO scheduled_moves (company_id, employee_id, to_job_id, effective_date, applied, notes, created_at)
       VALUES (?, ?, ?, ?, 0, ?, datetime('now'))`,
      [
        companyId, emp.id, toJob?.id || null,
        dateStr(randomInt(1, 14)),
        toJob ? `Moving to ${toJob.name}` : "Returning to bench",
      ]
    );
    moveCount++;
  }
  counts.scheduledMoves = moveCount;

  // ══════════════════════════════════════════════════════════════
  // 13. ASSETS (Tools, Vehicles, Equipment)
  // ══════════════════════════════════════════════════════════════
  sqlite.run(`DELETE FROM assets WHERE company_id = ?`, [companyId]);

  // Find Trevor Terra specifically for guaranteed assignment
  const trevorTerra = employees.find(
    (e: any) => e.first_name === "Trevor" && e.last_name === "Terra"
  );

  // Pick a few other random employees for assignments
  const otherEmps = employees.filter(
    (e: any) => !(e.first_name === "Trevor" && e.last_name === "Terra")
  );

  function randomEmp() {
    return otherEmps.length > 0 ? randomItem(otherEmps) : employees[0];
  }

  const toolData = [
    // ── Vehicles ──
    { type: "vehicle", category: "truck", description: "2023 Ford F-250 Super Duty", manufacturer: "Ford", model: "F-250 XLT 4x4", serialNumber: "1FT7W2B66PEC12345", identifier: "V-001", status: "assigned", condition: "good", cost: 52000, assignTo: "trevor" },
    { type: "vehicle", category: "truck", description: "2022 Ford F-150 Lightning", manufacturer: "Ford", model: "F-150 Lightning Pro", serialNumber: "1FTVW1EL4NWA98765", identifier: "V-002", status: "assigned", condition: "good", cost: 48500, assignTo: "random" },
    { type: "vehicle", category: "truck", description: "2024 Ram 2500 Tradesman", manufacturer: "Ram", model: "2500 Tradesman Crew Cab", serialNumber: "3C6UR5CL8RG234567", identifier: "V-003", status: "assigned", condition: "new", cost: 54000, assignTo: "random" },
    { type: "vehicle", category: "van", description: "2023 Ford Transit 250", manufacturer: "Ford", model: "Transit 250 Cargo Van", serialNumber: "1FTBW9CK5PKA45678", identifier: "V-004", status: "assigned", condition: "good", cost: 42000, assignTo: "random" },
    { type: "vehicle", category: "truck", description: "2021 Chevy Silverado 2500HD", manufacturer: "Chevrolet", model: "Silverado 2500HD Work Truck", serialNumber: "1GC4YPEY3MF678901", identifier: "V-005", status: "maintenance", condition: "fair", cost: 46000, assignTo: null },
    { type: "vehicle", category: "trailer", description: "2022 Big Tex 14ET-20 Equipment Trailer", manufacturer: "Big Tex", model: "14ET-20", serialNumber: "16VCX2024N2345678", identifier: "V-006", status: "available", condition: "good", cost: 8500, assignTo: null },

    // ── Power Tools — Trevor's kit ──
    { type: "tool", category: "power_tool", description: 'Milwaukee M18 FUEL 1/2" Hammer Drill', manufacturer: "Milwaukee", model: "2904-20", serialNumber: "J43AD190300456", identifier: "T-001", status: "assigned", condition: "good", cost: 199, assignTo: "trevor" },
    { type: "tool", category: "power_tool", description: 'Milwaukee M18 FUEL 1/4" Hex Impact Driver', manufacturer: "Milwaukee", model: "2953-20", serialNumber: "J43BF210400789", identifier: "T-002", status: "assigned", condition: "good", cost: 179, assignTo: "trevor" },
    { type: "tool", category: "power_tool", description: "Milwaukee M18 FUEL SAWZALL Reciprocating Saw", manufacturer: "Milwaukee", model: "2821-20", serialNumber: "J44CD310500123", identifier: "T-003", status: "assigned", condition: "good", cost: 219, assignTo: "trevor" },
    { type: "tool", category: "power_tool", description: 'Milwaukee M18 FUEL 7-1/4" Circular Saw', manufacturer: "Milwaukee", model: "2732-20", serialNumber: "J44EF410600234", identifier: "T-004", status: "assigned", condition: "good", cost: 249, assignTo: "trevor" },
    { type: "tool", category: "power_tool", description: 'Milwaukee M12 FUEL 3" Compact Cut Off Tool', manufacturer: "Milwaukee", model: "2522-20", serialNumber: "K21GH510700345", identifier: "T-005", status: "assigned", condition: "new", cost: 149, assignTo: "trevor" },
    { type: "tool", category: "test_equipment", description: "Fluke 376 FC True-RMS Clamp Meter", manufacturer: "Fluke", model: "376 FC", serialNumber: "48230456", identifier: "T-006", status: "assigned", condition: "good", cost: 425, assignTo: "trevor" },
    { type: "tool", category: "test_equipment", description: "Fluke 1587 FC Insulation Multimeter", manufacturer: "Fluke", model: "1587 FC", serialNumber: "51120789", identifier: "T-007", status: "assigned", condition: "good", cost: 899, assignTo: "trevor" },

    // ── Power Tools — shared / other crew ──
    { type: "tool", category: "power_tool", description: 'Milwaukee M18 FUEL 1/2" Hammer Drill', manufacturer: "Milwaukee", model: "2904-20", serialNumber: "J43AD190301122", identifier: "T-008", status: "assigned", condition: "good", cost: 199, assignTo: "random" },
    { type: "tool", category: "power_tool", description: 'Milwaukee M18 FUEL 1/4" Hex Impact Driver', manufacturer: "Milwaukee", model: "2953-20", serialNumber: "J43BF210401456", identifier: "T-009", status: "assigned", condition: "fair", cost: 179, assignTo: "random" },
    { type: "tool", category: "power_tool", description: "Milwaukee M18 FUEL SAWZALL Reciprocating Saw", manufacturer: "Milwaukee", model: "2821-20", serialNumber: "J44CD310501789", identifier: "T-010", status: "assigned", condition: "good", cost: 219, assignTo: "random" },
    { type: "tool", category: "power_tool", description: "Hilti TE 6-A22 Cordless Rotary Hammer", manufacturer: "Hilti", model: "TE 6-A22", serialNumber: "H2103456789", identifier: "T-011", status: "assigned", condition: "good", cost: 459, assignTo: "random" },
    { type: "tool", category: "power_tool", description: "Milwaukee M18 FUEL Band Saw", manufacturer: "Milwaukee", model: "2729-20", serialNumber: "J55AB610800456", identifier: "T-012", status: "available", condition: "good", cost: 329, assignTo: null },
    { type: "tool", category: "power_tool", description: 'Milwaukee M18 FUEL 4-1/2" Grinder', manufacturer: "Milwaukee", model: "2880-20", serialNumber: "J55CD710900567", identifier: "T-013", status: "available", condition: "good", cost: 189, assignTo: null },
    { type: "tool", category: "power_tool", description: "DeWalt 20V MAX XR Drywall Screw Gun", manufacturer: "DeWalt", model: "DCF620B", serialNumber: "DW2205678901", identifier: "T-014", status: "assigned", condition: "good", cost: 169, assignTo: "random" },

    // ── Test Equipment ──
    { type: "tool", category: "test_equipment", description: "Fluke 376 FC True-RMS Clamp Meter", manufacturer: "Fluke", model: "376 FC", serialNumber: "48230789", identifier: "T-015", status: "assigned", condition: "good", cost: 425, assignTo: "random" },
    { type: "tool", category: "test_equipment", description: "Megger MIT485/2 Insulation Tester", manufacturer: "Megger", model: "MIT485/2", serialNumber: "MG1904567890", identifier: "T-016", status: "available", condition: "good", cost: 1200, assignTo: null },
    { type: "tool", category: "test_equipment", description: "Ideal SureTrace Circuit Tracer", manufacturer: "Ideal", model: "61-957", serialNumber: "ID6105678901", identifier: "T-017", status: "assigned", condition: "good", cost: 289, assignTo: "random" },
    { type: "tool", category: "test_equipment", description: "Amprobe AT-6010 Advanced Wire Tracer", manufacturer: "Amprobe", model: "AT-6010", serialNumber: "AP3302345678", identifier: "T-018", status: "assigned", condition: "fair", cost: 345, assignTo: "trevor" },

    // ── Specialty / Large Equipment ──
    { type: "equipment", category: "bending", description: "Greenlee 881CT Cam Track Bender (2-1/2 to 4 in)", manufacturer: "Greenlee", model: "881CT", serialNumber: "GL881CT56789", identifier: "E-001", status: "assigned", condition: "good", cost: 8900, assignTo: "random" },
    { type: "equipment", category: "bending", description: "Greenlee 555 Classic Electric Bender", manufacturer: "Greenlee", model: "555", serialNumber: "GL555E45678", identifier: "E-002", status: "available", condition: "good", cost: 4200, assignTo: null },
    { type: "equipment", category: "pulling", description: "Greenlee 6001 Super Tugger Cable Puller", manufacturer: "Greenlee", model: "6001", serialNumber: "GL600178901", identifier: "E-003", status: "assigned", condition: "good", cost: 6500, assignTo: "random" },
    { type: "equipment", category: "lifting", description: "Genie GS-1930 Scissor Lift", manufacturer: "Genie", model: "GS-1930", serialNumber: "GS19309876543", identifier: "E-004", status: "assigned", condition: "good", cost: 14500, assignTo: null },
    { type: "equipment", category: "lifting", description: "JLG 450AJ Articulating Boom Lift", manufacturer: "JLG", model: "450AJ", serialNumber: "JLG450AJ12345", identifier: "E-005", status: "available", condition: "good", cost: 85000, assignTo: null },
    { type: "equipment", category: "generator", description: "Honda EU7000iS Portable Generator", manufacturer: "Honda", model: "EU7000iS", serialNumber: "EZGA1234567", identifier: "E-006", status: "assigned", condition: "good", cost: 4599, assignTo: "random" },
    { type: "equipment", category: "threading", description: "Ridgid 300 Compact Power Threading Machine", manufacturer: "Ridgid", model: "300 Compact", serialNumber: "RD300C34567", identifier: "E-007", status: "available", condition: "fair", cost: 3200, assignTo: null },

    // ── Hand Tools & Safety (bulk, unassigned/shared) ──
    { type: "tool", category: "hand_tool", description: 'Klein 11-in-1 Screwdriver/Nut Driver', manufacturer: "Klein Tools", model: "32500", serialNumber: null, identifier: "T-019", status: "assigned", condition: "good", cost: 22, assignTo: "trevor" },
    { type: "tool", category: "hand_tool", description: "Klein Journeyman Wire Stripper (10-18 AWG)", manufacturer: "Klein Tools", model: "11055", serialNumber: null, identifier: "T-020", status: "assigned", condition: "good", cost: 28, assignTo: "trevor" },
    { type: "tool", category: "hand_tool", description: "Knipex 10\" Cobra Pliers", manufacturer: "Knipex", model: "87 01 250", serialNumber: null, identifier: "T-021", status: "assigned", condition: "good", cost: 38, assignTo: "trevor" },
    { type: "tool", category: "safety", description: "Milwaukee Class E Hard Hat (Type 1)", manufacturer: "Milwaukee", model: "48-73-1000", serialNumber: null, identifier: "S-001", status: "assigned", condition: "good", cost: 32, assignTo: "trevor" },
    { type: "tool", category: "safety", description: "3M SecureFit 400 Safety Glasses (12pk)", manufacturer: "3M", model: "SF400", serialNumber: null, identifier: "S-002", status: "available", condition: "new", cost: 85, assignTo: null },
  ];

  let assetCount = 0;
  for (const t of toolData) {
    const empId = t.assignTo === "trevor"
      ? trevorTerra?.id || null
      : t.assignTo === "random"
        ? randomEmp()?.id || null
        : null;
    const jobId = empId && activeJobs.length > 0
      ? randomItem(activeJobs).id
      : null;

    sqlite.run(
      `INSERT INTO assets (company_id, type, category, description, manufacturer, model, serial_number, identifier,
         assigned_to_employee, assigned_to_job, status, condition, purchase_date, purchase_cost, warranty_expires, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        companyId, t.type, t.category, t.description, t.manufacturer, t.model,
        t.serialNumber, t.identifier, empId, jobId,
        empId ? "assigned" : t.status, t.condition,
        randomDate(365, 0),
        t.cost,
        t.cost > 500 ? dateStr(randomInt(180, 730)) : null,
        null,
      ]
    );
    assetCount++;
  }
  counts.assets = assetCount;

  // 14. JOB CODES (work type categories for time tracking)
  sqlite.run(`DELETE FROM job_codes WHERE company_id = ?`, [companyId]);

  const defaultJobCodes = [
    { code: "RGH", description: "Rough-In", sortOrder: 1 },
    { code: "TRIM", description: "Trim / Finish", sortOrder: 2 },
    { code: "SVC", description: "Service Call", sortOrder: 3 },
    { code: "DEMO", description: "Demo / Tear-Out", sortOrder: 4 },
    { code: "PANEL", description: "Panel / Switchgear", sortOrder: 5 },
    { code: "FIRE", description: "Fire Alarm", sortOrder: 6 },
    { code: "LOW-V", description: "Low Voltage / Data", sortOrder: 7 },
    { code: "UNDER", description: "Underground / Slab", sortOrder: 8 },
    { code: "TEMP", description: "Temporary Power", sortOrder: 9 },
    { code: "MATL", description: "Material Handling", sortOrder: 10 },
    { code: "MEET", description: "Meeting / Training", sortOrder: 11 },
    { code: "TRAVEL", description: "Travel / Drive Time", sortOrder: 12 },
    { code: "PUNCH", description: "Punch List", sortOrder: 13 },
    { code: "WARR", description: "Warranty Work", sortOrder: 14 },
    { code: "OTHER", description: "Other", sortOrder: 99 },
  ];

  for (const jc of defaultJobCodes) {
    sqlite.run(
      `INSERT INTO job_codes (company_id, code, description, is_active, sort_order) VALUES (?, ?, ?, 1, ?)`,
      [companyId, jc.code, jc.description, jc.sortOrder]
    );
  }
  counts.jobCodes = defaultJobCodes.length;

  // ══════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════
  return c.json({
    success: true,
    message: "Comprehensive seed completed",
    counts,
  });
});

export { seedComprehensiveRoutes };
