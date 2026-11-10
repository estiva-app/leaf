import {
  addableTopics,
  folderOf,
  isArchived,
  listFolders,
  planListInTopic,
  planRemoveFromTopic,
  readTopics,
  readYourTopics,
  resolveForeignRoots,
  topicsOfFile,
  type ForeignObject,
  type ReadTopic,
  type TopicsRead,
  type YourTopicsRead,
} from '@estiva-app/interop'
import { createRetryingRead } from '@estiva-app/platform'
import type { PublishResult } from '@estiva-app/protocol'
import { nip44 } from '../auth/nip44'
import { publish, query as relayQuery, queryAll, viewerPubkey } from '../relay/bridge'
import { projections as manifests, resolveQuery as query } from '../relay/manifests'
import { archivedRootsOptions, listReadOffered } from '../relay/projectFields'

/** A topic that lists a file, as the file's Topics row draws it. */
export interface TopicOfFile {
  /** Its address, `30840:<pubkey>:<d>`. */
  address: string
  /** Its Folder, read from its root (§6.2): where an entry about it is filed. */
  folder: string
  title: string
  /** Where it opens: Peek, as its manifest says; a web address only. */
  openUrl?: string
  /** Archived: read-only in every app, so no Add and no Remove on it. */
  archived: boolean
}

/** Add to topic's choices: the topics you are a member of, then the rest. */
export interface TopicChoices {
  yours: TopicOfFile[]
  others: TopicOfFile[]
}

function asDrawn(address: string, folder: string, object: ForeignObject): TopicOfFile {
  // https only: the link comes from a manifest anyone may publish until WOR-2.
  const openUrl = object.openUrl && /^https:\/\//i.test(object.openUrl) ? object.openUrl : undefined
  return { address, folder, title: object.slots.title?.value || 'Untitled topic', openUrl, archived: isArchived(object) }
}

const byTitle = (a: TopicOfFile, b: TopicOfFile) => a.title.localeCompare(b.title)

/**
 * The topics whose list names this file (TOP-6, SPEC §6.14), read as Ship reads them (ship#359): `#o` on its id, the
 * newest entry per topic, only topics the reader can read, each with its current title and archive — its own, or with
 * its project (SHIPS-2). A–Z.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-topic-keeps-its-own-list-of-files.md
 */
export async function readFileTopics(file: string): Promise<TopicOfFile[]> {
  const listing = await topicsOfFile(query, file)
  if (listing.length === 0) return []
  const roots = new Map(listing.map((topic) => [topic.address, topic.root]))
  const objects = await resolveForeignRoots([...roots.keys()], query, manifests, await archivedRootsOptions())
  return objects
    .flatMap((object) => {
      const root = object.address ? roots.get(object.address) : undefined
      const folder = root ? folderOf(root) : null
      return root && folder && !object.unreachable ? [asDrawn(object.address!, folder, object)] : []
    })
    .sort(byTitle)
}

/**
 * Interop's one read of every topic the reader can read (SHIPS-2), held per tab as Ship holds it: the sidebar's Topics
 * and Add to topic draw from the same read, so a palette opened again draws at once while it reads again. Not retried
 * on its own: the next open reads, and a failed read never replaces a good one.
 */
export const heldTopics = createRetryingRead<TopicsRead>({ retryable: () => false })

/** The Folders the relay listed for the reader at Add to topic's last read: where it accepts their entry. */
let addableIn: ReadonlySet<string> | undefined

/**
 * This tab's own Add to topic and Remove since it loaded, by topic, then file address: the sidebar draws them over the
 * held read at once, without reading every topic again (LTN-2). Replaced, never changed, so a snapshot stays as it was.
 */
let listedHere: ReadonlyMap<string, ReadonlyMap<string, boolean>> = new Map()
const listedListeners = new Set<() => void>()

/** {@link listedHere}, for `useSyncExternalStore`. */
export const listedInTab = {
  snapshot: () => listedHere,
  subscribe(listener: () => void) {
    listedListeners.add(listener)
    return () => void listedListeners.delete(listener)
  },
}

/**
 * Only your topics, newest activity first, with your mute list (ALO-20, Ship's ALO-17): interop's lean read, what the
 * sidebar draws its five from on every page, unless you joined or left a topic since it was read. Your spaces come with
 * it, marked, so a link to one you are in goes to Peek from any page; the sidebar leaves them out itself.
 */
export const heldYourTopics = createRetryingRead<YourTopicsRead>({ retryable: () => false })

/** The mute list last opened, so an unchanged one costs no `/nip44/decrypt` on the next read; a failure is not kept. */
let opened: { ciphertext: string; plaintext: string } | undefined

async function decryptOnce(ciphertext: string): Promise<string | undefined> {
  if (opened?.ciphertext === ciphertext) return opened.plaintext
  try {
    const plaintext = await nip44.decrypt(ciphertext)
    opened = { ciphertext, plaintext }
    return plaintext
  } catch {
    // Estiva ID refused or was busy (a 429): nothing is left out as muted, as before.
    return undefined
  }
}

/**
 * Your topics, read once more: one request a call, never paged by `queryAll`, which would ask each filter for a thousand
 * events and keep interop's rounds from ending on a short page. Throws, saying why, when nobody is signed in.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
export async function loadYourTopics(): Promise<YourTopicsRead> {
  const me = viewerPubkey()
  if (!me) throw new Error('Sign in to read your topics.')
  const listRead = await listReadOffered()
  return readYourTopics(relayQuery, me, { cache: manifests, decrypt: decryptOnce, spaces: true, ...(listRead ? { listRead } : {}) })
}

/** Test seam: forget the held topics, yours and every one. */
export function resetTopicChoicesForTests(): void {
  heldTopics.clear()
  heldYourTopics.clear()
  opened = undefined
  addableIn = undefined
  listedHere = new Map()
}

/**
 * Every topic the reader can read, read once more; throws, saying why, when nobody is signed in. Where the relay
 * offers the list read, the project each topic sits under costs its current values, not every change (ALO-15).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
export async function loadTopics(): Promise<TopicsRead> {
  const me = viewerPubkey()
  if (!me) throw new Error('Sign in to read your topics.')
  return readTopics(queryAll, me, { cache: manifests, parentsListRead: await listReadOffered() })
}

function choicesOf(read: TopicsRead, folders: ReadonlySet<string>): TopicChoices {
  const { yours, others } = addableTopics(read, folders)
  const drawn = (topic: ReadTopic) => asDrawn(topic.address, topic.folder, topic.object)
  return { yours: yours.map(drawn), others: others.map(drawn) }
}

/** Add to topic's choices as this tab last read them, for the palette to draw at once; `undefined` before its first read. */
export function topicChoicesNow(): TopicChoices | undefined {
  const read = heldTopics.snapshot().value
  return read && addableIn ? choicesOf(read, addableIn) : undefined
}

/**
 * What Add to topic offers (SHIPS-2), from interop's one read of every topic, as Ship's does: the open topics in a
 * Folder the relay lists for the reader — every one, not only the tree's top level, since that is where it accepts
 * their entry — theirs first, then the rest, each A–Z; none archived, by itself or with its project. Read afresh on
 * each open, so a topic made or archived since shows; the palette draws {@link topicChoicesNow} until this lands.
 */
export async function readTopicChoices(): Promise<TopicChoices> {
  if (!viewerPubkey()) throw new Error('Sign in to add it to a topic.')
  // Only the Folders' ids are used: their record channels are not placed (interop's listFolders, 149 s for the agent).
  let foldersError: unknown
  const [, folders] = await Promise.all([
    heldTopics.reload(loadTopics),
    listFolders(query, { recordChannels: false }).catch((error: unknown) => {
      foldersError = error
      return null
    }),
  ])
  const { value, error } = heldTopics.snapshot()
  if (folders) addableIn = new Set(folders.map((folder) => folder.id))
  if (value && addableIn) return choicesOf(value, addableIn)
  throw error ?? foldersError ?? new Error('Topics could not be read.')
}

/** Put a file on a topic's list, or take it off: one `lists:<d>` entry on the topic, signed by the reader. */
export async function setListedInTopic(topic: Pick<TopicOfFile, 'address' | 'folder'>, file: string, listed: boolean): Promise<PublishResult> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to change its topics.' }
  const plan = listed ? planListInTopic : planRemoveFromTopic
  const [entry] = plan(pubkey, Date.now(), { topic: { address: topic.address, folder: topic.folder }, file })
  const result = await publish(entry)
  if (result.ok) {
    listedHere = new Map(listedHere).set(topic.address, new Map(listedHere.get(topic.address)).set(file, listed))
    for (const listener of listedListeners) listener()
  }
  return result
}
