import { createEstivaId, type ShellReason, type StoredToken } from '@estiva-app/identity'
import { ID_CONFIG } from '../config'

/**
 * Signing in with Estiva ID, the way Ship does: `@estiva-app/identity` holds the
 * flow, this file the app's choices.
 *
 * - The redirect is the origin and a slash, never the current path: Estiva ID
 *   compares it exactly against the one address registered for the app.
 * - The session lives in localStorage, so it outlives a tab; a sign-in's
 *   single-use credentials in sessionStorage, per tab.
 */
const client = ID_CONFIG
  ? createEstivaId({
      base: ID_CONFIG.base,
      clientId: ID_CONFIG.clientId,
      redirectUri: () => `${window.location.origin}/`,
      storage: () => (typeof localStorage === 'undefined' ? null : localStorage),
      pendingStore: () => (typeof sessionStorage === 'undefined' ? null : sessionStorage),
      keyPrefix: 'leaf.estiva-id',
      navigate: (url) => window.location.assign(url),
    })
  : null

export const signInAvailable = client !== null

export function currentToken(): StoredToken | null {
  return client?.validToken(Date.now() + 60_000) ?? null
}

export function startRenewal(): void {
  client?.scheduleRenewal()
}

export async function beginSignIn(options: { silent?: boolean } = {}): Promise<void> {
  await client?.beginSignIn(`${window.location.pathname}${window.location.search}`, options)
}

export function beginSignOut(): void {
  client?.beginSignOut()
}

export async function completeSignIn(): Promise<{ token: StoredToken; returnTo: string }> {
  if (!client) throw new Error('this build offers no sign-in')
  return client.completeSignIn(window.location.search)
}

export function stashShellReason(reason: ShellReason): void {
  client?.stashShellReason(reason)
}

export function takeShellReason() {
  return client?.takeShellReason() ?? null
}

export function callbackParams(): { code?: string; error?: string } | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code') ?? undefined
  const error = params.get('error') ?? undefined
  return code || error ? { code, error } : null
}

export function clearQuery(): void {
  window.history.replaceState({}, '', window.location.pathname)
}

export function guardAttemptedAt(): number | null {
  if (typeof sessionStorage === 'undefined') return null
  const raw = sessionStorage.getItem('estiva.authShell.silentAttempt')
  const at = raw ? Number(raw) : NaN
  return Number.isFinite(at) ? at : null
}

/**
 * Who Estiva ID says this is. Asked of its directory with the token, so the
 * answer also proves Estiva ID accepted the sign-in.
 */
export async function whoAmI(): Promise<{ name?: string; email?: string } | null> {
  const token = currentToken()
  if (!ID_CONFIG || !token) return null
  const response = await fetch(`${ID_CONFIG.base}/directory/${token.pubkey}`, { headers: { Authorization: `Bearer ${token.accessToken}` } })
  if (!response.ok) return null
  const entry = (await response.json()) as { displayName?: string; email?: string }
  return { name: entry.displayName, email: entry.email }
}
