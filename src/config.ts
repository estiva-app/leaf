/** What the app is called on screen. */
export const APP_TITLE = "Leaf"

/**
 * Estiva ID, or `null` when this build offers no sign-in at all. Empty is a real
 * mode, not a broken one: the app runs anonymous, and a local build can never
 * reach the real Estiva ID by accident. See .env.example.
 */
export const ID_CONFIG: { base: string; clientId: string } | null =
  import.meta.env.VITE_ESTIVA_ID_ORIGIN && import.meta.env.VITE_ESTIVA_ID_CLIENT_ID
    ? { base: import.meta.env.VITE_ESTIVA_ID_ORIGIN.replace(/\/+$/, ''), clientId: import.meta.env.VITE_ESTIVA_ID_CLIENT_ID }
    : null

/**
 * The relay, the workspace this app reads and writes, or `null` when this build
 * has none. Empty is a real mode too: the app runs alone and opens no connection,
 * and a local build can never reach the real relay by accident. See .env.example.
 */
export const RELAY_URL: string | null = import.meta.env.VITE_RELAY_URL?.trim().replace(/\/+$/, '') || null

/** The relay as a person would name it: host and port, no scheme. */
export function relayLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
