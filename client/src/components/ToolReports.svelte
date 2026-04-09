<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";

  interface ToolReport {
    id: number;
    assetId: number;
    assetDescription: string;
    assetIdentifier: string | null;
    assetType: string;
    assetCategory: string | null;
    assetManufacturer: string | null;
    assetModel: string | null;
    reportType: string;
    severity: string;
    description: string;
    photoUrl: string | null;
    lat: number | null;
    lng: number | null;
    status: string;
    resolvedAt: string | null;
    resolutionNote: string | null;
    createdAt: string;
    reporterFirstName: string;
    reporterLastName: string;
    reportedBy: number;
  }

  interface ToolHistoryEntry {
    id: number;
    eventType: string;
    employeeName: string | null;
    fromEmployeeName: string | null;
    toEmployeeName: string | null;
    jobName: string | null;
    performedByName: string | null;
    note: string | null;
    createdAt: string;
  }

  interface Stats {
    total: number;
    open: number;
    acknowledged: number;
    inRepair: number;
    resolved: number;
    bySeverity: { safetyHazard: number; outOfService: number; canStillUse: number };
    byType: Record<string, number>;
  }

  let reports: ToolReport[] = [];
  let stats: Stats | null = null;
  let loading = true;
  let error = "";

  // Filters
  let filterStatus = "open";
  let filterType = "";

  // Action state
  let activeReport: ToolReport | null = null;
  let resolutionNote = "";
  let newStatus = "";
  let newCondition = "";
  let saving = false;

  // History panel
  let showHistory = false;
  let historyAssetId: number | null = null;
  let historyAssetName = "";
  let history: ToolHistoryEntry[] = [];
  let loadingHistory = false;

  const TYPE_LABELS: Record<string, string> = {
    damaged: "Damaged",
    lost: "Lost",
    stolen: "Stolen",
    needs_maintenance: "Needs Service",
    needs_calibration: "Needs Calibration",
  };

  const TYPE_COLORS: Record<string, string> = {
    damaged: "#EF4444",
    lost: "#F59E0B",
    stolen: "#DC2626",
    needs_maintenance: "#3B82F6",
    needs_calibration: "#8B5CF6",
  };

  const SEVERITY_LABELS: Record<string, string> = {
    can_still_use: "Can Still Use",
    out_of_service: "Out of Service",
    safety_hazard: "Safety Hazard",
  };

  const SEVERITY_COLORS: Record<string, string> = {
    can_still_use: "#F59E0B",
    out_of_service: "#EF4444",
    safety_hazard: "#DC2626",
  };

  const STATUS_LABELS: Record<string, string> = {
    open: "Open",
    acknowledged: "Acknowledged",
    in_repair: "In Repair",
    resolved: "Resolved",
  };

  const STATUS_COLORS: Record<string, string> = {
    open: "#EF4444",
    acknowledged: "#F59E0B",
    in_repair: "#3B82F6",
    resolved: "#22C55E",
  };

  const EVENT_LABELS: Record<string, string> = {
    created: "Tool Added",
    assigned: "Assigned",
    unassigned: "Unassigned",
    transferred: "Transferred",
    returned: "Returned",
    reported_damaged: "Reported Damaged",
    reported_lost: "Reported Lost",
    reported_stolen: "Reported Stolen",
    reported_maintenance: "Maintenance Requested",
    reported_calibration: "Calibration Requested",
    sent_to_repair: "Sent to Repair",
    repaired: "Repaired",
    calibrated: "Calibrated",
    condition_changed: "Condition Changed",
    status_changed: "Status Changed",
    retired: "Retired",
  };

  async function loadReports() {
    try {
      loading = true;
      const [reportsRes, statsRes] = await Promise.all([
        api.get("/tool-management/tool-reports"),
        api.get("/tool-management/tool-reports/stats"),
      ]);
      reports = reportsRes;
      stats = statsRes;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function loadHistory(assetId: number, assetName: string) {
    historyAssetId = assetId;
    historyAssetName = assetName;
    showHistory = true;
    loadingHistory = true;
    try {
      history = await api.get(`/tool-management/tool-history/${assetId}`);
    } catch (e: any) {
      history = [];
    } finally {
      loadingHistory = false;
    }
  }

  async function acknowledge(report: ToolReport) {
    try {
      await api.post(`/tool-management/tool-reports/${report.id}/acknowledge`);
      await loadReports();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  }

  async function sendToRepair(report: ToolReport) {
    try {
      await api.post(`/tool-management/tool-reports/${report.id}/send-to-repair`, {});
      await loadReports();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  }

  async function resolve() {
    if (!activeReport || !resolutionNote.trim()) return;
    saving = true;
    try {
      await api.post(`/tool-management/tool-reports/${activeReport.id}/resolve`, {
        resolutionNote: resolutionNote.trim(),
        newStatus: newStatus || undefined,
        newCondition: newCondition || undefined,
      });
      activeReport = null;
      resolutionNote = "";
      newStatus = "";
      newCondition = "";
      await loadReports();
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      saving = false;
    }
  }

  function openResolve(report: ToolReport) {
    activeReport = report;
    resolutionNote = "";
    newStatus = "assigned";
    newCondition = "fair";
  }

  $: filtered = reports.filter((r) => {
    if (filterStatus && r.status !== filterStatus) return false;
    if (filterType && r.reportType !== filterType) return false;
    return true;
  });

  function formatDate(d: string) {
    if (!d) return "";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  onMount(loadReports);
</script>

<div class="tr-container">
  <!-- Stats bar -->
  {#if stats}
    <div class="tr-stats">
      <button class="tr-stat" class:tr-stat-active={filterStatus === ""} on:click={() => filterStatus = ""}>
        <span class="tr-stat-count">{stats.total}</span>
        <span class="tr-stat-label">All</span>
      </button>
      <button class="tr-stat" class:tr-stat-active={filterStatus === "open"} on:click={() => filterStatus = "open"}>
        <span class="tr-stat-count" style="color: #EF4444">{stats.open}</span>
        <span class="tr-stat-label">Open</span>
      </button>
      <button class="tr-stat" class:tr-stat-active={filterStatus === "acknowledged"} on:click={() => filterStatus = "acknowledged"}>
        <span class="tr-stat-count" style="color: #F59E0B">{stats.acknowledged}</span>
        <span class="tr-stat-label">Acknowledged</span>
      </button>
      <button class="tr-stat" class:tr-stat-active={filterStatus === "in_repair"} on:click={() => filterStatus = "in_repair"}>
        <span class="tr-stat-count" style="color: #3B82F6">{stats.inRepair}</span>
        <span class="tr-stat-label">In Repair</span>
      </button>
      <button class="tr-stat" class:tr-stat-active={filterStatus === "resolved"} on:click={() => filterStatus = "resolved"}>
        <span class="tr-stat-count" style="color: #22C55E">{stats.resolved}</span>
        <span class="tr-stat-label">Resolved</span>
      </button>
    </div>
  {/if}

  <!-- Severity alerts -->
  {#if stats && stats.bySeverity.safetyHazard > 0}
    <div class="tr-alert tr-alert-danger">
      ⚠ {stats.bySeverity.safetyHazard} safety hazard{stats.bySeverity.safetyHazard > 1 ? "s" : ""} need immediate attention
    </div>
  {/if}

  <!-- Type filter pills -->
  <div class="tr-type-filter">
    <button class="tr-pill" class:tr-pill-active={filterType === ""} on:click={() => filterType = ""}>All Types</button>
    {#each Object.entries(TYPE_LABELS) as [value, label]}
      <button class="tr-pill" class:tr-pill-active={filterType === value} on:click={() => filterType = value}>{label}</button>
    {/each}
  </div>

  {#if loading}
    <div class="tr-loading">Loading reports...</div>
  {:else if error}
    <div class="tr-error">{error}</div>
  {:else if filtered.length === 0}
    <div class="tr-empty">No reports found</div>
  {:else}
    <div class="tr-list">
      {#each filtered as report (report.id)}
        <div class="tr-card" class:tr-card-hazard={report.severity === "safety_hazard" && report.status !== "resolved"}>
          <div class="tr-card-header">
            <div class="tr-card-tool">
              <span class="tr-card-tool-name">{report.assetDescription}</span>
              {#if report.assetIdentifier}
                <span class="tr-card-tool-id">{report.assetIdentifier}</span>
              {/if}
            </div>
            <div class="tr-card-badges">
              <span class="tr-badge" style="background: {TYPE_COLORS[report.reportType]}14; color: {TYPE_COLORS[report.reportType]}">{TYPE_LABELS[report.reportType]}</span>
              <span class="tr-badge" style="background: {SEVERITY_COLORS[report.severity]}14; color: {SEVERITY_COLORS[report.severity]}">{SEVERITY_LABELS[report.severity]}</span>
              <span class="tr-badge" style="background: {STATUS_COLORS[report.status]}14; color: {STATUS_COLORS[report.status]}">{STATUS_LABELS[report.status]}</span>
            </div>
          </div>

          <div class="tr-card-body">
            <p class="tr-card-desc">{report.description}</p>
            <div class="tr-card-meta">
              <span>Reported by {report.reporterFirstName} {report.reporterLastName}</span>
              <span>·</span>
              <span>{timeAgo(report.createdAt)}</span>
              <span>·</span>
              <span>{formatDate(report.createdAt)}</span>
            </div>
          </div>

          {#if report.status === "resolved" && report.resolutionNote}
            <div class="tr-card-resolution">
              <strong>Resolution:</strong> {report.resolutionNote}
            </div>
          {/if}

          <div class="tr-card-actions">
            <button class="tr-btn tr-btn-ghost" on:click={() => loadHistory(report.assetId, report.assetDescription)}>
              History
            </button>
            {#if report.status === "open"}
              <button class="tr-btn tr-btn-secondary" on:click={() => acknowledge(report)}>Acknowledge</button>
              <button class="tr-btn tr-btn-primary" on:click={() => openResolve(report)}>Resolve</button>
            {:else if report.status === "acknowledged"}
              <button class="tr-btn tr-btn-secondary" on:click={() => sendToRepair(report)}>Send to Repair</button>
              <button class="tr-btn tr-btn-primary" on:click={() => openResolve(report)}>Resolve</button>
            {:else if report.status === "in_repair"}
              <button class="tr-btn tr-btn-primary" on:click={() => openResolve(report)}>Mark Repaired</button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Resolve Modal -->
{#if activeReport}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="tr-modal-backdrop" on:click={() => { activeReport = null; }}>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="tr-modal" on:click|stopPropagation>
      <h3 class="tr-modal-title">Resolve Report</h3>
      <p class="tr-modal-sub">{activeReport.assetDescription} — {TYPE_LABELS[activeReport.reportType]}</p>

      <label class="tr-modal-label">Resolution Note <span style="color:#EF4444">*</span></label>
      <textarea class="tr-modal-textarea" bind:value={resolutionNote} placeholder="What was done to resolve this issue?" rows="3"></textarea>

      <div class="tr-modal-row">
        <div class="tr-modal-field">
          <label class="tr-modal-label" for="tr-new-status">Set Tool Status</label>
          <select id="tr-new-status" class="tr-modal-select" bind:value={newStatus}>
            <option value="">No change</option>
            <option value="available">Available</option>
            <option value="assigned">Assigned</option>
            <option value="maintenance">Maintenance</option>
            <option value="retired">Retired</option>
          </select>
        </div>
        <div class="tr-modal-field">
          <label class="tr-modal-label" for="tr-new-condition">Set Condition</label>
          <select id="tr-new-condition" class="tr-modal-select" bind:value={newCondition}>
            <option value="">No change</option>
            <option value="new">New</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
          </select>
        </div>
      </div>

      <div class="tr-modal-actions">
        <button class="tr-btn tr-btn-ghost" on:click={() => { activeReport = null; }}>Cancel</button>
        <button class="tr-btn tr-btn-primary" on:click={resolve} disabled={saving || !resolutionNote.trim()}>
          {saving ? "Saving..." : "Resolve"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- History Panel -->
{#if showHistory}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="tr-modal-backdrop" on:click={() => { showHistory = false; }}>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="tr-modal tr-modal-wide" on:click|stopPropagation>
      <h3 class="tr-modal-title">Tool History</h3>
      <p class="tr-modal-sub">{historyAssetName}</p>

      {#if loadingHistory}
        <div class="tr-loading">Loading history...</div>
      {:else if history.length === 0}
        <div class="tr-empty">No history recorded yet</div>
      {:else}
        <div class="tr-timeline">
          {#each history as entry (entry.id)}
            <div class="tr-timeline-item">
              <div class="tr-timeline-dot"></div>
              <div class="tr-timeline-content">
                <span class="tr-timeline-event">{EVENT_LABELS[entry.eventType] || entry.eventType}</span>
                {#if entry.employeeName}
                  <span class="tr-timeline-detail">{entry.employeeName}</span>
                {/if}
                {#if entry.fromEmployeeName && entry.toEmployeeName}
                  <span class="tr-timeline-detail">{entry.fromEmployeeName} → {entry.toEmployeeName}</span>
                {/if}
                {#if entry.jobName}
                  <span class="tr-timeline-detail">Job: {entry.jobName}</span>
                {/if}
                {#if entry.note}
                  <span class="tr-timeline-note">{entry.note}</span>
                {/if}
                <span class="tr-timeline-date">{formatDate(entry.createdAt)}{entry.performedByName ? ` · by ${entry.performedByName}` : ""}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="tr-modal-actions">
        <button class="tr-btn tr-btn-ghost" on:click={() => { showHistory = false; }}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .tr-container { padding: 0; }

  .tr-stats {
    display: flex; gap: 4px; margin-bottom: 16px;
  }
  .tr-stat {
    flex: 1; padding: 12px 8px; background: #fff; border: 1px solid #e5e5ea;
    border-radius: 10px; cursor: pointer; text-align: center; transition: all 0.15s;
  }
  .tr-stat:hover { border-color: #007aff; }
  .tr-stat-active { border-color: #007aff; background: #f0f6ff; }
  .tr-stat-count { display: block; font-size: 1.25rem; font-weight: 700; color: #1d1d1f; }
  .tr-stat-label { font-size: 0.7rem; color: #86868b; font-weight: 500; text-transform: uppercase; letter-spacing: 0.03em; }

  .tr-alert { padding: 10px 14px; border-radius: 8px; font-size: 0.8125rem; font-weight: 600; margin-bottom: 12px; }
  .tr-alert-danger { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }

  .tr-type-filter { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .tr-pill {
    padding: 6px 14px; border-radius: 100px; font-size: 0.75rem; font-weight: 600;
    background: #f2f2f7; color: #636366; border: none; cursor: pointer; transition: all 0.15s;
  }
  .tr-pill:hover { background: #e5e5ea; }
  .tr-pill-active { background: #1d1d1f; color: #fff; }

  .tr-loading, .tr-empty, .tr-error { text-align: center; padding: 40px 20px; color: #86868b; font-size: 0.875rem; }
  .tr-error { color: #ef4444; }

  .tr-list { display: flex; flex-direction: column; gap: 8px; }

  .tr-card {
    background: #fff; border: 1px solid #e5e5ea; border-radius: 12px; padding: 16px;
    transition: border-color 0.15s;
  }
  .tr-card:hover { border-color: #c7c7cc; }
  .tr-card-hazard { border-color: #fecaca; background: #fffbfb; }

  .tr-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .tr-card-tool { display: flex; flex-direction: column; gap: 2px; }
  .tr-card-tool-name { font-size: 0.9375rem; font-weight: 700; color: #1d1d1f; }
  .tr-card-tool-id { font-size: 0.75rem; color: #86868b; font-weight: 500; }
  .tr-card-badges { display: flex; gap: 4px; flex-wrap: wrap; }
  .tr-badge {
    font-size: 0.6875rem; font-weight: 700; padding: 3px 8px; border-radius: 100px;
    white-space: nowrap; text-transform: uppercase; letter-spacing: 0.02em;
  }

  .tr-card-body { margin-bottom: 10px; }
  .tr-card-desc { font-size: 0.8125rem; color: #1d1d1f; line-height: 1.5; margin: 0 0 6px 0; }
  .tr-card-meta { display: flex; gap: 6px; font-size: 0.75rem; color: #aeaeb2; flex-wrap: wrap; }

  .tr-card-resolution {
    background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 12px;
    font-size: 0.8125rem; color: #166534; margin-bottom: 10px; line-height: 1.4;
  }

  .tr-card-actions { display: flex; gap: 6px; justify-content: flex-end; }

  .tr-btn {
    padding: 7px 14px; border-radius: 8px; font-size: 0.8125rem; font-weight: 600;
    cursor: pointer; border: none; transition: all 0.15s;
  }
  .tr-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .tr-btn-ghost { background: transparent; color: #007aff; }
  .tr-btn-ghost:hover { background: #f0f6ff; }
  .tr-btn-secondary { background: #f2f2f7; color: #1d1d1f; }
  .tr-btn-secondary:hover { background: #e5e5ea; }
  .tr-btn-primary { background: #1d1d1f; color: #fff; }
  .tr-btn-primary:hover { background: #333; }

  /* Modal */
  .tr-modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .tr-modal {
    background: #fff; border-radius: 16px; padding: 24px; width: 100%; max-width: 480px;
    max-height: 80vh; overflow-y: auto;
  }
  .tr-modal-wide { max-width: 560px; }
  .tr-modal-title { font-size: 1.125rem; font-weight: 700; color: #1d1d1f; margin: 0 0 4px 0; }
  .tr-modal-sub { font-size: 0.8125rem; color: #86868b; margin: 0 0 16px 0; }
  .tr-modal-label { display: block; font-size: 0.75rem; font-weight: 600; color: #636366; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.03em; }
  .tr-modal-textarea {
    width: 100%; padding: 10px 12px; border: 1px solid #d1d1d6; border-radius: 8px;
    font-size: 0.875rem; resize: vertical; font-family: inherit; margin-bottom: 14px;
  }
  .tr-modal-textarea:focus { outline: none; border-color: #007aff; box-shadow: 0 0 0 3px rgba(0,122,255,0.1); }
  .tr-modal-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .tr-modal-field { display: flex; flex-direction: column; }
  .tr-modal-select {
    padding: 8px 10px; border: 1px solid #d1d1d6; border-radius: 8px;
    font-size: 0.875rem; background: #fff;
  }
  .tr-modal-select:focus { outline: none; border-color: #007aff; }
  .tr-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

  /* Timeline */
  .tr-timeline { padding: 8px 0; }
  .tr-timeline-item {
    display: flex; gap: 12px; padding: 10px 0;
    border-bottom: 1px solid #f2f2f7;
  }
  .tr-timeline-item:last-child { border-bottom: none; }
  .tr-timeline-dot {
    width: 8px; height: 8px; border-radius: 50%; background: #007aff;
    margin-top: 6px; flex-shrink: 0;
  }
  .tr-timeline-content { display: flex; flex-direction: column; gap: 2px; }
  .tr-timeline-event { font-size: 0.8125rem; font-weight: 600; color: #1d1d1f; }
  .tr-timeline-detail { font-size: 0.8125rem; color: #636366; }
  .tr-timeline-note { font-size: 0.75rem; color: #86868b; font-style: italic; }
  .tr-timeline-date { font-size: 0.6875rem; color: #aeaeb2; }
</style>
