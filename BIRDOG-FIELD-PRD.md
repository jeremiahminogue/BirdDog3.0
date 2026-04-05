# BirdDog Field — Product Requirements Document

**Version:** 1.0
**Date:** April 3, 2026
**Author:** Jeremiah / Pueblo Electrics
**Status:** Draft

---

## Problem Statement

Pueblo Electrics runs all project management through BirdDog, a web app built for office PMs and leadership. Crew members in the field have no way to interact with BirdDog from their phones — they can't log hours, check assignments, complete punch lists, or submit daily reports. This means PMs spend time relaying information by text and phone, hours get logged on paper or not at all, and punch list items fall through the cracks. A native iOS app purpose-built for field crews would close this loop, giving the office real-time visibility and giving crews a single tool for their daily workflow.

---

## Architecture Overview

### Current System

```
pe-mgmt/
├── client/          Svelte 4 + Vite + Tailwind/DaisyUI (web admin)
├── server/          Hono + Drizzle ORM (API + SSR)
├── shared/          schema.ts (22 tables, shared types)
└── data/            SQLite WAL on Fly.io persistent volume
```

The existing Hono API on Fly.io serves ~60 endpoints covering employees, jobs, assignments, classifications, budgets, costs, action items, assets, and more. All endpoints are behind session-cookie auth with role-based access (super_admin, admin, pm, readonly).

### Proposed Architecture

```
pe-mgmt/                          (existing — web admin + API)
├── server/
│   ├── routes.ts                  existing admin routes
│   ├── routes-field.ts            NEW — field-specific endpoints
│   └── auth.ts                    extended with PIN auth + "field" role
└── shared/schema.ts               extended with new tables

pe-field/                          (NEW — Expo/React Native iOS app)
├── app/                           Expo Router file-based navigation
├── components/                    reusable field UI
├── services/api.ts                typed HTTP client hitting pe-mgmt API
└── stores/                        Zustand for local state + offline queue
```

Both apps share the same Fly.io SQLite database via the existing Hono API. No separate backend. The field app is a new Expo project that talks to the same `https://birddog.fly.dev/api` endpoints — some existing, some new field-specific ones.

### Why Expo / React Native

- iOS first, Android later — one codebase covers both
- TypeScript end-to-end (matches existing Bun/Hono/Drizzle stack)
- No platform lock-in (eject to bare workflow anytime)
- Push notifications, camera, offline storage all well-supported
- Active ecosystem, fast iteration

---

## Auth Strategy for Field Users

### New Role: `field`

Add a `field` role to the users table. Field users are lightweight accounts tied to an employee record.

| Attribute | Value |
|---|---|
| Role | `field` |
| Login method | Employee number + 4-digit PIN |
| Permissions | Read own assignments, log time, submit reports, complete checklist items |
| Cannot access | Web admin, other employees' data, financials, budgets |

### New Schema Additions

```sql
-- Add to users table
pin_hash TEXT          -- bcrypt hash of 4-digit PIN (field users only)
employee_id INTEGER    -- FK to employees.id (links field user to employee record)
```

### Auth Flow

1. Field app shows company-branded login screen
2. Crew enters employee number + 4-digit PIN
3. Server validates against `users` where `role = 'field'` and `employeeNumber` matches
4. Returns session token (same session table, shorter TTL for mobile — 30 days)
5. App stores token in secure storage, auto-refreshes

### New Endpoint

```
POST /api/auth/field-login
Body: { employeeNumber: string, pin: string }
Returns: { token: string, employee: { id, firstName, lastName, photoUrl } }
```

PM or admin creates field accounts from the web admin (bulk invite by classification/job).

---

## New Database Tables

### `time_entries`

Core table for daily hour logging from the field.

```typescript
export const timeEntries = sqliteTable("time_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  date: text("date").notNull(),                    // YYYY-MM-DD
  startTime: text("start_time"),                   // HH:MM (optional — some crews just log total)
  endTime: text("end_time"),                       // HH:MM
  regularHours: real("regular_hours").notNull(),    // calculated or manual
  overtimeHours: real("overtime_hours").default(0),
  doubleTimeHours: real("double_time_hours").default(0),
  costCode: text("cost_code"),                     // maps to job cost codes
  description: text("description"),                // what they worked on
  status: text("status", { enum: ["draft", "submitted", "approved", "rejected"] }).default("draft"),
  submittedAt: text("submitted_at"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: text("approved_at"),
  rejectionNote: text("rejection_note"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});
```

### `daily_reports`

Field notes, weather, safety observations — one per crew member per job per day.

```typescript
export const dailyReports = sqliteTable("daily_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  date: text("date").notNull(),                    // YYYY-MM-DD
  weather: text("weather"),                        // sunny, rain, snow, etc.
  temperature: text("temperature"),                // "85F" or similar
  workPerformed: text("work_performed").notNull(),  // free text summary
  materialsUsed: text("materials_used"),           // free text
  visitors: text("visitors"),                      // inspectors, GC, owner
  safetyNotes: text("safety_notes"),               // incidents, near-misses, observations
  delayNotes: text("delay_notes"),                 // weather delays, material delays
  photoUrls: text("photo_urls"),                   // JSON array of uploaded photo paths
  status: text("status", { enum: ["draft", "submitted"] }).default("draft"),
  submittedAt: text("submitted_at"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});
```

### `checklist_items`

Punch list / task checklist items assigned to specific jobs, completable from the field.

```typescript
export const checklistItems = sqliteTable("checklist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().references(() => companies.id),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  description: text("description").notNull(),
  category: text("category"),                      // "punch", "QC", "safety", "closeout"
  assignedToId: integer("assigned_to_id").references(() => employees.id),
  location: text("location"),                      // "Building A, 2nd Floor, Room 204"
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] }).default("normal"),
  status: text("status", { enum: ["open", "in_progress", "completed", "verified"] }).default("open"),
  photoUrl: text("photo_url"),                     // before/after photo
  completedAt: text("completed_at"),
  completedBy: integer("completed_by").references(() => employees.id),
  verifiedBy: integer("verified_by").references(() => users.id),  // PM verifies from web
  verifiedAt: text("verified_at"),
  dueDate: text("due_date"),
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});
```

---

## New API Endpoints

All field endpoints live under `/api/field/` and require the `field` role (or higher).

### Time Entries

| Method | Path | Description |
|---|---|---|
| GET | `/api/field/time-entries?date=YYYY-MM-DD` | Get my time entries for a date |
| GET | `/api/field/time-entries/week?weekOf=YYYY-MM-DD` | Get my weekly timesheet |
| POST | `/api/field/time-entries` | Log a new time entry |
| PATCH | `/api/field/time-entries/:id` | Edit a draft entry |
| POST | `/api/field/time-entries/submit` | Submit entries for approval (batch) |

### Assignments

| Method | Path | Description |
|---|---|---|
| GET | `/api/field/my-assignments` | Get my active job assignments |
| GET | `/api/field/my-assignments/:jobId` | Get assignment detail + job info |

### Checklists

| Method | Path | Description |
|---|---|---|
| GET | `/api/field/jobs/:jobId/checklist` | Get checklist items for a job |
| PATCH | `/api/field/checklist/:id` | Update status, add notes/photo |
| POST | `/api/field/checklist/:id/complete` | Mark item completed with optional photo |

### Daily Reports

| Method | Path | Description |
|---|---|---|
| GET | `/api/field/daily-reports?date=YYYY-MM-DD` | Get my reports for a date |
| POST | `/api/field/daily-reports` | Create a new daily report |
| PATCH | `/api/field/daily-reports/:id` | Edit a draft report |
| POST | `/api/field/daily-reports/:id/submit` | Submit (locks the report) |
| POST | `/api/field/upload-photo` | Upload a photo, returns URL |

### Admin Endpoints (web side, for PMs)

| Method | Path | Description |
|---|---|---|
| GET | `/api/time-entries?jobId=X&weekOf=Y` | View all time entries for a job/week |
| PATCH | `/api/time-entries/:id/approve` | Approve a submitted entry |
| PATCH | `/api/time-entries/:id/reject` | Reject with note |
| GET | `/api/daily-reports?jobId=X&date=Y` | View field reports for a job |
| POST | `/api/jobs/:jobId/checklist` | Create checklist items from web |
| GET | `/api/field-users` | List field user accounts |
| POST | `/api/field-users` | Create field user (link to employee) |

---

## Screen Specs

### Screen 1: My Day (Home)

The landing screen after login. Shows today at a glance.

**What's on it:**
- Employee name + photo at top
- Current job assignment card (job name, number, address, foreman name)
- Today's hours summary (logged so far / target 8h) with quick-add button
- Unread checklist items count badge
- Quick action buttons: Log Time, Daily Report, Checklist

**User Stories:**
- As a crew member, I want to see my current assignment when I open the app so I know where I'm working today
- As a crew member, I want to see how many hours I've logged today so I don't forget to submit my time
- As a crew member, I want one-tap access to logging time, submitting a daily report, and viewing my punch list so I can do everything from one place

### Screen 2: Time Entry

Simple hour logging — designed for gloves-on, end-of-day use.

**What's on it:**
- Date selector (defaults to today, can go back up to 7 days)
- Job selector (pre-filled with current assignment, can switch if on multiple jobs)
- Hours input: big number pad for regular hours, separate fields for OT and DT
- Optional start/end time toggle (some crews prefer clock-in/out, others just total)
- Cost code picker (pull from job's existing cost codes)
- Description field (optional, free text)
- Submit button (submits to PM for approval)
- Weekly view tab showing Mon-Sun totals with status indicators (draft/submitted/approved)

**User Stories:**
- As a crew member, I want to log my hours at the end of each day in under 30 seconds so it doesn't feel like a chore
- As a crew member, I want to see my weekly total so I know if I'm hitting my hours
- As a crew member, I want to edit a time entry I haven't submitted yet in case I made a mistake
- As a foreman, I want to log time for my whole crew from my phone when they don't have the app yet

### Screen 3: Checklist / Punch List

Job-specific task list. Items are created by PMs in the web admin, completed by crew in the field.

**What's on it:**
- Job selector (if assigned to multiple)
- Filterable list of checklist items grouped by category (Punch, QC, Safety, Closeout)
- Each item shows: description, location, priority badge, assigned person, status
- Tap to open item detail: add notes, take before/after photo, mark complete
- Progress bar at top showing X of Y items complete

**User Stories:**
- As a crew member, I want to see my assigned punch list items for today's job so I know what to work on
- As a crew member, I want to take a photo of a completed item right from the checklist so the PM can verify it
- As a crew member, I want to filter by what's assigned to me vs. the whole job so I can focus on my items
- As a PM, I want to create punch list items from the web and have them show up instantly on the crew's phones

### Screen 4: Daily Report

End-of-day field report — weather, work performed, safety notes.

**What's on it:**
- Date and job pre-filled
- Weather picker (icon buttons: sunny, cloudy, rain, snow, wind)
- Temperature input
- "Work Performed" multi-line text field (this is the main content)
- "Materials Used" text field
- "Visitors" text field (inspectors, GC walks, owner visits)
- "Safety Notes" text field (incidents, near-misses, hazards)
- "Delays" text field (weather, material, inspection)
- Photo attachment (up to 5 per report)
- Save Draft / Submit buttons

**User Stories:**
- As a foreman, I want to submit a daily field report from my phone so the PM has it by morning
- As a foreman, I want to attach photos to my daily report so I don't have to send them separately via text
- As a crew member, I want to save a draft report and finish it later if I get interrupted
- As a PM, I want to see all daily reports for a job in the web admin so I have a complete project history

---

## Requirements

### Must-Have (P0) — MVP

1. **Field auth (PIN login)** — Employee number + PIN login, session management, secure token storage
   *Acceptance: field user can log in with employee number + PIN on iOS, session persists across app kills for 30 days*

2. **View my assignments** — See active job assignments with job name, number, address
   *Acceptance: field user sees only their own active assignments, job details match what's in BirdDog web*

3. **Log daily hours** — Enter regular/OT/DT hours per job per day, submit for approval
   *Acceptance: time entry appears in new web admin time approval view within 5 seconds of submission*

4. **Weekly timesheet view** — See Mon-Sun totals with status per day
   *Acceptance: field user can see submitted/approved/rejected status for each day's entries*

5. **Checklist/punch list** — View items assigned to me, mark complete with optional photo
   *Acceptance: completing an item from the field immediately updates status in web admin*

6. **Daily report submission** — Create and submit daily field report with weather, work performed, photos
   *Acceptance: submitted report is viewable in web admin with all text fields and photos*

7. **Photo upload** — Camera integration for checklist items and daily reports
   *Acceptance: photos taken in-app are compressed to <1MB, uploaded to server, and display in web admin*

8. **PM approval workflow (web side)** — View submitted time entries, approve/reject from web admin
   *Acceptance: PM can see all submitted entries, approve individually or in bulk, rejection sends note back to field*

### Nice-to-Have (P1) — Fast Follow

1. **Push notifications** — Notify crew of new checklist items, rejected time entries, assignment changes
2. **Offline mode** — Queue time entries and reports locally, sync when back on network
3. **Foreman crew logging** — Foreman can log time on behalf of their crew members
4. **Barcode/QR scanner** — Scan asset tags to associate tools/equipment with jobs
5. **GPS confirmation** — Capture location on time entry submission to confirm on-site
6. **Cost code lookup** — Searchable cost code picker tied to job budgets

### Future Considerations (P2)

1. **Android version** — Same Expo codebase, build for Google Play
2. **Time entry auto-fill** — Pre-populate based on previous day's entries
3. **Real-time chat** — In-app messaging between field and office per job
4. **Document viewer** — View job drawings/specs from the field
5. **Safety toolbox talks** — Digital sign-off for daily safety meetings
6. **Material requests** — Crew requests materials from the field, PM approves and orders

---

## Success Metrics

### Leading Indicators (first 30 days)

| Metric | Target | Measurement |
|---|---|---|
| Field user adoption | 80% of active crew have accounts | Count of field users / active employees |
| Daily time entry rate | 90% of field users log time daily | Entries per user per work day |
| Time to log hours | Under 30 seconds average | Client-side timing from screen open to submit |
| Checklist completion rate | 70% of items completed via app (not paper) | Items completed in-app / total items completed |

### Lagging Indicators (90 days)

| Metric | Target | Measurement |
|---|---|---|
| PM time saved on hour collection | 5+ hours/week reduction | Survey PMs before/after |
| Payroll accuracy | Fewer timesheet corrections | Compare correction rate before/after |
| Punch list close-out speed | 30% faster from creation to verified | Average days from created to verified status |
| Daily report submission rate | 95% of foremen submit daily | Reports submitted / expected reports |

---

## Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| 1 | Does Pueblo Electrics want foremen to approve crew hours before PM review (two-tier approval)? | Jeremiah | Yes — affects approval workflow design |
| 2 | Should time entries feed directly into A-Systems payroll, or is BirdDog the intermediate step with manual export? | Jeremiah | No — can add export later |
| 3 | What cost codes does PE use? Are they standardized per job or free-form? | Jeremiah | No — can start with free text |
| 4 | Do crews need to see job financials (budget remaining, % complete) or is that PM-only? | Jeremiah | No — default to PM-only, can open up later |
| 5 | Apple Developer account — does PE have one, or does one need to be set up ($99/year)? | Jeremiah | Yes — needed for TestFlight and App Store |
| 6 | How should photos be stored? Fly.io volume (simple) vs. S3/R2 bucket (scalable)? | Engineering | No — start with volume, migrate later if needed |

---

## Phasing Plan

### Phase 1 — Foundation (2-3 weeks)
- Set up `pe-field/` Expo project with Expo Router
- Implement field auth (PIN login + session management)
- Build "My Day" home screen
- Build time entry screen + weekly view
- Add `time_entries` table + field API endpoints
- Add time approval view to web admin

### Phase 2 — Field Ops (2-3 weeks)
- Build checklist/punch list screen
- Add `checklist_items` table + endpoints
- Add checklist management to web admin (create/assign items)
- Build daily report screen
- Add `daily_reports` table + endpoints
- Photo upload pipeline (camera → compress → upload → display)

### Phase 3 — Polish & Ship (1-2 weeks)
- Push notifications (Expo Push)
- Offline queue for time entries and reports
- TestFlight beta distribution to PE crew
- Bug fixes from field testing
- App Store submission

### Phase 4 — Expand
- Android build
- Foreman crew logging
- GPS confirmation
- A-Systems time export integration

---

## Technical Notes

### Why Not a PWA?

A PWA was considered but ruled out for several reasons: push notifications on iOS are still unreliable with PWAs, camera/photo handling is smoother in native, offline support is more robust with native SQLite (via expo-sqlite), and an App Store presence adds legitimacy for crew adoption. Expo gives us 95% of the PWA development speed with native-quality results.

### API Reuse

Most field endpoints can reuse existing Drizzle queries. The field routes are thin wrappers that filter by `employeeId` (from the session) and enforce field-role permissions. No new database infrastructure — just new tables in the same SQLite file and new route handlers mounted on the same Hono server.

### Offline Strategy (P1)

When offline, the app queues mutations (time entries, checklist updates, report drafts) in local expo-sqlite. On reconnect, a sync service replays the queue against the API in order. Conflicts (e.g., checklist item already completed by someone else) are resolved server-side with last-write-wins + notification to the user.
