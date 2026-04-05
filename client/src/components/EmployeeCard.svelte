<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let employee: {
    id: number;
    firstName: string;
    lastName: string;
    employeeNumber: string;
    classificationName: string;
    classificationColor: string;
    department: string;
    effectiveHourlyRate?: number;
    effectiveCostRate?: number;
    role?: string;
    photoUrl?: string;
  };
  export let showRate = false;
  export let compact = false;
  export let pendingMove: { jobNumber: string | null; effectiveDate: string; toJobId: number | null } | null = null;

  function fmtMoveDate(d: string): string {
    const dt = new Date(d + "T12:00:00");
    return `${dt.getMonth()+1}/${dt.getDate()}`;
  }

  const dispatch = createEventDispatcher();

  function onDragStart(e: DragEvent) {
    dispatch("dragstart", { event: e, employee });
  }

  // Initials for avatar
  $: initials = `${employee.firstName[0]}${employee.lastName[0]}`;
</script>

<div
  class="employee-card bg-base-100 rounded-lg border border-base-300 p-2 flex items-center gap-2"
  class:p-1.5={compact}
  draggable="true"
  on:dragstart={onDragStart}
  role="listitem"
>
  <!-- Avatar with photo or classification color -->
  {#if employee.photoUrl}
    <img
      src={employee.photoUrl}
      alt="{employee.firstName} {employee.lastName}"
      class="rounded-full object-cover flex-shrink-0 border border-base-300"
      class:w-9={!compact}
      class:h-9={!compact}
      class:w-7={compact}
      class:h-7={compact}
    />
  {:else}
    <div
      class="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
      class:w-7={compact}
      class:h-7={compact}
      style="background-color: {employee.classificationColor || '#64748b'}"
    >
      {initials}
    </div>
  {/if}

  <div class="flex-1 min-w-0">
    <div class="font-medium text-sm truncate">
      {employee.firstName} {employee.lastName}
      {#if employee.role}
        <span class="badge badge-xs badge-accent ml-1">{employee.role}</span>
      {/if}
    </div>
    <div class="text-xs text-base-content/60 truncate">
      {employee.classificationName}
      {#if employee.department}
        <span class="opacity-60">· {employee.department}</span>
      {/if}
    </div>
  </div>

  {#if showRate || pendingMove}
    <div class="emp-right-col">
      {#if showRate}
        {@const rate = employee.effectiveHourlyRate || 0}
        {#if rate > 0}
          <span class="emp-rate">${rate.toFixed(2)}/hr</span>
        {/if}
      {/if}
      {#if pendingMove}
        <span class="emp-move-tag">Moving {fmtMoveDate(pendingMove.effectiveDate)} to {pendingMove.jobNumber || 'Bench'}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .emp-right-col {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    flex-shrink: 0;
  }
  .emp-rate {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    font-weight: 500;
    color: oklch(var(--a));
  }
  .emp-move-tag {
    font-size: 9px;
    font-weight: 600;
    color: hsl(210, 70%, 45%);
    background: hsl(210, 70%, 95%);
    padding: 1px 6px;
    border-radius: 100px;
    white-space: nowrap;
    line-height: 1.4;
  }
</style>
