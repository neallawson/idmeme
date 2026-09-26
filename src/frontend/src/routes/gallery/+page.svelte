<script lang="ts">
  import { onMount } from 'svelte';
  import ImageCard from '$lib/ImageCard.svelte';

  const API = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

  let images: Array<{ id: number; path: string; tags_json?: string }> = [];
  let loading = true;
  let error = '';

  onMount(async () => {
    try {
      const resp = await fetch(`${API}/api/search?limit=200`);
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !Array.isArray(json)) {
        error = (json && typeof json.error === 'string' && json.error) || 'Could not load the gallery';
        return;
      }
      images = json;
    } catch {
      error = 'Could not load the gallery';
    } finally {
      loading = false;
    }
  });
</script>

<h1 class="text-xl font-bold mb-4">Gallery</h1>

{#if loading}
  <p>Loading…</p>
{:else if error}
  <p class="text-sm text-red-700">{error}</p>
{:else if images.length === 0}
  <p>No images yet. Ingest a folder to fill the catalog.</p>
{:else}
  <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(200px,1fr));">
    {#each images as image (image.id)}
      <ImageCard api={API} path={image.path} tagsJson={image.tags_json} />
    {/each}
  </div>
{/if}
