import {
  createLoadQuery,
  createPeopleCache,
  listFolders,
  planPlaceFile,
  resolveFolderContents,
  resolveForeignObject,
  topLevelFolders,
  type FolderContents,
  type FolderSummary,
  type ForeignObject,
  type QueryFn,
} from '@estiva-app/interop'
import { buildDocument, encodeNaddr, KIND, type PublishResult } from '@estiva-app/protocol'
import { summaryText } from '../document/summary'
import { publish, viewerPubkey } from '../relay/bridge'
import { projections as manifests, resolveQuery as query } from '../relay/manifests'

/*
  Leaf's reads of the workspace: the same interop calls Peek's and Ship's trees
  make, so a Folder holds the same files in all three. The caches are the
  manifests and the names, which every Folder's read shares.
*/
const people = createPeopleCache()

/**
 * One load of the tree's reads: the listing and every Folder's contents read
 * each file's changes once between them (APP-2). Make one per load and drop
 * it, so a reload reads afresh.
 */
export function loadQuery(): QueryFn {
  return createLoadQuery(query)
}

/**
 * The Folders the tree shows: every Folder this person can read, as Peek's
 * Folders view does (Miky, LEAF-2's kickoff) — not only the ones they joined.
 */
export async function readFolders(read: QueryFn = query): Promise<FolderSummary[]> {
  return topLevelFolders(await listFolders(read))
}

/** Everything in one Folder, whichever app owns it. Throws when it could not be read. */
export function readFolder(id: string, read: QueryFn = query): Promise<FolderContents> {
  return resolveFolderContents(id, read, people.viaRelay(read), manifests)
}

/**
 * What another app's file lists under it — a project's issues — read when its
 * row opens, as Peek reads them. Empty when its app declares no list.
 */
export async function readChildren(naddr: string): Promise<ForeignObject[]> {
  const file = await resolveForeignObject(naddr, query, people.viaRelay(query), 0, manifests)
  return file?.children ?? []
}

/**
 * Whether New document may be offered in this Folder: one with relay-signed
 * state (SPEC §3.2). A group without it is a conversation space, not a Folder,
 * and an `add` against it would publish state listing nothing (peek#192).
 */
export function takesNewDocuments(folder: Pick<FolderSummary, 'hasState'>): boolean {
  return folder.hasState
}

export type NewDocument =
  | { ok: true; address: string; naddr: string }
  /** Nothing was made: the relay refused the document itself. */
  | { ok: false; made: false; reason: string }
  /** The document exists under the Folder's `h`, but the Folder does not list it yet: {@link listDocument} again. */
  | { ok: false; made: true; address: string; naddr: string; reason: string }

/**
 * New document — a `kind:30842` with the title, the Folder's own `h` and no
 * text, then the Folder's `kind:1852` `add` (SPEC §3.3), as the create action in
 * Leaf's manifest declares. A document is the file type Leaf owns, never a
 * Peek topic (Miky, 14 October), so this is not §3.2's built-in `create-file`,
 * which makes a bare file. Every later change to it is a `1851` carrying this
 * same `h`.
 *
 * The document goes first, so a refused `add` leaves one that exists and is
 * reachable by its address rather than a listing that points at nothing.
 *
 * Made under another file (`parent`, LFB-8), its root's `a` names that file and its `h` is that file's own
 * Folder, so the file's readers are its readers, whichever Folder lists it; the `add` still goes in `folder`,
 * where the file is listed, so it draws beneath it there.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/what-belongs-to-a-file-is-stored-with-it.md
 */
export async function createDocument(args: {
  folder: string
  title: string
  summary?: string
  parent?: { address: string; folder: string }
}): Promise<NewDocument> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, made: false, reason: 'Sign in to make a document.' }
  const fileId = crypto.randomUUID()
  const root = buildDocument(pubkey, Date.now(), {
    fileId,
    title: args.title,
    channelUuid: args.parent?.folder ?? args.folder,
    ...(args.parent ? { parent: args.parent.address } : {}),
  })
  // The summary seeds the page's `summary` field: last, as the reference writers put it, and only when there is one (SPEC §6.12).
  const summary = summaryText(args.summary ?? '')
  if (summary) root.tags.push(['summary', summary])
  const made = await publish(root)
  if (!made.ok) return { ok: false, made: false, reason: plainly(made, 'The document could not be made in that Folder. Try again.') }
  const address = `${KIND.DOCUMENT}:${pubkey}:${fileId}`
  const naddr = encodeNaddr({ kind: KIND.DOCUMENT, pubkey, identifier: fileId, relays: [] })
  const listed = await listDocument({ folder: args.folder, address })
  return listed.ok ? { ok: true, address, naddr } : { ok: false, made: true, address, naddr, reason: listed.reason }
}

/** Add a document that exists to its Folder's listing: the second half of {@link createDocument}, and its retry. */
export async function listDocument(args: { folder: string; address: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to add it to the Folder.' }
  for (const event of planPlaceFile(pubkey, Date.now(), { folder: args.folder, address: args.address, hasState: true })) {
    const result = await publish(event)
    if (!result.ok) return { ok: false, reason: plainly(result, 'The Folder did not take it. Try again.') }
  }
  return { ok: true }
}

/**
 * What a refused write says to a person. The relay's reason names kinds and
 * rules, so it goes to the console; one with no HTTP status is Leaf's own
 * sentence (`bridge.publish`: signing, or the workspace out of reach), already plain.
 */
function plainly(result: PublishResult, otherwise: string): string {
  if (result.httpStatus === undefined && result.reason) return result.reason
  console.warn('[relay] refused', result.reason ?? result.message)
  return otherwise
}
