<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  // ── Send form state ────────────────────────────────────────
  let title = "";
  let body = "";
  let priority: "normal" | "urgent" = "normal";
  let audience: "company" | "job" | "individual" = "company";
  let targetJobId: number | null = null;
  let targetEmployeeId: number | null = null;
  let sending = false;
  let sendResult: { pushSent: number; pushFailed: number; totalTokens: number } | null = null;
  let sendError = "";

  // ── Lookups ────────────────────────────────────────────────
  let jobs: any[] = [];
  let employees: any[] = [];

  // ── Sent history ───────────────────────────────────────────
  let history: any[] = [];
  let loading = true;

  onMount(async () => {
    await Promise.all([loadHistory(), loadLookups()]);
    loading = false;
  });

  async function loadHistory() {
    try {
      history = await api.get("/announcements");
    } catch (e: any) {
      console.error("Failed to load announcements:", e);
    }
  }

  async function loadLookups() {
    try {
      const [j, e] = await Promise.all([
        api.get("/jobs"),
        api.get("/employees"),
      ]);
      jobs = (j.jobs || j || []).filter((j: any) => j.status === "active");
      employees = (e.employees || e || []).filter((e: any) => e.status === "active");
    } catch (e: any) {
      console.error("Failed to load lookups:", e);
    }
  }

  async function handleSend() {
    if (!title.trim() || !body.trim()) return;
    sending = true;
    sendError = "";
    sendResult = null;

    try {
      const result = await api.post("/announcements", {
        title: title.trim(),
        body: body.trim(),
        priority,
        audience,
        targetJobId: audience === "job" ? targetJobId : null,
        targetEmployeeId: audience === "individual" ? targetEmployeeId : null,
      });

      sendResult = result;
      // Reset form
      title = "";
      body = "";
      priority = "normal";
      // Refresh history
      await loadHistory();
    } catch (e: any) {
      sendError = e.message || "Failed to send announcement";
    } finally {
      sending = false;
    }
  }

  function formatDate(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function audienceLabel(a: any): string {
    if (a.audience === "company") return "Company-wide";
    if (a.audience === "job") return a.target_job_name || `Job #${a.target_job_id}`;
    if (a.audience === "individual") return a.target_employee_name || `Employee #${a.target_employee_id}`;
    return a.audience;
  }
</script>

<div class="comm-page">
  <h1 class="page-title mb-1">Communicate</h1>
  <p class="comm-subtitle">Send announcements and push notifications to field crews</p>

  <div class="comm-layout">
    <!-- Send form -->
    <div class="comm-card comm-send">
      <h2 class="comm-card-title">New Announcement</h2>

      <div class="comm-field">
        <label class="comm-label">Audience</label>
        <div class="comm-audience-btns">
          <button class="comm-aud-btn" class:comm-aud-active={audience === "company"} on:click={() => audience = "company"}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
            Company-wide
          </button>
          <button class="comm-aud-btn" class:comm-aud-active={audience === "job"} on:click={() => audience = "job"}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M3 7v10c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7H3zm0 0c0-1.1.9-2 2-2h2V3h8v2h2c1.1 0 2 .9 2 2"/></svg>
            Job-wide
          </button>
          <button class="comm-aud-btn" class:comm-aud-active={audience === "individual"} on:click={() => audience = "individual"}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/></svg>
            Individual
          </button>
        </div>
      </div>

      {#if audience === "job"}
        <div class="comm-field">
          <label class="comm-label" for="job-select">Select Job</label>
          <select id="job-select" class="comm-select" bind:value={targetJobId}>
            <option value={null}>— Choose a job —</option>
            {#each jobs as j}
              <option value={j.id}>{j.jobNumber} - {j.name}</option>
            {/each}
          </select>
        </div>
      {/if}

      {#if audience === "individual"}
        <div class="comm-field">
          <label class="comm-label" for="emp-select">Select Employee</label>
          <select id="emp-select" class="comm-select" bind:value={targetEmployeeId}>
            <option value={null}>— Choose an employee —</option>
            {#each employees as e}
              <option value={e.id}>{e.firstName} {e.lastName}</option>
            {/each}
          </select>
        </div>
      {/if}

      <div class="comm-field">
        <label class="comm-label" for="ann-title">Title</label>
        <input id="ann-title" type="text" class="comm-input" bind:value={title} placeholder="Announcement title..." maxlength="200" />
      </div>

      <div class="comm-field">
        <label class="comm-label" for="ann-body">Message</label>
        <textarea id="ann-body" class="comm-textarea" bind:value={body} placeholder="Type your message..." rows="4" maxlength="2000"></textarea>
      </div>

      <div class="comm-field">
        <label class="comm-label">Priority</label>
        <div class="comm-priority-row">
          <button class="comm-pri-btn" class:comm-pri-active={priority === "normal"} on:click={() => priority = "normal"}>
            Normal
          </button>
          <button class="comm-pri-btn comm-pri-urgent" class:comm-pri-active={priority === "urgent"} on:click={() => priority = "urgent"}>
            Urgent
          </button>
        </div>
      </div>

      {#if sendError}
        <div class="comm-error">{sendError}</div>
      {/if}

      {#if sendResult}
        <div class="comm-success">
          Sent! {sendResult.pushSent} notification{sendResult.pushSent !== 1 ? "s" : ""} delivered
          {#if sendResult.pushFailed > 0}
            ({sendResult.pushFailed} failed)
          {/if}
        </div>
      {/if}

      <button class="comm-send-btn" on:click={handleSend} disabled={sending || !title.trim() || !body.trim()}>
        {#if sending}
          <span class="comm-spinner"></span> Sending...
        {:else}
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          Send Announcement
        {/if}
      </button>
    </div>

    <!-- Sent history -->
    <div class="comm-card comm-history">
      <h2 class="comm-card-title">Sent Messages</h2>

      {#if loading}
        <div class="comm-loading">Loading...</div>
      {:else if history.length === 0}
        <div class="comm-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
            <path d="M19 10v2a7 7 0 01-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <p>No announcements sent yet</p>
          <p class="comm-empty-sub">Use the form to send your first message</p>
        </div>
      {:else}
        <div class="comm-history-list">
          {#each history as a (a.id)}
            <div class="comm-hist-item" class:comm-hist-urgent={a.priority === "urgent"}>
              <div class="comm-hist-top">
                <span class="comm-hist-audience">{audienceLabel(a)}</span>
                {#if a.priority === "urgent"}
                  <span class="comm-hist-badge comm-badge-urgent">Urgent</span>
                {/if}
                <span class="comm-hist-date">{formatDate(a.sent_at)}</span>
              </div>
              <div class="comm-hist-title">{a.title}</div>
              <div class="comm-hist-body">{a.body}</div>
              <div class="comm-hist-stats">
                <span class="comm-hist-stat">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  {a.push_sent || 0} sent
                </span>
                {#if a.read_count > 0}
                  <span class="comm-hist-stat">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                    {a.read_count} read
                  </span>
                {/if}
                <span class="comm-hist-stat comm-hist-by">by {a.sent_by_name || "Unknown"}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .comm-page { max-width: 1100px; margin: 0 auto; }

  .comm-subtitle {
    font-size: 0.8125rem; color: #86868b; margin: 0 0 20px;
  }

  .comm-layout {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 20px; align-items: start;
  }
  @media (max-width: 900px) { .comm-layout { grid-template-columns: 1fr; } }

  .comm-card {
    background: #fff; border-radius: 12px;
    border: 1px solid #e8e8ed; padding: 20px;
  }

  .comm-card-title {
    font-size: 0.6875rem; font-weight: 700; color: #86868b;
    text-transform: uppercase; letter-spacing: 0.08em;
    margin: 0 0 16px; padding-bottom: 10px; border-bottom: 1px solid #f2f2f7;
  }

  .comm-field { margin-bottom: 14px; }

  .comm-label {
    display: block; font-size: 0.75rem; font-weight: 600;
    color: #636366; margin-bottom: 5px;
  }

  /* Audience selector — pill style */
  .comm-audience-btns {
    display: flex; gap: 0; background: #f2f2f7;
    border-radius: 8px; padding: 3px;
  }
  .comm-aud-btn {
    flex: 1; display: flex; align-items: center; justify-content: center;
    gap: 5px; padding: 8px 10px; border: none; border-radius: 6px;
    background: transparent; color: #86868b; font-size: 0.8rem;
    font-weight: 500; cursor: pointer; transition: all 0.15s;
  }
  .comm-aud-btn:hover { color: #1d1d1f; }
  .comm-aud-active {
    background: #fff; color: #1d1d1f; font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  /* Inputs */
  .comm-select, .comm-input, .comm-textarea {
    width: 100%; padding: 9px 12px;
    border: 1px solid #e8e8ed; border-radius: 8px;
    font-size: 0.875rem; color: #1d1d1f;
    background: #fff; box-sizing: border-box;
    font-family: inherit; transition: border-color 0.15s, box-shadow 0.15s;
  }
  .comm-select:focus, .comm-input:focus, .comm-textarea:focus {
    border-color: #007aff; outline: none;
    box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.12);
  }
  .comm-textarea { resize: vertical; }

  /* Priority toggle */
  .comm-priority-row {
    display: flex; gap: 0; background: #f2f2f7;
    border-radius: 8px; padding: 3px; max-width: 240px;
  }
  .comm-pri-btn {
    flex: 1; padding: 7px 16px; border: none; border-radius: 6px;
    background: transparent; color: #86868b; font-size: 0.8125rem;
    font-weight: 500; cursor: pointer; transition: all 0.15s;
  }
  .comm-pri-btn:hover { color: #1d1d1f; }
  .comm-pri-active {
    background: #fff; color: #1d1d1f; font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .comm-pri-urgent.comm-pri-active {
    background: #fff; color: #dc2626;
  }

  /* Alerts */
  .comm-error {
    background: #fef2f2; color: #dc2626; padding: 10px 14px;
    border-radius: 8px; font-size: 0.8125rem; margin-bottom: 12px;
    border: 1px solid #fecaca;
  }
  .comm-success {
    background: #f0fdf4; color: #16a34a; padding: 10px 14px;
    border-radius: 8px; font-size: 0.8125rem; margin-bottom: 12px;
    border: 1px solid #bbf7d0;
  }

  /* Send button */
  .comm-send-btn {
    width: 100%; display: flex; align-items: center; justify-content: center;
    gap: 8px; padding: 11px; border: none; border-radius: 8px;
    background: #1d1d1f; color: #fff; font-size: 0.875rem; font-weight: 600;
    cursor: pointer; transition: all 0.15s; font-family: inherit;
  }
  .comm-send-btn:hover:not(:disabled) { background: #333; }
  .comm-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .comm-spinner {
    width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white; border-radius: 50%;
    animation: comm-spin 0.6s linear infinite; display: inline-block;
  }
  @keyframes comm-spin { to { transform: rotate(360deg); } }

  /* ── History ─────────────────────────────────────── */
  .comm-loading { color: #aeaeb2; text-align: center; padding: 40px 0; font-size: 0.8125rem; }

  .comm-empty {
    text-align: center; padding: 40px 20px; color: #aeaeb2;
  }
  .comm-empty p { margin: 8px 0 0; font-size: 0.875rem; }
  .comm-empty-sub { font-size: 0.75rem !important; color: #c7c7cc; }

  .comm-history-list {
    display: flex; flex-direction: column; gap: 2px;
    max-height: calc(100vh - 260px); overflow-y: auto;
  }

  .comm-hist-item {
    padding: 12px 14px; border-radius: 8px;
    transition: background 0.12s; border-bottom: 1px solid #f2f2f7;
  }
  .comm-hist-item:last-child { border-bottom: none; }
  .comm-hist-item:hover { background: #f9f9fb; }
  .comm-hist-urgent { border-left: 3px solid #ff3b30; }

  .comm-hist-top {
    display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
  }
  .comm-hist-audience {
    font-size: 0.6875rem; font-weight: 600; color: #636366;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .comm-hist-badge {
    font-size: 0.625rem; font-weight: 700; padding: 1px 5px;
    border-radius: 3px; text-transform: uppercase; letter-spacing: 0.3px;
  }
  .comm-badge-urgent { background: #fef2f2; color: #ff3b30; }

  .comm-hist-date {
    font-size: 0.6875rem; color: #aeaeb2; margin-left: auto;
  }
  .comm-hist-title {
    font-size: 0.875rem; font-weight: 600; color: #1d1d1f; margin-bottom: 3px;
  }
  .comm-hist-body {
    font-size: 0.8125rem; color: #636366; line-height: 1.45;
    white-space: pre-wrap; margin-bottom: 6px;
  }
  .comm-hist-stats { display: flex; align-items: center; gap: 12px; }
  .comm-hist-stat {
    display: flex; align-items: center; gap: 3px;
    font-size: 0.6875rem; color: #aeaeb2;
  }
  .comm-hist-by { margin-left: auto; font-style: italic; }
</style>
