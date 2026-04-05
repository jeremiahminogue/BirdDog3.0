<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user, currentPage } from "../lib/stores";
  import PhotoCropper from "../components/PhotoCropper.svelte";

  export let employeeId: number;

  let emp: any = null;
  let assignedAssets: any[] = [];
  let loading = true;
  let uploading = false;
  let showCropper = false;
  let cropFile: File | null = null;

  $: canEdit = $user?.role === "super_admin" || $user?.role === "admin" || $user?.role === "pm";
  $: isAdmin = $user?.role === "admin" || $user?.role === "super_admin";

  // Status toggle state
  let showDeactivateModal = false;
  let deactivateReason = "";

  function startDeactivate() {
    deactivateReason = "";
    showDeactivateModal = true;
  }

  async function confirmDeactivate() {
    try {
      await api.put(`/employees/${employeeId}/status`, {
        status: "inactive",
        reasonForLeaving: deactivateReason || null,
      });
      showDeactivateModal = false;
      await loadEmployee();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleReactivate() {
    if (!confirm(`Reactivate ${emp.firstName} ${emp.lastName}?`)) return;
    try {
      await api.put(`/employees/${employeeId}/status`, { status: "active" });
      await loadEmployee();
    } catch (e: any) {
      alert(e.message);
    }
  }

  onMount(async () => {
    await loadEmployee();
  });

  async function loadEmployee() {
    loading = true;
    try {
      const [all, allAssets] = await Promise.all([
        api.get("/employees"),
        api.get("/assets"),
      ]);
      emp = all.find((e: any) => e.id === employeeId);
      assignedAssets = allAssets.filter((a: any) => a.assignedToEmployee === employeeId);
    } catch (e: any) {
      console.error(e);
    }
    loading = false;
  }

  $: assignedVehicles = assignedAssets.filter(a => a.type === "vehicle");
  $: assignedTools = assignedAssets.filter(a => a.type === "tool");

  function goBack() {
    currentPage.set("employees");
  }

  function handlePhotoSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("Photo must be under 10MB"); return; }
    cropFile = file;
    showCropper = true;
    input.value = "";
  }

  async function handleCroppedPhoto(e: CustomEvent<{ file: File }>) {
    showCropper = false;
    cropFile = null;
    uploading = true;
    try {
      const formData = new FormData();
      formData.append("photo", e.detail.file);
      const res = await fetch(`/api/employees/${employeeId}/photo`, {
        method: "POST",
        headers: { "X-Requested-With": "BirdDog" },
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      emp = { ...emp, photoUrl: data.photoUrl + "?t=" + Date.now() };
    } catch (err: any) {
      alert(err.message || "Upload failed");
    }
    uploading = false;
  }

  function initials(first: string, last: string): string {
    return ((first?.[0] || "") + (last?.[0] || "")).toUpperCase();
  }

  function formatDate(d: string | null): string {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return d;
    }
  }
</script>

{#if loading}
  <div class="flex justify-center p-12">
    <span class="loading loading-spinner loading-lg text-primary"></span>
  </div>
{:else if !emp}
  <div class="text-center p-12">
    <p class="text-base-content/50">Employee not found</p>
    <button class="btn btn-sm btn-ghost mt-4" on:click={goBack}>Back to Employees</button>
  </div>
{:else}
  <div class="space-y-4">
    <!-- Back button + Print -->
    <div class="flex items-center justify-between">
      <button class="btn btn-sm btn-ghost gap-1" on:click={goBack}>
        <span class="text-lg leading-none">&larr;</span> Back to Employees
      </button>
      {#if canEdit}
        <button class="btn btn-sm btn-outline btn-primary gap-1" on:click={() => window.open(`/api/reports/employee-profile?id=${employeeId}`, '_blank')}>
          Print Profile
        </button>
      {/if}
    </div>

    <!-- Header card with photo -->
    <div class="apple-panel p-6">
      <div class="flex flex-col sm:flex-row gap-6">
        <!-- Photo -->
        <div class="flex flex-col items-center gap-2">
          <div class="relative">
            {#if emp.photoUrl}
              <img
                src={emp.photoUrl}
                alt="{emp.firstName} {emp.lastName}"
                class="w-32 h-32 rounded-xl object-cover border-2 border-base-300"
              />
            {:else}
              <div class="w-32 h-32 rounded-xl bg-base-200 text-base-content/40 flex items-center justify-center text-4xl font-bold border-2 border-base-300">
                {initials(emp.firstName, emp.lastName)}
              </div>
            {/if}
          </div>
          {#if canEdit}
            <label class="btn btn-xs btn-ghost cursor-pointer">
              {#if uploading}
                <span class="loading loading-spinner loading-xs"></span>
              {:else}
                Upload Photo
              {/if}
              <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" on:change={handlePhotoSelect} disabled={uploading} />
            </label>
          {/if}
        </div>

        <!-- Name & key info -->
        <div class="flex-1">
          <div class="flex items-start justify-between">
            <div>
              <h1 class="page-title">{emp.firstName} {emp.lastName}</h1>
              <div class="flex items-center gap-2 mt-1">
                <span class="font-mono text-sm text-base-content/60">#{emp.employeeNumber}</span>
                {#if emp.classificationName}
                  <span class="badge badge-sm text-white" style="background-color: {emp.classificationColor || '#64748b'}">
                    {emp.classificationName}
                  </span>
                {/if}
                {#if emp.department}
                  <span class="text-sm text-base-content/50">{emp.department}</span>
                {/if}
              </div>
            </div>
            <div class="flex items-center gap-2">
              {#if emp.status === "active"}
                <span class="badge badge-success badge-outline">Active</span>
                {#if isAdmin}
                  <button class="btn btn-xs btn-warning btn-outline" on:click={startDeactivate}>Deactivate</button>
                {/if}
              {:else}
                <span class="badge badge-ghost">Inactive</span>
                {#if isAdmin}
                  <button class="btn btn-xs btn-success btn-outline" on:click={handleReactivate}>Reactivate</button>
                {/if}
              {/if}
            </div>
          </div>

          <!-- Quick stats -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <div>
              <div class="text-xs text-base-content/50 uppercase">Hired</div>
              <div class="font-medium text-sm">{formatDate(emp.dateOfHire)}</div>
            </div>
            {#if emp.elecLicense}
              <div>
                <div class="text-xs text-base-content/50 uppercase">Elec License</div>
                <div class="font-mono text-sm">{emp.elecLicense}</div>
              </div>
            {/if}
            {#if emp.phone}
              <div>
                <div class="text-xs text-base-content/50 uppercase">Phone</div>
                <div class="text-sm">{emp.phone}</div>
              </div>
            {/if}
            {#if emp.personalEmail}
              <div>
                <div class="text-xs text-base-content/50 uppercase">Email</div>
                <div class="text-sm truncate">{emp.personalEmail}</div>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- Detail sections -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Contact Info -->
      <div class="apple-panel p-5">
        <h2 class="font-bold text-sm text-primary uppercase tracking-wider mb-3">Contact</h2>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-base-content/50">Home Phone</span>
            <span>{emp.phone || "—"}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/50">PE Cell</span>
            <span>{emp.pePhone || "—"}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/50">Personal Email</span>
            <span class="truncate ml-4">{emp.personalEmail || "—"}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/50">Work Email</span>
            <span class="truncate ml-4">{emp.workEmail || "—"}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/50">Address</span>
            <span class="text-right ml-4">{emp.address || "—"}</span>
          </div>
        </div>
      </div>

      <!-- Personal Info -->
      <div class="apple-panel p-5">
        <h2 class="font-bold text-sm text-primary uppercase tracking-wider mb-3">Personal</h2>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-base-content/50">Date of Birth</span>
            <span>{formatDate(emp.dateOfBirth)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/50">Place of Birth</span>
            <span>{emp.placeOfBirth || "—"}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/50">Date of Hire</span>
            <span>{formatDate(emp.dateOfHire)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/50">Shirt Size</span>
            <span>{emp.shirtSize || "—"}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/50">Jacket Size</span>
            <span>{emp.jacketSize || "—"}</span>
          </div>
        </div>
      </div>

      <!-- License & Compliance -->
      <div class="apple-panel p-5">
        <h2 class="font-bold text-sm text-primary uppercase tracking-wider mb-3">License & Compliance</h2>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-base-content/50">Electrical License</span>
            <span class="font-mono">{emp.elecLicense || "—"}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/50">Driver's License</span>
            <span class="font-mono">{emp.dlNumber || "—"}</span>
          </div>
          {#if emp.dlState}
            <div class="flex justify-between">
              <span class="text-base-content/50">DL State</span>
              <span>{emp.dlState}</span>
            </div>
          {/if}
          {#if emp.dlExpiration}
            <div class="flex justify-between">
              <span class="text-base-content/50">DL Expiration</span>
              <span>{formatDate(emp.dlExpiration)}</span>
            </div>
          {/if}
          <div class="flex justify-between">
            <span class="text-base-content/50">Background Check</span>
            <span>{emp.backgroundCheck || "—"}</span>
          </div>
          {#if emp.backgroundCheckDate}
            <div class="flex justify-between">
              <span class="text-base-content/50">BG Check Date</span>
              <span>{formatDate(emp.backgroundCheckDate)}</span>
            </div>
          {/if}
        </div>
      </div>

      <!-- Emergency Contact -->
      <div class="apple-panel p-5">
        <h2 class="font-bold text-sm text-primary uppercase tracking-wider mb-3">Emergency Contact</h2>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-base-content/50">Name</span>
            <span>{emp.emergencyContactName || "—"}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/50">Phone</span>
            <span>{emp.emergencyContactPhone || "—"}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Assigned Assets -->
    {#if assignedVehicles.length > 0 || assignedTools.length > 0}
      <div class="apple-panel p-5">
        <h2 class="font-bold text-sm text-primary uppercase tracking-wider mb-3">Assigned Assets</h2>

        {#if assignedVehicles.length > 0}
          <h3 class="text-xs font-semibold text-base-content/50 uppercase mb-2">Vehicles ({assignedVehicles.length})</h3>
          <div class="space-y-1.5 mb-4">
            {#each assignedVehicles as v}
              <div class="flex items-center justify-between text-sm bg-base-200/50 rounded-lg px-3 py-2">
                <div class="flex items-center gap-2">
                  <span class="text-base opacity-50">&#128663;</span>
                  <span class="font-medium">{v.description}</span>
                  {#if v.model}
                    <span class="text-xs font-mono text-base-content/50">{v.model}</span>
                  {/if}
                </div>
                <div class="flex items-center gap-2">
                  {#if v.identifier}
                    <span class="text-xs font-mono text-base-content/50">{v.identifier}</span>
                  {/if}
                  <span class="badge badge-xs {v.status === 'assigned' ? 'badge-info' : 'badge-ghost'}">{v.status}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if assignedTools.length > 0}
          <h3 class="text-xs font-semibold text-base-content/50 uppercase mb-2">Tools ({assignedTools.length})</h3>
          <div class="space-y-1 max-h-64 overflow-y-auto">
            {#each assignedTools as t}
              <div class="flex items-center justify-between text-sm bg-base-200/50 rounded-lg px-3 py-1.5">
                <div class="flex items-center gap-2">
                  <span class="font-medium truncate max-w-[260px]">{t.description}</span>
                  {#if t.manufacturer}
                    <span class="text-xs text-base-content/50">{t.manufacturer}</span>
                  {/if}
                </div>
                <span class="badge badge-ghost badge-xs shrink-0">{t.category || "—"}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Notes & Separation -->
    {#if emp.notes || emp.reasonForLeaving}
      <div class="apple-panel p-5">
        {#if emp.reasonForLeaving}
          <h2 class="font-bold text-sm text-error uppercase tracking-wider mb-2">Reason for Leaving</h2>
          <p class="text-sm mb-4">{emp.reasonForLeaving}</p>
        {/if}
        {#if emp.notes}
          <h2 class="font-bold text-sm text-primary uppercase tracking-wider mb-2">Notes</h2>
          <p class="text-sm whitespace-pre-wrap">{emp.notes}</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

{#if showCropper && cropFile}
  <PhotoCropper imageFile={cropFile} on:crop={handleCroppedPhoto} on:cancel={() => { showCropper = false; cropFile = null; }} />
{/if}

{#if showDeactivateModal && emp}
  <div class="modal modal-open">
    <div class="modal-box max-w-md">
      <h3 class="font-bold text-lg">Deactivate Employee</h3>
      <p class="text-sm text-base-content/60 mt-2">
        <strong>{emp.firstName} {emp.lastName}</strong> will be moved to Inactive.
        Their active job assignments will be removed from the workforce board.
      </p>
      <div class="form-control mt-4">
        <label class="label" for="profile-deact-reason">
          <span class="label-text">Reason for Leaving <span class="text-base-content/40">(optional)</span></span>
        </label>
        <textarea
          id="profile-deact-reason"
          class="textarea textarea-bordered text-sm"
          rows="3"
          placeholder="e.g. Left for another contractor, seasonal layoff, moved out of area..."
          bind:value={deactivateReason}
        ></textarea>
      </div>
      <div class="modal-action">
        <button class="btn btn-ghost" on:click={() => { showDeactivateModal = false; }}>Cancel</button>
        <button class="btn btn-warning" on:click={confirmDeactivate}>Deactivate</button>
      </div>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={() => { showDeactivateModal = false; }}></div>
  </div>
{/if}
