import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Reachable over the LAN and tailnet for reviewing on other devices.
    host: true,
    allowedHosts: ['.ts.net'],
    port: 5174,
    strictPort: true,
    // The daemon owns the API; same origin in dev as in production. Plain
    // `vite` reaches the demo daemon, never the installed assistant, which
    // only `dev:live` targets on purpose. The proxy keeps the browser's Host
    // so the daemon's same-origin check matches it against Origin; the
    // shorthand would rewrite it, refusing every change from another device
    // over HTTP.
    proxy: {
      '/api': {
        target: process.env.FAMILIAR_API ?? 'http://127.0.0.1:4318',
        changeOrigin: false,
      },
    },
  },
})
