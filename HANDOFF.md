# BirdDog 2.0 — Handoff & Technical Reference

**App URL:** https://pe-mgmt.fly.dev
**Status:** Running on Fly.io, dfw region
**Stack:** Bun + Hono + Drizzle ORM + SQLite (WAL mode) / Svelte 4 + Vite + Tailwind CSS + DaisyUI

---

## VISION

BirdDog 2.0 is Pueblo Electrics' all-in-one management platform replacing two legacy Microsoft Access databases that couldn't be accessed from the field.

- **Web app (office-side):** Collect, manage, and report. Clean Apple-inspired UI for workforce scheduling, project tracking, cost management, and financial analysis.
- **Future native app (field-side):** Clock in/out with GPS + photos, daily reports, checklists. See `BIRDOG-FIELD-PRD.md` for full specification.
- **Stack:** Bun + Hono backend, Svelte frontend, SQLite with WAL mode, deployed on Fly.io.
- **Manages:** Employees, job assignments, time tracking, project finances, budgets, assets, rates, jurisdictions, opportunities/bids, AI-assisted reporting.

---

## PENDING DEPLOY — RUN THIS FIRST

```bash
fly deploy
```

**Critical fixes** (app is broken without these):

1. **Zod schema rewrite** (`server/validation.ts`)
   Root cause: Frontend forms send strings for numbers (`"5"` not `5`) and empty strings for nulls. All schemas now use `z.preprocess()` for coercion + `.passthrough()` to allow unknown fields. Fixes 400 errors on POST /employees, POST /jobs.

2. **Dockerfile volume permission fix**
   Fly.io volumes mount as root but app runs as `birddog` user. Added runtime `chown -R birddog:birddog /app/data` before app start. Fixes "attempt to write a readonly database" error.

**New features & bug fixes:**

3. **Jobs delete confirmation** — Modal shows dependency counts (assignments, costs, budgets). New `GET /api/jobs/:id/delete-check` endpoint.

4. **Employee deactivation** — Now properly clears assignments via `await db.update()` (was fire-and-forget).

5. **Multi-job prevention** — `POST /assignments` deactivates ALL active assignments before creating new one. Prevents employee on 2+ jobs simultaneously.

6. **Drag-and-drop race condition fix** — `POST /assignments/move` validates SELECT before deactivating + deactivates by row ID.

7. **iOS glass-style badges** — All DaisyUI badges site-wide now have frosted glass: `backdrop-filter: blur(16px)`, translucent tinted backgrounds, hairline borders, `border-radius: 100px`.

8. **Delete jurisdiction fix** — Was throwing FK constraint error because `jobs.jurisdictionId` references `jurisdictions.id` without CASCADE. Fix: sets linked jobs' `jurisdictionId` to null before deleting.

9. **Admin page cleanup** — Removed duplicate GC Companies and Suppliers sections (they have dedicated pages under People sidebar).

10. **Meeting page tooltips** — Health Score and CPI cards now show hover tooltips explaining how each metric is calculated.

11. **Schedule page polish** — Job sort moved before Person, defaults to 3-week view, job name text darkened, classification names expanded (no more 3-char truncation), date range label reactivity fix.

12. **Job Board → Schedule link** — "Schedule" button in WorkforceBoard page header (next to date nav) navigates to Schedule page.

13. **Meeting tool polish** — Centered "Project Meetings" page title. Job navigator arrows inset (`max-width: 640px; margin: 0 auto`), border added, slightly larger/darker SVGs.

14. **Reports nav simplification** — Removed expandable dropdown from sidebar. Reports is now a standalone nav button (like Workforce Board). Clicking it goes straight to the Reports page.

15. **Reports page rewrite** — Card-based grid layout (4 sections: Workforce, Jobs & Labor, Assets, Financial). Clickable cards with hover states, Excel download buttons, inline dropdowns for Employee Profile and Job Labor Cost. Financial Dashboard card has featured primary-color styling. `.rpt-` prefix CSS.

**Deploy checklist:**

- [ ] Add/edit employee (was returning 400)
- [ ] Add/edit job (was returning 400)
- [ ] Delete job with confirmation modal
- [ ] Workforce board: drag employee between jobs
- [ ] Deactivate employee → verify disappears from board
- [ ] Sidebar: expand/collapse sections and icon-only mode
- [ ] Time Tracking, Daily Reports, Toolbox Talks pages load without error
- [ ] AI chat works with jobs/employees

---

## DATA FLOW ARCHITECTURE

**Time Entries = source of truth.** Clock in/out with GPS + photos = the raw data.

- **Time Entries** — `time_entries` table: GPS coordinates, geofence status, photos, source (mobile/tablet/manual/kiosk), regular/OT/DT hours, break time
- **Daily Reports** — Grouped view of time entries by job+date. Not separate data entry. Will auto-populate from time entries. `daily_reports` table + `job_photos` + crew roster from active job_assignments
- **Workforce Board** — Planned assignments (drag-and-drop). Remains as planned view. Future: red badge when employee clocked in at wrong job
- **Crew Tracker** — Deferred. On-demand manual refresh only (no auto-refresh to save API calls)
- **Rates** — Jurisdiction-based only. No classification-level rates. `jurisdiction_rates` keyed by `jurisdiction_id + classification_id`
- **Multi-tenant** — Row-level isolation via `company_id` on 12+ tables. All queries scoped by `getCompanyId()` helper in `server/tenant.ts`

---

## CURRENT SYSTEM STATUS

### Workforce Board
Drag-and-drop employee assignment board with employee cards (photo/initials, name, classification) and job cards (job#, address, crew, progress bars). Bench management. Filters by classification, job, status. `client/src/pages/WorkforceBoard.svelte`.

### Jobs
Full CRUD with Google Places v1 address picker, geocoding, delete with dependency check. Mobile switches to card layout. Columns: job#, address, GC, foreman, assigned crew, budget, hours, status. `client/src/pages/Jobs.svelte`.

### Time Tracking (ExakTime Replacement)
**Schema:** `time_entries` with GPS coords (lat/lng), geofence status, photos, source tracking, regular/OT/DT hours, break minutes, lunch out/in, work performed.

**API endpoints** (`server/time-tracking.ts`):
- `POST /clock-in` — GPS, photo, geofence check
- `POST /clock-out` — Auto-calculates hours
- `POST /break` — Lunch start/end + break minutes
- `POST /location-ping` — Periodic GPS from mobile
- `GET /entries` — Filterable list (job, employee, date, source, flagged)
- `GET /entries/:id` — Detail with GPS trail + photos + static map
- `POST /entries` — Manual office entry
- `PUT /entries/:id` — Edit hours/notes
- `DELETE /entries/:id` — Remove entry
- `POST /entries/:id/adjust` — Log change with reason to `time_entry_adjustments` table
- `GET /entries/:id/adjustments` — Audit trail
- `GET /stats/summary` — Daily totals, flagged counts, source breakdown
- `GET /employee-status` — Who's clocked in
- `PUT /jobs/:id/location` — Set GPS + geofence radius
- `POST /seed/time-tracking` — Generate test data (super_admin only)

**Office UI** (`client/src/pages/TimeTracking.svelte`):
- Dashboard cards (6-col grid): Crew This Week (stacked avatar circles, click opens crew list modal), No Activity (employees with zero hours, click opens list), Total Hours (avg/person), Regular (% of total), OT/DT (% breakdown), Issues (pill breakdown: missing/geo/break/excess)
- Weekly payroll grid: employees × 7 days, reg/OT/DT columns, flagged count per employee
- Issue detection: red/yellow/green status per entry. Red = missing clock in/out. Yellow = geofence violation or missing break on 6+ hr shift.
- Employee row glow: left-border + bg tint (red for missing clock, yellow for other issues), hover tooltips
- Detail modal: clock in/out with GPS, address, geofence badge, photos, static map, hours breakdown, work notes
- Adjustments modal: edit clock in/out times, auto-calculates hours (8hr regular → OT → DT), blocks negative time, warns on 12+ hours, required reason field
- Audit trail: all previous adjustments with who/what/when/why
- Filters: date range, job, employee, source, flagged-only checkbox (catches all red AND yellow issues)
- Weekly navigation with "This Week" button
- Crew/No Activity modal: click stacked avatars to see full employee list

**Audit Trail:** `time_entry_adjustments` table (immutable records): id, timeEntryId, adjustedBy, adjustedAt, fieldChanged, oldValue, newValue, reason.

**Google Maps proxy** (`server/maps.ts`):
- `GET /maps/autocomplete` — Address autocomplete (Places API v1)
- `GET /maps/place-details` — Place ID → full address + lat/lng
- `GET /maps/geocode` — Raw address → lat/lng
- `GET /maps/reverse-geocode` — Lat/lng → street address
- `GET /maps/static-map` — Static map image with markers (key never reaches browser)
- All requests server-side only. Key stored as Fly.io secret.

**AddressPicker component** (`client/src/components/AddressPicker.svelte`):
- Debounced autocomplete with keyboard navigation
- Green pin indicator when geocoded
- Auto-fills lat/lng on selection
- Dropdown positioned via `position: fixed` to escape modal overflow contexts

### Daily Reports
**Schema:** `daily_reports` (id, companyId, jobId, reportDate, submittedBy FK, status, weather fields, work performed, areas, delays, safety/material notes, reviewedBy FK, reviewedAt, notes), `time_entries` (linked via dailyReportId), `job_photos`.

**API** (`server/daily-reports.ts`):
- `GET /daily-reports/` — List with job/date/status filters, subquery counts
- `GET /daily-reports/:id` — Single report with time entries + photos + crew roster
- `POST /daily-reports/` — Create (office can create on behalf of foreman)
- `PUT /daily-reports/:id` — Update, auto-sets reviewedBy/At when status="reviewed"
- `DELETE /daily-reports/:id` — Super_admin only
- `GET /daily-reports/time-entries/by-date` — With filters
- `POST /daily-reports/time-entries` — Single entry
- `POST /daily-reports/time-entries/batch` — Batch add for crew auto-populate
- `PUT /daily-reports/time-entries/:id` — Update entry
- `DELETE /daily-reports/time-entries/:id` — Delete entry
- `GET /daily-reports/crew/:jobId` — Active crew for job
- `GET /daily-reports/stats/summary` — Dashboard stats
- **Static routes defined BEFORE /:id** to prevent Hono collision

**Office UI** (`client/src/pages/DailyReports.svelte`):
- Split layout: sortable report list + detail panel slide-in
- Stats row with clickable filters (Total, Draft, Submitted, Reviewed)
- Search, job filter, date range filters
- 7 sortable columns: Date, Job, Submitted By, Hours, Crew, Status, Weather
- Detail panel: weather, work performed, areas, delay section (amber), safety notes, time entries table, photo grid, general notes, review workflow
- Create modal: job selector, auto-populates crew in submitter dropdown
- `.dr-` prefix CSS, responsive

**Future:** Will auto-populate time entries from time_entries table instead of separate data entry.

### Toolbox Talks
**Schema:** `toolbox_talks` (id, company_id, job_id, scheduled_date, topic, osha_standard, generated_content, presented_by FK, status [draft/scheduled/presented/completed], duration, notes, completed_at), `toolbox_talk_attendees` (id, talk_id, employee_id, signed_at, signed_by_name, signature_hash).

**API** (`server/toolbox-talks.ts`):
- `GET /toolbox-talks/` — List with filters (jobId, status, dateFrom, dateTo). Returns attendee_count + signed_count.
- `GET /toolbox-talks/stats/summary` — Counts by status (draft/scheduled/presented/completed)
- `GET /toolbox-talks/topics` — Full OSHA topic library (30 topics with CFR references, categorized: Electrical, General, Emergency, Rigging)
- `GET /toolbox-talks/topics/suggestions` — Flat topic name list (backward compat)
- `GET /toolbox-talks/crew/:jobId?date=YYYY-MM-DD` — Crew list from today's clock-ins, falls back to workforce board assignments. Returns `{ crew, source }`.
- `GET /toolbox-talks/:id` — Detail with full attendee list (names, classifications, sign status, signature_hash)
- `POST /toolbox-talks/` — Create. Auto-populates attendees from crew if jobId provided. Auto-looks up OSHA standard from topic library.
- `PUT /toolbox-talks/:id` — Dynamic field update (PATCH-style)
- `DELETE /toolbox-talks/:id` — Admin only
- `POST /toolbox-talks/:id/generate` — AI content generation via Anthropic API. Generates full ready-to-present talk with OSHA citations, hazards, procedures, discussion questions. Falls back to template if no API key.
- `POST /toolbox-talks/:id/attendees` — Add single (duplicate prevention)
- `POST /toolbox-talks/:id/attendees/batch` — Auto-populate from clock-ins/assignments
- `DELETE /toolbox-talks/:id/attendees/:attendeeId` — Remove
- `PUT /toolbox-talks/:id/attendees/:attendeeId/sign` — Tap-to-acknowledge. Generates SHA-256 signature_hash (`empId|talkId|contentHash|timestamp`), captures signed_by_name + timestamp. Auto-completes talk when all attendees signed.
- `GET /toolbox-talks/:id/export` — Printable HTML document (open in webview → print-to-PDF). Includes header, OSHA reference, talk content, attendee sign-off table, OSHA compliance footer.
- Permissions: admin, pm, foreman (not general users). Delete is admin-only.

**Office UI** (`client/src/pages/ToolboxTalks.svelte`):
- Split layout: 380px scrollable list panel + detail panel
- Status filter pills (all/scheduled/presented/completed/draft) with counts, job filter dropdown
- List items: topic, job number tag, date, presenter, status glass badge, signature count (signed/total)
- Detail panel: topic header with OSHA standard badge, 2-col meta grid (job, date, presenter, duration, status, completed date)
- Talk content section: AI generate button (sparkle icon), inline edit, regenerate. Shows loading spinner during generation.
- Attendee section: avatar + name + classification, signed tag (hover shows signature hash), sign button, remove button, auto-populate from crew, add-attendee dropdown
- Action bar: status progression buttons (Schedule → Mark Presented → Complete), Export PDF, Delete (admin only)
- Create modal: job selector with crew preview (shows crew from clock-ins with source label), date+duration row, topic selector with category filter pills (All/Electrical/General/Emergency/Rigging), OSHA standard display, presenter selector, notes
- `.tt-` prefix CSS, oklch() color tokens, glass status badges, responsive (single column below 960px)

**Also consumed by native field app** — API endpoints shared between office UI and future mobile app.

### Change Orders
**Schema:** `change_order_requests` (id, company_id, job_id, request_number COR-001, title, description, requested_by FK, assigned_to FK, status, priority, estimated_cost/hours, estimate_notes, location, due_date, approved_by/at, rejection_reason, notes), `change_order_photos`.

**API** (`server/change-orders.ts`):
- `GET /change-orders/` — List with filters, JOINs + photo count
- `GET /change-orders/stats/summary` — Status counts, total cost, priority breakdown
- `GET /change-orders/next-number/:jobId` — Auto-generate COR-###
- `GET /change-orders/estimators` — Active employees for dropdown
- `GET /change-orders/:id` — Detail with photos
- `POST /change-orders/` — Create (auto-generates number)
- `PUT /change-orders/:id` — Update with status transition logic (assigned/estimated/approved/rejected)
- `DELETE /change-orders/:id` — Delete
- `POST /change-orders/:id/photos` — Add photo
- `DELETE /change-orders/:id/photos/:photoId` — Remove photo
- All super_admin gated

**UI** (`client/src/pages/ChangeOrders.svelte`):
- Pipeline/Kanban view: 6 columns (Draft → Submitted → Assigned → Estimated → Approved → Rejected)
- List view: Sortable table alternative
- Detail panel with context-sensitive workflow actions
- Estimation form, estimator assignment, approve/reject buttons
- Photo grid
- Priority/status color coding
- `.co-` prefix CSS

### Project Meetings
Renamed "Meeting Notes" → "Project Meetings". Widened to 960px.

**Schema:** `action_items` (id, company_id, job_id, description, assigned_to text role label, assigned_to_id FK employee, priority, due_date, status, completed_by, notes, sortOrder, timestamps), `meeting_templates` (id, company_id, name, description), `meeting_template_items` (id, template_id, description, assigned_to role, priority, sortOrder).

**API** (`server/meeting.ts`):
- `GET /meeting/job-metrics?jobId=X` — Returns hour budget/used, crew count, foreman, CPI, % complete, health score (0–100 composite), risk flags
- `GET /meeting/templates/:id/items` — List template items
- `PUT /meeting/templates/:id` — Update template name/description
- `POST /meeting/templates/:id/items` — Add item to template
- `PUT /meeting/template-items/:id` — Update item
- `DELETE /meeting/template-items/:id` — Delete item
- `GET /meeting/items?jobId=X` — List action items (LEFT JOINs employees for assigned_to_id resolution)
- `POST /meeting/items` — Create
- `PUT /meeting/items/:id` — Update (single-field PATCH)
- `PUT /meeting/items/reorder` — Batch sortOrder update (CRITICAL: defined BEFORE /:id)
- `DELETE /meeting/items/:id` — Delete
- `POST /meeting/snapshot` — Create snapshot

**Office UI** (`client/src/pages/MeetingTool.svelte`):
- Mini dashboard: Health Score (ring gauge), Hours (progress bar), Crew (count + foreman), CPI, % Complete (cards)
- Inline editable table: drag grip | checkbox (done) | priority dot | description | assignee select | due date | status | actions
- **Inline editing:** Every field auto-saves on blur/change. Single-field PATCH.
- **Priority cycling:** Click dot to cycle low → normal → high → urgent (colors change)
- **Stale detection:** Items open 14+ days or past due get yellow left border + "Xd overdue/open" tag
- **Notes expansion:** Chevron on all items, expandable sub-row with textarea
- **Drag-to-reorder:** 6-dot grip handle on open items, blue underline on drop target
- **Completion tracking:** When marked done, saves `completedBy` and displays "Apr 2 by Jeremiah" in green tag
- **Assignee dual-field:** Dropdown shows employees (via `emp:{id}` format) + role labels (PM, Foreman, etc.)
- Job status dropdown (color-coded: green=active, blue=planning, purple=completed, gray=closed)
- Centered page title: "Project Meetings"
- Job navigator with prev/next and dropdown selector, constrained to 640px centered, arrows with visible borders
- Crew avatars: stacked overlapping circles, shows up to 6 faces + "+N" badge, click to expand panel listing all crew
- Template manager: left sidebar with template list, right panel for inline editing
- `.mt-` prefix CSS

**Schema change:** `assigned_to_id` integer FK on `action_items` referencing `employees(id)`. Dual-field: `assigned_to` (role text) OR `assigned_to_id` (employee FK). GET queries LEFT JOIN and return `assignedName` computed field.

### Workforce Board — Date Navigation (V2, 2026-04-05)
**The board is now the single scheduling input tool.** Today's view shows reality (direct assignment changes). Arrow forward to future dates to see projected board state, drag-and-drop to schedule moves. Employee cards show pending move tags.

**Key design decisions:**
- **Single input surface:** All scheduling happens on the Workforce Board via drag-and-drop. Schedule page is read-only.
- **Today = direct:** Drag on today's board calls `POST /assignments` (immediate assignment change).
- **Future = scheduled:** Drag on a future date calls `POST /schedule/moves` (creates scheduled move with effectiveDate = board date).
- **Auto-apply:** `applyPendingMoves()` runs on schedule look-ahead load (applies moves where effectiveDate ≤ today).
- **Auto-commit:** Today's assignment state auto-snapshots to `daily_log` on first page load of the day.
- **Pending move tags:** EmployeeCard shows "→ 601 4/10" pill for upcoming moves. Visible on all date views.

**API changes:**
- `GET /workforce-board?date=YYYY-MM-DD` — If date is future, builds projected board state by walking `scheduledMoves` in date order on top of current `jobAssignments`. Also returns `pendingMoves[]` array for tag display.
- `DELETE /schedule/moves/clear-range?employeeId=&from=&to=` — Bulk-clear unapplied moves for employee in date range. Must be declared before `/moves/:id` route (Hono route order).

**WorkforceBoard UI** (`client/src/pages/WorkforceBoard.svelte`):
- **Date nav:** ‹/› arrow buttons step by weekday. "Today" button snaps back. Orange "Future" badge when viewing ahead.
- **Schedule link:** "Schedule" pill button in header (next to date nav). Navigates to read-only Schedule page.
- **Drag branching:** `isFuture` flag determines whether drops call `/assignments` or `/schedule/moves`.
- `.wfb-date-nav`, `.wfb-future-badge` CSS.

**EmployeeCard** (`client/src/components/EmployeeCard.svelte`):
- New `pendingMove` prop. Right column layout: rate on top, move tag below.
- Move tag format: "Moving {date} to {jobNumber}" (or "to Bench"). Blue pill style.
- `.emp-right-col`, `.emp-rate`, `.emp-move-tag` CSS.

**JobCard** (`client/src/components/JobCard.svelte`):
- New `empMoveMap` prop (Map<number, PendingMove>). Passes pendingMove to each EmployeeCard.

### Schedule (Read-Only Timeline, V2, 2026-04-05)
**Rewritten as read-only.** All drag/drop/modal/resize code removed. Pure resource chart visualization. Legend says "Use the Workforce Board to schedule moves."

**Schema:** `scheduledMoves` (id, company_id, employee_id, to_job_id, effective_date, applied, notes, created_at), `dailyLog` (id, company_id, date, employee_id, job_id), `jobAssignments` (active assignments — source of truth for current state).

**API** (`server/schedule.ts`):
- `GET /schedule/look-ahead?start=&weeks=&skipApply=` — Main endpoint. Returns per-employee per-date grid. `skipApply=1` skips auto-apply (used by board after drag saves).
- `POST /schedule/moves` — Create scheduled move (overwrites existing unapplied move for same employee+date)
- `DELETE /schedule/moves/clear-range` — Bulk-clear (see above)
- `DELETE /schedule/moves/:id` — Cancel single move
- `GET /schedule/moves` — List pending (unapplied) moves

**UI** (`client/src/pages/Schedule.svelte`):
- **Read-only resource chart:** Employees as rows, dates as columns, job bars on grid. No drag, no modals.
- **Sort modes:** Person, Job (default), Classification.
- **Bars:** Colored by job hue, show **job number (bold) + job name** (lighter weight). Day count badge on bars >2 days. Dashed = scheduled.
- **Week nav:** ‹/› arrows, week range label, "Today" pill, 1w/2w/3w toggle.
- **Responsive:** Same breakpoints as before.
- `.sch-` prefix CSS. ~160 lines (down from ~800).

### A-Systems Dual Import
Two weekly PDFs coexist in `project_finance_data` table via `report_type` discriminator:

**Detail Report** (`report_type = 'detail'`):
- Parser: `server/parse-asystems.py` (pdfplumber)
- Endpoint: `POST /api/import/asystems`
- Fields: hour_budget, hours_used, labor/material/general budget+cost, total_contract
- Re-import: Deletes only detail rows, summary untouched

**Comprehensive Job Summary** (`report_type = 'summary'`):
- Parser: `server/parse-summary.py`
- Endpoint: `POST /api/import/asystems-summary`
- Fields (actuals only): revised_contract_price, percent_complete, billed/cost/earned/received/paid_out to_date, per-category (labor/material/subcontract/equipment/general) pct_complete, orig/curr_budget, cost_to_date
- Re-import: Deletes only summary rows, detail untouched
- **Design:** Only import hard actuals. All calculated values (profit, rates, projections) computed client-side so BirdDog owns the formulas.

**Parser fixes** (2026-04-02):
- billedToDate + costToDate on same PDF line → regex extracts number after each label
- percentComplete in "Times 98.72% Yields" pattern → matches with fallback to "percent complete"
- paidOutToDate empty on first occurrence, wrong number on (Subtract) line → skip (Subtract), regex only if number immediately follows colon
- receivedToDate skips (Subtract) lines

**No-budget job handling:** Detects via `hasBudget()` (any category `curr_budget > 0`). Shows "No Budget" warning, dims row (opacity-60), suppresses % complete bar and profit metrics, but shows dollar actuals.

**Report type query fix:** ANY query on `project_finance_data` must filter by `report_type` unless intentionally querying both. Fixed in routes.ts, reports.ts.

**Job card progress bars:** 2×2 grid (Hours, Material, Equipment, General, half-width each). Discrete styling (2px track, 9px label). Green default, yellow at 80%+, red at 100%+. Only render if category has budget > 0.

**UI** (`client/src/pages/ASystemsImport.svelte`): Page titled "Import Accounting". Two upload buttons: "A-Systems Analysis" (detail report) and "A-Systems Summary" (job summary). Tab switcher, expandable rows with per-category breakdown. Structure designed to support future import buttons for other accounting systems.

### Financial Reports
Six admin-only interconnected reports in `server/reports.ts` with shared Apple-style CSS/JS and pill navigation:

1. **Executive Financial Dashboard** — Merges detail+summary data. Cash KPIs (net cash, billed, received, outstanding AR), earned value charts, 7 KPIs, 7 Chart.js visualizations, 5 sortable tables

2. **Job Health Scores** — Composite 0–100 score per job (Budget 30%, Hours 20%, Profit 25%, Schedule 15%, Cash 10%). Color-coded badges, risk flags, per-factor sub-scores. Sortable.

3. **Cash Position** — Billing, collections, disbursement. Shows billed vs received vs paid out per job, net cash, outstanding AR, collection rates. 4 charts + detail table.

4. **Earned Value & Billing Analysis** — CPI, billing gaps (billed vs earned), estimated cost at completion, projected profit. 4 charts + 12-column detail table.

5. **Budget Variance** — Category-level deep dive (labor, material, subcontract, equipment, general) per job. Highlights change orders. Click-to-expand rows. 7 charts + per-category detail.

6. **Backlog & Projections** — Forward-looking. Contract minus billed = remaining backlog, current budget minus cost = remaining cost, projected margin. Company-wide backlog KPI. 4 charts + detail table.

All gracefully degrade when summary data not imported (shows prompt). "Paid out" computed from sum of 5 category cost_to_date fields (not unreliable PDF parser).

**Files:** `server/reports.ts` with shared `financeCSS()`, `financeJS()`, `financeNav()` helpers, `sumCatCost()` for paid-out calculation. `client/src/pages/Reports.svelte` — card-based grid layout with 4 sections (Workforce, Jobs & Labor, Assets, Financial). Each card is clickable to run report in new tab. Excel download buttons. Inline dropdowns for Employee Profile and Job Labor Cost. `.rpt-` prefix CSS.

### Assets (Tools & Vehicles)
Milwaukee One-Key style redesign. `client/src/pages/Tools.svelte`.

**Changes:**
- Default to list view (sortable table), grid toggle available
- 9 sortable columns: Tool, Category, Manufacturer, S/N·Tag, Assigned To, Status, Condition, Cost
- Status/condition colored dots (green=available, blue=assigned, orange=maintenance, gray=retired)
- Clickable stats row (filters on click)
- Checkbox column with select-all + batch delete
- Search with clear button
- 32px square photo thumbnail in description column
- Employee avatar initials (small circle)
- Responsive: hides Category, Manufacturer, Condition, Cost on mobile
- Apple-style `.tl-` CSS
- Grid view: smaller cards (220px min), status badges on image overlay
- Modal: add/edit form with `.tl-` CSS

No API changes needed.

### General Contractors & Suppliers
Standalone dedicated pages under Admin dropdown. Identical pattern.

**Features:**
- Inline editable table (click cell → edit → auto-save on blur)
- Drag-to-reorder via 6-dot grip handle (new `sort_order` column)
- Checkbox column for multi-select (admin only)
- Batch delete with confirmation (shows which can't delete due to linked opportunities)
- Add form at bottom (Enter-to-submit)
- Apple-style `.rl-` CSS

**API** (`server/opportunities.ts`):
- `PUT /gc-companies/reorder` — batch sort order
- `POST /gc-companies/batch-delete` — multi-delete with validation
- `PUT /suppliers/reorder` — batch sort order
- `POST /suppliers/batch-delete` — multi-delete with validation
- **Static routes defined BEFORE /:id**

**Files:** `client/src/pages/GeneralContractors.svelte`, `client/src/pages/Suppliers.svelte`

### Navigation
**Sidebar** (`client/src/components/Navbar.svelte` — complete rewrite):
- Fixed left: 240px expanded, 56px collapsed (icon-only)
- Apple glass background, `backdrop-filter: blur(20px)`, right border
- Collapse toggle inside logo row (right side)
- Mobile: hidden by default, hamburger opens slide-out drawer with backdrop overlay
- `.sb-` prefix CSS

**Structure (role-gated):**
- Top: Workforce Board, Jobs, Opportunities, Timekeeping (standalone — moved out of Field)
- People (expandable): Employees, General Contractors (admin), Suppliers (admin)
- Assets (expandable): Tools, Vehicles
- Field (expandable, super_admin only): Crew Tracker, Daily Reports, Toolbox Talks, Change Orders
- Project Tools (expandable): Schedule, Project Meetings, Import Accounting (admin)
- Reports — standalone button (not expandable), pm/admin gated, navigates directly to Reports page
- AI Chat — standalone purple gradient button with "AI" badge near bottom of sidebar
- Bottom — Settings (expandable, admin): Admin Panel, Classifications, Jurisdictions
- Bottom — User info + Sign Out
- No divider between Opportunities and People sections
- BirdDog logo slightly enlarged (scale 1.15)

**Design principle:** Every item looks the same. Section parents identical to regular items (0.8125rem font, same padding, 18px icons). Chevron on right indicates open/closed. Children indented.

**Sections start closed.** Click to expand/collapse. **Collapsed mode:** Icon-only, no labels/chevrons, children hidden. **Active state:** Left border accent (#007aff, 3px), light blue background (#f0f6ff), font-weight 600. **State management:** `sidebarCollapsed` store, shared between Navbar and App.svelte.

**App.svelte layout:** `display: flex` with sidebar + main content. `app-main` has `margin-left: 240px` (or 56px collapsed). Mobile: no margin, `padding-top: 3.5rem`.

### AI Chat
Schema-aware, SELECT-only SQL with parameterized queries. `server/chat.ts`.

**Features:**
- Blocks INSERT/UPDATE/DELETE/DROP/ALTER/PRAGMA
- No recursive CTEs
- Result cap 200 rows
- No error detail leaks
- Parameterized queries via `sqlite.prepare()`

**Gap:** Doesn't inject user's `company_id` into system prompt (multi-tenant isolation). Fix when adding second company.

### Admin
User management, company settings, import tools. `client/src/pages/Admin.svelte`.

---

## SECURITY AUDIT STATUS

**67 findings total. Approach:** Fix critical items + HIGH batches 1-3 complete, defer batch 4 + MEDIUM/LOW.**

### CRITICAL Items

| ID | Issue | Status | Notes |
|----|-------|--------|-------|
| S-01 | Tenant isolation gaps | PARTIAL | Main queries scoped via `getCompanyId()`. Gaps: raw SQL in employee delete (8 queries), job delete (5 queries), one UPDATE on job_assignments. Only matters with >1 tenant. |
| S-03 | AI chat SQL injection | PARTIAL | Well-protected: parameterized, SELECT-only, block D/U/I/A/P, no recursive CTEs, result cap 200, no error leaks. Gap: doesn't inject `company_id` into prompt. Only matters with >1 tenant. |
| S-08 | XSS | DONE | No `{@html}` in Svelte. No template injection. Static assets proper MIME. Could add CSP headers for defense-in-depth. |

### HIGH Items — Batches 1-3 (DONE)

| ID | Issue | Fix | Batch |
|----|-------|-----|-------|
| D-02/D-05 | Missing FK + indexes | 15 FK indexes + 5 composites in migrate.ts | 1 |
| B-05 | Employee delete checked 4 FK tables | Now checks all 8 (job_assignments, daily_log, employee_notes, opportunities, action_items, certifications, assets, scheduled_moves) | 1 |
| S-14 | Hardcoded jeremiah→super_admin | Removed | 1 |
| S-09/S-10 | No file type validation on uploads | Magic bytes MIME validation on 3 endpoints. JPG/PNG/WebP headers. 5MB cap. | 2 |
| S-12 | No rate limiting | In-memory rate limiter. Login: 5 requests/15 min. API: 100 requests/min. | 2 |
| B-06 | Opportunity double-conversion | UNIQUE partial index on opportunities.converted_job_id WHERE IS NOT NULL | 2 |
| D-04 | Settings table missing composite PK | Drizzle declares primaryKey on (companyId, key) | 2 |
| Q-02 | Error messages leak internals | Global handler returns generic. chat.ts no dbError. import.ts doesn't leak stderr. | 2+3 |
| S-11 | Sessions 30 days, no refresh | Reduced to 7 days. Sliding window: refresh if >1 day old and active. | 3 |
| S-13/Q-01 | No input validation | Zod on 14 endpoints. Global sanitizeBody caps text at 10k. | 3 |
| D-03 | Missing CASCADE on FKs | DEFERRED — SQLite can't ALTER without full table recreation. App-level checks (B-05) cover gap. | 3 |

### HIGH Items — Batch 4 (NOT STARTED)

| ID | Issue | Notes |
|----|-------|-------|
| S-15 | Python in prod Docker | Multi-stage build to remove Python from final image. Lower priority. |
| B-03/B-04 | Scheduled moves + daily log automation | DONE — Auto-apply on look-ahead load + auto-commit today. No cron needed. |

### Known Issues (after deploy)

1. Multi-tenant scoping gaps — delete pre-checks, schedule.ts don't filter by company_id. Fix when multi-tenant matters.
2. AI chat tenant isolation — doesn't restrict to user's company_id. Same.
3. No CSP headers — good defense-in-depth, low priority.
4. ~~Scheduled moves not wired~~ — DONE. Auto-apply on look-ahead + auto-commit today.
5. Python in prod Docker — unnecessary attack surface.
6. Classification groups need backfill — field exists, data needs admin UI entry.

---

## FUTURE ROADMAP

### AI Agent Integration
Move beyond read-only chat:

**Report Agent** — Natural language → full HTML report with charts, tables, color-coded indicators. "Show me labor cost vs budget on active jobs this month" produces printable/sharable document.

**Workforce Planner** — "I need 4 journeymen + 2 apprentices on hospital job Monday" → analyzes assignments, rates → proposes move plan → user approves → executes via endpoints.

**Cost Watchdog (scheduled)** — Runs on schedule. Flags: jobs past budget trend, certifications expiring 30d, DL expirations, contracts with no end date. Morning briefing.

**Bid Assistant** — Pull historical data (same jurisdiction, scope, GC) to generate cost baselines for new opportunity estimates.

**Document Generator** — Change orders, daily reports, GC updates, invoice drafts — populated and formatted.

### SMS/Text Notifications (Twilio)
Discussed 2026-04-02:
1. Twilio account + phone (~$1/mo, $0.0079/text)
2. Server module (~30 lines) using `fetch` to hit Twilio REST API
3. Employee phone numbers exist (`phone`, `pePhone` fields)
4. New `notifications` table for logging
5. Permission controls + rate limits

Use cases: crew move notifications, certification/DL reminders, daily assignments, GC updates, budget alerts. Start one-way outbound, add two-way later.

### Tool-Use Architecture
Define discrete tools: `query_jobs`, `query_costs`, `move_employee`, `generate_report`, `send_text`, `send_alert`. AI picks tools to call. Safer, more extensible.

### iOS Field App
Reference `BIRDOG-FIELD-PRD.md`. Expo/React Native project `pe-field/`, shares Hono API. New `field` role + employee# + 4-digit PIN login. New tables for mobile: `time_entries`, `daily_reports`, `checklist_items`. Four screens: My Day, Time Entry, Checklist, Daily Report. New `/api/field/*` endpoints.

---

## KEY FILES

| File | Purpose |
|------|---------|
| `server/index.ts` | Main server. Rate limiter, sanitizeBody, error handler, static serving. |
| `server/routes.ts` | All API routes (~1100 lines). CRUD for employees, jobs, classifications, jurisdictions, rates, assets, assignments, budgets, costs, users, settings, opportunities. Workforce board aggregate. |
| `server/auth.ts` | Session auth. 7-day expiry, sliding window. Login, logout, validation. |
| `server/tenant.ts` | `getCompanyId(c)` helper for multi-tenant scoping. |
| `server/validation.ts` | Zod schemas (14 endpoints) + sanitizeBody + validate() helper. |
| `server/time-tracking.ts` | Time entry API suite (clock in/out, breaks, location, entries, adjustments, audit trail). |
| `server/chat.ts` | AI chat. Schema-aware system prompt, SELECT-only SQL, parameterized. |
| `server/import.ts` | PDF import endpoints (detail + summary). |
| `server/parse-asystems.py` | A-Systems detail report parser (pdfplumber). |
| `server/parse-summary.py` | A-Systems comprehensive job summary parser. |
| `server/reports.ts` | 6 financial/labor reports. Jurisdiction-based rateMap. Shared CSS/JS helpers. |
| `server/daily-reports.ts` | Daily report CRUD + time entries + photos + crew. |
| `server/meeting.ts` | Meeting/action items + templates + metrics + reorder. |
| `server/change-orders.ts` | Change order requests + photos + workflow. |
| `server/toolbox-talks.ts` | Safety talks + AI placeholder + attendance. |
| `server/opportunities.ts` | GC/Supplier batch reorder + delete. |
| `server/migrate.ts` | Runs every deploy. Schema migrations, indexes. |
| `server/seed.ts` | Seeds default data for new deploys. |
| `server/seed-comprehensive.ts` | API seed: GCs, suppliers, opportunities, daily reports, toolbox talks, change orders, action items, certs, subcontracts, employee notes, job costs, scheduled moves. POST /api/seed/comprehensive (super_admin). |
| `server/seed-time-tracking.ts` | API seed: 2 weeks of time entries + live locations. POST /api/seed/time-tracking (super_admin). |
| `server/db.ts` | SQLite connection, WAL mode. |
| `shared/schema.ts` | Drizzle ORM schema (~412 lines). All tables, FKs, composite PK on settings. |
| `client/src/app.css` | Global styles. Apple aesthetic, glass pills, drag-and-drop feedback. |
| `client/src/pages/WorkforceBoard.svelte` | Drag-and-drop assignment board. Business-critical. |
| `client/src/pages/Jobs.svelte` | Jobs CRUD. |
| `client/src/pages/Employees.svelte` | Employee list CRUD. |
| `client/src/pages/TimeTracking.svelte` | Office time entry review + weekly grid + adjustments. |
| `client/src/pages/DailyReports.svelte` | Daily report management + approval workflow. |
| `client/src/pages/ToolboxTalks.svelte` | REMOVED from office UI — toolbox talks are app-side only. |
| `client/src/pages/ChangeOrders.svelte` | COR pipeline + Kanban + estimation. |
| `client/src/pages/MeetingTool.svelte` | Action items + inline editing + meeting metrics. |
| `client/src/pages/GeneralContractors.svelte` | GC management. |
| `client/src/pages/Suppliers.svelte` | Supplier management. |
| `client/src/pages/Tools.svelte` | Tools + vehicles, sortable, batch delete. |
| `client/src/pages/Opportunities.svelte` | Bid pipeline, Kanban + table. |
| `client/src/pages/Classifications.svelte` | Classification management. |
| `client/src/pages/Jurisdictions.svelte` | Jurisdiction + rate management. Delete with confirm modal (shows rate count). |
| `client/src/pages/Admin.svelte` | User + company settings. |
| `client/src/pages/ASystemsImport.svelte` | PDF import UI. |
| `client/src/pages/Reports.svelte` | Financial reports gateway. |
| `client/src/components/Navbar.svelte` | Sidebar navigation. |
| `client/src/components/AddressPicker.svelte` | Google Places autocomplete. |
| `Dockerfile` | Bun-based. Runtime chown, su to birddog. |
| `fly.toml` | Fly.io config. Volume pe_data at /app/data, 1GB, dfw. |
| `MULTI-TENANT-PLAN.md` | Detailed phases 1-7. |
| `BIRDOG-FIELD-PRD.md` | iOS app specification. |

---

## DEPLOYMENT

```bash
cd pe-mgmt
fly deploy
```

Check logs:
```bash
fly logs
```

SSH into instance:
```bash
fly ssh console
```

Volume: `pe_data`, 1GB, region dfw. Snapshots via Fly.io dashboard.

---

## ARCHITECTURE NOTES

**Hono route collision prevention:** Static/parameterized routes (e.g., `/reorder`, `/stats/summary`, `/crew/:jobId`) MUST be defined BEFORE `/:id` catch-all. Affects: daily-reports, meeting, change-orders, opportunities (GC/Supplier batch ops).

**AddressPicker dropdown escape:** Modal's `overflow-y: auto` clips absolutely-positioned dropdowns. Fixed: switch dropdown to `position: fixed` with `getBoundingClientRect()` positioning and `z-index: 10000`.

**OneDrive build context:** Reduced Docker build time from 930s to 34s by expanding `.dockerignore` (exclude .git, *.bak, _backup_*, debug.txt, *.md, package-lock.json, vite timestamps, .env.example).

**Zod preprocessing pattern:** All field helpers use `z.preprocess()` to coerce frontend form data (strings→numbers, empty→undefined). Schemas use `.passthrough()` to allow unknown fields without rejection.

**CSS standardization (2026-04-04):** All 23 pages normalized to consistent design tokens. `.page-title` (22px/700/#1d1d1f/-0.02em), `.page-subtitle`, `.page-header`, `.page-section-title` defined in `app.css`. All pages use `max-width: 100%` (no constrained widths). Grid columns use `minmax(0, 1fr)` to prevent overflow from long text.

**Sortable tables:** 11 table views have click-to-sort headers with `sortCol`/`sortAsc` state + `toggleSort()` + reactive sorted array pattern: Jobs, Employees, Opportunities, DailyReports, ToolboxTalks, ChangeOrders, Tools, Vehicles, Classifications, TimeTracking, GeneralContractors/Suppliers (drag-reorder instead).

**AddressPicker standardization:** Google Places autocomplete used on all address fields: Jobs, Employees, Opportunities (convert-to-job form).
