<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";

  let issues: any[] = [];
  let loading = true;
  let error = "";
  let counts: Record<string, number> = {};
  let detecting = false;
  let hasEverDetected = false;

  // Filters
  let filterStatus = "";  // Default: show all issues
  let filterEmployee = "";
  let employees: any[] = [];

  // Action state
  let activeIssue: any = null;
  let managerNote = "";
  let saving = false;

  // Correction requests
  let corrections: any[] = [];
  let correctionFilter = "pending";
  let loadingCorrections = false;
  let activeCorrection: any = null;
  let correctionNote = "";
  let savingCorrection = false;

  const ISSUE_LABELS: Record<string, string> = {
    missed_clock_out: "Missed Clock-Out",
    outside_geofence: "Outside Geofence",
    missing_photo: "Missing Photo",
    excessive_hours: "Excessive Hours",
  };

  const STATUS_COLORS: Record<string, string> = {
    pending: "#EF4444",
    noted: "#F59E0B",
    approved: "#22C55E",
    rejected: "#94A3B8",
  };

  const STATUS_LABELS: Record<string, string> = {
    pending: "Awaiting Employee",
    noted: "Needs Review",
    approved: "Approved",
    rejected: "Rejected",
  };

  async function loadIssues() {
    loading = true;
    error = "";
    try {
      let url = `/time-tracking/issues?limit=100`;
      if (filterStatus) url += `&status=${filterStatus}`;
      if (filterEmployee) url += `&employeeId=${filterEmployee}`;
      const data = await api.get(url);
      issues = data.issues || [];
      counts = data.counts || {};
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function loadEmployees() {
    try {
      employees = ((await api.get("/employees")) || []).filter((x: any) => x.status === "active");
    } catch {}
  }

  function fmtDate(s: string) {
    if (!s) return "—";
    const d = new Date(s + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function fmtTime(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function fmtDateTime(s: string | null) {
    if (!s) return "—";
    const d = new Date(s);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  async function approveIssue(issue: any) {
    saving = true;
    try {
      await api.post(`/time-tracking/issues/${issue.id}/approve`, { note: managerNote.trim() || null });
      managerNote = "";
      activeIssue = null;
      await loadIssues();
    } catch (e: any) {
      alert(e.message);
    } finally {
      saving = false;
    }
  }

  async function rejectIssue(issue: any) {
    if (!managerNote.trim()) {
      alert("Please provide a note explaining why this is being rejected.");
      return;
    }
    saving = true;
    try {
      await api.post(`/time-tracking/issues/${issue.id}/reject`, { note: managerNote.trim() });
      managerNote = "";
      activeIssue = null;
      await loadIssues();
    } catch (e: any) {
      alert(e.message);
    } finally {
      saving = false;
    }
  }

  async function detectIssues() {
    detecting = true;
    try {
      const result = await api.post("/time-tracking/detect-issues", {});
      hasEverDetected = true;
      await loadIssues();
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      detecting = false;
    }
  }

  async function loadCorrections() {
    loadingCorrections = true;
    try {
      const data = await api.get(`/time-tracking/corrections?status=${correctionFilter}`);
      corrections = data.corrections || [];
    } catch {}
    loadingCorrections = false;
  }

  async function approveCorrection(corr: any) {
    savingCorrection = true;
    try {
      await api.post(`/time-tracking/corrections/${corr.id}/approve`, { note: correctionNote.trim() || null });
      correctionNote = "";
      activeCorrection = null;
      await loadCorrections();
      await loadIssues();
    } catch (e: any) { alert(e.message); }
    savingCorrection = false;
  }

  async function rejectCorrection(corr: any) {
    if (!correctionNote.trim()) {
      alert("Please provide a note explaining the rejection.");
      return;
    }
    savingCorrection = true;
    try {
      await api.post(`/time-tracking/corrections/${corr.id}/reject`, { note: correctionNote.trim() });
      correctionNote = "";
      activeCorrection = null;
      await loadCorrections();
    } catch (e: any) { alert(e.message); }
    savingCorrection = false;
  }

  onMount(async () => {
    await Promise.all([loadIssues(), loadEmployees(), loadCorrections()]);
    // Auto-detect on first load so issues are always fresh
    if (issues.length === 0 && !hasEverDetected) {
      await detectIssues();
    }
  });

  $: totalPending = (counts.pending || 0) + (counts.noted || 0);
</script>

<div class="ci">
  <!-- Summary bar -->
  <div class="ci-summary">
    <div class="ci-stat">
      <span class="ci-stat-num" style="color: #F59E0B">{counts.noted || 0}</span>
      <span class="ci-stat-lbl">Needs Review</span>
    </div>
    <div class="ci-stat">
      <span class="ci-stat-num" style="color: #EF4444">{counts.pending || 0}</span>
      <span class="ci-stat-lbl">Awaiting Employee</span>
    </div>
    <div class="ci-stat">
      <span class="ci-stat-num" style="color: #22C55E">{counts.approved || 0}</span>
      <span class="ci-stat-lbl">Approved</span>
    </div>
    <div class="ci-stat">
      <span class="ci-stat-num" style="color: #94A3B8">{counts.rejected || 0}</span>
      <span class="ci-stat-lbl">Rejected</span>
    </div>
    <button class="ci-detect-btn" on:click={detectIssues} disabled={detecting} title="Scan yesterday's entries for issues">
      {detecting ? "Scanning..." : "🔍 Detect Issues"}
    </button>
  </div>

  <!-- Filters -->
  <div class="ci-filters">
    <select bind:value={filterStatus} on:change={loadIssues}>
      <option value="">All Statuses</option>
      <option value="noted">Needs Review</option>
      <option value="pending">Awaiting Employee</option>
      <option value="approved">Approved</option>
      <option value="rejected">Rejected</option>
    </select>
    <select bind:value={filterEmployee} on:change={loadIssues}>
      <option value="">All Employees</option>
      {#each employees as emp}
        <option value={emp.id}>{emp.firstName} {emp.lastName}</option>
      {/each}
    </select>
  </div>

  {#if loading}
    <div class="ci-loading">Loading...</div>
  {:else if error}
    <div class="ci-error">{error}</div>
  {:else if issues.length === 0}
    <div class="ci-empty">
      <p style="font-size:1.1rem; font-weight:600; margin-bottom:4px;">All Clear</p>
      <p>No clock issues found. The system scans for missed clock-outs, geofence violations, missing photos, and excessive hours.</p>
      <p style="margin-top:8px; font-size:0.85rem;">Hit <strong>Detect Issues</strong> to re-scan, or issues will be auto-detected daily at 7:30 AM.</p>
    </div>
  {:else}
    <div class="ci-list">
      {#each issues as issue (issue.id)}
        <div class="ci-card" class:ci-card-noted={issue.status === "noted"} class:ci-card-rejected={issue.status === "rejected"}>
          <div class="ci-card-header">
            <div class="ci-card-type">
              <span class="ci-type-badge" style="background: {STATUS_COLORS[issue.issue_type === 'missed_clock_out' ? 'pending' : issue.issue_type === 'outside_geofence' ? 'noted' : 'rejected']}20; color: {STATUS_COLORS[issue.issue_type === 'missed_clock_out' ? 'pending' : issue.issue_type === 'outside_geofence' ? 'noted' : 'rejected']}">
                {ISSUE_LABELS[issue.issue_type] || issue.issue_type}
              </span>
              <span class="ci-status-dot" style="background: {STATUS_COLORS[issue.status]}"></span>
              <span class="ci-status-label">{STATUS_LABELS[issue.status]}</span>
            </div>
            <span class="ci-card-date">{fmtDate(issue.report_date)}</span>
          </div>

          <div class="ci-card-info">
            <span class="ci-emp-name">{issue.employee_name}</span>
            {#if issue.job_number}
              <span class="ci-job">· {issue.job_number} — {issue.job_name}</span>
            {/if}
          </div>

          {#if issue.issue_details}
            <p class="ci-detail">{issue.issue_details}</p>
          {/if}

          {#if issue.clock_in || issue.clock_out}
            <div class="ci-times">
              <span>In: {fmtTime(issue.clock_in)}</span>
              <span>Out: {fmtTime(issue.clock_out)}</span>
              {#if issue.hours_regular}
                <span>{(issue.hours_regular + (issue.hours_overtime || 0)).toFixed(1)} hrs</span>
              {/if}
            </div>
          {/if}

          <!-- Employee note -->
          {#if issue.employee_note}
            <div class="ci-note ci-note-employee">
              <strong>Employee Note</strong> <span class="ci-note-time">({fmtDateTime(issue.employee_noted_at)})</span>
              <p>{issue.employee_note}</p>
            </div>
          {/if}

          <!-- Manager note (if already resolved) -->
          {#if issue.manager_note}
            <div class="ci-note ci-note-manager">
              <strong>Manager Note</strong> <span class="ci-note-time">({issue.resolved_by_name}, {fmtDateTime(issue.resolved_at)})</span>
              <p>{issue.manager_note}</p>
            </div>
          {/if}

          <!-- Action area for issues needing review -->
          {#if issue.status === "noted"}
            {#if activeIssue?.id === issue.id}
              <div class="ci-action">
                <textarea bind:value={managerNote} placeholder="Optional note (required for rejection)" rows="2"></textarea>
                <div class="ci-action-btns">
                  <button class="ci-btn ci-btn-approve" on:click={() => approveIssue(issue)} disabled={saving}>
                    ✓ Approve
                  </button>
                  <button class="ci-btn ci-btn-reject" on:click={() => rejectIssue(issue)} disabled={saving}>
                    ✗ Reject
                  </button>
                  <button class="ci-btn ci-btn-cancel" on:click={() => { activeIssue = null; managerNote = ""; }}>
                    Cancel
                  </button>
                </div>
              </div>
            {:else}
              <button class="ci-review-btn" on:click={() => { activeIssue = issue; managerNote = ""; }}>
                Review & Resolve
              </button>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- ═══ CORRECTION REQUESTS ═══ -->
  <div class="ci-corr-section">
    <div class="ci-corr-header">
      <h3 class="ci-corr-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Time Correction Requests
        {#if corrections.length > 0 && correctionFilter === "pending"}
          <span class="ci-corr-badge">{corrections.length}</span>
        {/if}
      </h3>
      <select bind:value={correctionFilter} on:change={loadCorrections} class="ci-corr-filter">
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
    </div>

    {#if loadingCorrections}
      <div class="ci-loading">Loading corrections...</div>
    {:else if corrections.length === 0}
      <div class="ci-empty" style="padding: 24px;">
        <p style="font-size:0.9rem;">No {correctionFilter} correction requests</p>
      </div>
    {:else}
      <div class="ci-list">
        {#each corrections as corr (corr.id)}
          <div class="ci-card" class:ci-card-noted={corr.status === "pending"}>
            <div class="ci-card-header">
              <div class="ci-card-type">
                <span class="ci-type-badge" style="background: #3b82f620; color: #3b82f6;">
                  {corr.correction_type === "missed_clock_out" ? "Missed Clock-Out" :
                   corr.correction_type === "wrong_time" ? "Wrong Time" :
                   corr.correction_type === "wrong_job" ? "Wrong Job" : "Other"}
                </span>
              </div>
              <span class="ci-card-date">{fmtDate(corr.report_date)}</span>
            </div>

            <div class="ci-card-info">
              <span class="ci-emp-name">{corr.employee_name}</span>
              {#if corr.job_number}
                <span class="ci-job">· {corr.job_number} — {corr.job_name}</span>
              {/if}
            </div>

            {#if corr.clock_in || corr.clock_out}
              <div class="ci-times">
                <span>Original In: {fmtTime(corr.clock_in)}</span>
                <span>Original Out: {fmtTime(corr.clock_out)}</span>
              </div>
            {/if}

            {#if corr.requested_clock_in || corr.requested_clock_out || corr.requested_job_number}
              <div class="ci-corr-changes">
                <strong>Requested Changes:</strong>
                {#if corr.requested_clock_in}
                  <span>Clock-In → {fmtTime(corr.requested_clock_in)}</span>
                {/if}
                {#if corr.requested_clock_out}
                  <span>Clock-Out → {fmtTime(corr.requested_clock_out)}</span>
                {/if}
                {#if corr.requested_job_number}
                  <span>Job → {corr.requested_job_number} — {corr.requested_job_name}</span>
                {/if}
              </div>
            {/if}

            <div class="ci-note ci-note-employee">
              <strong>Employee Note</strong>
              <span class="ci-note-time">({fmtDateTime(corr.created_at)})</span>
              <p>{corr.note}</p>
            </div>

            {#if corr.manager_note}
              <div class="ci-note ci-note-manager">
                <strong>Manager Response</strong>
                <span class="ci-note-time">({fmtDateTime(corr.resolved_at)})</span>
                <p>{corr.manager_note}</p>
              </div>
            {/if}

            {#if corr.status === "pending"}
              {#if activeCorrection?.id === corr.id}
                <div class="ci-action">
                  <textarea bind:value={correctionNote} placeholder="Optional note (required for rejection)" rows="2"></textarea>
                  <div class="ci-action-btns">
                    <button class="ci-btn ci-btn-approve" on:click={() => approveCorrection(corr)} disabled={savingCorrection}>
                      ✓ Approve & Apply
                    </button>
                    <button class="ci-btn ci-btn-reject" on:click={() => rejectCorrection(corr)} disabled={savingCorrection}>
                      ✗ Reject
                    </button>
                    <button class="ci-btn ci-btn-cancel" on:click={() => { activeCorrection = null; correctionNote = ""; }}>
                      Cancel
                    </button>
                  </div>
                </div>
              {:else}
                <button class="ci-review-btn" on:click={() => { activeCorrection = corr; correctionNote = ""; }}>
                  Review Correction
                </button>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .ci { padding: 0; }
  .ci-summary { display: flex; gap: 16px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
  .ci-stat { text-align: center; min-width: 80px; }
  .ci-stat-num { display: block; font-size: 1.5rem; font-weight: 700; }
  .ci-stat-lbl { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .ci-detect-btn { margin-left: auto; padding: 8px 16px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 500; }
  .ci-detect-btn:hover { background: #e2e8f0; }

  .ci-filters { display: flex; gap: 10px; margin-bottom: 16px; }
  .ci-filters select { padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem; background: #fff; }

  .ci-loading, .ci-error, .ci-empty { text-align: center; padding: 40px; color: #64748b; }
  .ci-error { color: #EF4444; }

  .ci-list { display: flex; flex-direction: column; gap: 12px; }
  .ci-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; }
  .ci-card-noted { border-left: 3px solid #F59E0B; }
  .ci-card-rejected { border-left: 3px solid #EF4444; opacity: 0.75; }

  .ci-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .ci-card-type { display: flex; align-items: center; gap: 8px; }
  .ci-type-badge { padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .ci-status-dot { width: 8px; height: 8px; border-radius: 50%; }
  .ci-status-label { font-size: 0.8rem; color: #64748b; }
  .ci-card-date { font-size: 0.85rem; color: #64748b; }

  .ci-card-info { font-size: 0.9rem; margin-bottom: 4px; }
  .ci-emp-name { font-weight: 600; color: #1e293b; }
  .ci-job { color: #64748b; font-size: 0.85rem; }

  .ci-detail { font-size: 0.85rem; color: #64748b; margin: 4px 0 8px; }

  .ci-times { display: flex; gap: 16px; font-size: 0.85rem; color: #475569; margin-bottom: 8px; }

  .ci-note { border-radius: 6px; padding: 10px 12px; margin-top: 8px; font-size: 0.85rem; }
  .ci-note strong { font-weight: 600; }
  .ci-note-time { color: #94a3b8; font-size: 0.75rem; }
  .ci-note p { margin: 4px 0 0; line-height: 1.5; }
  .ci-note-employee { background: #FFF7ED; border: 1px solid #FDBA74; }
  .ci-note-manager { background: #F0F9FF; border: 1px solid #7DD3FC; }

  .ci-action { margin-top: 12px; }
  .ci-action textarea { width: 100%; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem; resize: vertical; font-family: inherit; }
  .ci-action-btns { display: flex; gap: 8px; margin-top: 8px; }

  .ci-btn { padding: 6px 16px; border: none; border-radius: 6px; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
  .ci-btn:disabled { opacity: 0.5; }
  .ci-btn-approve { background: #22C55E; color: #fff; }
  .ci-btn-approve:hover { background: #16A34A; }
  .ci-btn-reject { background: #EF4444; color: #fff; }
  .ci-btn-reject:hover { background: #DC2626; }
  .ci-btn-cancel { background: #f1f5f9; color: #64748b; }

  .ci-review-btn { margin-top: 8px; padding: 6px 16px; background: #F97316; color: #fff; border: none; border-radius: 6px; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
  .ci-review-btn:hover { background: #EA580C; }

  /* Correction request section */
  .ci-corr-section { margin-top: 24px; padding-top: 20px; border-top: 2px solid #f1f5f9; }
  .ci-corr-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .ci-corr-title { display: flex; align-items: center; gap: 8px; font-size: 1rem; font-weight: 700; color: #1e293b; margin: 0; }
  .ci-corr-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; background: #F97316; color: #fff; border-radius: 10px; font-size: 0.75rem; font-weight: 700; padding: 0 6px; }
  .ci-corr-filter { padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem; background: #fff; }
  .ci-corr-changes { font-size: 0.85rem; color: #1e40af; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 8px 12px; margin: 8px 0; display: flex; flex-wrap: wrap; gap: 12px; }
  .ci-corr-changes strong { flex-basis: 100%; font-weight: 600; color: #1e40af; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; }
</style>
