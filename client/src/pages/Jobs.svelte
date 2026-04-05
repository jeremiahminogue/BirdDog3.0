<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";
  import AddressPicker from "../components/AddressPicker.svelte";

  let jobs: any[] = [];
  let jurisdictions: any[] = [];
  let loading = true;
  let statusFilter = "active";
  let showAddModal = false;
  let editingJob: any = null;

  function sumBudgets(budgets: any[], field: string) {
    return budgets.reduce((s, b) => s + (b[field] || 0), 0);
  }

  let form = resetForm();

  function resetForm() {
    return {
      jobNumber: "", name: "", address: "", gcContact: "",
      latitude: null as number | null,
      longitude: null as number | null,
      jurisdictionId: null as number | null,
      status: "planning" as string,
      startDate: "", endDate: "", scopeOfWork: "",
      originalContract: 0, currentContract: 0,
      showOnBoard: true,
    };
  }

  onMount(loadJobs);

  async function loadJobs() {
    loading = true;
    const [jobsData, jurData] = await Promise.all([
      api.get(`/jobs${statusFilter ? `?status=${statusFilter}` : ""}`),
      api.get("/jurisdictions"),
    ]);
    jobs = jobsData;
    jurisdictions = jurData;
    loading = false;
  }

  function formatCurrency(n: number) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
  }

  function getJurName(id: number | null) {
    if (!id) return "";
    const j = jurisdictions.find((j: any) => j.id === id);
    return j ? j.name : "";
  }

  async function handleSave() {
    try {
      if (editingJob) {
        await api.put(`/jobs/${editingJob.id}`, form);
      } else {
        await api.post("/jobs", form);
      }
      showAddModal = false;
      editingJob = null;
      form = resetForm();
      await loadJobs();
    } catch (e: any) {
      alert(e.message);
    }
  }

  // Delete confirmation state
  let deleteTarget: any = null;
  let deleteLoading = false;
  let deleteCounts: any = null;

  async function promptDelete(job: any) {
    deleteTarget = job;
    deleteLoading = true;
    deleteCounts = null;
    try {
      deleteCounts = await api.get(`/jobs/${job.id}/delete-check`);
    } catch {
      deleteCounts = null;
    }
    deleteLoading = false;
  }

  function cancelDelete() {
    deleteTarget = null;
    deleteCounts = null;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await api.del(`/jobs/${deleteTarget.id}`);
      deleteTarget = null;
      deleteCounts = null;
      await loadJobs();
    } catch (e: any) {
      alert(e.message);
    }
  }

  function startEdit(job: any) {
    editingJob = job;
    form = {
      jobNumber: job.jobNumber,
      name: job.name,
      address: job.address || "",
      latitude: job.latitude || null,
      longitude: job.longitude || null,
      gcContact: job.gcContact || "",
      jurisdictionId: job.jurisdictionId || null,
      status: job.status,
      startDate: job.startDate || "",
      endDate: job.endDate || "",
      scopeOfWork: job.scopeOfWork || "",
      originalContract: job.originalContract || 0,
      currentContract: job.currentContract || 0,
      showOnBoard: job.showOnBoard !== false,
    };
    showAddModal = true;
  }

  function startAdd() {
    editingJob = null;
    form = resetForm();
    showAddModal = true;
  }

  // Sorting
  let sortCol: string = "jobNumber";
  let sortAsc: boolean = true;

  function toggleSort(col: string) {
    if (sortCol === col) { sortAsc = !sortAsc; }
    else { sortCol = col; sortAsc = true; }
  }

  $: sortedJobs = (() => {
    const dir = sortAsc ? 1 : -1;
    return [...jobs].sort((a, b) => {
      let va: any, vb: any;
      switch (sortCol) {
        case "jobNumber":
          va = a.jobNumber || ""; vb = b.jobNumber || "";
          break;
        case "name":
          va = (a.name || "").toLowerCase(); vb = (b.name || "").toLowerCase();
          break;
        case "status":
          va = a.status || ""; vb = b.status || "";
          break;
        case "jurisdiction":
          va = getJurName(a.jurisdictionId).toLowerCase();
          vb = getJurName(b.jurisdictionId).toLowerCase();
          break;
        case "address":
          va = (a.address || "").toLowerCase(); vb = (b.address || "").toLowerCase();
          break;
        case "contract":
          va = a.currentContract || 0; vb = b.currentContract || 0;
          break;
        case "gc":
          va = (a.gcContact || "").toLowerCase(); vb = (b.gcContact || "").toLowerCase();
          break;
        case "board":
          va = a.showOnBoard === false ? 0 : 1; vb = b.showOnBoard === false ? 0 : 1;
          break;
        default:
          return 0;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  })();

  $: statusColors = {
    planning: "badge-info",
    active: "badge-success",
    completed: "badge-accent",
    closed: "badge-neutral",
  } as Record<string, string>;

  $: canEdit = $user?.role === "super_admin" || $user?.role === "admin" || $user?.role === "pm";
  $: isAdmin = $user?.role === "admin" || $user?.role === "super_admin";
</script>

<div class="space-y-4">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
    <h1 class="page-title">
      Jobs
      <span class="badge badge-sm bg-base-200 text-base-content/60 border-0 ml-1">{jobs.length}</span>
    </h1>
    <div class="flex gap-2">
      <select class="select select-sm select-bordered" bind:value={statusFilter} on:change={loadJobs}>
        <option value="">All Status</option>
        <option value="planning">Planning</option>
        <option value="active">Active</option>
        <option value="completed">Completed</option>
        <option value="closed">Closed</option>
      </select>
      {#if canEdit}
        <button class="btn btn-sm btn-primary" on:click={startAdd}>+ Add Job</button>
      {/if}
    </div>
  </div>

  {#if loading}
    <div class="flex justify-center p-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {:else}
    <!-- Desktop table (hidden on small screens) -->
    <div class="overflow-x-auto apple-panel hidden md:block">
      <table class="table table-sm apple-table">
        <thead>
          <tr>
            <th class="job-sort" on:click={() => toggleSort("jobNumber")}>Job # {#if sortCol === "jobNumber"}<span class="job-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="job-sort" on:click={() => toggleSort("name")}>Name {#if sortCol === "name"}<span class="job-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="job-sort" on:click={() => toggleSort("status")}>Status {#if sortCol === "status"}<span class="job-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="job-sort" on:click={() => toggleSort("jurisdiction")}>Jurisdiction {#if sortCol === "jurisdiction"}<span class="job-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="job-sort" on:click={() => toggleSort("address")}>Address {#if sortCol === "address"}<span class="job-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="job-sort text-center" on:click={() => toggleSort("board")}>Board {#if sortCol === "board"}<span class="job-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            {#if canEdit}<th class="text-right">Actions</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each sortedJobs as job (job.id)}
            <tr class="hover">
              <td class="font-mono text-sm">{job.jobNumber}</td>
              <td class="font-medium max-w-xs truncate">{job.name}</td>
              <td><span class="badge badge-xs {statusColors[job.status] || 'badge-ghost'}">{job.status}</span></td>
              <td class="text-sm">{getJurName(job.jurisdictionId)}</td>
              <td class="text-sm text-base-content/60 max-w-xs truncate">{job.address || ""}</td>
              <td class="text-center">
                {#if job.showOnBoard !== false}<span class="badge badge-xs badge-success">On</span>
                {:else}<span class="badge badge-xs badge-ghost">Off</span>{/if}
              </td>
              {#if canEdit}
                <td class="text-right whitespace-nowrap">
                  <button class="btn btn-xs btn-ghost" on:click={() => startEdit(job)}>Edit</button>
                  {#if isAdmin}<button class="btn btn-xs btn-ghost text-error" on:click={() => promptDelete(job)}>Del</button>{/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Mobile card layout (shown on small screens) -->
    <div class="md:hidden space-y-2">
      {#each sortedJobs as job (job.id)}
        <div class="apple-panel p-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-mono text-sm font-medium">{job.jobNumber}</span>
                <span class="badge badge-xs {statusColors[job.status] || 'badge-ghost'}">{job.status}</span>
                {#if job.showOnBoard !== false}<span class="badge badge-xs badge-success">Board</span>{/if}
              </div>
              <div class="font-medium text-sm truncate">{job.name}</div>
              {#if job.address}<div class="text-xs text-base-content/50 truncate mt-0.5">{job.address}</div>{/if}
              {#if getJurName(job.jurisdictionId)}<div class="text-xs text-base-content/40 mt-0.5">{getJurName(job.jurisdictionId)}</div>{/if}
            </div>
            {#if canEdit}
              <div class="flex items-center gap-1 flex-shrink-0">
                <button class="btn btn-xs btn-ghost" on:click={() => startEdit(job)}>Edit</button>
                {#if isAdmin}<button class="btn btn-xs btn-ghost text-error" on:click={() => promptDelete(job)}>Del</button>{/if}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    {#if jobs.length === 0}
      <div class="text-center p-12 text-base-content/50">No jobs found</div>
    {/if}
  {/if}
</div>

<!-- Add/Edit Job Modal -->
{#if showAddModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-lg jobs-modal">
      <h3 class="font-bold text-lg mb-4">
        {editingJob ? "Edit Job" : "Add Job"}
      </h3>
      <div class="jobs-modal-scroll">
      <form on:submit|preventDefault={handleSave} class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="jobNumber">Job Number</label>
            <input id="jobNumber" class="input input-sm input-bordered" bind:value={form.jobNumber} required />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="jobStatus">Status</label>
            <select id="jobStatus" class="select select-sm select-bordered" bind:value={form.status}>
              <option value="planning">Planning</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="jobName">Job Name</label>
          <input id="jobName" class="input input-sm input-bordered" bind:value={form.name} required />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="jobAddr">Address</label>
            <AddressPicker
              bind:value={form.address}
              bind:latitude={form.latitude}
              bind:longitude={form.longitude}
              placeholder="Start typing a job address..."
              on:select={(e) => { form.latitude = e.detail.latitude; form.longitude = e.detail.longitude; form.address = e.detail.address; }}
            />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="jobGC">GC Contact</label>
            <input id="jobGC" class="input input-sm input-bordered" bind:value={form.gcContact} />
          </div>
        </div>

        {#if form.latitude && form.longitude}
          <div class="job-map-preview">
            <img
              src="/api/maps/static-map?lat={form.latitude}&lng={form.longitude}&zoom=15&size=600x200"
              alt="Job location"
              class="job-map-img"
            />
            <div class="job-map-info">
              <span class="job-map-coords">{form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}</span>
              <span class="job-map-fence">300ft geofence</span>
            </div>
          </div>
        {/if}

        <div class="form-control">
          <label class="label label-text text-xs" for="jobJur">Jurisdiction</label>
          <select id="jobJur" class="select select-sm select-bordered" bind:value={form.jurisdictionId}>
            <option value={null}>— No Jurisdiction —</option>
            {#each jurisdictions as j}
              <option value={j.id}>{j.name}</option>
            {/each}
          </select>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="jobOC">Original Contract</label>
            <input id="jobOC" class="input input-sm input-bordered" type="number" bind:value={form.originalContract} />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="jobCC">Current Contract</label>
            <input id="jobCC" class="input input-sm input-bordered" type="number" bind:value={form.currentContract} />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="jobSD">Start Date</label>
            <input id="jobSD" class="input input-sm input-bordered" type="date" bind:value={form.startDate} />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="jobED">End Date</label>
            <input id="jobED" class="input input-sm input-bordered" type="date" bind:value={form.endDate} />
          </div>
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="jobScope">Scope of Work</label>
          <textarea id="jobScope" class="textarea textarea-bordered textarea-sm" bind:value={form.scopeOfWork}></textarea>
        </div>

        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-3">
            <input type="checkbox" class="checkbox checkbox-sm checkbox-primary" bind:checked={form.showOnBoard} />
            <div>
              <span class="label-text font-medium">Show on Workforce Board</span>
              <span class="label-text-alt block text-base-content/50">Uncheck to hide from the drag-and-drop board</span>
            </div>
          </label>
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-sm btn-ghost" on:click={() => { showAddModal = false; editingJob = null; }}>
            Cancel
          </button>
          <button type="submit" class="btn btn-sm btn-primary">
            {editingJob ? "Save Changes" : "Add Job"}
          </button>
        </div>
      </form>
      </div>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={() => { showAddModal = false; editingJob = null; }}></div>
  </div>
{/if}

<!-- Delete Confirmation Modal -->
{#if deleteTarget}
  <div class="modal modal-open">
    <div class="modal-box max-w-sm">
      <h3 class="font-bold text-lg text-error">Delete Job?</h3>
      <p class="py-2 text-sm">
        You're about to permanently delete
        <span class="font-semibold">#{deleteTarget.jobNumber} — {deleteTarget.name}</span>.
      </p>

      {#if deleteLoading}
        <div class="flex justify-center py-4">
          <span class="loading loading-spinner loading-sm"></span>
        </div>
      {:else if deleteCounts}
        {@const total = deleteCounts.assignments + deleteCounts.costs + deleteCounts.budgets + deleteCounts.actionItems + deleteCounts.subcontracts}
        {#if total > 0}
          <div class="bg-warning/10 border border-warning/30 rounded-lg p-3 my-2 text-sm space-y-1">
            <p class="font-semibold text-warning">This will also delete:</p>
            {#if deleteCounts.assignments > 0}
              <p>• {deleteCounts.assignments} crew assignment{deleteCounts.assignments > 1 ? 's' : ''}</p>
            {/if}
            {#if deleteCounts.costs > 0}
              <p>• {deleteCounts.costs} cost record{deleteCounts.costs > 1 ? 's' : ''}</p>
            {/if}
            {#if deleteCounts.budgets > 0}
              <p>• {deleteCounts.budgets} budget line{deleteCounts.budgets > 1 ? 's' : ''}</p>
            {/if}
            {#if deleteCounts.actionItems > 0}
              <p>• {deleteCounts.actionItems} action item{deleteCounts.actionItems > 1 ? 's' : ''}</p>
            {/if}
            {#if deleteCounts.subcontracts > 0}
              <p>• {deleteCounts.subcontracts} subcontract{deleteCounts.subcontracts > 1 ? 's' : ''}</p>
            {/if}
          </div>
        {:else}
          <p class="text-sm text-base-content/60 my-2">No linked records — safe to delete.</p>
        {/if}
      {/if}

      <p class="text-xs text-base-content/50 mt-2">This cannot be undone.</p>

      <div class="modal-action">
        <button class="btn btn-sm btn-ghost" on:click={cancelDelete}>Cancel</button>
        <button class="btn btn-sm btn-error" on:click={confirmDelete} disabled={deleteLoading}>
          Delete Job
        </button>
      </div>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={cancelDelete}></div>
  </div>
{/if}

<style>
  .job-map-preview {
    border-radius: 12px; overflow: hidden; border: 1px solid #e5e5ea;
    margin: 4px 0 8px;
  }
  .job-map-img { width: 100%; height: 160px; object-fit: cover; display: block; }
  .job-map-info {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 10px; background: #f9f9fb;
  }
  .job-map-coords { font-size: 0.6875rem; color: #86868b; font-family: monospace; }
  .job-map-fence { font-size: 0.6875rem; color: #34c759; font-weight: 500; }

  .job-sort {
    cursor: pointer;
    user-select: none;
    transition: color 0.15s;
  }
  .job-sort:hover {
    color: #1d1d1f;
  }
  .job-arrow {
    display: inline-block;
    font-size: 0.625rem;
    margin-left: 2px;
    opacity: 0.5;
  }


  /* Modal: visible overflow so dropdown escapes, inner div scrolls instead */
  :global(.modal-box.jobs-modal) {
    overflow: visible !important;
    max-height: calc(100vh - 5em);
    display: flex;
    flex-direction: column;
  }
  .jobs-modal-scroll {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
</style>
