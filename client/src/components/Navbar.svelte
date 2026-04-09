<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { user, currentPage, appSettings, sidebarCollapsed } from "../lib/stores";
  import BirdDogLogo from "./BirdDogLogo.svelte";

  const dispatch = createEventDispatcher();

  $: collapsed = $sidebarCollapsed;
  let mobileOpen = false;

  $: isAdmin = $user?.role === "admin" || $user?.role === "super_admin";
  $: isSuperAdmin = $user?.role === "super_admin";
  $: canReport = $user?.role === "admin" || $user?.role === "super_admin" || $user?.role === "pm";

  // ── Navigation ──────────────────────────────────────────
  const handleNavClick = (pageId: string) => {
    currentPage.set(pageId);
    activeFlyout = null; // close any flyout on navigate
    if (window.innerWidth < 768) mobileOpen = false;
  };

  const handleLogout = () => { dispatch("logout"); };
  const toggleCollapse = () => { sidebarCollapsed.update(v => !v); activeFlyout = null; };
  const toggleMobile = () => { mobileOpen = !mobileOpen; };
  const closeMobileDrawer = () => { mobileOpen = false; };

  // ── Section expand/collapse (expanded mode) ─────────────
  let openSections: Record<string, boolean> = {
    people: false, assets: false, field: false,
    tools: false, insights: false, admin: false,
  };

  const toggleSection = (section: string) => {
    if (collapsed) {
      // In collapsed mode, toggle flyout instead
      toggleFlyout(section);
    } else {
      openSections[section] = !openSections[section];
      openSections = openSections;
    }
  };

  // ── Flyout menus (collapsed mode) ───────────────────────
  let activeFlyout: string | null = null;
  let flyoutY: number = 0;
  let flyoutElement: HTMLDivElement | null = null;

  function toggleFlyout(section: string) {
    if (activeFlyout === section) {
      activeFlyout = null;
    } else {
      activeFlyout = section;
    }
  }

  function handleParentClick(e: MouseEvent, section: string) {
    if (collapsed) {
      // Calculate vertical position from the clicked button
      const btn = e.currentTarget as HTMLElement;
      const rect = btn.getBoundingClientRect();
      flyoutY = rect.top;
      toggleFlyout(section);
    } else {
      toggleSection(section);
    }
  }

  // Close flyout on outside click
  function handleDocumentClick(e: MouseEvent) {
    if (!activeFlyout) return;
    const target = e.target as HTMLElement;
    // If click is inside the sidebar or flyout, ignore
    if (target.closest('.sb-sidebar') || target.closest('.sb-flyout')) return;
    activeFlyout = null;
  }

  // Close flyout on Escape
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') activeFlyout = null;
  }

  onMount(() => {
    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleDocumentClick, true);
    document.removeEventListener('keydown', handleKeydown);
  });

  // Close flyout when sidebar expands
  $: if (!collapsed) activeFlyout = null;

  // ── User initials ───────────────────────────────────────
  $: userInitials = $user?.displayName
    ?.split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  // ── Section definitions for DRY rendering ───────────────
  interface NavChild {
    id: string;
    label: string;
    icon: string;
    gate?: 'admin' | 'canReport';
  }
  interface NavSection {
    key: string;
    label: string;
    icon: string;
    gate?: 'admin' | 'superAdmin';
    children: NavChild[];
  }

  const sections: NavSection[] = [
    {
      key: 'people', label: 'People',
      icon: 'M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
      children: [
        { id: 'employees', label: 'Employees', icon: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z' },
        { id: 'general-contractors', label: 'General Contractors', icon: 'M3 5h18v2H3zm0 4h18v10c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V9zm2 2v8h14V11H5z', gate: 'admin' },
        { id: 'suppliers', label: 'Suppliers', icon: 'M18 18.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM2 3h2l.4 2H21l-2.6 8H9l-.6-2H3.9L3 5H1V3h1zm6 15.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z', gate: 'admin' },
      ],
    },
    {
      key: 'assets', label: 'Assets',
      icon: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
      children: [
        { id: 'tools', label: 'Tools', icon: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z' },
        { id: 'vehicles', label: 'Vehicles', icon: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm11 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM5 11l1.5-4.5h11L19 11H5z' },
      ],
    },
    {
      key: 'field', label: 'Field', gate: 'superAdmin',
      icon: 'M11 2v4H4c0-2.21 3.13-4 7-4zm1 0c3.87 0 7 1.79 7 4h-7V2zM3 7h18c.55 0 1 .45 1 1v1c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1V8c0-.55.45-1 1-1zm1 4h16v2H4v-2zm2 3h12v1c0 1.1-.9 2-2 2H8c-1.1 0-2-.9-2-2v-1z',
      children: [
        { id: 'crew-map', label: 'Crew Tracker', icon: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z' },
        { id: 'daily-reports', label: 'Daily Reports', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5-10H7v2h7V9zm-7 6h10v-2H7v2z' },
        { id: 'toolbox-talks', label: 'Toolbox Talks', icon: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z' },
        { id: 'change-orders', label: 'Change Orders', icon: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zm-2 3v2H9v2h2v2h2v-2h2v-2h-2v-2h-2z' },
      ],
    },
    {
      key: 'tools', label: 'Project Tools',
      icon: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z',
      children: [
        { id: 'schedule', label: 'Schedule', icon: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z' },
        { id: 'meeting-tool', label: 'Project Meetings', icon: 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z' },
        { id: 'asystems-import', label: 'Import Accounting', icon: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z', gate: 'admin' },
      ],
    },
    // Reports is now a standalone item — no dropdown
  ];

  const adminSection: NavSection = {
    key: 'admin', label: 'Settings', gate: 'admin',
    icon: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.62l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.48.11.62l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.62l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.62l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
    children: [
      { id: 'admin', label: 'Admin Panel', icon: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z' },
      { id: 'classifications', label: 'Classifications', icon: 'M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z' },
      { id: 'job-codes', label: 'Job Codes', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z' },
      { id: 'jurisdictions', label: 'Jurisdictions', icon: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z' },
    ],
  };

  // Visibility helpers
  function isSectionVisible(sec: NavSection): boolean {
    if (sec.gate === 'admin') return isAdmin;
    if (sec.gate === 'superAdmin') return isSuperAdmin;
    return true;
  }

  function isChildVisible(child: NavChild): boolean {
    if (child.gate === 'admin') return isAdmin;
    if (child.gate === 'canReport') return canReport;
    return true;
  }

  function visibleChildren(sec: NavSection): NavChild[] {
    return sec.children.filter(c => isChildVisible(c));
  }

  // Check if any child in a section is active
  function sectionHasActive(sec: NavSection): boolean {
    return sec.children.some(c => $currentPage === c.id);
  }
</script>

<!-- Mobile hamburger -->
<button class="sb-mobile-toggle" aria-label="Toggle navigation" on:click={toggleMobile}>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
</button>

<!-- Mobile backdrop -->
{#if mobileOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="sb-backdrop" on:click={closeMobileDrawer} />
{/if}

<!-- ═══ SIDEBAR ═══ -->
<aside class="sb-sidebar" class:sb-collapsed={collapsed} class:sb-mobile-open={mobileOpen}>

  <!-- Logo row -->
  <div class="sb-logo-row">
    {#if collapsed}
      <button class="sb-hamburger" on:click={toggleCollapse} aria-label="Expand sidebar" title="Expand menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>
    {:else}
      <button class="sb-logo-btn" on:click={() => handleNavClick("board")}>
        <div class="sb-logo-icon"><BirdDogLogo size={28} /></div>
        <div class="sb-logo-text">
          <div class="sb-logo-name">BirdDog</div>
          {#if $appSettings.companyName}
            <div class="sb-logo-sub">{$appSettings.companyName}</div>
          {/if}
        </div>
      </button>
      <button class="sb-collapse-btn" on:click={toggleCollapse} aria-label="Collapse sidebar" title="Collapse menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    {/if}
  </div>

  <!-- Scrollable nav -->
  <div class="sb-scroll">

    <!-- Top-level standalone items -->
    <button class="sb-item" class:sb-active={$currentPage === 'board'} on:click={() => handleNavClick('board')} title={collapsed ? 'Workforce Board' : ''}>
      <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
      <span class="sb-text">Workforce Board</span>
    </button>

    <button class="sb-item" class:sb-active={$currentPage === 'jobs'} on:click={() => handleNavClick('jobs')} title={collapsed ? 'Jobs' : ''}>
      <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7v10c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7H3zm0 0c0-1.1.9-2 2-2h2V3h8v2h2c1.1 0 2 .9 2 2" /></svg>
      <span class="sb-text">Jobs</span>
    </button>

    <button class="sb-item" class:sb-active={$currentPage === 'opportunities'} on:click={() => handleNavClick('opportunities')} title={collapsed ? 'Opportunities' : ''}>
      <svg class="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>
      <span class="sb-text">Opportunities</span>
    </button>

    <button class="sb-item" class:sb-active={$currentPage === 'time-tracking'} on:click={() => handleNavClick('time-tracking')} title={collapsed ? 'Timekeeping' : ''}>
      <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" /></svg>
      <span class="sb-text">Timekeeping</span>
    </button>

    <!-- Expandable sections -->
    {#each sections as sec (sec.key)}
      {#if isSectionVisible(sec)}
        <!-- Section parent -->
        <button
          class="sb-item sb-section-parent"
          class:sb-section-open={openSections[sec.key]}
          class:sb-section-has-active={sectionHasActive(sec)}
          on:click={(e) => handleParentClick(e, sec.key)}
          title={collapsed ? sec.label : ''}
        >
          <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><path d={sec.icon} /></svg>
          <span class="sb-text">{sec.label}</span>
          <svg class="sb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
        </button>

        <!-- Children (expanded mode) -->
        {#if openSections[sec.key] && !collapsed}
          <nav class="sb-sub">
            {#each visibleChildren(sec) as child (child.id)}
              <button class="sb-item sb-sub-item" class:sb-active={$currentPage === child.id} on:click={() => handleNavClick(child.id)}>
                <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><path d={child.icon} /></svg>
                <span class="sb-text">{child.label}</span>
              </button>
            {/each}
          </nav>
        {/if}

      {/if}
    {/each}

    <!-- Reports — standalone (no dropdown) -->
    {#if canReport}
      <button class="sb-item" class:sb-active={$currentPage === 'reports'} on:click={() => handleNavClick('reports')} title={collapsed ? 'Reports' : ''}>
        <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z" /></svg>
        <span class="sb-text">Reports</span>
      </button>
    {/if}

    <!-- Communicate — standalone loudspeaker -->
    {#if canReport}
      <button class="sb-item" class:sb-active={$currentPage === 'communicate'} on:click={() => handleNavClick('communicate')} title={collapsed ? 'Communicate' : ''}>
        <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 14h2v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6h.39c.38 1.52 1.68 2.64 3.32 2.9l.29.04V14h1V8h-1v-2.94l-.29.04C10.07 5.36 8.77 6.48 8.39 8H3c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1zm11-5v6c2.49-.45 4.44-2.56 4.87-5.18.05-.26.08-.53.1-.82.02-.33.03-.67.03-1 0-.33-.01-.67-.03-1-.02-.29-.05-.56-.1-.82C18.44 3.56 16.49 1.45 14 1V3c1.86.45 3.28 1.96 3.71 3.87.05.25.09.5.12.76.02.24.03.49.03.74v.26c0 .25-.01.5-.03.74-.03.26-.07.51-.12.76C17.28 12.04 15.86 13.55 14 14V9z"/></svg>
        <span class="sb-text">Communicate</span>
      </button>
    {/if}

    <!-- AI Chat — special standalone button -->
    <div class="sb-ai-wrap">
      <button class="sb-ai-btn" class:sb-active={$currentPage === 'chat'} on:click={() => handleNavClick('chat')} title={collapsed ? 'AI Chat' : ''}>
        <svg class="sb-ai-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 3c-4.97 0-9 3.18-9 7.1 0 2.34 1.52 4.42 3.88 5.7L6 20l4.2-2.1c.58.07 1.18.1 1.8.1 4.97 0 9-3.18 9-7.1S16.97 3 12 3z" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="8.5" cy="10" r="0.75" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="10" r="0.75" fill="currentColor" stroke="none"/>
          <circle cx="15.5" cy="10" r="0.75" fill="currentColor" stroke="none"/>
        </svg>
        <span class="sb-text">AI Chat</span>
        <span class="sb-ai-badge">AI</span>
      </button>
    </div>

  </div><!-- end sb-scroll -->

  <!-- Bottom: Settings + User + Logout -->
  <div class="sb-bottom">
    <div class="sb-sep" />

    <!-- Admin settings section -->
    {#if isAdmin}
      <button
        class="sb-item sb-section-parent"
        class:sb-section-open={openSections.admin}
        class:sb-section-has-active={sectionHasActive(adminSection)}
        on:click={(e) => handleParentClick(e, 'admin')}
        title={collapsed ? 'Settings' : ''}
      >
        <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><path d={adminSection.icon} /></svg>
        <span class="sb-text">Settings</span>
        <svg class="sb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {#if openSections.admin && !collapsed}
        <nav class="sb-sub">
          {#each visibleChildren(adminSection) as child (child.id)}
            <button class="sb-item sb-sub-item" class:sb-active={$currentPage === child.id} on:click={() => handleNavClick(child.id)}>
              <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><path d={child.icon} /></svg>
              <span class="sb-text">{child.label}</span>
            </button>
          {/each}
        </nav>
      {/if}
    {/if}

    <!-- User info -->
    <div class="sb-user-row">
      {#if collapsed}
        <div class="sb-avatar" title={$user?.displayName}>{userInitials}</div>
      {:else}
        <div class="sb-user-info">
          <div class="sb-user-name">{$user?.displayName}</div>
          <div class="sb-user-role">{$user?.role?.replace('_', ' ')}</div>
        </div>
      {/if}
    </div>

    <!-- Logout -->
    <button class="sb-item sb-sign-out" on:click={handleLogout} title={collapsed ? 'Sign Out' : ''}>
      <svg class="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      <span class="sb-text">Sign Out</span>
    </button>
  </div>
</aside>

<!-- ═══ FLYOUT PORTAL — rendered outside sidebar to avoid backdrop-filter containing block ═══ -->
{#if collapsed && activeFlyout}
  {#each [...sections, adminSection] as sec (sec.key)}
    {#if activeFlyout === sec.key && isSectionVisible(sec)}
      {#if sec.key === 'admin'}
        <div class="sb-flyout sb-flyout-bottom" style="bottom: 80px;">
          <div class="sb-flyout-title">{sec.label}</div>
          {#each visibleChildren(sec) as child (child.id)}
            <button class="sb-flyout-item" class:sb-active={$currentPage === child.id} on:click={() => handleNavClick(child.id)}>
              <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><path d={child.icon} /></svg>
              <span>{child.label}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="sb-flyout" style="top: {flyoutY}px;">
          <div class="sb-flyout-title">{sec.label}</div>
          {#each visibleChildren(sec) as child (child.id)}
            <button class="sb-flyout-item" class:sb-active={$currentPage === child.id} on:click={() => handleNavClick(child.id)}>
              <svg class="sb-icon" viewBox="0 0 24 24" fill="currentColor"><path d={child.icon} /></svg>
              <span>{child.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  {/each}
{/if}

<style>
  /* ═══════════════════════════════════════════════════════════
     SIDEBAR — 240px expanded, 56px collapsed, flyout menus
     ═══════════════════════════════════════════════════════════ */

  /* ── Shell ──────────────────────────────────────────────── */
  .sb-sidebar {
    position: fixed; left: 0; top: 0;
    height: 100vh; width: 240px;
    background: rgba(255,255,255,0.96);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-right: 1px solid #e5e5ea;
    z-index: 50;
    display: flex; flex-direction: column;
    transition: width 0.2s ease;
    overflow: hidden;
  }
  .sb-sidebar.sb-collapsed { width: 56px; }

  @media (max-width: 767px) {
    .sb-sidebar { transform: translateX(-100%); transition: transform 0.25s ease; }
    .sb-sidebar.sb-mobile-open { transform: translateX(0); }
  }

  /* ── Mobile chrome ──────────────────────────────────────── */
  .sb-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 40; display: none; }
  @media (max-width: 767px) { .sb-backdrop { display: block; } }

  .sb-mobile-toggle {
    display: none; position: fixed; top: 0.75rem; left: 0.75rem; z-index: 45;
    width: 36px; height: 36px; padding: 6px;
    background: rgba(255,255,255,0.9); border: 1px solid #e5e5ea; border-radius: 8px;
    cursor: pointer; color: #1d1d1f;
  }
  .sb-mobile-toggle svg { width: 100%; height: 100%; }
  @media (max-width: 767px) { .sb-mobile-toggle { display: flex; align-items: center; justify-content: center; } }

  /* ── Logo row ───────────────────────────────────────────── */
  .sb-logo-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 12px 10px; border-bottom: 1px solid #e5e5ea; flex-shrink: 0;
    min-height: 52px;
  }
  .sb-logo-btn {
    display: flex; align-items: center; gap: 10px;
    background: none; border: none; cursor: pointer; padding: 0; min-width: 0;
  }
  .sb-logo-btn:hover { opacity: 0.7; }
  .sb-logo-icon { flex-shrink: 0; display: flex; align-items: center; justify-content: center; transform: scale(1.15); }
  .sb-logo-text { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
  .sb-logo-name { font-size: 1rem; font-weight: 700; color: #1d1d1f; letter-spacing: -0.01em; }
  .sb-logo-sub { font-size: 0.625rem; color: #86868b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .sb-collapse-btn, .sb-hamburger {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: none; border: none; border-radius: 6px;
    cursor: pointer; color: #86868b; flex-shrink: 0;
    transition: all 0.15s ease;
  }
  .sb-collapse-btn:hover, .sb-hamburger:hover { background: #f2f2f7; color: #1d1d1f; }
  .sb-collapse-btn svg, .sb-hamburger svg { width: 16px; height: 16px; }
  .sb-collapsed .sb-logo-row { justify-content: center; padding: 12px 6px 10px; }
  @media (max-width: 767px) { .sb-collapse-btn { display: none; } }

  /* ── Scrollable nav area ────────────────────────────────── */
  .sb-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 6px 0; }
  .sb-scroll::-webkit-scrollbar { width: 4px; }
  .sb-scroll::-webkit-scrollbar-track { background: transparent; }
  .sb-scroll::-webkit-scrollbar-thumb { background: #d1d1d6; border-radius: 2px; }

  /* ── Universal nav item ─────────────────────────────────── */
  .sb-item {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 7px 14px; background: none; border: none;
    border-left: 3px solid transparent;
    cursor: pointer; color: #3a3a3c;
    font-size: 0.8125rem; font-weight: 500;
    text-align: left; white-space: nowrap; line-height: 1.3;
    transition: background 0.12s ease, color 0.12s ease;
    position: relative;
  }
  .sb-item:hover { background: #f2f2f7; color: #1d1d1f; }
  .sb-item.sb-active {
    border-left-color: #007aff; background: #e8f0fe; color: #007aff; font-weight: 600;
  }

  /* ── Icon (18px uniform) ────────────────────────────────── */
  .sb-icon { width: 18px; height: 18px; flex-shrink: 0; }

  /* ── Text label ─────────────────────────────────────────── */
  .sb-text { overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .sb-collapsed .sb-text { display: none; }

  /* ── Section parent ─────────────────────────────────────── */
  .sb-section-parent { font-weight: 600; color: #1d1d1f; }
  .sb-section-parent.sb-section-has-active { color: #007aff; }

  .sb-chev {
    width: 14px; height: 14px; flex-shrink: 0; color: #86868b;
    transition: transform 0.2s ease; margin-left: auto;
  }
  .sb-section-parent:not(.sb-section-open) .sb-chev { transform: rotate(-90deg); }
  .sb-collapsed .sb-chev { display: none; }
  .sb-collapsed .sb-section-parent { font-weight: 500; color: #3a3a3c; }
  .sb-collapsed .sb-section-parent.sb-section-has-active { color: #007aff; }

  /* ── Sub-items (children, expanded mode) ────────────────── */
  .sb-sub { display: flex; flex-direction: column; }
  .sb-sub-item { padding-left: 44px; font-weight: 400; color: #48484a; }
  .sb-sub-item:hover { color: #1d1d1f; }

  /* ── Collapsed mode overrides ───────────────────────────── */
  .sb-collapsed .sb-item {
    padding: 8px 0; justify-content: center; gap: 0; border-left-width: 0;
  }
  .sb-collapsed .sb-item.sb-active { border-left-width: 3px; padding-left: 0; }
  .sb-collapsed .sb-sub { display: none; }

  /* ── AI Chat button ─────────────────────────────────────── */
  .sb-ai-wrap { padding: 4px 10px; margin-top: 2px; }
  .sb-ai-btn {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 8px 12px; border: none; border-radius: 10px;
    cursor: pointer; font-size: 0.8125rem; font-weight: 600;
    font-family: inherit; text-align: left; white-space: nowrap;
    background: linear-gradient(135deg, #f0f0ff 0%, #e8f4ff 100%);
    color: #5856d6; transition: all 0.15s;
    border: 1px solid rgba(88,86,214,0.15);
  }
  .sb-ai-btn:hover {
    background: linear-gradient(135deg, #e8e6ff 0%, #dceeff 100%);
    box-shadow: 0 2px 8px rgba(88,86,214,0.15);
    transform: translateY(-1px);
  }
  .sb-ai-btn.sb-active {
    background: linear-gradient(135deg, #5856d6 0%, #007aff 100%);
    color: white; border-color: transparent;
    box-shadow: 0 2px 12px rgba(88,86,214,0.3);
  }
  .sb-ai-icon { width: 18px; height: 18px; flex-shrink: 0; }
  .sb-ai-badge {
    font-size: 0.5625rem; font-weight: 700; letter-spacing: 0.05em;
    padding: 1px 6px; border-radius: 4px; margin-left: auto;
    background: rgba(88,86,214,0.12); color: #5856d6;
  }
  .sb-ai-btn.sb-active .sb-ai-badge { background: rgba(255,255,255,0.2); color: white; }

  .sb-collapsed .sb-ai-wrap { padding: 4px 6px; }
  .sb-collapsed .sb-ai-btn { padding: 8px; justify-content: center; gap: 0; }
  .sb-collapsed .sb-ai-badge { display: none; }

  /* ── Separator ──────────────────────────────────────────── */
  .sb-sep { height: 1px; background: #e5e5ea; margin: 6px 14px; }
  .sb-collapsed .sb-sep { margin: 6px 8px; }

  /* ═══════════════════════════════════════════════════════════
     FLYOUT MENUS — pop out to the right in collapsed mode
     ═══════════════════════════════════════════════════════════ */
  .sb-flyout {
    position: fixed;
    left: 60px;
    min-width: 200px;
    background: rgba(255,255,255,0.97);
    backdrop-filter: saturate(180%) blur(24px);
    -webkit-backdrop-filter: saturate(180%) blur(24px);
    border: 1px solid #e5e5ea;
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
    padding: 6px 0;
    z-index: 100;
    animation: sb-flyout-in 0.15s ease;
  }
  .sb-flyout-bottom {
    /* anchored from bottom instead of top */
    top: auto !important;
  }

  @keyframes sb-flyout-in {
    from { opacity: 0; transform: translateX(-6px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .sb-flyout-title {
    padding: 6px 14px 4px;
    font-size: 0.6875rem; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em;
    color: #86868b;
  }

  .sb-flyout-item {
    display: flex; align-items: center; gap: 10px;
    width: 100%; padding: 8px 14px;
    background: none; border: none;
    cursor: pointer; color: #3a3a3c;
    font-size: 0.8125rem; font-weight: 500;
    text-align: left; white-space: nowrap;
    transition: background 0.1s ease;
  }
  .sb-flyout-item:hover { background: #f2f2f7; color: #1d1d1f; }
  .sb-flyout-item.sb-active { color: #007aff; font-weight: 600; }
  .sb-flyout-item .sb-icon { width: 16px; height: 16px; }

  /* ── Bottom section ─────────────────────────────────────── */
  .sb-bottom { flex-shrink: 0; border-top: 1px solid #e5e5ea; padding-bottom: 6px; }

  /* ── User row ───────────────────────────────────────────── */
  .sb-user-row { padding: 10px 14px 4px; }
  .sb-user-info { display: flex; flex-direction: column; gap: 1px; }
  .sb-user-name { font-size: 0.8125rem; font-weight: 600; color: #1d1d1f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sb-user-role { font-size: 0.6875rem; color: #86868b; text-transform: capitalize; }

  .sb-avatar {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; margin: 0 auto;
    background: #f0f0f3; border-radius: 50%;
    font-size: 0.6875rem; font-weight: 600; color: #48484a;
  }
  .sb-collapsed .sb-user-info { display: none; }
  .sb-collapsed .sb-user-row { padding: 8px 0; }

  /* ── Sign out ───────────────────────────────────────────── */
  .sb-sign-out { color: #86868b; }
  .sb-sign-out:hover { color: #ff3b30; background: #fff5f5; }
</style>
