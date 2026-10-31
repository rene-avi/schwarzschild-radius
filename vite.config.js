import { defineConfig } from 'vite';
import { standaloneHtml } from './build/standalone.js';

export default defineConfig({
  base: './',
  plugins: [standaloneHtml()],
  build: {
    modulePreload: false,
    cssCodeSplit: false,
    // The intentionally self-contained file includes Three.js and all effects.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true },
    },
  },
});
