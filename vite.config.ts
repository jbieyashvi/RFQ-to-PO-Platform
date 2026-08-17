import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Base path is environment-aware so the same source deploys to two hosts:
//   - GitHub Pages (project page): served from /RFQ-to-PO-Platform/ (the default).
//   - Vercel: served from the domain root "/". Vercel sets VERCEL=1 during its
//     build, which we detect here.
//   - Local dev/build: no VERCEL var, so it keeps the GitHub Pages base and
//     behaves exactly as before.
// An explicit VITE_BASE always wins if set (escape hatch for other hosts).
const base =
  process.env.VITE_BASE ?? (process.env.VERCEL ? '/' : '/RFQ-to-PO-Platform/')

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173, host: true },
})
