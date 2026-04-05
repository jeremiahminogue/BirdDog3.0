import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../shared/schema.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DB_PATH
  ? dirname(process.env.DB_PATH)
  : join(__dirname, "..", "data");
const DB_PATH = process.env.DB_PATH || join(DATA_DIR, "pe-mgmt.db");

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new Database(DB_PATH);

// Performance pragmas
sqlite.run("PRAGMA journal_mode = WAL");
sqlite.run("PRAGMA synchronous = NORMAL");
sqlite.run("PRAGMA foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { sqlite };

// Create tables if they don't exist
export function initDb() {
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS settings (
      company_id INTEGER NOT NULL REFERENCES companies(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (company_id, key)
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_name TEXT,
      logo_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'readonly' CHECK(role IN ('super_admin','admin','pm','readonly')),
      company_id INTEGER REFERENCES companies(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS classifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      department TEXT,
      classification_group TEXT,
      has_license INTEGER DEFAULT 0,
      color TEXT DEFAULT '#3b82f6'
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS jurisdictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS jurisdiction_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      jurisdiction_id INTEGER NOT NULL REFERENCES jurisdictions(id) ON DELETE CASCADE,
      classification_id INTEGER NOT NULL REFERENCES classifications(id) ON DELETE CASCADE,
      hourly_rate REAL NOT NULL,
      total_cost_rate REAL NOT NULL,
      effective_date TEXT,
      expiration_date TEXT,
      UNIQUE(jurisdiction_id, classification_id)
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      employee_number TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      classification_id INTEGER REFERENCES classifications(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
      phone TEXT,
      pe_phone TEXT,
      personal_email TEXT,
      work_email TEXT,
      address TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      date_of_hire TEXT,
      date_of_birth TEXT,
      place_of_birth TEXT,
      shirt_size TEXT,
      jacket_size TEXT,
      elec_license TEXT,
      dl_number TEXT,
      dl_state TEXT,
      dl_expiration TEXT,
      background_check TEXT,
      background_check_date TEXT,
      reason_for_leaving TEXT,
      photo_url TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      job_number TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      jurisdiction_id INTEGER REFERENCES jurisdictions(id),
      gc_contact TEXT,
      status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','active','completed','closed')),
      start_date TEXT,
      end_date TEXT,
      scope_of_work TEXT,
      original_contract REAL,
      current_contract REAL,
      show_on_board INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS job_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('labor','material','equipment','general','subcontract')),
      original_budget REAL DEFAULT 0,
      current_budget REAL DEFAULT 0
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS job_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('labor','material','equipment','general','subcontract')),
      cost_code TEXT,
      description TEXT,
      amount REAL NOT NULL,
      date_recorded TEXT DEFAULT (date('now')),
      week_ending TEXT,
      notes TEXT
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS job_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      role TEXT,
      bill_rate REAL,
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      assigned_at TEXT DEFAULT (datetime('now')),
      UNIQUE(job_id, employee_id)
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS subcontracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL,
      contact_name TEXT,
      contact_phone TEXT,
      scope TEXT,
      original_amount REAL,
      current_amount REAL,
      cost_to_date REAL DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','cancelled'))
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      issuing_body TEXT,
      date_issued TEXT,
      date_expires TEXT
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      type TEXT NOT NULL CHECK(type IN ('vehicle','tool','equipment')),
      category TEXT,
      description TEXT NOT NULL,
      manufacturer TEXT,
      model TEXT,
      serial_number TEXT,
      identifier TEXT,
      assigned_to_employee INTEGER REFERENCES employees(id),
      assigned_to_job INTEGER REFERENCES jobs(id),
      status TEXT DEFAULT 'available' CHECK(status IN ('available','assigned','maintenance','retired')),
      condition TEXT DEFAULT 'good' CHECK(condition IN ('new','good','fair','poor')),
      purchase_date TEXT,
      purchase_cost REAL,
      warranty_expires TEXT,
      photo_url TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS employee_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      category TEXT DEFAULT 'general' CHECK(category IN ('general','disciplinary','contact')),
      content TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS daily_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      date TEXT NOT NULL,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      job_id INTEGER REFERENCES jobs(id),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS scheduled_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      to_job_id INTEGER REFERENCES jobs(id),
      effective_date TEXT NOT NULL,
      applied INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS action_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      assigned_to_id INTEGER REFERENCES employees(id),
      assigned_to TEXT,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
      due_date TEXT,
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      created_by TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS job_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS template_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES job_templates(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      assigned_to TEXT,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
      sort_order INTEGER DEFAULT 0
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS project_finance_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      job_number TEXT NOT NULL,
      job_name TEXT,
      hour_budget REAL,
      hours_used REAL,
      labor_budget REAL,
      labor_cost REAL,
      material_budget REAL,
      material_cost REAL,
      general_budget REAL,
      general_cost REAL,
      total_contract REAL,
      imported_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS gc_companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      website TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      website TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      system_type TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','submitted','won','lost','no_bid','on_hold')),
      stage TEXT,
      estimator_id INTEGER REFERENCES employees(id),
      bid_date TEXT,
      bid_time TEXT,
      dwgs_specs_received INTEGER DEFAULT 0,
      pre_bid_meeting TEXT,
      addenda_count INTEGER DEFAULT 0,
      project_start_date TEXT,
      project_end_date TEXT,
      scope_notes TEXT,
      notes TEXT,
      follow_up_date TEXT,
      follow_up_notes TEXT,
      converted_job_id INTEGER REFERENCES jobs(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS opportunity_gcs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      gc_company_id INTEGER NOT NULL REFERENCES gc_companies(id),
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      bid_value REAL,
      is_primary INTEGER DEFAULT 0,
      collaboration_letter_sent INTEGER DEFAULT 0,
      sent_drawings_to_gc INTEGER DEFAULT 0,
      outcome TEXT DEFAULT 'pending' CHECK(outcome IN ('pending','won','lost','no_bid','cancelled')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS opportunity_suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      sent_drawings INTEGER DEFAULT 0
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS daily_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      report_date TEXT NOT NULL,
      submitted_by INTEGER NOT NULL REFERENCES employees(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','reviewed')),
      weather_condition TEXT,
      weather_temp INTEGER,
      weather_impact TEXT,
      work_performed TEXT,
      areas_worked TEXT,
      delay_notes TEXT,
      delay_type TEXT,
      visitors TEXT,
      safety_notes TEXT,
      material_notes TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      review_notes TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      daily_report_id INTEGER REFERENCES daily_reports(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      report_date TEXT NOT NULL,
      classification_id INTEGER REFERENCES classifications(id),
      hours_regular REAL DEFAULT 0,
      hours_overtime REAL DEFAULT 0,
      hours_double REAL DEFAULT 0,
      start_time TEXT,
      end_time TEXT,
      work_performed TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS job_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      daily_report_id INTEGER REFERENCES daily_reports(id) ON DELETE SET NULL,
      uploaded_by INTEGER REFERENCES employees(id),
      photo_url TEXT NOT NULL,
      caption TEXT,
      category TEXT DEFAULT 'progress' CHECK(category IN ('progress','before_cover','issue','safety','material','other')),
      location_desc TEXT,
      taken_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Toolbox Talks ──────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS toolbox_talks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
      scheduled_date TEXT NOT NULL,
      topic TEXT NOT NULL,
      generated_content TEXT,
      presented_by INTEGER REFERENCES employees(id),
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','scheduled','completed')),
      duration INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS toolbox_talk_attendees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      talk_id INTEGER NOT NULL REFERENCES toolbox_talks(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      signed_at TEXT
    )
  `);

  // ── Change Order Requests ─────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS change_order_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      request_number TEXT,
      title TEXT NOT NULL,
      description TEXT,
      requested_by INTEGER REFERENCES employees(id),
      assigned_to INTEGER REFERENCES employees(id),
      assigned_by INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','submitted','assigned','estimated','approved','rejected')),
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
      estimated_cost REAL,
      estimated_hours REAL,
      estimate_notes TEXT,
      location_desc TEXT,
      due_date TEXT,
      approved_by INTEGER REFERENCES users(id),
      approved_at TEXT,
      rejection_reason TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS change_order_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      change_order_id INTEGER NOT NULL REFERENCES change_order_requests(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      photo_url TEXT NOT NULL,
      caption TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Indexes
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_employees_classification ON employees(classification_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_job_assignments_job ON job_assignments(job_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_job_assignments_employee ON job_assignments(employee_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_job_assignments_active ON job_assignments(is_active)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_jurisdiction_rates_jurisdiction ON jurisdiction_rates(jurisdiction_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_jurisdiction_rates_classification ON jurisdiction_rates(classification_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_jobs_jurisdiction ON jobs(jurisdiction_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_daily_log_date ON daily_log(date)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_daily_log_employee ON daily_log(employee_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_scheduled_moves_date ON scheduled_moves(effective_date)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_scheduled_moves_applied ON scheduled_moves(applied)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_action_items_job ON action_items(job_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_template_items_template ON template_items(template_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_project_finance_data_job ON project_finance_data(job_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_gc_companies_company ON gc_companies(company_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_suppliers_company ON suppliers(company_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_opportunities_company ON opportunities(company_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_opportunities_estimator ON opportunities(estimator_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_opportunities_converted ON opportunities(converted_job_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_opportunity_gcs_opportunity ON opportunity_gcs(opportunity_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_opportunity_gcs_gc ON opportunity_gcs(gc_company_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_opportunity_suppliers_opportunity ON opportunity_suppliers(opportunity_id)");
  // Daily reports indexes
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_daily_reports_company ON daily_reports(company_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_daily_reports_job ON daily_reports(job_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(report_date)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_daily_reports_submitted_by ON daily_reports(submitted_by)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_daily_reports_status ON daily_reports(status)");
  sqlite.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reports_unique ON daily_reports(company_id, job_id, report_date, submitted_by)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_time_entries_company ON time_entries(company_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_time_entries_report ON time_entries(daily_report_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_time_entries_employee ON time_entries(employee_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(report_date)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_time_entries_job ON time_entries(job_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_job_photos_company ON job_photos(company_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_job_photos_report ON job_photos(daily_report_id)");

  // Toolbox talks indexes
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_toolbox_talks_company ON toolbox_talks(company_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_toolbox_talks_job ON toolbox_talks(job_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_toolbox_talks_date ON toolbox_talks(scheduled_date)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_toolbox_talks_status ON toolbox_talks(status)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_toolbox_talk_attendees_talk ON toolbox_talk_attendees(talk_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_toolbox_talk_attendees_employee ON toolbox_talk_attendees(employee_id)");
  // Change order indexes
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_change_orders_company ON change_order_requests(company_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_change_orders_job ON change_order_requests(job_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_change_orders_status ON change_order_requests(status)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_change_orders_assigned ON change_order_requests(assigned_to)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_change_orders_requested ON change_order_requests(requested_by)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_change_order_photos_co ON change_order_photos(change_order_id)");

  // NOTE: company_id indexes are created by migrate.ts AFTER adding the company_id columns
}
