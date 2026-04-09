<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  interface JobCode {
    id: number;
    code: string;
    description: string;
    isActive: boolean;
    sortOrder: number;
  }

  let jobCodes: JobCode[] = [];
  let loading = true;
  let error = "";

  // Edit / Add state
  let showModal = false;
  let editing: Partial<JobCode> = {};
  let isNew = false;
  let saving = false;
  let showInactive = false;

  $: filtered = showInactive ? jobCodes : jobCodes.filter(c => c.isActive !== false);

  $: sorted = [...filtered].sort((a, b) => {
    if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    return a.code.localeCompare(b.code);
  });

  onMount(loadData);

  async function loadData() {
    try {
      jobCodes = await api.get("/job-codes");
    } catch (e: any) {
      error = e.message;
    }
    loading = false;
  }

  function openAdd() {
    editing = { code: "", description: "", sortOrder: jobCodes.length, isActive: true };
    isNew = true;
    showModal = true;
  }

  function openEdit(c: JobCode) {
    editing = { ...c };
    isNew = false;
    showModal = true;
  }

  async function handleSave() {
    if (!editing.code?.trim() || !editing.description?.trim()) {
      error = "Code and description are required";
      return;
    }
    saving = true;
    try {
      if (isNew) {
        await api.post("/job-codes", editing);
      } else {
        await api.put(`/job-codes/${editing.id}`, editing);
      }
      showModal = false;
      loading = true;
      error = "";
      await loadData();
    } catch (e: any) {
      error = e.message;
    }
    saving = false;
  }

  async function handleDelete(c: JobCode) {
    if (!confirm(`Delete job code "${c.code} — ${c.description}"?\n\nExisting time entries using this code will keep their data but will show no code.`)) return;
    try {
      await api.delete(`/job-codes/${c.id}`);
      loading = true;
      await loadData();
    } catch (e: any) {
      error = e.message;
    }
  }

  async function toggleActive(c: JobCode) {
    try {
      await api.put(`/job-codes/${c.id}`, { ...c, isActive: !c.isActive });
      loading = true;
      await loadData();
    } catch (e: any) {
      error = e.message;
    }
  }

  function canEdit(): boolean {
    return $user?.role === "super_admin" || $user?.role === "admin" || $user?.role === "pm";
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 class="page-title">Job Codes</h2>
      <p class="text-sm text-base-content/50 mt-1">Work type categories — field crew selects a code when clocking in</p>
    </div>
    <div class="flex gap-2 items-center">
      <label class="label cursor-pointer gap-2 text-xs">
        <input type="checkbox" class="toggle toggle-xs" bind:checked={showInactive} />
        <span class="text-base-content/60">Show inactive</span>
      </label>
      {#if canEdit()}
        <button class="btn btn-primary btn-sm" on:click={openAdd}>+ Add Code</button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="alert alert-error text-sm"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {:else if sorted.length === 0}
    <div class="text-center py-16 text-base-content/40">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
      </svg>
      <p class="text-sm font-medium mb-1">No job codes yet</p>
      <p class="text-xs">Add codes like "Rough-In", "Trim", "Service" to track what type of work your crew is doing</p>
      {#if canEdit()}
        <button class="btn btn-primary btn-sm mt-4" on:click={openAdd}>+ Add First Code</button>
      {/if}
    </div>
  {:else}
    <div class="overflow-x-auto apple-panel">
      <table class="table table-sm apple-table">
        <thead>
          <tr>
            <th class="w-12">#</th>
            <th>Code</th>
            <th>Description</th>
            <th class="w-20 text-center">Status</th>
            {#if canEdit()}
              <th class="w-32 text-right">Actions</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each sorted as c, i}
            <tr class:opacity-40={!c.isActive}>
              <td class="text-base-content/30 text-xs">{i + 1}</td>
              <td>
                <span class="font-mono font-semibold text-sm">{c.code}</span>
              </td>
              <td>{c.description}</td>
              <td class="text-center">
                {#if c.isActive}
                  <span class="badge badge-sm badge-success badge-outline">Active</span>
                {:else}
                  <span class="badge badge-sm badge-ghost">Inactive</span>
                {/if}
              </td>
              {#if canEdit()}
                <td class="text-right">
                  <div class="flex justify-end gap-1">
                    <button class="btn btn-ghost btn-xs" on:click={() => openEdit(c)} title="Edit">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button class="btn btn-ghost btn-xs" on:click={() => toggleActive(c)} title={c.isActive ? "Deactivate" : "Activate"}>
                      {#if c.isActive}
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                      {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                      {/if}
                    </button>
                    <button class="btn btn-ghost btn-xs text-error" on:click={() => handleDelete(c)} title="Delete">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Edit/Add Modal -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-md">
      <h3 class="font-bold text-lg">{isNew ? "Add Job Code" : "Edit Job Code"}</h3>
      <div class="space-y-4 mt-4">
        <div class="form-control">
          <label class="label"><span class="label-text font-medium">Code</span></label>
          <input
            type="text"
            class="input input-bordered input-sm"
            placeholder="e.g. RGH"
            bind:value={editing.code}
            maxlength="10"
            style="text-transform: uppercase"
          />
          <label class="label"><span class="label-text-alt text-base-content/40">Short abbreviation (max 10 characters)</span></label>
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text font-medium">Description</span></label>
          <input
            type="text"
            class="input input-bordered input-sm"
            placeholder="e.g. Rough-In"
            bind:value={editing.description}
          />
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text font-medium">Sort Order</span></label>
          <input
            type="number"
            class="input input-bordered input-sm w-24"
            bind:value={editing.sortOrder}
            min="0"
          />
          <label class="label"><span class="label-text-alt text-base-content/40">Lower numbers appear first in the mobile picker</span></label>
        </div>
        {#if !isNew}
          <label class="label cursor-pointer justify-start gap-3">
            <input type="checkbox" class="toggle toggle-sm toggle-success" bind:checked={editing.isActive} />
            <span class="label-text">{editing.isActive ? "Active" : "Inactive"} — {editing.isActive ? "visible to field crew" : "hidden from field crew"}</span>
          </label>
        {/if}
      </div>
      <div class="modal-action">
        <button class="btn btn-ghost btn-sm" on:click={() => showModal = false}>Cancel</button>
        <button class="btn btn-primary btn-sm" on:click={handleSave} disabled={saving}>
          {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
          {isNew ? "Add" : "Save"}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" on:click={() => showModal = false}></div>
  </div>
{/if}
