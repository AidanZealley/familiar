import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Top-level await starts the demo before the first render. Familiar's core
  // runs in the page, so the bundle is large; the docs load it in a lazy iframe.
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { host: true, allowedHosts: ['.ts.net'] },
  preview: { host: true, allowedHosts: ['.ts.net'] },
})
