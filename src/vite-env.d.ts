/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ESTIVA_ID_ORIGIN?: string
  readonly VITE_ESTIVA_ID_CLIENT_ID?: string
  readonly VITE_RELAY_URL?: string
  /** The commit this bundle was built from, set by vite.config.ts for error reports (PROD-4). */
  readonly VITE_LEAF_RELEASE?: string
}
