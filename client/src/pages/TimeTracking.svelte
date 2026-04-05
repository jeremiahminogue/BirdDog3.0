<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";

  let entries: any[] = [];
  let employees: any[] = [];
  let jobs: any[] = [];
  let loading = true;
  let error = "";

  // Filters
  let dateFrom = getMonday();
  let dateTo = getSunday();
  let filterJob = "";
  let filterEmployee = "";
  let filterSource = "";
  let filterFlagged = false;

  // Detail modal
  let detail: any = null;
  let detailLoading = false;
  let adjustments: any[] = [];

  // Adjust modal
  let adjustMode = false;
  let adjustForm = { clockIn: "", clockOut: "", hoursRegular: 0, hoursOvertime: 0, hoursDouble: 0, breakMinutes: 0, notes: "", reason: "" };
  let adjustSaving = false;
  let adjustError = "";
  let adjustWarn = "";

  // Crew modal
  let crewModalOpen = false;
  let crewModalTitle = "";
  let crewModalList: any[] = [];

  // ── Date helpers ───────────────────────────────────────
  function getMonday() {
    const d = new Date(); const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    return d.toISOString().split("T")[0];
  }
  function getSunday() {
    const d = new Date(); const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? 0 : 7));
    return d.toISOString().split("T")[0];
  }
  function getWeekDates(): string[] {
    const dates: string[] = []; const d = new Date(dateFrom + "T00:00:00");
    for (let i = 0; i < 7; i++) { dates.push(d.toISOString().split("T")[0]); d.setDate(d.getDate() + 1); }
    return dates;
  }
  function fmtDay(s: string) { return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(s+"T00:00:00").getDay()]; }
  function fmtDayNum(s: string) { return parseInt(s.split("-")[2], 10).toString(); }
  function fmtTime(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function fmtH(n: number | null) { return (n || 0).toFixed(1); }
  function totalH(e: any) { return (e.hours_regular || 0) + (e.hours_overtime || 0) + (e.hours_double || 0); }
  function sourceLabel(s: string) { return ({ mobile: "📱", tablet: "📋", manual: "✏️", kiosk: "🖥" } as any)[s] || s; }

  // ── Issue detection ────────────────────────────────────
  function getIssues(e: any): string[] {
    const issues: string[] = [];
    if (!e.clock_in) issues.push("Missing clock-in");
    if (!e.clock_out) issues.push("Missing clock-out");
    if (e.clock_in_inside_geofence === 0) issues.push("Clock-in outside geofence");
    if (e.clock_out_inside_geofence === 0) issues.push("Clock-out outside geofence");
    if (totalH(e) >= 6 && (e.break_minutes || 0) === 0) issues.push("No break on 6+ hr shift");
    if (totalH(e) > 16) issues.push("Excessive hours (16+)");
    return issues;
  }

  function cellStatus(dayEntries: any[]): "green" | "yellow" | "red" | "" {
    if (!dayEntries?.length) return "";
    let worst: "green" | "yellow" | "red" = "green";
    for (const e of dayEntries) {
      const issues = getIssues(e);
      if (issues.some(i => i.includes("Missing"))) return "red";
      if (issues.length > 0) worst = "yellow";
    }
    return worst;
  }

  function cellHours(d: any[]): number { return d ? d.reduce((s: number, e: any) => s + totalH(e), 0) : 0; }
  function cellIssueList(dayEntries: any[]): string[] {
    if (!dayEntries?.length) return [];
    const all: string[] = [];
    for (const e of dayEntries) { for (const i of getIssues(e)) { if (!all.includes(i)) all.push(i); } }
    return all;
  }
  function rowIssueList(row: Row): string[] {
    const all: string[] = [];
    for (const d of Object.values(row.days)) { for (const e of d) { for (const i of getIssues(e)) { if (!all.includes(i)) all.push(i); } } }
    return all;
  }

  // ── Data ───────────────────────────────────────────────
  async function loadEntries() {
    loading = true; error = "";
    try {
      let url = `/time-tracking/entries?dateFrom=${dateFrom}&dateTo=${dateTo}`;
      if (filterJob) url += `&jobId=${filterJob}`;
      if (filterEmployee) url += `&employeeId=${filterEmployee}`;
      if (filterSource) url += `&source=${filterSource}`;
      if (filterFlagged) url += `&flagged=true`;
      entries = (await api.get(url))?.entries || [];
    } catch (e: any) { error = e.message; } finally { loading = false; }
  }

  async function loadFilters() {
    try {
      const [e, j] = await Promise.all([api.get("/employees"), api.get("/jobs")]);
      employees = (e || []).filter((x: any) => x.status === "active");
      jobs = j || [];
    } catch {}
  }

  function shiftWeek(dir: number) {
    const d = new Date(dateFrom + "T00:00:00"); d.setDate(d.getDate() + dir * 7);
    dateFrom = d.toISOString().split("T")[0];
    const e = new Date(d); e.setDate(e.getDate() + 6);
    dateTo = e.toISOString().split("T")[0];
    loadEntries();
  }
  function goThisWeek() { dateFrom = getMonday(); dateTo = getSunday(); loadEntries(); }

  // ── Grid data ──────────────────────────────────────────
  interface Row { id: number; name: string; days: Record<string, any[]>; reg: number; ot: number; dt: number; total: number; issues: number; issueList: string[]; hasRedIssue: boolean; }

  $: weekDates = getWeekDates();
  $: rows = (() => {
    const m = new Map<number, Row>();
    for (const e of entries) {
      if (!m.has(e.employee_id)) m.set(e.employee_id, { id: e.employee_id, name: `${e.first_name||""} ${e.last_name||""}`.trim(), days: {}, reg: 0, ot: 0, dt: 0, total: 0, issues: 0, issueList: [], hasRedIssue: false });
      const r = m.get(e.employee_id)!;
      if (!r.days[e.report_date]) r.days[e.report_date] = [];
      r.days[e.report_date].push(e);
      r.reg += e.hours_regular || 0;
      r.ot += e.hours_overtime || 0;
      r.dt += e.hours_double || 0;
      r.total += totalH(e);
      const ei = getIssues(e);
      r.issues += ei.length;
      for (const i of ei) { if (!r.issueList.includes(i)) r.issueList.push(i); if (i.includes("Missing")) r.hasRedIssue = true; }
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  $: totals = (() => {
    let reg = 0, ot = 0, dt = 0, missingClock = 0, geoViolations = 0, noBreak = 0, excessiveHrs = 0;
    const crew = new Set<number>();
    for (const e of entries) {
      reg += e.hours_regular||0; ot += e.hours_overtime||0; dt += e.hours_double||0;
      crew.add(e.employee_id);
      const ei = getIssues(e);
      for (const i of ei) {
        if (i.includes("Missing")) missingClock++;
        else if (i.includes("geofence")) geoViolations++;
        else if (i.includes("break")) noBreak++;
        else if (i.includes("Excessive")) excessiveHrs++;
      }
    }
    const total = reg + ot + dt;
    const totalIssues = missingClock + geoViolations + noBreak + excessiveHrs;
    const avgPerPerson = crew.size > 0 ? total / crew.size : 0;
    const otPct = total > 0 ? ((ot + dt) / total) * 100 : 0;
    return { reg, ot, dt, total, crew: crew.size, count: entries.length,
      avgPerPerson, otPct,
      missingClock, geoViolations, noBreak, excessiveHrs, totalIssues };
  })();

  // ── Detail modal ───────────────────────────────────────
  async function openDetail(id: number) {
    detailLoading = true; detail = null; adjustMode = false; adjustments = [];
    try {
      const [res, adjRes] = await Promise.all([
        api.get(`/time-tracking/entries/${id}`),
        api.get(`/time-tracking/entries/${id}/adjustments`),
      ]);
      detail = res?.entry || null;
      adjustments = adjRes?.adjustments || [];
    } catch (e: any) { error = e.message; } finally { detailLoading = false; }
  }
  function closeDetail() { detail = null; adjustMode = false; }

  // Convert ISO string to datetime-local format (YYYY-MM-DDTHH:MM)
  function toLocalInput(iso: string | null): string {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      const pad = (n: number) => n.toString().padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ""; }
  }

  // Auto-calculate hours from clock in/out times and break
  function recalcHours() {
    adjustWarn = "";
    if (!adjustForm.clockIn || !adjustForm.clockOut) return;
    const inTime = new Date(adjustForm.clockIn).getTime();
    const outTime = new Date(adjustForm.clockOut).getTime();
    if (isNaN(inTime) || isNaN(outTime)) return;
    if (outTime <= inTime) {
      adjustWarn = "Clock out must be after clock in";
      adjustForm.hoursRegular = 0; adjustForm.hoursOvertime = 0; adjustForm.hoursDouble = 0;
      return;
    }
    const totalMin = (outTime - inTime) / 60000 - (adjustForm.breakMinutes || 0);
    if (totalMin <= 0) { adjustForm.hoursRegular = 0; adjustForm.hoursOvertime = 0; adjustForm.hoursDouble = 0; return; }
    const totalHrs = totalMin / 60;
    if (totalHrs > 16) {
      adjustWarn = `This entry spans ${totalHrs.toFixed(1)} hours — are you sure this is correct?`;
    } else if (totalHrs > 12) {
      adjustWarn = `This entry spans ${totalHrs.toFixed(1)} hours — double time will apply. Please confirm.`;
    }
    if (totalHrs <= 8) {
      adjustForm.hoursRegular = Math.round(totalHrs * 100) / 100;
      adjustForm.hoursOvertime = 0;
      adjustForm.hoursDouble = 0;
    } else if (totalHrs <= 12) {
      adjustForm.hoursRegular = 8;
      adjustForm.hoursOvertime = Math.round((totalHrs - 8) * 100) / 100;
      adjustForm.hoursDouble = 0;
    } else {
      adjustForm.hoursRegular = 8;
      adjustForm.hoursOvertime = 4;
      adjustForm.hoursDouble = Math.round((totalHrs - 12) * 100) / 100;
    }
  }

  function startAdjust() {
    if (!detail) return;
    adjustForm = {
      clockIn: toLocalInput(detail.clock_in),
      clockOut: toLocalInput(detail.clock_out),
      hoursRegular: detail.hours_regular || 0,
      hoursOvertime: detail.hours_overtime || 0,
      hoursDouble: detail.hours_double || 0,
      breakMinutes: detail.break_minutes || 0,
      notes: detail.notes || "",
      reason: "",
    };
    adjustError = "";
    adjustMode = true;
  }

  async function saveAdjust() {
    if (!adjustForm.reason.trim()) { adjustError = "Reason is required"; return; }
    if (adjustForm.clockIn && adjustForm.clockOut) {
      const inT = new Date(adjustForm.clockIn).getTime();
      const outT = new Date(adjustForm.clockOut).getTime();
      if (outT <= inT) { adjustError = "Clock out must be after clock in"; return; }
    }
    adjustSaving = true; adjustError = "";
    try {
      const changes: any = {};
      if (adjustForm.clockIn !== toLocalInput(detail.clock_in)) changes.clockIn = adjustForm.clockIn;
      if (adjustForm.clockOut !== toLocalInput(detail.clock_out)) changes.clockOut = adjustForm.clockOut;
      if (adjustForm.hoursRegular !== (detail.hours_regular || 0)) changes.hoursRegular = adjustForm.hoursRegular;
      if (adjustForm.hoursOvertime !== (detail.hours_overtime || 0)) changes.hoursOvertime = adjustForm.hoursOvertime;
      if (adjustForm.hoursDouble !== (detail.hours_double || 0)) changes.hoursDouble = adjustForm.hoursDouble;
      if (adjustForm.breakMinutes !== (detail.break_minutes || 0)) changes.breakMinutes = adjustForm.breakMinutes;
      if (adjustForm.notes !== (detail.notes || "")) changes.notes = adjustForm.notes;

      if (Object.keys(changes).length === 0) { adjustError = "No changes made"; adjustSaving = false; return; }

      await api.post(`/time-tracking/entries/${detail.id}/adjust`, { changes, reason: adjustForm.reason });
      await openDetail(detail.id); // refresh
      await loadEntries(); // refresh grid
    } catch (e: any) { adjustError = e.message; } finally { adjustSaving = false; }
  }

  // No-activity employees: active employees not in this week's entries
  $: noActivity = (() => {
    const activeIds = new Set(entries.map((e: any) => e.employee_id));
    return employees.filter((e: any) => !activeIds.has(e.id));
  })();

  // Crew with entries this week (for avatar display)
  $: crewList = (() => {
    const seen = new Set<number>();
    const list: any[] = [];
    for (const e of entries) {
      if (!seen.has(e.employee_id)) {
        seen.add(e.employee_id);
        list.push({ id: e.employee_id, name: `${e.first_name||""} ${e.last_name||""}`.trim(), initials: `${(e.first_name||"?")[0]}${(e.last_name||"?")[0]}`.toUpperCase() });
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  })();

  function openCrewModal(title: string, list: any[]) {
    crewModalTitle = title;
    crewModalList = list;
    crewModalOpen = true;
  }
  function closeCrewModal() { crewModalOpen = false; }

  function getInitials(e: any): string {
    return `${(e.firstName || e.first_name || "?")[0]}${(e.lastName || e.last_name || "?")[0]}`.toUpperCase();
  }
  function getFullName(e: any): string {
    return `${e.firstName || e.first_name || ""} ${e.lastName || e.last_name || ""}`.trim();
  }

  onMount(() => { loadFilters(); loadEntries(); });
</script>

<div class="te">
  <!-- Header -->
  <div class="te-header">
    <h1 class="te-h1">Time Entries</h1>
    <div class="te-nav">
      <button class="te-nav-btn" on:click={() => shiftWeek(-1)}>‹</button>
      <span class="te-nav-label">{fmtDay(dateFrom)} {fmtDayNum(dateFrom)} — {fmtDay(dateTo)} {fmtDayNum(dateTo)}</span>
      <button class="te-nav-btn" on:click={() => shiftWeek(1)}>›</button>
      <button class="te-today" on:click={goThisWeek}>This Week</button>
    </div>
  </div>

  <!-- Dashboard Cards -->
  <div class="te-cards">
    <!-- Crew This Week -->
    <button class="te-card te-card-click" on:click={() => openCrewModal("Crew This Week", crewList)}>
      <div class="te-card-icon te-card-icon-blue">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
      </div>
      <div class="te-card-body">
        <div class="te-card-val">{totals.crew}</div>
        <div class="te-card-lbl">Crew This Week</div>
        <div class="te-avatar-stack">
          {#each crewList.slice(0, 5) as c, i}
            <span class="te-avatar" style="z-index:{5-i};" title={c.name}>{c.initials}</span>
          {/each}
          {#if crewList.length > 5}<span class="te-avatar te-avatar-more" style="z-index:0;">+{crewList.length - 5}</span>{/if}
        </div>
      </div>
    </button>

    <!-- No Activity -->
    <button class="te-card te-card-click" class:te-card-dim={noActivity.length === 0} on:click={() => openCrewModal("No Activity This Week", noActivity.map(e => ({ id: e.id, name: getFullName(e), initials: getInitials(e) })))}>
      <div class="te-card-icon te-card-icon-slate">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
      </div>
      <div class="te-card-body">
        <div class="te-card-val">{noActivity.length}</div>
        <div class="te-card-lbl">No Activity</div>
        <div class="te-avatar-stack">
          {#each noActivity.slice(0, 4) as e, i}
            <span class="te-avatar te-avatar-gray" style="z-index:{4-i};" title={getFullName(e)}>{getInitials(e)}</span>
          {/each}
          {#if noActivity.length > 4}<span class="te-avatar te-avatar-more" style="z-index:0;">+{noActivity.length - 4}</span>{/if}
        </div>
      </div>
    </button>

    <!-- Total Hours -->
    <div class="te-card">
      <div class="te-card-icon te-card-icon-green">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <div class="te-card-body">
        <div class="te-card-val">{fmtH(totals.total)}</div>
        <div class="te-card-lbl">Total Hours</div>
        <div class="te-card-sub">{fmtH(totals.avgPerPerson)} avg / person</div>
      </div>
    </div>

    <!-- Regular -->
    <div class="te-card">
      <div class="te-card-icon te-card-icon-teal">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
      <div class="te-card-body">
        <div class="te-card-val">{fmtH(totals.reg)}</div>
        <div class="te-card-lbl">Regular</div>
        <div class="te-card-sub">{totals.total > 0 ? (100 - totals.otPct).toFixed(0) : 0}% of total</div>
      </div>
    </div>

    <!-- OT / DT -->
    <div class="te-card te-card-warn">
      <div class="te-card-icon te-card-icon-orange">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <div class="te-card-body">
        <div class="te-card-val">{fmtH(totals.ot + totals.dt)}</div>
        <div class="te-card-lbl">OT / DT</div>
        <div class="te-card-sub">{totals.otPct.toFixed(0)}% of total{totals.dt > 0 ? ` · ${fmtH(totals.dt)} DT` : ""}</div>
      </div>
    </div>

    <!-- Issues -->
    <div class="te-card" class:te-card-err={totals.totalIssues > 0}>
      <div class="te-card-icon" class:te-card-icon-red={totals.totalIssues > 0} class:te-card-icon-green={totals.totalIssues === 0}>
        {#if totals.totalIssues > 0}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        {/if}
      </div>
      <div class="te-card-body">
        <div class="te-card-val">{totals.totalIssues}</div>
        <div class="te-card-lbl">{totals.totalIssues === 0 ? "All Clear" : "Issues"}</div>
        {#if totals.totalIssues > 0}
          <div class="te-card-issues">
            {#if totals.missingClock > 0}<span class="te-ci te-ci-red">{totals.missingClock} missing</span>{/if}
            {#if totals.geoViolations > 0}<span class="te-ci te-ci-orange">{totals.geoViolations} geo</span>{/if}
            {#if totals.noBreak > 0}<span class="te-ci te-ci-yellow">{totals.noBreak} break</span>{/if}
            {#if totals.excessiveHrs > 0}<span class="te-ci te-ci-red">{totals.excessiveHrs} excess</span>{/if}
          </div>
        {:else}
          <div class="te-card-sub">No issues this week</div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Filters -->
  <div class="te-filters">
    <select class="select select-xs select-bordered" bind:value={filterJob} on:change={loadEntries}>
      <option value="">All Jobs</option>
      {#each jobs as j}<option value={j.id}>{j.jobNumber} — {j.name}</option>{/each}
    </select>
    <select class="select select-xs select-bordered" bind:value={filterEmployee} on:change={loadEntries}>
      <option value="">All Employees</option>
      {#each employees as e}<option value={e.id}>{e.firstName} {e.lastName}</option>{/each}
    </select>
    <select class="select select-xs select-bordered" bind:value={filterSource} on:change={loadEntries}>
      <option value="">All Sources</option>
      <option value="mobile">Mobile</option><option value="tablet">Tablet</option><option value="manual">Manual</option>
    </select>
    <label class="te-flag-check">
      <input type="checkbox" class="checkbox checkbox-xs checkbox-error" bind:checked={filterFlagged} on:change={loadEntries} />
      <span>Flagged Only</span>
    </label>
  </div>

  {#if error}<div class="te-error">{error}</div>{/if}

  <!-- Grid -->
  {#if loading}
    <div class="te-loading"><span class="loading loading-spinner loading-md text-primary"></span></div>
  {:else if rows.length === 0}
    <div class="te-empty">No time entries for this week</div>
  {:else}
    <div class="te-grid">
      <div class="te-grid-head">
        <div class="te-g-emp">Employee</div>
        {#each weekDates as d}<div class="te-g-day">{fmtDay(d)}<span>{fmtDayNum(d)}</span></div>{/each}
        <div class="te-g-hrs">Hours</div>
      </div>
      {#each rows as row (row.id)}
        <div class="te-grid-row">
          <div class="te-g-emp te-emp" class:te-emp-glow-red={row.hasRedIssue} class:te-emp-glow-yellow={row.issues > 0 && !row.hasRedIssue}>
            <span class="te-emp-name">{row.name}</span>
            {#if row.issues > 0}
              <span class="te-issue-pill" class:te-issue-pill-red={row.hasRedIssue} class:te-issue-pill-yellow={!row.hasRedIssue}>
                {row.issues}
                <span class="te-tooltip">{row.issueList.join(" · ")}</span>
              </span>
            {/if}
          </div>
          {#each weekDates as d}
            {@const de = row.days[d] || []}
            {@const st = cellStatus(de)}
            {@const hrs = cellHours(de)}
            {@const dayIssues = cellIssueList(de)}
            <div class="te-g-day te-g-day-cell">
              {#if de.length > 0}
                <button class="te-cell" class:te-cell-red={st==="red"} class:te-cell-yellow={st==="yellow"} on:click={() => openDetail(de[0].id)}>
                  <div class="te-cell-r1">
                    <span class="te-cell-h">{hrs.toFixed(1)}</span>
                    {#if st === "green"}
                      <span class="te-status-chip te-chip-green">
                        <svg viewBox="0 0 18 18" width="13" height="13" fill="none"><path d="M4.5 9.5l3 3 6-6" stroke="#15803d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      </span>
                    {:else if st === "yellow"}
                      <span class="te-status-chip te-chip-yellow te-has-tip">
                        <svg viewBox="0 0 18 18" width="13" height="13" fill="none"><circle cx="9" cy="9" r="7" stroke="#b45309" stroke-width="1.5"/><line x1="9" y1="5.5" x2="9" y2="9.5" stroke="#b45309" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="12.5" r="1" fill="#b45309"/></svg>
                        <span class="te-tooltip">{dayIssues.join(" · ")}</span>
                      </span>
                    {:else if st === "red"}
                      <span class="te-status-chip te-chip-red te-has-tip">
                        <svg viewBox="0 0 18 18" width="13" height="13" fill="none"><circle cx="9" cy="9" r="7" stroke="#dc2626" stroke-width="1.5"/><path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="#dc2626" stroke-width="1.8" stroke-linecap="round"/></svg>
                        <span class="te-tooltip">{dayIssues.join(" · ")}</span>
                      </span>
                    {/if}
                  </div>
                  <div class="te-cell-job">{de[0].job_number} {de[0].job_name || ""}</div>
                  <div class="te-cell-io">{fmtTime(de[0].clock_in)} → {fmtTime(de[0].clock_out)}</div>
                  {#if de.length > 1}<div class="te-cell-more">+{de.length - 1} more</div>{/if}
                </button>
              {/if}
            </div>
          {/each}
          <div class="te-g-hrs te-hrs-cell">
            <div class="te-hrs-total">{row.total.toFixed(1)}</div>
            <div class="te-hrs-sub">
              {row.reg.toFixed(1)}r
              {#if row.ot > 0}<span class="te-ot">{row.ot.toFixed(1)}ot</span>{/if}
              {#if row.dt > 0}<span class="te-dt">{row.dt.toFixed(1)}dt</span>{/if}
            </div>
            {#if row.issues > 0}
              <div class="te-hrs-issue">
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="4.5" x2="8" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11" r="0.9" fill="currentColor"/></svg>
                {row.issues}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Detail / Adjust Modal -->
{#if detail || detailLoading}
  <div class="modal modal-open">
    <div class="modal-box max-w-2xl">
      {#if detailLoading}
        <div class="flex justify-center p-8"><span class="loading loading-spinner loading-lg"></span></div>
      {:else if detail}
        {@const d = detail}
        {@const issues = getIssues(d)}

        <div class="flex items-start justify-between mb-3">
          <div>
            <h3 class="font-bold text-lg">{d.first_name} {d.last_name}</h3>
            <p class="text-sm text-base-content/60">{d.job_number} — {d.job_name}</p>
            <p class="text-xs text-base-content/40">{d.report_date} · {sourceLabel(d.source)} {d.source}</p>
          </div>
          <button class="btn btn-sm btn-ghost" on:click={closeDetail}>✕</button>
        </div>

        <!-- Issues banner -->
        {#if issues.length > 0 && !adjustMode}
          <div class="te-issues-banner">
            <div class="te-issues-title">
              <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="11.5" r="1" fill="currentColor"/><rect x="7.25" y="3" width="1.5" height="6" rx=".75" fill="currentColor"/></svg>
              {issues.length} Issue{issues.length > 1 ? "s" : ""} Found
            </div>
            {#each issues as issue}<div class="te-issue-item">{issue}</div>{/each}
            <button class="te-adjust-btn" on:click={startAdjust}>Adjust Entry</button>
          </div>
        {/if}

        {#if adjustMode}
          <!-- Adjust form -->
          <div class="te-adjust-form">
            <div class="te-adjust-header">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="#636366" stroke-width="1.5"><path d="M10 3.5v7l4 2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="10" r="8"/></svg>
              <h4>Adjust Time Entry</h4>
            </div>
            <div class="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label class="text-xs text-base-content/50">Clock In</label>
                <input type="datetime-local" class="input input-sm input-bordered w-full" bind:value={adjustForm.clockIn} on:change={recalcHours} />
              </div>
              <div>
                <label class="text-xs text-base-content/50">Clock Out</label>
                <input type="datetime-local" class="input input-sm input-bordered w-full" bind:value={adjustForm.clockOut} on:change={recalcHours} />
              </div>
            </div>
            {#if adjustWarn}
              <div class="te-adjust-warn">{adjustWarn}</div>
            {/if}
            <div class="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label class="text-xs text-base-content/50">Regular</label>
                <input type="number" step="0.1" class="input input-sm input-bordered w-full" bind:value={adjustForm.hoursRegular} />
              </div>
              <div>
                <label class="text-xs text-base-content/50">OT</label>
                <input type="number" step="0.1" class="input input-sm input-bordered w-full" bind:value={adjustForm.hoursOvertime} />
              </div>
              <div>
                <label class="text-xs text-base-content/50">DT</label>
                <input type="number" step="0.1" class="input input-sm input-bordered w-full" bind:value={adjustForm.hoursDouble} />
              </div>
              <div>
                <label class="text-xs text-base-content/50">Break</label>
                <input type="number" class="input input-sm input-bordered w-full" bind:value={adjustForm.breakMinutes} on:change={recalcHours} />
              </div>
            </div>
            <div class="mb-3">
              <label class="text-xs text-base-content/50">Reason for Adjustment <span class="text-error">*</span></label>
              <textarea class="textarea textarea-sm textarea-bordered w-full" rows="2" bind:value={adjustForm.reason} placeholder="Why is this being changed?"></textarea>
            </div>
            {#if adjustError}<p class="text-xs text-error mb-2">{adjustError}</p>{/if}
            <div class="flex gap-2">
              <button class="btn btn-sm btn-primary" on:click={saveAdjust} disabled={adjustSaving}>
                {adjustSaving ? "Saving..." : "Save Adjustment"}
              </button>
              <button class="btn btn-sm btn-ghost" on:click={() => { adjustMode = false; }}>Cancel</button>
            </div>
          </div>
        {:else}
          <!-- Normal detail view -->
          <div class="grid grid-cols-2 gap-3 mb-4">
            <div class="te-d-block">
              <div class="te-d-lbl">Clock In</div>
              <div class="te-d-time">{fmtTime(d.clock_in)}</div>
              {#if d.clock_in_address}<div class="te-d-addr">{d.clock_in_address}</div>{/if}
              {#if d.clock_in_lat}<div class="te-d-coords">{d.clock_in_lat.toFixed(5)}, {d.clock_in_lng.toFixed(5)}</div>{/if}
              <div class="mt-1">
                {#if d.clock_in_inside_geofence === 1}<span class="badge badge-xs badge-success">On site</span>
                {:else if d.clock_in_inside_geofence === 0}<span class="badge badge-xs badge-error">Outside geofence</span>{/if}
              </div>
              {#if d.clock_in_photo_url}<img src={d.clock_in_photo_url} alt="Clock-in" class="te-d-photo" />{/if}
            </div>
            <div class="te-d-block">
              <div class="te-d-lbl">Clock Out</div>
              <div class="te-d-time">{d.clock_out ? fmtTime(d.clock_out) : "Still clocked in"}</div>
              {#if d.clock_out_address}<div class="te-d-addr">{d.clock_out_address}</div>{/if}
              {#if d.clock_out_lat}<div class="te-d-coords">{d.clock_out_lat.toFixed(5)}, {d.clock_out_lng.toFixed(5)}</div>{/if}
              {#if d.clock_out}
                <div class="mt-1">
                  {#if d.clock_out_inside_geofence === 1}<span class="badge badge-xs badge-success">On site</span>
                  {:else if d.clock_out_inside_geofence === 0}<span class="badge badge-xs badge-error">Outside geofence</span>{/if}
                </div>
              {/if}
              {#if d.clock_out_photo_url}<img src={d.clock_out_photo_url} alt="Clock-out" class="te-d-photo" />{/if}
            </div>
          </div>

          {#if d.clock_in_lat && d.clock_in_lng}
            <div class="te-d-map">
              <img src="/api/maps/static-map?lat={d.job_lat||d.clock_in_lat}&lng={d.job_lng||d.clock_in_lng}&zoom=16&size=600x200&markers={d.clock_in_lat},{d.clock_in_lng}{d.clock_out_lat ? `|${d.clock_out_lat},${d.clock_out_lng}` : ''}" alt="Map" class="te-d-map-img" />
            </div>
          {/if}

          <div class="grid grid-cols-4 gap-2 mb-4">
            <div class="te-d-stat"><b>{fmtH(d.hours_regular)}</b><span>Regular</span></div>
            <div class="te-d-stat"><b>{fmtH(d.hours_overtime)}</b><span>OT</span></div>
            <div class="te-d-stat"><b>{fmtH(d.hours_double)}</b><span>DT</span></div>
            <div class="te-d-stat"><b>{d.break_minutes||0}m</b><span>Break</span></div>
          </div>

          {#if d.work_performed}<div class="mb-3"><div class="text-xs font-medium text-base-content/50 mb-1">Work Performed</div><p class="text-sm">{d.work_performed}</p></div>{/if}
          {#if d.notes}<div class="mb-3"><div class="text-xs font-medium text-base-content/50 mb-1">Notes</div><p class="text-sm">{d.notes}</p></div>{/if}

          <!-- Audit trail -->
          {#if adjustments.length > 0}
            <div class="te-audit">
              <div class="te-audit-title">Adjustment History</div>
              {#each adjustments as a}
                <div class="te-audit-row">
                  <span class="te-audit-who">{a.first_name} {a.last_name}</span>
                  changed <b>{a.field_changed}</b>
                  <span class="te-audit-vals">{a.old_value} → {a.new_value}</span>
                  <span class="te-audit-reason">"{a.reason}"</span>
                  <span class="te-audit-when">{new Date(a.adjusted_at).toLocaleDateString()}</span>
                </div>
              {/each}
            </div>
          {/if}

          <div class="modal-action">
            {#if issues.length === 0}
              <button class="btn btn-sm btn-outline" on:click={startAdjust}>Adjust</button>
            {/if}
            <button class="btn btn-sm btn-ghost" on:click={closeDetail}>Close</button>
          </div>
        {/if}
      {/if}
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={closeDetail}></div>
  </div>
{/if}

<!-- Crew / No Activity Modal -->
{#if crewModalOpen}
  <div class="modal modal-open">
    <div class="modal-box max-w-md">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold text-lg">{crewModalTitle}</h3>
        <button class="btn btn-sm btn-ghost" on:click={closeCrewModal}>✕</button>
      </div>
      {#if crewModalList.length === 0}
        <p class="text-sm text-base-content/50 text-center py-6">No employees</p>
      {:else}
        <div class="te-crew-list">
          {#each crewModalList as person}
            <div class="te-crew-row">
              <span class="te-avatar te-avatar-lg">{person.initials}</span>
              <span class="te-crew-name">{person.name}</span>
            </div>
          {/each}
        </div>
      {/if}
      <div class="modal-action">
        <button class="btn btn-sm btn-ghost" on:click={closeCrewModal}>Close</button>
      </div>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={closeCrewModal}></div>
  </div>
{/if}

<style>
  .te { max-width: 100%; }

  .te-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .te-h1 { font-size: 22px; font-weight: 700; color: #1d1d1f; letter-spacing: -0.02em; margin: 0; }
  .te-nav { display: flex; align-items: center; gap: 6px; }
  .te-nav-btn { width: 30px; height: 30px; border: 1px solid #e5e5ea; border-radius: 8px; background: white; font-size: 1.125rem; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #1d1d1f; }
  .te-nav-btn:hover { background: #f2f2f7; }
  .te-nav-label { font-size: 0.875rem; font-weight: 600; min-width: 150px; text-align: center; }
  .te-today { font-size: 0.75rem; padding: 5px 12px; border: 1px solid #007aff; border-radius: 7px; background: white; color: #007aff; font-weight: 500; cursor: pointer; }
  .te-today:hover { background: #007aff; color: white; }

  /* Dashboard cards */
  .te-cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 16px; }
  .te-card {
    background: white; border: 1px solid #e5e5ea; border-radius: 14px;
    padding: 14px 16px; display: flex; align-items: flex-start; gap: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .te-card-click {
    cursor: pointer; text-align: left; font-family: inherit; transition: border-color 0.15s, box-shadow 0.15s;
  }
  .te-card-click:hover { border-color: #007aff; box-shadow: 0 2px 8px rgba(0,122,255,0.1); }
  .te-card-dim { opacity: 0.65; }
  .te-card-icon {
    width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .te-card-icon-blue { background: #eff6ff; color: #2563eb; }
  .te-card-icon-green { background: #f0fdf4; color: #16a34a; }
  .te-card-icon-teal { background: #f0fdfa; color: #0d9488; }
  .te-card-icon-orange { background: #fff7ed; color: #ea580c; }
  .te-card-icon-red { background: #fef2f2; color: #dc2626; }
  .te-card-icon-slate { background: #f1f5f9; color: #64748b; }
  .te-card-body { flex: 1; min-width: 0; }
  .te-card-val { font-size: 1.5rem; font-weight: 700; color: #1d1d1f; line-height: 1.1; }
  .te-card-lbl { font-size: 0.6875rem; color: #86868b; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
  .te-card-sub { font-size: 0.6875rem; color: #aeaeb2; margin-top: 3px; }
  .te-card-issues { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .te-ci { font-size: 0.625rem; font-weight: 600; padding: 2px 7px; border-radius: 6px; white-space: nowrap; }
  .te-ci-red { background: #fef2f2; color: #dc2626; }
  .te-ci-orange { background: #fff7ed; color: #ea580c; }
  .te-ci-yellow { background: #fefce8; color: #a16207; }
  .te-card-warn .te-card-val { color: #ea580c; }
  .te-card-err { border-color: #fca5a5; background: #fef8f8; }
  .te-card-err .te-card-val { color: #dc2626; }

  /* Stacked avatar circles */
  .te-avatar-stack { display: flex; margin-top: 6px; }
  .te-avatar {
    width: 28px; height: 28px; border-radius: 50%; background: #007aff; color: white;
    font-size: 0.5625rem; font-weight: 700; display: flex; align-items: center; justify-content: center;
    border: 2px solid white; margin-left: -8px; letter-spacing: 0.02em;
  }
  .te-avatar:first-child { margin-left: 0; }
  .te-avatar-gray { background: #94a3b8; }
  .te-avatar-more { background: #e2e8f0; color: #475569; font-size: 0.5rem; }
  .te-avatar-lg { width: 36px; height: 36px; font-size: 0.6875rem; margin-left: 0; }

  /* Crew modal list */
  .te-crew-list { max-height: 400px; overflow-y: auto; }
  .te-crew-row {
    display: flex; align-items: center; gap: 12px; padding: 8px 4px;
    border-bottom: 1px solid #f2f2f7;
  }
  .te-crew-row:last-child { border-bottom: none; }
  .te-crew-name { font-size: 0.875rem; font-weight: 500; color: #1d1d1f; }

  /* Filters */
  .te-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; align-items: center; }
  .te-flag-check { display: flex; align-items: center; gap: 4px; font-size: 0.75rem; cursor: pointer; }
  .te-error { padding: 8px 12px; background: #ffeef0; color: #d32f2f; border-radius: 8px; font-size: 0.8125rem; margin-bottom: 12px; }
  .te-loading { display: flex; justify-content: center; padding: 48px; }
  .te-empty { text-align: center; padding: 48px; color: #aeaeb2; }

  /* Grid */
  .te-grid { background: white; border: 1px solid #f2f2f7; border-radius: 14px; overflow: hidden; }
  .te-grid-head {
    display: grid; grid-template-columns: 170px repeat(7, minmax(0, 1fr)) 90px;
    background: #fafafa; border-bottom: 1px solid #e5e5ea;
  }
  .te-grid-head > div {
    padding: 10px 6px; font-size: 0.6875rem; font-weight: 600; color: #86868b;
    text-transform: uppercase; letter-spacing: 0.04em; text-align: center;
  }
  .te-grid-head > div span { display: block; font-size: 0.9375rem; font-weight: 700; color: #1d1d1f; margin-top: 1px; }
  .te-grid-head .te-g-emp { text-align: left; padding-left: 16px; }

  .te-grid-row {
    display: grid; grid-template-columns: 170px repeat(7, minmax(0, 1fr)) 90px;
    border-bottom: 1px solid #f2f2f7; align-items: stretch;
  }
  .te-grid-row:last-child { border-bottom: none; }

  .te-emp {
    padding: 10px 16px; display: flex; align-items: center; gap: 6px;
    border-right: 1px solid #f2f2f7;
  }
  .te-emp-name { font-size: 0.8125rem; font-weight: 600; color: #1d1d1f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }

  /* Employee row glow — left border + subtle bg tint */
  .te-emp-glow-red { box-shadow: inset 3px 0 0 #ef4444; background: #fef8f8; }
  .te-emp-glow-yellow { box-shadow: inset 3px 0 0 #f59e0b; background: #fffdf5; }

  .te-issue-pill {
    display: inline-flex; align-items: center; justify-content: center; position: relative;
    font-size: 0.6875rem; font-weight: 700;
    width: 22px; height: 22px; border-radius: 100px;
    flex-shrink: 0; line-height: 1; cursor: default;
  }
  .te-issue-pill-red { color: #dc2626; background: #fee2e2; }
  .te-issue-pill-yellow { color: #b45309; background: #fef3c7; }

  /* Tooltip — shared by issue pill and status chips */
  .te-tooltip {
    display: none; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
    background: #1d1d1f; color: white; font-size: 0.6875rem; font-weight: 500;
    padding: 5px 10px; border-radius: 7px; white-space: nowrap; z-index: 50;
    pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }
  .te-tooltip::after {
    content: ""; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
    border: 5px solid transparent; border-top-color: #1d1d1f;
  }
  .te-issue-pill:hover .te-tooltip,
  .te-has-tip:hover .te-tooltip { display: block; }

  /* Day cells with column dividers */
  .te-g-day-cell {
    padding: 4px; border-right: 1px solid #f2f2f7;
    display: flex; flex-direction: column;
    min-width: 0; overflow: hidden;
  }
  .te-g-day-cell:last-of-type { border-right: none; }

  .te-cell {
    width: 100%; flex: 1; padding: 6px 7px; background: #f9f9fb; border: 1px solid transparent;
    border-radius: 8px; cursor: pointer; text-align: left; font-family: inherit;
    transition: all 0.1s; display: flex; flex-direction: column;
    min-width: 0; overflow: hidden;
  }
  .te-cell:hover { border-color: #007aff; background: #f0f5ff; }

  .te-cell-red { background: #fef8f8; border-color: #fecaca !important; }
  .te-cell-red:hover { background: #fef2f2; border-color: #f87171 !important; }
  .te-cell-yellow { background: #fffdf5; border-color: #fde68a !important; }
  .te-cell-yellow:hover { background: #fefce8; border-color: #fbbf24 !important; }

  .te-cell-r1 { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
  .te-cell-h { font-size: 0.875rem; font-weight: 700; color: #1d1d1f; }
  .te-status-chip {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 7px; flex-shrink: 0;
  }
  .te-chip-green { background: #dcfce7; }
  .te-chip-yellow { background: #fef3c7; }
  .te-chip-red { background: #fee2e2; }
  .te-cell-job { font-size: 0.6875rem; color: #636366; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 1px; }
  .te-cell-io { font-size: 0.6875rem; color: #86868b; white-space: nowrap; }
  .te-cell-more { font-size: 0.5625rem; color: #007aff; font-weight: 500; margin-top: 2px; }

  /* Hours column */
  .te-g-hrs { border-left: 1px solid #f2f2f7; }
  .te-hrs-cell { padding: 10px 8px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .te-hrs-total { font-size: 1.125rem; font-weight: 700; color: #1d1d1f; }
  .te-hrs-sub { font-size: 0.6875rem; color: #86868b; }
  .te-ot { color: #ff9f0a; font-weight: 600; }
  .te-dt { color: #ff3b30; font-weight: 600; }
  .te-hrs-issue {
    display: inline-flex; align-items: center; gap: 2px; margin-top: 3px;
    font-size: 0.625rem; font-weight: 700; color: #dc2626;
    background: #fef2f2; border: 1px solid #fecaca; border-radius: 100px;
    padding: 1px 6px 1px 4px; line-height: 1;
  }

  /* Detail modal */
  .te-d-block { background: #f9f9fb; border-radius: 10px; padding: 12px; }
  .te-d-lbl { font-size: 0.625rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #aeaeb2; margin-bottom: 4px; }
  .te-d-time { font-size: 1.25rem; font-weight: 700; color: #1d1d1f; }
  .te-d-addr { font-size: 0.75rem; color: #86868b; margin-top: 2px; }
  .te-d-coords { font-size: 0.6875rem; color: #aeaeb2; font-family: monospace; }
  .te-d-photo { margin-top: 8px; border-radius: 8px; max-height: 120px; object-fit: cover; width: 100%; }
  .te-d-map { margin-bottom: 16px; border-radius: 12px; overflow: hidden; border: 1px solid #e5e5ea; }
  .te-d-map-img { width: 100%; height: 180px; object-fit: cover; display: block; }
  .te-d-stat { background: #f9f9fb; border-radius: 8px; padding: 8px 6px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .te-d-stat b { font-size: 0.9375rem; font-weight: 700; color: #1d1d1f; }
  .te-d-stat span { font-size: 0.5625rem; color: #aeaeb2; text-transform: uppercase; }

  /* Issues banner */
  .te-issues-banner {
    background: #fef3f2; border: 1px solid #fecaca; border-radius: 10px;
    padding: 12px 14px; margin-bottom: 16px;
  }
  .te-issues-title {
    display: flex; align-items: center; gap: 6px;
    font-size: 0.8125rem; font-weight: 600; color: #dc2626; margin-bottom: 6px;
  }
  .te-issue-item { font-size: 0.75rem; color: #7f1d1d; padding: 2px 0 2px 20px; }
  .te-adjust-btn {
    margin-top: 8px; padding: 6px 14px; font-size: 0.75rem; font-weight: 600;
    background: #dc2626; color: white; border: none; border-radius: 7px;
    cursor: pointer; font-family: inherit;
  }
  .te-adjust-btn:hover { background: #b91c1c; }

  /* Adjust form */
  .te-adjust-form { background: #f9f9fb; border: 1px solid #e5e5ea; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .te-adjust-header { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .te-adjust-header h4 { font-size: 0.875rem; font-weight: 600; color: #1d1d1f; margin: 0; }
  .te-adjust-warn {
    font-size: 0.75rem; font-weight: 500; color: #b45309; background: #fefce8;
    border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px;
    display: flex; align-items: center; gap: 6px;
  }
  .te-adjust-warn::before {
    content: "⚠"; font-size: 0.875rem;
  }

  /* Audit trail */
  .te-audit { margin-top: 12px; padding-top: 12px; border-top: 1px solid #f2f2f7; }
  .te-audit-title { font-size: 0.6875rem; font-weight: 600; color: #86868b; text-transform: uppercase; margin-bottom: 6px; }
  .te-audit-row { font-size: 0.6875rem; color: #636366; padding: 4px 0; border-bottom: 1px solid #f9f9fb; }
  .te-audit-who { font-weight: 600; color: #1d1d1f; }
  .te-audit-vals { color: #007aff; }
  .te-audit-reason { color: #86868b; font-style: italic; }
  .te-audit-when { color: #aeaeb2; float: right; }

  /* Responsive */
  @media (max-width: 1400px) {
    .te-cards { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 768px) {
    .te-cards { grid-template-columns: repeat(2, 1fr); }
    .te-card { padding: 10px 12px; }
    .te-card-icon { width: 32px; height: 32px; border-radius: 8px; }
    .te-card-val { font-size: 1.25rem; }
    .te-grid-head, .te-grid-row { grid-template-columns: 110px repeat(7, 1fr) 60px; }
    .te-emp-name { font-size: 0.6875rem; }
    .te-cell { padding: 4px 5px; }
  }
</style>
