<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';

  const API = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

  const query = writable('');
  const facets = writable<Record<string,string>>({});
  const results = writable<Array<{ id:number; path:string; tags_json:string }>>([]);
  const loading = writable(false);

  function updateFacet(key:string, value:string) {
    facets.update(f => ({ ...f, [key]: value }));
  }

  async function search() {
    loading.set(true);
    const f = $facets;
    const params = new URLSearchParams();
    if ($query) params.append('q', $query);
    Object.entries(f).forEach(([k,v]) => v && params.append(k,v));
    const url = `${API}/api/search?${params.toString()}`;
    try {
      const resp = await fetch(url);
      const json = await resp.json();
      results.set(json);
    } catch (err) {
      console.error('search failed', err);
    } finally {
      loading.set(false);
    }
  }

  onMount(() => {
    search();
  });
</script>

<div class="p-4 space-y-4">
  <div class="flex gap-2 items-end flex-wrap">
    <div class="flex flex-col">
      <label class="text-sm font-medium">Keywords</label>
      <input class="input input-bordered" bind:value={$query} placeholder="crying jordan" />
    </div>

    <div class="flex flex-col">
      <label class="text-sm font-medium">Category</label>
      <input class="input input-bordered" placeholder="humor" on:change={(e)=>updateFacet('category', e.target.value)} />
    </div>

    <div class="flex flex-col">
      <label class="text-sm font-medium">Style</label>
      <input class="input input-bordered" placeholder="comic" on:change={(e)=>updateFacet('style', e.target.value)} />
    </div>

    <button class="btn btn-primary" on:click={search} disabled={$loading}>Search</button>
  </div>

  {#if $loading}
    <p>Loading…</p>
  {/if}

  <div class="grid gap-4 mt-4" style="grid-template-columns: repeat(auto-fill, minmax(200px,1fr));">
    {#each $results as r}
      <div class="border rounded shadow p-2 flex flex-col gap-2">
        <img src={`${API}/api/file?path=${encodeURIComponent(r.path)}`} alt={r.path} class="object-contain h-40 w-full" />
        <pre class="text-xs whitespace-pre-wrap">{r.tags_json}</pre>
      </div>
    {/each}
  </div>
</div>

<style>
  .input { @apply border rounded px-2 py-1; }
  .btn { @apply px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50; }
</style>
