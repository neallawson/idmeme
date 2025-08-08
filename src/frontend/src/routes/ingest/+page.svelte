<script lang="ts">
  import { onMount } from 'svelte';

  const API = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

  let dirPath = '';
  let recursive = true;
  let files: File[] = [];
  let progressMsg = '';
  let ingesting = false;
  // Track baseline for current batch: only show progress for ids > baselineAfterId
  let baselineAfterId: number | null = null;

  // Ingest summary state
  let summary: { total: number; pending: number; hashing: number; classifying: number; done: number; failed: number } = {
    total: 0,
    pending: 0,
    hashing: 0,
    classifying: 0,
    done: 0,
    failed: 0
  };

  // Currently classifying items (for previews)
  let current: { id: number; path: string; status: string; started_at: string }[] = [];

  // Derived stacked bar percentages
  $: pendingPct = summary.total ? Math.round((summary.pending / summary.total) * 100) : 0;
  $: hashingPct = summary.total ? Math.round((summary.hashing / summary.total) * 100) : 0;
  $: classifyingPct = summary.total ? Math.round((summary.classifying / summary.total) * 100) : 0;
  $: donePct = summary.total ? Math.round(((summary.done + summary.failed) / summary.total) * 100) : 0;

  async function loadSummary() {
    try {
      const qs = baselineAfterId != null ? `?afterId=${baselineAfterId}` : '';
      const resp = await fetch(`${API}/api/ingest/summary${qs}`);
      if (resp.ok) summary = await resp.json();
    } catch {}
  }

  async function loadCurrent() {
    try {
      const qs = baselineAfterId != null ? `?afterId=${baselineAfterId}` : '';
      const resp = await fetch(`${API}/api/ingest/current${qs}`);
      if (resp.ok) current = await resp.json();
    } catch {}
  }

  onMount(() => {
    loadSummary();
    loadCurrent();
    const h = setInterval(() => { loadSummary(); loadCurrent(); }, 3000);
    return () => clearInterval(h);
  });

  function handleFilePick(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    files = Array.from(input.files);
  }

  async function startIngest() {
    if (!dirPath) {
      progressMsg = 'Folder path is required.';
      return;
    }
    ingesting = true;
    progressMsg = 'Sending ingest request…';
    const backend = API;
    // Capture baseline max id so we can track only new rows (id > baseline)
    let priorMaxId = 0;
    try {
      const r = await fetch(`${backend}/api/ingest/max-id`);
      if (r.ok) {
        const data = await r.json();
        priorMaxId = Number(data.maxId) || 0;
      }
    } catch {}
    const payload = {
      dir: dirPath,
      filenames: files.length ? files.map(f => f.name) : undefined,
      recursive
    };
    const res = await fetch(`${backend}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      progressMsg = `Queued ${data.queued} file(s) successfully.`;
      files = [];
      // Reset to track only this batch and clear UI
      baselineAfterId = priorMaxId;
      summary = { total: 0, pending: 0, hashing: 0, classifying: 0, done: 0, failed: 0 };
      current = [];
      // Kick polling once after setting baseline
      loadSummary();
      loadCurrent();
    } else {
      const err = await res.json().catch(() => ({}));
      progressMsg = `Failed: ${err.error ?? res.statusText}`;
    }
    ingesting = false;
  }
</script>

<div class="my-6 space-y-6">
  <!-- Folder path input -->
  <label class="block">
    <span class="font-semibold">Folder path</span>
    <input type="text" bind:value={dirPath} placeholder="/abs/path/to/folder" class="mt-1 w-full border rounded px-2 py-1" />
  </label>

  <!-- Recursive checkbox -->
  <label class="inline-flex items-center gap-2">
    <input type="checkbox" bind:checked={recursive} />
    Recursive
  </label>

  <!-- File picker -->
  <label class="block">
    <span class="font-semibold">Specific files (optional)</span>
    <input type="file" multiple on:change={handleFilePick} class="mt-1 block" />
  </label>
  
  <p>{files.length} file(s) selected</p>
  <button class="bg-blue-600 text-white px-4 py-1 rounded" disabled={ingesting} on:click={startIngest}>
    {ingesting ? 'Ingesting…' : 'Start Ingest'}
  </button>

  {#if progressMsg}
    <p class="mt-2 text-sm italic">{progressMsg}</p>
  {/if}

  <!-- Progress overview -->
  <div class="mt-8 space-y-4">
    <div class="flex flex-wrap items-center gap-4 text-sm">
      <span class="px-2 py-0.5 rounded bg-gray-200">Total: {summary.total}</span>
      <span class="px-2 py-0.5 rounded bg-gray-300">Pending: {summary.pending}</span>
      <span class="px-2 py-0.5 rounded bg-blue-200">Hashing: {summary.hashing}</span>
      <span class="px-2 py-0.5 rounded bg-purple-200">Classifying: {summary.classifying}</span>
      <span class="px-2 py-0.5 rounded bg-green-200">Done: {summary.done}</span>
      <span class="px-2 py-0.5 rounded bg-red-200">Failed: {summary.failed}</span>
    </div>

    <!-- Stacked progress bar: pending | hashing | classifying | done/failed -->
    <div>
      <div class="flex justify-between text-sm mb-1">
        <span>Queue progress</span>
        <span>{donePct}% complete</span>
      </div>
      <div class="w-full h-4 bg-gray-200 rounded overflow-hidden flex">
        <div class="h-4 bg-green-600" style={`width: ${donePct}%`} title="Done/Failed"></div>
        <div class="h-4 bg-purple-600" style={`width: ${classifyingPct}%`} title="Classifying"></div>
        <div class="h-4 bg-blue-600" style={`width: ${hashingPct}%`} title="Hashing"></div>
        <div class="h-4 bg-gray-400" style={`width: ${pendingPct}%`} title="Pending"></div>
      </div>
    </div>
  </div>

  <!-- Currently processing previews -->
  {#if current.length}
    <div class="mt-6">
      <div class="font-semibold mb-2">Currently classifying</div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        {#each current as item}
          <div class="p-2 bg-white rounded shadow">
            <img alt="preview" class="w-full h-40 object-contain" src={`${API}/api/file?path=${encodeURIComponent(item.path)}`} />
            <div class="mt-1 text-xs break-all text-gray-700">{item.path}</div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

