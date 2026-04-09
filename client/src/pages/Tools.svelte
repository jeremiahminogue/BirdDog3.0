<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";
  import ToolReports from "../components/ToolReports.svelte";

  let activeTab: "inventory" | "reports" = "inventory";

  interface Asset {
    id: number;
    type: string;
    category: string;
    description: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
    identifier: string;
    assignedToEmployee: number | null;
    assignedToJob: number | null;
    status: string;
    condition: string;
    purchaseDate: string;
    purchaseCost: number;
    warrantyExpires: string;
    photoUrl: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
    employeeFirstName?: string;
    employeeLastName?: string;
    employeeNumber?: string;
    jobName?: string;
    jobNumber?: string;
  }

  interface Employee {
    id: number;
    firstName: string;
    lastName: string;
    employeeNumber: string;
    status: string;
  }

  interface Job {
    id: number;
    name: string;
    jobNumber: string;
    status: string;
  }

  let assets: Asset[] = [];
  let employeeList: Employee[] = [];
  let jobList: Job[] = [];
  let loading = true;
  let error = "";

  // Filters
  let filterCategory = "all";
  let filterStatus = "all";
  let filterAssigned = "all";
  let filterPerson = "all";
  let searchTerm = "";

  // View mode — default list
  let viewMode: "grid" | "list" = "list";

  // Sort
  type SortKey = "description" | "category" | "manufacturer" | "model" | "serial" | "assignedTo" | "status" | "condition" | "cost";
  let sortKey: SortKey = "description";
  let sortAsc = true;

  // Selection for batch ops
  let selected: Set<number> = new Set();
  $: allSelected = filteredAssets.length > 0 && filteredAssets.every(a => selected.has(a.id));

  // Delete confirmation
  let confirmDeleteAsset: Asset | null = null;
  let confirmBatchDelete = false;
  let deleting = false;

  // Modal state
  let showModal = false;
  let editing = false;
  let editId = 0;
  let form: any = resetForm();

  // Photo state
  let photoUploading = false;
  let photoFile: File | null = null;

  $: canEdit = $user?.role === "super_admin" || $user?.role === "admin" || $user?.role === "pm";

  const categories = [
    { value: "power_tool", label: "Power Tool" },
    { value: "specialty", label: "Specialty" },
    { value: "hand_tool", label: "Hand Tool" },
    { value: "safety", label: "Safety" },
    { value: "testing", label: "Testing" },
    { value: "other", label: "Other" },
  ];

  const conditions = [
    { value: "new", label: "New" },
    { value: "good", label: "Good" },
    { value: "fair", label: "Fair" },
    { value: "poor", label: "Poor" },
  ];

  const statuses = [
    { value: "available", label: "Available" },
    { value: "assigned", label: "Assigned" },
    { value: "maintenance", label: "Maintenance" },
    { value: "retired", label: "Retired" },
  ];

  function resetForm() {
    return {
      type: "tool",
      category: "power_tool",
      description: "",
      manufacturer: "",
      model: "",
      serialNumber: "",
      identifier: "",
      assignedToEmployee: "",
      assignedToJob: "",
      status: "available",
      condition: "good",
      purchaseDate: "",
      purchaseCost: "",
      warrantyExpires: "",
      notes: "",
    };
  }

  $: filteredAssets = assets.filter(a => {
    if (filterCategory !== "all" && a.category !== filterCategory) return false;
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    if (filterAssigned === "assigned" && !a.assignedToEmployee) return false;
    if (filterAssigned === "unassigned" && a.assignedToEmployee) return false;
    if (filterPerson !== "all" && String(a.assignedToEmployee) !== filterPerson) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const searchable = `${a.description} ${a.manufacturer} ${a.model} ${a.serialNumber} ${a.identifier} ${a.employeeFirstName || ""} ${a.employeeLastName || ""} ${a.jobName || ""}`.toLowerCase();
      if (!searchable.includes(term)) return false;
    }
    return true;
  });

  // Sorted + filtered
  $: sortedAssets = [...filteredAssets].sort((a, b) => {
    let aVal = "";
    let bVal = "";
    let aNum = 0;
    let bNum = 0;

    switch (sortKey) {
      case "description": aVal = (a.description || "").toLowerCase(); bVal = (b.description || "").toLowerCase(); break;
      case "category": aVal = getCategoryLabel(a.category).toLowerCase(); bVal = getCategoryLabel(b.category).toLowerCase(); break;
      case "manufacturer": aVal = (a.manufacturer || "").toLowerCase(); bVal = (b.manufacturer || "").toLowerCase(); break;
      case "model": aVal = (a.model || "").toLowerCase(); bVal = (b.model || "").toLowerCase(); break;
      case "serial": aVal = (a.serialNumber || a.identifier || "").toLowerCase(); bVal = (b.serialNumber || b.identifier || "").toLowerCase(); break;
      case "assignedTo":
        aVal = a.assignedToEmployee ? `${a.employeeLastName}, ${a.employeeFirstName}`.toLowerCase() : "";
        bVal = b.assignedToEmployee ? `${b.employeeLastName}, ${b.employeeFirstName}`.toLowerCase() : "";
        break;
      case "status": aVal = (a.status || "").toLowerCase(); bVal = (b.status || "").toLowerCase(); break;
      case "condition": aVal = (a.condition || "").toLowerCase(); bVal = (b.condition || "").toLowerCase(); break;
      case "cost":
        aNum = a.purchaseCost || 0;
        bNum = b.purchaseCost || 0;
        return sortAsc ? aNum - bNum : bNum - aNum;
    }
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

  // Build list of employees that actually have tools assigned
  $: assignedEmployees = (() => {
    const empMap = new Map<number, { id: number; name: string }>();
    for (const a of assets) {
      if (a.assignedToEmployee && a.employeeFirstName) {
        empMap.set(a.assignedToEmployee, {
          id: a.assignedToEmployee,
          name: `${a.employeeLastName}, ${a.employeeFirstName}`,
        });
      }
    }
    return [...empMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  $: stats = {
    total: assets.length,
    assigned: assets.filter(a => a.assignedToEmployee).length,
    available: assets.filter(a => a.status === "available").length,
    maintenance: assets.filter(a => a.status === "maintenance").length,
  };

  async function loadData() {
    try {
      const [assetData, empData, jobData] = await Promise.all([
        api.get("/assets?type=tool"),
        api.get("/employees?status=active"),
        api.get("/jobs"),
      ]);
      assets = assetData;
      employeeList = empData;
      jobList = jobData.filter((j: Job) => j.status === "active" || j.status === "planning");
    } catch (e: any) {
      error = e.message;
    }
    loading = false;
  }

  onMount(loadData);

  function openAdd() {
    form = resetForm();
    editing = false;
    editId = 0;
    photoFile = null;
    showModal = true;
  }

  function openEdit(asset: Asset) {
    form = {
      type: "tool",
      category: asset.category || "power_tool",
      description: asset.description,
      manufacturer: asset.manufacturer || "",
      model: asset.model || "",
      serialNumber: asset.serialNumber || "",
      identifier: asset.identifier || "",
      assignedToEmployee: asset.assignedToEmployee ? String(asset.assignedToEmployee) : "",
      assignedToJob: asset.assignedToJob ? String(asset.assignedToJob) : "",
      status: asset.status,
      condition: asset.condition || "good",
      purchaseDate: asset.purchaseDate || "",
      purchaseCost: asset.purchaseCost ? String(asset.purchaseCost) : "",
      warrantyExpires: asset.warrantyExpires || "",
      notes: asset.notes || "",
    };
    editing = true;
    editId = asset.id;
    photoFile = null;
    showModal = true;
  }

  async function handleSave() {
    try {
      const payload = { ...form };
      if (!payload.assignedToEmployee) payload.assignedToEmployee = null;
      if (!payload.assignedToJob) payload.assignedToJob = null;
      if (!payload.purchaseCost) payload.purchaseCost = null;

      if (payload.assignedToEmployee && payload.status === "available") {
        payload.status = "assigned";
      }
      if (!payload.assignedToEmployee && payload.status === "assigned") {
        payload.status = "available";
      }

      let savedId: number;
      if (editing) {
        await api.put(`/assets/${editId}`, payload);
        savedId = editId;
      } else {
        const result = await api.post("/assets", payload);
        savedId = result.id;
      }

      if (photoFile) {
        await uploadPhoto(savedId, photoFile);
      }

      showModal = false;
      await loadData();
    } catch (e: any) {
      error = e.message;
    }
  }

  async function uploadPhoto(assetId: number, file: File) {
    photoUploading = true;
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch(`/api/assets/${assetId}/photo`, {
        method: "POST",
        headers: { "X-Requested-With": "BirdDog" },
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
    } finally {
      photoUploading = false;
    }
  }

  function handlePhotoSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) {
      photoFile = input.files[0];
    }
  }

  async function handleQuickAssign(asset: Asset, employeeId: number | null) {
    try {
      await api.put(`/assets/${asset.id}`, {
        assignedToEmployee: employeeId,
        status: employeeId ? "assigned" : "available",
      });
      await loadData();
    } catch (e: any) {
      error = e.message;
    }
  }

  function requestDelete(asset: Asset) {
    confirmDeleteAsset = asset;
  }

  async function confirmDelete() {
    if (!confirmDeleteAsset) return;
    deleting = true;
    try {
      await api.del(`/assets/${confirmDeleteAsset.id}`);
      confirmDeleteAsset = null;
      await loadData();
    } catch (e: any) {
      error = e.message;
    }
    deleting = false;
  }

  function requestBatchDelete() {
    if (selected.size === 0) return;
    confirmBatchDelete = true;
  }

  async function confirmBatch() {
    deleting = true;
    const ids = [...selected];
    let errCount = 0;
    for (const id of ids) {
      try {
        await api.del(`/assets/${id}`);
        selected.delete(id);
      } catch {
        errCount++;
      }
    }
    selected = new Set(selected);
    confirmBatchDelete = false;
    if (errCount > 0) error = `${errCount} tool(s) could not be deleted.`;
    await loadData();
    deleting = false;
  }

  function toggleSelectAll() {
    if (allSelected) {
      selected = new Set();
    } else {
      selected = new Set(filteredAssets.map(a => a.id));
    }
  }

  function toggleSelect(id: number) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    selected = new Set(selected);
  }

  function getCategoryLabel(cat: string) {
    return categories.find(c => c.value === cat)?.label || cat || "—";
  }

  function statusColor(status: string): string {
    const map: Record<string, string> = {
      available: "#34c759",
      assigned: "#007aff",
      maintenance: "#ff9500",
      retired: "#8e8e93",
    };
    return map[status] || "#8e8e93";
  }

  function conditionColor(cond: string): string {
    const map: Record<string, string> = {
      new: "#34c759",
      good: "#007aff",
      fair: "#ff9500",
      poor: "#ff3b30",
    };
    return map[cond] || "#8e8e93";
  }

  function formatCurrency(n: number | null) {
    if (!n) return "—";
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatDate(d: string | null) {
    if (!d) return "—";
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
</script>

<div class="tl-page">
  <!-- Header -->
  <div class="tl-header">
    <div class="tl-header-left">
      <h1 class="tl-title">Tools & Equipment</h1>
      <div class="tl-tabs">
        <button class="tl-tab" class:tl-tab-active={activeTab === "inventory"} on:click={() => activeTab = "inventory"}>
          Inventory
          <span class="tl-tab-count">{assets.length}</span>
        </button>
        <button class="tl-tab" class:tl-tab-active={activeTab === "reports"} on:click={() => activeTab = "reports"}>
          Reports
        </button>
      </div>
    </div>
    {#if activeTab === "inventory"}
    <div class="tl-header-actions">
      <!-- View toggle -->
      <div class="tl-view-toggle">
        <button
          class="tl-view-btn"
          class:active={viewMode === "list"}
          title="List view"
          on:click={() => viewMode = "list"}
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <button
          class="tl-view-btn"
          class:active={viewMode === "grid"}
          title="Grid view"
          on:click={() => viewMode = "grid"}
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        </button>
      </div>
      {#if canEdit}
        <button class="tl-btn tl-btn-primary" on:click={openAdd}>+ Add Tool</button>
      {/if}
    </div>
    {/if}
  </div>

  {#if activeTab === "reports"}
    <ToolReports />
  {:else}
  <!-- Stats Row -->
  <div class="tl-stats">
    <button class="tl-stat" class:active={filterStatus === "all"} on:click={() => filterStatus = "all"}>
      <span class="tl-stat-num">{stats.total}</span>
      <span class="tl-stat-label">Total</span>
    </button>
    <button class="tl-stat" class:active={filterStatus === "assigned"} on:click={() => filterStatus = filterStatus === "assigned" ? "all" : "assigned"}>
      <span class="tl-stat-num" style="color: #007aff">{stats.assigned}</span>
      <span class="tl-stat-label">Assigned</span>
    </button>
    <button class="tl-stat" class:active={filterStatus === "available"} on:click={() => filterStatus = filterStatus === "available" ? "all" : "available"}>
      <span class="tl-stat-num" style="color: #34c759">{stats.available}</span>
      <span class="tl-stat-label">Available</span>
    </button>
    <button class="tl-stat" class:active={filterStatus === "maintenance"} on:click={() => filterStatus = filterStatus === "maintenance" ? "all" : "maintenance"}>
      <span class="tl-stat-num" style="color: #ff9500">{stats.maintenance}</span>
      <span class="tl-stat-label">Maintenance</span>
    </button>
  </div>

  <!-- Filters -->
  <div class="tl-filters">
    <div class="tl-search-wrap">
      <svg class="tl-search-icon" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input
        type="text"
        placeholder="Search tools, manufacturer, serial..."
        class="tl-search"
        bind:value={searchTerm}
      />
      {#if searchTerm}
        <button class="tl-search-clear" on:click={() => searchTerm = ""}>✕</button>
      {/if}
    </div>
    <select class="tl-filter-select" bind:value={filterCategory}>
      <option value="all">All Categories</option>
      {#each categories as cat}
        <option value={cat.value}>{cat.label}</option>
      {/each}
    </select>
    <select class="tl-filter-select" bind:value={filterAssigned}>
      <option value="all">All</option>
      <option value="assigned">Assigned</option>
      <option value="unassigned">Unassigned</option>
    </select>
    {#if assignedEmployees.length > 0}
      <select class="tl-filter-select" bind:value={filterPerson}>
        <option value="all">All People</option>
        {#each assignedEmployees as emp}
          <option value={String(emp.id)}>{emp.name}</option>
        {/each}
      </select>
    {/if}
  </div>

  <!-- Batch action bar -->
  {#if selected.size > 0 && canEdit}
    <div class="tl-batch-bar">
      <span class="tl-batch-count">{selected.size} selected</span>
      <button class="tl-btn tl-btn-danger" on:click={requestBatchDelete}>Delete Selected</button>
      <button class="tl-btn tl-btn-ghost" on:click={() => selected = new Set()}>Clear</button>
    </div>
  {/if}

  {#if error}
    <div class="tl-error">
      <span>{error}</span>
      <button class="tl-error-close" on:click={() => error = ""}>Dismiss</button>
    </div>
  {/if}

  <!-- Content -->
  {#if loading}
    <div class="tl-loading">Loading tools...</div>
  {:else if filteredAssets.length === 0}
    <div class="tl-empty-state">
      <div style="font-size: 32px; margin-bottom: 8px; opacity: 0.3;">🔧</div>
      <p>{assets.length === 0 ? "No tools added yet" : "No tools match your filters"}</p>
      {#if canEdit && assets.length === 0}
        <button class="tl-btn tl-btn-primary" style="margin-top: 12px" on:click={openAdd}>Add your first tool</button>
      {/if}
    </div>
  {:else if viewMode === "list"}
    <!-- ═══════ LIST VIEW ═══════ -->
    <div class="tl-table-wrap">
      <table class="tl-table">
        <thead>
          <tr>
            {#if canEdit}
              <th class="tl-th-check">
                <button class="tl-check-all" on:click={toggleSelectAll}>{allSelected ? "☑" : "☐"}</button>
              </th>
            {/if}
            <th class="tl-th-desc tl-th-sort" on:click={() => toggleSort("description")}>Tool{sortIndicator("description")}</th>
            <th class="tl-th-cat tl-th-sort" on:click={() => toggleSort("category")}>Category{sortIndicator("category")}</th>
            <th class="tl-th-mfr tl-th-sort" on:click={() => toggleSort("manufacturer")}>Mfr{sortIndicator("manufacturer")}</th>
            <th class="tl-th-serial tl-th-sort" on:click={() => toggleSort("serial")}>S/N · Tag{sortIndicator("serial")}</th>
            <th class="tl-th-assign tl-th-sort" on:click={() => toggleSort("assignedTo")}>Assigned To{sortIndicator("assignedTo")}</th>
            <th class="tl-th-status tl-th-sort" on:click={() => toggleSort("status")}>Status{sortIndicator("status")}</th>
            <th class="tl-th-cond tl-th-sort" on:click={() => toggleSort("condition")}>Cond{sortIndicator("condition")}</th>
            <th class="tl-th-cost tl-th-sort" on:click={() => toggleSort("cost")}>Cost{sortIndicator("cost")}</th>
            {#if canEdit}
              <th class="tl-th-actions"></th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each sortedAssets as asset (asset.id)}
            <tr class="tl-row" class:tl-row-selected={selected.has(asset.id)}>
              {#if canEdit}
                <td class="tl-td-check">
                  <button class="tl-check-btn" on:click={() => toggleSelect(asset.id)}>
                    {selected.has(asset.id) ? "☑" : "☐"}
                  </button>
                </td>
              {/if}
              <td class="tl-td-desc">
                <div class="tl-tool-cell">
                  {#if asset.photoUrl}
                    <img src={asset.photoUrl} alt="" class="tl-tool-thumb" />
                  {:else}
                    <div class="tl-tool-thumb-empty">
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                    </div>
                  {/if}
                  <div class="tl-tool-info">
                    <span class="tl-tool-name">{asset.description}</span>
                    {#if asset.model}
                      <span class="tl-tool-model">{asset.model}</span>
                    {/if}
                  </div>
                </div>
              </td>
              <td class="tl-td-cat">
                <span class="tl-cat-badge">{getCategoryLabel(asset.category)}</span>
              </td>
              <td class="tl-td-mfr">{asset.manufacturer || "—"}</td>
              <td class="tl-td-serial">{asset.serialNumber || asset.identifier || "—"}</td>
              <td class="tl-td-assign">
                {#if asset.assignedToEmployee}
                  <div class="tl-assign-cell">
                    <div class="tl-avatar">{(asset.employeeFirstName || "?")[0]}{(asset.employeeLastName || "?")[0]}</div>
                    <div class="tl-assign-info">
                      <span class="tl-assign-name">{asset.employeeFirstName} {asset.employeeLastName}</span>
                      {#if asset.jobName}
                        <span class="tl-assign-job">{asset.jobName}</span>
                      {/if}
                    </div>
                  </div>
                {:else}
                  <span class="tl-unassigned">Unassigned</span>
                {/if}
              </td>
              <td class="tl-td-status">
                <span class="tl-status-dot" style="background: {statusColor(asset.status)}"></span>
                <span class="tl-status-text">{asset.status}</span>
              </td>
              <td class="tl-td-cond">
                <span class="tl-cond-dot" style="background: {conditionColor(asset.condition)}"></span>
                <span class="tl-cond-text">{asset.condition || "—"}</span>
              </td>
              <td class="tl-td-cost">{formatCurrency(asset.purchaseCost)}</td>
              {#if canEdit}
                <td class="tl-td-actions">
                  {#if asset.assignedToEmployee}
                    <button class="tl-act-btn" title="Unassign" on:click={() => handleQuickAssign(asset, null)}>
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>
                    </button>
                  {/if}
                  <button class="tl-act-btn" title="Edit" on:click={() => openEdit(asset)}>
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  {#if $user?.role === "admin" || $user?.role === "super_admin"}
                    <button class="tl-act-btn tl-act-del" title="Delete" on:click={() => requestDelete(asset)}>
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  {/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <!-- ═══════ GRID VIEW ═══════ -->
    <div class="tl-grid">
      {#each sortedAssets as asset (asset.id)}
        <div class="tl-card">
          <div class="tl-card-img">
            {#if asset.photoUrl}
              <img src={asset.photoUrl} alt={asset.description} />
            {:else}
              <div class="tl-card-img-empty">
                <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" opacity="0.2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
              </div>
            {/if}
            <div class="tl-card-badges">
              <span class="tl-card-badge" style="background: {statusColor(asset.status)}; color: white">{asset.status}</span>
              {#if asset.condition}
                <span class="tl-card-badge" style="background: {conditionColor(asset.condition)}; color: white">{asset.condition}</span>
              {/if}
            </div>
          </div>
          <div class="tl-card-body">
            <div class="tl-card-title">{asset.description}</div>
            <div class="tl-card-meta">
              {#if asset.manufacturer}<span>{asset.manufacturer}</span>{/if}
              {#if asset.model}<span class="tl-card-dim">{asset.model}</span>{/if}
            </div>
            {#if asset.serialNumber || asset.identifier}
              <div class="tl-card-serial">
                {asset.serialNumber ? `S/N: ${asset.serialNumber}` : ""}{asset.serialNumber && asset.identifier ? " · " : ""}{asset.identifier ? `Tag: ${asset.identifier}` : ""}
              </div>
            {/if}
            <div class="tl-card-assign">
              {#if asset.assignedToEmployee}
                <div class="tl-avatar tl-avatar-sm">{(asset.employeeFirstName || "?")[0]}{(asset.employeeLastName || "?")[0]}</div>
                <span>{asset.employeeFirstName} {asset.employeeLastName}</span>
              {:else}
                <span class="tl-unassigned">Unassigned</span>
              {/if}
            </div>
            {#if canEdit}
              <div class="tl-card-actions">
                {#if asset.assignedToEmployee}
                  <button class="tl-btn tl-btn-ghost tl-btn-xs" on:click={() => handleQuickAssign(asset, null)}>Unassign</button>
                {/if}
                <button class="tl-btn tl-btn-ghost tl-btn-xs" on:click={() => openEdit(asset)}>Edit</button>
                {#if $user?.role === "admin" || $user?.role === "super_admin"}
                  <button class="tl-btn tl-btn-ghost tl-btn-xs tl-btn-del-text" on:click={() => requestDelete(asset)}>Delete</button>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
  {/if}
</div>

<!-- ═══════ DELETE CONFIRMATION MODAL ═══════ -->
{#if confirmDeleteAsset}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="tl-confirm-backdrop" on:click|self={() => confirmDeleteAsset = null}>
    <div class="tl-confirm-modal">
      <div class="tl-confirm-title">Delete Tool?</div>
      <div class="tl-confirm-text">
        Are you sure you want to delete <strong>{confirmDeleteAsset.description}</strong>? This action cannot be undone.
      </div>
      <div class="tl-confirm-actions">
        <button class="tl-btn tl-btn-ghost" on:click={() => confirmDeleteAsset = null}>Cancel</button>
        <button class="tl-btn tl-btn-danger" disabled={deleting} on:click={confirmDelete}>
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══════ BATCH DELETE CONFIRMATION MODAL ═══════ -->
{#if confirmBatchDelete}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="tl-confirm-backdrop" on:click|self={() => confirmBatchDelete = false}>
    <div class="tl-confirm-modal">
      <div class="tl-confirm-title">Delete {selected.size} Tool{selected.size > 1 ? "s" : ""}?</div>
      <div class="tl-confirm-text">
        This will permanently delete {selected.size} selected tool{selected.size > 1 ? "s" : ""}. This action cannot be undone.
      </div>
      <div class="tl-confirm-actions">
        <button class="tl-btn tl-btn-ghost" on:click={() => confirmBatchDelete = false}>Cancel</button>
        <button class="tl-btn tl-btn-danger" disabled={deleting} on:click={confirmBatch}>
          {deleting ? "Deleting..." : `Delete ${selected.size}`}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══════ ADD / EDIT MODAL ═══════ -->
{#if showModal}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="tl-confirm-backdrop" on:click|self={() => showModal = false}>
    <div class="tl-modal">
      <div class="tl-modal-header">
        <h3 class="tl-confirm-title" style="margin-bottom: 0">{editing ? "Edit Tool" : "Add Tool"}</h3>
        <button class="tl-modal-close" on:click={() => showModal = false}>✕</button>
      </div>

      <div class="tl-modal-body">
        <div class="tl-form-grid">
          <!-- Description -->
          <div class="tl-form-group tl-form-full">
            <label class="tl-label" for="desc">Tool Name / Description *</label>
            <input id="desc" type="text" class="tl-input" placeholder="e.g. DeWalt 20V MAX Impact Driver" bind:value={form.description} />
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="category">Category</label>
            <select id="category" class="tl-input" bind:value={form.category}>
              {#each categories as cat}
                <option value={cat.value}>{cat.label}</option>
              {/each}
            </select>
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="condition">Condition</label>
            <select id="condition" class="tl-input" bind:value={form.condition}>
              {#each conditions as c}
                <option value={c.value}>{c.label}</option>
              {/each}
            </select>
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="mfr">Manufacturer</label>
            <input id="mfr" type="text" class="tl-input" placeholder="e.g. DeWalt, Milwaukee" bind:value={form.manufacturer} />
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="model">Model</label>
            <input id="model" type="text" class="tl-input" placeholder="e.g. DCF887B" bind:value={form.model} />
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="serial">Serial Number</label>
            <input id="serial" type="text" class="tl-input" bind:value={form.serialNumber} />
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="tag">Asset Tag / Barcode</label>
            <input id="tag" type="text" class="tl-input" placeholder="e.g. PE-T-001" bind:value={form.identifier} />
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="assignEmp">Assigned To (Employee)</label>
            <select id="assignEmp" class="tl-input" bind:value={form.assignedToEmployee}>
              <option value="">— Unassigned —</option>
              {#each employeeList as emp}
                <option value={String(emp.id)}>{emp.lastName}, {emp.firstName} ({emp.employeeNumber})</option>
              {/each}
            </select>
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="assignJob">Job Site</label>
            <select id="assignJob" class="tl-input" bind:value={form.assignedToJob}>
              <option value="">— None —</option>
              {#each jobList as job}
                <option value={String(job.id)}>#{job.jobNumber} - {job.name}</option>
              {/each}
            </select>
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="status">Status</label>
            <select id="status" class="tl-input" bind:value={form.status}>
              {#each statuses as s}
                <option value={s.value}>{s.label}</option>
              {/each}
            </select>
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="pdate">Purchase Date</label>
            <input id="pdate" type="date" class="tl-input" bind:value={form.purchaseDate} />
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="pcost">Purchase Cost</label>
            <input id="pcost" type="number" step="0.01" class="tl-input" placeholder="0.00" bind:value={form.purchaseCost} />
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="warranty">Warranty Expires</label>
            <input id="warranty" type="date" class="tl-input" bind:value={form.warrantyExpires} />
          </div>

          <div class="tl-form-group">
            <label class="tl-label" for="photo">Photo</label>
            <input id="photo" type="file" accept="image/jpeg,image/png,image/webp" class="tl-input tl-file-input" on:change={handlePhotoSelect} />
            {#if photoFile}
              <span class="tl-file-name">✓ {photoFile.name}</span>
            {/if}
          </div>

          <div class="tl-form-group tl-form-full">
            <label class="tl-label" for="notes">Notes</label>
            <textarea id="notes" class="tl-input tl-textarea" rows="2" placeholder="Accessories, location, special instructions..." bind:value={form.notes}></textarea>
          </div>
        </div>
      </div>

      <div class="tl-modal-footer">
        <button class="tl-btn tl-btn-ghost" on:click={() => showModal = false}>Cancel</button>
        <button
          class="tl-btn tl-btn-primary"
          disabled={!form.description || photoUploading}
          on:click={handleSave}
        >
          {#if photoUploading}Uploading...{:else}{editing ? "Save Changes" : "Add Tool"}{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ═══ Page Layout ═══ */
  .tl-page { max-width: 100%; }

  .tl-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .tl-header-left { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .tl-tabs { display: flex; gap: 2px; background: #f2f2f7; border-radius: 8px; padding: 2px; }
  .tl-tab {
    padding: 6px 16px; border-radius: 6px; font-size: 0.8125rem; font-weight: 600;
    color: #636366; background: transparent; border: none; cursor: pointer; transition: all 0.15s;
  }
  .tl-tab:hover { color: #1d1d1f; }
  .tl-tab-active { background: #fff; color: #1d1d1f; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .tl-tab-count { font-size: 0.6875rem; font-weight: 700; color: #86868b; margin-left: 4px; }
  .tl-header-actions { display: flex; align-items: center; gap: 8px; }
  .tl-title { font-size: 22px; font-weight: 700; color: #1d1d1f; letter-spacing: -0.02em; }
  .tl-count { font-size: 13px; color: #86868b; font-weight: 500; }

  /* ═══ View Toggle ═══ */
  .tl-view-toggle { display: flex; background: oklch(var(--bc) / 0.05); border-radius: 8px; padding: 2px; }
  .tl-view-btn {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 28px; border: none; background: none;
    border-radius: 6px; cursor: pointer; color: oklch(var(--bc) / 0.35);
    transition: all 0.15s;
  }
  .tl-view-btn:hover { color: oklch(var(--bc) / 0.6); }
  .tl-view-btn.active { background: white; color: oklch(var(--bc)); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

  /* ═══ Stats Row ═══ */
  .tl-stats {
    display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap;
  }
  .tl-stat {
    flex: 1; min-width: 80px; padding: 10px 12px;
    background: white; border: 1px solid oklch(var(--bc) / 0.08);
    border-radius: 10px; text-align: center; cursor: pointer;
    transition: all 0.15s; display: flex; flex-direction: column; gap: 2px;
  }
  .tl-stat:hover { border-color: oklch(var(--bc) / 0.15); }
  .tl-stat.active { border-color: oklch(var(--p) / 0.3); background: oklch(var(--p) / 0.03); }
  .tl-stat-num { font-size: 20px; font-weight: 700; color: #1d1d1f; line-height: 1.2; }
  .tl-stat-label { font-size: 11px; color: #86868b; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }

  /* ═══ Filters ═══ */
  .tl-filters { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .tl-search-wrap {
    position: relative; flex: 1; min-width: 200px;
  }
  .tl-search-icon {
    position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
    color: oklch(var(--bc) / 0.3); pointer-events: none;
  }
  .tl-search {
    width: 100%; padding: 7px 28px 7px 30px; border: 1px solid oklch(var(--bc) / 0.1);
    border-radius: 8px; font-size: 13px; background: white; outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .tl-search:focus { border-color: oklch(var(--p) / 0.3); box-shadow: 0 0 0 3px oklch(var(--p) / 0.06); }
  .tl-search-clear {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
    border: none; background: none; cursor: pointer; color: oklch(var(--bc) / 0.3);
    font-size: 12px; padding: 2px 4px;
  }
  .tl-search-clear:hover { color: oklch(var(--bc) / 0.6); }

  .tl-filter-select {
    padding: 7px 28px 7px 10px; border: 1px solid oklch(var(--bc) / 0.1);
    border-radius: 8px; font-size: 13px; background: white; outline: none;
    cursor: pointer; appearance: auto;
  }
  .tl-filter-select:focus { border-color: oklch(var(--p) / 0.3); }

  /* ═══ Batch Bar ═══ */
  .tl-batch-bar {
    display: flex; align-items: center; gap: 8px; padding: 8px 14px;
    background: oklch(var(--p) / 0.04); border: 1px solid oklch(var(--p) / 0.15);
    border-radius: 10px; margin-bottom: 10px;
  }
  .tl-batch-count { font-size: 13px; font-weight: 600; color: oklch(var(--p)); flex: 1; }

  /* ═══ Buttons ═══ */
  .tl-btn {
    padding: 6px 14px; border: none; border-radius: 8px; font-size: 13px;
    font-weight: 600; cursor: pointer; transition: all 0.15s; white-space: nowrap;
  }
  .tl-btn-primary { background: oklch(var(--p)); color: white; }
  .tl-btn-primary:hover { filter: brightness(1.1); }
  .tl-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .tl-btn-danger { background: oklch(var(--er) / 0.12); color: oklch(var(--er)); }
  .tl-btn-danger:hover { background: oklch(var(--er) / 0.2); }
  .tl-btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
  .tl-btn-ghost { background: oklch(var(--bc) / 0.06); color: oklch(var(--bc) / 0.5); }
  .tl-btn-ghost:hover { background: oklch(var(--bc) / 0.1); }
  .tl-btn-xs { padding: 3px 8px; font-size: 11px; }
  .tl-btn-del-text { color: oklch(var(--er) / 0.6); }
  .tl-btn-del-text:hover { color: oklch(var(--er)); background: oklch(var(--er) / 0.08); }

  /* ═══ Error / Loading / Empty ═══ */
  .tl-error {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; background: oklch(var(--er) / 0.08);
    border: 1px solid oklch(var(--er) / 0.15); border-radius: 10px;
    font-size: 13px; color: oklch(var(--er)); margin-bottom: 10px;
  }
  .tl-error-close { border: none; background: none; cursor: pointer; color: oklch(var(--er)); font-weight: 600; font-size: 12px; }
  .tl-loading { text-align: center; padding: 60px; color: #86868b; font-size: 14px; }
  .tl-empty-state { text-align: center; padding: 48px 20px; font-size: 14px; color: oklch(var(--bc) / 0.35); }

  /* ═══ TABLE (List View) ═══ */
  .tl-table-wrap {
    background: white; border: 1px solid oklch(var(--bc) / 0.08);
    border-radius: 12px; overflow-x: auto; -webkit-overflow-scrolling: touch;
  }
  .tl-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tl-table thead { background: oklch(var(--bc) / 0.025); }
  .tl-table th {
    padding: 8px 10px; text-align: left; font-weight: 600; font-size: 11px;
    color: oklch(var(--bc) / 0.45); text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid oklch(var(--bc) / 0.08); white-space: nowrap;
  }
  .tl-th-sort { cursor: pointer; user-select: none; transition: color 0.15s; }
  .tl-th-sort:hover { color: oklch(var(--bc) / 0.7); }
  .tl-th-check { width: 36px; text-align: center; }
  .tl-th-desc { width: 22%; }
  .tl-th-cat { width: 9%; }
  .tl-th-mfr { width: 10%; }
  .tl-th-serial { width: 12%; }
  .tl-th-assign { width: 18%; }
  .tl-th-status { width: 9%; }
  .tl-th-cond { width: 7%; }
  .tl-th-cost { width: 8%; text-align: right; }
  .tl-th-actions { width: 80px; }

  .tl-row { transition: background 0.1s; }
  .tl-row:hover { background: oklch(var(--bc) / 0.015); }
  .tl-row td {
    padding: 7px 10px; border-bottom: 1px solid oklch(var(--bc) / 0.05);
    vertical-align: middle; color: oklch(var(--bc) / 0.75);
  }
  .tl-row:last-child td { border-bottom: none; }
  .tl-row-selected { background: oklch(var(--p) / 0.04); }
  .tl-row-selected:hover { background: oklch(var(--p) / 0.06); }

  .tl-td-check { text-align: center; padding: 0 4px !important; }
  .tl-check-all, .tl-check-btn {
    background: none; border: none; cursor: pointer; font-size: 15px;
    color: oklch(var(--bc) / 0.25); transition: color 0.15s;
  }
  .tl-check-all:hover, .tl-check-btn:hover { color: oklch(var(--p)); }
  .tl-row-selected .tl-check-btn { color: oklch(var(--p)); }

  /* Tool cell with thumbnail */
  .tl-tool-cell { display: flex; align-items: center; gap: 8px; }
  .tl-tool-thumb {
    width: 32px; height: 32px; border-radius: 6px; object-fit: cover;
    border: 1px solid oklch(var(--bc) / 0.06); flex-shrink: 0;
  }
  .tl-tool-thumb-empty {
    width: 32px; height: 32px; border-radius: 6px; flex-shrink: 0;
    background: oklch(var(--bc) / 0.04); display: flex; align-items: center; justify-content: center;
  }
  .tl-tool-info { display: flex; flex-direction: column; min-width: 0; }
  .tl-tool-name { font-weight: 600; color: #1d1d1f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
  .tl-tool-model { font-size: 11px; color: oklch(var(--bc) / 0.35); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .tl-td-cat { }
  .tl-cat-badge {
    display: inline-block; padding: 2px 7px; border-radius: 4px;
    background: oklch(var(--bc) / 0.05); font-size: 11px; font-weight: 500;
    color: oklch(var(--bc) / 0.5);
  }
  .tl-td-mfr { font-size: 12px; }
  .tl-td-serial { font-size: 11px; font-family: "SF Mono", "Menlo", "Monaco", monospace; color: oklch(var(--bc) / 0.4); }
  .tl-td-cost { text-align: right; font-family: "SF Mono", "Menlo", "Monaco", monospace; font-size: 12px; }

  /* Assigned to cell */
  .tl-assign-cell { display: flex; align-items: center; gap: 6px; }
  .tl-avatar {
    width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
    background: oklch(var(--p) / 0.1); color: oklch(var(--p));
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; font-weight: 700; text-transform: uppercase;
  }
  .tl-avatar-sm { width: 20px; height: 20px; font-size: 8px; }
  .tl-assign-info { display: flex; flex-direction: column; min-width: 0; }
  .tl-assign-name { font-size: 12px; font-weight: 500; color: oklch(var(--bc) / 0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tl-assign-job { font-size: 10px; color: oklch(var(--bc) / 0.35); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tl-unassigned { font-size: 12px; color: oklch(var(--bc) / 0.2); font-style: italic; }

  /* Status / Condition dots */
  .tl-td-status, .tl-td-cond { white-space: nowrap; }
  .tl-status-dot, .tl-cond-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    margin-right: 5px; vertical-align: middle;
  }
  .tl-status-text, .tl-cond-text { font-size: 12px; text-transform: capitalize; }

  /* Actions */
  .tl-td-actions { white-space: nowrap; text-align: right; }
  .tl-act-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border: none; background: none;
    border-radius: 6px; cursor: pointer; color: oklch(var(--bc) / 0.3);
    transition: all 0.15s;
  }
  .tl-act-btn:hover { background: oklch(var(--bc) / 0.06); color: oklch(var(--bc) / 0.6); }
  .tl-act-del:hover { background: oklch(var(--er) / 0.08); color: oklch(var(--er)); }

  /* ═══ GRID VIEW ═══ */
  .tl-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .tl-card {
    background: white; border: 1px solid oklch(var(--bc) / 0.08);
    border-radius: 12px; overflow: hidden; transition: box-shadow 0.15s;
  }
  .tl-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
  .tl-card-img { position: relative; height: 120px; overflow: hidden; background: oklch(var(--bc) / 0.03); }
  .tl-card-img img { width: 100%; height: 100%; object-fit: cover; }
  .tl-card-img-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  .tl-card-badges { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; }
  .tl-card-badge {
    padding: 2px 6px; border-radius: 4px; font-size: 10px;
    font-weight: 600; text-transform: capitalize; letter-spacing: 0.02em;
  }
  .tl-card-body { padding: 10px 12px; }
  .tl-card-title { font-weight: 600; font-size: 13px; color: #1d1d1f; margin-bottom: 3px; line-height: 1.3; }
  .tl-card-meta { display: flex; gap: 6px; font-size: 12px; color: oklch(var(--bc) / 0.5); margin-bottom: 4px; }
  .tl-card-dim { color: oklch(var(--bc) / 0.3); }
  .tl-card-serial { font-size: 10px; font-family: "SF Mono", "Menlo", monospace; color: oklch(var(--bc) / 0.3); margin-bottom: 6px; }
  .tl-card-assign { display: flex; align-items: center; gap: 6px; font-size: 12px; color: oklch(var(--bc) / 0.6); margin-bottom: 6px; }
  .tl-card-actions { display: flex; gap: 4px; padding-top: 8px; border-top: 1px solid oklch(var(--bc) / 0.06); }

  /* ═══ CONFIRMATION MODALS ═══ */
  .tl-confirm-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 1000;
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .tl-confirm-modal {
    background: white; border-radius: 14px; padding: 24px; max-width: 400px; width: 100%;
    box-shadow: 0 20px 60px rgba(0,0,0,0.15);
  }
  .tl-confirm-title { font-size: 16px; font-weight: 700; color: #1d1d1f; margin-bottom: 8px; }
  .tl-confirm-text { font-size: 13px; color: #86868b; margin-bottom: 20px; line-height: 1.5; }
  .tl-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }

  /* ═══ ADD/EDIT MODAL ═══ */
  .tl-modal {
    background: white; border-radius: 14px; max-width: 640px; width: 100%;
    max-height: 90vh; display: flex; flex-direction: column;
    box-shadow: 0 20px 60px rgba(0,0,0,0.15);
  }
  .tl-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px 12px;
  }
  .tl-modal-close {
    border: none; background: none; cursor: pointer; font-size: 16px;
    color: oklch(var(--bc) / 0.3); padding: 4px 8px; border-radius: 6px;
  }
  .tl-modal-close:hover { background: oklch(var(--bc) / 0.06); color: oklch(var(--bc) / 0.6); }
  .tl-modal-body { padding: 0 24px; overflow-y: auto; flex: 1; }
  .tl-modal-footer {
    display: flex; gap: 8px; justify-content: flex-end;
    padding: 16px 24px; border-top: 1px solid oklch(var(--bc) / 0.06);
  }

  .tl-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .tl-form-full { grid-column: 1 / -1; }
  .tl-form-group { display: flex; flex-direction: column; gap: 4px; }
  .tl-label { font-size: 12px; font-weight: 600; color: oklch(var(--bc) / 0.5); }
  .tl-input {
    padding: 7px 10px; border: 1px solid oklch(var(--bc) / 0.12);
    border-radius: 8px; font-size: 13px; outline: none; background: white;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .tl-input:focus { border-color: oklch(var(--p) / 0.3); box-shadow: 0 0 0 3px oklch(var(--p) / 0.06); }
  .tl-textarea { resize: vertical; min-height: 48px; font-family: inherit; }
  .tl-file-input { padding: 5px; }
  .tl-file-name { font-size: 11px; color: #34c759; margin-top: 2px; }

  /* ═══ Responsive ═══ */
  @media (max-width: 768px) {
    .tl-title { font-size: 18px; }
    .tl-header { flex-direction: column; align-items: flex-start; }
    .tl-stats { gap: 6px; }
    .tl-stat { min-width: 70px; padding: 8px; }
    .tl-stat-num { font-size: 16px; }
    .tl-th-cat, .tl-td-cat, .tl-th-mfr, .tl-td-mfr, .tl-th-cond, .tl-td-cond, .tl-th-cost, .tl-td-cost {
      display: none;
    }
    .tl-form-grid { grid-template-columns: 1fr; }
    .tl-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
    .tl-card-img { height: 90px; }
  }
</style>
