import { folderOf, isArchived, planListInTopic, planRemoveFromTopic, resolveForeignRoots, topicsOfFile, type ForeignObject } from '@estiva-app/interop'
import { membersOf } from '@estiva-app/conversation'
import { KIND, type PublishResult, type SignedEvent } from '@estiva-app/protocol'
import { publish, queryAll, viewerPubkey } from '../relay/bridge'
import { projections as manifests, resolveQuery as query } from '../relay/manifests'
import { CHANGE } from './save'

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

const KIND_TOPIC = 30840

/** Add to topic's choices: the topics you are a member of, then the rest. */
export interface TopicChoices {
  yours: TopicOfFile[]
  others: TopicOfFile[]
}

function topicsAsDrawn(roots: ReadonlyMap<string, SignedEvent>, objects: readonly ForeignObject[]): TopicOfFile[] {
  return objects.flatMap((object) => {
    const root = object.address ? roots.get(object.address) : undefined
    const folder = root ? folderOf(root) : null
    if (!root || !folder || object.unreachable) return []
    // https only: the link comes from a manifest anyone may publish until WOR-2.
    const openUrl = object.openUrl && /^https:\/\//i.test(object.openUrl) ? object.openUrl : undefined
    return [{ address: object.address!, folder, title: object.slots.title?.value || 'Untitled topic', openUrl, archived: isArchived(object) }]
  })
}

const byTitle = (a: TopicOfFile, b: TopicOfFile) => a.title.localeCompare(b.title)

/**
 * The topics whose list names this file (TOP-6, SPEC §6.14), read as Ship reads them (ship#359): `#o` on its id, the
 * newest entry per topic, only topics the reader can read, each with its current title and archive. A–Z.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-topic-keeps-its-own-list-of-files.md
 */
export async function readFileTopics(file: string): Promise<TopicOfFile[]> {
  const listing = await topicsOfFile(query, file)
  if (listing.length === 0) return []
  const roots = new Map(listing.map((topic) => [topic.address, topic.root]))
  const objects = await resolveForeignRoots([...roots.keys()], query, manifests)
  return topicsAsDrawn(roots, objects).sort(byTitle)
}

/**
 * What Add to topic offers: every topic the reader can read and that is not archived, split as Peek's Topics screen
 * splits them — the ones they are a member of, then the rest — each A–Z. Membership is folded as a file's page folds
 * it (SPEC §11.8), the topic's author counting from its root.
 */
export async function readTopicChoices(): Promise<TopicChoices> {
  const roots = new Map<string, SignedEvent>()
  for (const root of await queryAll([{ kinds: [KIND_TOPIC] }])) {
    const address = `${root.kind}:${root.pubkey}:${root.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`
    const held = roots.get(address)
    // Two versions of one record: the later created_at, then the lower id (§6.3).
    if (!held || root.created_at > held.created_at || (root.created_at === held.created_at && root.id < held.id)) roots.set(address, root)
  }
  if (roots.size === 0) return { yours: [], others: [] }
  const addresses = [...roots.keys()]
  const me = viewerPubkey()
  const [objects, events] = await Promise.all([
    resolveForeignRoots(addresses, query, manifests),
    me
      ? queryAll([
          { kinds: [CHANGE], '#a': addresses, '#p': [me] },
          { kinds: [KIND.COMMENT], '#A': addresses, authors: [me] },
          { kinds: [KIND.COMMENT], '#a': addresses, authors: [me] },
          { kinds: [KIND.COMMENT], '#A': addresses, '#p': [me] },
          { kinds: [KIND.COMMENT], '#a': addresses, '#p': [me] },
        ])
      : Promise.resolve([]),
  ])
  const unique = [...new Map(events.map((e) => [e.id, e])).values()]
  const mine = (topic: TopicOfFile) => !!me && membersOf(topic.address, [roots.get(topic.address)!, ...unique]).has(me)
  const open = topicsAsDrawn(roots, objects)
    .filter((topic) => !topic.archived)
    .sort(byTitle)
  return { yours: open.filter(mine), others: open.filter((topic) => !mine(topic)) }
}

/** Put a file on a topic's list, or take it off: one `lists:<d>` entry on the topic, signed by the reader. */
export async function setListedInTopic(topic: Pick<TopicOfFile, 'address' | 'folder'>, file: string, listed: boolean): Promise<PublishResult> {
  const pubkey = viewerPubkey()
  if (!pubkey) return { ok: false, reason: 'Sign in to change its topics.' }
  const plan = listed ? planListInTopic : planRemoveFromTopic
  const [entry] = plan(pubkey, Date.now(), { topic: { address: topic.address, folder: topic.folder }, file })
  return publish(entry)
}
