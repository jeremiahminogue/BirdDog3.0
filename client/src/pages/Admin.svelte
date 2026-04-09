<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  // ── Users state ──────────────────────────────────────────────
  let users: any[] = [];
  let loadingUsers = true;
  let showUserModal = false;
  let editingUser: any = null;

  let userForm = resetUserForm();
  let employeeList: any[] = [];

  function resetUserForm() {
    return {
      username: "",
      displayName: "",
      role: "field_staff" as "super_admin" | "admin" | "pm" | "foreman" | "field_staff",
      password: "",
      employeeId: null as number | null,
    };
  }

  // ── Companies state ────────────────────────────────────────────
  let companyList: any[] = [];
  let loadingCompanies = false;
  let showCompanyModal = false;
  let editingCompany: any = null;
  let companyForm = { name: "", shortName: "" };

  // ── Settings state ──────────────────────────────────────────
  let companyName = "";
  let companyShort = "";
  let companyLogo = "";
  let autoDeductLunch = false;
  let settingsSaving = false;
  let settingsSaved = false;
  let logoUploading = false;

  // ── Password reset ──────────────────────────────────────────
  let resetUserId: number | null = null;
  let newPassword = "";

  $: isSuperAdmin = $user?.role === "super_admin";

  onMount(async () => {
    const promises: Promise<any>[] = [loadUsers(), loadSettings(), loadGcCompanies(), loadSuppliers(), loadImportStatus(), loadEmployees()];
    if ($user?.role === "super_admin") {
      promises.push(loadCompanies());
    }
    await Promise.all(promises);
  });

  async function loadUsers() {
    loadingUsers = true;
    users = await api.get("/users");
    loadingUsers = false;
  }

  async function loadEmployees() {
    try {
      employeeList = await api.get("/employees");
    } catch { employeeList = []; }
  }

  async function loadCompanies() {
    loadingCompanies = true;
    try {
      companyList = await api.get("/companies");
    } catch { companyList = []; }
    loadingCompanies = false;
  }

  async function loadSettings() {
    const s = await api.get("/settings");
    companyName = s.companyName || "";
    companyShort = s.companyShort || "";
    companyLogo = s.companyLogo || "";
    autoDeductLunch = s.autoDeductLunch === "true";
  }

  async function handleLogoUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Logo must be under 5MB"); return; }
    logoUploading = true;
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await fetch("/api/logo", { method: "POST", headers: { "X-Requested-With": "BirdDog" }, body: formData, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      companyLogo = data.logoUrl + "?t=" + Date.now();
    } catch (err: any) {
      alert(err.message || "Upload failed");
    }
    logoUploading = false;
    input.value = "";
  }

  async function saveSettings() {
    settingsSaving = true;
    settingsSaved = false;
    try {
      await api.put("/settings", { companyName, companyShort, autoDeductLunch: String(autoDeductLunch) });
      settingsSaved = true;
      setTimeout(() => (settingsSaved = false), 2000);
    } catch (e: any) {
      alert(e.message);
    }
    settingsSaving = false;
  }

  function startAddUser() {
    editingUser = null;
    userForm = resetUserForm();
    showUserModal = true;
  }

  function startEditUser(u: any) {
    editingUser = u;
    userForm = {
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      password: "",
      employeeId: u.employeeId || null,
    };
    showUserModal = true;
  }

  async function handleSaveUser() {
    try {
      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, {
          username: userForm.username,
          displayName: userForm.displayName,
          role: userForm.role,
          employeeId: userForm.employeeId || null,
          isActive: editingUser.isActive,
        });
      } else {
        if (!userForm.password || userForm.password.length < 6) {
          alert("Password must be at least 6 characters");
          return;
        }
        await api.post("/users", {
          username: userForm.username,
          displayName: userForm.displayName,
          role: userForm.role,
          employeeId: userForm.employeeId || null,
          password: userForm.password,
        });
      }
      showUserModal = false;
      editingUser = null;
      userForm = resetUserForm();
      await loadUsers();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function toggleActive(u: any) {
    const action = u.isActive ? "deactivate" : "reactivate";
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} user "${u.displayName}"?`)) return;
    try {
      await api.put(`/users/${u.id}`, { isActive: !u.isActive });
      await loadUsers();
    } catch (e: any) {
      alert(e.message);
    }
  }

  function startResetPassword(u: any) {
    resetUserId = u.id;
    newPassword = "";
  }

  async function handleResetPassword() {
    if (!newPassword || newPassword.length < 6) {
      alert("Password must be at least 6 characters");
      return;
    }
    try {
      await api.post(`/users/${resetUserId}/reset-password`, { newPassword });
      resetUserId = null;
      newPassword = "";
      alert("Password reset successfully");
    } catch (e: any) {
      alert(e.message);
    }
  }

  // ── Company management ─────────────────────────────────────
  function startAddCompany() {
    editingCompany = null;
    companyForm = { name: "", shortName: "" };
    showCompanyModal = true;
  }

  function startEditCompany(c: any) {
    editingCompany = c;
    companyForm = { name: c.name, shortName: c.shortName || "" };
    showCompanyModal = true;
  }

  async function handleSaveCompany() {
    try {
      if (editingCompany) {
        await api.put(`/companies/${editingCompany.id}`, companyForm);
      } else {
        await api.post("/companies", companyForm);
      }
      showCompanyModal = false;
      editingCompany = null;
      await loadCompanies();
    } catch (e: any) {
      alert(e.message);
    }
  }

  // ── GC Companies state ──────────────────────────────────────
  let gcCompanies: any[] = [];
  let loadingGcs = false;
  let showGcModal = false;
  let editingGc: any = null;
  let gcForm = { name: "", website: "", notes: "" };

  async function loadGcCompanies() {
    loadingGcs = true;
    try { gcCompanies = await api.get("/opportunities/gc-companies"); } catch { gcCompanies = []; }
    loadingGcs = false;
  }

  function startAddGc() { editingGc = null; gcForm = { name: "", website: "", notes: "" }; showGcModal = true; }
  function startEditGc(gc: any) { editingGc = gc; gcForm = { name: gc.name, website: gc.website || "", notes: gc.notes || "" }; showGcModal = true; }

  async function handleSaveGc() {
    try {
      if (editingGc) { await api.put(`/opportunities/gc-companies/${editingGc.id}`, gcForm); }
      else { await api.post("/opportunities/gc-companies", gcForm); }
      showGcModal = false; editingGc = null;
      await loadGcCompanies();
    } catch (e: any) { alert(e.message); }
  }

  async function deleteGc(gc: any) {
    if (!confirm(`Delete GC "${gc.name}"?`)) return;
    try { await api.del(`/opportunities/gc-companies/${gc.id}`); await loadGcCompanies(); }
    catch (e: any) { alert(e.message); }
  }

  // ── Suppliers state ────────────────────────────────────────
  let supplierList: any[] = [];
  let loadingSuppliers = false;
  let showSupplierModal = false;
  let editingSupplier: any = null;
  let supplierForm = { name: "", website: "", notes: "" };

  async function loadSuppliers() {
    loadingSuppliers = true;
    try { supplierList = await api.get("/opportunities/suppliers"); } catch { supplierList = []; }
    loadingSuppliers = false;
  }

  function startAddSupplier() { editingSupplier = null; supplierForm = { name: "", website: "", notes: "" }; showSupplierModal = true; }
  function startEditSupplier(s: any) { editingSupplier = s; supplierForm = { name: s.name, website: s.website || "", notes: s.notes || "" }; showSupplierModal = true; }

  async function handleSaveSupplier() {
    try {
      if (editingSupplier) { await api.put(`/opportunities/suppliers/${editingSupplier.id}`, supplierForm); }
      else { await api.post("/opportunities/suppliers", supplierForm); }
      showSupplierModal = false; editingSupplier = null;
      await loadSuppliers();
    } catch (e: any) { alert(e.message); }
  }

  async function deleteSupplier(s: any) {
    if (!confirm(`Delete supplier "${s.name}"?`)) return;
    try { await api.del(`/opportunities/suppliers/${s.id}`); await loadSuppliers(); }
    catch (e: any) { alert(e.message); }
  }

  // ── Opportunity Import state ─────────────────────────────────
  let importFile: File | null = null;
  let importFileInput: HTMLInputElement;
  let importingOpps = false;
  let importOppResult: any = null;
  let importOppError = "";
  let showImportConfirm = false;
  let importStatus: any = null;

  async function loadImportStatus() {
    try { importStatus = await api.get("/import/opportunities/status"); } catch { importStatus = null; }
  }

  function onImportFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    importFile = target.files?.[0] ?? null;
    importOppResult = null;
    importOppError = "";
  }

  async function runOpportunityImport() {
    if (!importFile) return;
    showImportConfirm = false;
    importingOpps = true;
    importOppResult = null;
    importOppError = "";
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      const res = await fetch("/api/import/opportunities", {
        method: "POST",
        headers: { "X-Requested-With": "BirdDog" },
        body: fd,
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      importOppResult = data;
      await loadImportStatus();
      await loadGcCompanies();
      await loadSuppliers();
    } catch (e: any) {
      importOppError = e.message;
    }
    importingOpps = false;
  }

  const roleLabels: Record<string, string> = {
    super_admin: "Super Admin — Full access, manage companies & system settings",
    admin: "Admin — Full access, manage users & finance data",
    pm: "Project Manager — Add/edit jobs, employees & approve time",
    foreman: "Foreman — Crew management, daily reports, toolbox talks",
    field_staff: "Field Staff — Clock in/out, view assignments & assets",
  };

  const roleBadgeClass: Record<string, string> = {
    super_admin: "badge-primary",
    admin: "badge-error",
    pm: "badge-warning",
    foreman: "badge-info",
    field_staff: "badge-success",
    readonly: "badge-info",
  };
</script>

<div class="space-y-8">
  <!-- ═══ COMPANY SETTINGS ═══ -->
  <div>
    <h1 class="page-title mb-6">Settings</h1>

    <div class="admin-settings-grid">
      <!-- ── Branding Card ── -->
      <div class="admin-card">
        <div class="admin-card-header">
          <svg class="admin-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          <h3 class="admin-card-title">Branding</h3>
        </div>
        <p class="admin-card-desc">Company identity shown on login, reports, and the mobile app.</p>

        {#if isSuperAdmin}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label py-1" for="company-name">
                <span class="label-text font-medium text-sm">Company Name</span>
              </label>
              <input id="company-name" type="text" class="input input-sm input-bordered" bind:value={companyName} placeholder="e.g. Pueblo Electrics" />
              <label class="label py-0.5"><span class="label-text-alt text-base-content/40 text-xs">Login page &amp; reports</span></label>
            </div>
            <div class="form-control">
              <label class="label py-1" for="company-short">
                <span class="label-text font-medium text-sm">Short Name / Initials</span>
              </label>
              <input id="company-short" type="text" class="input input-sm input-bordered" bind:value={companyShort} placeholder="e.g. PE" />
              <label class="label py-0.5"><span class="label-text-alt text-base-content/40 text-xs">Optional abbreviation</span></label>
            </div>
          </div>
        {:else}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2">
            <div>
              <span class="text-xs text-base-content/50 uppercase tracking-wide">Company Name</span>
              <p class="font-medium mt-1 text-sm">{companyName || "—"}</p>
            </div>
            <div>
              <span class="text-xs text-base-content/50 uppercase tracking-wide">Short Name</span>
              <p class="font-medium mt-1 text-sm">{companyShort || "—"}</p>
            </div>
          </div>
        {/if}

        <div class="admin-logo-row">
          {#if companyLogo}
            <img src={companyLogo} alt="Company Logo" class="admin-logo-preview" />
          {:else}
            <div class="admin-logo-empty">No logo</div>
          {/if}
          <label class="btn btn-xs btn-outline cursor-pointer">
            {#if logoUploading}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              {companyLogo ? "Change" : "Upload"}
            {/if}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" class="hidden" on:change={handleLogoUpload} disabled={logoUploading} />
          </label>
          <span class="text-xs text-base-content/40">Used on printed reports</span>
        </div>

        {#if !isSuperAdmin}
          <p class="text-xs text-base-content/40 mt-3">Company name is managed by your super admin</p>
        {/if}
      </div>

      <!-- ── Timekeeping Card ── -->
      <div class="admin-card">
        <div class="admin-card-header">
          <svg class="admin-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <h3 class="admin-card-title">Timekeeping</h3>
        </div>
        <p class="admin-card-desc">Rules applied automatically when employees clock in and out.</p>

        <label class="admin-toggle-row">
          <input type="checkbox" class="toggle toggle-sm toggle-primary" bind:checked={autoDeductLunch} disabled={!isSuperAdmin} />
          <div>
            <span class="font-medium text-sm">Auto-Deduct 30-Min Lunch</span>
            <p class="text-xs text-base-content/50 mt-0.5">Deduct 30 minutes from shifts over 5 hours if no break was logged</p>
          </div>
        </label>
      </div>
    </div>

    <!-- Save bar -->
    {#if isSuperAdmin}
      <div class="admin-save-bar">
        <button class="btn btn-sm btn-primary" on:click={saveSettings} disabled={settingsSaving}>
          {#if settingsSaving}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          Save Settings
        </button>
        {#if settingsSaved}
          <span class="admin-saved-badge">Saved!</span>
        {/if}
      </div>
    {/if}
  </div>

  <!-- ═══ IMPORT OPPORTUNITIES (super_admin only) ═══ -->
  {#if isSuperAdmin}
    <div>
      <h2 class="text-2xl font-bold mb-4">Import Opportunities</h2>
      <div class="apple-panel p-6">
        <p class="text-sm text-base-content/60 mb-4">
          Upload your Projects Bidding spreadsheet to seed GC companies, suppliers, and opportunity records.
          <strong>This will replace all existing opportunity data.</strong>
        </p>

        {#if importStatus}
          <div class="flex flex-wrap gap-4 mb-4 text-sm">
            <span class="flex items-center gap-1"><span class="font-medium">Opportunities:</span> {importStatus.opportunities}</span>
            <span class="flex items-center gap-1"><span class="font-medium">GC Companies:</span> {importStatus.gcCompanies}</span>
            <span class="flex items-center gap-1"><span class="font-medium">Suppliers:</span> {importStatus.suppliers}</span>
            <span class="flex items-center gap-1"><span class="font-medium">GC Bids:</span> {importStatus.gcBids}</span>
            <span class="flex items-center gap-1"><span class="font-medium">Supplier Links:</span> {importStatus.supplierLinks}</span>
          </div>
        {/if}

        <div class="flex items-center gap-3 mb-4">
          <input type="file" accept=".xlsx,.xls" class="file-input file-input-bordered file-input-sm w-full max-w-xs"
            bind:this={importFileInput} on:change={onImportFileChange} />
          <button class="btn btn-sm btn-primary" disabled={!importFile || importingOpps}
            on:click={() => { showImportConfirm = true; }}>
            {importingOpps ? "Importing..." : "Import"}
          </button>
        </div>

        {#if importingOpps}
          <div class="flex items-center gap-2 text-sm text-base-content/60">
            <span class="loading loading-spinner loading-sm"></span> Processing spreadsheet — this may take a moment...
          </div>
        {/if}

        {#if importOppResult}
          <div class="alert alert-success text-sm">
            <div>
              <p class="font-medium">Import complete!</p>
              <p>{importOppResult.stats.opportunities} opportunities, {importOppResult.stats.gcCompanies} GC companies, {importOppResult.stats.suppliers} suppliers, {importOppResult.stats.gcBids} GC bids, {importOppResult.stats.supplierLinks} supplier links</p>
              <p class="mt-1">Status breakdown: {importOppResult.stats.won} won, {importOppResult.stats.lost} lost, {importOppResult.stats.open} open, {importOppResult.stats.no_bid} no-bid</p>
              {#if importOppResult.unmatchedEstimators?.length}
                <p class="mt-1 text-warning">Unmatched estimators: {importOppResult.unmatchedEstimators.join(", ")}</p>
              {/if}
            </div>
          </div>
        {/if}

        {#if importOppError}
          <div class="alert alert-error text-sm">{importOppError}</div>
        {/if}
      </div>
    </div>

    <!-- Import confirm dialog -->
    {#if showImportConfirm}
      <div class="modal modal-open">
        <div class="modal-box">
          <h3 class="font-bold text-lg">Confirm Import</h3>
          <p class="py-4">This will <strong>delete all existing</strong> opportunities, GC bids, and supplier links, then re-seed from the spreadsheet. Continue?</p>
          <div class="modal-action">
            <button class="btn btn-ghost" on:click={() => { showImportConfirm = false; }}>Cancel</button>
            <button class="btn btn-error" on:click={runOpportunityImport}>Yes, Import</button>
          </div>
        </div>
        <div class="modal-backdrop" on:click={() => { showImportConfirm = false; }} on:keydown={() => {}}></div>
      </div>
    {/if}
  {/if}

  <!-- GC Companies and Suppliers have their own dedicated pages under People → sidebar -->

  <!-- ═══ COMPANIES (super_admin only) ═══ -->
  {#if isSuperAdmin}
    <div>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-2xl font-bold">
          Companies
          <span class="badge badge-sm bg-base-200 text-base-content/60 border-0 ml-1">{companyList.length}</span>
        </h2>
        <button class="btn btn-sm btn-primary" on:click={startAddCompany}>+ Add Company</button>
      </div>

      {#if loadingCompanies}
        <div class="flex justify-center p-8">
          <span class="loading loading-spinner loading-md text-primary"></span>
        </div>
      {:else}
        <div class="overflow-x-auto apple-panel">
          <table class="table table-sm apple-table">
            <thead>
              <tr>
                <th>Company Name</th>
                <th>Short Name</th>
                <th>Status</th>
                <th>Users</th>
                <th class="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each companyList as c (c.id)}
                {@const companyUsers = users.filter(u => u.companyId === c.id)}
                <tr class="hover">
                  <td class="font-medium">{c.name}</td>
                  <td class="text-sm text-base-content/60">{c.shortName || "—"}</td>
                  <td>
                    {#if c.isActive}
                      <span class="badge badge-sm badge-success badge-outline">Active</span>
                    {:else}
                      <span class="badge badge-sm badge-ghost">Inactive</span>
                    {/if}
                  </td>
                  <td class="text-sm">{companyUsers.length}</td>
                  <td class="text-center">
                    <button class="btn btn-xs btn-ghost" on:click={() => startEditCompany(c)}>Edit</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}

  <!-- ═══ USER MANAGEMENT ═══ -->
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold">
        Users
        <span class="badge badge-sm bg-base-200 text-base-content/60 border-0 ml-1">{users.length}</span>
      </h2>
      <button class="btn btn-sm btn-primary" on:click={startAddUser}>+ Add User</button>
    </div>

    <!-- Roles legend -->
    <div class="flex flex-wrap gap-3 mb-4 text-sm">
      {#each Object.entries(roleLabels) as [role, desc]}
        {#if role !== "super_admin" || isSuperAdmin}
          <span class="flex items-center gap-1">
            <span class="badge badge-sm {roleBadgeClass[role]}">{role.replace("_", " ")}</span>
            <span class="text-base-content/60">{desc.split(" — ")[1]}</span>
          </span>
        {/if}
      {/each}
    </div>

    {#if loadingUsers}
      <div class="flex justify-center p-12">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>
    {:else}
      <div class="overflow-x-auto apple-panel">
        <table class="table table-sm apple-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Display Name</th>
              <th>Linked Employee</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th class="text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each users as u (u.id)}
              <tr class="hover" class:opacity-50={!u.isActive}>
                <td class="font-mono text-sm">{u.username}</td>
                <td class="font-medium">{u.displayName}</td>
                <td class="text-sm">
                  {#if u.employeeName}
                    <span class="flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" /></svg>
                      {u.employeeName}
                    </span>
                  {:else}
                    <span class="text-base-content/30">—</span>
                  {/if}
                </td>
                <td>
                  <span class="badge badge-sm {roleBadgeClass[u.role] || 'badge-ghost'}">{u.role.replace("_", " ")}</span>
                </td>
                <td>
                  {#if u.isActive}
                    <span class="badge badge-sm badge-success badge-outline">Active</span>
                  {:else}
                    <span class="badge badge-sm badge-ghost">Inactive</span>
                  {/if}
                </td>
                <td class="text-sm text-base-content/60">
                  {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : "Never"}
                </td>
                <td>
                  <div class="flex items-center justify-center gap-1">
                    {#if u.role === "super_admin" && !isSuperAdmin}
                      <span class="text-xs text-base-content/30">—</span>
                    {:else}
                      <button class="btn btn-xs btn-ghost" on:click={() => startEditUser(u)}>Edit</button>
                      <button class="btn btn-xs btn-ghost" on:click={() => startResetPassword(u)}>Reset PW</button>
                      {#if u.id !== $user?.id}
                        <button
                          class="btn btn-xs btn-ghost"
                          class:text-error={u.isActive}
                          class:text-success={!u.isActive}
                          on:click={() => toggleActive(u)}
                        >
                          {u.isActive ? "Deactivate" : "Activate"}
                        </button>
                      {/if}
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<!-- ═══ ADD/EDIT USER MODAL ═══ -->
{#if showUserModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-md">
      <h3 class="font-bold text-lg mb-4">
        {editingUser ? "Edit User" : "Add User"}
      </h3>
      <form on:submit|preventDefault={handleSaveUser} class="space-y-3">
        <div class="form-control">
          <label class="label label-text text-xs" for="u-username">Username</label>
          <input
            id="u-username"
            class="input input-sm input-bordered"
            bind:value={userForm.username}
            required
            autocomplete="off"
          />
        </div>
        <div class="form-control">
          <label class="label label-text text-xs" for="u-display">Display Name</label>
          <input
            id="u-display"
            class="input input-sm input-bordered"
            bind:value={userForm.displayName}
            required
          />
        </div>
        <div class="form-control">
          <label class="label label-text text-xs" for="u-role">Role</label>
          <select id="u-role" class="select select-sm select-bordered" bind:value={userForm.role}>
            {#if isSuperAdmin}
              <option value="super_admin">Super Admin</option>
            {/if}
            <option value="admin">Admin</option>
            <option value="pm">Project Manager</option>
            <option value="foreman">Foreman</option>
            <option value="field_staff">Field Staff</option>
          </select>
          <label class="label">
            <span class="label-text-alt text-base-content/50">{roleLabels[userForm.role] || ""}</span>
          </label>
        </div>
        <div class="form-control">
          <label class="label label-text text-xs" for="u-employee">Link to Employee</label>
          <select id="u-employee" class="select select-sm select-bordered"
            value={userForm.employeeId ?? ''}
            on:change={(e) => { const v = e.currentTarget.value; userForm.employeeId = v ? parseInt(v) : null; }}>
            <option value="">— No linked employee —</option>
            {#each employeeList.filter(e => e.status === 'active') as emp}
              <option value={emp.id}>{emp.firstName} {emp.lastName}{emp.classificationName ? ` (${emp.classificationName})` : ''}</option>
            {/each}
          </select>
          <label class="label">
            <span class="label-text-alt text-base-content/50">Links this login to an employee record for mobile access & identity</span>
          </label>
        </div>
        {#if !editingUser}
          <div class="form-control">
            <label class="label label-text text-xs" for="u-password">Password</label>
            <input
              id="u-password"
              type="password"
              class="input input-sm input-bordered"
              bind:value={userForm.password}
              required
              minlength="6"
              autocomplete="new-password"
            />
            <label class="label">
              <span class="label-text-alt text-base-content/50">Minimum 6 characters</span>
            </label>
          </div>
        {/if}
        <div class="modal-action">
          <button type="button" class="btn btn-sm btn-ghost" on:click={() => { showUserModal = false; editingUser = null; }}>
            Cancel
          </button>
          <button type="submit" class="btn btn-sm btn-primary">
            {editingUser ? "Save Changes" : "Add User"}
          </button>
        </div>
      </form>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={() => { showUserModal = false; editingUser = null; }}></div>
  </div>
{/if}

<!-- ═══ RESET PASSWORD MODAL ═══ -->
{#if resetUserId !== null}
  {@const targetUser = users.find(u => u.id === resetUserId)}
  <div class="modal modal-open">
    <div class="modal-box max-w-sm">
      <h3 class="font-bold text-lg mb-4">Reset Password</h3>
      <p class="text-sm text-base-content/70 mb-3">
        Set a new password for <strong>{targetUser?.displayName}</strong> ({targetUser?.username})
      </p>
      <form on:submit|preventDefault={handleResetPassword} class="space-y-3">
        <div class="form-control">
          <label class="label label-text text-xs" for="new-pw">New Password</label>
          <input
            id="new-pw"
            type="password"
            class="input input-sm input-bordered"
            bind:value={newPassword}
            required
            minlength="6"
            autocomplete="new-password"
          />
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-sm btn-ghost" on:click={() => { resetUserId = null; }}>
            Cancel
          </button>
          <button type="submit" class="btn btn-sm btn-primary">Reset Password</button>
        </div>
      </form>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={() => { resetUserId = null; }}></div>
  </div>
{/if}

<!-- ═══ ADD/EDIT COMPANY MODAL ═══ -->
{#if showCompanyModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-sm">
      <h3 class="font-bold text-lg mb-4">
        {editingCompany ? "Edit Company" : "Add Company"}
      </h3>
      <form on:submit|preventDefault={handleSaveCompany} class="space-y-3">
        <div class="form-control">
          <label class="label label-text text-xs" for="c-name">Company Name</label>
          <input
            id="c-name"
            class="input input-sm input-bordered"
            bind:value={companyForm.name}
            required
          />
        </div>
        <div class="form-control">
          <label class="label label-text text-xs" for="c-short">Short Name / Initials</label>
          <input
            id="c-short"
            class="input input-sm input-bordered"
            bind:value={companyForm.shortName}
            placeholder="e.g. PE"
          />
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-sm btn-ghost" on:click={() => { showCompanyModal = false; editingCompany = null; }}>
            Cancel
          </button>
          <button type="submit" class="btn btn-sm btn-primary">
            {editingCompany ? "Save Changes" : "Add Company"}
          </button>
        </div>
      </form>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={() => { showCompanyModal = false; editingCompany = null; }}></div>
  </div>
{/if}

<!-- GC Company and Supplier modals removed — use dedicated pages -->

<style>
  .admin-settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 16px;
    margin-bottom: 16px;
  }
  .admin-card {
    background: white;
    border: 1px solid hsl(var(--b3, 0 0% 90%));
    border-radius: 12px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .admin-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .admin-card-icon {
    width: 20px;
    height: 20px;
    color: #f97316;
    flex-shrink: 0;
  }
  .admin-card-title {
    font-size: 0.9375rem;
    font-weight: 700;
    color: hsl(var(--bc, 0 0% 10%));
    margin: 0;
  }
  .admin-card-desc {
    font-size: 0.75rem;
    color: hsl(var(--bc, 0 0% 10%) / 0.5);
    margin: -4px 0 4px;
    line-height: 1.4;
  }
  .admin-logo-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
  }
  .admin-logo-preview {
    height: 40px;
    max-width: 140px;
    object-fit: contain;
    border: 1px solid hsl(var(--b3, 0 0% 90%));
    border-radius: 6px;
    padding: 3px;
    background: white;
  }
  .admin-logo-empty {
    height: 40px;
    width: 100px;
    border: 1px dashed hsl(var(--b3, 0 0% 90%));
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: hsl(var(--bc, 0 0% 10%) / 0.25);
    font-size: 0.6875rem;
  }
  .admin-toggle-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    cursor: pointer;
    padding: 10px 12px;
    border-radius: 8px;
    background: hsl(var(--b2, 0 0% 97%));
    transition: background 0.15s;
  }
  .admin-toggle-row:hover {
    background: hsl(var(--b3, 0 0% 93%));
  }
  .admin-save-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 4px;
  }
  .admin-saved-badge {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #16a34a;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 100px;
    padding: 2px 10px;
    animation: admin-fade-in 0.2s ease;
  }
  @keyframes admin-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
