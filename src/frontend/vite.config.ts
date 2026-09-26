import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type PluginOption } from 'vite';

export default defineConfig({
  plugins: [sveltekit() as PluginOption],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
