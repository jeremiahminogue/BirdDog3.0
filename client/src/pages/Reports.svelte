<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  let jobsList: any[] = [];
  let employeesList: any[] = [];
  let loading = true;

  let selectedJobId = "";
  let selectedEmployeeId = "";

  onMount(async () => {
    const [allJobs, allEmps] = await Promise.all([
      api.get("/jobs"),
      api.get("/employees?status=active"),
    ]);
    jobsList = allJobs
      .filter((j: any) => j.status === "active" || j.status === "planning")
      .sort((a: any, b: any) => (a.jobNumber || "").localeCompare(b.jobNumber || ""));
    employeesList = allEmps.sort((a: any, b: any) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    );
    loading = false;
  });

  function run(id: string) {
    if (id === "job-labor-cost") {
      const qs = selectedJobId ? `?jobId=${selectedJobId}` : "";
      window.open(`/api/reports/job-labor-cost${qs}`, "_blank");
    } else if (id === "employee-profile") {
      if (!selectedEmployeeId) return;
      window.open(`/api/reports/employee-profile?id=${selectedEmployeeId}`, "_blank");
    } else {
      window.open(`/api/reports/${id}`, "_blank");
    }
  }

  function excel(id: string) {
    if (id === "job-labor-cost") {
      const qs = selectedJobId ? `?jobId=${selectedJobId}&format=excel` : "?format=excel";
      window.open(`/api/reports/job-labor-cost${qs}`, "_blank");
    } else {
      window.open(`/api/reports/${id}?format=excel`, "_blank");
    }
  }

  $: isAdmin = $user?.role === "admin" || $user?.role === "super_admin";
</script>

<div class="rpt-page">
  <h1 class="page-title">Reports</h1>
  <p class="rpt-subtitle">Reports open in a new tab. Print or Ctrl+P to save as PDF.</p>

  {#if loading}
    <div class="rpt-loading"><span class="loading loading-spinner loading-lg text-primary"></span></div>
  {:else}
    <div class="rpt-grid">

      <!-- ═══ Workforce ═══ -->
      <section class="rpt-section">
        <h2 class="rpt-section-title">Workforce</h2>

        <div class="rpt-card" on:click={() => run("workforce-roster")} on:keydown={() => {}} role="button" tabindex="0">
          <div class="rpt-card-main">
            <span class="rpt-card-title">Workforce Roster</span>
            <span class="rpt-card-desc">Active employees, assignments, bench</span>
          </div>
          <div class="rpt-card-actions">
            <button class="rpt-xl-btn" title="Download Excel" on:click|stopPropagation={() => excel("workforce-roster")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            </button>
          </div>
        </div>

        <div class="rpt-card" on:click={() => run("employee-directory")} on:keydown={() => {}} role="button" tabindex="0">
          <div class="rpt-card-main">
            <span class="rpt-card-title">Employee Directory</span>
            <span class="rpt-card-desc">Phone numbers, emails, contact info</span>
          </div>
          <div class="rpt-card-actions">
            <button class="rpt-xl-btn" title="Download Excel" on:click|stopPropagation={() => excel("employee-directory")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            </button>
          </div>
        </div>

        <div class="rpt-card rpt-card-inline">
          <div class="rpt-card-main">
            <span class="rpt-card-title">Employee Profile</span>
            <select class="rpt-select" bind:value={selectedEmployeeId}>
              <option value="">Select employee...</option>
              {#each employeesList as emp}
                <option value={emp.id}>{emp.lastName}, {emp.firstName}</option>
              {/each}
            </select>
          </div>
          <button class="rpt-run-btn" disabled={!selectedEmployeeId} on:click={() => run("employee-profile")}>Run</button>
        </div>

        <div class="rpt-card" on:click={() => run("license-tracker")} on:keydown={() => {}} role="button" tabindex="0">
          <div class="rpt-card-main">
            <span class="rpt-card-title">License & Cert Tracker</span>
            <span class="rpt-card-desc">Expirations, compliance status</span>
          </div>
          <div class="rpt-card-actions">
            <button class="rpt-xl-btn" title="Download Excel" on:click|stopPropagation={() => excel("license-tracker")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            </button>
          </div>
        </div>

        <div class="rpt-card" on:click={() => run("classification-totals")} on:keydown={() => {}} role="button" tabindex="0">
          <div class="rpt-card-main">
            <span class="rpt-card-title">Classification Totals</span>
            <span class="rpt-card-desc">JW, CW, CE, Apprentice counts</span>
          </div>
        </div>
      </section>

      <!-- ═══ Jobs & Labor ═══ -->
      <section class="rpt-section">
        <h2 class="rpt-section-title">Jobs & Labor</h2>

        <div class="rpt-card" on:click={() => run("manpower-summary")} on:keydown={() => {}} role="button" tabindex="0">
          <div class="rpt-card-main">
            <span class="rpt-card-title">Manpower Summary</span>
            <span class="rpt-card-desc">Crew size, rates, weekly cost per job</span>
          </div>
          <div class="rpt-card-actions">
            <button class="rpt-xl-btn" title="Download Excel" on:click|stopPropagation={() => excel("manpower-summary")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            </button>
          </div>
        </div>

        <div class="rpt-card rpt-card-inline">
          <div class="rpt-card-main">
            <span class="rpt-card-title">Job Labor Cost</span>
            <select class="rpt-select" bind:value={selectedJobId}>
              <option value="">All jobs</option>
              {#each jobsList as job}
                <option value={job.id}>{job.jobNumber} — {job.name}</option>
              {/each}
            </select>
          </div>
          <div class="rpt-card-actions">
            <button class="rpt-xl-btn" title="Download Excel" on:click|stopPropagation={() => excel("job-labor-cost")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            </button>
            <button class="rpt-run-btn" on:click={() => run("job-labor-cost")}>Run</button>
          </div>
        </div>

        <div class="rpt-card" on:click={() => run("daily-manpower-log")} on:keydown={() => {}} role="button" tabindex="0">
          <div class="rpt-card-main">
            <span class="rpt-card-title">Daily Manpower Log</span>
            <span class="rpt-card-desc">Committed daily assignments</span>
          </div>
          <div class="rpt-card-actions">
            <button class="rpt-xl-btn" title="Download Excel" on:click|stopPropagation={() => excel("daily-manpower-log")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            </button>
          </div>
        </div>
      </section>

      <!-- ═══ Assets ═══ -->
      <section class="rpt-section">
        <h2 class="rpt-section-title">Assets</h2>

        <div class="rpt-card" on:click={() => run("tool-assignment")} on:keydown={() => {}} role="button" tabindex="0">
          <div class="rpt-card-main">
            <span class="rpt-card-title">Tool Assignment</span>
            <span class="rpt-card-desc">Tools grouped by employee</span>
          </div>
          <div class="rpt-card-actions">
            <button class="rpt-xl-btn" title="Download Excel" on:click|stopPropagation={() => excel("tool-assignment")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            </button>
          </div>
        </div>

        <div class="rpt-card" on:click={() => run("vehicle-fleet")} on:keydown={() => {}} role="button" tabindex="0">
          <div class="rpt-card-main">
            <span class="rpt-card-title">Vehicle Fleet</span>
            <span class="rpt-card-desc">Fleet list, plates, drivers, status</span>
          </div>
          <div class="rpt-card-actions">
            <button class="rpt-xl-btn" title="Download Excel" on:click|stopPropagation={() => excel("vehicle-fleet")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            </button>
          </div>
        </div>
      </section>

      <!-- ═══ Financial ═══ -->
      {#if isAdmin}
      <section class="rpt-section">
        <h2 class="rpt-section-title">Financial</h2>

        <div class="rpt-card rpt-card-featured" on:click={() => run("financial-dashboard")} on:keydown={() => {}} role="button" tabindex="0">
          <div class="rpt-card-main">
            <span class="rpt-card-title">Financial Dashboard</span>
            <span class="rpt-card-desc">Executive overview, health scores, cash, earned value, 6 sub-reports</span>
          </div>
        </div>
      </section>
      {/if}

    </div>
  {/if}
</div>

<style>
  .rpt-page { max-width: 100%; display: flex; flex-direction: column; gap: 8px; }
  .rpt-subtitle { font-size: 13px; color: oklch(var(--bc) / 0.4); }
  .rpt-loading { display: flex; justify-content: center; padding: 60px 0; }

  .rpt-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 20px;
    margin-top: 8px;
  }

  .rpt-section { display: flex; flex-direction: column; gap: 6px; }
  .rpt-section-title {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; color: oklch(var(--bc) / 0.35);
    padding: 0 2px 4px;
  }

  .rpt-card {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 10px 14px; border-radius: 10px;
    background: oklch(var(--b1));
    border: 1px solid oklch(var(--bc) / 0.06);
    cursor: pointer; transition: all 0.12s;
  }
  .rpt-card:hover { background: oklch(var(--bc) / 0.02); border-color: oklch(var(--bc) / 0.1); }
  .rpt-card-inline { cursor: default; }
  .rpt-card-inline:hover { background: oklch(var(--b1)); border-color: oklch(var(--bc) / 0.06); }

  .rpt-card-featured {
    background: oklch(var(--p) / 0.04);
    border-color: oklch(var(--p) / 0.12);
  }
  .rpt-card-featured:hover { background: oklch(var(--p) / 0.07); border-color: oklch(var(--p) / 0.2); }
  .rpt-card-featured .rpt-card-title { color: oklch(var(--p)); }

  .rpt-card-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
  .rpt-card-title { font-size: 13px; font-weight: 600; color: oklch(var(--bc) / 0.8); }
  .rpt-card-desc { font-size: 11px; color: oklch(var(--bc) / 0.4); }

  .rpt-card-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

  .rpt-xl-btn {
    width: 28px; height: 28px; border-radius: 6px;
    border: none; background: transparent; cursor: pointer;
    color: oklch(var(--bc) / 0.25); display: flex; align-items: center; justify-content: center;
    transition: all 0.12s;
  }
  .rpt-xl-btn:hover { background: oklch(var(--bc) / 0.05); color: oklch(var(--bc) / 0.6); }
  .rpt-xl-btn svg { width: 14px; height: 14px; }

  .rpt-run-btn {
    padding: 4px 12px; border-radius: 6px;
    border: none; background: oklch(var(--p));
    color: oklch(var(--pc)); font-size: 11px; font-weight: 600;
    cursor: pointer; transition: opacity 0.12s;
  }
  .rpt-run-btn:hover { opacity: 0.85; }
  .rpt-run-btn:disabled { opacity: 0.3; cursor: default; }

  .rpt-select {
    font-size: 12px; padding: 3px 6px; border-radius: 6px;
    border: 1px solid oklch(var(--bc) / 0.1); background: oklch(var(--b1));
    color: oklch(var(--bc) / 0.6); max-width: 200px; margin-top: 2px;
  }

  @media (max-width: 768px) {
    .rpt-grid { grid-template-columns: 1fr; }
  }
</style>
