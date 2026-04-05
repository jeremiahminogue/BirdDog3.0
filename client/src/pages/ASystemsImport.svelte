<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { user } from "../lib/stores";

  // ── Types ──
  interface DetailRow {
    id: number;
    job_id: number;
    job_number: string;
    job_name: string;
    hour_budget: number | null;
    hours_used: number | null;
    labor_budget: number | null;
    labor_cost: number | null;
    material_budget: number | null;
    material_cost: number | null;
    general_budget: number | null;
    general_cost: number | null;
    total_contract: number | null;
    imported_at: string;
    matched_job_name: string;
    job_status: string;
  }

  interface SummaryRow {
    id: number;
    job_id: number;
    job_number: string;
    job_name: string;
    revised_contract_price: number | null;
    percent_complete: number | null;
    billed_to_date: number | null;
    cost_to_date: number | null;
    earned_to_date: number | null;
    received_to_date: number | null;
    paid_out_to_date: number | null;
    // Per-category actuals
    labor_pct_complete: number | null;
    material_pct_complete: number | null;
    subcontract_pct_complete: number | null;
    equipment_pct_complete: number | null;
    general_pct_complete: number | null;
    labor_orig_budget: number | null;
    material_orig_budget: number | null;
    subcontract_orig_budget: number | null;
    equipment_orig_budget: number | null;
    general_orig_budget: number | null;
    labor_curr_budget: number | null;
    material_curr_budget: number | null;
    subcontract_curr_budget: number | null;
    equipment_curr_budget: number | null;
    general_curr_budget: number | null;
    labor_cost_to_date: number | null;
    material_cost_to_date: number | null;
    subcontract_cost_to_date: number | null;
    equipment_cost_to_date: number | null;
    general_cost_to_date: number | null;
    imported_at: string;
    matched_job_name: string;
    job_status: string;
  }

  // ── State ──
  let activeTab: "detail" | "summary" = "detail";
  let detailData: DetailRow[] = [];
  let summaryData: SummaryRow[] = [];
  let loading = true;
  let error = "";
  let importing = false;
  let importResult = "";
  let importError = "";
  let unmatchedJobs: string[] = [];
  let detailFileInput: HTMLInputElement;
  let summaryFileInput: HTMLInputElement;
  let selectedFile: File | null = null;
  let showConfirm = false;
  let confirmType: "detail" | "summary" = "detail";
  let expandedJob: string | null = null;

  $: canImport = $user?.role === "super_admin" || $user?.role === "admin";
  $: currentData = activeTab === "detail" ? detailData : summaryData;
  $: lastImport = currentData.length > 0 ? (currentData[0] as any).imported_at : null;

  // ── Formatters ──
  function fmtDollar(v: number | null | undefined): string {
    if (v == null) return "—";
    const neg = v < 0;
    const abs = Math.abs(v);
    const formatted = "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return neg ? `(${formatted})` : formatted;
  }

  function fmtPct(v: number | null | undefined): string {
    if (v == null) return "—";
    return v.toFixed(1) + "%";
  }

  function fmtNum(v: number | null): string {
    if (v == null) return "—";
    return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  // ── Detail table helpers ──
  function pctOf(cost: number | null, budget: number | null): number | null {
    if (budget == null || budget === 0 || cost == null) return null;
    return (cost / budget) * 100;
  }

  function remaining(budget: number | null, cost: number | null): number | null {
    if (budget == null || cost == null) return null;
    return budget - cost;
  }

  function totalCosts(row: DetailRow): number {
    return (row.labor_cost || 0) + (row.material_cost || 0) + (row.general_cost || 0);
  }

  function profit(row: DetailRow): number | null {
    if (row.total_contract == null) return null;
    return row.total_contract - totalCosts(row);
  }

  function profitPct(row: DetailRow): number | null {
    const p = profit(row);
    if (p == null || row.total_contract == null || row.total_contract === 0) return null;
    return (p / row.total_contract) * 100;
  }

  // ── No-budget detection ──
  // A job with no cost budget entered in A-Systems has meaningless % complete and profit values.
  // A contract price alone does NOT mean there's a budget — you can have a contract price
  // without any category cost budgets. A-Systems shows 100% complete for these jobs.
  // We check if ANY category has a current budget > 0.
  function hasBudget(row: SummaryRow): boolean {
    const totalBudget =
      (row.labor_curr_budget ?? 0) +
      (row.material_curr_budget ?? 0) +
      (row.subcontract_curr_budget ?? 0) +
      (row.equipment_curr_budget ?? 0) +
      (row.general_curr_budget ?? 0);
    return totalBudget > 0;
  }

  // ── Summary computed values (derived from actuals) ──
  function calcProfit(row: SummaryRow): number | null {
    if (!hasBudget(row)) return null;
    if (row.revised_contract_price == null || row.cost_to_date == null) return null;
    if (row.percent_complete == null || row.percent_complete === 0) return null;
    // Projected total cost = cost_to_date / (percent_complete / 100)
    const projectedCost = row.cost_to_date / (row.percent_complete / 100);
    return row.revised_contract_price - projectedCost;
  }

  function calcProfitRate(row: SummaryRow): number | null {
    if (!hasBudget(row)) return null;
    const p = calcProfit(row);
    if (p == null || row.revised_contract_price == null || row.revised_contract_price === 0) return null;
    return (p / row.revised_contract_price) * 100;
  }

  function calcCashFlow(row: SummaryRow): number | null {
    if (row.received_to_date == null || row.paid_out_to_date == null) return null;
    return row.received_to_date - row.paid_out_to_date;
  }

  function calcBillingGap(row: SummaryRow): { label: string; value: number } | null {
    if (!hasBudget(row)) return null;
    if (row.earned_to_date == null || row.billed_to_date == null) return null;
    const diff = row.billed_to_date - row.earned_to_date;
    return diff >= 0
      ? { label: "Excess Billings", value: diff }
      : { label: "Under Billings", value: Math.abs(diff) };
  }

  function calcCatVariance(curr: number | null, cost: number | null): number | null {
    if (curr == null || cost == null) return null;
    return curr - cost;
  }

  // ── CSS helpers ──
  function pctClass(v: number | null): string {
    if (v == null) return "";
    if (v > 100) return "text-error font-semibold";
    if (v > 90) return "text-warning font-medium";
    return "";
  }

  function profitClass(v: number | null | undefined): string {
    if (v == null) return "";
    if (v < 0) return "text-error font-semibold";
    return "text-success";
  }

  function varianceClass(v: number | null): string {
    if (v == null) return "";
    if (v < 0) return "text-error font-semibold";
    if (v > 0) return "text-success";
    return "";
  }

  // ── Data Loading ──
  async function loadData() {
    loading = true;
    error = "";
    try {
      const [detail, summary] = await Promise.all([
        api.get("/import/finance-data"),
        api.get("/import/finance-summary"),
      ]);
      detailData = detail;
      summaryData = summary;
    } catch (e: any) {
      error = e.message || "Failed to load data";
    }
    loading = false;
  }

  // ── Import Flow ──
  function handleFileSelect(e: Event, type: "detail" | "summary") {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      selectedFile = input.files[0];
      confirmType = type;
      showConfirm = true;
    }
  }

  async function doImport() {
    if (!selectedFile) return;
    importing = true;
    importResult = "";
    importError = "";
    unmatchedJobs = [];
    showConfirm = false;

    const endpoint = confirmType === "summary" ? "/api/import/asystems-summary" : "/api/import/asystems";

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "X-Requested-With": "BirdDog" },
        body: formData,
        credentials: "include",
      });

      const result = await res.json();

      if (!res.ok || result.error) {
        importError = result.error || "Import failed";
      } else {
        importResult = result.message;
        if (result.unmatched) {
          unmatchedJobs = result.unmatched;
        }
        await loadData();
      }
    } catch (e: any) {
      importError = e.message || "Import failed";
    }

    importing = false;
    selectedFile = null;
    if (detailFileInput) detailFileInput.value = "";
    if (summaryFileInput) summaryFileInput.value = "";
  }

  function cancelImport() {
    showConfirm = false;
    selectedFile = null;
    if (detailFileInput) detailFileInput.value = "";
    if (summaryFileInput) summaryFileInput.value = "";
  }

  function toggleExpand(jobNumber: string) {
    expandedJob = expandedJob === jobNumber ? null : jobNumber;
  }

  onMount(loadData);
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between flex-wrap gap-4">
    <div>
      <h1 class="page-title">Import Accounting</h1>
      <p class="text-sm text-base-content/50 mt-1">
        Import job cost data from accounting system PDF reports
      </p>
    </div>

    {#if canImport}
      <div class="flex items-center gap-3">
        {#if lastImport}
          <span class="text-xs text-base-content/40">
            Last: {new Date(lastImport + "Z").toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </span>
        {/if}

        <label class="btn btn-primary btn-sm gap-2" class:loading={importing && confirmType === "detail"}>
          {#if importing && confirmType === "detail"}
            Importing...
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            A-Systems Analysis
          {/if}
          <input bind:this={detailFileInput} type="file" accept=".pdf" class="hidden" on:change={(e) => handleFileSelect(e, "detail")} disabled={importing} />
        </label>

        <label class="btn btn-secondary btn-sm gap-2" class:loading={importing && confirmType === "summary"}>
          {#if importing && confirmType === "summary"}
            Importing...
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            A-Systems Summary
          {/if}
          <input bind:this={summaryFileInput} type="file" accept=".pdf" class="hidden" on:change={(e) => handleFileSelect(e, "summary")} disabled={importing} />
        </label>
      </div>
    {/if}
  </div>

  <!-- Status messages -->
  {#if importResult}
    <div class="apple-panel p-4 border-l-4 border-success">
      <p class="text-sm font-medium text-success">{importResult}</p>
    </div>
  {/if}
  {#if importError}
    <div class="apple-panel p-4 border-l-4 border-error">
      <p class="text-sm font-medium text-error">{importError}</p>
    </div>
  {/if}
  {#if unmatchedJobs.length > 0}
    <div class="apple-panel p-4 border-l-4 border-warning">
      <p class="text-sm font-medium text-warning">Unmatched job numbers — add these jobs to BirdDog first, then re-import:</p>
      <p class="text-sm text-base-content/60 mt-1">{unmatchedJobs.join(", ")}</p>
    </div>
  {/if}

  <!-- Confirm dialog -->
  {#if showConfirm}
    <div class="apple-panel p-5">
      <h3 class="text-base font-semibold text-base-content">Confirm Import</h3>
      <p class="text-sm text-base-content/60 mt-2">
        This will replace existing <span class="font-semibold">{confirmType === "summary" ? "job summary" : "detail"}</span> data with data from <span class="font-medium">{selectedFile?.name}</span>.
        {confirmType === "detail" ? "Summary data will not be affected." : "Detail data will not be affected."}
      </p>
      <div class="flex gap-3 mt-4">
        <button class="btn btn-primary btn-sm" on:click={doImport}>Import</button>
        <button class="btn btn-ghost btn-sm" on:click={cancelImport}>Cancel</button>
      </div>
    </div>
  {/if}

  <!-- Tab switcher -->
  <div class="flex gap-1 bg-base-200/60 rounded-lg p-1 w-fit">
    <button
      class="px-4 py-1.5 rounded-md text-sm font-medium transition-all {activeTab === 'detail' ? 'bg-white shadow-sm text-base-content' : 'text-base-content/50'}"
      on:click={() => activeTab = "detail"}
    >
      Detail Report
      {#if detailData.length > 0}<span class="badge badge-sm badge-ghost ml-1">{detailData.length}</span>{/if}
    </button>
    <button
      class="px-4 py-1.5 rounded-md text-sm font-medium transition-all {activeTab === 'summary' ? 'bg-white shadow-sm text-base-content' : 'text-base-content/50'}"
      on:click={() => activeTab = "summary"}
    >
      Job Summary
      {#if summaryData.length > 0}<span class="badge badge-sm badge-ghost ml-1">{summaryData.length}</span>{/if}
    </button>
  </div>

  <!-- Content -->
  {#if loading}
    <div class="flex justify-center py-12">
      <span class="loading loading-spinner loading-md text-primary"></span>
    </div>
  {:else if error}
    <div class="apple-panel p-8 text-center">
      <p class="text-error text-sm">{error}</p>
    </div>
  {:else if activeTab === "detail"}
    <!-- ═══ DETAIL TABLE ═══ -->
    {#if detailData.length === 0}
      <div class="apple-panel p-12 text-center">
        <div class="text-base-content/30 text-4xl mb-3">📊</div>
        <p class="text-base-content/50 text-sm">No detail data imported yet</p>
        <p class="text-base-content/30 text-xs mt-1">Upload an A-Systems job detail report PDF</p>
      </div>
    {:else}
      <div class="apple-panel overflow-x-auto">
        <table class="apple-table w-full text-sm">
          <thead>
            <tr>
              <th class="sticky left-0 bg-base-200/80 backdrop-blur z-10">Job</th>
              <th>Hrs Budget</th>
              <th>Hrs Used</th>
              <th>% Hrs</th>
              <th>Labor Budget</th>
              <th>Labor Cost</th>
              <th>Labor Rem.</th>
              <th>% Labor</th>
              <th>Mat. Budget</th>
              <th>Mat. Cost</th>
              <th>Mat. Rem.</th>
              <th>% Mat.</th>
              <th>Gen. Budget</th>
              <th>Gen. Cost</th>
              <th>Gen. Rem.</th>
              <th>% Gen.</th>
              <th>Contract</th>
              <th>Total Costs</th>
              <th>Profit</th>
              <th>% Profit</th>
            </tr>
          </thead>
          <tbody>
            {#each detailData as row}
              {@const hrPct = pctOf(row.hours_used, row.hour_budget)}
              {@const labPct = pctOf(row.labor_cost, row.labor_budget)}
              {@const matPct = pctOf(row.material_cost, row.material_budget)}
              {@const genPct = pctOf(row.general_cost, row.general_budget)}
              {@const tc = totalCosts(row)}
              {@const prof = profit(row)}
              {@const pp = profitPct(row)}
              <tr>
                <td class="sticky left-0 bg-white z-10 font-medium">
                  <div class="min-w-[140px]">
                    <span class="text-primary">{row.job_number}</span>
                    <span class="text-base-content/40 ml-1 text-xs">{row.job_name || row.matched_job_name || ""}</span>
                  </div>
                </td>
                <td class="text-right tabular-nums">{fmtNum(row.hour_budget)}</td>
                <td class="text-right tabular-nums">{fmtNum(row.hours_used)}</td>
                <td class="text-right tabular-nums {pctClass(hrPct)}">{fmtPct(hrPct)}</td>
                <td class="text-right tabular-nums">{fmtDollar(row.labor_budget)}</td>
                <td class="text-right tabular-nums">{fmtDollar(row.labor_cost)}</td>
                <td class="text-right tabular-nums">{fmtDollar(remaining(row.labor_budget, row.labor_cost))}</td>
                <td class="text-right tabular-nums {pctClass(labPct)}">{fmtPct(labPct)}</td>
                <td class="text-right tabular-nums">{fmtDollar(row.material_budget)}</td>
                <td class="text-right tabular-nums">{fmtDollar(row.material_cost)}</td>
                <td class="text-right tabular-nums">{fmtDollar(remaining(row.material_budget, row.material_cost))}</td>
                <td class="text-right tabular-nums {pctClass(matPct)}">{fmtPct(matPct)}</td>
                <td class="text-right tabular-nums">{fmtDollar(row.general_budget)}</td>
                <td class="text-right tabular-nums">{fmtDollar(row.general_cost)}</td>
                <td class="text-right tabular-nums">{fmtDollar(remaining(row.general_budget, row.general_cost))}</td>
                <td class="text-right tabular-nums {pctClass(genPct)}">{fmtPct(genPct)}</td>
                <td class="text-right tabular-nums font-medium">{fmtDollar(row.total_contract)}</td>
                <td class="text-right tabular-nums">{fmtDollar(tc)}</td>
                <td class="text-right tabular-nums {profitClass(prof)}">{fmtDollar(prof)}</td>
                <td class="text-right tabular-nums {profitClass(pp)}">{fmtPct(pp)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-base-content/30 text-right">{detailData.length} job{detailData.length !== 1 ? "s" : ""} imported</p>
    {/if}

  {:else}
    <!-- ═══ SUMMARY TABLE ═══ -->
    {#if summaryData.length === 0}
      <div class="apple-panel p-12 text-center">
        <div class="text-base-content/30 text-4xl mb-3">📈</div>
        <p class="text-base-content/50 text-sm">No job summary data imported yet</p>
        <p class="text-base-content/30 text-xs mt-1">Upload an A-Systems Comprehensive Job Summary PDF</p>
      </div>
    {:else}
      <div class="apple-panel overflow-x-auto">
        <table class="apple-table w-full text-sm">
          <thead>
            <tr>
              <th class="sticky left-0 bg-base-200/80 backdrop-blur z-10">Job</th>
              <th>% Complete</th>
              <th>Contract</th>
              <th>Billed</th>
              <th>Cost to Date</th>
              <th>Earned</th>
              <th>Profit Rate</th>
              <th>Cash Flow</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each summaryData as row}
              {@const budget = hasBudget(row)}
              {@const projProfit = calcProfit(row)}
              {@const profRate = calcProfitRate(row)}
              {@const cashFlow = calcCashFlow(row)}
              {@const billing = calcBillingGap(row)}
              <tr class="cursor-pointer hover:bg-base-200/40 {budget ? '' : 'opacity-60'}" on:click={() => toggleExpand(row.job_number)}>
                <td class="sticky left-0 bg-white z-10 font-medium">
                  <div class="min-w-[140px] flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-base-content/30 transition-transform" class:rotate-90={expandedJob === row.job_number} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span class="text-primary">{row.job_number}</span>
                    <span class="text-base-content/40 text-xs">{row.job_name || row.matched_job_name || ""}</span>
                    {#if !budget}
                      <span class="badge badge-xs badge-warning gap-0.5">No Budget</span>
                    {/if}
                  </div>
                </td>
                <td class="text-right tabular-nums">
                  {#if !budget}
                    <span class="text-base-content/30 text-xs">—</span>
                  {:else if row.percent_complete != null}
                    <div class="flex items-center gap-2 justify-end">
                      <div class="w-12 h-1.5 bg-base-300 rounded-full overflow-hidden">
                        <div class="h-full bg-primary rounded-full" style="width: {Math.min(row.percent_complete, 100)}%"></div>
                      </div>
                      <span class="text-xs">{fmtPct(row.percent_complete)}</span>
                    </div>
                  {:else}—{/if}
                </td>
                <td class="text-right tabular-nums font-medium">{fmtDollar(row.revised_contract_price)}</td>
                <td class="text-right tabular-nums">{fmtDollar(row.billed_to_date)}</td>
                <td class="text-right tabular-nums">{fmtDollar(row.cost_to_date)}</td>
                <td class="text-right tabular-nums">{fmtDollar(row.earned_to_date)}</td>
                <td class="text-right tabular-nums {profitClass(profRate)}">{fmtPct(profRate)}</td>
                <td class="text-right tabular-nums {profitClass(cashFlow)}">{fmtDollar(cashFlow)}</td>
                <td class="text-center">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </td>
              </tr>

              <!-- Expanded breakdown -->
              {#if expandedJob === row.job_number}
                <tr>
                  <td colspan="9" class="p-0">
                    <div class="bg-base-200/30 p-4 space-y-4">
                      {#if !budget}
                        <div class="flex items-center gap-2 text-warning text-xs">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          No budget entered in A-Systems — % complete, profit, and variance data is not meaningful for this job.
                        </div>
                      {/if}
                      <!-- Computed KPIs from actuals -->
                      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p class="text-xs text-base-content/40 uppercase tracking-wider">Projected Profit</p>
                          <p class="text-sm font-medium tabular-nums {profitClass(projProfit)}">{fmtDollar(projProfit)}</p>
                          <p class="text-[10px] text-base-content/30">contract - (cost / %complete)</p>
                        </div>
                        <div>
                          <p class="text-xs text-base-content/40 uppercase tracking-wider">Received to Date</p>
                          <p class="text-sm font-medium tabular-nums">{fmtDollar(row.received_to_date)}</p>
                        </div>
                        <div>
                          <p class="text-xs text-base-content/40 uppercase tracking-wider">Paid Out to Date</p>
                          <p class="text-sm font-medium tabular-nums">{fmtDollar(row.paid_out_to_date)}</p>
                        </div>
                        <div>
                          <p class="text-xs text-base-content/40 uppercase tracking-wider">
                            {billing ? billing.label : "Billing Gap"}
                          </p>
                          <p class="text-sm font-medium tabular-nums {billing && billing.label === 'Under Billings' ? 'text-warning' : ''}">
                            {billing ? fmtDollar(billing.value) : "—"}
                          </p>
                          <p class="text-[10px] text-base-content/30">billed - earned</p>
                        </div>
                      </div>

                      <!-- Category Breakdown Table -->
                      <div class="overflow-x-auto">
                        <table class="w-full text-xs">
                          <thead>
                            <tr class="border-b border-base-300/50">
                              <th class="text-left py-1.5 font-medium text-base-content/60">Category</th>
                              <th class="text-right py-1.5 font-medium text-base-content/60">% Complete</th>
                              <th class="text-right py-1.5 font-medium text-base-content/60">Orig Budget</th>
                              <th class="text-right py-1.5 font-medium text-base-content/60">Curr Budget</th>
                              <th class="text-right py-1.5 font-medium text-base-content/60">Cost to Date</th>
                              <th class="text-right py-1.5 font-medium text-base-content/60">Remaining</th>
                              <th class="text-right py-1.5 font-medium text-base-content/60">% Budget Used</th>
                            </tr>
                          </thead>
                          <tbody>
                            {#each [
                              { label: "Labor", pct: row.labor_pct_complete, orig: row.labor_orig_budget, curr: row.labor_curr_budget, cost: row.labor_cost_to_date },
                              { label: "Material", pct: row.material_pct_complete, orig: row.material_orig_budget, curr: row.material_curr_budget, cost: row.material_cost_to_date },
                              { label: "Subcontract", pct: row.subcontract_pct_complete, orig: row.subcontract_orig_budget, curr: row.subcontract_curr_budget, cost: row.subcontract_cost_to_date },
                              { label: "Equipment", pct: row.equipment_pct_complete, orig: row.equipment_orig_budget, curr: row.equipment_curr_budget, cost: row.equipment_cost_to_date },
                              { label: "General", pct: row.general_pct_complete, orig: row.general_orig_budget, curr: row.general_curr_budget, cost: row.general_cost_to_date },
                            ] as cat}
                              {@const rem = remaining(cat.curr, cat.cost)}
                              {@const budgetUsed = pctOf(cat.cost, cat.curr)}
                              <tr class="border-b border-base-300/30">
                                <td class="py-1.5 font-medium">{cat.label}</td>
                                <td class="text-right tabular-nums">{budget ? fmtPct(cat.pct) : '—'}</td>
                                <td class="text-right tabular-nums">{fmtDollar(cat.orig)}</td>
                                <td class="text-right tabular-nums">{fmtDollar(cat.curr)}</td>
                                <td class="text-right tabular-nums">{fmtDollar(cat.cost)}</td>
                                <td class="text-right tabular-nums {budget ? varianceClass(rem) : ''}">{budget ? fmtDollar(rem) : '—'}</td>
                                <td class="text-right tabular-nums {budget ? pctClass(budgetUsed) : ''}">{budget ? fmtPct(budgetUsed) : '—'}</td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-base-content/30 text-right">{summaryData.length} job{summaryData.length !== 1 ? "s" : ""} imported</p>
    {/if}
  {/if}
</div>
