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
// Add 'presented' status — SQLite doesn't support ALTER CHECK, status is just text

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

console.log("Migrations complete.");
