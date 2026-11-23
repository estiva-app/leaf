import { estivaIdSigner, SignRefused } from '@estiva-app/identity'
import { DEFAULT_BACKOFF_MS, MIN_BACKOFF_MS, isRateLimited, retryHintMs } from '@estiva-app/platform'
import { MERGE_READS_MS, Relay, type FileTimes, type PublishResult, type SignedEvent, type Signer, type UnsignedEvent } from '@estiva-app/protocol'
import { heldToken, renew, sessionEnded } from '../auth/estivaId'
import { ID_CONFIG, RELAY_URL } from '../config'
import { heardRefusal } from '../lib/failureReports'
import { heardFailure } from '../lib/heardFailures'

/**
 * The relay's HTTP bridge, for reads and writes that are one request each: the
 * Folder listings, a Folder's contents, a new page. Ship reads the same way.
 * Not a socket — the tab's one connection stays `relayClient()`'s.
 *
 * `null` when this build has no relay or no sign-in: the relay refuses a read
 * before sign-in, so there is nothing to ask.
 */
function bridge(): Held | null {
  // The held token, expired or not: in its last minute, or while a renewal is out, the page is still this person's,
  // and the signer renews on `/sign`'s 401 (AUT-5, as Ship's `api/store.ts`).
  const token = heldToken()
  if (!RELAY_URL || !ID_CONFIG || !token) return null
  if (held?.pubkey === token.pubkey) return held
  const signer = estivaIdSigner({
    base: ID_CONFIG.base,
    pubkey: token.pubkey,
    // A reader, not the token: a renewal replaces the stored one, and a captured
    // string would go stale with it (identity 0.2.2).
    token: () => heldToken()?.accessToken,
    renew,
  })
  // Every refused write is reported by its reason code, busy answers included (PROD-5).
  // Plain reads that start together go out as one request, as Ship's do (SHI-61): an open spends less of the minute.
  held = { relay: new Relay(RELAY_URL, signer, { onRefused: heardRefusal, mergeReadsMs: MERGE_READS_MS }), signer, pubkey: token.pubkey }
  return held
}
type Held = { relay: Relay; signer: Signer; pubkey: string }
let held: Held | null = null

/** How long a read waits out the person's per-minute limit before it fails as any other read does: three of the relay's minutes. */
export const WAIT_OUT_MS = 180_000

/**
 * A read the relay refuses because this person's minute is spent (300 requests, every app together) waits the time
 * the relay names and asks again, so a page opened a few times in a minute shows loading, then the page, never "could
 * not be read" (LFB-12). Under every read rather than in each screen: every screen's failure words are for a read that
 * will not answer, and this one will. Any other failure is thrown at once: a refusal can mean this person lost access.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-busy-relay-says-it-is-busy.md
 */
async function waitingOut<T>(read: (relay: Relay) => Promise<T>): Promise<T> {
  const asked = bridge()
  if (!asked) throw notSignedIn()
  const giveUpAt = Date.now() + WAIT_OUT_MS
  for (;;) {
    // Whoever is signed in now: a read that waited through a sign-out is not asked again as the person before.
    const b = bridge()
    if (!b || b.pubkey !== asked.pubkey) throw notSignedIn()
    try {
      return await read(b.relay)
    } catch (error) {
      // Why, for the report of the failure a screen draws if this read ends as one (34396209).
      heardFailure(error)
      const reason = error instanceof Error ? error.message : String(error)
      if (!isRateLimited(reason)) throw error
      const now = Date.now()
      // The relay's seconds are what is left of its minute, rounded down. The spread, one per tab and minute, keeps
      // the tabs that waited from all asking in the instant the minute turns.
      if (clearAt <= now) clearAt = now + Math.max(retryHintMs(reason) ?? DEFAULT_BACKOFF_MS, MIN_BACKOFF_MS) + Math.random() * MIN_BACKOFF_MS
      if (clearAt > giveUpAt) throw error
      await new Promise((resolve) => setTimeout(resolve, clearAt - now))
    }
  }
}
/** A read with nobody signed in, said for the report as any failed read is (34396209). */
function notSignedIn(): Error {
  const error = new Error('Not signed in to a relay.')
  heardFailure(error)
  return error
}
/**
 * When this tab asks again: one moment for every read refused in the same minute, so they go out together and as few
 * requests as the open made the first time. Each waiting on its own would ask one by one, and spend the next minute too.
 */
let clearAt = 0

/** Who is signed in, or `null`. */
export function viewerPubkey(): string | null {
  return bridge()?.pubkey ?? null
}

/** The relay's origin and the signed-in signer, for a request the bridge does not make itself (a file's bytes, `blobs.ts`); `null` signed out. */
export function relaySigner(): { relayUrl: string; signer: Signer; pubkey: string } | null {
  const b = bridge()
  // bridge() is null without a relay, so RELAY_URL is set whenever b is.
  return b ? { relayUrl: RELAY_URL!, signer: b.signer, pubkey: b.pubkey } : null
}

/**
 * A filter query, as interop's resolvers take it. Throws when the relay
 * refused or could not be reached, so "nothing here" and "could not read"
 * stay different sentences on screen.
 */
export async function query(filters: Record<string, unknown>[]): Promise<SignedEvent[]> {
  return waitingOut((relay) => relay.query(filters))
}

/** The times read (SPEC §6.13, `"fields": "times"`), as interop's activity read takes it; only where the relay offers it. */
export async function queryTimes(filters: Record<string, unknown>[]): Promise<FileTimes[]> {
  return waitingOut((relay) => relay.queryTimes(filters))
}

/** {@link query}, paged to the end: for a read that must be whole, which the relay's per-filter cap would cut. */
export async function queryAll(filters: Record<string, unknown>[]): Promise<SignedEvent[]> {
  return waitingOut((relay) => relay.queryAll(filters))
}

/** {@link query} answered with what each event matched: the relay's search by a file's current fields (§6.13). */
export async function queryWithMatches(filters: Record<string, unknown>[]): Promise<Awaited<ReturnType<Relay['queryWithMatches']>>> {
  return waitingOut((relay) => relay.queryWithMatches(filters))
}

/**
 * Sign and publish apart, for interop's `writeChange`, which signs each attempt and reads the relay's words (§6.2).
 * Signing throws with what to tell the person; publishing answers `ok: false` with the relay's reason.
 */
export const changeWriter = {
  async sign(unsigned: UnsignedEvent): Promise<SignedEvent> {
    const b = bridge()
    if (!b) throw new Error('Not signed in to a relay.')
    try {
      return await b.signer.sign(unsigned)
    } catch (error) {
      console.warn('[relay] could not sign', error)
      throw new Error(signingFailure(error), { cause: error })
    }
  },
  async publish(event: SignedEvent): Promise<{ ok: boolean; reason?: string; eventId: string }> {
    const b = bridge()
    if (!b) return { ok: false, reason: 'Not signed in to a relay.', eventId: event.id }
    try {
      const result = await b.relay.publish(event)
      return { ok: result.ok, reason: result.reason, eventId: event.id }
    } catch (error) {
      console.warn('[relay] could not publish', error)
      return { ok: false, reason: 'Leaf could not reach the workspace. Try again.', eventId: event.id }
    }
  },
}

/**
 * Sign through Estiva ID and publish. Read `ok`, never a status code: the relay
 * refuses as 200 with `accepted: false`.
 */
export async function publish(unsigned: UnsignedEvent): Promise<PublishResult> {
  const b = bridge()
  if (!b) return { ok: false, reason: 'Not signed in to a relay.' }
  let signed: SignedEvent
  try {
    signed = await b.signer.sign(unsigned)
  } catch (error) {
    // Estiva ID's own words name kinds and ceilings; the console keeps them, the person gets what to do.
    console.warn('[relay] could not sign', error)
    return { ok: false, reason: signingFailure(error) }
  }
  try {
    // The signed event's id is the one the relay keeps, whether or not its answer names it.
    const result = await b.relay.publish(signed)
    return result.ok ? { ...result, eventId: result.eventId ?? signed.id } : result
  } catch (error) {
    console.warn('[relay] could not publish', error)
    return { ok: false, reason: 'Leaf could not reach the workspace. Try again.' }
  }
}

/**
 * What a person reads when Estiva ID did not sign. "Sign in again" only when the
 * sign-in has ended, which the passkey screen also says: a refusal of this one
 * event, or no answer, leaves them signed in (AUT-5).
 */
export function signingFailure(error: unknown): string {
  if (sessionEnded()) return 'Your sign-in ended. Sign in again, then try again.'
  if (error instanceof SignRefused && error.status === 403) return 'Your Estiva account is not active, so Leaf cannot save as you.'
  if (error instanceof SignRefused) return 'Estiva ID would not sign this for Leaf.'
  return 'Leaf could not reach Estiva ID. Try again.'
}
