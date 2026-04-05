<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";
  import { api } from "../lib/api";

  export let value: string = "";
  export let latitude: number | null = null;
  export let longitude: number | null = null;
  export let placeholder: string = "Start typing an address...";

  const dispatch = createEventDispatcher();

  let suggestions: any[] = [];
  let showDropdown = false;
  let loading = false;
  let debounceTimer: ReturnType<typeof setTimeout>;
  let selectedIndex = -1;
  let geocoded = !!(latitude && longitude);
  let errorMsg = "";

  onDestroy(() => clearTimeout(debounceTimer));

  async function handleInput() {
    const q = value.trim();
    geocoded = false;
    errorMsg = "";
    selectedIndex = -1;

    if (q.length < 3) {
      suggestions = [];
      showDropdown = false;
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      loading = true;
      try {
        const res = await api.get(`/maps/autocomplete?input=${encodeURIComponent(q)}`);
        if (res?.error) {
          errorMsg = res.error;
          suggestions = [];
        } else if (res?.googleStatus) {
          errorMsg = `Google API: ${res.googleStatus} — ${res.googleError || "check API key & enabled APIs"}`;
          suggestions = [];
        } else {
          suggestions = res?.predictions || [];
        }
        showDropdown = suggestions.length > 0;
      } catch (err: any) {
        errorMsg = err.message || "Autocomplete failed";
        suggestions = [];
        showDropdown = false;
      } finally {
        loading = false;
      }
    }, 250);
  }

  async function selectSuggestion(suggestion: any) {
    loading = true;
    showDropdown = false;
    suggestions = [];
    errorMsg = "";

    try {
      const details = await api.get(`/maps/place-details?placeId=${suggestion.placeId}`);
      if (details) {
        value = details.address;
        latitude = details.latitude;
        longitude = details.longitude;
        geocoded = true;
        dispatch("select", {
          address: details.address,
          latitude: details.latitude,
          longitude: details.longitude,
          components: details.components,
        });
      }
    } catch (err: any) {
      errorMsg = err.message || "Failed to get place details";
    } finally {
      loading = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[selectedIndex]);
    } else if (e.key === "Escape") {
      showDropdown = false;
    }
  }

  function handleBlur() {
    setTimeout(() => { showDropdown = false; }, 200);
  }

  function handleFocus() {
    if (suggestions.length > 0) showDropdown = true;
  }
</script>

<div class="ap-wrap">
  <div class="ap-field">
    <input
      bind:value
      on:input={handleInput}
      on:keydown={handleKeydown}
      on:blur={handleBlur}
      on:focus={handleFocus}
      {placeholder}
      class="input input-sm input-bordered w-full"
      autocomplete="off"
    />
    {#if loading}
      <span class="ap-icon loading loading-spinner loading-xs"></span>
    {:else if geocoded}
      <span class="ap-icon text-success">📍</span>
    {/if}
  </div>

  {#if errorMsg}
    <p class="text-xs text-error mt-1">{errorMsg}</p>
  {/if}

  {#if geocoded && latitude && longitude}
    <p class="text-xs opacity-40 mt-0.5">{latitude.toFixed(5)}, {longitude.toFixed(5)}</p>
  {/if}

  {#if showDropdown}
    <ul class="ap-list">
      {#each suggestions as s, i}
        <li>
          <button
            class="ap-item"
            class:ap-active={i === selectedIndex}
            on:mousedown|preventDefault={() => selectSuggestion(s)}
          >
            <span class="ap-main">{s.mainText}</span>
            <span class="ap-sec">{s.secondaryText}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ap-wrap { position: relative; }
  .ap-field { position: relative; }
  .ap-icon { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 14px; }

  .ap-list {
    position: absolute; top: 100%; left: 0; right: 0;
    margin-top: 4px; padding: 0; list-style: none;
    background: white; border: 1px solid #e5e5ea; border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    z-index: 50;
    max-height: 240px; overflow-y: auto;
  }
  .ap-item {
    display: flex; flex-direction: column; gap: 1px;
    width: 100%; padding: 8px 12px;
    background: none; border: none; border-bottom: 1px solid #f2f2f7;
    cursor: pointer; text-align: left; font-family: inherit;
  }
  .ap-item:last-child { border-bottom: none; }
  .ap-item:hover, .ap-active { background: #f2f2f7; }
  .ap-main { font-size: 0.8125rem; font-weight: 500; color: #1d1d1f; }
  .ap-sec { font-size: 0.75rem; color: #86868b; }
</style>
