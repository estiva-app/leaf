import { createEstivaId, type Renewal, type ShellReason, type StoredToken } from '@estiva-app/identity'
import { ID_CONFIG } from '../config'
import { forgetHeldTyping, holdTyping, holdTypingFor } from './heldTyping'

/**
 * Signing in with Estiva ID, the way Ship does: `@estiva-app/identity` holds the
 * flow, this file the app's choices.
 *
 * - The redirect is the origin and a slash, never the current path: Estiva ID
 *   compares it exactly against the one address registered for the app.
 * - The session lives in localStorage, so it outlives a tab; a sign-in's
 *   single-use credentials in sessionStorage, per tab.
 * - Since AUT-5 (Ship's AUT-4) a sign-in that ends while Leaf is open asks for
 *   the passkey on the page, and two tabs share one renewal.
 */
const KEY_PREFIX = 'leaf.estiva-id'
const TOKEN_KEY = `${KEY_PREFIX}.token`
/** When a tab last signed out, so another tab can tell a sign-out from a refused renewal: both clear the token. */
const SIGNED_OUT_KEY = `${KEY_PREFIX}.signed-out`

function signedOutJustNow(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(SIGNED_OUT_KEY) ?? 0) < 10_000
  } catch {
    return false
  }
}

const client = ID_CONFIG
  ? createEstivaId({
      base: ID_CONFIG.base,
      clientId: ID_CONFIG.clientId,
      redirectUri: () => `${window.location.origin}/`,
      storage: () => (typeof localStorage === 'undefined' ? null : localStorage),
      pendingStore: () => (typeof sessionStorage === 'undefined' ? null : sessionStorage),
      keyPrefix: KEY_PREFIX,
      navigate: (url) => window.location.assign(url),
    })
  : null

export const signInAvailable = client !== null

/** A token that is present and usable for another minute, or `null`: what the boot asks. */
export function currentToken(): StoredToken | null {
  return client?.validToken(Date.now() + 60_000) ?? null
}

/**
 * The session this page holds, expired or not: whose page it is, and the bearer
 * the signers present. Not {@link currentToken}: in its last minute, or while a
 * renewal is still out, that one is `null`, and a signer given nothing treats it
 * as an expiry without renewing (as Ship's `api/store.ts`, AUT-4).
 */
export function heldToken(): StoredToken | null {
  return client?.storedToken() ?? null
}

let schedule: { cancel: () => void } | null = null

/**
 * Renew before the token expires, and when the tab is shown again or the network
 * comes back (identity 0.3.0, under a Web Lock, so two tabs spend one refresh
 * token). A refusal ends the sign-in on this page: {@link SessionGate} draws the
 * passkey screen in its place. Idempotent: a second schedule would spend a
 * refresh token the first had just been given.
 */
export function startRenewal(): void {
  schedule?.cancel()
  schedule = client?.scheduleRenewal({ onEnded: () => endSession('session_expired') }) ?? null
}

/**
 * Whether this page's sign-in has ended, and why: a renewal Estiva ID refused,
 * or another tab signing out. The one thing `SessionGate` subscribes to.
 */
let ended: ShellReason | null = null
const endedListeners = new Set<() => void>()

function endSession(reason: ShellReason): void {
  if (ended) return
  // Before the screen takes the page's place, while what was typed is still there to read; not for a sign-out.
  if (reason === 'session_expired') holdTyping()
  ended = reason
  schedule?.cancel()
  for (const listener of endedListeners) listener()
}

export function sessionEnded(): ShellReason | null {
  return ended
}

export function subscribeSessionEnded(listener: () => void): () => void {
  endedListeners.add(listener)
  return () => endedListeners.delete(listener)
}

/**
 * Follow the other tabs, which share the session in localStorage:
 *
 * - **another tab renewed:** nothing to do; the schedule and the signers read
 *   the stored token when they next need it;
 * - **another tab signed out, or its renewal was refused:** the token is gone,
 *   and this tab draws the sign-in screen at once, not at its next save;
 * - **somebody else signed in, or a session came back after this page lost
 *   it:** reload, since everything under this page was read as the last person.
 */
export function followOtherTabs(): () => void {
  if (!client || typeof window === 'undefined') return () => {}
  const person = client.storedToken()?.pubkey
  holdTypingFor(person)
  const follow = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage || (event.key !== TOKEN_KEY && event.key !== null)) return
    const token = client.storedToken()
    if (token === null) endSession(event.key === null || signedOutJustNow() ? 'no_session' : 'session_expired')
    else if (ended || token.pubkey !== person) window.location.reload()
  }
  window.addEventListener('storage', follow)
  return () => window.removeEventListener('storage', follow)
}

/** Whether an expired access token can be renewed here without leaving the page, for `decideBoot`. */
export function canRenew(): boolean {
  return client?.storedToken()?.refreshToken !== undefined
}

/** Spend the stored refresh token once, for the boot's `renew` step. */
export async function renewInPlace(): Promise<Renewal> {
  if (!client) return { outcome: 'none' }
  const renewal = await client.renew()
  if (renewal.outcome === 'refused') endSession('session_expired')
  return renewal
}

/**
 * For the signers' `renew`, so a 401 from `/sign` is an invisible retry. A
 * refusal ends the sign-in on this page too; `null` when there is no new token.
 */
export async function renew(): Promise<string | null> {
  if (!client) return null
  const renewal = await client.renew()
  if (renewal.outcome === 'refused') endSession('session_expired')
  return renewal.outcome === 'renewed' ? renewal.token.accessToken : null
}

export async function beginSignIn(options: { silent?: boolean } = {}): Promise<void> {
  await client?.beginSignIn(`${window.location.pathname}${window.location.search}${window.location.hash}`, options)
}

/** Leave for Estiva ID to end the session there; nothing typed stays on the device. */
export function beginSignOut(): void {
  forgetHeldTyping()
  // Before the token goes, so the other tabs read its removal as a sign-out and hold nothing.
  try {
    localStorage.setItem(SIGNED_OUT_KEY, String(Date.now()))
  } catch {
    // Blocked storage: the other tabs hear nothing either.
  }
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

/** Where the sign-in in the air began, as `beginSignIn` stored it. Single-use. */
export function takeReturnTo(): string | null {
  return client?.takeReturnTo() ?? null
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
  const token = heldToken()
  if (!ID_CONFIG || !token) return null
  const response = await fetch(`${ID_CONFIG.base}/directory/${token.pubkey}`, { headers: { Authorization: `Bearer ${token.accessToken}` } })
  if (!response.ok) return null
  const entry = (await response.json()) as { displayName?: string; email?: string }
  return { name: entry.displayName, email: entry.email }
}
