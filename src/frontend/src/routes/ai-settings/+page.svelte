<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';

  const API = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

    const prompt = writable('');
  const isDefault = writable(true);
  const maxConcurrency = writable(1);
  const saving = writable(false);
  const status = writable('');

    async function load() {
    const resp = await fetch(`${API}/api/prompt`);
    const json = await resp.json();
    prompt.set(json.prompt);
    isDefault.set(json.isDefault);

    const sett = await fetch(`${API}/api/settings`).then(r => r.json());
    maxConcurrency.set(sett.maxConcurrency ?? 1);
  }

    async function save() {
    saving.set(true);
    // save prompt
    await fetch(`${API}/api/prompt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: $prompt })
    });
    // save settings
    await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrency: Number($maxConcurrency) })
    });

    status.set('Saved');
    isDefault.set(false);
    saving.set(false);
  }

  async function restore() {
    saving.set(true);
    await fetch(`${API}/api/prompt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' })
    });
    status.set('Restored to default');
    await load();
    saving.set(false);
  }

  onMount(load);
</script>

<h1 class="text-xl font-bold mb-4">AI Settings</h1>

<div class="flex flex-col gap-4 max-w-3xl">
  <label class="flex flex-col gap-2">
    <span class="font-medium">Prompt</span>
    <textarea class="textarea textarea-bordered h-60" bind:value={$prompt}></textarea>
  </label>

  <label class="flex flex-col gap-2 w-48">
    <span class="font-medium">Max Concurrency</span>
    <input type="number" min="1" class="input input-bordered" bind:value={$maxConcurrency} />
  </label>

  <div class="flex gap-4 items-center">
    <button class="btn btn-primary" on:click={save} disabled={$saving}>Save</button>
    <button class="btn" on:click={restore} disabled={$saving || $isDefault}>Restore Default</button>
    {#if $status}
      <span class="text-green-600">{$status}</span>
    {/if}
  </div>
</div>

<style>
  .textarea { @apply w-full border rounded px-2 py-1; }
  .btn { @apply px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50; }
</style>
