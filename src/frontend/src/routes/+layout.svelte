<script lang="ts">
  import "../app.css";

	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="w-full flex justify-center bg-gray-800">
  <nav class="text-white px-4 py-2 flex gap-4 max-w-6xl w-full justify-center">
  <a class="hover:underline" href="/">Home</a>
  <a class="hover:underline" href="/ingest">Ingest</a>
  <a class="hover:underline" href="/gallery">Gallery</a>
  <a class="hover:underline" href="/search">Search</a>
  <a class="hover:underline" href="/ai-settings">AI Settings</a>
  </nav>
</div>

<div class="w-full flex justify-center mt-4 px-4">
  <div class="w-full max-w-6xl">
    {@render children?.()}
  </div>
</div>
