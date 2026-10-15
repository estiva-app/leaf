import { createPeopleCache, createProjectionCache, resolveForeignObject, type ForeignObject } from '@estiva-app/interop'
import { attachmentsInDocument, imetaTag, toNostrSeconds, type PublishResult, type UnsignedEvent } from '@estiva-app/protocol'
import { publish, query, viewerPubkey } from '../relay/bridge'

/** A change to a file's field (SPEC §6.2); protocol has no name for it yet. */
export const CHANGE = 1851

const manifests = createProjectionCache()
const people = createPeopleCache()

/** One document, read again on its own: what the page shows after a change to it arrives. */
export function readDocument(naddr: string): Promise<ForeignObject | null> {
  return resolveForeignObject(naddr, query, people.viaRelay(query), 0, manifests)
}

/** A person's name for "<name> saved a newer version", from their profile; `null` when they have none. */
export async function nameOf(pubkey: string): Promise<string | null> {
  const lookup = await people.viaRelay(query)([pubkey])
  return lookup[pubkey]?.displayName ?? null
}

/**
 * A change to one field of a document — `kind:1851`, SPEC §6.2, the same event
 * Ship's `buildChange` makes: `a`, `field`, `value`, `h`, then the body's
 * `content-format`, `ts` and an `imeta` for each file the body places. The `h`
 * is always the document's own Folder: a change carrying another is accepted
 * by the relay and ignored by every reader, so it would look saved and not be.
 */
export function buildChange(
  pubkey: string,
  createdAtMs: number,
  args: { target: string; field: 'title' | 'description'; value: string; folder: string; contentFormat?: string },
): UnsignedEvent {
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: CHANGE,
    tags: [
      ['a', args.target],
      ['field', args.field],
      ['value', args.value],
      ['h', args.folder],
      ...(args.contentFormat ? [['content-format', args.contentFormat]] : []),
      ['ts', String(Math.floor(createdAtMs))],
      ...attachmentsInDocument(args.value, args.contentFormat).map(imetaTag),
    ],
    content: '',
  }
}

const saved = new Set<() => void>()

/**
 * Hear every save the relay accepted. A page saves when you leave it, so Home
 * opens while that save is still on its way and reads again when it lands.
 */
export function onSaved(listener: () => void): () => void {
  saved.add(listener)
  return () => {
    saved.delete(listener)
  }
}

/** Save a document's title or text. `ok: false` carries what to tell the person. */
export async function saveField(
  file: Pick<ForeignObject, 'address' | 'folder'>,
  field: 'title' | 'description',
  value: string,
  contentFormat?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to save.' }
  if (!file.address || !file.folder) return { ok: false, reason: 'This document cannot be saved from here.' }
  const result: PublishResult = await publish(buildChange(pubkey, Date.now(), { target: file.address, field, value, folder: file.folder, contentFormat }))
  if (result.ok) {
    for (const listener of saved) listener()
    return { ok: true }
  }
  // The relay's reason names kinds and rules: the console keeps it.
  console.warn('[relay] save refused', result)
  return { ok: false, reason: 'Could not save. Your text is still here.' }
}
