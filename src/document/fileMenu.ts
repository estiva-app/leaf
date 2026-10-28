import {
  archiveImpact,
  buildActionEvent,
  buildActionEvents,
  createPeopleCache,
  KIND_BARE_FILE,
  KIND_CHANNEL_METADATA,
  KIND_FOLDER_STATE,
  listedBeneath,
  nestingOf,
  planMoveFromFolders,
  resolveFolderContents,
  type FolderRef,
  type FolderSummary,
  type ForeignObject,
} from '@estiva-app/interop'
import { addressToPointer, KIND, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { isListed, titleOf } from '../folders/tree'
import { manifestContent } from '../manifest'
import { publish, query, viewerPubkey } from '../relay/bridge'
import { projections as manifests } from '../relay/manifests'
import { buildChange } from './save'

/*
  A document's ⋯ menu (LED-4): its archive and its delete, written as Leaf's own
  manifest declares them (`src/manifest.ts`), and the move up of the pages under
  a deleted page. Built from Leaf's own declaration, never from a manifest read
  off the relay, where anyone may publish one claiming documents.
*/

const people = createPeopleCache()
// Leaf's own declaration, typed as interop reads it: `manifestContent` is the JSON Leaf publishes (manifest.test.ts checks interop takes it).
const OWN_MANIFEST = manifestContent() as unknown as Parameters<typeof buildActionEvents>[0]['manifest']

/** The file a menu acts on: one of Leaf's documents, read with its Folder. */
type Document = Pick<ForeignObject, 'address' | 'folder' | 'kind'>

/**
 * Archive a document, or bring it back: the manifest's `archive`, a `1851` on
 * `archived` in its own Folder — `'true'` archives, an empty value restores —
 * with the resolution as the change's content (FOL-46). The pages under it are
 * hidden with it by every reader and come back with it; nothing is written to them.
 */
export async function archiveDocument(file: Document, archived: boolean, resolution?: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to archive it.' }
  if (!file.address || !file.folder) return { ok: false, reason: 'This cannot be archived from here.' }
  const built = buildActionEvent({
    manifest: OWN_MANIFEST,
    kind: file.kind,
    address: file.address,
    objectAuthor: addressToPointer(file.address).pubkey,
    folder: file.folder,
    actionId: 'archive',
    value: archived ? 'true' : '',
    ...(archived && resolution ? { note: resolution } : {}),
    pubkey,
    createdAtMs: Date.now(),
  })
  if (typeof built === 'string') return { ok: false, reason: 'This cannot be archived from here.' }
  const result = await publish(built as UnsignedEvent)
  if (result.ok) return { ok: true }
  console.warn('[relay] archive refused', result)
  return { ok: false, reason: archived ? 'Nothing was archived. Try again.' : 'It was not unarchived. Try again.' }
}

/** What archiving a document would hide with it, in words: "2 pages and 1 topic". Throws when it cannot be read. */
export async function archiveHides(address: string): Promise<string> {
  const impact = await archiveImpact(address, query, { cache: manifests })
  return listOf(impact.hides.map(({ kind, count }) => countOf(kind, count)))
}

/** "1 page", "3 topics": what Leaf calls each kind that sits under a page. */
export function countOf(kind: number, count: number): string {
  const [one, many] = kind === KIND.DOCUMENT ? ['page', 'pages'] : kind === KIND_BARE_FILE ? ['topic', 'topics'] : ['file', 'files']
  return `${count} ${count === 1 ? one : many}`
}

function listOf(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/**
 * What a delete does to the pages under the document: each file directly under
 * it, in its Folder's whole listing (archived files included, since an archived
 * page's own pages are archived with it), and where they go — the document's
 * own parent, or the Folder's top when it has none (Miky, LED-4 kickoff).
 * Not Leaf's tree rows: a topic or another app's file under the page moves too.
 */
export interface DeletePlan {
  children: ForeignObject[]
  /** The deleted page's own parent, which its pages move under; absent for the Folder's top. */
  to?: ForeignObject
  /** The Folder's name, for "move up into <Folder>". */
  folderName?: string
}

/** The plan for deleting `file`, from one listing of its Folder. Pure: the listing is the only read. */
export function planDelete(file: Pick<ForeignObject, 'address'>, listing: readonly ForeignObject[], folderName?: string): DeletePlan {
  const nesting = nestingOf(listing)
  const here = listing.find((one) => one.address === file.address)
  if (!here) return { children: [], folderName }
  return { children: nesting.childrenOf(here), to: nesting.parentOf(here), folderName }
}

/** Read the document's Folder, archived files included, and plan its delete. Throws when it cannot be read. */
export async function readDeletePlan(file: Pick<ForeignObject, 'address' | 'folder'>): Promise<DeletePlan> {
  if (!file.folder) return { children: [] }
  const contents = await resolveFolderContents(file.folder, query, people.viaRelay(query), manifests, { includeArchived: true })
  return planDelete(file, contents.files, contents.name)
}

/** How a delete ended: refused before anything changed, or done, with what did not follow it. */
export type DeleteOutcome =
  | { ok: false; reason: string }
  | { ok: true; stillListed: boolean; unmoved: number }

/**
 * Delete a document (SPEC §6.5): the manifest's `delete` — the `kind:5`, then a
 * `1852 remove` from each Folder whose relay-signed state names it, read now —
 * published in order, stopping at the first refusal. Then each file directly
 * under it takes a `1851` on its own parent field naming the deleted page's
 * parent, or `''` for the Folder's top (any member may sign a change, §6.2),
 * in that file's own Folder. A refused one stays at the Folder's top, where
 * every reader draws a file whose parent is gone (§6.7); `unmoved` counts them.
 */
export async function deleteDocument(file: Document, plan: DeletePlan): Promise<DeleteOutcome> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to delete it.' }
  if (!file.address || !file.folder) return { ok: false, reason: 'This cannot be deleted from here.' }
  const author = addressToPointer(file.address).pubkey
  let listedIn
  try {
    const states = await relayStates({ kinds: [KIND_FOLDER_STATE], '#a': [file.address], limit: 500 })
    listedIn = states.map((state) => ({ id: dOf(state)!, hasState: true }))
  } catch {
    return { ok: false, reason: 'The Folder could not be read, so nothing was deleted. Try again.' }
  }
  const now = Date.now()
  const built = buildActionEvents({
    manifest: OWN_MANIFEST,
    kind: file.kind,
    address: file.address,
    objectAuthor: author,
    folder: file.folder,
    actionId: 'delete',
    value: '',
    pubkey,
    createdAtMs: now,
    listedIn,
  })
  if (typeof built === 'string') return { ok: false, reason: 'This cannot be deleted from here.' }
  const [deletion, ...removes] = built as UnsignedEvent[]
  const deleted = await publish(deletion)
  if (!deleted.ok) {
    console.warn('[relay] delete refused', deleted)
    // The relay takes a delete only from whoever wrote the file (Ship's words, IssuePage).
    return { ok: false, reason: pubkey === author ? 'Nothing was deleted. Try again.' : 'Delete rejected — only the person who wrote it can delete it.' }
  }
  let stillListed = false
  for (const remove of removes) {
    const result = await publish(remove)
    if (!result.ok) {
      console.warn('[relay] unlist refused', result)
      stillListed = true
      break
    }
  }
  let unmoved = 0
  for (const child of plan.children) {
    if (!child.address || !child.folder) {
      unmoved++
      continue
    }
    // A page or a topic nests by `parent` (§6.7), as Leaf's own manifest says; never a field named by a manifest read
    // off the relay, which anyone may publish. Any other kind under it stays at the top, where readers draw it.
    if (child.kind !== KIND.DOCUMENT && child.kind !== KIND_BARE_FILE) {
      unmoved++
      continue
    }
    const moved = await publish(buildChange(pubkey, now, { target: child.address, field: 'parent', value: plan.to?.address ?? '', folder: child.folder }))
    if (!moved.ok) {
      console.warn('[relay] move up refused', moved)
      unmoved++
    }
  }
  return { ok: true, stillListed, unmoved }
}

/** A Folder a document's Move reads or writes: the summary's own fields, with its name for the dialog's words. */
export type MoveFolder = FolderRef & { name: string }

const moveFolderOf = (folder: FolderSummary): MoveFolder => ({
  id: folder.id,
  name: folder.name ?? 'Untitled Folder',
  hasState: folder.hasState,
  ...(folder.private ? { private: true } : {}),
  addresses: folder.addresses ?? [],
})

/**
 * Where a document is now: every Folder whose state lists it (`listedIn`, read from the relay), the move's sources.
 * The listing, not its `h` — a move leaves the `h` where it was filed (SPEC §3.3), so after one move `file.folder`
 * names the Folder it left. Listed nowhere, it is in its own Folder, as that Folder's read says, so the planner
 * refuses a stateless one rather than skipping it. The first is the one the dialog opens its targets on.
 */
export function moveSourcesOf(file: Pick<ForeignObject, 'address' | 'folder'>, listedIn: readonly string[], folders: readonly FolderSummary[]): MoveFolder[] {
  const named = (id: string) => folders.find((folder) => folder.id === id)
  if (listedIn.length === 0) {
    const own = file.folder ? named(file.folder) : undefined
    return own ? [moveFolderOf(own)] : []
  }
  return listedIn.map((id) => {
    const folder = named(id)
    return { id, name: folder?.name ?? 'Untitled Folder', hasState: true, ...(folder?.private ? { private: true } : {}), addresses: file.address ? [file.address] : [] }
  })
}

/**
 * What Move opens on: where the document is, the files of the Folder it is in, live ones only, as the tree draws
 * them, and what moves with it, archived pages included, as the move sends them.
 */
export interface MovePlace {
  from: MoveFolder[]
  files: ForeignObject[]
  beneath: ForeignObject[]
}

/** Read where a document is now, from the relay's Folder states naming it, and that Folder's files. Throws when unread. */
export async function readMovePlace(file: Pick<ForeignObject, 'address' | 'folder' | 'ref'>, folders: readonly FolderSummary[]): Promise<MovePlace> {
  const states = file.address ? await relayStates({ kinds: [KIND_FOLDER_STATE], '#a': [file.address], limit: 500 }) : []
  const from = moveSourcesOf(file, states.map(dOf).filter((id): id is string => !!id), folders)
  if (from.length === 0) throw new Error('The Folder it is in is not one this page can see.')
  const all = await readMoveListing(from[0].id)
  const beneath = listedBeneath(all, all.find((one) => one.ref === file.ref) ?? (file as ForeignObject))
  return { from, files: all.filter((one) => !one.archived), beneath }
}

/**
 * The Folders Move offers: the one it is in, for a new place inside it, and every other the planner would take —
 * one with state, and a private one only when it is the document's own `h` (record: moving a file never changes who
 * can read it). Out of a Folder with no state it can go nowhere else, so only that one is offered. Only moves that
 * can succeed are offered; one the relay still refuses says why in the dialog.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/moving-a-file-never-changes-who-can-read-it.md
 */
export function moveFoldersFor(file: Pick<ForeignObject, 'folder'>, from: Pick<MoveFolder, 'id' | 'hasState'> | undefined, folders: readonly FolderSummary[]): MoveFolder[] {
  const stuck = !!from && !from.hasState
  return folders.filter((folder) => folder.id === from?.id || (!stuck && folder.hasState && (!folder.private || folder.id === file.folder))).map(moveFolderOf)
}

/** One place in a Folder a document may be put under: `address` empty for the Folder's top. */
export interface MoveTarget {
  address: string
  /** The target's titles, outermost first; empty for the top. */
  path: string[]
}

/**
 * Where a document may go in a Folder whose listing is `files`: the top, then anything Leaf's tree draws there —
 * pages, a Ship project or issue — by its path (Miky, LED-5 kickoff). Never the document or what is under it, and in
 * the Folder it is in, never where it already is, so every row is a move that does something.
 */
export function moveTargetsIn(files: readonly ForeignObject[], file: ForeignObject, { sameFolder }: { sameFolder: boolean }): MoveTarget[] {
  // The tree's own rows, nested as the tree nests them, so a target's path is what the sidebar shows.
  const drawn = files.filter(isListed)
  const nesting = nestingOf(drawn)
  const here = drawn.find((candidate) => candidate.ref === file.ref) ?? file
  const targets = nesting.moveTargetsOf(here)
  const under = targets
    .filter((target): target is ForeignObject => !!target?.address)
    .map((target) => ({ address: target.address!, path: [...nesting.ancestorsOf(target), target].map(titleOf) }))
  const top = !sameFolder || targets.includes(undefined)
  return top ? [{ address: '', path: [] }, ...under] : under
}

/** How a move ended: refused before anything changed, or done, with the part that did not follow. */
export type MoveOutcome =
  | { ok: false; reason: string }
  | {
      ok: true
      /** The Folders that still list it too: their remove was refused after the add landed. */
      stillIn: MoveFolder[]
      /** Why it did not take its new place, when the Folder change landed and that did not. */
      unplaced?: string
    }

/** A source's files, archived ones included, so an archived page under the document moves with it. Throws when unread. */
async function readMoveListing(id: string): Promise<ForeignObject[]> {
  return (await resolveFolderContents(id, query, people.viaRelay(query), manifests, { includeArchived: true })).files
}

/**
 * Move a document to `to`, under `parent` (an address, `''` for the top), as Peek moves a topic (FOL-45): first its
 * listing — one `1852 add` in the target naming it and everything listed under it, then a `remove` in each source,
 * planned by interop's `planMoveFromFolders` (SPEC §3.3) — then its place, the manifest's `move`, a `1851` on
 * `parent`. Each source is read again here, at the move. `parent` absent leaves it where it is in the new Folder.
 */
export async function moveDocument(
  file: Document & Pick<ForeignObject, 'ref' | 'parentRef' | 'scopedTo'>,
  move: { from: readonly MoveFolder[]; to: MoveFolder; parent?: string },
  read: (id: string) => Promise<ForeignObject[]> = readMoveListing,
): Promise<MoveOutcome> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to move it.' }
  if (!file.address || !file.folder) return { ok: false, reason: 'This cannot be moved from here.' }
  const sources = move.from.filter((folder) => folder.id !== move.to.id)
  let moved = false
  const stillIn: MoveFolder[] = []
  if (sources.length > 0) {
    let listings
    try {
      listings = new Map(await Promise.all(sources.map(async (folder) => [folder.id, await read(folder.id)] as const)))
    } catch {
      return { ok: false, reason: 'The Folder it is in could not be read, so nothing was moved. Try again.' }
    }
    const plan = planMoveFromFolders(pubkey, Date.now(), { file, from: sources, to: move.to, listings })
    if (!plan.ok) return { ok: false, reason: refusalWords[plan.reason] }
    if (plan.add) {
      const added = await publish(plan.add)
      if (!added.ok) {
        console.warn('[relay] move refused', added)
        // Estiva ID's and the relay's own words, as Peek says them: a lapsed sign-in is not something to retry.
        return { ok: false, reason: added.reason ?? 'Nothing was moved. Try again.' }
      }
      moved = true
    }
    // It did arrive, so a Folder that refused to let it go is named, and the move goes on to its place (Peek's order).
    for (const { folder, event } of plan.removes) {
      const removed = await publish(event)
      if (!removed.ok) {
        console.warn('[relay] unlist refused', removed)
        stillIn.push(sources.find((source) => source.id === folder) ?? { id: folder, name: 'another Folder', hasState: true })
      }
    }
  }
  if (move.parent === undefined || move.parent === (file.parentRef ?? '')) return { ok: true, stillIn }
  const built = buildActionEvent({
    manifest: OWN_MANIFEST,
    kind: file.kind,
    address: file.address,
    objectAuthor: addressToPointer(file.address).pubkey,
    folder: file.folder,
    actionId: 'move',
    value: move.parent,
    pubkey,
    createdAtMs: Date.now(),
  })
  if (typeof built === 'string') console.warn('[leaf] move under not built', built)
  const placed = typeof built === 'string' ? null : await publish(built as UnsignedEvent)
  if (placed?.ok) return { ok: true, stillIn }
  if (placed) console.warn('[relay] move under refused', placed)
  return moved ? { ok: true, stillIn, unplaced: 'it is not in its new place yet' } : { ok: false, reason: placed?.reason ?? 'Nothing was moved. Try again.' }
}

/** The planner's refusals in Peek's words (`moveFileAsViewer`). */
const refusalWords: Record<'source-has-no-state' | 'target-has-no-state' | 'target-is-private', string> = {
  'source-has-no-state': 'Files can’t be moved out of this Folder yet: it has no list of its own, so moving one would hide the rest.',
  'target-has-no-state': 'That Folder has no list of its own yet, so moving a file into it would hide what is already there.',
  'target-is-private': 'Can’t move this into a private Folder: it would stay readable by everyone who can read it now.',
}

/**
 * The relay's own Folder states matching `filter`: a `kind:30890` counts only
 * when the key that signed its Folder's channel record signed it too, so one
 * from anyone else cannot make a stateless Folder look stateful (Peek's
 * `relayStates`). One per Folder.
 */
async function relayStates(filter: Record<string, unknown>): Promise<SignedEvent[]> {
  const states = await query([filter])
  const ids = [...new Set(states.map(dOf).filter((id): id is string => !!id))]
  if (ids.length === 0) return []
  const channels = await query([{ kinds: [KIND_CHANNEL_METADATA], '#d': ids, limit: ids.length * 2 }])
  const signers = new Set(channels.map((channel) => `${dOf(channel)}:${channel.pubkey}`))
  const kept = states.filter((state) => signers.has(`${dOf(state)}:${state.pubkey}`))
  return [...new Map(kept.map((state) => [dOf(state)!, state])).values()]
}

function dOf(event: { tags: string[][] }): string | undefined {
  return event.tags.find((tag) => tag[0] === 'd')?.[1]
}
