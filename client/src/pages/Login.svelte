<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { auth } from "../lib/api";
  import { appSettings } from "../lib/stores";
  import BirdDogLogo from "../components/BirdDogLogo.svelte";

  const dispatch = createEventDispatcher();

  let username = "";
  let password = "";
  let error = "";
  let loading = false;

  async function handleSubmit() {
    error = "";
    loading = true;
    try {
      const user = await auth.login(username, password);
      dispatch("login", user);
    } catch (e: any) {
      error = e.message || "Login failed";
    }
    loading = false;
  }
</script>

<div class="min-h-screen flex items-center justify-center p-4" style="background: linear-gradient(180deg, #ffffff 0%, #f5f5f7 100%);">
  <div class="w-full max-w-sm apple-panel p-8">
    <div class="text-center mb-6">
      <div class="mx-auto mb-3"><BirdDogLogo size={56} /></div>
      <h1 class="text-2xl font-bold tracking-tight text-base-content">BirdDog</h1>
      {#if $appSettings.companyName}
        <p class="text-sm text-base-content/50 mt-0.5">{$appSettings.companyName}</p>
      {/if}
    </div>

      <form on:submit|preventDefault={handleSubmit}>
        {#if error}
          <div class="alert alert-error text-sm mb-4">
            <span>{error}</span>
          </div>
        {/if}

        <div class="form-control mb-3">
          <label class="label" for="username">
            <span class="label-text">Username</span>
          </label>
          <input
            id="username"
            type="text"
            class="input input-bordered"
            bind:value={username}
            autocomplete="username"
            required
          />
        </div>

        <div class="form-control mb-4">
          <label class="label" for="password">
            <span class="label-text">Password</span>
          </label>
          <input
            id="password"
            type="password"
            class="input input-bordered"
            bind:value={password}
            autocomplete="current-password"
            required
          />
        </div>

        <button
          type="submit"
          class="btn btn-primary w-full"
          disabled={loading}
        >
          {#if loading}
            <span class="loading loading-spinner loading-sm"></span>
          {/if}
          Sign In
        </button>
      </form>
  </div>
</div>
