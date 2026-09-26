<script lang="ts">
  import { onMount } from 'svelte';
  import type { IngestBatch, IngestBatchDetail } from '$lib/types';

  const API = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

  let dirPath = '';
  let recursive = true;
  let files: File[] = [];
  let progressMsg = '';
  let ingesting = false;
  let acting = false;
  let batches: IngestBatch[] = [];
  let selectedId: number | null = null;
  let detail: IngestBatchDetail | null = null;

  function formatBytes(n: number): string {
    if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n))} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = n / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
  }

  function baseName(filePath: string): string {
    const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return cut >= 0 ? filePath.slice(cut + 1) : filePath;
  }

  function finishedCount(batch: IngestBatch): number {
    return batch.done + batch.failed + batch.cancelled;
  }

  function finishedPct(batch: IngestBatch): number {
    if (!batch.total) return 0;
    return Math.round((finishedCount(batch) / batch.total) * 100);
  }

  function barWidth(part: number, total: number): string {
    if (!total) return '0%';
    return `${(part / total) * 100}%`;
  }

  function activeCount(batch: IngestBatch): number {
    return batch.pending + batch.hashing + batch.classifying;
  }

  async function loadBatches() {
    try {
      const resp = await fetch(`${API}/api/batches`);
      if (!resp.ok) return;
      const rows = (await resp.json()) as IngestBatch[];
      if (!Array.isArray(rows)) return;
      batches = rows;
      if (selectedId == null) {
        const preferred =
          batches.find(batch => batch.status === 'running') ??
          batches.find(batch => activeCount(batch) > 0) ??
          batches[0];
        selectedId = preferred?.id ?? null;
      } else if (!batches.some(batch => batch.id === selectedId)) {
        selectedId = batches[0]?.id ?? null;
      }
    } catch {
      // Keep the last good list when the backend is briefly down.
    }
  }

  async function loadDetail() {
    if (selectedId == null) {
      detail = null;
      return;
    }
    const id = selectedId;
    try {
      const resp = await fetch(`${API}/api/batches/${id}`);
      if (!resp.ok) return;
      const row = (await resp.json()) as IngestBatchDetail;
      if (selectedId === id) detail = row;
    } catch {
      // Keep the last detail while polling.
    }
  }

  async function refresh() {
    await loadBatches();
    await loadDetail();
  }

  onMount(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  });

  function handleFilePick(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    files = Array.from(input.files);
  }

  function attach(id: number) {
    selectedId = id;
    progressMsg = '';
    loadDetail();
  }

  async function startIngest() {
    if (!dirPath.trim()) {
      progressMsg = 'Folder path is required.';
      return;
    }
    ingesting = true;
    progressMsg = 'Sending ingest request…';
    try {
      const res = await fetch(`${API}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dir: dirPath.trim(),
          filenames: files.length ? files.map(file => file.name) : undefined,
          recursive
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        progressMsg = `Failed: ${data.error ?? res.statusText}`;
        return;
      }
      selectedId = data.batch?.id ?? selectedId;
      files = [];
      if (data.created) {
        const queued = Number(data.queued) || 0;
        progressMsg =
          queued > 0
            ? `Started a batch with ${queued} file(s).`
            : 'That folder has no image files, so the batch is empty.';
      } else {
        progressMsg = 'Opened the existing batch for this folder. Use Rescan to pick up new files.';
      }
      await refresh();
    } catch {
      progressMsg = 'Failed: could not reach the backend.';
    } finally {
      ingesting = false;
    }
  }

  async function postBatch(action: string, confirmText?: string) {
    if (selectedId == null || acting) return;
    if (confirmText && !confirm(confirmText)) return;
    acting = true;
    try {
      const res = await fetch(`${API}/api/batches/${selectedId}/${action}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        progressMsg = `Failed: ${data.error ?? res.statusText}`;
        return;
      }
      if (action === 'rescan') {
        const queued = Number(data.queued) || 0;
        progressMsg = queued > 0 ? `Rescan added ${queued} file(s).` : 'Rescan found no new files.';
      } else if (action === 'retry') {
        const retried = Number(data.retried) || 0;
        progressMsg = retried > 0 ? `Retrying ${retried} failed file(s).` : 'No failed files to retry.';
      } else if (action === 'cancel-pending') {
        const cancelled = Number(data.cancelled) || 0;
        progressMsg = `Cancelled ${cancelled} pending file(s).`;
      } else if (action === 'pause') {
        progressMsg = 'Batch paused. The file already in the model will finish.';
      } else if (action === 'resume') {
        progressMsg = 'Batch resumed. Any other running batch is paused.';
      }
      await refresh();
    } catch {
      progressMsg = 'Failed: could not reach the backend.';
    } finally {
      acting = false;
    }
  }
</script>

<div class="my-6 space-y-8">
  <section class="space-y-3">
    <h1 class="text-xl font-semibold">Ingest batches</h1>
    <p class="text-sm text-gray-600">
      Each folder is one batch. Attach watches that batch. Only one batch runs at a time, and a restart continues it.
    </p>

    {#if batches.length === 0}
      <p class="text-sm text-gray-600">No batches yet. Add a folder below.</p>
    {:else}
      <div class="grid gap-3">
        {#each batches as batch}
          <article
            class="rounded border bg-white p-3 shadow-sm {selectedId === batch.id ? 'ring-2 ring-blue-600' : ''}"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="rounded px-2 py-0.5 text-xs font-medium {batch.status === 'running'
                      ? 'bg-green-200'
                      : batch.status === 'paused'
                        ? 'bg-yellow-200'
                        : 'bg-gray-200'}"
                  >
                    {batch.status}
                  </span>
                  {#if selectedId === batch.id}
                    <span class="text-xs text-blue-700">Attached</span>
                  {/if}
                </div>
                <p class="mt-1 break-all text-sm font-medium">{batch.folder}</p>
                <p class="mt-1 text-sm text-gray-600">
                  {finishedCount(batch)} / {batch.total} files · {formatBytes(batch.bytes)}
                  · pending {batch.pending}
                  · working {batch.hashing + batch.classifying}
                  · done {batch.done}
                  · failed {batch.failed}
                </p>
              </div>
              {#if selectedId !== batch.id}
                <button class="rounded bg-blue-600 px-3 py-1 text-sm text-white" on:click={() => attach(batch.id)}>
                  Attach
                </button>
              {/if}
            </div>
            <div class="mt-3">
              <div class="mb-1 flex justify-between text-xs text-gray-600">
                <span>Progress</span>
                <span>{finishedPct(batch)}%</span>
              </div>
              <div class="flex h-3 w-full overflow-hidden rounded bg-gray-200" title="Done, failed, cancelled, then in progress. Gray is pending.">
                <div class="h-3 bg-green-600" style={`width: ${barWidth(batch.done, batch.total)}`}></div>
                <div class="h-3 bg-red-500" style={`width: ${barWidth(batch.failed, batch.total)}`}></div>
                <div class="h-3 bg-gray-500" style={`width: ${barWidth(batch.cancelled, batch.total)}`}></div>
                <div class="h-3 bg-purple-600" style={`width: ${barWidth(batch.hashing + batch.classifying, batch.total)}`}></div>
              </div>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  {#if detail && detail.id === selectedId}
    <section class="space-y-4 rounded border bg-white p-4 shadow-sm">
      <div>
        <h2 class="font-semibold">Attached batch</h2>
        <p class="break-all text-sm text-gray-700">{detail.folder}</p>
      </div>

      <div class="flex flex-wrap gap-2 text-sm">
        <span class="rounded bg-gray-200 px-2 py-0.5">Total: {detail.total}</span>
        <span class="rounded bg-gray-200 px-2 py-0.5">Bytes: {formatBytes(detail.bytes)}</span>
        <span class="rounded bg-gray-300 px-2 py-0.5">Pending: {detail.pending}</span>
        <span class="rounded bg-blue-200 px-2 py-0.5">Hashing: {detail.hashing}</span>
        <span class="rounded bg-purple-200 px-2 py-0.5">Classifying: {detail.classifying}</span>
        <span class="rounded bg-green-200 px-2 py-0.5">Done: {detail.done}</span>
        <span class="rounded bg-red-200 px-2 py-0.5">Failed: {detail.failed}</span>
        {#if detail.cancelled}
          <span class="rounded bg-gray-400 px-2 py-0.5">Cancelled: {detail.cancelled}</span>
        {/if}
      </div>

      <div class="flex flex-wrap gap-2">
        {#if detail.status === 'running'}
          <button
            class="rounded bg-yellow-500 px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={acting}
            on:click={() => postBatch('pause')}
          >
            Pause
          </button>
        {:else if detail.status === 'paused'}
          <button
            class="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={acting || activeCount(detail) === 0}
            on:click={() => postBatch('resume')}
          >
            Resume
          </button>
        {/if}
        <button
          class="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={acting || detail.failed === 0}
          on:click={() => postBatch('retry')}
        >
          Retry failed
        </button>
        <button class="rounded border px-3 py-1 text-sm disabled:opacity-50" disabled={acting} on:click={() => postBatch('rescan')}>
          Rescan
        </button>
        <button
          class="rounded bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={acting || detail.pending === 0}
          on:click={() =>
            postBatch(
              'cancel-pending',
              `Cancel ${detail?.pending ?? 0} pending files? The file already being classified will finish.`
            )}
        >
          Cancel pending
        </button>
      </div>

      {#if detail.current.length}
        <div>
          <h3 class="mb-2 font-semibold">Currently working</h3>
          <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
            {#each detail.current as item}
              <div class="rounded bg-gray-50 p-2 shadow">
                <img
                  alt={baseName(item.path)}
                  class="h-40 w-full object-contain"
                  src={`${API}/api/file?path=${encodeURIComponent(item.path)}`}
                />
                <div class="mt-1 text-xs text-gray-500">{item.status}</div>
                <div class="text-xs break-all text-gray-700">{baseName(item.path)}</div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if detail.failures.length}
        <div>
          <h3 class="mb-1 font-semibold">Recent failures</h3>
          <ul class="space-y-1 text-sm">
            {#each detail.failures as item}
              <li class="break-all">
                <span class="font-medium">{baseName(item.path)}</span>
                {#if item.error}
                  <span class="text-red-700"> — {item.error}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </section>
  {/if}

  <section class="space-y-4">
    <h2 class="font-semibold">Add a folder</h2>
    <label class="block">
      <span class="font-semibold">Folder path</span>
      <input type="text" bind:value={dirPath} placeholder="/abs/path/to/folder" class="mt-1 w-full rounded border px-2 py-1" />
    </label>

    <label class="inline-flex items-center gap-2">
      <input type="checkbox" bind:checked={recursive} />
      Recursive
    </label>

    <label class="block">
      <span class="font-semibold">Specific files (optional)</span>
      <input type="file" multiple on:change={handleFilePick} class="mt-1 block" />
      <span class="mt-1 block text-sm text-gray-600">
        Names only, and only for a folder that does not already have a batch. Each file must already be in the folder path above.
      </span>
    </label>

    <p>{files.length} file(s) selected</p>
    <button class="rounded bg-blue-600 px-4 py-1 text-white disabled:opacity-50" disabled={ingesting} on:click={startIngest}>
      {ingesting ? 'Ingesting…' : 'Ingest folder'}
    </button>
    <p class="text-sm text-gray-600">
      If this folder already has a batch, Ingest opens it. Rescan adds new files. Retry failed runs those again.
    </p>

    {#if progressMsg}
      <p class="text-sm italic">{progressMsg}</p>
    {/if}
  </section>
</div>
