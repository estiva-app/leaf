import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// `react` is deduped because @estiva-app/ui declares it a peer: two copies in one
// tree is the "invalid hook call" crash, and it appears at runtime.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
  },
})
