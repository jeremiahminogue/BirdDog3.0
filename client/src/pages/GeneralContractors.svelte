<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  interface GC {
    id: number;
    name: string;
    phone: string | null;
    website: string | null;
    notes: string | null;
    sort_order: number;
  }

  let items: GC[] = [];
  let loading = true;
  let error = "";

  // Add form
  let newName = "";
  let newPhone = "";
  let newWebsite = "";
  let newNotes = "";
  let adding = false;

  // Sort
  type SortKey = "name" | "phone" | "website" | "notes" | "sort_order";
  let sortKey: SortKey = "sort_order";
  let sortAsc = true;

  $: sortedItems = [...items].sort((a, b) => {
    if (sortKey === "sort_order") return sortAsc ? a.sort_order - b.sort_order : b.sort_order - a.sort_order;
    const aVal = (a[sortKey] || "").toLowerCase();
    const bVal = (b[sortKey] || "").toLowerCase();
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) sortAsc = !sortAsc;
    else { sortKey = key; sortAsc = true; }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortAsc ? " ▲" : " ▼";
  }

  // Selection
  let selected: Set<number> = new Set();
  $: allSelected = items.length > 0 && selected.size === items.length;

  // Confirm delete
  let confirmDeleteIds: number[] = [];
  let deleteErrors: string[] = [];
  let deleting = false;

  // Drag
  let dragIdx: number | null = null;
  let dragOverIdx: number | null = null;
  $: dragEnabled = sortKey === "sort_order";

  $: isAdmin = $user?.role === "admin" || $user?.role === "super_admin";
  $: canEdit = isAdmin || $user?.role === "pm";

  onMount(load);

  async function load() {
    loading = true;
    try {
      items = await api.get("/opportunities/gc-companies");
    } catch (e: any) { error = e.message; }
    loading = false;
  }

  async function addItem() {
    if (!newName.trim()) return;
    adding = true;
    try {
      await api.post("/opportunities/gc-companies", {
        name: newName.trim(),
        phone: newPhone.trim() || null,
        website: newWebsite.trim() || null,
        notes: newNotes.trim() || null,
      });
      newName = ""; newPhone = ""; newWebsite = ""; newNotes = "";
      await load();
    } catch (e: any) { error = e.message; }
    adding = false;
  }

  async function saveField(item: GC, field: string, value: string | null) {
    try {
      await api.put(`/opportunities/gc-companies/${item.id}`, {
        name: field === "name" ? value : item.name,
        phone: field === "phone" ? value : item.phone,
        website: field === "website" ? value : item.website,
        notes: field === "notes" ? value : item.notes,
      });
      items = items.map(i => i.id === item.id ? { ...i, [field]: value } : i);
    } catch (e: any) { error = e.message; }
  }

  function toggleSelect(id: number) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    selected = selected;
  }

  function toggleAll() {
    if (allSelected) selected = new Set();
    else selected = new Set(items.map(i => i.id));
  }

  function requestDelete() {
    confirmDeleteIds = [...selected];
    deleteErrors = [];
  }

  async function confirmBatchDelete() {
    deleting = true;
    try {
      const res = await api.post("/opportunities/gc-companies/batch-delete", { ids: confirmDeleteIds });
      deleteErrors = res.errors || [];
      if (res.deleted?.length) {
        selected = new Set([...selected].filter(id => !res.deleted.includes(id)));
        await load();
      }
      if (deleteErrors.length === 0) confirmDeleteIds = [];
    } catch (e: any) { error = e.message; confirmDeleteIds = []; }
    deleting = false;
  }

  function cancelDelete() { confirmDeleteIds = []; deleteErrors = []; }

  // Drag to reorder (only when sorted by sort_order)
  function onDragStart(e: DragEvent, idx: number) {
    if (!dragEnabled) return;
    dragIdx = idx;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(e: DragEvent, idx: number) {
    if (!dragEnabled) return;
    e.preventDefault();
    dragOverIdx = idx;
  }
  function onDragLeave() { dragOverIdx = null; }
  async function onDrop(e: DragEvent, idx: number) {
    e.preventDefault();
    dragOverIdx = null;
    if (!dragEnabled || dragIdx === null || dragIdx === idx) return;
    const moved = items.splice(dragIdx, 1)[0];
    items.splice(idx, 0, moved);
    items = items;
    dragIdx = null;
    const order = items.map((item, i) => ({ id: item.id, sortOrder: i }));
    try { await api.put("/opportunities/gc-companies/reorder", { order }); }
    catch (e: any) { error = e.message; await load(); }
  }
  function onDragEnd() { dragIdx = null; dragOverIdx = null; }

  function formatPhone(p: string): string {
    const d = p.replace(/\D/g, "");
    if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    if (d.length === 11 && d[0] === "1") return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
    return p;
  }
</script>

<div class="rl-page">
  <div class="rl-header">
    <h1 class="rl-title">General Contractors</h1>
    <span class="rl-count">{items.length} total</span>
  </div>

  {#if error}
    <div class="rl-error">{error} <button class="rl-error-close" on:click={() => error = ""}>dismiss</button></div>
  {/if}

  {#if selected.size > 0 && isAdmin}
    <div class="rl-batch-bar">
      <span class="rl-batch-count">{selected.size} selected</span>
      {#if confirmDeleteIds.length === 0}
        <button class="rl-btn rl-btn-danger" on:click={requestDelete}>Delete Selected</button>
      {/if}
      <button class="rl-btn rl-btn-ghost" on:click={() => { selected = new Set(); }}>Clear Selection</button>
    </div>
  {/if}

  {#if confirmDeleteIds.length > 0}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="rl-confirm-backdrop" on:click={cancelDelete}>
      <div class="rl-confirm-modal" on:click|stopPropagation>
        <h3 class="rl-confirm-title">Delete {confirmDeleteIds.length} general contractor{confirmDeleteIds.length > 1 ? 's' : ''}?</h3>
        <p class="rl-confirm-text">This cannot be undone. GCs linked to opportunities cannot be deleted.</p>
        {#if deleteErrors.length > 0}
          <div class="rl-confirm-errors">
            {#each deleteErrors as err}
              <div class="rl-confirm-err-item">{err}</div>
            {/each}
          </div>
        {/if}
        <div class="rl-confirm-actions">
          <button class="rl-btn rl-btn-ghost" on:click={cancelDelete}>Cancel</button>
          <button class="rl-btn rl-btn-danger" on:click={confirmBatchDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Yes, Delete'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="rl-loading">Loading...</div>
  {:else}
    <div class="rl-table-wrap">
      <table class="rl-table">
        <thead>
          <tr>
            {#if isAdmin}<th class="rl-th-check"><button class="rl-check-all" on:click={toggleAll}>{allSelected ? '☑' : '☐'}</button></th>{/if}
            <th class="rl-th-grip"></th>
            <th class="rl-th-name rl-th-sort" on:click={() => toggleSort('name')}>Name{sortIndicator('name')}</th>
            <th class="rl-th-phone rl-th-sort" on:click={() => toggleSort('phone')}>Phone{sortIndicator('phone')}</th>
            <th class="rl-th-website rl-th-sort" on:click={() => toggleSort('website')}>Website{sortIndicator('website')}</th>
            <th class="rl-th-notes rl-th-sort" on:click={() => toggleSort('notes')}>Notes{sortIndicator('notes')}</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedItems as item, idx (item.id)}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <tr
              class="rl-row"
              class:rl-row-selected={selected.has(item.id)}
              class:rl-row-dragging={dragIdx === idx}
              class:rl-row-dragover={dragOverIdx === idx}
              draggable={canEdit && dragEnabled}
              on:dragstart={(e) => onDragStart(e, idx)}
              on:dragover={(e) => onDragOver(e, idx)}
              on:dragleave={onDragLeave}
              on:drop={(e) => onDrop(e, idx)}
              on:dragend={onDragEnd}
            >
              {#if isAdmin}
                <td class="rl-td-check">
                  <button class="rl-check-btn" on:click={() => toggleSelect(item.id)}>
                    {selected.has(item.id) ? '☑' : '☐'}
                  </button>
                </td>
              {/if}
              <td class="rl-td-grip">
                {#if canEdit && dragEnabled}<span class="rl-grip">⠿</span>{/if}
              </td>
              <td class="rl-td-name">
                {#if canEdit}
                  <input class="rl-inline" type="text" value={item.name}
                    on:blur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== item.name) saveField(item, 'name', v); else e.currentTarget.value = item.name; }} />
                {:else}
                  <span>{item.name}</span>
                {/if}
              </td>
              <td class="rl-td-phone">
                {#if canEdit}
                  <input class="rl-inline" type="tel" value={item.phone || ''}
                    placeholder="phone"
                    on:blur={(e) => { const v = e.currentTarget.value.trim() || null; if (v !== item.phone) saveField(item, 'phone', v); }} />
                {:else}
                  {#if item.phone}<a href="tel:{item.phone}" class="rl-link">{formatPhone(item.phone)}</a>{:else}<span class="rl-empty">—</span>{/if}
                {/if}
              </td>
              <td class="rl-td-website">
                {#if canEdit}
                  <input class="rl-inline" type="text" value={item.website || ''}
                    placeholder="website"
                    on:blur={(e) => { const v = e.currentTarget.value.trim() || null; if (v !== item.website) saveField(item, 'website', v); }} />
                {:else}
                  {#if item.website}<a href={item.website.startsWith('http') ? item.website : 'https://' + item.website} target="_blank" class="rl-link">{item.website}</a>{:else}<span class="rl-empty">—</span>{/if}
                {/if}
              </td>
              <td class="rl-td-notes">
                {#if canEdit}
                  <input class="rl-inline" type="text" value={item.notes || ''}
                    placeholder="notes"
                    on:blur={(e) => { const v = e.currentTarget.value.trim() || null; if (v !== item.notes) saveField(item, 'notes', v); }} />
                {:else}
                  <span class={item.notes ? '' : 'rl-empty'}>{item.notes || '—'}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if items.length === 0}
      <div class="rl-empty-state">No general contractors yet. Add one below.</div>
    {/if}

    {#if canEdit}
      <div class="rl-add-bar">
        <input class="rl-add-input rl-add-name" type="text" bind:value={newName} placeholder="Company name" on:keydown={(e) => { if (e.key === 'Enter') addItem(); }} />
        <input class="rl-add-input rl-add-phone" type="tel" bind:value={newPhone} placeholder="Phone" on:keydown={(e) => { if (e.key === 'Enter') addItem(); }} />
        <input class="rl-add-input rl-add-web" type="text" bind:value={newWebsite} placeholder="Website" on:keydown={(e) => { if (e.key === 'Enter') addItem(); }} />
        <input class="rl-add-input rl-add-notes" type="text" bind:value={newNotes} placeholder="Notes" on:keydown={(e) => { if (e.key === 'Enter') addItem(); }} />
        <button class="rl-btn rl-btn-primary" on:click={addItem} disabled={adding || !newName.trim()}>
          {adding ? 'Adding...' : 'Add GC'}
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .rl-page { max-width: 100%; }
  .rl-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; }
  .rl-title { font-size: 22px; font-weight: 700; color: #1d1d1f; letter-spacing: -0.02em; }
  .rl-count { font-size: 13px; color: #86868b; font-weight: 500; }

  .rl-error {
    padding: 8px 14px; margin-bottom: 12px; border-radius: 10px;
    background: oklch(var(--er) / 0.08); color: oklch(var(--er));
    font-size: 13px; display: flex; align-items: center; justify-content: space-between;
  }
  .rl-error-close { border: none; background: none; cursor: pointer; color: oklch(var(--er)); font-weight: 600; font-size: 12px; }
  .rl-loading { text-align: center; padding: 60px; color: #86868b; font-size: 14px; }

  .rl-batch-bar {
    display: flex; align-items: center; gap: 10px; padding: 8px 14px; margin-bottom: 12px;
    background: oklch(var(--p) / 0.06); border-radius: 10px;
  }
  .rl-batch-count { font-size: 13px; font-weight: 600; color: oklch(var(--p)); flex: 1; }

  .rl-btn {
    padding: 6px 14px; border: none; border-radius: 8px; font-size: 12px;
    font-weight: 600; cursor: pointer; transition: all 0.15s; white-space: nowrap;
  }
  .rl-btn-primary { background: oklch(var(--p)); color: white; }
  .rl-btn-primary:hover { filter: brightness(1.1); }
  .rl-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .rl-btn-danger { background: oklch(var(--er) / 0.12); color: oklch(var(--er)); }
  .rl-btn-danger:hover { background: oklch(var(--er) / 0.2); }
  .rl-btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
  .rl-btn-ghost { background: oklch(var(--bc) / 0.06); color: oklch(var(--bc) / 0.5); }
  .rl-btn-ghost:hover { background: oklch(var(--bc) / 0.1); }

  .rl-confirm-backdrop {
    position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.3);
    display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);
  }
  .rl-confirm-modal {
    background: white; border-radius: 16px; padding: 24px; max-width: 400px; width: 90%;
    box-shadow: 0 20px 60px rgba(0,0,0,0.15);
  }
  .rl-confirm-title { font-size: 16px; font-weight: 700; color: #1d1d1f; margin-bottom: 8px; }
  .rl-confirm-text { font-size: 13px; color: #86868b; margin-bottom: 16px; line-height: 1.5; }
  .rl-confirm-errors { margin-bottom: 12px; }
  .rl-confirm-err-item {
    padding: 6px 10px; margin-bottom: 4px; border-radius: 6px;
    background: oklch(var(--wa) / 0.08); color: oklch(var(--wa)); font-size: 12px; font-weight: 500;
  }
  .rl-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }

  .rl-table-wrap {
    border: 1px solid oklch(var(--bc) / 0.06); border-radius: 14px;
    overflow-x: auto; -webkit-overflow-scrolling: touch; background: oklch(var(--b1));
  }
  .rl-table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  .rl-table thead { background: oklch(var(--bc) / 0.02); }
  .rl-table th {
    padding: 8px 10px; font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: oklch(var(--bc) / 0.35); text-align: left;
    border-bottom: 1px solid oklch(var(--bc) / 0.06); white-space: nowrap;
  }
  .rl-th-sort { cursor: pointer; user-select: none; transition: color 0.15s; }
  .rl-th-sort:hover { color: oklch(var(--bc) / 0.6); }
  .rl-th-check { width: 36px; text-align: center; }
  .rl-th-grip { width: 28px; }
  .rl-th-name { width: 25%; }
  .rl-th-phone { width: 15%; }
  .rl-th-website { width: 20%; }
  .rl-th-notes { }

  .rl-row { transition: background 0.1s; }
  .rl-row:hover { background: oklch(var(--bc) / 0.015); }
  .rl-row td {
    padding: 8px 10px; border-bottom: 1px solid oklch(var(--bc) / 0.04); vertical-align: middle;
  }
  .rl-row:last-child td { border-bottom: none; }
  .rl-row-selected { background: oklch(var(--p) / 0.04); }
  .rl-row-selected:hover { background: oklch(var(--p) / 0.06); }
  .rl-row-dragging { opacity: 0.4; }
  .rl-row-dragover { box-shadow: inset 0 -2px 0 oklch(var(--p)); }

  .rl-td-check { text-align: center; padding: 0 4px !important; }
  .rl-td-grip { padding: 0 4px !important; }
  .rl-check-all, .rl-check-btn {
    border: none; background: none; cursor: pointer; font-size: 16px;
    color: oklch(var(--bc) / 0.3); transition: color 0.1s;
  }
  .rl-check-all:hover, .rl-check-btn:hover { color: oklch(var(--p)); }
  .rl-row-selected .rl-check-btn { color: oklch(var(--p)); }

  .rl-grip {
    cursor: grab; color: oklch(var(--bc) / 0.2); font-size: 14px;
    user-select: none; display: inline-block; line-height: 1;
  }
  .rl-grip:hover { color: oklch(var(--bc) / 0.5); }

  .rl-inline {
    width: 100%; padding: 4px 8px; border: 1px solid transparent;
    border-radius: 6px; font-size: 13px; background: transparent;
    color: oklch(var(--bc)); outline: none; transition: all 0.15s; font-family: inherit;
  }
  .rl-inline:hover { border-color: oklch(var(--bc) / 0.08); background: oklch(var(--bc) / 0.02); }
  .rl-inline:focus { border-color: oklch(var(--p) / 0.3); background: white; box-shadow: 0 0 0 3px oklch(var(--p) / 0.06); }

  .rl-link { color: oklch(var(--p)); text-decoration: none; font-size: 13px; }
  .rl-link:hover { text-decoration: underline; }
  .rl-empty { color: oklch(var(--bc) / 0.2); }
  .rl-empty-state { text-align: center; padding: 40px; font-size: 14px; color: oklch(var(--bc) / 0.3); }

  .rl-add-bar {
    display: flex; gap: 8px; margin-top: 12px; padding: 10px 12px;
    background: oklch(var(--bc) / 0.02); border-radius: 12px;
    border: 1px solid oklch(var(--bc) / 0.06); flex-wrap: wrap;
  }
  .rl-add-input {
    padding: 6px 10px; border: 1px solid oklch(var(--bc) / 0.1);
    border-radius: 8px; font-size: 13px; background: white;
    color: oklch(var(--bc)); outline: none; transition: border-color 0.15s; font-family: inherit;
  }
  .rl-add-input:focus { border-color: oklch(var(--p) / 0.3); box-shadow: 0 0 0 3px oklch(var(--p) / 0.06); }
  .rl-add-name { flex: 2; min-width: 120px; }
  .rl-add-phone { flex: 1; min-width: 100px; }
  .rl-add-web { flex: 1.5; min-width: 100px; }
  .rl-add-notes { flex: 2; min-width: 100px; }
</style>
