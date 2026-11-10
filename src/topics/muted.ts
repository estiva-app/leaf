import { MUTED_D_TAG, mutedFilter, parseMutedBlob } from '@estiva-app/conversation'
import type { SignedEvent } from '@estiva-app/protocol'
import { nip44 } from '../auth/nip44'
import { query } from '../relay/bridge'

/** The mute list's kind: app data, encrypted to you (§11.8 *Muting*). */
const KIND_APP_DATA = 30078

/** The newest of `me`'s mute-list events, which is the whole list (§12.3: last write wins). */
export function newestMuted(events: readonly SignedEvent[], me: string): SignedEvent | undefined {
  return events
    .filter((event) => event.pubkey === me && event.kind === KIND_APP_DATA && event.tags.some((tag) => tag[0] === 'd' && tag[1] === MUTED_D_TAG))
    .sort((a, b) => b.created_at - a.created_at)[0]
}

/** The last list decrypted, so an unchanged one costs no `/nip44/decrypt` on the next return to the tab. */
let decrypted: { id: string; keys: ReadonlySet<string> } | undefined

/** Test seam: forget the last list decrypted. */
export function resetMutedForTests(): void {
  decrypted = undefined
}

/**
 * The files and topics `me` muted (`estiva:muted:v1`), as Ship's `readMuted` reads them (TOPI-4): the newest list,
 * decrypted through Estiva ID. No list is nothing muted; `undefined` when the list is there but would not decrypt or
 * parse. Throws when the relay or Estiva ID did not answer: the caller tells "could not read" from "nothing muted".
 */
export async function readMuted(me: string): Promise<ReadonlySet<string> | undefined> {
  const list = newestMuted(await query([mutedFilter(me) as Record<string, unknown>]), me)
  if (!list) return new Set()
  if (decrypted?.id === list.id) return decrypted.keys
  const parsed = parseMutedBlob(await nip44.decrypt(list.content))
  if (!parsed) return undefined
  decrypted = { id: list.id, keys: new Set(parsed.keys) }
  return decrypted.keys
}
