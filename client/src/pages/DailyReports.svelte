<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  interface DailyReport {
    id: number;
    company_id: number;
    job_id: number;
    report_date: string;
    submitted_by: number;
    status: string;
    weather_condition: string | null;
    weather_temp: number | null;
    weather_impact: string | null;
    work_performed: string | null;
    areas_worked: string | null;
    delay_notes: string | null;
    delay_type: string | null;
    visitors: string | null;
    safety_notes: string | null;
    material_notes: string | null;
    reviewed_by: number | null;
    reviewed_at: string | null;
    review_notes: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    // Joined
    job_name: string;
    job_number: string;
    submitter_first: string;
    submitter_last: string;
    submitter_number: string;
    reviewer_name: string | null;
    time_entry_count: number;
    total_hours: number;
    photo_count: number;
  }

  interface TimeEntry {
    id: number;
    employee_id: number;
    first_name: string;
    last_name: string;
    employee_number: string;
    classification_name: string;
    hours_regular: number;
    hours_overtime: number;
    hours_double: number;
    start_time: string | null;
    end_time: string | null;
    work_performed: string | null;
    notes: string | null;
  }

  interface Job {
    id: number;
    name: string;
    jobNumber: string;
    status: string;
  }

  interface Employee {
    id: number;
    firstName: string;
    lastName: string;
    employeeNumber: string;
  }

  interface CrewMember {
    id: number;
    first_name: string;
    last_name: string;
    employee_number: string;
    classification_id: number | null;
    classification_name: string | null;
    role: string | null;
  }

  let reports: DailyReport[] = [];
  let jobList: Job[] = [];
  let employeeList: Employee[] = [];
  let loading = true;
  let error = "";

  // Filters
  let filterJob = "all";
  let filterStatus = "all";
  let filterDateFrom = "";
  let filterDateTo = "";
  let searchTerm = "";

  // Sort
  type SortKey = "report_date" | "job_name" | "submitter" | "status" | "total_hours" | "time_entry_count";
  let sortKey: SortKey = "report_date";
  let sortAsc = false;

  // Detail view
  let selectedReport: DailyReport | null = null;
  let detailData: { report: any; timeEntries: TimeEntry[]; photos: any[]; crew: any[] } | null = null;
  let loadingDetail = false;

  // Create modal
  let showCreateModal = false;
  let createForm = resetCreateForm();
  let crewForJob: CrewMember[] = [];
  let loadingCrew = false;

  // Review
  let reviewNotes = "";
  let reviewing = false;

  // Delete confirmation
  let confirmDeleteReport: DailyReport | null = null;
  let deleting = false;

  $: canEdit = $user?.role === "super_admin" || $user?.role === "admin" || $user?.role === "pm";

  function resetCreateForm() {
    return {
      jobId: "",
      reportDate: new Date().toISOString().split("T")[0],
      submittedBy: "",
      weatherCondition: "",
      weatherTemp: "",
      weatherImpact: "none",
      workPerformed: "",
      areasWorked: "",
      delayNotes: "",
      delayType: "none",
      visitors: "",
      safetyNotes: "",
      materialNotes: "",
      notes: "",
      status: "draft",
    };
  }

  $: filteredReports = reports.filter(r => {
    if (filterJob !== "all" && String(r.job_id) !== filterJob) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterDateFrom && r.report_date < filterDateFrom) return false;
    if (filterDateTo && r.report_date > filterDateTo) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const haystack = `${r.job_name} ${r.job_number} ${r.submitter_first} ${r.submitter_last} ${r.work_performed || ""}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  $: sortedReports = [...filteredReports].sort((a, b) => {
    let aVal = "", bVal = "";
    switch (sortKey) {
      case "report_date": aVal = a.report_date; bVal = b.report_date; break;
      case "job_name": aVal = (a.job_name || "").toLowerCase(); bVal = (b.job_name || "").toLowerCase(); break;
      case "submitter": aVal = `${a.submitter_last} ${a.submitter_first}`.toLowerCase(); bVal = `${b.submitter_last} ${b.submitter_first}`.toLowerCase(); break;
      case "status": aVal = a.status; bVal = b.status; break;
      case "total_hours": return sortAsc ? a.total_hours - b.total_hours : b.total_hours - a.total_hours;
      case "time_entry_count": return sortAsc ? a.time_entry_count - b.time_entry_count : b.time_entry_count - a.time_entry_count;
    }
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) sortAsc = !sortAsc;
    else { sortKey = key; sortAsc = key === "report_date" ? false : true; }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortAsc ? " ▲" : " ▼";
  }

  $: stats = {
    total: reports.length,
    draft: reports.filter(r => r.status === "draft").length,
    submitted: reports.filter(r => r.status === "submitted").length,
    reviewed: reports.filter(r => r.status === "reviewed").length,
  };

  async function loadReports() {
    try {
      let url = "/daily-reports?";
      if (filterDateFrom) url += `dateFrom=${filterDateFrom}&`;
      if (filterDateTo) url += `dateTo=${filterDateTo}&`;
      reports = await api.get(url);
    } catch (e: any) {
      error = e.message;
    }
    loading = false;
  }

  async function loadJobs() {
    try {
      const data = await api.get("/jobs");
      jobList = data.filter((j: Job) => j.status === "active" || j.status === "planning");
    } catch {}
  }

  async function loadEmployees() {
    try {
      employeeList = await api.get("/employees?status=active");
    } catch {}
  }

  onMount(async () => {
    await Promise.all([loadReports(), loadJobs(), loadEmployees()]);
  });

  async function openDetail(report: DailyReport) {
    selectedReport = report;
    loadingDetail = true;
    reviewNotes = report.review_notes || "";
    try {
      detailData = await api.get(`/daily-reports/${report.id}`);
    } catch (e: any) {
      error = e.message;
    }
    loadingDetail = false;
  }

  function closeDetail() {
    selectedReport = null;
    detailData = null;
  }

  async function markReviewed() {
    if (!selectedReport) return;
    reviewing = true;
    try {
      await api.put(`/daily-reports/${selectedReport.id}`, {
        status: "reviewed",
        reviewNotes,
      });
      await loadReports();
      if (selectedReport) await openDetail({ ...selectedReport, status: "reviewed" });
    } catch (e: any) {
      error = e.message;
    }
    reviewing = false;
  }

  async function handleCreate() {
    try {
      const payload = { ...createForm };
      if (!payload.jobId || !payload.submittedBy) {
        error = "Job and submitted by are required";
        return;
      }
      await api.post("/daily-reports", {
        ...payload,
        jobId: parseInt(payload.jobId),
        submittedBy: parseInt(payload.submittedBy),
        weatherTemp: payload.weatherTemp ? parseInt(payload.weatherTemp) : null,
      });
      showCreateModal = false;
      createForm = resetCreateForm();
      await loadReports();
    } catch (e: any) {
      error = e.message;
    }
  }

  async function loadCrewForJob(jobId: string) {
    if (!jobId) { crewForJob = []; return; }
    loadingCrew = true;
    try {
      crewForJob = await api.get(`/daily-reports/crew/${jobId}`);
    } catch { crewForJob = []; }
    loadingCrew = false;
  }

  $: if (createForm.jobId) loadCrewForJob(createForm.jobId);

  function requestDelete(r: DailyReport) {
    confirmDeleteReport = r;
  }

  async function confirmDelete() {
    if (!confirmDeleteReport) return;
    const deletedId = confirmDeleteReport.id;
    deleting = true;
    try {
      await api.del(`/daily-reports/${deletedId}`);
      confirmDeleteReport = null;
      if (selectedReport?.id === deletedId) closeDetail();
      await loadReports();
    } catch (e: any) {
      error = e.message;
    }
    deleting = false;
  }

  function formatDate(d: string | null) {
    if (!d) return "—";
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function statusColor(s: string): string {
    const map: Record<string, string> = { draft: "#8e8e93", submitted: "#ff9500", reviewed: "#34c759" };
    return map[s] || "#8e8e93";
  }

  function weatherIcon(w: string | null): string {
    const map: Record<string, string> = {
      clear: "☀️", cloudy: "☁️", rain: "🌧️", snow: "❄️", wind: "💨",
      extreme_heat: "🔥", extreme_cold: "🥶"
    };
    return w ? (map[w] || "") : "";
  }

  const weatherOptions = [
    { value: "", label: "— Select —" },
    { value: "clear", label: "Clear / Sunny" },
    { value: "cloudy", label: "Cloudy" },
    { value: "rain", label: "Rain" },
    { value: "snow", label: "Snow" },
    { value: "wind", label: "High Wind" },
    { value: "extreme_heat", label: "Extreme Heat" },
    { value: "extreme_cold", label: "Extreme Cold" },
  ];

  const delayOptions = [
    { value: "none", label: "None" },
    { value: "weather", label: "Weather" },
    { value: "material", label: "Material" },
    { value: "inspection", label: "Inspection" },
    { value: "other_trade", label: "Other Trade" },
    { value: "gc", label: "GC / Owner" },
    { value: "equipment", label: "Equipment" },
  ];
</script>

<div class="dr-page">
  <!-- Header -->
  <div class="dr-header">
    <div class="dr-header-left">
      <h1 class="dr-title">Daily Reports</h1>
      <span class="dr-count">{filteredReports.length}{filteredReports.length !== reports.length ? ` of ${reports.length}` : ""}</span>
      <span class="dr-beta">Field Preview</span>
    </div>
    {#if canEdit}
      <button class="dr-btn dr-btn-primary" on:click={() => { createForm = resetCreateForm(); showCreateModal = true; }}>+ New Report</button>
    {/if}
  </div>

  <!-- Stats -->
  <div class="dr-stats">
    <button class="dr-stat" class:active={filterStatus === "all"} on:click={() => filterStatus = "all"}>
      <span class="dr-stat-num">{stats.total}</span>
      <span class="dr-stat-label">Total</span>
    </button>
    <button class="dr-stat" class:active={filterStatus === "draft"} on:click={() => filterStatus = filterStatus === "draft" ? "all" : "draft"}>
      <span class="dr-stat-num" style="color: #8e8e93">{stats.draft}</span>
      <span class="dr-stat-label">Draft</span>
    </button>
    <button class="dr-stat" class:active={filterStatus === "submitted"} on:click={() => filterStatus = filterStatus === "submitted" ? "all" : "submitted"}>
      <span class="dr-stat-num" style="color: #ff9500">{stats.submitted}</span>
      <span class="dr-stat-label">Submitted</span>
    </button>
    <button class="dr-stat" class:active={filterStatus === "reviewed"} on:click={() => filterStatus = filterStatus === "reviewed" ? "all" : "reviewed"}>
      <span class="dr-stat-num" style="color: #34c759">{stats.reviewed}</span>
      <span class="dr-stat-label">Reviewed</span>
    </button>
  </div>

  <!-- Filters -->
  <div class="dr-filters">
    <div class="dr-search-wrap">
      <svg class="dr-search-icon" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" placeholder="Search jobs, names, work..." class="dr-search" bind:value={searchTerm} />
    </div>
    <select class="dr-filter" bind:value={filterJob}>
      <option value="all">All Jobs</option>
      {#each jobList as j}
        <option value={String(j.id)}>#{j.jobNumber} - {j.name}</option>
      {/each}
    </select>
    <input type="date" class="dr-filter" bind:value={filterDateFrom} title="From date" />
    <input type="date" class="dr-filter" bind:value={filterDateTo} title="To date" />
  </div>

  {#if error}
    <div class="dr-error">
      <span>{error}</span>
      <button class="dr-error-close" on:click={() => error = ""}>Dismiss</button>
    </div>
  {/if}

  <!-- Main Content: List + Detail Side Panel -->
  <div class="dr-layout" class:has-detail={selectedReport}>
    <!-- Report List -->
    <div class="dr-list-panel">
      {#if loading}
        <div class="dr-loading">Loading reports...</div>
      {:else if sortedReports.length === 0}
        <div class="dr-empty">
          <p>{reports.length === 0 ? "No daily reports yet" : "No reports match your filters"}</p>
          {#if canEdit && reports.length === 0}
            <p style="margin-top: 8px; font-size: 12px; color: oklch(var(--bc) / 0.3)">Reports will be submitted from the field app — or create one manually above.</p>
          {/if}
        </div>
      {:else}
        <div class="dr-table-wrap">
          <table class="dr-table">
            <thead>
              <tr>
                <th class="dr-th-date dr-th-sort" on:click={() => toggleSort("report_date")}>Date{sortIndicator("report_date")}</th>
                <th class="dr-th-job dr-th-sort" on:click={() => toggleSort("job_name")}>Job{sortIndicator("job_name")}</th>
                <th class="dr-th-sub dr-th-sort" on:click={() => toggleSort("submitter")}>Submitted By{sortIndicator("submitter")}</th>
                <th class="dr-th-hrs dr-th-sort" on:click={() => toggleSort("total_hours")}>Hours{sortIndicator("total_hours")}</th>
                <th class="dr-th-crew dr-th-sort" on:click={() => toggleSort("time_entry_count")}>Crew{sortIndicator("time_entry_count")}</th>
                <th class="dr-th-status dr-th-sort" on:click={() => toggleSort("status")}>Status{sortIndicator("status")}</th>
                <th class="dr-th-weather">Wx</th>
              </tr>
            </thead>
            <tbody>
              {#each sortedReports as r (r.id)}
                <tr
                  class="dr-row"
                  class:dr-row-active={selectedReport?.id === r.id}
                  on:click={() => openDetail(r)}
                >
                  <td class="dr-td-date">{formatDate(r.report_date)}</td>
                  <td class="dr-td-job">
                    <span class="dr-job-num">#{r.job_number}</span>
                    <span class="dr-job-name">{r.job_name}</span>
                  </td>
                  <td class="dr-td-sub">{r.submitter_first} {r.submitter_last}</td>
                  <td class="dr-td-hrs">{r.total_hours.toFixed(1)}</td>
                  <td class="dr-td-crew">{r.time_entry_count}</td>
                  <td class="dr-td-status">
                    <span class="dr-status-dot" style="background: {statusColor(r.status)}"></span>
                    {r.status}
                  </td>
                  <td class="dr-td-weather">{weatherIcon(r.weather_condition)}{r.weather_temp ? ` ${r.weather_temp}°` : ""}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <!-- Detail Panel (slides in from right) -->
    {#if selectedReport}
      <div class="dr-detail-panel">
        <div class="dr-detail-header">
          <div>
            <div class="dr-detail-title">
              #{selectedReport.job_number} — {formatDate(selectedReport.report_date)}
            </div>
            <div class="dr-detail-meta">{selectedReport.job_name}</div>
          </div>
          <button class="dr-detail-close" on:click={closeDetail}>✕</button>
        </div>

        {#if loadingDetail}
          <div class="dr-loading">Loading...</div>
        {:else if detailData}
          <div class="dr-detail-body">
            <!-- Status + Submitter -->
            <div class="dr-detail-row">
              <span class="dr-detail-label">Status</span>
              <span class="dr-status-pill" style="background: {statusColor(selectedReport.status)}">{selectedReport.status}</span>
            </div>
            <div class="dr-detail-row">
              <span class="dr-detail-label">Submitted By</span>
              <span>{selectedReport.submitter_first} {selectedReport.submitter_last} ({selectedReport.submitter_number})</span>
            </div>

            <!-- Weather -->
            {#if selectedReport.weather_condition}
              <div class="dr-detail-row">
                <span class="dr-detail-label">Weather</span>
                <span>{weatherIcon(selectedReport.weather_condition)} {selectedReport.weather_condition}{selectedReport.weather_temp ? `, ${selectedReport.weather_temp}°F` : ""}{selectedReport.weather_impact && selectedReport.weather_impact !== "none" ? ` — ${selectedReport.weather_impact}` : ""}</span>
              </div>
            {/if}

            <!-- Work Performed -->
            {#if selectedReport.work_performed}
              <div class="dr-detail-section">
                <div class="dr-detail-section-title">Work Performed</div>
                <div class="dr-detail-text">{selectedReport.work_performed}</div>
              </div>
            {/if}

            {#if selectedReport.areas_worked}
              <div class="dr-detail-row">
                <span class="dr-detail-label">Areas</span>
                <span>{selectedReport.areas_worked}</span>
              </div>
            {/if}

            <!-- Delays -->
            {#if selectedReport.delay_type && selectedReport.delay_type !== "none"}
              <div class="dr-detail-section dr-detail-warn">
                <div class="dr-detail-section-title">Delay — {selectedReport.delay_type}</div>
                <div class="dr-detail-text">{selectedReport.delay_notes || "No details"}</div>
              </div>
            {/if}

            <!-- Safety -->
            {#if selectedReport.safety_notes}
              <div class="dr-detail-section">
                <div class="dr-detail-section-title">Safety Notes</div>
                <div class="dr-detail-text">{selectedReport.safety_notes}</div>
              </div>
            {/if}

            <!-- Material -->
            {#if selectedReport.material_notes}
              <div class="dr-detail-section">
                <div class="dr-detail-section-title">Material Notes</div>
                <div class="dr-detail-text">{selectedReport.material_notes}</div>
              </div>
            {/if}

            <!-- Visitors -->
            {#if selectedReport.visitors}
              <div class="dr-detail-row">
                <span class="dr-detail-label">Visitors</span>
                <span>{selectedReport.visitors}</span>
              </div>
            {/if}

            <!-- Assigned Crew -->
            {#if detailData.crew && detailData.crew.length > 0}
              <div class="dr-detail-section">
                <div class="dr-detail-section-title">Assigned Crew ({detailData.crew.length})</div>
                <div class="dr-crew-list">
                  {#each detailData.crew as member}
                    <div class="dr-crew-member">
                      <div class="dr-crew-avatar">
                        {#if member.photo_url}
                          <img src={member.photo_url} alt="{member.first_name} {member.last_name}" />
                        {:else}
                          <span>{(member.first_name?.[0] || '')}{(member.last_name?.[0] || '')}</span>
                        {/if}
                      </div>
                      <div class="dr-crew-info">
                        <div class="dr-crew-name">{member.first_name} {member.last_name}</div>
                        <div class="dr-crew-meta">
                          {member.classification_name || "Unclassified"}
                          {#if member.role}
                            <span class="dr-crew-role">{member.role}</span>
                          {/if}
                        </div>
                      </div>
                      {#if member.phone}
                        <a href="tel:{member.phone}" class="dr-crew-phone" title="Call {member.first_name}">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                        </a>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Time Entries -->
            <div class="dr-detail-section">
              <div class="dr-detail-section-title">Time Entries ({detailData.timeEntries.length})</div>
              {#if detailData.timeEntries.length === 0}
                <div class="dr-detail-empty">No time entries recorded</div>
              {:else}
                <div class="dr-time-table-wrap">
                  <table class="dr-time-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Class</th>
                        <th>Reg</th>
                        <th>OT</th>
                        <th>DT</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each detailData.timeEntries as te}
                        <tr>
                          <td class="dr-te-name">{te.first_name} {te.last_name}</td>
                          <td class="dr-te-class">{te.classification_name || "—"}</td>
                          <td>{te.hours_regular}</td>
                          <td>{te.hours_overtime || "—"}</td>
                          <td>{te.hours_double || "—"}</td>
                          <td class="dr-te-total">{(te.hours_regular + (te.hours_overtime || 0) + (te.hours_double || 0)).toFixed(1)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>

            <!-- Photos -->
            {#if detailData.photos.length > 0}
              <div class="dr-detail-section">
                <div class="dr-detail-section-title">Photos ({detailData.photos.length})</div>
                <div class="dr-photo-grid">
                  {#each detailData.photos as photo}
                    <div class="dr-photo-thumb">
                      <img src={photo.photo_url} alt={photo.caption || "Job photo"} />
                      {#if photo.caption}
                        <div class="dr-photo-caption">{photo.caption}</div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- General Notes -->
            {#if selectedReport.notes}
              <div class="dr-detail-section">
                <div class="dr-detail-section-title">Notes</div>
                <div class="dr-detail-text">{selectedReport.notes}</div>
              </div>
            {/if}

            <!-- Review Section -->
            {#if canEdit && selectedReport.status !== "reviewed"}
              <div class="dr-review-section">
                <div class="dr-detail-section-title">Review</div>
                <textarea
                  class="dr-review-input"
                  placeholder="Add review notes (optional)..."
                  bind:value={reviewNotes}
                  rows="2"
                ></textarea>
                <button class="dr-btn dr-btn-success" disabled={reviewing} on:click={markReviewed}>
                  {reviewing ? "Saving..." : "Mark Reviewed ✓"}
                </button>
              </div>
            {:else if selectedReport.status === "reviewed"}
              <div class="dr-reviewed-badge">
                <span>✓ Reviewed{selectedReport.reviewer_name ? ` by ${selectedReport.reviewer_name}` : ""}</span>
                {#if selectedReport.review_notes}
                  <div class="dr-detail-text" style="margin-top: 6px">{selectedReport.review_notes}</div>
                {/if}
              </div>
            {/if}

            <!-- Delete -->
            {#if $user?.role === "super_admin" || $user?.role === "admin"}
              <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid oklch(var(--bc) / 0.06)">
                <button class="dr-btn dr-btn-danger-text" on:click={() => { if (selectedReport) requestDelete(selectedReport); }}>Delete Report</button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- ═══════ CREATE MODAL ═══════ -->
{#if showCreateModal}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="dr-backdrop" on:click|self={() => showCreateModal = false}>
    <div class="dr-modal">
      <div class="dr-modal-header">
        <h3 class="dr-modal-title">New Daily Report</h3>
        <button class="dr-modal-close" on:click={() => showCreateModal = false}>✕</button>
      </div>
      <div class="dr-modal-body">
        <div class="dr-form-grid">
          <div class="dr-form-group">
            <label class="dr-label">Job *</label>
            <select class="dr-input" bind:value={createForm.jobId}>
              <option value="">— Select Job —</option>
              {#each jobList as j}
                <option value={String(j.id)}>#{j.jobNumber} - {j.name}</option>
              {/each}
            </select>
          </div>
          <div class="dr-form-group">
            <label class="dr-label">Report Date *</label>
            <input type="date" class="dr-input" bind:value={createForm.reportDate} />
          </div>
          <div class="dr-form-group">
            <label class="dr-label">Submitted By *</label>
            <select class="dr-input" bind:value={createForm.submittedBy}>
              <option value="">— Select —</option>
              {#if crewForJob.length > 0}
                <optgroup label="Crew on this job">
                  {#each crewForJob as m}
                    <option value={String(m.id)}>{m.last_name}, {m.first_name} — {m.classification_name || m.role || ""}</option>
                  {/each}
                </optgroup>
              {/if}
              <optgroup label="All employees">
                {#each employeeList as emp}
                  <option value={String(emp.id)}>{emp.lastName}, {emp.firstName} ({emp.employeeNumber})</option>
                {/each}
              </optgroup>
            </select>
          </div>
          <div class="dr-form-group">
            <label class="dr-label">Status</label>
            <select class="dr-input" bind:value={createForm.status}>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
            </select>
          </div>

          <div class="dr-form-group">
            <label class="dr-label">Weather</label>
            <select class="dr-input" bind:value={createForm.weatherCondition}>
              {#each weatherOptions as w}
                <option value={w.value}>{w.label}</option>
              {/each}
            </select>
          </div>
          <div class="dr-form-group">
            <label class="dr-label">Temp (°F)</label>
            <input type="number" class="dr-input" placeholder="72" bind:value={createForm.weatherTemp} />
          </div>
          <div class="dr-form-group">
            <label class="dr-label">Weather Impact</label>
            <select class="dr-input" bind:value={createForm.weatherImpact}>
              <option value="none">None</option>
              <option value="delayed">Delayed work</option>
              <option value="stopped">Stopped work</option>
            </select>
          </div>
          <div class="dr-form-group">
            <label class="dr-label">Delay Type</label>
            <select class="dr-input" bind:value={createForm.delayType}>
              {#each delayOptions as d}
                <option value={d.value}>{d.label}</option>
              {/each}
            </select>
          </div>

          <div class="dr-form-group dr-form-full">
            <label class="dr-label">Work Performed</label>
            <textarea class="dr-input dr-textarea" rows="3" placeholder="What the crew accomplished today..." bind:value={createForm.workPerformed}></textarea>
          </div>
          <div class="dr-form-group dr-form-full">
            <label class="dr-label">Areas Worked</label>
            <input type="text" class="dr-input" placeholder="2nd floor rooms 201-208, parking garage level B1" bind:value={createForm.areasWorked} />
          </div>
          {#if createForm.delayType !== "none"}
            <div class="dr-form-group dr-form-full">
              <label class="dr-label">Delay Notes</label>
              <textarea class="dr-input dr-textarea" rows="2" placeholder="Describe the delay..." bind:value={createForm.delayNotes}></textarea>
            </div>
          {/if}
          <div class="dr-form-group dr-form-full">
            <label class="dr-label">Safety Notes</label>
            <input type="text" class="dr-input" placeholder="Safety observations, incidents, toolbox talk topic..." bind:value={createForm.safetyNotes} />
          </div>
          <div class="dr-form-group dr-form-full">
            <label class="dr-label">Material Notes</label>
            <input type="text" class="dr-input" placeholder="Material received, needed, issues..." bind:value={createForm.materialNotes} />
          </div>
          <div class="dr-form-group dr-form-full">
            <label class="dr-label">Notes</label>
            <textarea class="dr-input dr-textarea" rows="2" placeholder="General notes..." bind:value={createForm.notes}></textarea>
          </div>
        </div>
      </div>
      <div class="dr-modal-footer">
        <button class="dr-btn dr-btn-ghost" on:click={() => showCreateModal = false}>Cancel</button>
        <button class="dr-btn dr-btn-primary" disabled={!createForm.jobId || !createForm.submittedBy} on:click={handleCreate}>
          Create Report
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══════ DELETE CONFIRM ═══════ -->
{#if confirmDeleteReport}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="dr-backdrop" on:click|self={() => confirmDeleteReport = null}>
    <div class="dr-confirm">
      <div class="dr-confirm-title">Delete Daily Report?</div>
      <div class="dr-confirm-text">
        This will permanently delete the report for <strong>{confirmDeleteReport.job_name}</strong> on <strong>{formatDate(confirmDeleteReport.report_date)}</strong>, including all associated time entries and photos. This cannot be undone.
      </div>
      <div class="dr-confirm-actions">
        <button class="dr-btn dr-btn-ghost" on:click={() => confirmDeleteReport = null}>Cancel</button>
        <button class="dr-btn dr-btn-danger" disabled={deleting} on:click={confirmDelete}>
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dr-page { max-width: 100%; }

  .dr-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .dr-header-left { display: flex; align-items: baseline; gap: 10px; }
  .dr-title { font-size: 22px; font-weight: 700; color: #1d1d1f; letter-spacing: -0.02em; }
  .dr-count { font-size: 13px; color: #86868b; font-weight: 500; }
  .dr-beta { font-size: 10px; font-weight: 700; color: white; background: oklch(var(--p)); padding: 2px 8px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.05em; }

  /* Stats */
  .dr-stats { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .dr-stat {
    flex: 1; min-width: 80px; padding: 10px 12px;
    background: white; border: 1px solid oklch(var(--bc) / 0.08);
    border-radius: 10px; text-align: center; cursor: pointer;
    transition: all 0.15s; display: flex; flex-direction: column; gap: 2px;
  }
  .dr-stat:hover { border-color: oklch(var(--bc) / 0.15); }
  .dr-stat.active { border-color: oklch(var(--p) / 0.3); background: oklch(var(--p) / 0.03); }
  .dr-stat-num { font-size: 20px; font-weight: 700; color: #1d1d1f; line-height: 1.2; }
  .dr-stat-label { font-size: 11px; color: #86868b; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }

  /* Filters */
  .dr-filters { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .dr-search-wrap { position: relative; flex: 1; min-width: 180px; }
  .dr-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: oklch(var(--bc) / 0.3); pointer-events: none; }
  .dr-search {
    width: 100%; padding: 7px 12px 7px 30px; border: 1px solid oklch(var(--bc) / 0.1);
    border-radius: 8px; font-size: 13px; background: white; outline: none;
  }
  .dr-search:focus { border-color: oklch(var(--p) / 0.3); box-shadow: 0 0 0 3px oklch(var(--p) / 0.06); }
  .dr-filter {
    padding: 7px 10px; border: 1px solid oklch(var(--bc) / 0.1);
    border-radius: 8px; font-size: 13px; background: white; outline: none; cursor: pointer;
  }

  /* Error */
  .dr-error {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 14px; background: oklch(var(--er) / 0.08);
    border: 1px solid oklch(var(--er) / 0.15); border-radius: 10px;
    font-size: 13px; color: oklch(var(--er)); margin-bottom: 10px;
  }
  .dr-error-close { border: none; background: none; cursor: pointer; color: oklch(var(--er)); font-weight: 600; font-size: 12px; }

  .dr-loading { text-align: center; padding: 48px; color: #86868b; font-size: 14px; }
  .dr-empty { text-align: center; padding: 48px 20px; font-size: 14px; color: oklch(var(--bc) / 0.35); }

  /* Layout: list + detail */
  .dr-layout { display: flex; gap: 16px; min-height: 400px; }
  .dr-list-panel { flex: 1; min-width: 0; }
  .dr-detail-panel {
    width: 420px; flex-shrink: 0; background: white;
    border: 1px solid oklch(var(--bc) / 0.08); border-radius: 12px;
    overflow: hidden; display: flex; flex-direction: column; max-height: 80vh;
  }

  /* Table */
  .dr-table-wrap {
    background: white; border: 1px solid oklch(var(--bc) / 0.08);
    border-radius: 12px; overflow-x: auto; -webkit-overflow-scrolling: touch;
  }
  .dr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .dr-table thead { background: oklch(var(--bc) / 0.025); }
  .dr-table th {
    padding: 8px 10px; text-align: left; font-weight: 600; font-size: 11px;
    color: oklch(var(--bc) / 0.45); text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid oklch(var(--bc) / 0.08); white-space: nowrap;
  }
  .dr-th-sort { cursor: pointer; user-select: none; }
  .dr-th-sort:hover { color: oklch(var(--bc) / 0.7); }
  .dr-th-date { width: 110px; }
  .dr-th-job { }
  .dr-th-sub { width: 140px; }
  .dr-th-hrs { width: 65px; text-align: right; }
  .dr-th-crew { width: 55px; text-align: center; }
  .dr-th-status { width: 90px; }
  .dr-th-weather { width: 60px; text-align: center; }

  .dr-row { cursor: pointer; transition: background 0.1s; }
  .dr-row:hover { background: oklch(var(--bc) / 0.02); }
  .dr-row td { padding: 8px 10px; border-bottom: 1px solid oklch(var(--bc) / 0.05); vertical-align: middle; }
  .dr-row:last-child td { border-bottom: none; }
  .dr-row-active { background: oklch(var(--p) / 0.05); }
  .dr-row-active:hover { background: oklch(var(--p) / 0.07); }

  .dr-td-date { font-weight: 500; color: #1d1d1f; white-space: nowrap; }
  .dr-td-job { }
  .dr-job-num { font-weight: 600; color: oklch(var(--p)); margin-right: 6px; font-size: 12px; }
  .dr-job-name { color: oklch(var(--bc) / 0.6); font-size: 12px; }
  .dr-td-sub { font-size: 12px; color: oklch(var(--bc) / 0.6); }
  .dr-td-hrs { text-align: right; font-weight: 600; font-family: "SF Mono", monospace; }
  .dr-td-crew { text-align: center; font-weight: 500; }
  .dr-td-status { white-space: nowrap; font-size: 12px; text-transform: capitalize; }
  .dr-status-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    margin-right: 5px; vertical-align: middle;
  }
  .dr-td-weather { text-align: center; font-size: 12px; white-space: nowrap; }

  /* Detail Panel */
  .dr-detail-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: 16px 18px; border-bottom: 1px solid oklch(var(--bc) / 0.06);
  }
  .dr-detail-title { font-size: 15px; font-weight: 700; color: #1d1d1f; }
  .dr-detail-meta { font-size: 12px; color: #86868b; margin-top: 2px; }
  .dr-detail-close {
    border: none; background: none; font-size: 16px; cursor: pointer;
    color: oklch(var(--bc) / 0.3); padding: 2px 6px; border-radius: 6px;
  }
  .dr-detail-close:hover { background: oklch(var(--bc) / 0.06); color: oklch(var(--bc) / 0.6); }
  .dr-detail-body { padding: 14px 18px; overflow-y: auto; flex: 1; }

  .dr-detail-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 0; font-size: 13px; color: oklch(var(--bc) / 0.7);
  }
  .dr-detail-label { font-weight: 600; font-size: 11px; color: oklch(var(--bc) / 0.4); text-transform: uppercase; letter-spacing: 0.03em; }

  .dr-detail-section { margin-top: 14px; }
  .dr-detail-section-title { font-size: 12px; font-weight: 700; color: oklch(var(--bc) / 0.5); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
  .dr-detail-text { font-size: 13px; color: oklch(var(--bc) / 0.7); line-height: 1.5; white-space: pre-wrap; }
  .dr-detail-warn { background: oklch(var(--wa) / 0.06); padding: 10px 12px; border-radius: 8px; border-left: 3px solid oklch(var(--wa)); }
  .dr-detail-empty { font-size: 12px; color: oklch(var(--bc) / 0.25); font-style: italic; }

  .dr-status-pill {
    display: inline-block; padding: 2px 10px; border-radius: 100px;
    font-size: 11px; font-weight: 700; color: white; text-transform: capitalize;
  }

  /* Time entries table inside detail */
  .dr-time-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .dr-time-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .dr-time-table th {
    padding: 5px 8px; text-align: left; font-weight: 600; font-size: 10px;
    color: oklch(var(--bc) / 0.4); text-transform: uppercase;
    border-bottom: 1px solid oklch(var(--bc) / 0.06);
  }
  .dr-time-table td { padding: 5px 8px; border-bottom: 1px solid oklch(var(--bc) / 0.04); }
  .dr-te-name { font-weight: 500; }
  .dr-te-class { color: oklch(var(--bc) / 0.4); font-size: 11px; }
  .dr-te-total { font-weight: 700; }

  /* Photos */
  .dr-photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .dr-photo-thumb { border-radius: 6px; overflow: hidden; aspect-ratio: 1; position: relative; }
  .dr-photo-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .dr-photo-caption { position: absolute; bottom: 0; left: 0; right: 0; padding: 4px 6px; background: rgba(0,0,0,0.5); color: white; font-size: 10px; }

  /* Crew */
  .dr-crew-list { display: flex; flex-direction: column; gap: 6px; }
  .dr-crew-member {
    display: flex; align-items: center; gap: 10px; padding: 6px 8px;
    border-radius: 8px; transition: background 0.12s;
  }
  .dr-crew-member:hover { background: #f5f5f7; }
  .dr-crew-avatar {
    width: 32px; height: 32px; border-radius: 50%; overflow: hidden;
    background: #e8e8ed; display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600; color: #86868b; flex-shrink: 0;
  }
  .dr-crew-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .dr-crew-info { flex: 1; min-width: 0; }
  .dr-crew-name { font-size: 13px; font-weight: 500; color: #1d1d1f; }
  .dr-crew-meta { font-size: 11px; color: #86868b; display: flex; align-items: center; gap: 6px; }
  .dr-crew-role {
    display: inline-block; padding: 1px 6px; font-size: 9px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.03em; background: #007aff15;
    color: #007aff; border-radius: 4px;
  }
  .dr-crew-phone {
    color: #86868b; padding: 4px; border-radius: 6px; transition: color 0.12s, background 0.12s;
  }
  .dr-crew-phone:hover { color: #007aff; background: #007aff10; }

  /* Review */
  .dr-review-section { margin-top: 16px; padding-top: 12px; border-top: 1px solid oklch(var(--bc) / 0.06); }
  .dr-review-input {
    width: 100%; padding: 8px 10px; border: 1px solid oklch(var(--bc) / 0.1);
    border-radius: 8px; font-size: 13px; outline: none; resize: vertical;
    margin-bottom: 8px; font-family: inherit;
  }
  .dr-review-input:focus { border-color: oklch(var(--p) / 0.3); box-shadow: 0 0 0 3px oklch(var(--p) / 0.06); }
  .dr-reviewed-badge {
    margin-top: 14px; padding: 10px 12px; background: oklch(var(--su) / 0.06);
    border-radius: 8px; font-size: 13px; font-weight: 600; color: oklch(var(--su));
  }

  /* Buttons */
  .dr-btn {
    padding: 6px 14px; border: none; border-radius: 8px; font-size: 13px;
    font-weight: 600; cursor: pointer; transition: all 0.15s; white-space: nowrap;
  }
  .dr-btn-primary { background: oklch(var(--p)); color: white; }
  .dr-btn-primary:hover { filter: brightness(1.1); }
  .dr-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .dr-btn-success { background: #34c759; color: white; }
  .dr-btn-success:hover { filter: brightness(1.1); }
  .dr-btn-success:disabled { opacity: 0.5; cursor: not-allowed; }
  .dr-btn-danger { background: oklch(var(--er) / 0.12); color: oklch(var(--er)); }
  .dr-btn-danger:hover { background: oklch(var(--er) / 0.2); }
  .dr-btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
  .dr-btn-ghost { background: oklch(var(--bc) / 0.06); color: oklch(var(--bc) / 0.5); }
  .dr-btn-ghost:hover { background: oklch(var(--bc) / 0.1); }
  .dr-btn-danger-text { background: none; color: oklch(var(--er) / 0.5); font-size: 12px; padding: 4px 8px; }
  .dr-btn-danger-text:hover { color: oklch(var(--er)); background: oklch(var(--er) / 0.06); }

  /* Modal / Confirm / Backdrop */
  .dr-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 1000;
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .dr-modal {
    background: white; border-radius: 14px; max-width: 680px; width: 100%;
    max-height: 90vh; display: flex; flex-direction: column;
    box-shadow: 0 20px 60px rgba(0,0,0,0.15);
  }
  .dr-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px 12px;
  }
  .dr-modal-title { font-size: 16px; font-weight: 700; color: #1d1d1f; }
  .dr-modal-close {
    border: none; background: none; cursor: pointer; font-size: 16px;
    color: oklch(var(--bc) / 0.3); padding: 4px 8px; border-radius: 6px;
  }
  .dr-modal-close:hover { background: oklch(var(--bc) / 0.06); color: oklch(var(--bc) / 0.6); }
  .dr-modal-body { padding: 0 24px; overflow-y: auto; flex: 1; }
  .dr-modal-footer {
    display: flex; gap: 8px; justify-content: flex-end;
    padding: 16px 24px; border-top: 1px solid oklch(var(--bc) / 0.06);
  }

  .dr-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .dr-form-full { grid-column: 1 / -1; }
  .dr-form-group { display: flex; flex-direction: column; gap: 4px; }
  .dr-label { font-size: 12px; font-weight: 600; color: oklch(var(--bc) / 0.5); }
  .dr-input {
    padding: 7px 10px; border: 1px solid oklch(var(--bc) / 0.12);
    border-radius: 8px; font-size: 13px; outline: none; background: white;
    font-family: inherit;
  }
  .dr-input:focus { border-color: oklch(var(--p) / 0.3); box-shadow: 0 0 0 3px oklch(var(--p) / 0.06); }
  .dr-textarea { resize: vertical; min-height: 48px; }

  .dr-confirm {
    background: white; border-radius: 14px; padding: 24px; max-width: 400px; width: 100%;
    box-shadow: 0 20px 60px rgba(0,0,0,0.15);
  }
  .dr-confirm-title { font-size: 16px; font-weight: 700; color: #1d1d1f; margin-bottom: 8px; }
  .dr-confirm-text { font-size: 13px; color: #86868b; margin-bottom: 20px; line-height: 1.5; }
  .dr-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }

  /* Responsive */
  @media (max-width: 900px) {
    .dr-layout { flex-direction: column; }
    .dr-detail-panel { width: 100%; max-height: none; }
    .dr-th-weather, .dr-td-weather { display: none; }
  }
  @media (max-width: 640px) {
    .dr-title { font-size: 18px; }
    .dr-th-crew, .dr-td-crew, .dr-th-sub, .dr-td-sub { display: none; }
    .dr-form-grid { grid-template-columns: 1fr; }
  }
</style>
