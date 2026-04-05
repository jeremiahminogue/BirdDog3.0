<script lang="ts">
  import { onMount } from "svelte";
  import { api, auth } from "./lib/api";
  import { user, currentPage, appSettings, selectedEmployeeId, sidebarCollapsed } from "./lib/stores";
  import Login from "./pages/Login.svelte";
  import Navbar from "./components/Navbar.svelte";
  import WorkforceBoard from "./pages/WorkforceBoard.svelte";
  import Employees from "./pages/Employees.svelte";
  import Jobs from "./pages/Jobs.svelte";
  import Classifications from "./pages/Classifications.svelte";
  import Jurisdictions from "./pages/Jurisdictions.svelte";
  import Admin from "./pages/Admin.svelte";
  import Reports from "./pages/Reports.svelte";
  import EmployeeProfile from "./pages/EmployeeProfile.svelte";
  import Chat from "./pages/Chat.svelte";
  import Tools from "./pages/Tools.svelte";
  import Vehicles from "./pages/Vehicles.svelte";
  import Schedule from "./pages/Schedule.svelte";
  import MeetingTool from "./pages/MeetingTool.svelte";
  import ASystemsImport from "./pages/ASystemsImport.svelte";
  import Opportunities from "./pages/Opportunities.svelte";
  import GeneralContractors from "./pages/GeneralContractors.svelte";
  import Suppliers from "./pages/Suppliers.svelte";
  import DailyReports from "./pages/DailyReports.svelte";
  import TimeTracking from "./pages/TimeTracking.svelte";
  import CrewMap from "./pages/CrewMap.svelte";
  import ToolboxTalks from "./pages/ToolboxTalks.svelte";
  import ChangeOrders from "./pages/ChangeOrders.svelte";

  let loading = true;

  async function loadSettings() {
    try {
      const s = await api.get("/settings");
      appSettings.set({ companyName: s.companyName || "", companyShort: s.companyShort || "" });
    } catch {
      // Settings endpoint might not exist yet on older deploys
    }
  }

  onMount(async () => {
    await loadSettings();
    try {
      const me = await auth.me();
      user.set(me);
    } catch {
      user.set(null);
    }
    loading = false;
  });

  async function handleLogin(e: CustomEvent) {
    user.set(e.detail);
  }

  async function handleLogout() {
    await auth.logout();
    user.set(null);
  }
</script>

{#if loading}
  <div class="app-loading">
    <span class="loading loading-spinner loading-lg text-primary"></span>
  </div>
{:else if !$user}
  <Login on:login={handleLogin} />
{:else}
  <div class="app-layout">
    <Navbar on:logout={handleLogout} />
    <main class="app-main" class:app-main-collapsed={$sidebarCollapsed}>
      {#if $currentPage === "board"}
        <WorkforceBoard />
      {:else if $currentPage === "employee-profile" && $selectedEmployeeId}
        <EmployeeProfile employeeId={$selectedEmployeeId} />
      {:else if $currentPage === "employees"}
        <Employees />
      {:else if $currentPage === "jobs"}
        <Jobs />
      {:else if $currentPage === "tools"}
        <Tools />
      {:else if $currentPage === "vehicles"}
        <Vehicles />
      {:else if $currentPage === "classifications"}
        <Classifications />
      {:else if $currentPage === "jurisdictions"}
        <Jurisdictions />
      {:else if $currentPage === "schedule"}
        <Schedule />
      {:else if $currentPage === "meeting-tool"}
        <MeetingTool />
      {:else if $currentPage === "asystems-import"}
        <ASystemsImport />
      {:else if $currentPage === "opportunities"}
        <Opportunities />
      {:else if $currentPage === "reports"}
        <Reports />
      {:else if $currentPage === "admin"}
        <Admin />
      {:else if $currentPage === "general-contractors"}
        <GeneralContractors />
      {:else if $currentPage === "suppliers"}
        <Suppliers />
      {:else if $currentPage === "daily-reports"}
        <DailyReports />
      {:else if $currentPage === "time-tracking"}
        <TimeTracking />
      {:else if $currentPage === "crew-map"}
        <CrewMap />
      {:else if $currentPage === "toolbox-talks"}
        <ToolboxTalks />
      {:else if $currentPage === "change-orders"}
        <ChangeOrders />
      {:else if $currentPage === "chat"}
        <Chat />
      {/if}
    </main>
  </div>
{/if}

<style>
  .app-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }

  .app-layout {
    display: flex;
    min-height: 100vh;
    background: linear-gradient(180deg, #ffffff 0%, #f5f5f7 100%);
  }

  .app-main {
    flex: 1;
    margin-left: 240px;
    padding: 1.5rem;
    max-width: calc(100vw - 240px);
    min-height: 100vh;
    transition: margin-left 0.2s ease, max-width 0.2s ease;
  }

  /* When sidebar is collapsed (56px) */
  .app-main-collapsed {
    margin-left: 56px;
    max-width: calc(100vw - 56px);
  }

  /* Mobile: no sidebar margin */
  @media (max-width: 767px) {
    .app-main {
      margin-left: 0;
      max-width: 100vw;
      padding: 1rem;
      padding-top: 3.5rem; /* space for hamburger button */
    }
  }
</style>
