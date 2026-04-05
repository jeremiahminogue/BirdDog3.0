# BirdDog 2.0 — Multi-Tenant Plan

**Created:** 2026-03-31
**Status:** Planning

---

## Current State

The `companies` table and `users.companyId` already exist, but nothing else is scoped by company. Every query returns all rows for all companies. The `settings` table is a flat key/value store with no company dimension.

## Strategy: Row-Level Isolation via `companyId`

Every tenant-owned table gets a `company_id` column. Every query filters by the authenticated user's `companyId`. No separate databases — single SQLite file, shared schema, row-level filtering.

**Why this approach:** Keeps the stack simple (single Fly.io instance, single SQLite file), avoids schema duplication, and lets a `super_admin` see across companies if needed.

---

## Phase 1 — Schema Changes

Add `companyId` (NOT NULL, FK → companies.id) to these tables:

| Table | Notes |
|---|---|
| `settings` | Change PK from `key` to composite `(company_id, key)`. Each company gets its own companyName, companyLogo, etc. |
| `classifications` | Company-specific trade classifications |
| `jurisdictions` | Company-specific jurisdictions |
| `jurisdictionRates` | Inherits scope through jurisdiction, but explicit `company_id` makes queries simpler and safer |
| `employees` | Core — every employee belongs to a company |
| `jobs` | Core — every job belongs to a company |
| `assets` | Tools/vehicles are company-owned |
| `jobTemplates` | Meeting templates are company-specific |
| `actionItems` | Inherits scope through job, but explicit `company_id` for direct queries |
| `dailyLog` | Schedule snapshots are company-scoped |
| `scheduledMoves` | Future moves are company-scoped |
| `employeeNotes` | Inherits scope through employee |

**Tables that do NOT need `companyId`:**
- `companies` — is the tenant table itself
- `users` — already has `companyId`
- `sessions` — scoped through user
- `jobAssignments` — scoped through job (and we always query with job context)
- `jobBudgets` — scoped through job
- `jobCosts` — scoped through job
- `subcontracts` — scoped through job
- `certifications` — scoped through employee
- `templateItems` — scoped through template
- `projectFinanceData` — scoped through job

---

## Phase 2 — Auth & Middleware

### 2a. Inject `companyId` into request context

The existing auth middleware (`requireAuth`) already loads the user. Add `companyId` to the context object so every route handler has it available:

```
// After user lookup in requireAuth:
c.set("companyId", user.companyId);
```

### 2b. Create a query helper

Rather than manually adding `.where(eq(table.companyId, companyId))` to 90+ queries, create a scoped helper:

```typescript
// server/tenant.ts
export function tenantFilter(table: any, companyId: number) {
  return eq(table.companyId, companyId);
}
```

Or more idiomatically, a middleware that wraps DB access. But given the codebase size, the simplest approach is a `getCompanyId(c)` helper and adding the filter to each query.

### 2c. Super admin bypass

`super_admin` users may need to operate across companies (e.g., for support). Add a flag or header that lets super_admin queries skip the company filter or specify a target company.

---

## Phase 3 — Route-by-Route Query Updates

Every query that touches a tenant-scoped table needs the `companyId` filter. Grouped by file:

### routes.ts (~40 queries to update)

**Settings** — Change from `db.select().from(settings)` to `db.select().from(settings).where(eq(settings.companyId, companyId))`. Upserts need to include `companyId`.

**Classifications** — Add `.where(eq(classifications.companyId, companyId))` to GET. Include `companyId` in POST.

**Employees** — Add filter to GET list, GET by id, POST (include companyId), PUT, DELETE. The LEFT JOIN to classifications should also verify company match.

**Jobs** — Same pattern. GET list, GET by id, POST, PUT, DELETE all need company filter.

**Workforce Board** — The big aggregation query. Filter employees, jobs, budgets (via job), assignments (via job), and jurisdiction rates all by company.

**Jurisdictions & Rates** — Add filter to all CRUD. Bulk rate operations need company scoping.

**Assets** — Add filter to all CRUD operations.

**Users** — GET list should filter by company (except for super_admin). POST should inherit companyId from the creating admin.

**Companies** — Only super_admin should access this. No company filter needed (it IS the tenant table).

### schedule.ts (~12 queries)

**applyPendingMoves** — Filter `scheduledMoves` and `jobAssignments` by company.

**commit-day** — Filter dailyLog delete, employee select, assignment select by company.

**log GET** — Add company filter to the date-range query.

**moves CRUD** — All filtered by company.

**look-ahead** — Filter employees, assignments, moves, dailyLog, and jobs by company.

### meeting.ts (~10 queries)

**Action items CRUD** — Filter by company (in addition to jobId).

**Templates CRUD** — Filter by company.

**apply-template** — Verify template belongs to same company as the target job.

**snapshot** — Filter job lookup and items by company.

### reports.ts (~4 major queries)

**All report functions** — Filter jurisdictionRates, employees, jobs, and any aggregations by company.

### import.ts (~3 queries)

**Finance import** — Filter by company. Raw SQL queries need `WHERE company_id = ?`.

**A-Systems import** — Job lookup must be company-scoped so job numbers don't collide across tenants.

### auth.ts (minor changes)

**Login** — After user lookup, the companyId is already on the user object. No query changes needed, but validate the user's company `isActive`.

**Session validation** — Already scoped through user. Consider adding a check that the company is still active.

---

## Phase 4 — Migration Script

Since this is SQLite and we're pre-production (or early production with one company), the migration can be straightforward:

```sql
-- 1. Add columns with default pointing to company 1 (Pueblo Electrics)
ALTER TABLE classifications ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);
ALTER TABLE jurisdictions ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);
ALTER TABLE jurisdiction_rates ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);
ALTER TABLE employees ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);
ALTER TABLE jobs ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);
ALTER TABLE assets ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);
ALTER TABLE job_templates ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);
ALTER TABLE action_items ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);
ALTER TABLE daily_log ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);
ALTER TABLE scheduled_moves ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);
ALTER TABLE employee_notes ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1 REFERENCES companies(id);

-- 2. Recreate settings table with composite PK
CREATE TABLE settings_new (
  company_id INTEGER NOT NULL REFERENCES companies(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (company_id, key)
);
INSERT INTO settings_new (company_id, key, value) SELECT 1, key, value FROM settings;
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;

-- 3. Add indexes for the new column
CREATE INDEX idx_classifications_company ON classifications(company_id);
CREATE INDEX idx_jurisdictions_company ON jurisdictions(company_id);
CREATE INDEX idx_employees_company ON employees(company_id);
CREATE INDEX idx_jobs_company ON jobs(company_id);
CREATE INDEX idx_assets_company ON assets(company_id);
CREATE INDEX idx_daily_log_company ON daily_log(company_id, date);
```

---

## Phase 5 — Seed Script Update

Update `seed.ts` to thread `companyId` through all inserts. The PE data all gets `companyId: peCompany.id`. Add a second demo company if useful for testing.

---

## Phase 6 — Frontend Changes

Minimal frontend changes needed since the API handles scoping. But:

- **Settings page** — Already company-specific after API changes, no UI change needed.
- **Company switcher** — If super_admin needs to switch company context, add a dropdown in the nav (like the Workspace switcher pattern). Low priority — can be a future feature.
- **Login** — No change. User's company is determined by their account.

---

## Phase 7 — Unique Constraints

Some fields are implicitly unique today but will collide across companies:

| Field | Current | Multi-tenant |
|---|---|---|
| `employees.employeeNumber` | Unique globally | Unique per company — change to `UNIQUE(company_id, employee_number)` |
| `jobs.jobNumber` | Unique globally | Unique per company — change to `UNIQUE(company_id, job_number)` |
| `users.username` | Unique globally | Keep globally unique (simpler login, no "which company?" prompt) |
| `settings.key` | PK | Composite PK `(company_id, key)` |

---

## Execution Order

1. **Schema migration** — Add columns, create indexes, update constraints
2. **Auth middleware** — Inject `companyId` into context
3. **routes.ts** — Update all queries (biggest file, ~40 queries)
4. **schedule.ts** — Update scheduling queries
5. **meeting.ts** — Update meeting/template queries
6. **reports.ts** — Update report queries
7. **import.ts** — Update import queries (including raw SQL)
8. **seed.ts** — Thread companyId through all seed data
9. **Test** — Verify all routes return only company-scoped data
10. **Deploy**

---

## Risk Notes

- **Job number collisions**: Two companies could have job "2401". After multi-tenancy, the unique constraint must be `(company_id, job_number)` not just `job_number`.
- **Employee number collisions**: Same pattern — `(company_id, employee_number)`.
- **Raw SQL in import.ts**: These bypass Drizzle's type safety. Must manually add `WHERE company_id = ?` to raw queries.
- **Cascade deletes**: If a company is deleted, all child data should cascade. Add `ON DELETE CASCADE` to company_id FKs or handle in application code.
- **Photos/uploads**: Currently stored in a flat directory. Consider prefixing with `company_id/` to avoid filename collisions.
