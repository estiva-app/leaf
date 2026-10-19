import { fetchBlob, imetaFor, uploadBlob, type Imeta } from '@estiva-app/protocol'
import { sessionEnded } from '../auth/estivaId'
import { relaySigner } from './bridge'

/**
 * A file's bytes, both ways, as Ship's `api/blobs.ts` has them (COMM-6).
 *
 * Media GET on the relay is authenticated, so an `<img src>` answers 401: a
 * file is fetched with a signed `kind:24242` and drawn from an object URL.
 * Only this relay is ever sent that signature. A media URL comes from someone
 * else's `imeta`, and any other host would receive the reader's replayable
 * get-token for the asking (COM-2, as Peek and Ship).
 *
 * Object URLs are kept, never revoked: a card drawing one may outlive the read
 * that made it, and a revoked URL draws as a broken image. A URL is content
 * addressed, so one held promise per URL is right for as long as the tab is.
 */

/** Distinct files held as object URLs before new ones stop being cached. */
export const CACHE_LIMIT = 64

const cache = new Map<string, Promise<string>>()

/** An object URL for a file on this relay, fetched as whoever is signed in. Rejects when it cannot be read: the card says so. */
export function blobObjectUrl(mediaUrl: string): Promise<string> {
  const relay = relaySigner()
  if (!relay) return Promise.reject(new Error('signed out'))
  // Kept per reader: someone else signing in in this tab reads with their own authorization, not the bytes held for the last one.
  const key = `${relay.pubkey} ${mediaUrl}`
  const held = cache.get(key)
  if (held) return held
  if (!sameOriginAs(mediaUrl, relay.relayUrl)) return Promise.reject(new Error(`not this relay's media: ${mediaUrl}`))
  const pending = fetchBlob({
    relayUrl: relay.relayUrl,
    url: mediaUrl,
    sign: (unsigned) => relay.signer.sign(unsigned),
    pubkey: relay.pubkey,
    // The type is the server's say-so, and a blob: URL opens as Leaf: only pictures and PDFs keep theirs.
  }).then(({ bytes, contentType }) => URL.createObjectURL(new Blob([bytes], { type: safeBlobType(contentType) })))
  // A failure is not kept: an expired sign-in is the usual cause, and the next draw is when a renewed one works.
  pending.catch(() => cache.delete(key))
  if (cache.size < CACHE_LIMIT) cache.set(key, pending)
  return pending
}

function sameOriginAs(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base.replace(/^ws/, 'http')).origin
  } catch {
    return false
  }
}

/** A served type a blob: URL may carry: a picture, a video or a PDF; anything else downloads as bytes. Peek's and Ship's rule. */
export function safeBlobType(contentType: string | undefined): string {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (/^(image\/(png|jpe?g|gif|webp|avif)|video\/(mp4|webm)|application\/pdf)$/.test(type)) return type
  return 'application/octet-stream'
}

/** Test seam: the cache is module state, and a suite must not inherit it. */
export function clearBlobCache(): void {
  cache.clear()
}

/** What an upload answered: the file's `imeta`, or what the box says under the file. */
export type Uploaded = { ok: true; file: Imeta } | { ok: false; reason: string }

/**
 * Put a file on the relay and describe it as the `imeta` a comment names it
 * by. It must land before the comment: the relay refuses a comment naming a
 * file it does not hold. `uploadBlob` strips a picture's metadata first, which
 * the relay refuses too, and the `m` and `x` are the relay's answers, not the
 * browser's guess (`imetaFor`).
 */
export async function uploadFile(file: File): Promise<Uploaded> {
  const relay = relaySigner()
  if (!relay) return { ok: false, reason: 'Signed out' }
  try {
    const blob = await uploadBlob({
      relayUrl: relay.relayUrl,
      bytes: await file.arrayBuffer(),
      contentType: file.type || undefined,
      filename: file.name,
      sign: (unsigned) => relay.signer.sign(unsigned),
      pubkey: relay.pubkey,
    })
    return { ok: true, file: imetaFor(blob, { filename: file.name }) }
  } catch (error) {
    // The relay's words name its limits in bytes: the console keeps them, the person gets what it means.
    console.warn('[relay] upload refused', file.name, error)
    // Estiva ID refused to sign because the sign-in ended: signing in again is what helps, as a send says (bridge's signingFailure).
    return { ok: false, reason: sessionEnded() ? 'Sign in again' : uploadRefusal(error) }
  }
}

/** The words under a file the relay did not take, short enough for the file's card. `uploadBlob` throws `upload failed: <status> <body>`. */
export function uploadRefusal(error: unknown): string {
  const status = Number(/^upload failed: (\d{3})/.exec(error instanceof Error ? error.message : '')?.[1])
  if (status === 413) return 'Too large'
  if (status === 415) return 'Type not accepted'
  if (status === 401 || status === 403) return 'Not allowed'
  return 'Could not upload'
}
