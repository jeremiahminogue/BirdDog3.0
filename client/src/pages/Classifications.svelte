<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  interface Classification {
    id: number;
    name: string;
    department: string | null;
    classificationGroup: string | null;
    hasLicense: boolean;
    color: string;
  }

  let classifications: Classification[] = [];
  let loading = true;
  let error = "";

  // Edit / Add state
  let showModal = false;
  let editing: Partial<Classification> = {};
  let isNew = false;
  let saving = false;

  // Filter
  let filterDept = "";

  // Sorting
  let sortCol: string = "name";
  let sortAsc: boolean = true;

  function toggleSort(col: string) {
    if (sortCol === col) { sortAsc = !sortAsc; }
    else { sortCol = col; sortAsc = true; }
  }

  $: departments = [...new Set(classifications.map(c => c.department).filter(Boolean))].sort();
  $: filtered = filterDept
    ? classifications.filter(c => c.department === filterDept)
    : classifications;

  $: sortedClassifications = (() => {
    const dir = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let va: any, vb: any;
      switch (sortCol) {
        case "name":
          va = (a.name || "").toLowerCase(); vb = (b.name || "").toLowerCase();
          break;
        case "department":
          va = (a.department || "").toLowerCase(); vb = (b.department || "").toLowerCase();
          break;
        case "group":
          va = (a.classificationGroup || "").toLowerCase(); vb = (b.classificationGroup || "").toLowerCase();
          break;
        default:
          return 0;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  })();

  onMount(loadData);

  async function loadData() {
    try {
      classifications = await api.get("/classifications");
    } catch (e: any) {
      error = e.message;
    }
    loading = false;
  }

  function openAdd() {
    editing = { name: "", department: "", classificationGroup: "", color: "#3b82f6", hasLicense: false };
    isNew = true;
    showModal = true;
  }

  function openEdit(c: Classification) {
    editing = { ...c };
    isNew = false;
    showModal = true;
  }

  async function handleSave() {
    saving = true;
    try {
      if (isNew) {
        await api.post("/classifications", editing);
      } else {
        await api.put(`/classifications/${editing.id}`, editing);
      }
      showModal = false;
      loading = true;
      await loadData();
    } catch (e: any) {
      error = e.message;
    }
    saving = false;
  }

  function canEdit(): boolean {
    return $user?.role === "super_admin" || $user?.role === "admin" || $user?.role === "pm";
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 class="page-title">Classifications & Rates</h2>
    <div class="flex gap-2">
      <select class="select select-bordered select-sm" bind:value={filterDept}>
        <option value="">All Departments</option>
        {#each departments as dept}
          <option value={dept}>{dept}</option>
        {/each}
      </select>
      {#if canEdit()}
        <button class="btn btn-primary btn-sm" on:click={openAdd}>+ Add</button>
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
  {:else}
    <div class="overflow-x-auto apple-panel">
      <table class="table table-sm apple-table">
        <thead>
          <tr>
            <th>Color</th>
            <th class="cls-sort" on:click={() => toggleSort("name")}>Classification {#if sortCol === "name"}<span class="cls-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="cls-sort" on:click={() => toggleSort("department")}>Department {#if sortCol === "department"}<span class="cls-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="cls-sort" on:click={() => toggleSort("group")}>Group {#if sortCol === "group"}<span class="cls-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th>Licensed</th>
            {#if canEdit()}
              <th class="text-center">Edit</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each sortedClassifications as c (c.id)}
            <tr class="hover">
              <td>
                <div class="w-4 h-4 rounded-full border border-base-300" style="background-color: {c.color}"></div>
              </td>
              <td class="font-medium">{c.name}</td>
              <td>
                <span class="badge badge-sm badge-ghost">{c.department || "—"}</span>
              </td>
              <td>
                <span class="badge badge-sm badge-ghost">{c.classificationGroup || "—"}</span>
              </td>
              <td>
                {#if c.hasLicense}
                  <span class="badge badge-sm badge-success gap-1">Yes</span>
                {:else}
                  <span class="badge badge-sm badge-ghost">No</span>
                {/if}
              </td>
              {#if canEdit()}
                <td class="text-center">
                  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                  <button class="btn btn-xs btn-ghost" on:click={() => openEdit(c)}>Edit</button>
                </td>
              {/if}
            </tr>
          {:else}
            <tr><td colspan="6" class="text-center py-8 text-base-content/50">No classifications found</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="text-sm text-base-content/50 text-right">
      {filtered.length} classification{filtered.length === 1 ? "" : "s"}
    </div>
  {/if}
</div>

<!-- Add/Edit Modal -->
{#if showModal}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="modal modal-open" on:click|self={() => (showModal = false)}>
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{isNew ? "Add Classification" : "Edit Classification"}</h3>
      <form on:submit|preventDefault={handleSave} class="space-y-3">
        <div class="form-control">
          <label class="label" for="cls-name"><span class="label-text">Name</span></label>
          <input id="cls-name" type="text" class="input input-bordered" bind:value={editing.name} required />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label" for="cls-dept"><span class="label-text">Department</span></label>
            <input id="cls-dept" type="text" class="input input-bordered" bind:value={editing.department} placeholder="Electrical, Low Voltage, etc." />
          </div>
          <div class="form-control">
            <label class="label" for="cls-group"><span class="label-text">Classification Group</span></label>
            <input id="cls-group" type="text" class="input input-bordered" bind:value={editing.classificationGroup} placeholder="CW, Apprentice, JW, etc." />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label" for="cls-color"><span class="label-text">Color</span></label>
            <input id="cls-color" type="color" class="input input-bordered h-10 p-1" bind:value={editing.color} />
          </div>
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3" for="cls-license">
              <input id="cls-license" type="checkbox" class="checkbox checkbox-primary" bind:checked={editing.hasLicense} />
              <span class="label-text">Licensed</span>
            </label>
          </div>
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" on:click={() => (showModal = false)}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={saving}>
            {#if saving}<span class="loading loading-spinner loading-sm"></span>{/if}
            {isNew ? "Add" : "Save"}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .cls-sort {
    cursor: pointer;
    user-select: none;
    transition: color 0.15s;
  }
  .cls-sort:hover {
    color: #1d1d1f;
  }
  .cls-arrow {
    display: inline-block;
    font-size: 0.625rem;
    margin-left: 2px;
    opacity: 0.5;
  }
</style>
