import { sqlite } from "./db.js";

// ══════════════════════════════════════════════════════════════════
// PUSH NOTIFICATION + ISSUE DETECTION SYSTEM
// ── Single source of truth for detecting clock issues and
//    sending Expo push notifications to field workers ─────────────
// ══════════════════════════════════════════════════════════════════

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const ISSUE_MESSAGES: Record<string, string> = {
  missed_clock_out: "You forgot to clock out — please add a note so we can fix it.",
  outside_geofence: "A clock entry was flagged outside the geofence — please explain.",
  missing_photo: "A clock-in photo was missing — please add a note.",
  excessive_hours: "A shift logged 16+ hours — please verify this is correct.",
};

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: string;
  badge?: number;
}

// ══════════════════════════════════════════════════════════════════
// SHARED ISSUE DETECTION — called by both scheduler and manual endpoint
// Uses INSERT OR IGNORE so duplicate detection runs are safe
// ══════════════════════════════════════════════════════════════════

/**
 * Scan time entries for a single company/date and create issue records.
 * Safe to call multiple times — uses INSERT OR IGNORE against the unique index.
 */
export function detectIssuesForCompany(companyId: number, targetDate: string): number {
  let created = 0;

  // 1. Missed clock-outs: clocked in but never clocked out, and the date is past
  const missedClockOuts = sqlite.query(`
    SELECT te.id, te.employee_id, te.report_date
    FROM time_entries te
    WHERE te.company_id = ? AND te.report_date <= ? AND te.clock_in IS NOT NULL AND te.clock_out IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM time_entry_issues ti
        WHERE ti.time_entry_id = te.id AND ti.issue_type = 'missed_clock_out'
      )
  `).all(companyId, targetDate) as any[];

  for (const entry of missedClockOuts) {
    try {
      sqlite.run(
        `INSERT OR IGNORE INTO time_entry_issues (company_id, time_entry_id, employee_id, issue_type, issue_details, report_date)
         VALUES (?, ?, ?, 'missed_clock_out', 'Clocked in but never clocked out', ?)`,
        [companyId, entry.id, entry.employee_id, entry.report_date]
      );
      created++;
    } catch { /* unique constraint — already exists */ }
  }

  // 2. Outside geofence (not already approved)
  const geofenceIssues = sqlite.query(`
    SELECT te.id, te.employee_id, te.report_date,
           te.clock_in_inside_geofence, te.clock_out_inside_geofence
    FROM time_entries te
    WHERE te.company_id = ? AND te.report_date = ?
      AND (te.clock_in_inside_geofence = 0 OR te.clock_out_inside_geofence = 0)
      AND te.geofence_approved_by IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM time_entry_issues ti
        WHERE ti.time_entry_id = te.id AND ti.issue_type = 'outside_geofence'
      )
  `).all(companyId, targetDate) as any[];

  for (const entry of geofenceIssues) {
    const detail = entry.clock_in_inside_geofence === 0 ? "Clock-in outside geofence" : "Clock-out outside geofence";
    try {
      sqlite.run(
        `INSERT OR IGNORE INTO time_entry_issues (company_id, time_entry_id, employee_id, issue_type, issue_details, report_date)
         VALUES (?, ?, ?, 'outside_geofence', ?, ?)`,
        [companyId, entry.id, entry.employee_id, detail, entry.report_date]
      );
      created++;
    } catch { /* unique constraint */ }
  }

  // 3. Missing clock-in photo (mobile entries only)
  const missingPhotos = sqlite.query(`
    SELECT te.id, te.employee_id, te.report_date
    FROM time_entries te
    WHERE te.company_id = ? AND te.report_date = ?
      AND te.clock_in IS NOT NULL AND te.clock_in_photo_url IS NULL
      AND te.source = 'mobile'
      AND NOT EXISTS (
        SELECT 1 FROM time_entry_issues ti
        WHERE ti.time_entry_id = te.id AND ti.issue_type = 'missing_photo'
      )
  `).all(companyId, targetDate) as any[];

  for (const entry of missingPhotos) {
    try {
      sqlite.run(
        `INSERT OR IGNORE INTO time_entry_issues (company_id, time_entry_id, employee_id, issue_type, issue_details, report_date)
         VALUES (?, ?, ?, 'missing_photo', 'No clock-in photo captured', ?)`,
        [companyId, entry.id, entry.employee_id, entry.report_date]
      );
      created++;
    } catch { /* unique constraint */ }
  }

  // 4. Excessive hours (16+)
  const excessiveHours = sqlite.query(`
    SELECT te.id, te.employee_id, te.report_date,
           COALESCE(te.hours_regular, 0) + COALESCE(te.hours_overtime, 0) + COALESCE(te.hours_double, 0) as total
    FROM time_entries te
    WHERE te.company_id = ? AND te.report_date = ?
      AND (COALESCE(te.hours_regular, 0) + COALESCE(te.hours_overtime, 0) + COALESCE(te.hours_double, 0)) >= 16
      AND NOT EXISTS (
        SELECT 1 FROM time_entry_issues ti
        WHERE ti.time_entry_id = te.id AND ti.issue_type = 'excessive_hours'
      )
  `).all(companyId, targetDate) as any[];

  for (const entry of excessiveHours) {
    try {
      sqlite.run(
        `INSERT OR IGNORE INTO time_entry_issues (company_id, time_entry_id, employee_id, issue_type, issue_details, report_date)
         VALUES (?, ?, ?, 'excessive_hours', ?, ?)`,
        [companyId, entry.id, entry.employee_id, `${(entry as any).total.toFixed(1)} hours logged`, entry.report_date]
      );
      created++;
    } catch { /* unique constraint */ }
  }

  return created;
}


// ══════════════════════════════════════════════════════════════════
// PUSH NOTIFICATION SENDER
// ══════════════════════════════════════════════════════════════════

/**
 * Send push notifications via Expo Push API.
 * Returns count of messages that were accepted by Expo.
 */
async function sendExpoPush(messages: PushMessage[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };

  let totalSent = 0;
  let totalFailed = 0;

  // Expo accepts batches of up to 100
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Push] Expo API error (${res.status}):`, errText);
        totalFailed += batch.length;
        continue;
      }

      const data = await res.json();
      // Check individual ticket statuses
      for (const ticket of (data.data || [])) {
        if (ticket.status === "ok") {
          totalSent++;
        } else {
          totalFailed++;
          // Deactivate tokens that Expo tells us are invalid
          if (ticket.details?.error === "DeviceNotRegistered" && ticket.id) {
            const msg = messages.find(m => m.to === ticket.to);
            if (msg) {
              sqlite.run(`UPDATE push_tokens SET is_active = 0 WHERE token = ?`, [msg.to]);
              console.log(`[Push] Deactivated invalid token: ${msg.to.substring(0, 30)}...`);
            }
          }
        }
      }
    } catch (err) {
      console.error("[Push] Network error:", err);
      totalFailed += batch.length;
    }
  }

  return { sent: totalSent, failed: totalFailed };
}


// ══════════════════════════════════════════════════════════════════
// DAILY NOTIFICATION JOB
// ══════════════════════════════════════════════════════════════════

/**
 * Detect issues for yesterday, then send push notifications for all unresolved issues.
 * Called by the 7:30 AM scheduler and the manual trigger endpoint.
 */
export async function runDailyIssueNotifications(): Promise<{ detected: number; notified: number; failed: number }> {
  console.log("[Notifications] Running daily issue detection + notification...");

  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  let totalDetected = 0;
  let totalNotified = 0;
  let totalFailed = 0;

  const companies = sqlite.query("SELECT id FROM companies").all() as any[];

  for (const company of companies) {
    const companyId = company.id;

    // ── Step 1: Detect new issues ───────────────────────────
    const detected = detectIssuesForCompany(companyId, yesterday);
    totalDetected += detected;

    // ── Step 2: Send notifications for all unresolved issues ──
    const unresolvedIssues = sqlite.query(`
      SELECT i.id, i.employee_id, i.issue_type, i.status
      FROM time_entry_issues i
      WHERE i.company_id = ? AND i.status IN ('pending', 'rejected')
    `).all(companyId) as any[];

    // Group by employee
    const byEmployee = new Map<number, any[]>();
    for (const issue of unresolvedIssues) {
      if (!byEmployee.has(issue.employee_id)) byEmployee.set(issue.employee_id, []);
      byEmployee.get(issue.employee_id)!.push(issue);
    }

    for (const [employeeId, empIssues] of byEmployee) {
      // Get active push tokens for this employee
      const tokens = sqlite.query(`
        SELECT token FROM push_tokens
        WHERE employee_id = ? AND company_id = ? AND is_active = 1
      `).all(employeeId, companyId) as any[];

      if (tokens.length === 0) continue;

      const count = empIssues.length;
      const firstIssue = empIssues[0];
      const title = count === 1 ? "Clock Issue to Resolve" : `${count} Clock Issues to Resolve`;
      const body = count === 1
        ? ISSUE_MESSAGES[firstIssue.issue_type] || "Please review a clock issue."
        : `You have ${count} unresolved clock issues. Tap to review and add notes.`;

      const messages: PushMessage[] = tokens.map(({ token }: any) => ({
        to: token,
        title,
        body,
        sound: "default" as const,
        badge: count,
        data: { screen: "issues", issueId: firstIssue.id },
      }));

      // Send and only update last_notified_at on success
      const result = await sendExpoPush(messages);
      totalNotified += result.sent;
      totalFailed += result.failed;

      if (result.sent > 0) {
        const now = new Date().toISOString();
        for (const issue of empIssues) {
          sqlite.run(`UPDATE time_entry_issues SET last_notified_at = ? WHERE id = ?`, [now, issue.id]);
        }
      }
    }
  }

  console.log(`[Notifications] Done: ${totalDetected} detected, ${totalNotified} sent, ${totalFailed} failed`);
  return { detected: totalDetected, notified: totalNotified, failed: totalFailed };
}


// ══════════════════════════════════════════════════════════════════
// SCHEDULER
// ══════════════════════════════════════════════════════════════════

/**
 * Start the daily notification scheduler.
 * Checks every minute and fires at 7:30 AM server time.
 */
export function startNotificationScheduler(): void {
  let lastRunDate = "";

  setInterval(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const today = now.toISOString().split("T")[0];

    // Fire at 7:30 AM, once per day
    if (hours === 7 && minutes === 30 && lastRunDate !== today) {
      lastRunDate = today;
      runDailyIssueNotifications().catch((err) => {
        console.error("[Notifications] Scheduler error:", err);
      });
    }
  }, 60_000); // Check every minute

  console.log("✓ Daily notification scheduler started (fires at 7:30 AM)");
}
