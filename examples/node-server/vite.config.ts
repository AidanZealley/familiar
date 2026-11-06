import { defineConfig } from 'vite'

// The UI. In development Vite serves it and passes the API through to the
// server; `pnpm build` writes it where the server serves it from.
export default defineConfig({
  root: 'web',
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4320',
      '/auth': 'http://127.0.0.1:4320',
    },
  },
})
