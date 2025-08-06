<script lang="ts">
  let dirPath = '';
  let recursive = true;
  let files: File[] = [];
  let progressMsg = '';
  let ingesting = false;

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
    const backend = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';
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
</div>

