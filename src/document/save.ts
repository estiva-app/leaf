import {
  BODY_SLOT,
  KIND_CHANNEL_METADATA,
  createPeopleCache,
  fieldsSetBy,
  isSwitchRefusal,
  openFile,
  prevOf,
  prevsAfterSwitch,
  resolveForeignObject,
  resolveForeignObjects,
  resolveManifest,
  textOf,
  writeChange,
  type ForeignObject,
  type WriteChangeResult,
} from '@estiva-app/interop'
import { KIND, addrToNaddr, addressToPointer, attachmentsInDocument, imetaTag, textAsksOf, toNostrSeconds, type PublishResult, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { MAX_MENTIONED_PEOPLE, buildMembershipChange, byOrder, newlyNamedPeople, peopleNamedInText, type FileText } from '@estiva-app/conversation'
import type { DocumentAsks } from '@estiva-app/ui/editor'
import { changeWriter, publish, viewerPubkey } from '../relay/bridge'
import { PROJECT_KIND, archivedWithOptions, byFields, isProject, openReadOption, projectFields, readRelayAgain } from '../relay/projectFields'
import { projections as manifests, resolveQuery as query } from '../relay/manifests'
import { documentPath } from '../route'

/** A change to a file's field (SPEC §6.2); protocol has no name for it yet. */
export const CHANGE = 1851

/** A file's text field (SPEC §6.2). */
const TEXT_FIELD = 'description'

const people = createPeopleCache()

/**
 * One file, read again on its own: what the page shows after a change to it arrives, and a file opened by its address.
 * Archived with the closest archived file above it, at any depth, counts too (SPEC §6.5), so a file reached directly
 * is read-only as every app draws it.
 */
export async function readDocument(naddr: string): Promise<ForeignObject | null> {
  const file = await resolveForeignObject(naddr, query, people.viaRelay(query), 0, manifests, { ...(await archivedWithOptions()), ...(await openReadOption()) })
  if (file) noteRead(file)
  return file
}

/** Several files read as {@link readDocument} reads one, in one request: keyed by the `naddr` given. */
export async function readDocuments(naddrs: readonly string[]): Promise<Record<string, ForeignObject | null>> {
  const read = await resolveForeignObjects(naddrs, query, people.viaRelay(query), manifests, { ...(await archivedWithOptions()), ...(await openReadOption()) })
  for (const file of Object.values(read)) if (file) noteRead(file)
  return read
}

/**
 * Per project read by its fields, the change each field's next change follows, and each text this tab has shown or
 * saved with the change holding it (Ship's `textChanges`, ALO-5): a text save follows the change holding the text it
 * was edited from, and a merge with a newer one starts from it (§13.3). A text edited from one nobody here holds would
 * merge against the wrong base, so it is not saved.
 */
const held = new Map<string, { prevs: Record<string, string>; texts: Map<string, string> }>()

function heldOf(address: string) {
  let one = held.get(address)
  if (!one) held.set(address, (one = { prevs: {}, texts: new Map() }))
  return one
}

/** Hold what a read of a project says each field's next change follows, and the text it shows. */
export function noteRead(file: Pick<ForeignObject, 'address' | 'prevs' | 'eventId' | 'slots'>): void {
  if (!isProject(file.address) || !file.prevs) return
  const one = heldOf(file.address!)
  for (const [field, id] of Object.entries(file.prevs)) if (id && field !== TEXT_FIELD) one.prevs[field] = id
  const text = prevOf(file, TEXT_FIELD)
  if (text) one.texts.set(file.slots[BODY_SLOT]?.value ?? '', text)
}

/**
 * The closest archived file above an archived file, for the lines that name it (PEEKM-8): what its app calls it —
 * "project", "document", from its manifest's projection — and where it is unarchived: a Folder in Peek, Leaf's own
 * pages here (no app named, LED-4), anything else in its own app. Read through the tab's manifest cache,
 * which the file's own read has already filled. And where the notice's Open opens it (a3257366): a Leaf page at its
 * own path here, anything else at the address its own app gives it, where it can be unarchived (Miky, 2026-10-29) —
 * https only, since that comes from a manifest anyone may publish — and its title, which the notice names it by, as
 * Ship's card does (Miky, 2026-10-29); both read only when `opens` asks for them, since they cost the file's own read.
 * Each is absent when nobody declares it.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md
 */
export async function archivedAbove(address: string, opens = false): Promise<{ noun?: string; app?: string; href?: string; title?: string }> {
  let pointer
  try {
    pointer = addressToPointer(address)
  } catch {
    return {}
  }
  if (pointer.kind === KIND_CHANNEL_METADATA) return { noun: 'team', app: 'Peek' }
  const read = async () => (opens ? resolveForeignObject(addrToNaddr(address), query, people.viaRelay(query), 0, manifests, await openReadOption()).catch(() => null) : null)
  const titled = (file: ForeignObject | null) => file?.slots.title?.value?.trim() || undefined
  // Leaf calls its own documents pages, as the LED-1 prototype's lines do, and opens them here.
  if (pointer.kind === KIND.DOCUMENT) return { noun: 'page', href: documentPath(pointer.identifier), title: titled(await read()) }
  const [found, file] = await Promise.all([resolveManifest(pointer, query, manifests).catch(() => null), read()])
  const noun = found?.manifest.projections?.[String(pointer.kind)]?.noun
  const href = file?.openUrl && /^https:\/\//i.test(file.openUrl) ? file.openUrl : undefined
  return { noun, app: found?.manifest.name, href, title: titled(file) }
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
  const found = await resolveForeignObject(addrToNaddr(address), query, people.viaRelay(query), 0, manifests, await openReadOption()).catch(() => null)
  return found?.folder
}

/**
 * A page's whole summary, for its editor: interop's `subtitle` stops at 280
 * characters with an "…", and saving that back would cut the summary short.
 * The `summary` field folded as SPEC §6.12 says — the newest change in the
 * page's own Folder by `ts`, then `created_at`, then id, else the root's seed —
 * read only when the slot was cut. `null` when it cannot be read.
 */
export async function readSummary(file: Pick<ForeignObject, 'address' | 'folder' | 'eventId' | 'prevs'>): Promise<string | null> {
  if (!file.address || !file.folder) return null
  try {
    const value = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1]
    // A project read by its fields names its summary's current change, which the relay kept in order: that one change
    // is read, not every change (ALO-6).
    if ((await byFields(file.address)) && file.prevs) {
      // As this tab last read or wrote it: the file a page hands in is the one it opened.
      const current = held.get(file.address)?.prevs.summary ?? file.prevs.summary
      const [event] = await query([{ ids: [current ?? file.eventId] }])
      if (!event) return null
      return (current ? fieldsSetBy(event).find((set) => set.field === 'summary')?.value : value(event, 'summary')) ?? ''
    }
    const [changes, roots] = await Promise.all([query([{ kinds: [CHANGE], '#a': [file.address] }]), query([{ ids: [file.eventId] }])])
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

/** A person's name and picture, and `bot` for an agent, from their profile, as Peek and Ship draw them; `null` when they have none. */
export async function profileOf(pubkey: string): Promise<{ displayName?: string; picture?: string; bot?: true } | null> {
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
  args: {
    target: string
    field: string
    value: string
    folder: string
    contentFormat?: string
    /** The change this one follows for its field, or the record's id for its first (SPEC §6.2); only where the relay keeps the file in order. */
    prev?: string
  },
): UnsignedEvent {
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: CHANGE,
    tags: [
      ['a', args.target],
      // The file it is about, by its id, as a comment names its file (SPEC §6.2), as Ship's change does.
      // why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-change-is-about-its-file-as-a-comment-is.md
      ['O', args.target.split(':').slice(2).join(':')],
      ['field', args.field],
      ['value', args.value],
      ['h', args.folder],
      ...(args.contentFormat ? [['content-format', args.contentFormat]] : []),
      ['ts', String(Math.floor(createdAtMs))],
      ...(args.prev ? [['prev', args.prev]] : []),
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

const merged = new Set<(address: string) => void>()

/**
 * Hear a text save merged onto someone's newer one, by the project's address. The editor still holds the text as typed,
 * and only the merged one is the next save's base: the open page reads it again, so it is drawn even with no live
 * connection to bring it (ALO-6; Ship hands its editor the merged text the same way).
 */
export function onMerged(listener: (address: string) => void): () => void {
  merged.add(listener)
  return () => {
    merged.delete(listener)
  }
}

/** The fields a page writes: its title, its summary (plain text, never a `content-format`, SPEC §6.12) and its text. */
export type DocumentField = 'title' | 'summary' | 'description'

/** What a save answers: saved, refused with what to tell the person, or a text that asks (ALO-6). */
export type SaveResult = { ok: true } | { ok: false; reason: string; asks?: DocumentAsks }

/** The file a save is handed: where it is, and for a project read by its fields, what each change follows. */
type Writable = Pick<ForeignObject, 'address' | 'folder'> & Partial<Pick<ForeignObject, 'prevs' | 'eventId'>>

/**
 * One field of a project read by its fields, after the change it follows (SPEC §6.2), through interop's
 * `writeChange`, as Ship's `writeProjectField`: a field set again keeps the later without asking, a text merges onto
 * the newer one, and a block both changed asks with nothing saved. `prev` is the field's change as this tab last read
 * or wrote it, else the record's id for its first.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/merging-two-changes-to-one-text-never-loses-words.md
 */
async function writeInOrder(
  pubkey: string,
  file: Writable & { address: string; folder: string },
  field: string,
  value: string,
  prev: string,
  contentFormat?: string,
  base?: { value: string; format?: string },
): Promise<WriteChangeResult> {
  const [, owner, ...d] = file.address.split(':')
  const fields = await projectFields()
  try {
    const result = await writeChange({
      field,
      value,
      ...(contentFormat ? { format: contentFormat } : {}),
      prev,
      ...(base ? { base } : {}),
      build: (input) => buildChange(pubkey, input.createdAtMs, { target: file.address, field, value: input.value, folder: file.folder, contentFormat: input.format, prev: input.prev }),
      sign: changeWriter.sign,
      publish: changeWriter.publish,
      query,
      current: async (asked) =>
        (await openFile(query, { kind: PROJECT_KIND, pubkey: owner!, d: d.join(':') }, { text: asked === TEXT_FIELD && !!fields?.text }))?.fields[asked]?.event,
    })
    if (result.ok && field !== TEXT_FIELD) heldOf(file.address).prevs[field] = result.id
    return result
  } catch (error) {
    return { ok: false, refused: error instanceof Error ? error.message : String(error) }
  }
}

/** The change a field's next change follows: as this tab last read or wrote it, else as the file was read. */
function prevFor(file: Writable, field: string): string | undefined {
  const mine = file.address ? held.get(file.address)?.prevs[field] : undefined
  return mine ?? (file.eventId ? prevOf({ prevs: file.prevs, eventId: file.eventId }, field) : undefined)
}

/**
 * A project change written the old way, with no `prev`, that the relay refused because it has made the switch since
 * this tab read its NIP-11 (ALO-8): read NIP-11 again, so every later read and write in this tab is switched too, and
 * answer the change `field`'s next change follows — its current one, or the first record's. The caller writes the
 * change again, once, through its switched path; the person sees nothing. Undefined for any other refusal, or when
 * projects are still not switched: the refusal is shown as any is.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-its-fields-each-kept-in-order-by-the-relay.md
 */
async function prevAfterSwitch(address: string, field: string, refused: PublishResult): Promise<string | undefined> {
  if (refused.ok || !isProject(address) || !isSwitchRefusal(refused.reason)) return undefined
  readRelayAgain()
  if (!(await byFields(address))) return undefined
  const [, owner, ...d] = address.split(':')
  const prevs = await prevsAfterSwitch(query, { kind: PROJECT_KIND, pubkey: owner!, d: d.join(':') }, [field]).catch(() => undefined)
  return prevs?.[field]
}

/**
 * Save a document's title, summary or text. `ok: false` carries what to tell the person. `editedFrom` is the text the
 * person edited, for the text: a project's text refused at the switch is written again only onto it (ALO-8), so words
 * saved since it loaded are merged, never written over.
 */
export async function saveField(file: Writable, field: DocumentField, value: string, contentFormat?: string, editedFrom?: FileText): Promise<SaveResult> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to save.' }
  const { address, folder } = file
  if (!address || !folder) return { ok: false, reason: 'This cannot be saved from here.' }
  if (field !== TEXT_FIELD && (await byFields(address))) {
    const prev = prevFor(file, field)
    if (!prev) return { ok: false, reason: 'Could not save. Reload the page and try again.' }
    const result = await writeInOrder(pubkey, { ...file, address, folder }, field, value, prev)
    return answered(result)
  }
  const result: PublishResult = await publish(buildChange(pubkey, Date.now(), { target: address, field, value, folder, contentFormat }))
  if (result.ok) {
    for (const listener of saved) listener()
    return { ok: true }
  }
  const text = field === TEXT_FIELD
  const prev = !text || typeof editedFrom?.content === 'string' ? await prevAfterSwitch(address, field, result) : undefined
  if (prev) {
    const at = { ...file, address, folder }
    return text ? saveTextInOrder(pubkey, at, { content: value, format: contentFormat }, editedFrom!, prev) : answered(await writeInOrder(pubkey, at, field, value, prev))
  }
  // The relay's reason names kinds and rules: the console keeps it.
  console.warn('[relay] save refused', result)
  return { ok: false, reason: 'Could not save. Your text is still here.' }
}

/** A field written in order, as a save answers it; the relay's words go to the console. */
function answered(result: WriteChangeResult): SaveResult {
  if (result.ok) {
    for (const listener of saved) listener()
    return { ok: true }
  }
  console.warn('[relay] save refused', result)
  return { ok: false, reason: 'Could not save. Your text is still here.' }
}

/**
 * The text of a project read by its fields, saved after the change holding the text it was edited from (ALO-6). A
 * text that someone changed since is merged onto theirs; a block both changed asks with the kit's ask, nothing saved
 * (protocol's `textAsksOf`, Ship's). A text edited from one this tab never held is not saved: merging it would start
 * from the wrong base. `switched` is the text's current change when it is written again after the switch (ALO-8): this
 * tab holds no change for the text it loaded, so it follows the current one with the text it was edited from as the
 * merge's base, and words saved since are kept.
 */
async function saveTextInOrder(
  pubkey: string,
  file: Writable & { address: string; folder: string },
  text: FileText & { content: string },
  editedFrom: FileText,
  switched?: string,
): Promise<SaveResult> {
  const one = heldOf(file.address)
  const from = typeof editedFrom.content === 'string' ? editedFrom.content : undefined
  const prev = switched ?? (from === undefined ? undefined : one.texts.get(from))
  if (!prev) return { ok: false, reason: 'Someone changed it while you were editing. Copy your text, then reload.' }
  const base = { value: from ?? '', ...(editedFrom.format ? { format: editedFrom.format } : {}) }
  const result = await writeInOrder(pubkey, file, TEXT_FIELD, text.content, prev, text.format, switched ? base : undefined)
  if (result.ok) {
    // What the relay now holds: mine, or mine merged onto theirs — the text the editor is handed back next.
    const kept = 'event' in result ? textOf(result.event)?.value : textOf(result.mergedOnto)?.value
    one.texts.set(kept ?? text.content, result.id)
    if (result.mergedOnto) for (const listener of merged) listener(file.address)
  }
  if (result.ok || 'refused' in result) return answered(result)
  const theirs = textOf(result.theirs) ?? { value: '' }
  one.texts.set(theirs.value, result.theirs.id)
  const mine = { value: text.content, ...(text.format ? { format: text.format } : {}) }
  return { ok: false, reason: 'asks', asks: textAsksOf(base, theirs, mine, result.asks) }
}

/**
 * Delete a project, or restore it, where projects are kept in order (SPEC §6.5): a change setting `deleted` to `true`,
 * or to the empty value, after the one it follows — the change Ship's Delete and Restore declare. It keeps its id,
 * record and changes, so Restore brings it back whole.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-its-fields-each-kept-in-order-by-the-relay.md
 */
export async function setDeleted(file: Writable, deleted: boolean): Promise<SaveResult> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to restore it.' }
  const { address, folder } = file
  const prev = prevFor(file, 'deleted')
  if (!address || !folder || !prev || !(await byFields(address))) return { ok: false, reason: 'This can’t be restored from here.' }
  return answered(await writeInOrder(pubkey, { ...file, address, folder }, 'deleted', deleted ? 'true' : '', prev))
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
  file: Writable & Pick<ForeignObject, 'actions' | 'archived' | 'parentField'>,
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
  // A project read by its fields: after the change the choice's field follows; a crossing one is set again on top (ALO-6).
  if (await byFields(file.address)) {
    const prev = prevFor(file, action.field!)
    const result = prev ? await writeInOrder(pubkey, { ...file, address: file.address, folder: file.folder }, action.field!, value, prev) : { ok: false as const, refused: 'no change to follow' }
    if (result.ok) return { ok: true }
    console.warn('[relay] change refused', result)
    return { ok: false, reason: 'Could not change it.' }
  }
  const result = await publish(buildChange(pubkey, Date.now(), { target: file.address, field: action.field!, value, folder: file.folder }))
  if (result.ok) return { ok: true }
  // Refused because the relay switched since this tab read it: once more, in order (ALO-8).
  const prev = await prevAfterSwitch(file.address, action.field!, result)
  if (prev && (await writeInOrder(pubkey, { ...file, address: file.address, folder: file.folder }, action.field!, value, prev)).ok) return { ok: true }
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
  file: Writable,
  saved: FileText & { content: string },
  editedFrom: FileText,
  unadded: readonly string[] = [],
): Promise<{ ok: true; refused: string[] } | { ok: false; reason: string; asks?: DocumentAsks }> {
  const pubkey = viewerPubkey()
  const { address, folder } = file
  const result = pubkey && address && folder && (await byFields(address)) ? await saveTextInOrder(pubkey, { ...file, address, folder }, saved, editedFrom) : await saveField(file, 'description', saved.content, saved.format, editedFrom)
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
