<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";
  import AddressPicker from "../components/AddressPicker.svelte";

  // ─────────────────────────────────────────────────────────────────────
  // Types
  // ─────────────────────────────────────────────────────────────────────
  interface GCBid {
    id: number;
    opportunity_id: number;
    gc_company_id: number;
    gc_name: string;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    bid_value: number | null;
    is_primary: boolean;
    collaboration_letter_sent: boolean;
    sent_drawings_to_gc: boolean;
    outcome: "pending" | "won" | "lost" | "no_bid" | "cancelled";
    notes: string | null;
    created_at: string;
  }

  interface Supplier {
    id: number;
    supplier_id: number;
    supplier_name: string;
    sent_drawings: boolean;
  }

  interface Opportunity {
    id: number;
    name: string;
    system_type: string | null;
    status: string;
    stage: string | null;
    estimator_id: number | null;
    estimator_name: string | null;
    bid_date: string | null;
    bid_time: string | null;
    dwgs_specs_received: boolean;
    pre_bid_meeting: string | null;
    addenda_count: number;
    project_start_date: string | null;
    project_end_date: string | null;
    scope_notes: string | null;
    notes: string | null;
    follow_up_date: string | null;
    follow_up_notes: string | null;
    converted_job_id: number | null;
    converted_job_number: string | null;
    gcs: GCBid[];
    suppliers: Supplier[];
    primaryGcName: string | null;
    primaryBidValue: number | null;
    gcCount: number;
    suppliersSentCount: number;
    suppliersTotal: number;
  }

  interface GCCompany {
    id: number;
    name: string;
  }

  interface SupplierRecord {
    id: number;
    name: string;
  }

  interface Employee {
    id: number;
    firstName: string;
    lastName: string;
  }

  // ─────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────
  let opportunities: Opportunity[] = [];
  let gcCompanies: GCCompany[] = [];
  let suppliers: SupplierRecord[] = [];
  let employees: Employee[] = [];
  let stages: string[] = [];
  let systemTypes: string[] = [];

  let loading = true;
  let statusFilter = "open";
  let showAddModal = false;
  let showAddGcModal = false;
  let showConvertModal = false;
  let editingOpportunity: Opportunity | null = null;
  let expandedRows = new Set<number>();

  // For adding GC
  let gcModalData = resetGcForm();
  let gcModalForOppId: number | null = null;

  // For converting to job
  let convertData = { jobNumber: "", address: "" };
  let convertOppId: number | null = null;

  // Create/edit form
  let form = resetForm();

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────
  function resetForm() {
    return {
      name: "",
      systemType: null as string | null,
      status: "open",
      stage: null as string | null,
      estimatorId: null as number | null,
      bidDate: "",
      bidTime: "",
      dwgsSpecsReceived: false,
      preBidMeeting: "",
      addendaCount: 0,
      projectStartDate: "",
      projectEndDate: "",
      scopeNotes: "",
      notes: "",
      followUpDate: "",
      followUpNotes: "",
    };
  }

  function resetGcForm() {
    return {
      gcCompanyId: null as number | null,
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      bidValue: null as number | null,
      isPrimary: false,
      collaborationLetterSent: false,
      sentDrawingsToGc: false,
      outcome: "pending" as string,
      notes: "",
    };
  }

  function formatCurrency(n: number | null) {
    if (n === null || n === undefined) return "";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  }

  function formatDate(d: string | null) {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function getEstimatorName(id: number | null) {
    if (!id) return "";
    const emp = employees.find((e) => e.id === id);
    return emp ? `${emp.firstName} ${emp.lastName}` : "";
  }

  function toggleExpand(oppId: number) {
    if (expandedRows.has(oppId)) {
      expandedRows.delete(oppId);
    } else {
      expandedRows.add(oppId);
    }
    expandedRows = expandedRows; // trigger reactivity
  }

  // ─────────────────────────────────────────────────────────────────────
  // Load data
  // ─────────────────────────────────────────────────────────────────────
  onMount(loadAllData);

  async function loadAllData() {
    loading = true;
    try {
      const [oppData, gcData, suppData, empData, stagesData] = await Promise.all([
        api.get(`/opportunities${statusFilter ? `?status=${statusFilter}` : ""}`),
        api.get("/opportunities/gc-companies"),
        api.get("/opportunities/suppliers"),
        api.get("/employees?status=active"),
        api.get("/opportunities/stages"),
      ]);
      opportunities = oppData;
      gcCompanies = gcData;
      suppliers = suppData;
      employees = empData;
      stages = stagesData.stages || [];
      systemTypes = stagesData.systemTypes || [];
    } catch (e: any) {
      alert(`Error loading data: ${e.message}`);
    }
    loading = false;
  }

  // ─────────────────────────────────────────────────────────────────────
  // CRUD operations
  // ─────────────────────────────────────────────────────────────────────
  async function handleSaveOpportunity() {
    try {
      if (!form.name?.trim()) {
        alert("Name is required");
        return;
      }
      if (editingOpportunity) {
        await api.put(`/opportunities/${editingOpportunity.id}`, form);
      } else {
        await api.post("/opportunities", form);
      }
      showAddModal = false;
      editingOpportunity = null;
      form = resetForm();
      await loadAllData();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleDeleteOpportunity(opp: Opportunity) {
    if (!confirm(`Delete "${opp.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/opportunities/${opp.id}`);
      await loadAllData();
    } catch (e: any) {
      alert(e.message);
    }
  }

  function startEdit(opp: Opportunity) {
    editingOpportunity = opp;
    form = {
      name: opp.name,
      systemType: opp.system_type,
      status: opp.status,
      stage: opp.stage,
      estimatorId: opp.estimator_id,
      bidDate: opp.bid_date || "",
      bidTime: opp.bid_time || "",
      dwgsSpecsReceived: !!opp.dwgs_specs_received,
      preBidMeeting: opp.pre_bid_meeting || "",
      addendaCount: opp.addenda_count || 0,
      projectStartDate: opp.project_start_date || "",
      projectEndDate: opp.project_end_date || "",
      scopeNotes: opp.scope_notes || "",
      notes: opp.notes || "",
      followUpDate: opp.follow_up_date || "",
      followUpNotes: opp.follow_up_notes || "",
    };
    showAddModal = true;
  }

  function startAdd() {
    editingOpportunity = null;
    form = resetForm();
    showAddModal = true;
  }

  // Add GC modal
  async function startAddGc(oppId: number) {
    gcModalForOppId = oppId;
    gcModalData = resetGcForm();
    showAddGcModal = true;
  }

  async function handleSaveGc() {
    try {
      if (!gcModalData.gcCompanyId) {
        alert("GC Company is required");
        return;
      }
      if (!gcModalForOppId) return;

      const gcName =
        gcCompanies.find((g) => g.id === gcModalData.gcCompanyId)?.name || "";

      const body = {
        gcCompanyId: gcModalData.gcCompanyId,
        contactName: gcModalData.contactName || null,
        contactEmail: gcModalData.contactEmail || null,
        contactPhone: gcModalData.contactPhone || null,
        bidValue: gcModalData.bidValue || null,
        isPrimary: gcModalData.isPrimary,
        collaborationLetterSent: gcModalData.collaborationLetterSent,
        sentDrawingsToGc: gcModalData.sentDrawingsToGc,
        outcome: gcModalData.outcome,
        notes: gcModalData.notes || null,
      };

      await api.post(`/opportunities/${gcModalForOppId}/gcs`, body);
      showAddGcModal = false;
      gcModalForOppId = null;
      gcModalData = resetGcForm();
      await loadAllData();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleDeleteGc(gcId: number) {
    if (!confirm("Delete this GC bid?")) return;
    try {
      await api.del(`/opportunities/gcs/${gcId}`);
      await loadAllData();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleUpdateGc(gc: GCBid) {
    try {
      const body = {
        gcCompanyId: gc.gc_company_id,
        contactName: gc.contact_name || null,
        contactEmail: gc.contact_email || null,
        contactPhone: gc.contact_phone || null,
        bidValue: gc.bid_value || null,
        isPrimary: gc.is_primary,
        collaborationLetterSent: gc.collaboration_letter_sent,
        sentDrawingsToGc: gc.sent_drawings_to_gc,
        outcome: gc.outcome,
        notes: gc.notes || null,
      };
      await api.put(`/opportunities/gcs/${gc.id}`, body);
      await loadAllData();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleToggleSuppiler(oppId: number, supplier: Supplier) {
    try {
      supplier.sent_drawings = !supplier.sent_drawings;
      const oppSuppliers = opportunities
        .find((o) => o.id === oppId)
        ?.suppliers.map((s) => ({
          supplierId: s.supplier_id,
          sentDrawings: s.sent_drawings,
        })) || [];

      await api.put(`/opportunities/${oppId}/suppliers`, {
        suppliers: oppSuppliers,
      });
      await loadAllData();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function startConvert(opp: Opportunity) {
    if (opp.status !== "won") {
      alert("Only opportunities with status 'won' can be converted to jobs");
      return;
    }
    convertOppId = opp.id;
    convertData = { jobNumber: "", address: "" };
    showConvertModal = true;
  }

  async function handleConvertToJob() {
    try {
      if (!convertData.jobNumber?.trim() || !convertData.address?.trim()) {
        alert("Job Number and Address are required");
        return;
      }
      if (!convertOppId) return;

      await api.post(`/opportunities/${convertOppId}/convert`, {
        jobNumber: convertData.jobNumber,
        address: convertData.address,
      });
      showConvertModal = false;
      convertOppId = null;
      convertData = { jobNumber: "", address: "" };
      await loadAllData();
    } catch (e: any) {
      alert(e.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Sorting
  // ─────────────────────────────────────────────────────────────────────
  let sortCol: string = "bid_date";
  let sortAsc: boolean = false;

  function toggleSort(col: string) {
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = true;
    }
  }

  $: sortedOpportunities = (() => {
    const dir = sortAsc ? 1 : -1;
    return [...opportunities].sort((a, b) => {
      let va: any, vb: any;
      switch (sortCol) {
        case "name":
          va = (a.name || "").toLowerCase();
          vb = (b.name || "").toLowerCase();
          break;
        case "stage":
          va = (a.stage || "").toLowerCase();
          vb = (b.stage || "").toLowerCase();
          break;
        case "estimator":
          va = (a.estimator_name || "").toLowerCase();
          vb = (b.estimator_name || "").toLowerCase();
          break;
        case "primary_gc":
          va = (a.primaryGcName || "").toLowerCase();
          vb = (b.primaryGcName || "").toLowerCase();
          break;
        case "bid_value":
          va = a.primaryBidValue || 0;
          vb = b.primaryBidValue || 0;
          break;
        case "bid_date":
          va = a.bid_date || "";
          vb = b.bid_date || "";
          break;
        case "system_type":
          va = (a.system_type || "").toLowerCase();
          vb = (b.system_type || "").toLowerCase();
          break;
        case "status":
          va = (a.status || "").toLowerCase();
          vb = (b.status || "").toLowerCase();
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
    open: "badge-info",
    submitted: "badge-warning",
    won: "badge-success",
    lost: "badge-error",
    no_bid: "badge-ghost",
    on_hold: "badge-neutral",
  } as Record<string, string>;

  $: canEdit =
    $user?.role === "super_admin" ||
    $user?.role === "admin" ||
    $user?.role === "pm";
</script>

<div class="space-y-4">
  <!-- Header & Filter -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
    <h1 class="page-title">
      Opportunities
      <span class="badge badge-sm bg-base-200 text-base-content/60 border-0 ml-1"
        >{opportunities.length}</span
      >
    </h1>
    <div class="flex gap-2">
      <select
        class="select select-sm select-bordered"
        bind:value={statusFilter}
        on:change={loadAllData}
      >
        <option value="">All Status</option>
        <option value="open">Open</option>
        <option value="submitted">Submitted</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
        <option value="no_bid">No Bid</option>
        <option value="on_hold">On Hold</option>
      </select>
      {#if canEdit}
        <button class="btn btn-sm btn-primary" on:click={startAdd}>
          + Add Opportunity
        </button>
      {/if}
    </div>
  </div>

  <!-- Main Table -->
  {#if loading}
    <div class="flex justify-center p-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {:else}
    <div class="overflow-x-auto apple-panel">
      <table class="table table-sm apple-table">
        <thead>
          <tr>
            <th style="width: 32px"></th>
            <th class="opp-sort" on:click={() => toggleSort("name")}>
              Name
              {#if sortCol === "name"}
                <span class="opp-arrow">{sortAsc ? "↑" : "↓"}</span>
              {/if}
            </th>
            <th class="opp-sort" on:click={() => toggleSort("stage")}>
              Stage
              {#if sortCol === "stage"}
                <span class="opp-arrow">{sortAsc ? "↑" : "↓"}</span>
              {/if}
            </th>
            <th class="opp-sort" on:click={() => toggleSort("estimator")}>
              Estimator
              {#if sortCol === "estimator"}
                <span class="opp-arrow">{sortAsc ? "↑" : "↓"}</span>
              {/if}
            </th>
            <th class="opp-sort" on:click={() => toggleSort("primary_gc")}>
              Primary GC
              {#if sortCol === "primary_gc"}
                <span class="opp-arrow">{sortAsc ? "↑" : "↓"}</span>
              {/if}
            </th>
            <th class="opp-sort text-right" on:click={() => toggleSort("bid_value")}>
              Bid Value
              {#if sortCol === "bid_value"}
                <span class="opp-arrow">{sortAsc ? "↑" : "↓"}</span>
              {/if}
            </th>
            <th class="opp-sort" on:click={() => toggleSort("bid_date")}>
              Bid Date
              {#if sortCol === "bid_date"}
                <span class="opp-arrow">{sortAsc ? "↑" : "↓"}</span>
              {/if}
            </th>
            <th class="opp-sort" on:click={() => toggleSort("system_type")}>
              System Type
              {#if sortCol === "system_type"}
                <span class="opp-arrow">{sortAsc ? "↑" : "↓"}</span>
              {/if}
            </th>
            <th class="opp-sort" on:click={() => toggleSort("status")}>
              Status
              {#if sortCol === "status"}
                <span class="opp-arrow">{sortAsc ? "↑" : "↓"}</span>
              {/if}
            </th>
            {#if canEdit}
              <th class="text-center">Actions</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each sortedOpportunities as opp (opp.id)}
            <tr class="hover">
              <td class="text-center">
                <button
                  class="btn btn-xs btn-ghost"
                  on:click={() => toggleExpand(opp.id)}
                >
                  {expandedRows.has(opp.id) ? "▾" : "▸"}
                </button>
              </td>
              <td class="font-medium max-w-xs truncate">{opp.name}</td>
              <td class="text-sm">{opp.stage || "—"}</td>
              <td class="text-sm">{opp.estimator_name || "—"}</td>
              <td class="text-sm">{opp.primaryGcName || "—"}</td>
              <td class="text-right font-mono text-sm">
                {opp.primaryBidValue ? formatCurrency(opp.primaryBidValue) : "—"}
              </td>
              <td class="text-sm">{formatDate(opp.bid_date)}</td>
              <td class="text-sm">{opp.system_type || "—"}</td>
              <td>
                <span
                  class="badge badge-xs {statusColors[opp.status] || 'badge-ghost'}"
                >
                  {opp.status}
                </span>
              </td>
              {#if canEdit}
                <td class="text-center">
                  <div class="flex items-center justify-center gap-1">
                    <button
                      class="btn btn-xs btn-ghost"
                      on:click={() => startEdit(opp)}
                    >
                      Edit
                    </button>
                    <button
                      class="btn btn-xs btn-ghost text-error"
                      on:click={() => handleDeleteOpportunity(opp)}
                    >
                      Del
                    </button>
                  </div>
                </td>
              {/if}
            </tr>

            <!-- Expand Detail Panel -->
            {#if expandedRows.has(opp.id)}
              <tr class="bg-base-100">
                <td colspan={canEdit ? 10 : 9}>
                  <div class="p-4 space-y-4">
                    <!-- GC Bids Section -->
                    <div>
                      <div class="flex items-center justify-between mb-3">
                        <h4 class="font-semibold text-sm">GC Bids</h4>
                        {#if canEdit}
                          <button
                            class="btn btn-xs btn-primary"
                            on:click={() => startAddGc(opp.id)}
                          >
                            + Add GC
                          </button>
                        {/if}
                      </div>

                      {#if opp.gcs.length > 0}
                        <div class="overflow-x-auto">
                          <table class="table table-xs">
                            <thead>
                              <tr class="bg-base-200">
                                <th>Company</th>
                                <th>Contact</th>
                                <th class="text-right">Bid Value</th>
                                <th class="text-center">Primary</th>
                                <th class="text-center">Collab Letter</th>
                                <th class="text-center">Dwgs Sent</th>
                                <th>Outcome</th>
                                {#if canEdit}
                                  <th class="text-center">Actions</th>
                                {/if}
                              </tr>
                            </thead>
                            <tbody>
                              {#each opp.gcs as gc (gc.id)}
                                <tr class="hover">
                                  <td class="font-medium">{gc.gc_name}</td>
                                  <td class="text-xs">
                                    {#if gc.contact_name}
                                      <div>{gc.contact_name}</div>
                                      {#if gc.contact_email}
                                        <div class="text-base-content/50">
                                          {gc.contact_email}
                                        </div>
                                      {/if}
                                    {:else}
                                      —
                                    {/if}
                                  </td>
                                  <td class="text-right font-mono">
                                    {gc.bid_value ? formatCurrency(gc.bid_value) : "—"}
                                  </td>
                                  <td class="text-center">
                                    {#if canEdit}
                                      <input
                                        type="checkbox"
                                        class="checkbox checkbox-xs"
                                        bind:checked={gc.is_primary}
                                        on:change={() => handleUpdateGc(gc)}
                                      />
                                    {:else}
                                      {#if gc.is_primary}
                                        <span class="text-lg">★</span>
                                      {/if}
                                    {/if}
                                  </td>
                                  <td class="text-center">
                                    {#if canEdit}
                                      <input
                                        type="checkbox"
                                        class="checkbox checkbox-xs"
                                        bind:checked={gc.collaboration_letter_sent}
                                        on:change={() => handleUpdateGc(gc)}
                                      />
                                    {:else}
                                      {#if gc.collaboration_letter_sent}
                                        <span class="text-green-600">✓</span>
                                      {/if}
                                    {/if}
                                  </td>
                                  <td class="text-center">
                                    {#if canEdit}
                                      <input
                                        type="checkbox"
                                        class="checkbox checkbox-xs"
                                        bind:checked={gc.sent_drawings_to_gc}
                                        on:change={() => handleUpdateGc(gc)}
                                      />
                                    {:else}
                                      {#if gc.sent_drawings_to_gc}
                                        <span class="text-green-600">✓</span>
                                      {/if}
                                    {/if}
                                  </td>
                                  <td class="text-sm capitalize">{gc.outcome}</td>
                                  {#if canEdit}
                                    <td class="text-center">
                                      <button
                                        class="btn btn-xs btn-ghost text-error"
                                        on:click={() => handleDeleteGc(gc.id)}
                                      >
                                        Del
                                      </button>
                                    </td>
                                  {/if}
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </div>
                      {:else}
                        <div class="text-sm text-base-content/50">No GC bids added</div>
                      {/if}
                    </div>

                    <!-- Suppliers Section -->
                    <div class="pt-2">
                      <div class="flex items-center justify-between mb-3">
                        <div>
                          <h4 class="font-semibold text-sm">Suppliers</h4>
                          <p class="text-xs text-base-content/50">
                            {opp.suppliersSentCount} of {opp.suppliersTotal} drawings sent
                          </p>
                        </div>
                      </div>

                      {#if suppliers.length > 0}
                        <div class="flex flex-wrap gap-2">
                          {#each suppliers as supp (supp.id)}
                            {@const oppSupplier = opp.suppliers.find(
                              (s) => s.supplier_id === supp.id
                            )}
                            <button
                              class="badge badge-lg gap-1 {oppSupplier?.sent_drawings
                                ? 'badge-success'
                                : 'badge-outline'}"
                              on:click={() => {
                                if (oppSupplier) {
                                  handleToggleSuppiler(opp.id, oppSupplier);
                                }
                              }}
                              disabled={!canEdit}
                            >
                              {oppSupplier?.sent_drawings ? "☑" : "☐"}
                              {supp.name}
                            </button>
                          {/each}
                        </div>
                      {:else}
                        <div class="text-sm text-base-content/50">
                          No suppliers configured
                        </div>
                      {/if}
                    </div>

                    <!-- Convert to Job Section (won status only) -->
                    {#if opp.status === "won" && canEdit && !opp.converted_job_id}
                      <div class="pt-2">
                        <button
                          class="btn btn-sm btn-outline btn-success"
                          on:click={() => startConvert(opp)}
                        >
                          Convert to Job
                        </button>
                      </div>
                    {/if}
                    {#if opp.converted_job_id}
                      <div class="pt-2 text-sm text-green-600">
                        Converted to Job #{opp.converted_job_number}
                      </div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

    {#if opportunities.length === 0}
      <div class="text-center p-12 text-base-content/50">
        No opportunities found
      </div>
    {/if}
  {/if}
</div>

<!-- Add/Edit Opportunity Modal -->
{#if showAddModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-lg mb-4">
        {editingOpportunity ? "Edit Opportunity" : "Add Opportunity"}
      </h3>
      <form on:submit|preventDefault={handleSaveOpportunity} class="space-y-3">
        <div class="form-control">
          <label class="label label-text text-xs" for="opp-name">
            Name *
          </label>
          <input
            id="opp-name"
            class="input input-sm input-bordered"
            bind:value={form.name}
            required
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="opp-system">
              System Type
            </label>
            <select
              id="opp-system"
              class="select select-sm select-bordered"
              bind:value={form.systemType}
            >
              <option value={null}>— Select —</option>
              {#each systemTypes as st}
                <option value={st}>{st}</option>
              {/each}
            </select>
          </div>

          <div class="form-control">
            <label class="label label-text text-xs" for="opp-status">
              Status
            </label>
            <select
              id="opp-status"
              class="select select-sm select-bordered"
              bind:value={form.status}
            >
              <option value="open">Open</option>
              <option value="submitted">Submitted</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="no_bid">No Bid</option>
              <option value="on_hold">On Hold</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="opp-stage">
              Stage
            </label>
            <select
              id="opp-stage"
              class="select select-sm select-bordered"
              bind:value={form.stage}
            >
              <option value={null}>— Select —</option>
              {#each stages as s}
                <option value={s}>{s}</option>
              {/each}
            </select>
          </div>

          <div class="form-control">
            <label class="label label-text text-xs" for="opp-estimator">
              Estimator
            </label>
            <select
              id="opp-estimator"
              class="select select-sm select-bordered"
              bind:value={form.estimatorId}
            >
              <option value={null}>— Unassigned —</option>
              {#each employees as emp}
                <option value={emp.id}>
                  {emp.firstName} {emp.lastName}
                </option>
              {/each}
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="opp-bid-date">
              Bid Date
            </label>
            <input
              id="opp-bid-date"
              class="input input-sm input-bordered"
              type="date"
              bind:value={form.bidDate}
            />
          </div>

          <div class="form-control">
            <label class="label label-text text-xs" for="opp-bid-time">
              Bid Time
            </label>
            <input
              id="opp-bid-time"
              class="input input-sm input-bordered"
              type="time"
              bind:value={form.bidTime}
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                bind:checked={form.dwgsSpecsReceived}
              />
              <span class="label-text text-sm">Drawings/Specs Received</span>
            </label>
          </div>

          <div class="form-control">
            <label class="label label-text text-xs" for="opp-addenda">
              Addenda Count
            </label>
            <input
              id="opp-addenda"
              class="input input-sm input-bordered"
              type="number"
              min="0"
              bind:value={form.addendaCount}
            />
          </div>
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="opp-prebid">
            Pre-Bid Meeting
          </label>
          <input
            id="opp-prebid"
            class="input input-sm input-bordered"
            bind:value={form.preBidMeeting}
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="opp-proj-start">
              Project Start Date
            </label>
            <input
              id="opp-proj-start"
              class="input input-sm input-bordered"
              type="date"
              bind:value={form.projectStartDate}
            />
          </div>

          <div class="form-control">
            <label class="label label-text text-xs" for="opp-proj-end">
              Project End Date
            </label>
            <input
              id="opp-proj-end"
              class="input input-sm input-bordered"
              type="date"
              bind:value={form.projectEndDate}
            />
          </div>
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="opp-scope">
            Scope Notes
          </label>
          <textarea
            id="opp-scope"
            class="textarea textarea-bordered textarea-sm"
            bind:value={form.scopeNotes}
          ></textarea>
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="opp-notes">
            Notes
          </label>
          <textarea
            id="opp-notes"
            class="textarea textarea-bordered textarea-sm"
            bind:value={form.notes}
          ></textarea>
        </div>

        <div class="divider my-2"></div>

        <div class="grid grid-cols-2 gap-3">
          <div class="form-control">
            <label class="label label-text text-xs" for="opp-followup-date">
              Follow-up Date
            </label>
            <input
              id="opp-followup-date"
              class="input input-sm input-bordered"
              type="date"
              bind:value={form.followUpDate}
            />
          </div>

          <div class="form-control">
            <label class="label label-text text-xs" for="opp-followup-notes">
              Follow-up Notes
            </label>
            <input
              id="opp-followup-notes"
              class="input input-sm input-bordered"
              bind:value={form.followUpNotes}
            />
          </div>
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            on:click={() => {
              showAddModal = false;
              editingOpportunity = null;
            }}
          >
            Cancel
          </button>
          <button type="submit" class="btn btn-sm btn-primary">
            {editingOpportunity ? "Save Changes" : "Add Opportunity"}
          </button>
        </div>
      </form>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div
      class="modal-backdrop"
      on:click={() => {
        showAddModal = false;
        editingOpportunity = null;
      }}
    ></div>
  </div>
{/if}

<!-- Add GC Modal -->
{#if showAddGcModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-md">
      <h3 class="font-bold text-lg mb-4">Add GC Bid</h3>
      <form on:submit|preventDefault={handleSaveGc} class="space-y-3">
        <div class="form-control">
          <label class="label label-text text-xs" for="gc-company">
            GC Company *
          </label>
          <select
            id="gc-company"
            class="select select-sm select-bordered"
            bind:value={gcModalData.gcCompanyId}
            required
          >
            <option value={null}>— Select —</option>
            {#each gcCompanies as gc}
              <option value={gc.id}>{gc.name}</option>
            {/each}
          </select>
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="gc-contact-name">
            Contact Name
          </label>
          <input
            id="gc-contact-name"
            class="input input-sm input-bordered"
            bind:value={gcModalData.contactName}
          />
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="gc-contact-email">
            Contact Email
          </label>
          <input
            id="gc-contact-email"
            class="input input-sm input-bordered"
            type="email"
            bind:value={gcModalData.contactEmail}
          />
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="gc-contact-phone">
            Contact Phone
          </label>
          <input
            id="gc-contact-phone"
            class="input input-sm input-bordered"
            bind:value={gcModalData.contactPhone}
          />
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="gc-bid-value">
            Bid Value
          </label>
          <input
            id="gc-bid-value"
            class="input input-sm input-bordered"
            type="number"
            bind:value={gcModalData.bidValue}
          />
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="gc-outcome">
            Outcome
          </label>
          <select
            id="gc-outcome"
            class="select select-sm select-bordered"
            bind:value={gcModalData.outcome}
          >
            <option value="pending">Pending</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="no_bid">No Bid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              bind:checked={gcModalData.isPrimary}
            />
            <span class="label-text text-sm">Set as Primary</span>
          </label>
        </div>

        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              bind:checked={gcModalData.collaborationLetterSent}
            />
            <span class="label-text text-sm">Collaboration Letter Sent</span>
          </label>
        </div>

        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              bind:checked={gcModalData.sentDrawingsToGc}
            />
            <span class="label-text text-sm">Drawings Sent to GC</span>
          </label>
        </div>

        <div class="form-control">
          <label class="label label-text text-xs" for="gc-notes">Notes</label>
          <textarea
            id="gc-notes"
            class="textarea textarea-bordered textarea-sm"
            bind:value={gcModalData.notes}
          ></textarea>
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            on:click={() => {
              showAddGcModal = false;
              gcModalForOppId = null;
            }}
          >
            Cancel
          </button>
          <button type="submit" class="btn btn-sm btn-primary">Add GC</button>
        </div>
      </form>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div
      class="modal-backdrop"
      on:click={() => {
        showAddGcModal = false;
        gcModalForOppId = null;
      }}
    ></div>
  </div>
{/if}

<!-- Convert to Job Modal -->
{#if showConvertModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-md">
      <h3 class="font-bold text-lg mb-4">Convert to Job</h3>
      <form on:submit|preventDefault={handleConvertToJob} class="space-y-3">
        <div class="form-control">
          <label class="label label-text text-xs" for="convert-job-number">
            Job Number *
          </label>
          <input
            id="convert-job-number"
            class="input input-sm input-bordered"
            bind:value={convertData.jobNumber}
            required
          />
        </div>

        <div class="form-control">
          <label class="label label-text text-xs">
            Address *
          </label>
          <AddressPicker
            bind:value={convertData.address}
            placeholder="Start typing a job address..."
            on:select={(e) => { convertData.address = e.detail.address; }}
          />
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            on:click={() => {
              showConvertModal = false;
              convertOppId = null;
            }}
          >
            Cancel
          </button>
          <button type="submit" class="btn btn-sm btn-primary">
            Convert
          </button>
        </div>
      </form>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div
      class="modal-backdrop"
      on:click={() => {
        showConvertModal = false;
        convertOppId = null;
      }}
    ></div>
  </div>
{/if}

<style>
  .opp-sort {
    cursor: pointer;
    user-select: none;
    transition: color 0.15s;
  }
  .opp-sort:hover {
    color: #1d1d1f;
  }
  .opp-arrow {
    display: inline-block;
    font-size: 0.625rem;
    margin-left: 2px;
    opacity: 0.5;
  }
</style>
