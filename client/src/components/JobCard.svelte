<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import EmployeeCard from "./EmployeeCard.svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  export let job: {
    id: number;
    jobNumber: string;
    name: string;
    address: string;
    gcContact: string;
    status: string;
    contractAmount: number;
    jurisdictionId?: number;
    jurisdictionName?: string;
    showOnBoard?: boolean;
    crew: any[];
    crewCount: number;
    totalBudget: number;
    dailyLaborCost: number;
    weeklyLaborCost: number;
    compositeHourlyRate: number;
    licenseRatio: { licensed: number; perNonLicensed: number };
    hoursRemaining: number | null;
    hourBudget: number | null;
    hoursUsed: number | null;
    materialBudget: number | null;
    materialCost: number | null;
    equipmentBudget: number | null;
    equipmentCost: number | null;
    generalBudget: number | null;
    generalCost: number | null;
    weeksRemaining: number | null;
    hoursRunOutDate: string | null;
  };

  // Compact formatters for progress bar labels
  function shortDollar(v: number): string {
    if (v >= 1000000) return "$" + (v / 1000000).toFixed(1) + "M";
    if (v >= 1000) return "$" + (v / 1000).toFixed(1) + "k";
    return "$" + v.toFixed(0);
  }
  function shortNum(v: number): string {
    if (v >= 1000) return (v / 1000).toFixed(1) + "k";
    return v.toFixed(0);
  }

  export let empMoveMap: Map<number, any> = new Map();

  $: canEdit = $user?.role === "admin" || $user?.role === "pm" || $user?.role === "super_admin";

  let statsExpanded = true;

  async function hideFromBoard() {
    if (!confirm(`Hide "${job.name}" from the board? You can re-enable it from the Jobs page.`)) return;
    try {
      await api.patch(`/jobs/${job.id}/show-on-board`, { showOnBoard: false });
      dispatch("boardToggle");
    } catch (e: any) {
      alert(e.message);
    }
  }

  const dispatch = createEventDispatcher();

  $: crewByClass = job.crew.reduce((acc: Record<string, number>, emp: any) => {
    const key = emp.classificationName?.split(" ")[0] || "Other";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  $: crewBreakdown = Object.entries(crewByClass).map(([cls, count]) => `${count} ${cls}`).join(", ");

  function formatCurrency(n: number) {
    if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  }

  function formatHours(n: number) {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // Timeclock color: green > 8 weeks, yellow 4-8, orange 2-4, red < 2
  $: timeclockColor = job.weeksRemaining === null ? ""
    : job.weeksRemaining > 8 ? "text-success"
    : job.weeksRemaining > 4 ? "text-warning"
    : "text-error";

  // Budget usage percentages
  $: hoursPercent = (job.hourBudget && job.hourBudget > 0)
    ? Math.round(((job.hoursUsed || 0) / job.hourBudget) * 100)
    : null;
  $: materialPercent = (job.materialBudget && job.materialBudget > 0)
    ? Math.round(((job.materialCost || 0) / job.materialBudget) * 100)
    : null;
  $: equipmentPercent = (job.equipmentBudget && job.equipmentBudget > 0)
    ? Math.round(((job.equipmentCost || 0) / job.equipmentBudget) * 100)
    : null;
  $: generalPercent = (job.generalBudget && job.generalBudget > 0)
    ? Math.round(((job.generalCost || 0) / job.generalBudget) * 100)
    : null;
  $: hasAnyBudget = hoursPercent !== null || materialPercent !== null || equipmentPercent !== null || generalPercent !== null;

  let dropZone: HTMLDivElement;

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }

  function onDragEnter(e: DragEvent) {
    e.preventDefault();
    if (dropZone) dropZone.classList.add("drag-over");
  }

  function onDragLeave(e: DragEvent) {
    const related = e.relatedTarget as HTMLElement;
    if (dropZone && !dropZone.contains(related)) {
      dropZone.classList.remove("drag-over");
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (dropZone) dropZone.classList.remove("drag-over");
    dispatch("drop", { event: e, jobId: job.id });
  }
</script>

<div class="jc-card">
  <!-- Job Header -->
  <div class="jc-header">
    <div>
      <div class="flex items-center gap-2">
        <span class="jc-num">#{job.jobNumber}</span>
        <h3 class="jc-name">{job.name}</h3>
      </div>
      <div class="jc-meta">
        {#if job.address}{job.address}{/if}
        {#if job.gcContact} &middot; GC: {job.gcContact}{/if}
      </div>
    </div>
    <div class="text-right flex-shrink-0 flex items-start gap-2">
      <div>
        <div class="flex items-center gap-1 justify-end">
          {#if job.jurisdictionName}
            <span class="jc-jur">{job.jurisdictionName}</span>
          {/if}
        </div>
        {#if job.contractAmount}
          <div class="jc-contract">
            {formatCurrency(job.contractAmount)}
          </div>
        {/if}
      </div>
      {#if canEdit}
        <button
          class="btn btn-xs btn-ghost text-base-content/30 hover:text-base-content/70"
          title="Hide from board"
          on:click|stopPropagation={hideFromBoard}
        >&#10005;</button>
      {/if}
    </div>
  </div>

  <!-- Stats Bar (collapsible) -->
  <button class="jc-stats-toggle" on:click={() => statsExpanded = !statsExpanded}>
    <div class="flex items-center gap-1">
      <span class="font-medium">Crew:</span>
      <span class="badge badge-sm badge-primary">{job.crewCount}</span>
      {#if crewBreakdown}
        <span class="opacity-60">({crewBreakdown})</span>
      {/if}
    </div>
    <div class="ml-auto flex items-center gap-2">
      {#if !statsExpanded && job.dailyLaborCost > 0}
        <span class="opacity-60">{formatCurrency(job.dailyLaborCost)}/day</span>
      {/if}
      <span class="jc-chevron" class:expanded={statsExpanded}>&#9662;</span>
    </div>
  </button>

  {#if statsExpanded}
    <div class="jc-stats-detail">
      <!-- Row 1: Rates & Costs + Out of Hours -->
      <div class="jc-stats-row">
        <div class="flex items-center gap-2 flex-1">
          {#if job.crewCount > 0 && job.licenseRatio}
            <span class="jc-stat" title="Licensed : Non-Licensed Ratio">
              Ratio {job.licenseRatio.licensed}:{job.licenseRatio.perNonLicensed}
            </span>
          {/if}
          {#if job.compositeHourlyRate > 0}
            <span class="jc-stat text-secondary">${job.compositeHourlyRate.toFixed(2)}/hr</span>
          {/if}
          {#if job.dailyLaborCost > 0}
            <span class="jc-stat text-accent">{formatCurrency(job.dailyLaborCost)}/day</span>
          {/if}
          {#if job.weeklyLaborCost > 0}
            <span class="jc-stat text-accent">{formatCurrency(job.weeklyLaborCost)}/wk</span>
          {/if}
        </div>
        {#if job.hoursRunOutDate && job.weeksRemaining !== null}
          <span class="jc-stat {timeclockColor} font-semibold whitespace-nowrap" title="Estimated date manhours run out at current crew size (40hr/wk)">
            {#if job.weeksRemaining < 1}
              &lt;1 wk
            {:else}
              ~{job.weeksRemaining.toFixed(1)} wks
            {/if}
            &rarr; {formatDate(job.hoursRunOutDate)}
          </span>
        {/if}
      </div>

      {#if job.hourBudget !== null}

        <!-- Budget progress bars — 2×2 compact grid -->
        {#if hasAnyBudget}
          <div class="jc-progress-grid">
            {#if hoursPercent !== null}
              {@const hBud = job.hourBudget || 0}
              {@const hUsed = job.hoursUsed || 0}
              {@const hRem = hBud - hUsed}
              <div class="jc-progress-cell">
                <div class="jc-progress-label">
                  <span>Hrs <span class="jc-progress-detail">({shortNum(hBud)}/{shortNum(hUsed)}) Rem: {shortNum(Math.max(hRem, 0))}</span></span>
                  <span class="{hoursPercent >= 100 ? 'jc-pct-over' : hoursPercent >= 80 ? 'jc-pct-warn' : 'jc-pct-ok'}">{hoursPercent}%</span>
                </div>
                <div class="jc-progress-track">
                  <div class="jc-progress-bar {hoursPercent >= 100 ? 'over-budget' : hoursPercent >= 80 ? 'warning' : ''}" style="width: {Math.min(hoursPercent, 100)}%"></div>
                </div>
              </div>
            {/if}
            {#if materialPercent !== null}
              {@const mBud = job.materialBudget || 0}
              {@const mUsed = job.materialCost || 0}
              {@const mRem = mBud - mUsed}
              <div class="jc-progress-cell">
                <div class="jc-progress-label">
                  <span>Mat <span class="jc-progress-detail">({shortDollar(mBud)}/{shortDollar(mUsed)}) Rem: {shortDollar(Math.max(mRem, 0))}</span></span>
                  <span class="{materialPercent >= 100 ? 'jc-pct-over' : materialPercent >= 80 ? 'jc-pct-warn' : 'jc-pct-ok'}">{materialPercent}%</span>
                </div>
                <div class="jc-progress-track">
                  <div class="jc-progress-bar {materialPercent >= 100 ? 'over-budget' : materialPercent >= 80 ? 'warning' : ''}" style="width: {Math.min(materialPercent, 100)}%"></div>
                </div>
              </div>
            {/if}
            {#if equipmentPercent !== null}
              {@const eBud = job.equipmentBudget || 0}
              {@const eUsed = job.equipmentCost || 0}
              {@const eRem = eBud - eUsed}
              <div class="jc-progress-cell">
                <div class="jc-progress-label">
                  <span>Equip <span class="jc-progress-detail">({shortDollar(eBud)}/{shortDollar(eUsed)}) Rem: {shortDollar(Math.max(eRem, 0))}</span></span>
                  <span class="{equipmentPercent >= 100 ? 'jc-pct-over' : equipmentPercent >= 80 ? 'jc-pct-warn' : 'jc-pct-ok'}">{equipmentPercent}%</span>
                </div>
                <div class="jc-progress-track">
                  <div class="jc-progress-bar {equipmentPercent >= 100 ? 'over-budget' : equipmentPercent >= 80 ? 'warning' : ''}" style="width: {Math.min(equipmentPercent, 100)}%"></div>
                </div>
              </div>
            {/if}
            {#if generalPercent !== null}
              {@const gBud = job.generalBudget || 0}
              {@const gUsed = job.generalCost || 0}
              {@const gRem = gBud - gUsed}
              <div class="jc-progress-cell">
                <div class="jc-progress-label">
                  <span>Gen <span class="jc-progress-detail">({shortDollar(gBud)}/{shortDollar(gUsed)}) Rem: {shortDollar(Math.max(gRem, 0))}</span></span>
                  <span class="{generalPercent >= 100 ? 'jc-pct-over' : generalPercent >= 80 ? 'jc-pct-warn' : 'jc-pct-ok'}">{generalPercent}%</span>
                </div>
                <div class="jc-progress-track">
                  <div class="jc-progress-bar {generalPercent >= 100 ? 'over-budget' : generalPercent >= 80 ? 'warning' : ''}" style="width: {Math.min(generalPercent, 100)}%"></div>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- Drop Zone -->
  <div
    bind:this={dropZone}
    class="drop-zone"
    on:dragover={onDragOver}
    on:dragenter={onDragEnter}
    on:dragleave={onDragLeave}
    on:drop={onDrop}
    role="list"
  >
    {#if job.crew.length > 0}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-2">
        {#each job.crew as employee (employee.id)}
          <EmployeeCard
            {employee}
            showRate={true}
            compact={true}
            pendingMove={empMoveMap.get(employee.id) || null}
            on:dragstart={(e) => dispatch("employeeDragStart", e.detail)}
          />
        {/each}
      </div>
    {:else}
      <div class="flex items-center justify-center p-6 text-base-content/40">
        <div class="text-center">
          <div class="text-2xl mb-1">+</div>
          <p class="text-sm">Drag employees here</p>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .jc-card {
    background: #ffffff;
    border: 1px solid #e8e8ed;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06), 0 0 1px rgba(0,0,0,0.04);
    overflow: hidden;
    transition: box-shadow 0.2s;
  }
  .jc-card:hover {
    box-shadow: 0 4px 16px rgba(0,0,0,0.08), 0 0 1px rgba(0,0,0,0.06);
  }
  .jc-header {
    padding: 0.75rem 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
  }
  .jc-header::after,
  .jc-stats-toggle::after,
  .jc-stats-detail::after {
    content: '';
    position: absolute;
    left: 1rem;
    right: 1rem;
    bottom: 0;
    height: 1px;
    background: #f0f0f5;
  }
  .jc-num {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
    color: #1d5191;
    opacity: 0.6;
  }
  .jc-name {
    font-weight: 700;
    font-size: 0.9375rem;
    color: #1d1d1f;
    letter-spacing: -0.01em;
  }
  .jc-meta {
    font-size: 0.75rem;
    color: #86868b;
    margin-top: 2px;
  }
  .jc-jur {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    font-size: 0.6875rem;
    font-weight: 500;
    background: #f5f5f7;
    color: #86868b;
    border-radius: 6px;
    border: 1px solid #e8e8ed;
  }
  .jc-contract {
    font-size: 0.75rem;
    font-weight: 600;
    color: #424245;
    margin-top: 4px;
    text-align: right;
  }

  /* Collapsible stats toggle */
  .jc-stats-toggle {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: 100%;
    padding: 0.5rem 1rem;
    background: #ffffff;
    font-size: 0.75rem;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
    position: relative;
  }
  .jc-stats-toggle:hover {
    background: #fcfcfd;
  }
  .jc-chevron {
    font-size: 0.625rem;
    opacity: 0.4;
    transition: transform 0.2s;
    display: inline-block;
  }
  .jc-chevron.expanded {
    transform: rotate(180deg);
  }

  /* Expanded stats detail */
  .jc-stats-detail {
    padding: 0.375rem 1rem 0.5rem;
    background: #ffffff;
    font-size: 0.75rem;
    position: relative;
  }
  .jc-stats-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.125rem 0;
  }
  .jc-stat {
    white-space: nowrap;
  }
  /* Progress bars — 2×2 compact grid */
  .jc-progress-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.3rem 0.5rem;
    margin-top: 0.375rem;
    padding-top: 0.375rem;
    border-top: 1px solid #f0f0f5;
  }
  .jc-progress-cell {
    min-width: 0;
  }
  .jc-progress-label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 0.6875rem;
    color: #6e6e73;
    margin-bottom: 2px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }
  .jc-progress-detail {
    font-weight: 400;
    color: #86868b;
    letter-spacing: 0.01em;
  }
  .jc-pct-ok { color: #86868b; }
  .jc-pct-warn { color: #ff9f0a; }
  .jc-pct-over { color: #ff3b30; font-weight: 700; }
  .jc-progress-track {
    height: 2px;
    background: #f0f0f5;
    border-radius: 1px;
    overflow: hidden;
  }
  .jc-progress-bar {
    height: 100%;
    background: #34c759;
    border-radius: 1px;
    transition: width 0.3s ease;
  }
  .jc-progress-bar.warning {
    background: #ff9f0a;
  }
  .jc-progress-bar.over-budget {
    background: #ff3b30;
  }
</style>
