<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { api } from "../lib/api";

  // ── State ──────────────────────────────────────────────────
  let locations: any[] = [];
  let jobPins: any[] = [];
  let activeClocks: any[] = [];
  let stats: any = {};
  let loading = true;
  let error: string | null = null;
  let tab: "map" | "active" | "flagged" = "map";
  let refreshInterval: ReturnType<typeof setInterval>;
  let lastRefresh: string = "";
  let selectedEmployee: any = null;
  let selectedJob: any = null;

  // Date filters
  let dateFrom = new Date().toISOString().split("T")[0];
  let dateTo = dateFrom;

  // Seed test data
  let seeding = false;
  let seedResult = "";
  async function seedTestData() {
    seeding = true;
    seedResult = "";
    try {
      const res = await api.post("/seed/time-tracking", {});
      seedResult = `Seeded ${res.seeded?.timeEntries} entries, ${res.seeded?.activeClockIns} active clocks (${res.seeded?.dateRange?.from} to ${res.seeded?.dateRange?.to})`;
      await loadAll();
    } catch (err: any) {
      seedResult = `Error: ${err.message}`;
    } finally {
      seeding = false;
    }
  }

  // ── Data loading ───────────────────────────────────────────
  async function loadAll() {
    try {
      const [mapData, activeData, statsData] = await Promise.all([
        api.get("/time-tracking/crew-map"),
        api.get("/time-tracking/active"),
        api.get(`/time-tracking/stats/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`),
      ]);
      locations = mapData?.locations || [];
      jobPins = mapData?.jobPins || [];
      activeClocks = activeData?.active || [];
      stats = statsData || {};
      lastRefresh = new Date().toLocaleTimeString();
      error = null;
    } catch (err: any) {
      console.error("Failed to load crew map:", err);
      error = "Failed to load crew data.";
    } finally {
      loading = false;
    }
  }

  function timeSince(isoString: string): string {
    if (!isoString) return "—";
    const mins = Math.round((Date.now() - new Date(isoString).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return `${hrs}h ${rem}m ago`;
  }

  function clockedDuration(clockIn: string): string {
    if (!clockIn) return "—";
    const mins = Math.round((Date.now() - new Date(clockIn).getTime()) / 60000);
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return `${hrs}h ${rem}m`;
  }

  function getInitials(first: string, last: string): string {
    return `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase();
  }

  onMount(() => {
    loadAll();
    // Auto-refresh disabled — manual refresh only (saves API calls)
    // refreshInterval = setInterval(loadAll, 30000);
  });

  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });
</script>

<div class="cm-container">
  <!-- Header -->
  <div class="cm-header">
    <div class="cm-title-row">
      <h1 class="cm-title">Crew Tracker</h1>
      <div class="cm-refresh">
        {#if lastRefresh}
          <span class="cm-refresh-text">Updated {lastRefresh}</span>
        {/if}
        <button class="cm-refresh-btn" on:click={loadAll} title="Refresh now">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </button>
        <button class="btn btn-xs btn-outline btn-warning" on:click={seedTestData} disabled={seeding}>
          {seeding ? "Seeding..." : "Seed Test Data"}
        </button>
      </div>
    </div>

    {#if seedResult}
      <div class="text-xs mt-2 px-1 {seedResult.startsWith('Error') ? 'text-error' : 'text-success'}">{seedResult}</div>
    {/if}

    <!-- Stats pills -->
    {#if stats.currentlyClockedIn !== undefined}
      <div class="cm-stats">
        <div class="cm-stat">
          <span class="cm-stat-num cm-stat-active">{stats.currentlyClockedIn}</span>
          <span class="cm-stat-label">Clocked In</span>
        </div>
        <div class="cm-stat">
          <span class="cm-stat-num">{stats.uniqueEmployees || 0}</span>
          <span class="cm-stat-label">Employees Today</span>
        </div>
        <div class="cm-stat">
          <span class="cm-stat-num">{stats.uniqueJobs || 0}</span>
          <span class="cm-stat-label">Active Jobs</span>
        </div>
        <div class="cm-stat">
          <span class="cm-stat-num">{stats.hours?.total || 0}</span>
          <span class="cm-stat-label">Total Hours</span>
        </div>
        {#if stats.flagged?.clockIns > 0 || stats.flagged?.clockOuts > 0}
          <div class="cm-stat cm-stat-warn">
            <span class="cm-stat-num">{(stats.flagged?.clockIns || 0) + (stats.flagged?.clockOuts || 0)}</span>
            <span class="cm-stat-label">Flagged</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Tabs -->
  <div class="cm-tabs">
    <button class="cm-tab" class:cm-tab-active={tab === "map"} on:click={() => (tab = "map")}>
      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" /></svg>
      Crew Map
    </button>
    <button class="cm-tab" class:cm-tab-active={tab === "active"} on:click={() => (tab = "active")}>
      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" /></svg>
      Active Clocks ({activeClocks.length})
    </button>
    <button class="cm-tab" class:cm-tab-active={tab === "flagged"} on:click={() => (tab = "flagged")}>
      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>
      Flagged
    </button>
  </div>

  <!-- Content -->
  {#if loading}
    <div class="cm-loading">Loading crew data...</div>
  {:else if error}
    <div class="cm-error">{error}</div>
  {:else}

    <!-- ═══ MAP TAB ═══ -->
    {#if tab === "map"}
      <div class="cm-map-container">
        <!-- Map — server-proxied static map (no API key in browser) -->
        {#if jobPins.length > 0 || locations.length > 0}
          {@const allLats = [...jobPins.map(j => j.latitude), ...locations.map(l => l.latitude)].filter(Boolean)}
          {@const allLngs = [...jobPins.map(j => j.longitude), ...locations.map(l => l.longitude)].filter(Boolean)}
          {@const centerLat = allLats.length ? allLats.reduce((a, b) => a + b, 0) / allLats.length : 32.0}
          {@const centerLng = allLngs.length ? allLngs.reduce((a, b) => a + b, 0) / allLngs.length : -104.0}
          {@const crewMarkers = locations.filter(l => l.latitude).map(l => `${l.latitude},${l.longitude}`).join("|")}
          <div class="cm-map-frame">
            <img
              class="cm-map-img"
              src="/api/maps/static-map?lat={centerLat}&lng={centerLng}&zoom=11&size=800x500{crewMarkers ? `&markers=${crewMarkers}` : ''}"
              alt="Crew map"
            />
            <div class="cm-map-overlay">
              <span class="cm-map-badge">{jobPins.length} job sites</span>
              <span class="cm-map-badge">{locations.length} crew members</span>
            </div>
          </div>
        {:else}
          <div class="cm-map-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48" opacity="0.2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" /></svg>
            <p>No locations to display yet</p>
            <p class="cm-map-sub">Add GPS coordinates to your jobs and clock in crew to see them on the map</p>
          </div>
        {/if}

        <!-- Crew list alongside map -->
        <div class="cm-crew-list">
          <h3 class="cm-section-title">Live Crew Positions</h3>
          {#if locations.length === 0}
            <div class="cm-empty">No location data in the last 8 hours</div>
          {:else}
            {#each locations as loc}
              <div class="cm-crew-card" class:cm-outside={loc.inside_geofence === 0}>
                <div class="cm-crew-avatar">
                  {#if loc.employee_photo}
                    <img src={loc.employee_photo} alt="" />
                  {:else}
                    {getInitials(loc.first_name, loc.last_name)}
                  {/if}
                </div>
                <div class="cm-crew-info">
                  <div class="cm-crew-name">{loc.first_name} {loc.last_name}</div>
                  <div class="cm-crew-job">{loc.job_name || "No job"} {loc.job_number ? `(${loc.job_number})` : ""}</div>
                  <div class="cm-crew-meta">
                    <span class="cm-crew-time">{timeSince(loc.recorded_at)}</span>
                    {#if loc.battery_level !== null}
                      <span class="cm-crew-battery" class:cm-battery-low={loc.battery_level < 20}>
                        🔋 {loc.battery_level}%
                      </span>
                    {/if}
                    {#if loc.inside_geofence === 0}
                      <span class="cm-flag">⚠ Outside geofence</span>
                    {/if}
                  </div>
                </div>
                <div class="cm-crew-source">{loc.source || "mobile"}</div>
              </div>
            {/each}
          {/if}

          <h3 class="cm-section-title" style="margin-top: 20px;">Job Sites</h3>
          {#if jobPins.length === 0}
            <div class="cm-empty">No geocoded jobs yet. Add coordinates via Jobs → Edit.</div>
          {:else}
            {#each jobPins as job}
              <div class="cm-job-pin">
                <div class="cm-job-pin-icon">📍</div>
                <div class="cm-job-pin-info">
                  <div class="cm-job-pin-name">{job.name}</div>
                  <div class="cm-job-pin-addr">{job.address || "No address"}</div>
                  <div class="cm-job-pin-coords">{job.latitude?.toFixed(5)}, {job.longitude?.toFixed(5)} — {job.geofence_radius}ft fence</div>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>

    <!-- ═══ ACTIVE CLOCKS TAB ═══ -->
    {:else if tab === "active"}
      <div class="cm-active-list">
        {#if activeClocks.length === 0}
          <div class="cm-empty-big">
            <svg viewBox="0 0 24 24" fill="currentColor" width="40" height="40" opacity="0.15"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" /></svg>
            <p>No one is currently clocked in</p>
          </div>
        {:else}
          {#each activeClocks as entry}
            <div class="cm-clock-card" class:cm-outside={entry.clock_in_inside_geofence === 0}>
              <div class="cm-clock-avatar">
                {#if entry.employee_photo}
                  <img src={entry.employee_photo} alt="" />
                {:else}
                  {getInitials(entry.first_name, entry.last_name)}
                {/if}
                <div class="cm-clock-pulse"></div>
              </div>
              <div class="cm-clock-info">
                <div class="cm-clock-name">{entry.first_name} {entry.last_name}</div>
                <div class="cm-clock-job">{entry.job_name} ({entry.job_number})</div>
                {#if entry.classification_name}
                  <div class="cm-clock-class">{entry.classification_name}</div>
                {/if}
                <div class="cm-clock-meta">
                  <span class="cm-clock-duration">⏱ {clockedDuration(entry.clock_in)}</span>
                  <span class="cm-clock-source">{entry.source}</span>
                  {#if entry.break_minutes > 0}
                    <span class="cm-clock-break">Break: {entry.break_minutes}m</span>
                  {/if}
                  {#if entry.lunch_out && !entry.lunch_in}
                    <span class="cm-clock-lunch">🍴 On lunch</span>
                  {/if}
                </div>
                {#if entry.clock_in_address}
                  <div class="cm-clock-addr">📍 {entry.clock_in_address}</div>
                {/if}
                {#if entry.clock_in_inside_geofence === 0}
                  <div class="cm-flag">⚠ Clocked in outside geofence</div>
                {/if}
              </div>
              <div class="cm-clock-time">
                {new Date(entry.clock_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          {/each}
        {/if}
      </div>

    <!-- ═══ FLAGGED TAB ═══ -->
    {:else if tab === "flagged"}
      <div class="cm-flagged">
        <p class="cm-flagged-desc">Entries where employees clocked in or out outside the job's geofence radius.</p>
        {#if (stats.flagged?.clockIns || 0) + (stats.flagged?.clockOuts || 0) === 0}
          <div class="cm-empty-big">
            <svg viewBox="0 0 24 24" fill="currentColor" width="40" height="40" opacity="0.15"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
            <p>No flagged entries today</p>
          </div>
        {:else}
          <div class="cm-flagged-count">
            {stats.flagged.clockIns} flagged clock-ins, {stats.flagged.clockOuts} flagged clock-outs
          </div>
          <p class="cm-flagged-sub">Review individual entries in the Time Tracking page with the "Flagged" filter.</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* ═══════════════════════════════════════════════════════════
     CREW MAP — office admin view
     ═══════════════════════════════════════════════════════════ */
  .cm-container { max-width: 100%; }

  .cm-header { margin-bottom: 20px; }
  .cm-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .cm-title { font-size: 22px; font-weight: 700; color: #1d1d1f; letter-spacing: -0.02em; margin: 0; }

  .cm-refresh { display: flex; align-items: center; gap: 8px; }
  .cm-refresh-text { font-size: 0.75rem; color: #86868b; }
  .cm-refresh-btn {
    width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
    background: #f5f5f7; border: 1px solid #e5e5ea; border-radius: 8px;
    cursor: pointer; color: #48484a; transition: all 0.15s;
  }
  .cm-refresh-btn:hover { background: #e8e8ed; color: #1d1d1f; }

  /* Stats */
  .cm-stats { display: flex; gap: 12px; flex-wrap: wrap; }
  .cm-stat {
    display: flex; flex-direction: column; align-items: center;
    padding: 12px 20px; background: #f5f5f7; border-radius: 12px; min-width: 100px;
  }
  .cm-stat-num { font-size: 1.5rem; font-weight: 700; color: #1d1d1f; }
  .cm-stat-active { color: #34c759; }
  .cm-stat-label { font-size: 0.6875rem; color: #86868b; margin-top: 2px; }
  .cm-stat-warn { background: #fff3cd; }
  .cm-stat-warn .cm-stat-num { color: #ff9500; }

  /* Tabs */
  .cm-tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid #e5e5ea; padding-bottom: 0; }
  .cm-tab {
    display: flex; align-items: center; gap: 6px;
    padding: 10px 16px; background: none; border: none; border-bottom: 2px solid transparent;
    cursor: pointer; font-size: 0.8125rem; font-weight: 500; color: #86868b;
    transition: all 0.15s;
  }
  .cm-tab:hover { color: #1d1d1f; }
  .cm-tab-active { color: #007aff; border-bottom-color: #007aff; font-weight: 600; }

  /* Loading/Error */
  .cm-loading, .cm-error { text-align: center; padding: 60px 20px; color: #86868b; font-size: 0.875rem; }
  .cm-error { color: #ff3b30; }

  /* Map container */
  .cm-map-container { display: grid; grid-template-columns: 1fr 380px; gap: 20px; }
  @media (max-width: 900px) { .cm-map-container { grid-template-columns: 1fr; } }

  .cm-map-frame {
    position: relative; border-radius: 16px; overflow: hidden;
    border: 1px solid #e5e5ea; min-height: 400px; background: #f5f5f7;
  }
  .cm-map-img { width: 100%; height: auto; display: block; min-height: 400px; object-fit: cover; }
  .cm-map-overlay {
    position: absolute; top: 12px; left: 12px; display: flex; gap: 6px;
  }
  .cm-map-badge {
    padding: 4px 10px; background: rgba(255,255,255,0.92);
    backdrop-filter: blur(8px); border-radius: 100px;
    font-size: 0.6875rem; font-weight: 600; color: #1d1d1f;
    box-shadow: 0 1px 4px rgba(0,0,0,0.1);
  }

  .cm-map-placeholder {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 400px; background: #f5f5f7; border-radius: 16px; border: 1px solid #e5e5ea;
    color: #86868b; font-size: 0.875rem;
  }
  .cm-map-placeholder p { margin: 8px 0 0; }
  .cm-map-sub { font-size: 0.75rem; color: #aeaeb2; }

  /* Crew list */
  .cm-crew-list { max-height: 700px; overflow-y: auto; }
  .cm-section-title { font-size: 0.75rem; font-weight: 600; color: #86868b; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 10px; }

  .cm-crew-card {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 12px; border-radius: 12px; border: 1px solid #e5e5ea; margin-bottom: 8px;
    background: white; transition: all 0.15s;
  }
  .cm-crew-card:hover { border-color: #007aff; }
  .cm-crew-card.cm-outside { border-color: #ff9500; background: #fffbf0; }

  .cm-crew-avatar {
    width: 36px; height: 36px; border-radius: 50%; background: #f0f0f3;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.75rem; font-weight: 600; color: #48484a; flex-shrink: 0; overflow: hidden;
  }
  .cm-crew-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .cm-crew-info { flex: 1; min-width: 0; }
  .cm-crew-name { font-size: 0.8125rem; font-weight: 600; color: #1d1d1f; }
  .cm-crew-job { font-size: 0.75rem; color: #48484a; }
  .cm-crew-meta { display: flex; gap: 10px; margin-top: 4px; font-size: 0.6875rem; color: #86868b; }
  .cm-crew-time { color: #48484a; }
  .cm-battery-low { color: #ff3b30; }
  .cm-crew-source { font-size: 0.625rem; color: #aeaeb2; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; }
  .cm-flag { color: #ff9500; font-size: 0.6875rem; font-weight: 500; }

  .cm-job-pin { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f2f2f7; }
  .cm-job-pin-icon { font-size: 1.25rem; }
  .cm-job-pin-name { font-size: 0.8125rem; font-weight: 600; color: #1d1d1f; }
  .cm-job-pin-addr { font-size: 0.75rem; color: #48484a; }
  .cm-job-pin-coords { font-size: 0.6875rem; color: #aeaeb2; }

  /* Active clocks */
  .cm-active-list { display: flex; flex-direction: column; gap: 8px; }

  .cm-clock-card {
    display: flex; align-items: flex-start; gap: 14px;
    padding: 16px; border-radius: 14px; border: 1px solid #e5e5ea; background: white;
    transition: all 0.15s;
  }
  .cm-clock-card:hover { border-color: #34c759; box-shadow: 0 2px 8px rgba(52,199,89,0.08); }
  .cm-clock-card.cm-outside { border-color: #ff9500; background: #fffbf0; }

  .cm-clock-avatar {
    position: relative; width: 42px; height: 42px; border-radius: 50%;
    background: #f0f0f3; display: flex; align-items: center; justify-content: center;
    font-size: 0.875rem; font-weight: 600; color: #48484a; flex-shrink: 0; overflow: visible;
  }
  .cm-clock-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
  .cm-clock-pulse {
    position: absolute; bottom: -1px; right: -1px;
    width: 12px; height: 12px; background: #34c759; border-radius: 50%;
    border: 2px solid white;
    animation: cm-pulse 2s ease-in-out infinite;
  }
  @keyframes cm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

  .cm-clock-info { flex: 1; min-width: 0; }
  .cm-clock-name { font-size: 0.875rem; font-weight: 600; color: #1d1d1f; }
  .cm-clock-job { font-size: 0.8125rem; color: #48484a; }
  .cm-clock-class { font-size: 0.75rem; color: #86868b; }
  .cm-clock-meta { display: flex; gap: 12px; margin-top: 6px; font-size: 0.75rem; color: #86868b; }
  .cm-clock-duration { color: #34c759; font-weight: 600; }
  .cm-clock-source { text-transform: capitalize; }
  .cm-clock-break { color: #ff9500; }
  .cm-clock-lunch { color: #ff9500; font-weight: 600; }
  .cm-clock-addr { font-size: 0.6875rem; color: #aeaeb2; margin-top: 4px; }
  .cm-clock-time { font-size: 0.8125rem; font-weight: 600; color: #1d1d1f; flex-shrink: 0; }

  /* Flagged */
  .cm-flagged { padding: 20px 0; }
  .cm-flagged-desc { font-size: 0.8125rem; color: #86868b; margin-bottom: 16px; }
  .cm-flagged-count { font-size: 1rem; font-weight: 600; color: #ff9500; margin-bottom: 8px; }
  .cm-flagged-sub { font-size: 0.8125rem; color: #86868b; }

  /* Empty states */
  .cm-empty { text-align: center; padding: 24px; color: #aeaeb2; font-size: 0.8125rem; }
  .cm-empty-big { text-align: center; padding: 60px 20px; color: #86868b; }
  .cm-empty-big p { margin-top: 12px; font-size: 0.875rem; }
</style>
