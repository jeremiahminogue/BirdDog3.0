<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user, currentPage, selectedEmployeeId } from "../lib/stores";
  import AddressPicker from "../components/AddressPicker.svelte";

  let employees: any[] = [];
  let loading = true;
  let search = "";
  let statusFilter = "active";
  let showAddModal = false;
  let editingEmployee: any = null;

  // New employee form
  let form = resetForm();

  function resetForm() {
    return {
      employeeNumber: "", firstName: "", lastName: "",
      classificationId: null as number | null,
      phone: "", pePhone: "", personalEmail: "", workEmail: "",
      address: "", emergencyContactName: "", emergencyContactPhone: "",
      dateOfHire: "", dateOfBirth: "", placeOfBirth: "",
      shirtSize: "", jacketSize: "",
      elecLicense: "", dlNumber: "",
      backgroundCheck: "", backgroundCheckDate: "",
      notes: "",
    };
  }

  let classifications: any[] = [];

  onMount(async () => {
    await Promise.all([loadEmployees(), loadClassifications()]);
  });

  async function loadEmployees() {
    loading = true;
    employees = await api.get(`/employees?status=${statusFilter}`);
    loading = false;
  }

  async function loadClassifications() {
    classifications = await api.get("/classifications");
  }

  // Sorting
  let sortCol: string = "name";
  let sortAsc: boolean = true;

  function toggleSort(col: string) {
    if (sortCol === col) { sortAsc = !sortAsc; }
    else { sortCol = col; sortAsc = true; }
  }

  $: filteredEmployees = (() => {
    let list = employees.filter(e => {
      const term = search.toLowerCase();
      return term === "" ||
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(term) ||
        e.employeeNumber.toLowerCase().includes(term) ||
        (e.classificationName || "").toLowerCase().includes(term);
    });

    // Sort
    const dir = sortAsc ? 1 : -1;
    list = [...list].sort((a, b) => {
      let va: any, vb: any;
      switch (sortCol) {
        case "empNum":
          va = a.employeeNumber || ""; vb = b.employeeNumber || "";
          break;
        case "name":
          va = `${a.lastName} ${a.firstName}`.toLowerCase();
          vb = `${b.lastName} ${b.firstName}`.toLowerCase();
          break;
        case "classification":
          va = (a.classificationName || "").toLowerCase();
          vb = (b.classificationName || "").toLowerCase();
          break;
        case "license":
          va = a.elecLicense || ""; vb = b.elecLicense || "";
          break;
        case "phone":
          va = a.phone || ""; vb = b.phone || "";
          break;
        case "hireDate":
          va = a.dateOfHire || "9999"; vb = b.dateOfHire || "9999";
          break;
        default:
          return 0;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  })();

  async function handleSave() {
    try {
      if (editingEmployee) {
        await api.put(`/employees/${editingEmployee.id}`, form);
      } else {
        await api.post("/employees", form);
      }
      showAddModal = false;
      editingEmployee = null;
      form = resetForm();
      await loadEmployees();
    } catch (e: any) {
      alert(e.message);
    }
  }

  function startEdit(emp: any) {
    editingEmployee = emp;
    form = {
      employeeNumber: emp.employeeNumber,
      firstName: emp.firstName,
      lastName: emp.lastName,
      classificationId: emp.classificationId,
      phone: emp.phone || "",
      pePhone: emp.pePhone || "",
      personalEmail: emp.personalEmail || "",
      workEmail: emp.workEmail || "",
      address: emp.address || "",
      emergencyContactName: emp.emergencyContactName || "",
      emergencyContactPhone: emp.emergencyContactPhone || "",
      dateOfHire: emp.dateOfHire || "",
      dateOfBirth: emp.dateOfBirth || "",
      placeOfBirth: emp.placeOfBirth || "",
      shirtSize: emp.shirtSize || "",
      jacketSize: emp.jacketSize || "",
      elecLicense: emp.elecLicense || "",
      dlNumber: emp.dlNumber || "",
      backgroundCheck: emp.backgroundCheck || "",
      backgroundCheckDate: emp.backgroundCheckDate || "",
      notes: emp.notes || "",
    };
    showAddModal = true;
  }

  function startAdd() {
    editingEmployee = null;
    form = resetForm();
    showAddModal = true;
  }

  // ── Status toggle ──────────────────────────────────────────────
  let showDeactivateModal = false;
  let deactivateTarget: any = null;
  let deactivateReason = "";

  function startDeactivate(emp: any) {
    deactivateTarget = emp;
    deactivateReason = "";
    showDeactivateModal = true;
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    try {
      await api.put(`/employees/${deactivateTarget.id}/status`, {
        status: "inactive",
        reasonForLeaving: deactivateReason || null,
      });
      showDeactivateModal = false;
      deactivateTarget = null;
      deactivateReason = "";
      await loadEmployees();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleReactivate(emp: any) {
    if (!confirm(`Reactivate ${emp.firstName} ${emp.lastName}?`)) return;
    try {
      await api.put(`/employees/${emp.id}/status`, { status: "active" });
      await loadEmployees();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleDelete(emp: any) {
    if (!confirm(`Permanently delete #${emp.employeeNumber} - ${emp.firstName} ${emp.lastName}?\n\nThis only works for records with no history (no assignments, logs, etc.). Otherwise, deactivate them.`)) return;
    try {
      await api.del(`/employees/${emp.id}`);
      await loadEmployees();
    } catch (e: any) {
      alert(e.message);
    }
  }

  function openProfile(emp: any) {
    selectedEmployeeId.set(emp.id);
    currentPage.set("employee-profile");
  }

  $: canEdit = $user?.role === "super_admin" || $user?.role === "admin" || $user?.role === "pm";
  $: isAdmin = $user?.role === "admin" || $user?.role === "super_admin";
</script>

<div class="space-y-4">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
    <h1 class="page-title">
      Employees
      <span class="badge badge-sm bg-base-200 text-base-content/60 border-0 ml-1">{filteredEmployees.length}</span>
    </h1>
    <div class="flex gap-2">
      <input
        type="text"
        placeholder="Search..."
        class="input input-sm input-bordered w-48"
        bind:value={search}
      />
      <select class="select select-sm select-bordered" bind:value={statusFilter} on:change={loadEmployees}>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
      {#if canEdit}
        <button class="btn btn-sm btn-primary" on:click={startAdd}>+ Add Employee</button>
      {/if}
    </div>
  </div>

  <!-- Table -->
  {#if loading}
    <div class="flex justify-center p-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {:else}
    <div class="overflow-x-auto apple-panel">
      <table class="table table-sm apple-table">
        <thead>
          <tr>
            <th></th>
            <th class="emp-sort" on:click={() => toggleSort("empNum")}>Emp # {#if sortCol === "empNum"}<span class="emp-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="emp-sort" on:click={() => toggleSort("name")}>Name {#if sortCol === "name"}<span class="emp-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="emp-sort" on:click={() => toggleSort("classification")}>Classification {#if sortCol === "classification"}<span class="emp-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="emp-sort" on:click={() => toggleSort("license")}>License {#if sortCol === "license"}<span class="emp-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="emp-sort" on:click={() => toggleSort("phone")}>Phone {#if sortCol === "phone"}<span class="emp-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            <th class="emp-sort" on:click={() => toggleSort("hireDate")}>Hire Date {#if sortCol === "hireDate"}<span class="emp-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
            {#if canEdit}<th class="text-center">Actions</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each filteredEmployees as emp (emp.id)}
            <tr class="hover cursor-pointer" on:click={() => openProfile(emp)}>
              <td class="w-10">
                {#if emp.photoUrl}
                  <img src={emp.photoUrl} alt="" class="w-8 h-8 rounded-full object-cover" />
                {:else}
                  <div class="w-8 h-8 rounded-full bg-base-200 text-base-content/60 flex items-center justify-center text-xs font-bold">
                    {(emp.firstName?.[0] || "") + (emp.lastName?.[0] || "")}
                  </div>
                {/if}
              </td>
              <td class="font-mono text-xs">{emp.employeeNumber}</td>
              <td class="font-medium text-primary">{emp.firstName} {emp.lastName}</td>
              <td>
                <span
                  class="badge badge-sm text-white"
                  style="background-color: {emp.classificationColor || '#64748b'}"
                >
                  {emp.classificationName || "—"}
                </span>
              </td>
              <td class="text-xs font-mono text-base-content/60">{emp.elecLicense || "—"}</td>
              <td class="text-sm">{emp.phone || "—"}</td>
              <td class="text-sm">{emp.dateOfHire || "—"}</td>
              {#if canEdit}
                <td>
                  <div class="flex items-center justify-center gap-1">
                    <button class="btn btn-xs btn-ghost" on:click|stopPropagation={() => startEdit(emp)}>Edit</button>
                    {#if isAdmin}
                      {#if emp.status === "active"}
                        <button class="btn btn-xs btn-ghost text-warning" on:click|stopPropagation={() => startDeactivate(emp)}>Deactivate</button>
                      {:else}
                        <button class="btn btn-xs btn-ghost text-success" on:click|stopPropagation={() => handleReactivate(emp)}>Reactivate</button>
                      {/if}
                      <button class="btn btn-xs btn-ghost text-error" on:click|stopPropagation={() => handleDelete(emp)}>Del</button>
                    {/if}
                  </div>
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if filteredEmployees.length === 0}
        <div class="text-center p-8 text-base-content/50">No employees found</div>
      {/if}
    </div>
  {/if}
</div>

<!-- Add/Edit Modal -->
{#if showAddModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-2xl max-h-[85vh]">
      <h3 class="font-bold text-lg mb-4">
        {editingEmployee ? "Edit Employee" : "Add Employee"}
      </h3>
      <form on:submit|preventDefault={handleSave} class="space-y-4 overflow-y-auto pr-1">
        <!-- Basic Info -->
        <div class="text-xs font-bold text-primary uppercase tracking-wider">Basic Info</div>
        <div class="grid grid-cols-3 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-number">Employee #</label>
            <input id="emp-number" class="input input-sm input-bordered" bind:value={form.employeeNumber} required />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-first">First Name</label>
            <input id="emp-first" class="input input-sm input-bordered" bind:value={form.firstName} required />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-last">Last Name</label>
            <input id="emp-last" class="input input-sm input-bordered" bind:value={form.lastName} required />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-class">Classification</label>
            <select id="emp-class" class="select select-sm select-bordered" bind:value={form.classificationId}>
              <option value={null}>Select...</option>
              {#each classifications as cls}
                <option value={cls.id}>{cls.name} ({cls.department})</option>
              {/each}
            </select>
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-hire">Hire Date</label>
            <input id="emp-hire" class="input input-sm input-bordered" type="date" bind:value={form.dateOfHire} />
          </div>
        </div>

        <!-- Contact -->
        <div class="divider my-1"></div>
        <div class="text-xs font-bold text-primary uppercase tracking-wider">Contact</div>
        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-phone">Home Phone</label>
            <input id="emp-phone" class="input input-sm input-bordered" bind:value={form.phone} />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-pephone">PE Cell</label>
            <input id="emp-pephone" class="input input-sm input-bordered" bind:value={form.pePhone} />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-pemail">Personal Email</label>
            <input id="emp-pemail" class="input input-sm input-bordered" type="email" bind:value={form.personalEmail} />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-wemail">Work Email</label>
            <input id="emp-wemail" class="input input-sm input-bordered" type="email" bind:value={form.workEmail} />
          </div>
        </div>
        <div class="form-control">
          <label class="label label-text text-xs">Address</label>
          <AddressPicker
            bind:value={form.address}
            placeholder="Start typing an address..."
            on:select={(e) => { form.address = e.detail.address; }}
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-ecname">Emergency Contact</label>
            <input id="emp-ecname" class="input input-sm input-bordered" bind:value={form.emergencyContactName} placeholder="Name" />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-ecphone">Emergency Phone</label>
            <input id="emp-ecphone" class="input input-sm input-bordered" bind:value={form.emergencyContactPhone} />
          </div>
        </div>

        <!-- Personal -->
        <div class="divider my-1"></div>
        <div class="text-xs font-bold text-primary uppercase tracking-wider">Personal</div>
        <div class="grid grid-cols-3 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-dob">Date of Birth</label>
            <input id="emp-dob" class="input input-sm input-bordered" type="date" bind:value={form.dateOfBirth} />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-pob">Place of Birth</label>
            <input id="emp-pob" class="input input-sm input-bordered" bind:value={form.placeOfBirth} />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-shirt">Shirt Size</label>
            <input id="emp-shirt" class="input input-sm input-bordered" bind:value={form.shirtSize} />
          </div>
        </div>
        <div class="form-control w-1/3">
          <label class="label label-text text-xs" for="emp-jacket">Jacket Size</label>
          <input id="emp-jacket" class="input input-sm input-bordered" bind:value={form.jacketSize} />
        </div>

        <!-- License & Compliance -->
        <div class="divider my-1"></div>
        <div class="text-xs font-bold text-primary uppercase tracking-wider">License & Compliance</div>
        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-elec">Electrical License #</label>
            <input id="emp-elec" class="input input-sm input-bordered" bind:value={form.elecLicense} />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-dl">Driver's License #</label>
            <input id="emp-dl" class="input input-sm input-bordered" bind:value={form.dlNumber} />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-bg">Background Check</label>
            <input id="emp-bg" class="input input-sm input-bordered" bind:value={form.backgroundCheck} placeholder="e.g. CBI" />
          </div>
          <div class="form-control">
            <label class="label label-text text-xs" for="emp-bgdate">BG Check Date</label>
            <input id="emp-bgdate" class="input input-sm input-bordered" type="date" bind:value={form.backgroundCheckDate} />
          </div>
        </div>

        <!-- Notes -->
        <div class="divider my-1"></div>
        <div class="form-control">
          <label class="label label-text text-xs" for="emp-notes">Notes</label>
          <textarea id="emp-notes" class="textarea textarea-bordered textarea-sm" rows="2" bind:value={form.notes}></textarea>
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-sm btn-ghost" on:click={() => { showAddModal = false; editingEmployee = null; }}>
            Cancel
          </button>
          <button type="submit" class="btn btn-sm btn-primary">
            {editingEmployee ? "Save Changes" : "Add Employee"}
          </button>
        </div>
      </form>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={() => { showAddModal = false; editingEmployee = null; }}></div>
  </div>
{/if}

<!-- Deactivate Modal -->
{#if showDeactivateModal && deactivateTarget}
  <div class="modal modal-open">
    <div class="modal-box max-w-md">
      <h3 class="font-bold text-lg">Deactivate Employee</h3>
      <p class="text-sm text-base-content/60 mt-2">
        <strong>{deactivateTarget.firstName} {deactivateTarget.lastName}</strong> (#{deactivateTarget.employeeNumber}) will be moved to Inactive.
        Their active job assignments will be removed from the workforce board.
      </p>
      <div class="form-control mt-4">
        <label class="label" for="deact-reason">
          <span class="label-text">Reason for Leaving <span class="text-base-content/40">(optional)</span></span>
        </label>
        <textarea
          id="deact-reason"
          class="textarea textarea-bordered text-sm"
          rows="3"
          placeholder="e.g. Left for another contractor, seasonal layoff, moved out of area..."
          bind:value={deactivateReason}
        ></textarea>
      </div>
      <div class="modal-action">
        <button class="btn btn-ghost" on:click={() => { showDeactivateModal = false; deactivateTarget = null; }}>Cancel</button>
        <button class="btn btn-warning" on:click={confirmDeactivate}>Deactivate</button>
      </div>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={() => { showDeactivateModal = false; deactivateTarget = null; }}></div>
  </div>
{/if}

<style>
  .emp-sort {
    cursor: pointer;
    user-select: none;
    transition: color 0.15s;
  }
  .emp-sort:hover {
    color: #1d1d1f;
  }
  .emp-arrow {
    display: inline-block;
    font-size: 0.625rem;
    margin-left: 2px;
    opacity: 0.5;
  }
</style>
