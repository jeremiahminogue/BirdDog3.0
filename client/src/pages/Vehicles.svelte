<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

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

  let vehicles: Asset[] = [];
  let employeeList: Employee[] = [];
  let loading = true;
  let error = "";

  // Filters
  let filterCategory = "all";
  let filterStatus = "all";
  let filterPerson = "all";
  let searchTerm = "";

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
    { value: "truck", label: "Truck" },
    { value: "van", label: "Van" },
    { value: "suv", label: "SUV" },
    { value: "trailer", label: "Trailer" },
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
      type: "vehicle",
      category: "truck",
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

  $: filteredVehicles = vehicles.filter(v => {
    if (filterCategory !== "all" && v.category !== filterCategory) return false;
    if (filterStatus !== "all" && v.status !== filterStatus) return false;
    if (filterPerson !== "all" && String(v.assignedToEmployee) !== filterPerson) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const searchable = `${v.description} ${v.manufacturer} ${v.model} ${v.serialNumber} ${v.identifier} ${v.employeeFirstName || ""} ${v.employeeLastName || ""} ${v.notes || ""}`.toLowerCase();
      if (!searchable.includes(term)) return false;
    }
    return true;
  });

  $: assignedDrivers = (() => {
    const empMap = new Map<number, { id: number; name: string }>();
    for (const v of vehicles) {
      if (v.assignedToEmployee && v.employeeFirstName) {
        empMap.set(v.assignedToEmployee, {
          id: v.assignedToEmployee,
          name: `${v.employeeLastName}, ${v.employeeFirstName}`,
        });
      }
    }
    return [...empMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  $: stats = {
    total: vehicles.length,
    assigned: vehicles.filter(v => v.assignedToEmployee).length,
    available: vehicles.filter(v => v.status === "available").length,
    retired: vehicles.filter(v => v.status === "retired").length,
  };

  async function loadData() {
    try {
      const [vehicleData, empData] = await Promise.all([
        api.get("/assets?type=vehicle"),
        api.get("/employees?status=active"),
      ]);
      vehicles = vehicleData;
      employeeList = empData;
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

  function openEdit(vehicle: Asset) {
    form = {
      type: "vehicle",
      category: vehicle.category || "truck",
      description: vehicle.description,
      manufacturer: vehicle.manufacturer || "",
      model: vehicle.model || "",
      serialNumber: vehicle.serialNumber || "",
      identifier: vehicle.identifier || "",
      assignedToEmployee: vehicle.assignedToEmployee ? String(vehicle.assignedToEmployee) : "",
      assignedToJob: vehicle.assignedToJob ? String(vehicle.assignedToJob) : "",
      status: vehicle.status,
      condition: vehicle.condition || "good",
      purchaseDate: vehicle.purchaseDate || "",
      purchaseCost: vehicle.purchaseCost ? String(vehicle.purchaseCost) : "",
      warrantyExpires: vehicle.warrantyExpires || "",
      notes: vehicle.notes || "",
    };
    editing = true;
    editId = vehicle.id;
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

  async function handleQuickAssign(vehicle: Asset, employeeId: number | null) {
    try {
      await api.put(`/assets/${vehicle.id}`, {
        assignedToEmployee: employeeId,
        status: employeeId ? "assigned" : "available",
      });
      await loadData();
    } catch (e: any) {
      error = e.message;
    }
  }

  async function handleDelete(vehicle: Asset) {
    if (!confirm(`Delete "${vehicle.description}"? This cannot be undone.`)) return;
    try {
      await api.del(`/assets/${vehicle.id}`);
      await loadData();
    } catch (e: any) {
      error = e.message;
    }
  }

  function getCategoryLabel(cat: string) {
    return categories.find(c => c.value === cat)?.label || cat || "—";
  }

  function getStatusBadge(status: string) {
    const map: Record<string, string> = {
      available: "badge-success",
      assigned: "badge-info",
      maintenance: "badge-warning",
      retired: "badge-neutral",
    };
    return map[status] || "badge-ghost";
  }

  function getConditionBadge(cond: string) {
    const map: Record<string, string> = {
      new: "badge-success",
      good: "badge-info",
      fair: "badge-warning",
      poor: "badge-error",
    };
    return map[cond] || "badge-ghost";
  }

  // Sorting
  let sortCol: string = "description";
  let sortAsc: boolean = true;

  function toggleSort(col: string) {
    if (sortCol === col) { sortAsc = !sortAsc; }
    else { sortCol = col; sortAsc = true; }
  }

  $: sortedVehicles = (() => {
    const dir = sortAsc ? 1 : -1;
    return [...filteredVehicles].sort((a, b) => {
      let va: any, vb: any;
      switch (sortCol) {
        case "description":
          va = (a.description || "").toLowerCase(); vb = (b.description || "").toLowerCase();
          break;
        case "type":
          va = a.category || ""; vb = b.category || "";
          break;
        case "make":
          va = (a.manufacturer || "").toLowerCase(); vb = (b.manufacturer || "").toLowerCase();
          break;
        case "model":
          va = (a.model || "").toLowerCase(); vb = (b.model || "").toLowerCase();
          break;
        case "plate":
          va = (a.identifier || "").toLowerCase(); vb = (b.identifier || "").toLowerCase();
          break;
        case "assignedTo":
          va = `${a.employeeLastName || ""} ${a.employeeFirstName || ""}`.toLowerCase();
          vb = `${b.employeeLastName || ""} ${b.employeeFirstName || ""}`.toLowerCase();
          break;
        case "status":
          va = a.status || ""; vb = b.status || "";
          break;
        case "condition":
          va = a.condition || ""; vb = b.condition || "";
          break;
        default:
          return 0;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  })();
</script>

<div class="space-y-4">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
    <div>
      <h1 class="page-title">Vehicles</h1>
      <p class="text-sm text-base-content/60 mt-0.5">Fleet vehicles, trucks, vans, and trailers</p>
    </div>
    {#if canEdit}
      <button class="btn btn-primary btn-sm" on:click={openAdd}>+ Add Vehicle</button>
    {/if}
  </div>

  <!-- Stats Cards -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <div class="bg-base-100 rounded-lg shadow-sm border border-base-300 p-3 text-center">
      <div class="text-2xl font-bold text-primary">{stats.total}</div>
      <div class="text-xs text-base-content/60">Total Vehicles</div>
    </div>
    <div class="bg-base-100 rounded-lg shadow-sm border border-base-300 p-3 text-center">
      <div class="text-2xl font-bold text-info">{stats.assigned}</div>
      <div class="text-xs text-base-content/60">Assigned</div>
    </div>
    <div class="bg-base-100 rounded-lg shadow-sm border border-base-300 p-3 text-center">
      <div class="text-2xl font-bold text-success">{stats.available}</div>
      <div class="text-xs text-base-content/60">Available</div>
    </div>
    <div class="bg-base-100 rounded-lg shadow-sm border border-base-300 p-3 text-center">
      <div class="text-2xl font-bold text-neutral">{stats.retired}</div>
      <div class="text-xs text-base-content/60">Retired</div>
    </div>
  </div>

  <!-- Filters -->
  <div class="flex flex-wrap gap-2 items-center">
    <input
      type="text"
      placeholder="Search vehicles..."
      class="input input-sm input-bordered w-full sm:w-64"
      bind:value={searchTerm}
    />
    <select class="select select-sm select-bordered" bind:value={filterCategory}>
      <option value="all">All Types</option>
      {#each categories as cat}
        <option value={cat.value}>{cat.label}</option>
      {/each}
    </select>
    <select class="select select-sm select-bordered" bind:value={filterStatus}>
      <option value="all">All Statuses</option>
      {#each statuses as s}
        <option value={s.value}>{s.label}</option>
      {/each}
    </select>
    <select class="select select-sm select-bordered" bind:value={filterPerson}>
      <option value="all">All Drivers</option>
      {#each assignedDrivers as emp}
        <option value={String(emp.id)}>{emp.name}</option>
      {/each}
    </select>
  </div>

  {#if error}
    <div class="alert alert-error text-sm">
      <span>{error}</span>
      <button class="btn btn-sm btn-ghost" on:click={() => error = ""}>Dismiss</button>
    </div>
  {/if}

  <!-- Vehicle List -->
  {#if loading}
    <div class="flex justify-center p-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {:else if filteredVehicles.length === 0}
    <div class="text-center py-12 text-base-content/50">
      <div class="text-4xl mb-2">&#128663;</div>
      <p class="font-medium">{vehicles.length === 0 ? "No vehicles added yet" : "No vehicles match your filters"}</p>
      {#if canEdit && vehicles.length === 0}
        <button class="btn btn-primary btn-sm mt-3" on:click={openAdd}>Add your first vehicle</button>
      {/if}
    </div>
  {:else}
    <div class="apple-panel overflow-x-auto">
      <table class="table table-sm apple-table">
        <thead>
          <tr>
            <th class="vehicle-sort" on:click={() => toggleSort("description")}>Vehicle {#if sortCol === "description"}<span class="vehicle-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="vehicle-sort" on:click={() => toggleSort("type")}>Type {#if sortCol === "type"}<span class="vehicle-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="vehicle-sort" on:click={() => toggleSort("make")}>Make {#if sortCol === "make"}<span class="vehicle-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="vehicle-sort" on:click={() => toggleSort("model")}>Vehicle # {#if sortCol === "model"}<span class="vehicle-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th>VIN (last 4)</th>
            <th class="vehicle-sort" on:click={() => toggleSort("plate")}>Plate {#if sortCol === "plate"}<span class="vehicle-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="vehicle-sort" on:click={() => toggleSort("assignedTo")}>Assigned To {#if sortCol === "assignedTo"}<span class="vehicle-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="vehicle-sort" on:click={() => toggleSort("status")}>Status {#if sortCol === "status"}<span class="vehicle-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="vehicle-sort" on:click={() => toggleSort("condition")}>Condition {#if sortCol === "condition"}<span class="vehicle-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            {#if canEdit}
              <th class="text-right">Actions</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each sortedVehicles as vehicle (vehicle.id)}
            <tr class="hover">
              <td class="font-medium max-w-[260px]">
                <div class="flex items-center gap-2">
                  {#if vehicle.photoUrl}
                    <div class="w-8 h-8 rounded overflow-hidden shrink-0 bg-base-200">
                      <img src={vehicle.photoUrl} alt="" class="w-full h-full object-cover" />
                    </div>
                  {/if}
                  <span class="truncate">{vehicle.description}</span>
                </div>
              </td>
              <td><span class="badge badge-ghost badge-xs">{getCategoryLabel(vehicle.category)}</span></td>
              <td class="text-sm">{vehicle.manufacturer || "—"}</td>
              <td class="text-sm font-mono">{vehicle.model || "—"}</td>
              <td class="text-xs font-mono text-base-content/60">{vehicle.serialNumber || "—"}</td>
              <td class="text-sm font-mono">{vehicle.identifier || "—"}</td>
              <td>
                {#if vehicle.assignedToEmployee}
                  <span class="text-sm">{vehicle.employeeFirstName} {vehicle.employeeLastName}</span>
                {:else}
                  <span class="text-xs text-base-content/40 italic">—</span>
                {/if}
              </td>
              <td><span class="badge {getStatusBadge(vehicle.status)} badge-xs">{vehicle.status}</span></td>
              <td><span class="badge {getConditionBadge(vehicle.condition)} badge-xs">{vehicle.condition || "—"}</span></td>
              {#if canEdit}
                <td class="text-right">
                  <div class="flex justify-end gap-1">
                    {#if vehicle.assignedToEmployee}
                      <button class="btn btn-xs btn-ghost text-warning" title="Unassign" on:click={() => handleQuickAssign(vehicle, null)}>Unassign</button>
                    {/if}
                    <button class="btn btn-xs btn-ghost" on:click={() => openEdit(vehicle)}>Edit</button>
                    {#if $user?.role === "admin"}
                      <button class="btn btn-xs btn-ghost text-error" on:click={() => handleDelete(vehicle)}>Delete</button>
                    {/if}
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

<!-- Add/Edit Modal -->
{#if showModal}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal modal-open" on:click|self={() => showModal = false}>
    <div class="modal-box max-w-2xl max-h-[90vh] overflow-y-auto">
      <h3 class="font-bold text-lg mb-4">{editing ? "Edit Vehicle" : "Add Vehicle"}</h3>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <!-- Description -->
        <div class="form-control sm:col-span-2">
          <label class="label py-1" for="vdesc"><span class="label-text font-medium">Vehicle Description *</span></label>
          <input id="vdesc" type="text" class="input input-bordered input-sm" placeholder="e.g. 24 Ford F150 XLT" bind:value={form.description} />
        </div>

        <!-- Category / Type -->
        <div class="form-control">
          <label class="label py-1" for="vcat"><span class="label-text font-medium">Vehicle Type</span></label>
          <select id="vcat" class="select select-bordered select-sm" bind:value={form.category}>
            {#each categories as cat}
              <option value={cat.value}>{cat.label}</option>
            {/each}
          </select>
        </div>

        <!-- Make -->
        <div class="form-control">
          <label class="label py-1" for="vmake"><span class="label-text font-medium">Make</span></label>
          <input id="vmake" type="text" class="input input-bordered input-sm" placeholder="e.g. Ford, GMC, Chevrolet" bind:value={form.manufacturer} />
        </div>

        <!-- Vehicle Number -->
        <div class="form-control">
          <label class="label py-1" for="vnum"><span class="label-text font-medium">Vehicle # / Fleet ID</span></label>
          <input id="vnum" type="text" class="input input-bordered input-sm" placeholder="e.g. Vehicle 88" bind:value={form.model} />
        </div>

        <!-- VIN last 4 -->
        <div class="form-control">
          <label class="label py-1" for="vvin"><span class="label-text font-medium">VIN (last 4)</span></label>
          <input id="vvin" type="text" class="input input-bordered input-sm" maxlength="4" placeholder="e.g. 7816" bind:value={form.serialNumber} />
        </div>

        <!-- License Plate -->
        <div class="form-control">
          <label class="label py-1" for="vplate"><span class="label-text font-medium">License Plate</span></label>
          <input id="vplate" type="text" class="input input-bordered input-sm" placeholder="e.g. FBL-U82" bind:value={form.identifier} />
        </div>

        <!-- Condition -->
        <div class="form-control">
          <label class="label py-1" for="vcond"><span class="label-text font-medium">Condition</span></label>
          <select id="vcond" class="select select-bordered select-sm" bind:value={form.condition}>
            {#each conditions as c}
              <option value={c.value}>{c.label}</option>
            {/each}
          </select>
        </div>

        <!-- Assigned To Employee -->
        <div class="form-control">
          <label class="label py-1" for="vassign"><span class="label-text font-medium">Assigned Driver</span></label>
          <select id="vassign" class="select select-bordered select-sm" bind:value={form.assignedToEmployee}>
            <option value="">— Unassigned —</option>
            {#each employeeList as emp}
              <option value={String(emp.id)}>{emp.lastName}, {emp.firstName} ({emp.employeeNumber})</option>
            {/each}
          </select>
        </div>

        <!-- Status -->
        <div class="form-control">
          <label class="label py-1" for="vstatus"><span class="label-text font-medium">Status</span></label>
          <select id="vstatus" class="select select-bordered select-sm" bind:value={form.status}>
            {#each statuses as s}
              <option value={s.value}>{s.label}</option>
            {/each}
          </select>
        </div>

        <!-- Photo -->
        <div class="form-control">
          <label class="label py-1" for="vphoto"><span class="label-text font-medium">Photo</span></label>
          <input id="vphoto" type="file" accept="image/jpeg,image/png,image/webp" class="file-input file-input-bordered file-input-sm w-full" on:change={handlePhotoSelect} />
          {#if photoFile}
            <span class="text-xs text-success mt-1">&#10003; {photoFile.name}</span>
          {/if}
        </div>

        <!-- Notes -->
        <div class="form-control sm:col-span-2">
          <label class="label py-1" for="vnotes"><span class="label-text font-medium">Notes</span></label>
          <textarea id="vnotes" class="textarea textarea-bordered textarea-sm" rows="2" placeholder="Mileage, maintenance notes, accessories..." bind:value={form.notes}></textarea>
        </div>
      </div>

      <div class="modal-action">
        <button class="btn btn-ghost btn-sm" on:click={() => showModal = false}>Cancel</button>
        <button
          class="btn btn-primary btn-sm"
          disabled={!form.description || photoUploading}
          on:click={handleSave}
        >
          {#if photoUploading}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          {editing ? "Save Changes" : "Add Vehicle"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .vehicle-sort {
    cursor: pointer;
    user-select: none;
    transition: color 0.15s;
  }
  .vehicle-sort:hover {
    color: #1d1d1f;
  }
  .vehicle-arrow {
    display: inline-block;
    font-size: 0.625rem;
    margin-left: 2px;
    opacity: 0.5;
  }
</style>
