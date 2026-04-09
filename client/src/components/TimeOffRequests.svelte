<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  let requests: any[] = [];
  let balances: any[] = [];
  let loading = true;
  let error = "";
  let filterStatus = "";
  let filterType = "";

  // Resolve modal
  let resolveReq: any = null;
  let resolveAction: "approve" | "reject" = "approve";
  let resolveNote = "";
  let resolveSaving = false;

  // Accrue modal
  let accrueOpen = false;
  let accrueType: "pto" | "sick" = "pto";
  let accrueHours = 0;
  let accrueSaving = false;

  $: canApprove = (() => { const u = $user; return u && (u.role === "super_admin" || u.role === "admin"); })();

  const TYPE_LABELS: Record<string, string> = {
    paid_sick_leave: "Paid Sick Leave",
    time_off: "Time Off",
    general_note: "General Note",
  };
  const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
    paid_sick_leave: { bg: "#fef2f2", text: "#dc2626" },
    time_off: { bg: "#f0fdf4", text: "#16a34a" },
    general_note: { bg: "#fefce8", text: "#a16207" },
  };
  const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    pending: { bg: "#fff7ed", text: "#ea580c" },
    approved: { bg: "#f0fdf4", text: "#16a34a" },
    rejected: { bg: "#fef2f2", text: "#dc2626" },
  };

  async function load() {
    loading = true; error = "";
    try {
      let url = "/time-tracking/time-off?";
      if (filterStatus) url += `status=${filterStatus}&`;
      if (filterType) url += `type=${filterType}&`;
      const [reqRes, balRes] = await Promise.all([
        api.get(url),
        api.get("/time-tracking/pto-balances"),
      ]);
      requests = reqRes?.requests || [];
      balances = balRes?.balances || [];
    } catch (e: any) { error = e.message; } finally { loading = false; }
  }

  function openResolve(req: any, action: "approve" | "reject") {
    resolveReq = req;
    resolveAction = action;
    resolveNote = "";
    resolveSaving = false;
  }

  async function submitResolve() {
    if (!resolveReq) return;
    resolveSaving = true;
    try {
      await api.post(`/time-tracking/time-off/${resolveReq.id}/${resolveAction}`, {
        note: resolveNote.trim() || null,
      });
      resolveReq = null;
      await load();
    } catch (e: any) { error = e.message; } finally { resolveSaving = false; }
  }

  async function submitAccrue() {
    accrueSaving = true;
    try {
      await api.post("/time-tracking/pto-balances/accrue-bulk", {
        balanceType: accrueType,
        hoursPerEmployee: accrueHours,
      });
      accrueOpen = false;
      await load();
    } catch (e: any) { error = e.message; } finally { accrueSaving = false; }
  }

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // Group balances by employee
  $: groupedBalances = (() => {
    const m = new Map<number, any>();
    for (const b of balances) {
      if (!m.has(b.employee_id)) m.set(b.employee_id, { name: `${b.first_name} ${b.last_name}`, pto: null, sick: null });
      const g = m.get(b.employee_id)!;
      if (b.balance_type === "pto") g.pto = b;
      if (b.balance_type === "sick") g.sick = b;
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  $: pendingCount = requests.filter(r => r.status === "pending").length;

  onMount(load);
</script>

<div class="to">
  {#if error}<div class="to-error">{error}</div>{/if}

  <!-- Stats bar -->
  <div class="to-stats">
    <div class="to-stat">
      <span class="to-stat-val to-stat-orange">{pendingCount}</span>
      <span class="to-stat-lbl">Pending</span>
    </div>
    <div class="to-stat">
      <span class="to-stat-val">{requests.filter(r => r.status === "approved").length}</span>
      <span class="to-stat-lbl">Approved</span>
    </div>
    <div class="to-stat">
      <span class="to-stat-val">{requests.filter(r => r.status === "rejected").length}</span>
      <span class="to-stat-lbl">Rejected</span>
    </div>
    {#if canApprove}
      <button class="to-accrue-btn" on:click={() => { accrueOpen = true; accrueHours = 0; }}>
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
        Accrue Hours
      </button>
    {/if}
  </div>

  <!-- Filters -->
  <div class="to-filters">
    <select class="select select-xs select-bordered" bind:value={filterStatus} on:change={load}>
      <option value="">All Statuses</option>
      <option value="pending">Pending</option>
      <option value="approved">Approved</option>
      <option value="rejected">Rejected</option>
    </select>
    <select class="select select-xs select-bordered" bind:value={filterType} on:change={load}>
      <option value="">All Types</option>
      <option value="paid_sick_leave">Paid Sick Leave</option>
      <option value="time_off">Time Off</option>
      <option value="general_note">General Note</option>
    </select>
  </div>

  {#if loading}
    <div class="to-loading"><span class="loading loading-spinner loading-md text-primary"></span></div>
  {:else}
    <div class="to-grid">
      <!-- Requests -->
      <div class="to-section">
        <h3 class="to-section-title">Requests ({requests.length})</h3>
        {#if requests.length === 0}
          <div class="to-empty">No requests found</div>
        {/if}
        {#each requests as req (req.id)}
          <div class="to-card" class:to-card-pending={req.status === "pending"}>
            <div class="to-card-top">
              <span class="to-badge" style="background:{TYPE_COLORS[req.request_type]?.bg};color:{TYPE_COLORS[req.request_type]?.text}">
                {TYPE_LABELS[req.request_type] || req.request_type}
              </span>
              <span class="to-badge" style="background:{STATUS_COLORS[req.status]?.bg};color:{STATUS_COLORS[req.status]?.text}">
                {req.status}
              </span>
              <span class="to-time">{timeAgo(req.created_at)}</span>
            </div>
            <div class="to-card-who">{req.first_name} {req.last_name}</div>
            {#if req.request_type !== "general_note"}
              <div class="to-card-dates">
                {req.start_date}{req.end_date ? ` → ${req.end_date}` : ""}
                {req.hours_requested ? ` · ${req.hours_requested}h` : ""}
              </div>
            {/if}
            <div class="to-card-note">{req.note}</div>
            {#if req.manager_note}
              <div class="to-card-mgr-note">
                <strong>Response:</strong> {req.manager_note}
                {#if req.resolver_name}<span class="to-card-resolver">— {req.resolver_name}</span>{/if}
              </div>
            {/if}
            {#if req.status === "pending" && canApprove}
              <div class="to-card-actions">
                <button class="to-btn to-btn-approve" on:click={() => openResolve(req, "approve")}>Approve</button>
                <button class="to-btn to-btn-reject" on:click={() => openResolve(req, "reject")}>Reject</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- PTO Balances -->
      <div class="to-section">
        <h3 class="to-section-title">PTO / Sick Balances</h3>
        {#if groupedBalances.length === 0}
          <div class="to-empty">No balances set up yet. Use "Accrue Hours" to get started.</div>
        {/if}
        {#each groupedBalances as emp}
          <div class="to-bal-card">
            <div class="to-bal-name">{emp.name}</div>
            <div class="to-bal-row">
              {#if emp.pto}
                <div class="to-bal-item">
                  <span class="to-bal-type to-bal-pto">PTO</span>
                  <span class="to-bal-hrs">{(emp.pto.available_hours ?? 0).toFixed(1)}h</span>
                  <span class="to-bal-detail">{emp.pto.accrued_hours.toFixed(1)} accrued · {emp.pto.used_hours.toFixed(1)} used</span>
                </div>
              {/if}
              {#if emp.sick}
                <div class="to-bal-item">
                  <span class="to-bal-type to-bal-sick">Sick</span>
                  <span class="to-bal-hrs">{(emp.sick.available_hours ?? 0).toFixed(1)}h</span>
                  <span class="to-bal-detail">{emp.sick.accrued_hours.toFixed(1)} accrued · {emp.sick.used_hours.toFixed(1)} used</span>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Resolve Modal -->
{#if resolveReq}
  <div class="modal modal-open">
    <div class="modal-box max-w-md">
      <h3 class="font-bold text-lg mb-2">{resolveAction === "approve" ? "Approve" : "Reject"} Request</h3>
      <p class="text-sm text-base-content/60 mb-3">
        {TYPE_LABELS[resolveReq.request_type]} from <strong>{resolveReq.first_name} {resolveReq.last_name}</strong>
        {#if resolveReq.hours_requested} · {resolveReq.hours_requested}h{/if}
      </p>
      <div class="mb-3">
        <label class="text-xs text-base-content/50" for="resolve-note">Note (optional)</label>
        <textarea id="resolve-note" class="textarea textarea-sm textarea-bordered w-full" rows="2" bind:value={resolveNote} placeholder="Add a note..."></textarea>
      </div>
      <div class="flex gap-2">
        <button
          class="btn btn-sm"
          class:btn-success={resolveAction === "approve"}
          class:btn-error={resolveAction === "reject"}
          on:click={submitResolve}
          disabled={resolveSaving}
        >
          {resolveSaving ? "Saving..." : resolveAction === "approve" ? "Approve" : "Reject"}
        </button>
        <button class="btn btn-sm btn-ghost" on:click={() => { resolveReq = null; }}>Cancel</button>
      </div>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={() => { resolveReq = null; }}></div>
  </div>
{/if}

<!-- Accrue Modal -->
{#if accrueOpen}
  <div class="modal modal-open">
    <div class="modal-box max-w-sm">
      <h3 class="font-bold text-lg mb-2">Accrue Hours</h3>
      <p class="text-xs text-base-content/50 mb-3">Add hours to all active employees</p>
      <div class="mb-3">
        <label class="text-xs text-base-content/50" for="accrue-type">Balance Type</label>
        <select id="accrue-type" class="select select-sm select-bordered w-full" bind:value={accrueType}>
          <option value="pto">PTO</option>
          <option value="sick">Sick Leave</option>
        </select>
      </div>
      <div class="mb-3">
        <label class="text-xs text-base-content/50" for="accrue-hrs">Hours Per Employee</label>
        <input id="accrue-hrs" type="number" step="0.5" min="0" class="input input-sm input-bordered w-full" bind:value={accrueHours} />
      </div>
      <div class="flex gap-2">
        <button class="btn btn-sm btn-primary" on:click={submitAccrue} disabled={accrueSaving || accrueHours <= 0}>
          {accrueSaving ? "Saving..." : "Accrue to All"}
        </button>
        <button class="btn btn-sm btn-ghost" on:click={() => { accrueOpen = false; }}>Cancel</button>
      </div>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={() => { accrueOpen = false; }}></div>
  </div>
{/if}

<style>
  .to { padding: 0; }
  .to-error { padding: 8px 12px; background: #ffeef0; color: #d32f2f; border-radius: 8px; font-size: 0.8125rem; margin-bottom: 12px; }
  .to-loading { display: flex; justify-content: center; padding: 48px; }
  .to-empty { text-align: center; padding: 32px; color: #aeaeb2; font-size: 0.875rem; }

  .to-stats {
    display: flex; align-items: center; gap: 16px; margin-bottom: 14px;
    padding: 12px 16px; background: white; border: 1px solid #e5e5ea; border-radius: 12px;
  }
  .to-stat { display: flex; flex-direction: column; align-items: center; }
  .to-stat-val { font-size: 1.25rem; font-weight: 700; color: #1d1d1f; }
  .to-stat-orange { color: #ea580c; }
  .to-stat-lbl { font-size: 0.625rem; color: #86868b; text-transform: uppercase; letter-spacing: 0.04em; }
  .to-accrue-btn {
    margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
    font-size: 0.75rem; font-weight: 600; color: #007aff;
    padding: 5px 12px; border: 1px solid #007aff; border-radius: 7px;
    background: white; cursor: pointer; transition: all 0.15s;
  }
  .to-accrue-btn:hover { background: #007aff; color: white; }

  .to-filters { display: flex; gap: 6px; margin-bottom: 14px; }

  .to-grid { display: grid; grid-template-columns: 1fr 320px; gap: 16px; align-items: start; }

  .to-section-title { font-size: 0.75rem; font-weight: 600; color: #86868b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 10px; }

  .to-card {
    background: white; border: 1px solid #e5e5ea; border-radius: 12px;
    padding: 14px 16px; margin-bottom: 8px;
    transition: border-color 0.15s;
  }
  .to-card-pending { border-left: 3px solid #ea580c; }
  .to-card-top { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .to-badge {
    font-size: 0.625rem; font-weight: 600; padding: 2px 8px; border-radius: 6px;
    text-transform: uppercase; letter-spacing: 0.03em;
  }
  .to-time { font-size: 0.6875rem; color: #aeaeb2; margin-left: auto; }
  .to-card-who { font-size: 0.875rem; font-weight: 600; color: #1d1d1f; }
  .to-card-dates { font-size: 0.75rem; color: #636366; margin-top: 2px; }
  .to-card-note { font-size: 0.8125rem; color: #636366; margin-top: 6px; line-height: 1.4; }
  .to-card-mgr-note {
    font-size: 0.75rem; color: #86868b; margin-top: 8px;
    padding: 8px 10px; background: #f9f9fb; border-radius: 8px;
  }
  .to-card-resolver { color: #aeaeb2; }
  .to-card-actions { display: flex; gap: 6px; margin-top: 10px; }
  .to-btn {
    font-size: 0.75rem; font-weight: 600; padding: 5px 14px; border-radius: 7px;
    border: none; cursor: pointer; transition: all 0.15s;
  }
  .to-btn-approve { background: #dcfce7; color: #16a34a; }
  .to-btn-approve:hover { background: #16a34a; color: white; }
  .to-btn-reject { background: #fef2f2; color: #dc2626; }
  .to-btn-reject:hover { background: #dc2626; color: white; }

  /* Balances */
  .to-bal-card {
    background: white; border: 1px solid #e5e5ea; border-radius: 10px;
    padding: 10px 14px; margin-bottom: 6px;
  }
  .to-bal-name { font-size: 0.8125rem; font-weight: 600; color: #1d1d1f; margin-bottom: 4px; }
  .to-bal-row { display: flex; gap: 12px; }
  .to-bal-item { display: flex; align-items: center; gap: 6px; }
  .to-bal-type {
    font-size: 0.5625rem; font-weight: 700; padding: 2px 6px; border-radius: 4px;
    text-transform: uppercase; letter-spacing: 0.03em;
  }
  .to-bal-pto { background: #f0fdf4; color: #16a34a; }
  .to-bal-sick { background: #fef2f2; color: #dc2626; }
  .to-bal-hrs { font-size: 0.875rem; font-weight: 700; color: #1d1d1f; }
  .to-bal-detail { font-size: 0.625rem; color: #aeaeb2; }

  @media (max-width: 900px) {
    .to-grid { grid-template-columns: 1fr; }
  }
</style>
