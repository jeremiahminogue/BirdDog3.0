<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  interface Jurisdiction { id: number; name: string; description: string | null; }
  interface Classification { id: number; name: string; department: string | null; color: string; }
  interface JurisdictionRate {
    id: number; jurisdictionId: number; classificationId: number;
    hourlyRate: number; totalCostRate: number; effectiveDate: string | null;
    classificationName: string; department: string; classificationColor: string;
  }

  let jurisdictions: Jurisdiction[] = [];
  let classifications: Classification[] = [];
  let loading = true;
  let error = "";

  // Selected jurisdiction
  let selectedId: number | null = null;
  let rates: JurisdictionRate[] = [];
  let loadingRates = false;

  // Jurisdiction modal
  let showJurModal = false;
  let jurEditing: Partial<Jurisdiction> = {};
  let isNewJur = false;
  let saving = false;

  // Rate editing
  let editingRates: { classificationId: number; classificationName: string; department: string; color: string; hourlyRate: number; totalCostRate: number; }[] = [];
  let showRateEditor = false;
  let savingRates = false;

  // Delete confirm
  let showDeleteConfirm = false;
  let deleting = false;

  $: selected = jurisdictions.find(j => j.id === selectedId) || null;

  onMount(loadData);

  async function loadData() {
    try {
      [jurisdictions, classifications] = await Promise.all([
        api.get("/jurisdictions"),
        api.get("/classifications"),
      ]);
      if (jurisdictions.length > 0 && !selectedId) {
        selectedId = jurisdictions[0].id;
        await loadRates();
      }
    } catch (e: any) { error = e.message; }
    loading = false;
  }

  async function loadRates() {
    if (!selectedId) return;
    loadingRates = true;
    try {
      rates = await api.get(`/jurisdictions/${selectedId}/rates`);
    } catch (e: any) { error = e.message; }
    loadingRates = false;
  }

  async function selectJurisdiction(id: number) {
    selectedId = id;
    await loadRates();
  }

  function openAddJur() {
    jurEditing = { name: "", description: "" };
    isNewJur = true;
    showJurModal = true;
  }

  function openEditJur(j: Jurisdiction) {
    jurEditing = { ...j };
    isNewJur = false;
    showJurModal = true;
  }

  async function saveJur() {
    saving = true;
    try {
      if (isNewJur) {
        const j = await api.post("/jurisdictions", jurEditing);
        selectedId = j.id;
      } else {
        await api.put(`/jurisdictions/${jurEditing.id}`, jurEditing);
      }
      showJurModal = false;
      loading = true;
      await loadData();
    } catch (e: any) { error = e.message; }
    saving = false;
  }

  function openRateEditor() {
    // Build rate rows for every classification, pre-filled with existing rates
    editingRates = classifications.map(c => {
      const existing = rates.find(r => r.classificationId === c.id);
      return {
        classificationId: c.id,
        classificationName: c.name,
        department: c.department || "",
        color: c.color || "#3b82f6",
        hourlyRate: existing?.hourlyRate ?? 0,
        totalCostRate: existing?.totalCostRate ?? 0,
      };
    });
    showRateEditor = true;
  }

  async function saveRates() {
    if (!selectedId) return;
    savingRates = true;
    try {
      await api.post(`/jurisdictions/${selectedId}/rates/bulk`, {
        rates: editingRates.filter(r => r.hourlyRate > 0 || r.totalCostRate > 0),
      });
      showRateEditor = false;
      await loadRates();
    } catch (e: any) { error = e.message; }
    savingRates = false;
  }

  function formatCurrency(val: number | null | undefined) {
    if (val == null || val === 0) return "—";
    return `$${val.toFixed(2)}`;
  }

  function confirmDeleteJur() {
    if (!selected) return;
    showDeleteConfirm = true;
  }

  async function handleDeleteJur() {
    if (!selected) return;
    deleting = true;
    try {
      await api.del(`/jurisdictions/${selected.id}`);
      selectedId = null;
      rates = [];
      showDeleteConfirm = false;
      loading = true;
      await loadData();
    } catch (e: any) { error = e.message; }
    deleting = false;
  }

  function canEdit(): boolean {
    return $user?.role === "super_admin" || $user?.role === "admin" || $user?.role === "pm";
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 class="page-title">Jurisdictions & Rates</h2>
    {#if canEdit()}
      <button class="btn btn-primary btn-sm" on:click={openAddJur}>+ Add Jurisdiction</button>
    {/if}
  </div>

  {#if error}
    <div class="alert alert-error text-sm"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {:else}
    <div class="flex flex-col lg:flex-row gap-4">
      <!-- Jurisdiction list (left sidebar) -->
      <div class="lg:w-64 shrink-0">
        <div class="apple-panel p-3 space-y-1">
          <p class="text-xs font-semibold uppercase text-base-content/50 px-2 mb-2">Jurisdictions</p>
          {#each jurisdictions as j (j.id)}
            <button
              class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors {selectedId === j.id ? 'bg-primary text-primary-content font-medium' : 'hover:bg-base-200'}"
              on:click={() => selectJurisdiction(j.id)}
            >
              {j.name}
              {#if j.description}
                <span class="block text-xs opacity-70">{j.description}</span>
              {/if}
            </button>
          {:else}
            <p class="text-sm text-base-content/50 px-2 py-4">No jurisdictions yet</p>
          {/each}
        </div>
      </div>

      <!-- Rates table (right) -->
      <div class="flex-1 min-w-0">
        {#if selected}
          <div class="apple-panel">
            <div class="flex items-center justify-between p-4 border-b border-base-300">
              <div>
                <h3 class="text-lg font-bold">{selected.name}</h3>
                {#if selected.description}
                  <p class="text-sm text-base-content/60">{selected.description}</p>
                {/if}
              </div>
              <div class="flex gap-2">
                {#if canEdit()}
                  <button class="btn btn-sm btn-ghost" on:click={() => openEditJur(selected)}>Edit</button>
                  <button class="btn btn-sm btn-accent" on:click={openRateEditor}>Set Rates</button>
                  <button class="btn btn-sm btn-ghost text-error" on:click={confirmDeleteJur}>Delete</button>
                {/if}
              </div>
            </div>

            {#if loadingRates}
              <div class="flex justify-center py-8">
                <span class="loading loading-spinner loading-md text-primary"></span>
              </div>
            {:else if rates.length === 0}
              <div class="text-center py-8 text-base-content/50">
                <p>No rates set for this jurisdiction yet.</p>
                {#if canEdit()}
                  <button class="btn btn-sm btn-primary mt-2" on:click={openRateEditor}>Set Rates</button>
                {/if}
              </div>
            {:else}
              <div class="overflow-x-auto">
                <table class="table table-sm apple-table">
                  <thead>
                    <tr>
                      <th>Color</th>
                      <th>Classification</th>
                      <th>Department</th>
                      <th class="text-right">Hourly Rate</th>
                      <th class="text-right">Total Cost Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each rates as r (r.id)}
                      <tr class="hover">
                        <td>
                          <div class="w-4 h-4 rounded-full border border-base-300" style="background-color: {r.classificationColor}"></div>
                        </td>
                        <td class="font-medium">{r.classificationName}</td>
                        <td><span class="badge badge-sm badge-ghost">{r.department || "—"}</span></td>
                        <td class="text-right font-mono">{formatCurrency(r.hourlyRate)}</td>
                        <td class="text-right font-mono">{formatCurrency(r.totalCostRate)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>
        {:else}
          <div class="apple-panel p-8 text-center text-base-content/50">
            Select a jurisdiction to view its rates
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Add/Edit Jurisdiction Modal -->
{#if showJurModal}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="modal modal-open" on:click|self={() => (showJurModal = false)}>
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{isNewJur ? "Add Jurisdiction" : "Edit Jurisdiction"}</h3>
      <form on:submit|preventDefault={saveJur} class="space-y-3">
        <div class="form-control">
          <label class="label" for="jur-name"><span class="label-text">Name</span></label>
          <input id="jur-name" type="text" class="input input-bordered" bind:value={jurEditing.name} required placeholder="e.g. Pueblo County, IBEW Local 113" />
        </div>
        <div class="form-control">
          <label class="label" for="jur-desc"><span class="label-text">Description</span></label>
          <input id="jur-desc" type="text" class="input input-bordered" bind:value={jurEditing.description} placeholder="Optional" />
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" on:click={() => (showJurModal = false)}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={saving}>
            {#if saving}<span class="loading loading-spinner loading-sm"></span>{/if}
            {isNewJur ? "Add" : "Save"}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Bulk Rate Editor Modal -->
{#if showRateEditor}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="modal modal-open" on:click|self={() => (showRateEditor = false)}>
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-lg mb-1">Set Rates — {selected?.name}</h3>
      <p class="text-sm text-base-content/60 mb-4">Enter hourly rate and total cost rate for each classification in this jurisdiction.</p>
      <form on:submit|preventDefault={saveRates}>
        <div class="overflow-y-auto max-h-[60vh]">
          <table class="table table-sm">
            <thead class="sticky top-0 bg-base-100">
              <tr>
                <th>Classification</th>
                <th>Dept</th>
                <th class="text-right">Hourly Rate</th>
                <th class="text-right">Total Cost Rate</th>
              </tr>
            </thead>
            <tbody>
              {#each editingRates as r, i}
                <tr>
                  <td>
                    <div class="flex items-center gap-2">
                      <div class="w-3 h-3 rounded-full" style="background-color: {r.color}"></div>
                      <span class="text-sm font-medium">{r.classificationName}</span>
                    </div>
                  </td>
                  <td><span class="text-xs text-base-content/60">{r.department}</span></td>
                  <td>
                    <input type="number" step="0.01" min="0" class="input input-bordered input-sm w-28 text-right font-mono" bind:value={editingRates[i].hourlyRate} />
                  </td>
                  <td>
                    <input type="number" step="0.01" min="0" class="input input-bordered input-sm w-28 text-right font-mono" bind:value={editingRates[i].totalCostRate} />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" on:click={() => (showRateEditor = false)}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={savingRates}>
            {#if savingRates}<span class="loading loading-spinner loading-sm"></span>{/if}
            Save All Rates
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Delete Confirm Modal -->
{#if showDeleteConfirm && selected}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="modal modal-open" on:click|self={() => (showDeleteConfirm = false)}>
    <div class="modal-box max-w-sm">
      <h3 class="font-bold text-lg text-error mb-2">Delete Jurisdiction</h3>
      <p class="text-sm text-base-content/70 mb-1">
        Are you sure you want to delete <strong>{selected.name}</strong>?
      </p>
      <p class="text-sm text-base-content/50 mb-4">
        This will permanently remove this jurisdiction and all {rates.length} associated rate{rates.length !== 1 ? "s" : ""}. This cannot be undone.
      </p>
      <div class="modal-action">
        <button class="btn btn-ghost btn-sm" on:click={() => (showDeleteConfirm = false)}>Cancel</button>
        <button class="btn btn-error btn-sm" on:click={handleDeleteJur} disabled={deleting}>
          {#if deleting}<span class="loading loading-spinner loading-sm"></span>{/if}
          Delete Permanently
        </button>
      </div>
    </div>
  </div>
{/if}
