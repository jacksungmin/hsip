import path from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { csvConfigPlugin } from './vite-plugin-csv-config'
import { overlayConfigPlugin } from './vite-plugin-overlay-config'
import { appConfigPlugin } from './vite-plugin-app-config'

// The commit the running bundle was built from: GitHub Actions sets GITHUB_SHA
// for every workflow run, a local build has none and stamps 'dev'. `define`
// substitutes the text at build time, the only way a static bundle can know it.
const BUILD_SHA = process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
  },
  // appConfigPlugin writes src/data/generated/theme.css, so it has to run
  // before tailwindcss() processes the stylesheets that import it.
  plugins: [csvConfigPlugin(), overlayConfigPlugin(), appConfigPlugin(), svelte(), tailwindcss()],
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
    },
  },
  // sqlite-wasm ships its own .wasm asset; pre-bundling breaks the relative
  // URL it uses to load the binary.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
})
