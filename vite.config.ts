import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * The commit a bundle is built from, for its error reports (PROD-4): CI's
 * `GITHUB_SHA`, or this checkout's HEAD. Sentry names an error new or back by it.
 */
function release(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const RELEASE = release()

/**
 * `/version.json` names the commit this bundle is built from, so a check after
 * a deploy (`/land`, the smoke test) knows it is looking at the new build and
 * not the old one. deploy/nginx.conf serves it uncached.
 */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ app: 'leaf', commit: RELEASE })}\n`,
      })
    },
  }
}

// `react` is deduped because @estiva-app/ui declares it a peer: two copies in one
// tree is the "invalid hook call" crash, and it appears at runtime.
export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    'import.meta.env.VITE_LEAF_RELEASE': JSON.stringify(RELEASE),
  },
  // Served beside the bundle so Sentry turns a report's frames into readable
  // code (PROD-4). The repo is public, so they show nothing new.
  build: {
    sourcemap: true,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
  },
})
