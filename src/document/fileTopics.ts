import {
  addableTopics,
  folderOf,
  isArchived,
  listFolders,
  planListInTopic,
  planRemoveFromTopic,
  readTopics,
  resolveForeignRoots,
  topicsOfFile,
  type ForeignObject,
  type ReadTopic,
} from '@estiva-app/interop'
import { createRetryingRead } from '@estiva-app/platform'
import type { PublishResult } from '@estiva-app/protocol'
import { publish, queryAll, viewerPubkey } from '../relay/bridge'
import { projections as manifests, resolveQuery as query } from '../relay/manifests'

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
  const objects = await resolveForeignRoots([...roots.keys()], query, manifests, { archivedWith: true })
  return objects
    .flatMap((object) => {
      const root = object.address ? roots.get(object.address) : undefined
      const folder = root ? folderOf(root) : null
      return root && folder && !object.unreachable ? [asDrawn(object.address!, folder, object)] : []
    })
    .sort(byTitle)
}

/**
 * Add to topic's choices, held per tab as Ship holds them, so the palette opened again draws at once while it reads
 * again. Not retried on its own: the next open reads, and a failed read never replaces a good one.
 */
const held = createRetryingRead<TopicChoices>({ retryable: () => false })

/** Test seam: forget the held choices. */
export function resetTopicChoicesForTests(): void {
  held.clear()
}

/** Add to topic's choices as this tab last read them, for the palette to draw at once; `undefined` before the first read. */
export function topicChoicesNow(): TopicChoices | undefined {
  return held.snapshot().value
}

/**
 * What Add to topic offers (SHIPS-2), from interop's one read of every topic, as Ship's does: the open topics in a
 * Folder the relay lists for the reader — every one, not only the tree's top level, since that is where it accepts
 * their entry — theirs first, then the rest, each A–Z; none archived, by itself or with its project. Read afresh on
 * each open, so a topic made or archived since shows; the palette draws {@link topicChoicesNow} until this lands.
 */
export async function readTopicChoices(): Promise<TopicChoices> {
  const me = viewerPubkey()
  if (!me) throw new Error('Sign in to add it to a topic.')
  await held.reload(async () => {
    // Only the Folders' ids are used: their record channels are not placed (interop's listFolders, 149 s for the agent).
    const [read, folders] = await Promise.all([readTopics(queryAll, me, { cache: manifests }), listFolders(query, { recordChannels: false })])
    const { yours, others } = addableTopics(read, new Set(folders.map((folder) => folder.id)))
    const drawn = (topic: ReadTopic) => asDrawn(topic.address, topic.folder, topic.object)
    return { yours: yours.map(drawn), others: others.map(drawn) }
  })
  const { value, error } = held.snapshot()
  if (value) return value
  throw error ?? new Error('Topics could not be read.')
}

/** Put a file on a topic's list, or take it off: one `lists:<d>` entry on the topic, signed by the reader. */
export async function setListedInTopic(topic: Pick<TopicOfFile, 'address' | 'folder'>, file: string, listed: boolean): Promise<PublishResult> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to change its topics.' }
  const plan = listed ? planListInTopic : planRemoveFromTopic
  const [entry] = plan(pubkey, Date.now(), { topic: { address: topic.address, folder: topic.folder }, file })
  return publish(entry)
}
