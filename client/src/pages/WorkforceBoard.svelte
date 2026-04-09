<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user, currentPage } from "../lib/stores";
  import EmployeeCard from "../components/EmployeeCard.svelte";
  import JobCard from "../components/JobCard.svelte";

  interface BoardEmployee {
    id: number;
    employeeNumber: string;
    firstName: string;
    lastName: string;
    classificationId: number;
    classificationName: string;
    classificationColor: string;
    department: string;
    assignmentId?: number;
    role?: string;
    billRate?: number;
    photoUrl?: string;
  }

  interface BoardJob {
    id: number;
    jobNumber: string;
    name: string;
    address: string;
    gcContact: string;
    status: string;
    contractAmount: number;
    crew: BoardEmployee[];
    crewCount: number;
    budgets: any[];
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
    weeksRemaining: number | null;
    hoursRunOutDate: string | null;
  }

  interface PendingMove {
    id: number; employeeId: number; toJobId: number | null;
    jobNumber: string | null; jobName: string | null;
    effectiveDate: string; notes: string | null;
  }

  let bench: BoardEmployee[] = [];
  let jobs: BoardJob[] = [];
  let pendingMoves: PendingMove[] = [];
  let loading = true;
  let error = "";
  let searchTerm = "";
  let filterDept = "all";
  let showStaffedOnly = false;

  // Date navigation
  let boardDate = todayStr();
  let isFuture = false;

  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function addWeekdays(d: string, n: number): string {
    const dt = new Date(d + "T12:00:00");
    let remaining = Math.abs(n);
    const dir = n > 0 ? 1 : -1;
    while (remaining > 0) {
      dt.setDate(dt.getDate() + dir);
      const day = dt.getDay();
      if (day !== 0 && day !== 6) remaining--;
    }
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,'0');
    const dd = String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
  function fmtBoardDate(d: string): string {
    const dt = new Date(d + "T12:00:00");
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${days[dt.getDay()]}, ${months[dt.getMonth()]} ${dt.getDate()}`;
  }

  function prevDay() { boardDate = addWeekdays(boardDate, -1); loadBoard(); }
  function nextDay() { boardDate = addWeekdays(boardDate, 1); loadBoard(); }
  function goToday() { boardDate = todayStr(); loadBoard(); }

  $: isToday = boardDate === todayStr();

  $: visibleJobs = showStaffedOnly ? jobs.filter(j => j.crewCount > 0) : jobs;

  // Per-employee pending moves for tags
  $: empMoveMap = new Map(
    pendingMoves.filter(m => m.toJobId !== null).reduce((acc, m) => {
      // Keep earliest future move per employee
      if (!acc.has(m.employeeId) || m.effectiveDate < acc.get(m.employeeId)!.effectiveDate) {
        acc.set(m.employeeId, m);
      }
      return acc;
    }, new Map<number, PendingMove>())
  );

  // Drag state
  let dragEmployee: BoardEmployee | null = null;
  let dragSourceJobId: number | null = null;

  $: departments = [...new Set(
    bench.concat(jobs.flatMap(j => j.crew))
      .map(e => e.department)
      .filter(Boolean)
  )];

  $: filteredBench = bench.filter(e => {
    const matchesSearch = searchTerm === "" ||
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.employeeNumber.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDept = filterDept === "all" || e.department === filterDept;
    return matchesSearch && matchesDept;
  });

  async function loadBoard() {
    try {
      const data = await api.get(`/workforce-board?date=${boardDate}&today=${todayStr()}`);
      bench = data.bench;
      jobs = data.jobs;
      pendingMoves = data.pendingMoves || [];
      isFuture = data.isFuture || false;
    } catch (e: any) {
      error = e.message;
    }
    loading = false;
  }

  onMount(loadBoard);

  // Drag handlers
  function handleDragStart(employee: BoardEmployee, sourceJobId: number | null, e: DragEvent) {
    dragEmployee = employee;
    dragSourceJobId = sourceJobId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(employee.id));
    }
  }

  let benchEl: HTMLDivElement;

  function onBenchDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }

  function onBenchDragEnter(e: DragEvent) {
    e.preventDefault();
    if (benchEl) benchEl.classList.add("drag-over");
  }

  function onBenchDragLeave(e: DragEvent) {
    const related = e.relatedTarget as HTMLElement;
    if (benchEl && !benchEl.contains(related)) {
      benchEl.classList.remove("drag-over");
    }
  }

  async function onBenchDrop(e: DragEvent) {
    e.preventDefault();
    if (benchEl) benchEl.classList.remove("drag-over");
    if (!dragEmployee || dragSourceJobId === null) return;

    const canEdit = $user?.role === "super_admin" || $user?.role === "admin" || $user?.role === "pm";
    if (!canEdit) return;

    try {
      if (isFuture) {
        // Future date: schedule a bench move
        await api.post("/schedule/moves", {
          employeeId: dragEmployee.id,
          toJobId: null,
          effectiveDate: boardDate,
          notes: "Scheduled from board",
        });
      } else {
        // Today: direct assignment change
        const sourceJob = jobs.find(j => j.id === dragSourceJobId);
        const assignment = sourceJob?.crew.find(c => c.id === dragEmployee?.id);
        if (assignment?.assignmentId) {
          await api.del(`/assignments/${assignment.assignmentId}`);
        }
      }
      await loadBoard();
    } catch (e: any) {
      error = e.message;
    }
    dragEmployee = null;
    dragSourceJobId = null;
  }

  async function handleJobDrop(e: CustomEvent) {
    const { jobId } = e.detail;
    if (!dragEmployee) return;

    const canEdit = $user?.role === "super_admin" || $user?.role === "admin" || $user?.role === "pm";
    if (!canEdit) return;

    try {
      if (isFuture) {
        // Future date: schedule a move to this job
        await api.post("/schedule/moves", {
          employeeId: dragEmployee.id,
          toJobId: jobId,
          effectiveDate: boardDate,
          notes: "Scheduled from board",
        });
      } else {
        // Today: direct assignment change
        if (dragSourceJobId === null) {
          await api.post("/assignments", { jobId, employeeId: dragEmployee.id });
        } else if (dragSourceJobId !== jobId) {
          await api.post("/assignments/move", {
            employeeId: dragEmployee.id,
            fromJobId: dragSourceJobId,
            toJobId: jobId,
          });
        }
      }
      await loadBoard();
    } catch (e: any) {
      error = e.message;
    }
    dragEmployee = null;
    dragSourceJobId = null;
  }

  function handleCrewDragStart(e: CustomEvent) {
    const { event, employee } = e.detail;
    // Find which job this employee is on
    const sourceJob = jobs.find(j => j.crew.some(c => c.id === employee.id));
    handleDragStart(employee, sourceJob?.id ?? null, event);
  }
</script>

<div class="flex flex-col lg:flex-row gap-4 h-[calc(100vh-5rem)]">
  <!-- BENCH -->
  <div class="lg:w-80 xl:w-96 flex-shrink-0 flex flex-col apple-panel overflow-hidden">
    <div class="p-4 border-b border-base-300 bg-base-200/50">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-lg font-bold text-base-content">Employee Bench</h2>
        <div class="badge badge-sm bg-base-300 text-base-content/70 border-0">
          {filteredBench.length}
        </div>
      </div>
      <input
        type="text"
        placeholder="Search employees..."
        class="input input-sm w-full bg-base-100 border-base-300 text-base-content placeholder:text-base-content/40"
        bind:value={searchTerm}
      />
      <div class="flex gap-1 mt-2 flex-wrap">
        <button
          class="btn btn-xs"
          class:btn-active={filterDept === "all"}
          on:click={() => filterDept = "all"}
        >All</button>
        {#each departments as dept}
          <button
            class="btn btn-xs"
            class:btn-active={filterDept === dept}
            on:click={() => filterDept = dept}
          >{dept}</button>
        {/each}
      </div>
    </div>

    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      bind:this={benchEl}
      class="flex-1 overflow-y-auto p-2"
      role="list"
      on:dragover={onBenchDragOver}
      on:dragenter={onBenchDragEnter}
      on:dragleave={onBenchDragLeave}
      on:drop={onBenchDrop}
    >
      {#if loading}
        <div class="flex justify-center p-8">
          <span class="loading loading-spinner loading-md text-primary"></span>
        </div>
      {:else if filteredBench.length === 0}
        <div class="text-center p-6 text-base-content/50">
          <div class="text-3xl mb-2">&#10003;</div>
          <p class="text-sm font-medium">All employees assigned</p>
        </div>
      {:else}
        <div class="grid grid-cols-1 gap-2">
          {#each filteredBench as employee (employee.id)}
            <EmployeeCard
              {employee}
              pendingMove={empMoveMap.get(employee.id) || null}
              on:dragstart={(e) => handleDragStart(employee, null, e.detail.event)}
            />
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- JOBS -->
  <div class="flex-1 overflow-y-auto space-y-4 pb-20 lg:pb-4">
    <!-- Date Nav + Title Row -->
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <h2 class="text-lg font-bold text-base-content">
          {#if isToday}Today{:else}{fmtBoardDate(boardDate)}{/if}
          <span class="badge badge-sm bg-base-200 text-base-content/60 border-0 ml-1">{visibleJobs.length} jobs</span>
        </h2>
        {#if isFuture}
          <span class="wfb-future-badge">Future</span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <!-- Date navigation -->
        <div class="wfb-date-nav">
          <button class="wfb-nav-btn" on:click={prevDay}>&lsaquo;</button>
          <button class="wfb-nav-today" class:wfb-nav-today-active={isToday} on:click={goToday}>Today</button>
          <button class="wfb-nav-btn" on:click={nextDay}>&rsaquo;</button>
        </div>
        <button class="wfb-schedule-link" on:click={() => { $currentPage = "schedule"; }} title="View Schedule">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Schedule
        </button>
        <!-- Staffed / All toggle -->
        <div class="wfb-toggle">
          <button
            class="wfb-toggle-btn"
            class:wfb-toggle-active={!showStaffedOnly}
            on:click={() => showStaffedOnly = false}
          >All Jobs</button>
          <button
            class="wfb-toggle-btn"
            class:wfb-toggle-active={showStaffedOnly}
            on:click={() => showStaffedOnly = true}
          >Staffed Only</button>
        </div>
      </div>
    </div>


    {#if error}
      <div class="alert alert-error text-sm">
        <span>{error}</span>
        <button class="btn btn-sm btn-ghost" on:click={() => error = ""}>Dismiss</button>
      </div>
    {/if}

    {#if loading}
      <div class="flex justify-center p-12">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>
    {:else if visibleJobs.length === 0}
      <div class="text-center py-12 text-base-content/40">
        <p class="text-sm">{showStaffedOnly ? "No jobs have crew assigned yet." : "No active jobs on the board."}</p>
      </div>
    {:else}
      {#each visibleJobs as job (job.id)}
        <JobCard
          {job}
          {empMoveMap}
          on:drop={handleJobDrop}
          on:employeeDragStart={handleCrewDragStart}
          on:boardToggle={loadBoard}
        />
      {/each}
    {/if}
  </div>
</div>

<style>
  .wfb-toggle {
    display: inline-flex;
    background: #f0f0f3;
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
  }
  .wfb-toggle-btn {
    padding: 0.3rem 0.75rem;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 500;
    color: #86868b;
    border-radius: 6px;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .wfb-toggle-btn:hover { color: #424245; }
  .wfb-toggle-active {
    background: #ffffff;
    color: #1d1d1f;
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  /* Date nav */
  .wfb-date-nav {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: #f0f0f3;
    border-radius: 8px;
    padding: 2px;
  }
  .wfb-nav-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    border: none; background: transparent; cursor: pointer;
    font-size: 16px; font-weight: 300; color: #86868b;
    border-radius: 6px; transition: all 0.12s;
  }
  .wfb-nav-btn:hover { background: #e5e5ea; color: #1d1d1f; }
  .wfb-nav-today {
    padding: 0 10px; height: 28px;
    border: none; background: transparent; cursor: pointer;
    font-size: 12px; font-weight: 500; color: #86868b;
    border-radius: 6px; transition: all 0.12s;
  }
  .wfb-nav-today:hover { color: #424245; }
  .wfb-nav-today-active {
    background: #ffffff; color: #1d1d1f; font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .wfb-future-badge {
    display: inline-flex; align-items: center;
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    color: hsl(30, 80%, 45%); background: hsl(30, 80%, 95%);
    padding: 2px 8px; border-radius: 100px;
  }
  .wfb-schedule-link {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 0 10px; height: 28px;
    border: 1px solid #e8e8ed; background: #ffffff; cursor: pointer;
    font-size: 12px; font-weight: 500; color: #86868b;
    border-radius: 8px; transition: all 0.12s;
  }
  .wfb-schedule-link:hover { color: #007aff; border-color: #007aff40; background: #f0f6ff; }

</style>
