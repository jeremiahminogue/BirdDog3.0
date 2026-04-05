<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  // ── Types ──────────────────────────────────────────────────────
  interface ScheduleJob { jobId: number; jobNumber: string; jobName: string; }
  interface DayCell { date: string; job: ScheduleJob | null; moveId: number | null; isMove: boolean; }
  interface ScheduleEmployee {
    id: number; firstName: string; lastName: string; employeeNumber: string;
    classificationName: string; classificationColor: string; department: string;
    schedule: DayCell[];
  }
  interface BarData {
    jobId: number | null; jobNumber: string; jobName: string;
    startIdx: number; endIdx: number; isScheduled: boolean;
  }
  interface RowData {
    empId: number; firstName: string; lastName: string;
    classification: string; classColor: string;
    bars: BarData[];
  }
  interface GroupData { label: string; key: string; rows: RowData[]; }

  // ── State ──────────────────────────────────────────────────────
  let employees: ScheduleEmployee[] = [];
  let dates: string[] = [];
  let loading = true;
  let error = "";
  let weekStart = getMonday(new Date());
  let numWeeks = 3;
  let sortMode: "person" | "job" | "classification" = "job";

  // ── Date Helpers ───────────────────────────────────────────────
  function getMonday(d: Date): string {
    const dt = new Date(d);
    const day = dt.getDay();
    dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
    return dt.toISOString().slice(0, 10);
  }
  function addDays(s: string, n: number): string {
    const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function fmtDay(d: string): string {
    return ["Su","M","Tu","W","Th","F","Sa"][new Date(d + "T12:00:00").getDay()];
  }
  function fmtDate(d: string): string {
    const dt = new Date(d + "T12:00:00");
    return `${dt.getMonth()+1}/${dt.getDate()}`;
  }
  function fmtWeekRange(): string {
    if (!dates.length) return "";
    const s = new Date(dates[0] + "T12:00:00");
    const e = new Date(dates[dates.length-1] + "T12:00:00");
    const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return s.getMonth() === e.getMonth()
      ? `${m[s.getMonth()]} ${s.getDate()} \u2013 ${e.getDate()}, ${s.getFullYear()}`
      : `${m[s.getMonth()]} ${s.getDate()} \u2013 ${m[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
  }

  $: today = new Date().toISOString().slice(0, 10);
  $: weekRange = dates.length ? fmtWeekRange() : "";

  // ── Bar Building ───────────────────────────────────────────────
  function buildBars(emp: ScheduleEmployee): BarData[] {
    const bars: BarData[] = [];
    let i = 0;
    while (i < emp.schedule.length) {
      const cell = emp.schedule[i];
      const jobKey = cell.job ? cell.job.jobId : null;
      const startIdx = i;
      while (i < emp.schedule.length) {
        const c = emp.schedule[i];
        const k = c.job ? c.job.jobId : null;
        if (k !== jobKey) break;
        i++;
      }
      if (jobKey !== null) {
        const slice = emp.schedule.slice(startIdx, i);
        bars.push({
          jobId: jobKey,
          jobNumber: cell.job!.jobNumber,
          jobName: cell.job!.jobName,
          startIdx,
          endIdx: i - 1,
          isScheduled: slice.some(c => c.isMove),
        });
      }
    }
    return bars;
  }

  function buildRows(emps: ScheduleEmployee[]): RowData[] {
    return emps.map(emp => ({
      empId: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      classification: emp.classificationName || "",
      classColor: emp.classificationColor || "#94a3b8",
      bars: buildBars(emp),
    }));
  }

  // ── Grouping / Sorting ────────────────────────────────────────
  $: groups = buildGroups(buildRows(employees), sortMode);

  function buildGroups(rows: RowData[], mode: string): GroupData[] {
    if (mode === "person") {
      const sorted = [...rows].sort((a, b) => a.lastName.localeCompare(b.lastName));
      return [{ label: "", key: "all", rows: sorted }];
    }
    if (mode === "job") {
      const map = new Map<string, { label: string; num: string; rows: RowData[] }>();
      for (const row of rows) {
        const bar = row.bars[0];
        const key = bar ? String(bar.jobId) : "bench";
        const label = bar ? `${bar.jobNumber} \u2014 ${bar.jobName}` : "Bench";
        const num = bar ? bar.jobNumber : "zzz";
        if (!map.has(key)) map.set(key, { label, num, rows: [] });
        map.get(key)!.rows.push(row);
      }
      return [...map.values()]
        .sort((a, b) => a.num.localeCompare(b.num))
        .map(g => ({ label: g.label, key: g.num, rows: g.rows.sort((a,b) => a.lastName.localeCompare(b.lastName)) }));
    }
    const map = new Map<string, RowData[]>();
    for (const row of rows) {
      const key = row.classification || "Unclassified";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return [...map.entries()]
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([label, rows]) => ({ label, key: label, rows: rows.sort((a,b) => a.lastName.localeCompare(b.lastName)) }));
  }

  $: totalPeople = employees.length;
  $: totalJobs = new Set(employees.flatMap(e => e.schedule.filter(c => c.job).map(c => c.job!.jobId))).size;

  // ── Visual Helpers ─────────────────────────────────────────────
  function jobHue(jn: string): number {
    let h = 0;
    for (let i = 0; i < jn.length; i++) h = jn.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h % 360);
  }
  function classAbbrev(name: string): string {
    const map: Record<string, string> = {
      "Journeyman Wireman":"JW","Apprentice":"Appr","Foreman":"Foreman",
      "General Foreman":"Gen Foreman","Master Electrician":"Master","Helper":"Helper",
      "Superintendent":"Super","Journeyman":"JM","CW-1":"CW-1","CW-2":"CW-2",
      "CW-3":"CW-3","CW-4":"CW-4","CE-1":"CE-1","CE-2":"CE-2","CE-3":"CE-3",
    };
    return map[name] || name || "";
  }
  function barDays(bar: BarData): number { return bar.endIdx - bar.startIdx + 1; }

  // ── API ────────────────────────────────────────────────────────
  async function loadSchedule() {
    loading = true; error = "";
    try {
      const data = await api.get(`/schedule/look-ahead?start=${weekStart}&weeks=${numWeeks}`);
      employees = data.employees;
      dates = data.dates;
    } catch (e: any) { error = e.message; }
    loading = false;
  }
  onMount(loadSchedule);

  // ── Navigation ─────────────────────────────────────────────────
  function prevWeek() { weekStart = addDays(weekStart, -7); loadSchedule(); }
  function nextWeek() { weekStart = addDays(weekStart, 7); loadSchedule(); }
  function goToday() { weekStart = getMonday(new Date()); loadSchedule(); }
  function setWeeks(n: number) { numWeeks = n; loadSchedule(); }
</script>

<div class="sch-page">

  <!-- ═══════════════ Header ═══════════════ -->
  <header class="sch-header">
    <div class="sch-header-row">
      <div>
        <h1 class="page-title">Schedule</h1>
        <p class="sch-meta">{totalPeople} people &middot; {totalJobs} job{totalJobs !== 1 ? "s" : ""} &middot; {numWeeks * 5} days</p>
      </div>
      <div class="sch-nav">
        <button class="sch-nav-btn" on:click={prevWeek}>&lsaquo;</button>
        <span class="sch-nav-label">{weekRange}</span>
        <button class="sch-nav-btn" on:click={nextWeek}>&rsaquo;</button>
        <button class="sch-pill" class:sch-pill-on={weekStart === getMonday(new Date())} on:click={goToday}>Today</button>
      </div>
    </div>
    <div class="sch-header-row sch-header-controls">
      <div class="sch-sort-group">
        <span class="sch-sort-label">Sort</span>
        {#each [["job","Job"],["person","Person"],["classification","Class"]] as [val, lbl]}
          <button class="sch-pill" class:sch-pill-on={sortMode===val} on:click={() => { sortMode = val; }}>{lbl}</button>
        {/each}
      </div>
      <div class="sch-size-group">
        {#each [1,2,3] as w}
          <button class="sch-pill" class:sch-pill-on={numWeeks===w} on:click={() => setWeeks(w)}>{w}w</button>
        {/each}
      </div>
    </div>
  </header>

  {#if error}
    <div class="sch-error">{error}<button on:click={() => error = ""}>&times;</button></div>
  {/if}

  <!-- ═══════════════ Timeline ═══════════════ -->
  {#if loading}
    <div class="sch-loading"><span class="loading loading-spinner loading-lg text-primary"></span></div>
  {:else if employees.length === 0}
    <div class="sch-empty">No active employees.</div>
  {:else}
    <div class="sch-timeline">

      <!-- Date header -->
      <div class="sch-row sch-date-hdr">
        <div class="sch-name-col"></div>
        <div class="sch-bars-col" style="--cols:{dates.length}">
          {#each dates as d}
            <div class="sch-date-cell" class:sch-today={d===today}>
              <span class="sch-d-day">{fmtDay(d)}</span>
              <span class="sch-d-num" class:sch-d-today={d===today}>{fmtDate(d)}</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Groups + Rows -->
      {#each groups as group (group.key)}
        {#if group.label}
          <div class="sch-group-hdr">
            <div class="sch-name-col sch-group-label">
              {group.label}
              <span class="sch-group-count">{group.rows.length}</span>
            </div>
            <div class="sch-bars-col" style="--cols:{dates.length}"></div>
          </div>
        {/if}

        {#each group.rows as row (row.empId)}
          <div class="sch-row sch-emp-row">
            <!-- Name column -->
            <div class="sch-name-col sch-emp-name">
              <span class="sch-emp-dot" style="background:{row.classColor}"></span>
              <span class="sch-emp-text">{row.firstName} {row.lastName}</span>
              <span class="sch-emp-cls">{classAbbrev(row.classification)}</span>
            </div>

            <!-- Bar area -->
            <div class="sch-bars-col" style="--cols:{dates.length}">
              <!-- Grid lines -->
              <div class="sch-grid">
                {#each dates as d, idx}
                  <div
                    class="sch-grid-cell"
                    class:sch-today={d===today}
                    style="grid-column:{idx+1}"
                  ></div>
                {/each}
              </div>

              <!-- Bars (read-only) -->
              <div class="sch-bar-track">
                {#each row.bars as bar}
                  {@const hue = jobHue(bar.jobNumber)}
                  {@const days = barDays(bar)}
                  <div
                    class="sch-bar"
                    class:sch-bar-sched={bar.isScheduled}
                    style="grid-column:{bar.startIdx+1}/{bar.endIdx+2}; --hue:{hue};"
                    title="{bar.jobNumber} — {bar.jobName} ({days}d)"
                  >
                    <span class="sch-bar-label">
                      <strong>{bar.jobNumber}</strong>
                      {#if days > 1}<span class="sch-bar-name">{bar.jobName}</span>{/if}
                    </span>
                    {#if days > 2}
                      <span class="sch-bar-days">{days}d</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/each}
      {/each}
    </div>

    <!-- Legend -->
    <div class="sch-legend">
      <span class="sch-leg-item"><span class="sch-leg-bar"></span> Current</span>
      <span class="sch-leg-item"><span class="sch-leg-bar sch-leg-sched"></span> Scheduled</span>
      <span class="sch-leg-hint">Use the Workforce Board to schedule moves</span>
    </div>
  {/if}
</div>

<style>
  /* ══════════════════════════════════════════
     Read-only resource chart — Apple-inspired
     ══════════════════════════════════════════ */
  .sch-page { display: flex; flex-direction: column; gap: 14px; max-width: 100%; }

  /* ── Header ── */
  .sch-header { display: flex; flex-direction: column; gap: 10px; }
  .sch-header-row { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 10px; }
  .sch-header-controls { align-items: center; }
  .sch-meta { font-size: 13px; color: oklch(var(--bc) / 0.4); margin-top: 2px; }

  .sch-nav { display: flex; align-items: center; gap: 6px; }
  .sch-nav-btn {
    width: 30px; height: 30px; border-radius: 8px;
    border: 1px solid oklch(var(--bc) / 0.08); background: oklch(var(--b1));
    font-size: 18px; font-weight: 300; color: oklch(var(--bc) / 0.5);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all 0.12s;
  }
  .sch-nav-btn:hover { background: oklch(var(--bc) / 0.04); color: oklch(var(--bc) / 0.8); }
  .sch-nav-label {
    font-size: 14px; font-weight: 600; color: oklch(var(--bc) / 0.7);
    min-width: 150px; text-align: center; padding: 0 4px;
  }

  .sch-pill {
    padding: 4px 11px; border-radius: 100px;
    border: 1px solid oklch(var(--bc) / 0.08); background: oklch(var(--b1));
    font-size: 12px; font-weight: 500; color: oklch(var(--bc) / 0.45);
    cursor: pointer; transition: all 0.12s;
  }
  .sch-pill:hover { background: oklch(var(--bc) / 0.04); }
  .sch-pill-on { background: oklch(var(--p)); color: oklch(var(--pc)); border-color: transparent; }
  .sch-pill-on:hover { opacity: 0.9; background: oklch(var(--p)); }

  .sch-sort-group, .sch-size-group { display: flex; align-items: center; gap: 4px; }
  .sch-sort-label { font-size: 11px; font-weight: 600; color: oklch(var(--bc) / 0.3); text-transform: uppercase; letter-spacing: 0.4px; margin-right: 4px; }

  .sch-error {
    background: oklch(var(--er) / 0.06); color: oklch(var(--er));
    padding: 8px 14px; border-radius: 10px; font-size: 13px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .sch-error button { background: none; border: none; cursor: pointer; color: oklch(var(--er)); font-size: 18px; }
  .sch-loading { display: flex; justify-content: center; padding: 60px 0; }
  .sch-empty { text-align: center; padding: 60px 0; color: oklch(var(--bc) / 0.3); font-size: 14px; }

  /* ═══════════════ Timeline ═══════════════ */
  .sch-timeline {
    border: 1px solid oklch(var(--bc) / 0.06); border-radius: 14px;
    overflow-x: auto; overflow-y: visible; background: oklch(var(--b1));
    user-select: none;
  }

  .sch-row {
    display: flex;
    border-top: 1px solid oklch(var(--bc) / 0.05);
  }
  .sch-row:first-child { border-top: none; }

  /* ── Name column (sticky) ── */
  .sch-name-col {
    width: 180px; min-width: 180px; max-width: 180px;
    position: sticky; left: 0; z-index: 6;
    background: oklch(var(--b1)); border-right: 1px solid oklch(var(--bc) / 0.06);
    display: flex; align-items: center; padding: 0 12px; gap: 6px;
  }

  /* ── Date header ── */
  .sch-date-hdr { background: oklch(var(--b2) / 0.3); }
  .sch-date-hdr .sch-name-col { background: oklch(var(--b2) / 0.3); }
  .sch-bars-col {
    flex: 1; min-width: 0;
    display: grid; grid-template-columns: repeat(var(--cols), minmax(72px, 1fr));
  }
  .sch-date-cell {
    text-align: center; padding: 8px 4px 6px;
    border-left: 1px solid oklch(var(--bc) / 0.04);
  }
  .sch-date-cell:first-child { border-left: none; }
  .sch-d-day { display: block; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; color: oklch(var(--bc) / 0.3); }
  .sch-d-num { display: block; font-size: 13px; font-weight: 600; color: oklch(var(--bc) / 0.5); margin-top: 1px; }
  .sch-d-today {
    color: oklch(var(--p)); font-weight: 700;
    background: oklch(var(--p) / 0.1); border-radius: 100px;
    width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
  }

  /* ── Group header ── */
  .sch-group-hdr {
    display: flex; border-top: 1px solid oklch(var(--bc) / 0.08);
    background: oklch(var(--bc) / 0.02);
  }
  .sch-group-hdr .sch-name-col { background: oklch(var(--bc) / 0.02); }
  .sch-group-label {
    font-size: 12px; font-weight: 700; color: oklch(var(--bc) / 0.6);
    padding: 8px 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 180px;
  }
  .sch-group-count {
    font-weight: 500; font-size: 11px; color: oklch(var(--bc) / 0.3);
    background: oklch(var(--bc) / 0.05); padding: 1px 6px; border-radius: 10px; margin-left: 6px;
  }

  /* ── Employee row ── */
  .sch-emp-row { min-height: 38px; }
  .sch-emp-row:hover .sch-name-col { background: oklch(var(--bc) / 0.015); }
  .sch-emp-name { padding: 0 12px; gap: 5px; }
  .sch-emp-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .sch-emp-text { font-size: 12px; font-weight: 550; color: oklch(var(--bc) / 0.65); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sch-emp-cls { font-size: 10px; font-weight: 600; color: oklch(var(--bc) / 0.3); flex-shrink: 0; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── Bar area ── */
  .sch-emp-row .sch-bars-col { position: relative; align-items: stretch; }

  .sch-grid {
    position: absolute; inset: 0;
    display: grid; grid-template-columns: repeat(var(--cols), minmax(72px, 1fr));
    z-index: 1; grid-column: 1 / -1;
  }
  .sch-grid-cell {
    border-left: 1px solid oklch(var(--bc) / 0.04);
  }
  .sch-grid-cell:first-child { border-left: none; }
  .sch-grid-cell.sch-today { background: oklch(var(--p) / 0.02); }

  .sch-bar-track {
    position: relative; z-index: 2;
    display: grid; grid-template-columns: repeat(var(--cols), minmax(72px, 1fr));
    align-items: center; padding: 5px 0;
    grid-column: 1 / -1;
  }

  /* ── Bar ── */
  .sch-bar {
    height: 26px; border-radius: 6px;
    background: hsl(var(--hue), 18%, 97%);
    border-left: 3px solid hsl(var(--hue), 45%, 62%);
    display: flex; align-items: center;
    position: relative;
    margin: 0 2px;
    transition: box-shadow 0.1s;
  }
  .sch-bar:hover { background: hsl(var(--hue), 22%, 94%); box-shadow: 0 1px 4px oklch(var(--bc) / 0.06); }
  .sch-bar-sched { border-left-style: dashed; opacity: 0.55; }
  .sch-bar-label {
    font-size: 11px; color: oklch(var(--bc) / 0.55);
    padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    flex: 1; display: flex; align-items: center; gap: 4px;
  }
  .sch-bar-label strong { font-weight: 700; color: oklch(var(--bc) / 0.72); flex-shrink: 0; }
  .sch-bar-name {
    font-weight: 500; opacity: 0.8; overflow: hidden; text-overflow: ellipsis;
  }
  .sch-bar-days {
    font-size: 9px; font-weight: 600; color: oklch(var(--bc) / 0.35);
    padding-right: 8px; flex-shrink: 0;
  }

  /* ═══════════════ Legend ═══════════════ */
  .sch-legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 11px; color: oklch(var(--bc) / 0.35); padding: 0 2px; align-items: center; }
  .sch-leg-item { display: flex; align-items: center; gap: 5px; }
  .sch-leg-bar { width: 22px; height: 8px; border-radius: 4px; background: hsl(200,18%,97%); border-left: 3px solid hsl(200,45%,62%); }
  .sch-leg-sched { border-left-style: dashed; opacity: 0.6; }
  .sch-leg-hint { margin-left: auto; opacity: 0.6; }

  /* ── Responsive ── */
  @media (max-width: 768px) {
    .sch-name-col { width: 130px; min-width: 130px; max-width: 130px; }
    .sch-group-label { max-width: 130px; }
    .sch-bar { height: 24px; }
    .sch-bar-label { font-size: 10px; padding: 0 6px; }
    .sch-emp-cls { display: none; }
    .sch-header-row { flex-direction: column; align-items: flex-start; gap: 8px; }
    .sch-nav-label { min-width: auto; font-size: 13px; }
  }
</style>
