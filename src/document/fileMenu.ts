import {
  archiveImpact,
  buildActionEvent,
  buildActionEvents,
  createPeopleCache,
  KIND_BARE_FILE,
  KIND_CHANNEL_METADATA,
  KIND_FOLDER_STATE,
  nestingOf,
  resolveFolderContents,
  type ForeignObject,
} from '@estiva-app/interop'
import { addressToPointer, KIND, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
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
    // A file that may sit only under one kind (a Ship issue's project) goes to the top rather than under another kind.
    const fits = plan.to?.address && (!child.parentKind || child.parentKind === plan.to.kind)
    const moved = await publish(
      buildChange(pubkey, now, { target: child.address, field: child.parentField ?? 'parent', value: fits ? plan.to!.address! : '', folder: child.folder }),
    )
    if (!moved.ok) {
      console.warn('[relay] move up refused', moved)
      unmoved++
    }
  }
  return { ok: true, stillListed, unmoved }
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
