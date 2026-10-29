import { KIND_CHANNEL_METADATA, createPeopleCache, resolveForeignObject, resolveForeignObjects, resolveManifest, type ForeignObject } from '@estiva-app/interop'
import { KIND, addrToNaddr, addressToPointer, attachmentsInDocument, imetaTag, toNostrSeconds, type PublishResult, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { MAX_MENTIONED_PEOPLE, buildMembershipChange, byOrder, newlyNamedPeople, peopleNamedInText, type FileText } from '@estiva-app/conversation'
import { publish, viewerPubkey } from '../relay/bridge'
import { projections as manifests, resolveQuery as query } from '../relay/manifests'
import { documentPath } from '../route'

/** A change to a file's field (SPEC §6.2); protocol has no name for it yet. */
export const CHANGE = 1851

const people = createPeopleCache()

/**
 * One file, read again on its own: what the page shows after a change to it arrives, and a file opened by its address.
 * Archived with the closest archived file above it, at any depth, counts too (SPEC §6.5), so a file reached directly
 * is read-only as every app draws it.
 */
export function readDocument(naddr: string): Promise<ForeignObject | null> {
  return resolveForeignObject(naddr, query, people.viaRelay(query), 0, manifests, { archivedWith: true })
}

/** Several files read as {@link readDocument} reads one, in one request: keyed by the `naddr` given. */
export function readDocuments(naddrs: readonly string[]): Promise<Record<string, ForeignObject | null>> {
  return resolveForeignObjects(naddrs, query, people.viaRelay(query), manifests, { archivedWith: true })
}

/**
 * The closest archived file above an archived file, for the lines that name it (PEEKM-8): what its app calls it —
 * "project", "document", from its manifest's projection — and where it is unarchived: a Folder in Peek, Leaf's own
 * pages here (no app named, LED-4), anything else in its own app. Read through the tab's manifest cache,
 * which the file's own read has already filled. And where the notice's Open opens it (a3257366): a Leaf page at its
 * own path here, anything else at the address its own app gives it, where it can be unarchived (Miky, 2026-10-29) —
 * https only, since that comes from a manifest anyone may publish. Each is absent when nobody declares it.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md
 */
export async function archivedAbove(address: string): Promise<{ noun?: string; app?: string; href?: string }> {
  let pointer
  try {
    pointer = addressToPointer(address)
  } catch {
    return {}
  }
  if (pointer.kind === KIND_CHANNEL_METADATA) return { noun: 'folder', app: 'Peek' }
  // Leaf calls its own documents pages, as the LED-1 prototype's lines do, and opens them here.
  if (pointer.kind === KIND.DOCUMENT) return { noun: 'page', href: documentPath(pointer.identifier) }
  const [found, file] = await Promise.all([
    resolveManifest(pointer, query, manifests).catch(() => null),
    resolveForeignObject(addrToNaddr(address), query, people.viaRelay(query), 0, manifests).catch(() => null),
  ])
  const noun = found?.manifest.projections?.[String(pointer.kind)]?.noun
  const href = file?.openUrl && /^https:\/\//i.test(file.openUrl) ? file.openUrl : undefined
  return { noun, app: found?.manifest.name, href }
}

/**
 * The Folder a file's archive is written to, so its unarchive can be heard (PEEKM-8): its own Folder, the only one
 * its archive counts in (SPEC §6.2) — a Ship project's record Folder, not the one its issues live in. Read from the
 * file itself, never from a change's `h`, which anyone can write. Absent when it cannot be read.
 */
export async function archiveFolderOf(address: string): Promise<string | undefined> {
  let pointer
  try {
    pointer = addressToPointer(address)
  } catch {
    return undefined
  }
  if (pointer.kind === KIND_CHANNEL_METADATA) return pointer.identifier
  const found = await resolveForeignObject(addrToNaddr(address), query, people.viaRelay(query), 0, manifests).catch(() => null)
  return found?.folder
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
    // §6.3's order, the suite's own: a `ts` counts only when it agrees with `created_at`, so a forged one is ignored.
    const newest = changes
      .filter((e: SignedEvent) => value(e, 'field') === 'summary' && value(e, 'h') === file.folder && value(e, 'value') !== undefined)
      .sort(byOrder)
      .at(-1)
    return (newest ? value(newest, 'value') : roots[0] && value(roots[0], 'summary')) ?? ''
  } catch {
    return null
  }
}

/** A person's name for "<name> saved a newer version", from their profile; `null` when they have none. */
export async function nameOf(pubkey: string): Promise<string | null> {
  return (await profileOf(pubkey))?.displayName ?? null
}

/** A person's name and picture, from their profile, as Peek and Ship draw them; `null` when they have none. */
export async function profileOf(pubkey: string): Promise<{ displayName?: string; picture?: string } | null> {
  const lookup = await people.viaRelay(query)([pubkey])
  return lookup[pubkey] ?? null
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
  args: { target: string; field: string; value: string; folder: string; contentFormat?: string },
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
  if (!file.address || !file.folder) return { ok: false, reason: 'This cannot be saved from here.' }
  const result: PublishResult = await publish(buildChange(pubkey, Date.now(), { target: file.address, field, value, folder: file.folder, contentFormat }))
  if (result.ok) {
    for (const listener of saved) listener()
    return { ok: true }
  }
  // The relay's reason names kinds and rules: the console keeps it.
  console.warn('[relay] save refused', result)
  return { ok: false, reason: 'Could not save. Your text is still here.' }
}

/** The fields a card never writes: a file's words, and its archive. */
const NOT_ON_A_CARD = new Set(['title', 'summary', 'description', 'archived'])

/**
 * Change a file from its card: a status or an owner, through a choice its
 * owner's app shares — an action of the file's own (never a borrowed one), a
 * select or a person, and for a select one of its options (5ebf2756). Written
 * as the same one-field change as the text, in the file's Folder. Never a
 * field a card does not hold: its words, where it is filed, or its archive.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-card-changes-what-a-files-app-shares.md
 */
export async function saveCardChoice(
  file: Pick<ForeignObject, 'address' | 'folder' | 'actions' | 'archived' | 'parentField'>,
  actionId: string,
  value: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to change it.' }
  const action = file.actions.find((one) => one.id === actionId)
  const shared =
    action &&
    !action.declaredBy &&
    action.field &&
    !NOT_ON_A_CARD.has(action.field) &&
    action.field !== file.parentField &&
    (action.control === 'select' || action.control === 'pubkey')
  if (!shared || file.archived || !file.address || !file.folder) return { ok: false, reason: 'This can’t be changed from here.' }
  if (action.control === 'select' && !action.options?.some((option) => option.value === value)) return { ok: false, reason: 'This can’t be changed from here.' }
  const result = await publish(buildChange(pubkey, Date.now(), { target: file.address, field: action.field!, value, folder: file.folder }))
  if (result.ok) return { ok: true }
  console.warn('[relay] change refused', result)
  return { ok: false, reason: 'Could not change it.' }
}

/**
 * Save a file's text, and add each person it names whom the text it was
 * edited from did not, as the Add button does (SPEC §11.8). The save carries
 * no `p`: a typo fix names nobody new, so it adds nobody, and someone who left
 * stays out. `refused` is who could not be added, after a save that went
 * through; pass them back as `unadded` and the next save that still names them
 * tries again, since its text no longer names them anew.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-mention-in-a-files-text-adds-the-person-with-no-unread.md
 */
export async function saveText(
  file: Pick<ForeignObject, 'address' | 'folder'>,
  saved: FileText & { content: string },
  editedFrom: FileText,
  unadded: readonly string[] = [],
): Promise<{ ok: true; refused: string[] } | { ok: false; reason: string }> {
  const result = await saveField(file, 'description', saved.content, saved.format)
  const pubkey = viewerPubkey()
  const { address, folder } = file
  if (!result.ok || !pubkey || !address || !folder) return result.ok ? { ok: true, refused: [] } : result
  const named = peopleNamedInText(saved)
  const people = [...new Set([...newlyNamedPeople(saved, editedFrom), ...unadded.filter((person) => named.has(person))])]
    .filter((person) => person !== pubkey)
    .slice(0, MAX_MENTIONED_PEOPLE)
  const now = Date.now()
  const answers = await Promise.all(people.map((person) => publish(buildMembershipChange(pubkey, now, { file: address, folder, person, member: true }))))
  return {
    ok: true,
    refused: people.filter((_, i) => {
      if (answers[i].ok) return false
      console.warn('[relay] mention add refused', answers[i])
      return true
    }),
  }
}
