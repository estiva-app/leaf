import { estivaIdSigner, SignRefused } from '@estiva-app/identity'
import { Relay, type PublishResult, type SignedEvent, type Signer, type UnsignedEvent } from '@estiva-app/protocol'
import { heldToken, renew, sessionEnded } from '../auth/estivaId'
import { ID_CONFIG, RELAY_URL } from '../config'

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
  held = { relay: new Relay(RELAY_URL, signer), signer, pubkey: token.pubkey }
  return held
}
type Held = { relay: Relay; signer: Signer; pubkey: string }
let held: Held | null = null

/** Who is signed in, or `null`. */
export function viewerPubkey(): string | null {
  return bridge()?.pubkey ?? null
}

/**
 * A filter query, as interop's resolvers take it. Throws when the relay
 * refused or could not be reached, so "nothing here" and "could not read"
 * stay different sentences on screen.
 */
export async function query(filters: Record<string, unknown>[]): Promise<SignedEvent[]> {
  const b = bridge()
  if (!b) throw new Error('Not signed in to a relay.')
  return b.relay.query(filters)
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
    return await b.relay.publish(signed)
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
