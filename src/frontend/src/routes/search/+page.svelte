<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import ImageCard from '$lib/ImageCard.svelte';

  const API = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

  const query = writable('');
  const results = writable<Array<{ id:number; path:string; tags_json:string }>>([]);
  const loading = writable(true);
  let searchError = '';

  // Filtered Search state
  let kvKeys: string[] = [];
  let selectedKey = '';
  let refineText = '';

  async function loadKvKeys() {
    try {
      const resp = await fetch(`${API}/api/kv/keys`);
      if (resp.ok) kvKeys = await resp.json();
    } catch {}
  }

  async function search() {
    loading.set(true);
    searchError = '';
    const params = new URLSearchParams();
    const text = $query.trim();
    if (text) params.append('q', text);
    if (selectedKey && refineText.trim()) params.append(selectedKey, refineText.trim());
    const url = `${API}/api/search?${params.toString()}`;
    try {
      const resp = await fetch(url);
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !Array.isArray(json)) {
        results.set([]);
        searchError = (json && typeof json.error === 'string' && json.error) || 'Search failed';
        return;
      }
      results.set(json);
    } catch (err) {
      console.error('search failed', err);
      results.set([]);
      searchError = 'Search failed';
    } finally {
      loading.set(false);
    }
  }

  onMount(() => {
    loadKvKeys();
    search();
  });
</script>

<div class="p-4 space-y-4">
  <div class="flex gap-2 items-end flex-wrap">
    <div class="flex flex-col">
      <label class="text-sm font-medium" for="full-text">Full Text</label>
      <input id="full-text" class="border rounded px-2 py-1" bind:value={$query} placeholder="funny cat meme" />
    </div>

    <!-- Filtered Search -->
    <div class="flex flex-col border rounded p-3">
      <div class="text-sm font-semibold mb-2">Filtered Search</div>
      <div class="flex gap-2 items-end flex-wrap">
        <div class="flex flex-col">
          <label class="text-sm font-medium" for="field-key">Category</label>
          <select id="field-key" class="border rounded px-2 py-1" bind:value={selectedKey}>
            <option value="">-- select a key --</option>
            {#each kvKeys as k}
              <option value={k}>{k}</option>
            {/each}
          </select>
        </div>
        <div class="flex flex-col">
          <label class="text-sm font-medium" for="field-phrase">Search for:</label>
          <input id="field-phrase" class="border rounded px-2 py-1" bind:value={refineText} placeholder="crying jordan" />
          <span class="text-xs text-gray-600">Whole phrase. Commas mean every term must match.</span>
        </div>
      </div>
    </div>

    <button class="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" on:click={search} disabled={$loading}>Search</button>
  </div>

  {#if $loading}
    <p>Loading…</p>
  {/if}
  {#if searchError}
    <p class="text-sm text-red-700">{searchError}</p>
  {/if}

  {#if !$loading && !searchError && $results.length === 0}
    <p>No images matched.</p>
  {/if}

  <div class="grid gap-4 mt-4" style="grid-template-columns: repeat(auto-fill, minmax(220px,1fr));">
    {#each $results as r (r.id)}
      <ImageCard api={API} path={r.path} tagsJson={r.tags_json} />
    {/each}
  </div>
</div>
