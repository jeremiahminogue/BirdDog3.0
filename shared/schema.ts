import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ── Company Settings ────────────────────────────────────────────
// D-04 FIX: Drizzle schema now declares composite PK matching actual SQLite table
export const settings = sqliteTable("settings", {
  companyId: integer("company_id").notNull().references(() => companies.id),
  key: text("key").notNull(),
  value: text("value").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.companyId, table.key] }),
}));

// ── Companies ───────────────────────────────────────────────────
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  shortName: text("short_name"),
  logoUrl: text("logo_url"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Users & Auth ────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["super_admin", "admin", "pm", "foreman", "field_staff"] }).notNull().default("field_staff"),
  employeeId: integer("employee_id").references(() => employees.id),
  companyId: integer("company_id").references(() => companies.id),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  lastLogin: text("last_login"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // nanoid token
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Classifications ─────────────────────────────────────────────
export const classifications = sqliteTable("classifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(), // Journeyman, Apprentice, Foreman, etc.
  department: text("department"), // Electrical, Low Voltage, Solar, Service
  classificationGroup: text("classification_group"), // grouping for reports (e.g. CW, Apprentice, VDV Support Tech)
  hasLicense: integer("has_license", { mode: "boolean" }).default(false),
  color: text("color").default("#3b82f6"), // for UI badges
});

// ── Jurisdictions (regions with classification-specific rates) ──
export const jurisdictions = sqliteTable("jurisdictions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const jurisdictionRates = sqliteTable("jurisdiction_rates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jurisdictionId: integer("jurisdiction_id").notNull().references(() => jurisdictions.id, { onDelete: "cascade" }),
  classificationId: integer("classification_id").notNull().references(() => classifications.id, { onDelete: "cascade" }),
  hourlyRate: real("hourly_rate").notNull(),
  totalCostRate: real("total_cost_rate").notNull(),
  effectiveDate: text("effective_date"),
  expirationDate: text("expiration_date"),
});

// ── Employees ───────────────────────────────────────────────────
export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  employeeNumber: text("employee_number").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  classificationId: integer("classification_id").references(() => classifications.id),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),

  // Contact
  phone: text("phone"),           // home/personal phone
  pePhone: text("pe_phone"),      // company cell
  personalEmail: text("personal_email"),
  workEmail: text("work_email"),
  address: text("address"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),

  // Personal
  dateOfHire: text("date_of_hire"),
  dateOfBirth: text("date_of_birth"),
  placeOfBirth: text("place_of_birth"),
  shirtSize: text("shirt_size"),
  jacketSize: text("jacket_size"),

  // License & Compliance
  elecLicense: text("elec_license"),        // electrical license number
  dlNumber: text("dl_number"),
  dlState: text("dl_state"),
  dlExpiration: text("dl_expiration"),
  backgroundCheck: text("background_check"),       // type (CBI, etc.)
  backgroundCheckDate: text("background_check_date"),

  // Separation
  reasonForLeaving: text("reason_for_leaving"),

  // Photo
  photoUrl: text("photo_url"),

  notes: text("notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ── Jobs / Projects ─────────────────────────────────────────────
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobNumber: text("job_number").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  latitude: real("latitude"),                            // geocoded from address
  longitude: real("longitude"),                          // geocoded from address
  geofenceRadius: integer("geofence_radius").default(300), // feet — clock-in proximity check
  jurisdictionId: integer("jurisdiction_id").references(() => jurisdictions.id),
  gcContact: text("gc_contact"),
  status: text("status", { enum: ["planning", "active", "completed", "closed"] }).notNull().default("planning"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  scopeOfWork: text("scope_of_work"),
  originalContract: real("original_contract"),
  currentContract: real("current_contract"),
  showOnBoard: integer("show_on_board", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ── Job Budgets ─────────────────────────────────────────────────
export const jobBudgets = sqliteTable("job_budgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  category: text("category", { enum: ["labor", "material", "equipment", "general", "subcontract"] }).notNull(),
  originalBudget: real("original_budget").default(0),
  currentBudget: real("current_budget").default(0),
});

// ── Job Costs ───────────────────────────────────────────────────
export const jobCosts = sqliteTable("job_costs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  category: text("category", { enum: ["labor", "material", "equipment", "general", "subcontract"] }).notNull(),
  costCode: text("cost_code"),
  description: text("description"),
  amount: real("amount").notNull(),
  dateRecorded: text("date_recorded").default(sql`(date('now'))`),
  weekEnding: text("week_ending"),
  notes: text("notes"),
});

// ── Job Assignments (the drag-and-drop core) ────────────────────
export const jobAssignments = sqliteTable("job_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  role: text("role"), // optional override (e.g., "Lead", "Helper")
  billRate: real("bill_rate"), // optional rate override
  startDate: text("start_date"),
  endDate: text("end_date"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  assignedAt: text("assigned_at").default(sql`(datetime('now'))`),
});

// ── Subcontracts ────────────────────────────────────────────────
export const subcontracts = sqliteTable("subcontracts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  scope: text("scope"),
  originalAmount: real("original_amount"),
  currentAmount: real("current_amount"),
  costToDate: real("cost_to_date").default(0),
  status: text("status", { enum: ["active", "completed", "cancelled"] }).default("active"),
});

// ── Certifications ──────────────────────────────────────────────
export const certifications = sqliteTable("certifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  issuingBody: text("issuing_body"),
  dateIssued: text("date_issued"),
  dateExpires: text("date_expires"),
});

// ── Assets (Vehicles, Tools, Equipment) ─────────────────────────
export const assets = sqliteTable("assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  type: text("type", { enum: ["vehicle", "tool", "equipment"] }).notNull(),
  category: text("category"), // "power_tool", "specialty", "hand_tool", "safety", etc.
  description: text("description").notNull(),
  manufacturer: text("manufacturer"),
  model: text("model"),
  serialNumber: text("serial_number"),
  identifier: text("identifier"), // asset tag / barcode
  assignedToEmployee: integer("assigned_to_employee").references(() => employees.id),
  assignedToJob: integer("assigned_to_job").references(() => jobs.id),
  status: text("status", { enum: ["available", "assigned", "maintenance", "retired"] }).default("available"),
  condition: text("condition", { enum: ["new", "good", "fair", "poor"] }).default("good"),
  purchaseDate: text("purchase_date"),
  purchaseCost: real("purchase_cost"),
  warrantyExpires: text("warranty_expires"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ── Tool Reports (field-reported issues: damaged, lost, stolen, needs service) ──
export const toolReports = sqliteTable("tool_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  reportedBy: integer("reported_by").notNull().references(() => employees.id),
  reportType: text("report_type", { enum: ["damaged", "lost", "stolen", "needs_maintenance", "needs_calibration"] }).notNull(),
  severity: text("severity", { enum: ["can_still_use", "out_of_service", "safety_hazard"] }).notNull(),
  description: text("description").notNull(),
  photoUrl: text("photo_url"),
  lat: real("lat"),
  lng: real("lng"),
  status: text("status", { enum: ["open", "acknowledged", "in_repair", "resolved"] }).default("open").notNull(),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: text("resolved_at"),
  resolutionNote: text("resolution_note"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Tool History (immutable audit log — every assignment, report, repair, transfer) ──
export const toolHistory = sqliteTable("tool_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: [
    "assigned", "unassigned", "transferred", "returned",
    "reported_damaged", "reported_lost", "reported_stolen",
    "reported_maintenance", "reported_calibration",
    "sent_to_repair", "repaired", "calibrated",
    "condition_changed", "status_changed", "retired", "created"
  ] }).notNull(),
  employeeId: integer("employee_id").references(() => employees.id),
  jobId: integer("job_id").references(() => jobs.id),
  fromEmployeeId: integer("from_employee_id").references(() => employees.id),
  toEmployeeId: integer("to_employee_id").references(() => employees.id),
  note: text("note"),
  reportId: integer("report_id").references(() => toolReports.id),
  performedBy: integer("performed_by").references(() => users.id),
  lat: real("lat"),
  lng: real("lng"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Employee Notes ──────────────────────────────────────────────
export const employeeNotes = sqliteTable("employee_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  category: text("category", { enum: ["general", "disciplinary", "contact"] }).default("general"),
  content: text("content").notNull(),
  createdBy: text("created_by"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Daily Assignment Log (committed snapshots) ──────────────
export const dailyLog = sqliteTable("daily_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  date: text("date").notNull(), // YYYY-MM-DD
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  jobId: integer("job_id").references(() => jobs.id), // null = bench
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Scheduled Moves (future assignment changes) ─────────────
export const scheduledMoves = sqliteTable("scheduled_moves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  toJobId: integer("to_job_id").references(() => jobs.id), // null = move to bench
  effectiveDate: text("effective_date").notNull(), // YYYY-MM-DD
  applied: integer("applied", { mode: "boolean" }).default(false),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Action Items (Meeting Tool) ────────────────────────────────
export const actionItems = sqliteTable("action_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  assignedToId: integer("assigned_to_id").references(() => employees.id), // FK to employees
  assignedTo: text("assigned_to"),           // legacy text fallback (templates use role labels like "PM")
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] }).notNull().default("normal"),
  status: text("status", { enum: ["open", "done"] }).notNull().default("open"),
  dueDate: text("due_date"),                 // optional YYYY-MM-DD
  notes: text("notes"),                      // running notes / comments
  sortOrder: integer("sort_order").default(0),
  createdBy: text("created_by"),
  completedAt: text("completed_at"),
  completedBy: text("completed_by"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ── Job Templates (seed new jobs with standard items) ──────────
export const jobTemplates = sqliteTable("job_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),              // "Commercial New Build", "Service Call", etc.
  description: text("description"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const templateItems = sqliteTable("template_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  templateId: integer("template_id").notNull().references(() => jobTemplates.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  assignedTo: text("assigned_to"),
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] }).notNull().default("normal"),
  sortOrder: integer("sort_order").default(0),
});

// ── Project Finance Data (A-Systems Import) ────────────────────
export const projectFinanceData = sqliteTable("project_finance_data", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  jobNumber: text("job_number").notNull(),       // from A-Systems PDF
  jobName: text("job_name"),                     // from A-Systems PDF
  reportType: text("report_type").default("detail"), // "detail" or "summary"

  // ── From detail report (existing) ──
  hourBudget: real("hour_budget"),
  hoursUsed: real("hours_used"),
  laborBudget: real("labor_budget"),
  laborCost: real("labor_cost"),
  materialBudget: real("material_budget"),
  materialCost: real("material_cost"),
  generalBudget: real("general_budget"),
  generalCost: real("general_cost"),
  totalContract: real("total_contract"),

  // ── From Comprehensive Job Summary (actuals only — BirdDog computes projections) ──
  revisedContractPrice: real("revised_contract_price"),
  percentComplete: real("percent_complete"),
  billedToDate: real("billed_to_date"),
  costToDate: real("cost_to_date"),
  earnedToDate: real("earned_to_date"),
  receivedToDate: real("received_to_date"),
  paidOutToDate: real("paid_out_to_date"),

  // Job Break Down — per category actuals (labor/material/subcontract/equipment/general)
  laborPctComplete: real("labor_pct_complete"),
  materialPctComplete: real("material_pct_complete"),
  subcontractPctComplete: real("subcontract_pct_complete"),
  equipmentPctComplete: real("equipment_pct_complete"),
  generalPctComplete: real("general_pct_complete"),

  laborOrigBudget: real("labor_orig_budget"),
  materialOrigBudget: real("material_orig_budget"),
  subcontractOrigBudget: real("subcontract_orig_budget"),
  equipmentOrigBudget: real("equipment_orig_budget"),
  generalOrigBudget: real("general_orig_budget"),

  laborCurrBudget: real("labor_curr_budget"),
  materialCurrBudget: real("material_curr_budget"),
  subcontractCurrBudget: real("subcontract_curr_budget"),
  equipmentCurrBudget: real("equipment_curr_budget"),
  generalCurrBudget: real("general_curr_budget"),

  laborCostToDate: real("labor_cost_to_date"),
  materialCostToDate: real("material_cost_to_date"),
  subcontractCostToDate: real("subcontract_cost_to_date"),
  equipmentCostToDate: real("equipment_cost_to_date"),
  generalCostToDate: real("general_cost_to_date"),

  importedAt: text("imported_at").default(sql`(datetime('now'))`),
});

// ── GC Companies (General Contractors) ─────────────────────────
export const gcCompanies = sqliteTable("gc_companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  phone: text("phone"),
  website: text("website"),
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Suppliers (Supply Houses) ──────────────────────────────────
export const suppliers = sqliteTable("suppliers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  phone: text("phone"),
  website: text("website"),
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Opportunities (Bid Pipeline) ───────────────────────────────
export const opportunities = sqliteTable("opportunities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  systemType: text("system_type"), // Electrical, Controls, Fire Alarm, Solar, Data
  status: text("status", { enum: ["open", "submitted", "won", "lost", "no_bid", "on_hold"] }).notNull().default("open"),
  stage: text("stage"), // pipeline stage from the 22-step list
  estimatorId: integer("estimator_id").references(() => employees.id),
  bidDate: text("bid_date"),
  bidTime: text("bid_time"),
  dwgsSpecsReceived: integer("dwgs_specs_received", { mode: "boolean" }).default(false),
  preBidMeeting: text("pre_bid_meeting"),
  addendaCount: integer("addenda_count").default(0),
  projectStartDate: text("project_start_date"),
  projectEndDate: text("project_end_date"),
  scopeNotes: text("scope_notes"),
  notes: text("notes"),
  followUpDate: text("follow_up_date"),
  followUpNotes: text("follow_up_notes"),
  convertedJobId: integer("converted_job_id").references(() => jobs.id),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ── Opportunity GC Bids (one per GC per opportunity) ───────────
export const opportunityGcs = sqliteTable("opportunity_gcs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  gcCompanyId: integer("gc_company_id").notNull().references(() => gcCompanies.id),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  bidValue: real("bid_value"),
  isPrimary: integer("is_primary", { mode: "boolean" }).default(false),
  collaborationLetterSent: integer("collaboration_letter_sent", { mode: "boolean" }).default(false),
  sentDrawingsToGc: integer("sent_drawings_to_gc", { mode: "boolean" }).default(false),
  outcome: text("outcome", { enum: ["pending", "won", "lost", "no_bid", "cancelled"] }).default("pending"),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Opportunity Suppliers (checkbox tracking) ──────────────────
export const opportunitySuppliers = sqliteTable("opportunity_suppliers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  sentDrawings: integer("sent_drawings", { mode: "boolean" }).default(false),
});

// ── Daily Reports (field → office) ─────────────────────────────
export const dailyReports = sqliteTable("daily_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  reportDate: text("report_date").notNull(),          // YYYY-MM-DD
  submittedBy: integer("submitted_by").notNull().references(() => employees.id), // foreman
  status: text("status", { enum: ["draft", "submitted", "reviewed"] }).notNull().default("draft"),

  // Weather
  weatherCondition: text("weather_condition"),         // clear, cloudy, rain, snow, wind, extreme_heat, extreme_cold
  weatherTemp: integer("weather_temp"),                // degrees F
  weatherImpact: text("weather_impact"),               // none, delayed, stopped

  // Work summary
  workPerformed: text("work_performed"),               // what the crew did today
  areasWorked: text("areas_worked"),                   // building areas/floors/rooms
  delayNotes: text("delay_notes"),                     // what caused delays
  delayType: text("delay_type"),                       // none, weather, material, inspection, other_trade, gc, equipment
  visitors: text("visitors"),                          // inspectors, GC, engineers on site
  safetyNotes: text("safety_notes"),                   // safety observations or incidents
  materialNotes: text("material_notes"),               // material received, needed, issues

  // Review
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: text("reviewed_at"),
  reviewNotes: text("review_notes"),                   // PM/admin notes on the report

  notes: text("notes"),                                // general notes
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ── Time Entries (linked to daily reports) ─────────────────────
export const timeEntries = sqliteTable("time_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  dailyReportId: integer("daily_report_id").references(() => dailyReports.id, { onDelete: "cascade" }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  reportDate: text("report_date").notNull(),           // YYYY-MM-DD
  classificationId: integer("classification_id").references(() => classifications.id),
  hoursRegular: real("hours_regular").default(0),      // standard hours (up to 8)
  hoursOvertime: real("hours_overtime").default(0),     // OT hours
  hoursDouble: real("hours_double").default(0),         // double-time hours
  startTime: text("start_time"),                       // HH:MM (legacy manual entry)
  endTime: text("end_time"),                           // HH:MM (legacy manual entry)

  // ── Clock in/out (ExakTime replacement) ───────────
  clockIn: text("clock_in"),                           // ISO 8601 timestamp
  clockOut: text("clock_out"),                         // ISO 8601 timestamp
  clockInLat: real("clock_in_lat"),                    // GPS latitude at clock-in
  clockInLng: real("clock_in_lng"),                    // GPS longitude at clock-in
  clockOutLat: real("clock_out_lat"),                  // GPS latitude at clock-out
  clockOutLng: real("clock_out_lng"),                  // GPS longitude at clock-out
  clockInPhotoUrl: text("clock_in_photo_url"),         // selfie/site photo at clock-in
  clockOutPhotoUrl: text("clock_out_photo_url"),       // selfie/site photo at clock-out
  clockInInsideGeofence: integer("clock_in_inside_geofence", { mode: "boolean" }), // auto-calculated
  clockOutInsideGeofence: integer("clock_out_inside_geofence", { mode: "boolean" }),
  clockInAddress: text("clock_in_address"),            // reverse-geocoded street address
  clockOutAddress: text("clock_out_address"),          // reverse-geocoded street address
  source: text("source", { enum: ["manual", "mobile", "tablet", "kiosk"] }).default("manual"),

  // ── Break tracking ────────────────────────────────
  breakMinutes: integer("break_minutes").default(0),   // total break time in minutes
  lunchOut: text("lunch_out"),                         // ISO 8601
  lunchIn: text("lunch_in"),                           // ISO 8601

  jobCodeId: integer("job_code_id").references(() => jobCodes.id), // type of work being performed
  workPerformed: text("work_performed"),               // what this person did
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ── Time Entry Adjustments (audit trail) ─────────────────────────
export const timeEntryAdjustments = sqliteTable("time_entry_adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timeEntryId: integer("time_entry_id").notNull().references(() => timeEntries.id, { onDelete: "cascade" }),
  adjustedBy: integer("adjusted_by").notNull().references(() => employees.id),   // who made the change
  adjustedAt: text("adjusted_at").default(sql`(datetime('now'))`),
  fieldChanged: text("field_changed").notNull(),              // "clock_in", "clock_out", "hours_regular", etc.
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason").notNull(),                           // required — why was this changed?
});

export type TimeEntryAdjustment = typeof timeEntryAdjustments.$inferSelect;

// ── Job Photos (field documentation) ───────────────────────────
export const jobPhotos = sqliteTable("job_photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  dailyReportId: integer("daily_report_id").references(() => dailyReports.id, { onDelete: "set null" }),
  uploadedBy: integer("uploaded_by").references(() => employees.id),
  photoUrl: text("photo_url").notNull(),
  caption: text("caption"),
  category: text("category", { enum: ["progress", "before_cover", "issue", "safety", "material", "other"] }).default("progress"),
  locationDesc: text("location_desc"),                 // "2nd floor, room 204"
  takenAt: text("taken_at"),                           // when photo was taken
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Toolbox Talks (weekly safety meetings) ────────────────────────
export const toolboxTalks = sqliteTable("toolbox_talks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  scheduledDate: text("scheduled_date").notNull(),        // YYYY-MM-DD
  topic: text("topic").notNull(),                         // user-chosen topic
  oshaStandard: text("osha_standard"),                     // e.g. "29 CFR 1926.405"
  generatedContent: text("generated_content"),             // AI-generated talk content (HTML)
  presentedBy: integer("presented_by").references(() => employees.id),
  status: text("status", { enum: ["draft", "scheduled", "presented", "completed"] }).notNull().default("draft"),
  duration: integer("duration"),                           // minutes
  notes: text("notes"),
  completedAt: text("completed_at"),                       // when all signatures collected
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const toolboxTalkAttendees = sqliteTable("toolbox_talk_attendees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  talkId: integer("talk_id").notNull().references(() => toolboxTalks.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  signedAt: text("signed_at"),                             // timestamp when they acknowledged
  signedByName: text("signed_by_name"),                    // full name captured at sign time
  signatureHash: text("signature_hash"),                   // SHA-256(empId+talkId+contentHash+timestamp) — tamper-evident
});

// ── Change Order Requests (field → estimator) ─────────────────────
export const changeOrderRequests = sqliteTable("change_order_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  requestNumber: text("request_number"),                   // auto-generated: COR-001
  title: text("title").notNull(),
  description: text("description"),                        // what changed in the field
  requestedBy: integer("requested_by").references(() => employees.id), // field person who documented it
  assignedTo: integer("assigned_to").references(() => employees.id),   // estimator
  assignedBy: integer("assigned_by").references(() => users.id),       // PM who assigned it
  status: text("status", { enum: ["draft", "submitted", "assigned", "estimated", "approved", "rejected"] }).notNull().default("draft"),
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] }).notNull().default("normal"),
  estimatedCost: real("estimated_cost"),
  estimatedHours: real("estimated_hours"),
  estimateNotes: text("estimate_notes"),                   // estimator's notes
  locationDesc: text("location_desc"),                     // where in the building
  dueDate: text("due_date"),                               // YYYY-MM-DD
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: text("approved_at"),
  rejectionReason: text("rejection_reason"),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const changeOrderPhotos = sqliteTable("change_order_photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  changeOrderId: integer("change_order_id").notNull().references(() => changeOrderRequests.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  photoUrl: text("photo_url").notNull(),
  caption: text("caption"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Job Codes (work type categories for time tracking) ────────
// Managed by office users. Field crew selects one when clocking in.
export const jobCodes = sqliteTable("job_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  code: text("code").notNull(),                            // short code e.g. "RGH", "TRIM", "SVC"
  description: text("description").notNull(),              // full name e.g. "Rough-In", "Trim", "Service Call"
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Live Locations (real-time crew map) ───────────────────────
// Updated from mobile/tablet every few minutes while clocked in.
// Only latest row per employee matters — older rows are history.
export const liveLocations = sqliteTable("live_locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  accuracy: real("accuracy"),                            // GPS accuracy in meters
  altitude: real("altitude"),                            // meters above sea level
  heading: real("heading"),                              // compass degrees 0-360
  speed: real("speed"),                                  // m/s
  batteryLevel: integer("battery_level"),                // 0-100 percent
  isCharging: integer("is_charging", { mode: "boolean" }),
  address: text("address"),                              // reverse-geocoded
  jobId: integer("job_id").references(() => jobs.id),    // nearest/assigned job
  insideGeofence: integer("inside_geofence", { mode: "boolean" }),
  timeEntryId: integer("time_entry_id").references(() => timeEntries.id), // active clock-in
  recordedAt: text("recorded_at").notNull().default(sql`(datetime('now'))`),
});

// ── Time Entry Issues (clock in/out problems requiring resolution) ──
export const timeEntryIssues = sqliteTable("time_entry_issues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  timeEntryId: integer("time_entry_id").references(() => timeEntries.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  issueType: text("issue_type", { enum: ["missed_clock_out", "outside_geofence", "missing_photo", "excessive_hours"] }).notNull(),
  issueDetails: text("issue_details"),                     // e.g. "16.5 hours", "0.8 mi from site"
  status: text("status", { enum: ["pending", "noted", "approved", "rejected"] }).default("pending").notNull(),
  employeeNote: text("employee_note"),                     // explanation from the field worker
  employeeNotedAt: text("employee_noted_at"),              // when the note was submitted
  resolvedBy: integer("resolved_by").references(() => employees.id),  // manager who approved/rejected
  resolvedAt: text("resolved_at"),
  managerNote: text("manager_note"),                       // optional manager comment
  reportDate: text("report_date").notNull(),               // YYYY-MM-DD the issue relates to
  lastNotifiedAt: text("last_notified_at"),                // when the last push notification was sent
  detectedAt: text("detected_at").default(sql`(datetime('now'))`),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ── Time Correction Requests (employee self-service corrections) ──
export const timeCorrectionRequests = sqliteTable("time_correction_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  timeEntryId: integer("time_entry_id").references(() => timeEntries.id, { onDelete: "cascade" }),
  issueId: integer("issue_id").references(() => timeEntryIssues.id),  // optional link to detected issue
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  correctionType: text("correction_type", { enum: ["missed_clock_out", "wrong_time", "wrong_job", "other"] }).notNull(),
  requestedClockIn: text("requested_clock_in"),     // corrected clock-in time
  requestedClockOut: text("requested_clock_out"),    // corrected clock-out time
  requestedJobId: integer("requested_job_id").references(() => jobs.id),
  note: text("note").notNull(),                      // employee explanation
  status: text("status", { enum: ["pending", "approved", "rejected"] }).default("pending").notNull(),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: text("resolved_at"),
  managerNote: text("manager_note"),
  reportDate: text("report_date").notNull(),         // YYYY-MM-DD
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export type TimeCorrectionRequest = typeof timeCorrectionRequests.$inferSelect;

// ── Time Off / Sick Leave / General Requests (mobile → office) ──
export const timeOffRequests = sqliteTable("time_off_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  requestType: text("request_type", { enum: ["paid_sick_leave", "time_off", "general_note"] }).notNull(),
  startDate: text("start_date").notNull(),          // YYYY-MM-DD
  endDate: text("end_date"),                         // null for single-day or general notes
  hoursRequested: real("hours_requested"),            // total PTO/sick hours requested
  note: text("note").notNull(),                      // employee explanation
  status: text("status", { enum: ["pending", "approved", "rejected"] }).default("pending").notNull(),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: text("resolved_at"),
  managerNote: text("manager_note"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export type TimeOffRequest = typeof timeOffRequests.$inferSelect;

// ── PTO / Sick Leave Balances ──
export const employeePtoBalances = sqliteTable("employee_pto_balances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  balanceType: text("balance_type", { enum: ["pto", "sick"] }).notNull(),
  accruedHours: real("accrued_hours").default(0).notNull(),
  usedHours: real("used_hours").default(0).notNull(),
  adjustedHours: real("adjusted_hours").default(0).notNull(),  // manual adjustments (+/-)
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export type EmployeePtoBalance = typeof employeePtoBalances.$inferSelect;

// ── Push Notification Tokens (Expo push tokens per user/device) ──
export const pushTokens = sqliteTable("push_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  token: text("token").notNull(),                          // Expo push token (ExponentPushToken[...])
  platform: text("platform", { enum: ["ios", "android"] }),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ── Announcements (Communicate feature — push messages to field crews) ──
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  sentBy: integer("sent_by").notNull().references(() => users.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  priority: text("priority", { enum: ["normal", "urgent"] }).notNull().default("normal"),
  audience: text("audience", { enum: ["company", "job", "individual"] }).notNull(),
  targetJobId: integer("target_job_id").references(() => jobs.id),
  targetEmployeeId: integer("target_employee_id").references(() => employees.id),
  pushSent: integer("push_sent").default(0),           // count of push notifications sent
  pushFailed: integer("push_failed").default(0),       // count that failed delivery
  sentAt: text("sent_at").default(sql`(datetime('now'))`),
});

// ── Announcement Read Receipts ──────────────────────────────────
export const announcementReads = sqliteTable("announcement_reads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  announcementId: integer("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  readAt: text("read_at").default(sql`(datetime('now'))`),
});

// ── Type exports ────────────────────────────────────────────────
export type Company = typeof companies.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Classification = typeof classifications.$inferSelect;
export type Jurisdiction = typeof jurisdictions.$inferSelect;
export type JurisdictionRate = typeof jurisdictionRates.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobBudget = typeof jobBudgets.$inferSelect;
export type JobCost = typeof jobCosts.$inferSelect;
export type JobAssignment = typeof jobAssignments.$inferSelect;
export type Subcontract = typeof subcontracts.$inferSelect;
export type Certification = typeof certifications.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type EmployeeNote = typeof employeeNotes.$inferSelect;
export type DailyLog = typeof dailyLog.$inferSelect;
export type ScheduledMove = typeof scheduledMoves.$inferSelect;
export type ActionItem = typeof actionItems.$inferSelect;
export type JobTemplate = typeof jobTemplates.$inferSelect;
export type TemplateItem = typeof templateItems.$inferSelect;
export type ProjectFinanceData = typeof projectFinanceData.$inferSelect;
export type GcCompany = typeof gcCompanies.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
export type OpportunityGc = typeof opportunityGcs.$inferSelect;
export type OpportunitySupplier = typeof opportunitySuppliers.$inferSelect;
export type DailyReport = typeof dailyReports.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type JobCode = typeof jobCodes.$inferSelect;
export type LiveLocation = typeof liveLocations.$inferSelect;
export type JobPhoto = typeof jobPhotos.$inferSelect;
export type ToolboxTalk = typeof toolboxTalks.$inferSelect;
export type ToolboxTalkAttendee = typeof toolboxTalkAttendees.$inferSelect;
export type ChangeOrderRequest = typeof changeOrderRequests.$inferSelect;
export type ChangeOrderPhoto = typeof changeOrderPhotos.$inferSelect;
export type TimeEntryIssue = typeof timeEntryIssues.$inferSelect;
export type PushToken = typeof pushTokens.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type AnnouncementRead = typeof announcementReads.$inferSelect;
