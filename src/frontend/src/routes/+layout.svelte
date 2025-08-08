<script lang="ts">
  import "../app.css";

	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<nav class="bg-gray-800 text-white px-4 py-2 flex gap-4">
  <a class="hover:underline" href="/">Home</a>
  <a class="hover:underline" href="/ingest">Ingest</a>
  <a class="hover:underline" href="/gallery">Gallery</a>
  <a class="hover:underline" href="/search">Search</a>
  <a class="hover:underline" href="/ai-settings">AI Settings</a>
</nav>


{@render children?.()}
