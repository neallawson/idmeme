<script lang="ts">
  type Tags = {
    category?: string;
    keywords?: string[];
    style?: string;
    intent?: string;
    characters?: string[];
    text?: string[];
  };

  let { api, path, tagsJson }: { api: string; path: string; tagsJson?: string } = $props();

  function asList(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return [];
  }

  function parseTags(raw?: string): Tags | null {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Tags;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      return value;
    } catch {
      return null;
    }
  }

  let tags = $derived(parseTags(tagsJson));
  let name = $derived(path.split(/[/\\]/).pop() || path);
  let keywords = $derived(asList(tags?.keywords));
  let characters = $derived(asList(tags?.characters));
  let quotes = $derived(asList(tags?.text));
</script>

<div class="border rounded shadow p-2 flex flex-col gap-2 bg-white">
  <img src={`${api}/api/file?path=${encodeURIComponent(path)}`} alt={name} class="object-contain h-40 w-full" />
  <div class="text-xs break-all text-gray-700">{name}</div>
  {#if tags}
    {#if tags.category || tags.style}
      <div class="text-sm">
        {#if tags.category}<span class="font-medium">{tags.category}</span>{/if}
        {#if tags.category && tags.style}<span class="text-gray-500"> · </span>{/if}
        {#if tags.style}<span>{tags.style}</span>{/if}
      </div>
    {/if}
    {#if tags.intent}
      <p class="text-sm">{tags.intent}</p>
    {/if}
    {#if characters.length}
      <p class="text-xs text-gray-700">Characters: {characters.join(', ')}</p>
    {/if}
    {#if keywords.length}
      <p class="text-xs text-gray-700">Keywords: {keywords.join(', ')}</p>
    {/if}
    {#if quotes.length}
      <ul class="text-xs text-gray-800 list-disc pl-4">
        {#each quotes as quote}
          <li>{quote}</li>
        {/each}
      </ul>
    {/if}
  {:else if tagsJson}
    <pre class="text-xs whitespace-pre-wrap">{tagsJson}</pre>
  {/if}
</div>
