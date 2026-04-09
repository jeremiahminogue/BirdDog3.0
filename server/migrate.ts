import { initDb, sqlite } from "./db.js";

/**
 * Migration script — runs on every deploy BEFORE seed.
 * Uses "IF NOT EXISTS" and "ADD COLUMN" with error handling
 * so it's safe to run repeatedly on existing data.
 */

console.log("Running migrations...");

// Step 1: Create any tables that don't exist yet
initDb();

// Step 2: Add new columns to existing tables (safe — silently skips if column already exists)
function addColumn(table: string, column: string, type: string) {
  try {
    sqlite.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`  + Added ${table}.${column}`);
  } catch (e: any) {
    // "duplicate column name" means it already exists — that's fine
    if (!e.message?.includes("duplicate column")) {
      console.error(`  ! Error adding ${table}.${column}:`, e.message);
    }
  }
}

// ── Assets table additions (expanded from minimal schema) ──────
addColumn("assets", "category", "TEXT");
addColumn("assets", "manufacturer", "TEXT");
addColumn("assets", "model", "TEXT");
addColumn("assets", "serial_number", "TEXT");
addColumn("assets", "condition", "TEXT DEFAULT 'good'");
addColumn("assets", "purchase_date", "TEXT");
addColumn("assets", "purchase_cost", "REAL");
addColumn("assets", "warranty_expires", "TEXT");
addColumn("assets", "photo_url", "TEXT");
addColumn("assets", "created_at", "TEXT DEFAULT (datetime('now'))");
addColumn("assets", "updated_at", "TEXT DEFAULT (datetime('now'))");

// ── Jobs table additions ────────────────────────────────────────
addColumn("jobs", "show_on_board", "INTEGER NOT NULL DEFAULT 1");

// ── Classifications: add classification_group ──────────────────
addColumn("classifications", "classification_group", "TEXT");

// ── Action Items: add relational assigned_to_id FK ─────────────
addColumn("action_items", "assigned_to_id", "INTEGER");
addColumn("action_items", "completed_by", "TEXT");

// ── Future-proof: add any other columns that may have been added since initial deploy
addColumn("employees", "photo_url", "TEXT");
addColumn("employees", "pe_phone", "TEXT");
addColumn("employees", "personal_email", "TEXT");
addColumn("employees", "work_email", "TEXT");
addColumn("employees", "place_of_birth", "TEXT");
addColumn("employees", "jacket_size", "TEXT");
addColumn("employees", "background_check", "TEXT");
addColumn("employees", "background_check_date", "TEXT");
addColumn("employees", "reason_for_leaving", "TEXT");

// ── Users: add company_id for multi-company support ─────────────
addColumn("users", "company_id", "INTEGER REFERENCES companies(id)");

// ── Users: expand role CHECK to include super_admin ─────────────
// SQLite can't ALTER CHECK constraints, but the new CREATE TABLE in initDb()
// already has the updated CHECK. For existing DBs, we need to allow super_admin.
// SQLite CHECK constraints are only enforced on INSERT/UPDATE if they exist,
// and the column was created with the old CHECK. We handle this by:
// 1. The initDb() CREATE TABLE IF NOT EXISTS won't replace existing tables
// 2. We update the role directly with a raw query that bypasses Drizzle CHECK
//    (SQLite enforces CHECK at the engine level, so we need a workaround)
try {
  // Test if super_admin role is accepted
  sqlite.run(`UPDATE users SET role = role WHERE id = 0`); // no-op
  // If we have an existing DB with old CHECK, we need to recreate the table
  // But only if the CHECK actually blocks super_admin
  const testResult = sqlite.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as any;
  if (testResult?.sql && !testResult.sql.includes("super_admin")) {
    console.log("  Upgrading users table to support super_admin role...");
    sqlite.run("PRAGMA foreign_keys = OFF");
    sqlite.run(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'readonly' CHECK(role IN ('super_admin','admin','pm','readonly')),
      company_id INTEGER REFERENCES companies(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )`);
    sqlite.run(`INSERT INTO users_new (id, username, password_hash, display_name, role, company_id, is_active, created_at, last_login)
      SELECT id, username, password_hash, display_name, role, company_id, is_active, created_at, last_login FROM users`);
    sqlite.run("DROP TABLE users");
    sqlite.run("ALTER TABLE users_new RENAME TO users");
    sqlite.run("PRAGMA foreign_keys = ON");
    console.log("  + Users table upgraded");
  }
} catch (e: any) {
  console.error("  ! Error upgrading users table:", e.message);
}

// ── Seed default company if none exists ─────────────────────────
try {
  const companyCount = (sqlite.query("SELECT COUNT(*) as cnt FROM companies").get() as any)?.cnt || 0;
  if (companyCount === 0) {
    console.log("  Creating default company: Pueblo Electrics...");
    sqlite.run("INSERT INTO companies (name, short_name) VALUES ('Pueblo Electrics', 'PE')");
    const companyId = (sqlite.query("SELECT id FROM companies WHERE name = 'Pueblo Electrics'").get() as any)?.id;
    if (companyId) {
      // Assign all existing users to Pueblo Electrics
      sqlite.prepare("UPDATE users SET company_id = ? WHERE company_id IS NULL").run(companyId);
      console.log("  + All existing users assigned to Pueblo Electrics");
    }
  }
} catch (e: any) {
  console.error("  ! Error seeding default company:", e.message);
}

// ── S-14 FIX: Removed hardcoded username→super_admin promotion ──
// Your account is already super_admin in the DB. This block was a security
// risk because it ran on every deploy and would auto-promote anyone who
// registered with the username "jeremiah" in any tenant.
// To promote a user in the future, use the Admin UI or a one-time script.

// ══════════════════════════════════════════════════════════════════
// ── Multi-tenant migration: add company_id to all tenant tables ─
// ══════════════════════════════════════════════════════════════════

function columnExists(table: string, column: string): boolean {
  const cols = sqlite.query(`PRAGMA table_info(${table})`).all() as any[];
  return cols.some((c: any) => c.name === column);
}

// Get default company id for backfilling existing rows
const defaultCompany = sqlite.query("SELECT id FROM companies ORDER BY id LIMIT 1").get() as any;
const defaultCompanyId = defaultCompany?.id || 1;

// Add company_id to all tenant-scoped tables
const tenantTables = [
  "classifications",
  "jurisdictions",
  "jurisdiction_rates",
  "employees",
  "jobs",
  "assets",
  "employee_notes",
  "daily_log",
  "scheduled_moves",
  "action_items",
  "job_templates",
];

for (const table of tenantTables) {
  // SQLite cannot ALTER TABLE ADD COLUMN with both REFERENCES and a non-NULL DEFAULT.
  // Instead: add the column without REFERENCES, then backfill.
  // The FK constraint is enforced at the application layer by Drizzle ORM.
  if (!columnExists(table, "company_id")) {
    try {
      sqlite.run(`ALTER TABLE ${table} ADD COLUMN company_id INTEGER NOT NULL DEFAULT ${defaultCompanyId}`);
      console.log(`  + Added ${table}.company_id (default ${defaultCompanyId})`);
    } catch (e: any) {
      if (!e.message?.includes("duplicate column")) {
        console.error(`  ! Error adding ${table}.company_id:`, e.message);
      }
    }
  }
}

// ── Migrate settings to composite PK (company_id, key) ──────────
if (!columnExists("settings", "company_id")) {
  console.log("  Migrating settings to composite PK (company_id, key)...");
  try {
    sqlite.run("PRAGMA foreign_keys = OFF");
    sqlite.run(`
      CREATE TABLE settings_new (
        company_id INTEGER NOT NULL REFERENCES companies(id),
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (company_id, key)
      )
    `);
    sqlite.run(`INSERT INTO settings_new (company_id, key, value) SELECT ${defaultCompanyId}, key, value FROM settings`);
    sqlite.run("DROP TABLE settings");
    sqlite.run("ALTER TABLE settings_new RENAME TO settings");
    sqlite.run("PRAGMA foreign_keys = ON");
    console.log("  + Settings table migrated to composite PK");
  } catch (e: any) {
    console.error("  ! Error migrating settings:", e.message);
    sqlite.run("PRAGMA foreign_keys = ON");
  }
}

// ── Add company-scoped indexes (safe — skip if column doesn't exist yet) ──
const companyIndexes = [
  "CREATE INDEX IF NOT EXISTS idx_classifications_company ON classifications(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_jurisdictions_company ON jurisdictions(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_assets_company ON assets(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_daily_log_company ON daily_log(company_id, date)",
  "CREATE INDEX IF NOT EXISTS idx_action_items_company ON action_items(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_scheduled_moves_company ON scheduled_moves(company_id)",
];
for (const sql of companyIndexes) {
  try {
    sqlite.run(sql);
  } catch (e: any) {
    console.error(`  ! Index error: ${e.message}`);
  }
}

// ── UNIQUE constraints on business keys (prevent duplicates per company) ──
const uniqueIndexes = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_company_number ON employees(company_id, employee_number) WHERE employee_number IS NOT NULL AND employee_number != ''",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_company_number ON jobs(company_id, job_number) WHERE job_number IS NOT NULL AND job_number != ''",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_classifications_company_name ON classifications(company_id, name)",
];
for (const sql of uniqueIndexes) {
  try {
    sqlite.run(sql);
    console.log(`  + Created unique index: ${sql.match(/idx_\w+/)?.[0]}`);
  } catch (e: any) {
    if (e.message?.includes("already exists")) {
      // Already created — fine
    } else if (e.message?.includes("UNIQUE constraint failed")) {
      console.warn(`  ⚠ Duplicate data exists — cannot create unique index. Clean up duplicates first.`);
      console.warn(`    SQL: ${sql}`);
    } else {
      console.error(`  ! Unique index error: ${e.message}`);
    }
  }
}

// ── FK indexes for query performance (missing from original schema) ──
const fkIndexes = [
  "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_job_assignments_job ON job_assignments(job_id)",
  "CREATE INDEX IF NOT EXISTS idx_job_assignments_employee ON job_assignments(employee_id)",
  "CREATE INDEX IF NOT EXISTS idx_job_costs_job ON job_costs(job_id)",
  "CREATE INDEX IF NOT EXISTS idx_subcontracts_job ON subcontracts(job_id)",
  "CREATE INDEX IF NOT EXISTS idx_certifications_employee ON certifications(employee_id)",
  "CREATE INDEX IF NOT EXISTS idx_employee_notes_employee ON employee_notes(employee_id)",
  "CREATE INDEX IF NOT EXISTS idx_employees_classification ON employees(classification_id)",
  "CREATE INDEX IF NOT EXISTS idx_action_items_job ON action_items(job_id)",
  "CREATE INDEX IF NOT EXISTS idx_jurisdiction_rates_jur ON jurisdiction_rates(jurisdiction_id)",
  "CREATE INDEX IF NOT EXISTS idx_jurisdiction_rates_class ON jurisdiction_rates(classification_id)",
  "CREATE INDEX IF NOT EXISTS idx_opportunity_gcs_opp ON opportunity_gcs(opportunity_id)",
  "CREATE INDEX IF NOT EXISTS idx_opportunity_suppliers_opp ON opportunity_suppliers(opportunity_id)",
  "CREATE INDEX IF NOT EXISTS idx_opportunities_estimator ON opportunities(estimator_id)",
  "CREATE INDEX IF NOT EXISTS idx_assets_employee ON assets(assigned_to_employee)",
  "CREATE INDEX IF NOT EXISTS idx_assets_job ON assets(assigned_to_job)",
  // ── Batch 1 additions (D-02): missing FK indexes ──
  "CREATE INDEX IF NOT EXISTS idx_job_budgets_job ON job_budgets(job_id)",
  "CREATE INDEX IF NOT EXISTS idx_scheduled_moves_employee ON scheduled_moves(employee_id)",
  "CREATE INDEX IF NOT EXISTS idx_action_items_assigned ON action_items(assigned_to_id)",
  "CREATE INDEX IF NOT EXISTS idx_opportunity_gcs_gc ON opportunity_gcs(gc_company_id)",
  "CREATE INDEX IF NOT EXISTS idx_opportunity_gcs_company ON opportunity_gcs(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_opportunity_suppliers_supplier ON opportunity_suppliers(supplier_id)",
  "CREATE INDEX IF NOT EXISTS idx_opportunity_suppliers_company ON opportunity_suppliers(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_employee_notes_company ON employee_notes(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_job_templates_company ON job_templates(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_jurisdiction_rates_company ON jurisdiction_rates(company_id)",
  // ── Batch 2 additions (B-06): prevent double opportunity conversion at DB level ──
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_converted_unique ON opportunities(converted_job_id) WHERE converted_job_id IS NOT NULL",
  // ── Batch 1 additions (D-05): composite indexes for common queries ──
  "CREATE INDEX IF NOT EXISTS idx_employees_company_status ON employees(company_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_jobs_company_status ON jobs(company_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_opportunities_company_status ON opportunities(company_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_employees_company_class ON employees(company_id, classification_id)",
  "CREATE INDEX IF NOT EXISTS idx_action_items_company_job_status ON action_items(company_id, job_id, status)",
];
for (const sql of fkIndexes) {
  try {
    sqlite.run(sql);
  } catch (e: any) {
    // Silently skip — column may not exist yet
  }
}

// ── A-Systems Comprehensive Job Summary: expand project_finance_data ──
// Only hard actuals — BirdDog computes projections/margins dynamically
const summaryColumns: [string, string][] = [
  ["report_type", "TEXT DEFAULT 'detail'"],
  // Top-level actuals
  ["revised_contract_price", "REAL"],
  ["percent_complete", "REAL"],
  ["billed_to_date", "REAL"],
  ["cost_to_date", "REAL"],
  ["earned_to_date", "REAL"],
  ["received_to_date", "REAL"],
  ["paid_out_to_date", "REAL"],
  // Per-category actuals: pct complete, orig budget, curr budget, cost to date
  ["labor_pct_complete", "REAL"],
  ["material_pct_complete", "REAL"],
  ["subcontract_pct_complete", "REAL"],
  ["equipment_pct_complete", "REAL"],
  ["general_pct_complete", "REAL"],
  ["labor_orig_budget", "REAL"],
  ["material_orig_budget", "REAL"],
  ["subcontract_orig_budget", "REAL"],
  ["equipment_orig_budget", "REAL"],
  ["general_orig_budget", "REAL"],
  ["labor_curr_budget", "REAL"],
  ["material_curr_budget", "REAL"],
  ["subcontract_curr_budget", "REAL"],
  ["equipment_curr_budget", "REAL"],
  ["general_curr_budget", "REAL"],
  ["labor_cost_to_date", "REAL"],
  ["material_cost_to_date", "REAL"],
  ["subcontract_cost_to_date", "REAL"],
  ["equipment_cost_to_date", "REAL"],
  ["general_cost_to_date", "REAL"],
];

for (const [col, type] of summaryColumns) {
  addColumn("project_finance_data", col, type);
}

// ── Sort order + phone columns for GC companies and suppliers ──
addColumn("gc_companies", "sort_order", "INTEGER DEFAULT 0");
addColumn("gc_companies", "phone", "TEXT");
addColumn("suppliers", "sort_order", "INTEGER DEFAULT 0");
addColumn("suppliers", "phone", "TEXT");

// Index for report_type filtering
try {
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_pfd_report_type ON project_finance_data(report_type)");
} catch (e: any) { /* skip */ }

// ── Toolbox Talks enhancements ──
addColumn("toolbox_talks", "osha_standard", "TEXT");
addColumn("toolbox_talks", "completed_at", "TEXT");
addColumn("toolbox_talk_attendees", "signed_by_name", "TEXT");
addColumn("toolbox_talk_attendees", "signature_hash", "TEXT");
// Fix CHECK constraint to include 'presented' status — SQLite requires table rebuild
try {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS toolbox_talks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
      scheduled_date TEXT NOT NULL,
      topic TEXT NOT NULL,
      osha_standard TEXT,
      generated_content TEXT,
      presented_by INTEGER REFERENCES employees(id),
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','scheduled','presented','completed')),
      duration INTEGER,
      notes TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO toolbox_talks_new SELECT
      id, company_id, job_id, scheduled_date, topic, osha_standard,
      generated_content, presented_by, status, duration, notes,
      completed_at, created_at, updated_at
    FROM toolbox_talks;
    DROP TABLE toolbox_talks;
    ALTER TABLE toolbox_talks_new RENAME TO toolbox_talks;
  `);
  // Re-create indexes after table rebuild
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_toolbox_talks_company ON toolbox_talks(company_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_toolbox_talks_job ON toolbox_talks(job_id)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_toolbox_talks_date ON toolbox_talks(scheduled_date)");
  sqlite.run("CREATE INDEX IF NOT EXISTS idx_toolbox_talks_status ON toolbox_talks(status)");
} catch (e: any) {
  // If table already has the correct CHECK or column mismatch, skip
  console.log("toolbox_talks CHECK migration:", e.message);
}

// ══════════════════════════════════════════════════════════════════
// ── ExakTime Replacement: GPS time tracking + live locations ────
// ══════════════════════════════════════════════════════════════════

// Jobs: add geocoding + geofence
addColumn("jobs", "latitude", "REAL");
addColumn("jobs", "longitude", "REAL");
addColumn("jobs", "geofence_radius", "INTEGER DEFAULT 300");

// Time entries: clock in/out with GPS, photos, source
addColumn("time_entries", "clock_in", "TEXT");
addColumn("time_entries", "clock_out", "TEXT");
addColumn("time_entries", "clock_in_lat", "REAL");
addColumn("time_entries", "clock_in_lng", "REAL");
addColumn("time_entries", "clock_out_lat", "REAL");
addColumn("time_entries", "clock_out_lng", "REAL");
addColumn("time_entries", "clock_in_photo_url", "TEXT");
addColumn("time_entries", "clock_out_photo_url", "TEXT");
addColumn("time_entries", "clock_in_inside_geofence", "INTEGER");
addColumn("time_entries", "clock_out_inside_geofence", "INTEGER");
addColumn("time_entries", "clock_in_address", "TEXT");
addColumn("time_entries", "clock_out_address", "TEXT");
addColumn("time_entries", "source", "TEXT DEFAULT 'manual'");
addColumn("time_entries", "break_minutes", "INTEGER DEFAULT 0");
addColumn("time_entries", "lunch_out", "TEXT");
addColumn("time_entries", "lunch_in", "TEXT");
addColumn("time_entries", "geofence_approved_by", "INTEGER");
addColumn("time_entries", "geofence_approved_at", "TEXT");

// Live locations table (crew map — real-time pings from mobile/tablet)
try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS live_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL,
    altitude REAL,
    heading REAL,
    speed REAL,
    battery_level INTEGER,
    is_charging INTEGER,
    address TEXT,
    job_id INTEGER REFERENCES jobs(id),
    inside_geofence INTEGER,
    time_entry_id INTEGER REFERENCES time_entries(id),
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  console.log("  + Created live_locations table");
} catch (e: any) {
  if (!e.message?.includes("already exists")) {
    console.error("  ! Error creating live_locations:", e.message);
  }
}

// Indexes for time tracking queries
const timeTrackingIndexes = [
  "CREATE INDEX IF NOT EXISTS idx_time_entries_employee_date ON time_entries(employee_id, report_date)",
  "CREATE INDEX IF NOT EXISTS idx_time_entries_job_date ON time_entries(job_id, report_date)",
  "CREATE INDEX IF NOT EXISTS idx_time_entries_clock_in ON time_entries(clock_in) WHERE clock_in IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_time_entries_source ON time_entries(source)",
  "CREATE INDEX IF NOT EXISTS idx_live_locations_employee ON live_locations(employee_id, recorded_at)",
  "CREATE INDEX IF NOT EXISTS idx_live_locations_company ON live_locations(company_id, recorded_at)",
  "CREATE INDEX IF NOT EXISTS idx_live_locations_job ON live_locations(job_id)",
];
for (const sql of timeTrackingIndexes) {
  try { sqlite.run(sql); } catch (e: any) { /* skip */ }
}

// ── Time Entry Adjustments (audit trail) ────────────────────────
try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS time_entry_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    adjusted_by INTEGER NOT NULL REFERENCES employees(id),
    adjusted_at TEXT DEFAULT (datetime('now')),
    field_changed TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason TEXT NOT NULL
  )`);
  console.log("  + Created time_entry_adjustments table");
} catch (e: any) {
  if (!e.message?.includes("already exists")) console.error("  ! Error:", e.message);
}

// ══════════════════════════════════════════════════════════════════
// ── Mobile App: expand user roles + add employee_id link ────────
// ══════════════════════════════════════════════════════════════════

// Add employee_id column to users (links user account to employee record)
addColumn("users", "employee_id", "INTEGER REFERENCES employees(id)");

// Expand role CHECK constraint to include 'foreman' and 'field'
try {
  const usersSchema = sqlite.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as any;
  if (usersSchema?.sql && !usersSchema.sql.includes("foreman")) {
    console.log("  Upgrading users table to support foreman + field roles...");
    sqlite.run("PRAGMA foreign_keys = OFF");
    sqlite.run(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'readonly' CHECK(role IN ('super_admin','admin','pm','foreman','field','readonly')),
      employee_id INTEGER REFERENCES employees(id),
      company_id INTEGER REFERENCES companies(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )`);
    // Copy existing data — use NULL for employee_id if column didn't exist
    const hasEmployeeId = columnExists("users", "employee_id");
    if (hasEmployeeId) {
      sqlite.run(`INSERT INTO users_new (id, username, password_hash, display_name, role, employee_id, company_id, is_active, created_at, last_login)
        SELECT id, username, password_hash, display_name, role, employee_id, company_id, is_active, created_at, last_login FROM users`);
    } else {
      sqlite.run(`INSERT INTO users_new (id, username, password_hash, display_name, role, company_id, is_active, created_at, last_login)
        SELECT id, username, password_hash, display_name, role, company_id, is_active, created_at, last_login FROM users`);
    }
    sqlite.run("DROP TABLE users");
    sqlite.run("ALTER TABLE users_new RENAME TO users");
    sqlite.run("PRAGMA foreign_keys = ON");
    // Re-create session FK index
    try { sqlite.run("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)"); } catch {}
    console.log("  + Users table upgraded with foreman, field roles + employee_id");
  }
} catch (e: any) {
  console.error("  ! Error upgrading users table for mobile:", e.message);
  try { sqlite.run("PRAGMA foreign_keys = ON"); } catch {}
}

// ── Migration: Update user roles to field_staff (replace 'field' and 'readonly') ────
try {
  const checkInfo = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as any;
  if (checkInfo?.sql && !checkInfo.sql.includes("field_staff")) {
    console.log("Upgrading user roles to field_staff...");
    sqlite.run("PRAGMA foreign_keys = OFF");
    // Map old roles: 'field' → 'field_staff', 'readonly' → 'field_staff'
    sqlite.run("UPDATE users SET role = 'field_staff' WHERE role IN ('field', 'readonly')");
    sqlite.run(`CREATE TABLE users_v3 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'field_staff' CHECK(role IN ('super_admin','admin','pm','foreman','field_staff')),
      employee_id INTEGER REFERENCES employees(id),
      company_id INTEGER REFERENCES companies(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )`);
    sqlite.run(`INSERT INTO users_v3 (id, username, password_hash, display_name, role, employee_id, company_id, is_active, created_at, last_login)
      SELECT id, username, password_hash, display_name, role, employee_id, company_id, is_active, created_at, last_login FROM users`);
    sqlite.run("DROP TABLE users");
    sqlite.run("ALTER TABLE users_v3 RENAME TO users");
    sqlite.run("PRAGMA foreign_keys = ON");
    try { sqlite.run("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)"); } catch {}
    console.log("  + User roles updated: field_staff, foreman, pm, admin, super_admin");
  }
} catch (e: any) {
  console.error("  ! Error upgrading user roles:", e.message);
  try { sqlite.run("PRAGMA foreign_keys = ON"); } catch {}
}

// ══════════════════════════════════════════════════════════════════
// ── Time Entry Issues (clock in/out problems needing resolution) ──
// ══════════════════════════════════════════════════════════════════
try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS time_entry_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    time_entry_id INTEGER REFERENCES time_entries(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    issue_type TEXT NOT NULL CHECK(issue_type IN ('missed_clock_out', 'outside_geofence', 'missing_photo', 'excessive_hours')),
    issue_details TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'noted', 'approved', 'rejected')),
    employee_note TEXT,
    employee_noted_at TEXT,
    resolved_by INTEGER REFERENCES employees(id),
    resolved_at TEXT,
    manager_note TEXT,
    report_date TEXT NOT NULL,
    last_notified_at TEXT,
    detected_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  console.log("  + Created time_entry_issues table");
} catch (e: any) {
  if (!e.message?.includes("already exists")) console.error("  ! Error:", e.message);
}

// ── Push Notification Tokens ──────────────────────────────────────
try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS push_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    token TEXT NOT NULL,
    platform TEXT CHECK(platform IN ('ios', 'android')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  console.log("  + Created push_tokens table");
} catch (e: any) {
  if (!e.message?.includes("already exists")) console.error("  ! Error:", e.message);
}

// ── Indexes for issues + push tokens ──────────────────────────────
const issueIndexes = [
  "CREATE INDEX IF NOT EXISTS idx_issues_employee_status ON time_entry_issues(employee_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_issues_company_status ON time_entry_issues(company_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_issues_time_entry ON time_entry_issues(time_entry_id)",
  // Prevents duplicate issues: same time entry can only have one issue of each type
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_unique_per_entry ON time_entry_issues(time_entry_id, issue_type)",
  "CREATE INDEX IF NOT EXISTS idx_push_tokens_employee ON push_tokens(employee_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_unique ON push_tokens(employee_id, token)",
];
for (const sql of issueIndexes) {
  try { sqlite.run(sql); } catch (e: any) { /* skip */ }
}

// ══════════════════════════════════════════════════════════════════
// ── Announcements (Communicate feature) ─────────────────────────
// ══════════════════════════════════════════════════════════════════
try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    sent_by INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal', 'urgent')),
    audience TEXT NOT NULL CHECK(audience IN ('company', 'job', 'individual')),
    target_job_id INTEGER REFERENCES jobs(id),
    target_employee_id INTEGER REFERENCES employees(id),
    push_sent INTEGER DEFAULT 0,
    push_failed INTEGER DEFAULT 0,
    sent_at TEXT DEFAULT (datetime('now'))
  )`);
  console.log("  + Created announcements table");
} catch (e: any) {
  if (!e.message?.includes("already exists")) console.error("  ! Error:", e.message);
}

try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS announcement_reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    read_at TEXT DEFAULT (datetime('now'))
  )`);
  console.log("  + Created announcement_reads table");
} catch (e: any) {
  if (!e.message?.includes("already exists")) console.error("  ! Error:", e.message);
}

// Indexes for announcements
const announcementIndexes = [
  "CREATE INDEX IF NOT EXISTS idx_announcements_company ON announcements(company_id, sent_at)",
  "CREATE INDEX IF NOT EXISTS idx_announcements_audience ON announcements(audience, target_job_id, target_employee_id)",
  "CREATE INDEX IF NOT EXISTS idx_announcement_reads_ann ON announcement_reads(announcement_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_reads_unique ON announcement_reads(announcement_id, employee_id)",
];
for (const sql of announcementIndexes) {
  try { sqlite.run(sql); } catch (e: any) { /* skip */ }
}

// ── Time Correction Requests ──
try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS time_correction_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    time_entry_id INTEGER REFERENCES time_entries(id) ON DELETE CASCADE,
    issue_id INTEGER REFERENCES time_entry_issues(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    correction_type TEXT NOT NULL CHECK(correction_type IN ('missed_clock_out', 'wrong_time', 'wrong_job', 'other')),
    requested_clock_in TEXT,
    requested_clock_out TEXT,
    requested_job_id INTEGER REFERENCES jobs(id),
    note TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT,
    manager_note TEXT,
    report_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
} catch (e: any) {
  if (!e.message.includes("already exists")) console.warn("time_correction_requests:", e.message);
}

try { sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tcr_employee ON time_correction_requests(employee_id, status)`); } catch {}
try { sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tcr_company ON time_correction_requests(company_id, status)`); } catch {}

// ── Tool Reports ──────────────────────────────────────────────────
try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS tool_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    reported_by INTEGER NOT NULL REFERENCES employees(id),
    report_type TEXT NOT NULL CHECK(report_type IN ('damaged', 'lost', 'stolen', 'needs_maintenance', 'needs_calibration')),
    severity TEXT NOT NULL CHECK(severity IN ('can_still_use', 'out_of_service', 'safety_hazard')),
    description TEXT NOT NULL,
    photo_url TEXT,
    lat REAL,
    lng REAL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'acknowledged', 'in_repair', 'resolved')),
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT,
    resolution_note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
} catch (e: any) {
  if (!e.message.includes("already exists")) console.warn("tool_reports:", e.message);
}

try { sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tool_reports_asset ON tool_reports(asset_id, status)`); } catch {}
try { sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tool_reports_company ON tool_reports(company_id, status)`); } catch {}
try { sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tool_reports_reporter ON tool_reports(reported_by)`); } catch {}

// ── Tool History (immutable audit log) ──────────────────────────
try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS tool_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK(event_type IN (
      'assigned', 'unassigned', 'transferred', 'returned',
      'reported_damaged', 'reported_lost', 'reported_stolen',
      'reported_maintenance', 'reported_calibration',
      'sent_to_repair', 'repaired', 'calibrated',
      'condition_changed', 'status_changed', 'retired', 'created'
    )),
    employee_id INTEGER REFERENCES employees(id),
    job_id INTEGER REFERENCES jobs(id),
    from_employee_id INTEGER REFERENCES employees(id),
    to_employee_id INTEGER REFERENCES employees(id),
    note TEXT,
    report_id INTEGER REFERENCES tool_reports(id),
    performed_by INTEGER REFERENCES users(id),
    lat REAL,
    lng REAL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
} catch (e: any) {
  if (!e.message.includes("already exists")) console.warn("tool_history:", e.message);
}

try { sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tool_history_asset ON tool_history(asset_id)`); } catch {}
try { sqlite.run(`CREATE INDEX IF NOT EXISTS idx_tool_history_company ON tool_history(company_id)`); } catch {}

// ── Time Off Requests ──────────────────────────────────────────
try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS time_off_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    request_type TEXT NOT NULL CHECK(request_type IN ('paid_sick_leave', 'time_off', 'general_note')),
    start_date TEXT NOT NULL,
    end_date TEXT,
    hours_requested REAL,
    note TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT,
    manager_note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
} catch (e: any) {
  if (!e.message.includes("already exists")) console.warn("time_off_requests:", e.message);
}
try { sqlite.run(`CREATE INDEX IF NOT EXISTS idx_time_off_requests_employee ON time_off_requests(employee_id, status)`); } catch {}
try { sqlite.run(`CREATE INDEX IF NOT EXISTS idx_time_off_requests_company ON time_off_requests(company_id, status)`); } catch {}

// ── Employee PTO / Sick Balances ───────────────────────────────
try {
  sqlite.run(`CREATE TABLE IF NOT EXISTS employee_pto_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    balance_type TEXT NOT NULL CHECK(balance_type IN ('pto', 'sick')),
    accrued_hours REAL NOT NULL DEFAULT 0,
    used_hours REAL NOT NULL DEFAULT 0,
    adjusted_hours REAL NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, employee_id, balance_type)
  )`);
} catch (e: any) {
  if (!e.message.includes("already exists")) console.warn("employee_pto_balances:", e.message);
}
try { sqlite.run(`CREATE INDEX IF NOT EXISTS idx_pto_balances_employee ON employee_pto_balances(employee_id)`); } catch {}

console.log("Migrations complete.");
