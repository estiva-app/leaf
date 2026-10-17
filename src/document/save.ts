import { createPeopleCache, createProjectionCache, resolveForeignObject, type ForeignObject } from '@estiva-app/interop'
import { attachmentsInDocument, imetaTag, toNostrSeconds, type PublishResult, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { publish, query, viewerPubkey } from '../relay/bridge'

/** A change to a file's field (SPEC §6.2); protocol has no name for it yet. */
export const CHANGE = 1851

const manifests = createProjectionCache()
const people = createPeopleCache()

/** One document, read again on its own: what the page shows after a change to it arrives. */
export function readDocument(naddr: string): Promise<ForeignObject | null> {
  return resolveForeignObject(naddr, query, people.viaRelay(query), 0, manifests)
}

/**
 * A page's whole summary, for its editor: interop's `subtitle` stops at 280
 * characters with an "…", and saving that back would cut the summary short.
 * The `summary` field folded as SPEC §6.12 says — the newest change in the
 * page's own Folder by `ts`, then `created_at`, then id, else the root's seed —
 * read only when the slot was cut. `null` when it cannot be read.
 */
export async function readSummary(file: Pick<ForeignObject, 'address' | 'folder' | 'eventId'>): Promise<string | null> {
  if (!file.address || !file.folder) return null
  try {
    const [changes, roots] = await Promise.all([query([{ kinds: [CHANGE], '#a': [file.address] }]), query([{ ids: [file.eventId] }])])
    const value = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1]
    const order = (e: SignedEvent) => [Number(value(e, 'ts') ?? e.created_at * 1000), e.created_at, e.id] as const
    const newest = changes
      .filter((e) => value(e, 'field') === 'summary' && value(e, 'h') === file.folder && value(e, 'value') !== undefined)
      .sort((a, b) => {
        const [x, y] = [order(a), order(b)]
        return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0)
      })
      .at(-1)
    return (newest ? value(newest, 'value') : roots[0] && value(roots[0], 'summary')) ?? ''
  } catch {
    return null
  }
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
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-text-is-a-readable-snapshot.md
 */
export function buildChange(
  pubkey: string,
  createdAtMs: number,
  args: { target: string; field: DocumentField; value: string; folder: string; contentFormat?: string },
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

/** The fields a page writes: its title, its summary (plain text, never a `content-format`, SPEC §6.12) and its text. */
export type DocumentField = 'title' | 'summary' | 'description'

/** Save a document's title, summary or text. `ok: false` carries what to tell the person. */
export async function saveField(
  file: Pick<ForeignObject, 'address' | 'folder'>,
  field: DocumentField,
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
