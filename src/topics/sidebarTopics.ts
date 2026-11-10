import { byActivity, isArchived, resolveForeignRoots, type ForeignObject, type ReadTopic, type TopicsRead } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'
import { isDocument, isListed, titleOf } from '../folders/tree'
import { projections as manifests, resolveQuery } from '../relay/manifests'
import { archivedRootsOptions } from '../relay/projectFields'

/** The kinds a topic lists that Leaf opens: its pages, and Ship's projects and issues. */
const OPENS = new Set<number>([KIND.DOCUMENT, 30850, 30851])

/** One of your topics as the sidebar draws it: its title, and the files it lists that Leaf opens. */
export interface SidebarTopic {
  address: string
  title: string
  /** Pages, then projects, then issues; each A–Z. Empty when it lists nothing Leaf opens. */
  files: ForeignObject[]
}

const kindOf = (address: string) => Number(address.split(':')[0])

/** Pages first, then projects, then issues: Leaf's own files lead. */
const rank = (file: ForeignObject) => (isDocument(file) ? 0 : file.kind === 30850 ? 1 : 2)
export const byKindThenTitle = (a: ForeignObject, b: ForeignObject) => rank(a) - rank(b) || titleOf(a).localeCompare(titleOf(b))

/** A topic's title as Leaf draws it everywhere. */
export const topicTitleOf = (topic: ReadTopic) => topic.object.slots.title?.value?.trim() || 'Untitled topic'

/** This tab's own adds and removes since the read, by topic, then file address. */
export type ListedHere = ReadonlyMap<string, ReadonlyMap<string, boolean>>

/** The addresses a topic lists that Leaf opens, with this tab's own adds and removes over the read. */
export function listedThatLeafOpens(topic: ReadTopic, listedHere: ListedHere = new Map()): string[] {
  const here = listedHere.get(topic.address) ?? new Map<string, boolean>()
  const addresses = new Set(topic.listed.flatMap((l) => (l.address && here.get(l.address) !== false ? [l.address] : [])))
  for (const [address, listed] of here) if (listed) addresses.add(address)
  return [...addresses].filter((address) => OPENS.has(kindOf(address)))
}

/**
 * Listed files, read: the tree's copy when it holds one, the rest in one batched read. Archived ones are kept, for the
 * caller to leave out or put behind a link; a file nobody lists any more, or one not there, is `null`.
 */
export async function readListedFiles(addresses: readonly string[], inTree: (address: string) => ForeignObject | null): Promise<(address: string) => ForeignObject | null> {
  const outside = addresses.filter((address) => !inTree(address))
  const resolved = new Map<string, ForeignObject>()
  if (outside.length > 0)
    for (const file of await resolveForeignRoots(outside, resolveQuery, manifests, await archivedRootsOptions()))
      if (file.address && isListed(file)) resolved.set(file.address, file)
  return (address) => inTree(address) ?? resolved.get(address) ?? null
}

/** How many of your topics the sidebar shows; the rest are on Explore topics, under Your topics (Miky, 6 Nov). */
export const TOPICS_SHOWN = 5

/**
 * Whether a topic is yours, for the sidebar's five and Explore's Your topics alike, as Ship's `yourTopics`: you follow
 * it by the shared fold (interop's `following.in`: made, joined, added or a level chosen since your last leave; writing
 * in one is not following it), it is not a team's space, not archived, and you did not mute it (until the mute list is
 * read, nothing is taken out). Peek's column leaves out the same, so the apps' orders agree.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/writing-in-a-place-never-follows-it.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-space-is-the-teams-own-mark-on-a-topic-it-lists.md
 */
export function isYours(topic: ReadTopic, muted?: ReadonlySet<string>): boolean {
  return topic.yours && !topic.space && !isArchived(topic.object) && !muted?.has(topic.address)
}

/** The topics yours by {@link isYours}, by address: what the sidebar and Your topics order. */
export function yourTopics(read: TopicsRead, muted?: ReadonlySet<string>): string[] {
  return read.topics.filter((topic) => isYours(topic, muted)).map((topic) => topic.address)
}

/** The sidebar's five: your newest {@link TOPICS_SHOWN} by activity (interop's `byActivity`, the one rule every app orders by). */
export function fiveNewest(read: TopicsRead, at: ReadonlyMap<string, number>, muted?: ReadonlySet<string>): ReadTopic[] {
  const byAddress = new Map(read.topics.map((topic) => [topic.address, topic]))
  return yourTopics(read, muted)
    .sort(byActivity(at))
    .slice(0, TOPICS_SHOWN)
    .map((address) => byAddress.get(address)!)
}

/**
 * The sidebar's topics (LTN-2, TOPI-4), in the order given, each with the files it lists that Leaf opens and that are
 * not archived: pages, then projects, then issues, each A–Z. A topic listing nothing Leaf opens is still drawn, with no
 * files.
 *
 * A listed file the tree has read is taken from `inTree`, archived or not; the rest are resolved in one batched read,
 * and an archived one is left out either way.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-topic-keeps-its-own-list-of-files.md
 */
export async function readSidebarTopics(
  topics: readonly ReadTopic[],
  inTree: (address: string) => ForeignObject | null,
  /** This tab's own adds and removes since the read: they win over the read. */
  listedHere: ListedHere = new Map(),
): Promise<SidebarTopic[]> {
  const listedOf = (topic: ReadTopic) => listedThatLeafOpens(topic, listedHere)
  const fileAt = await readListedFiles([...new Set(topics.flatMap(listedOf))], inTree)
  return topics.map((topic) => ({
    address: topic.address,
    title: topicTitleOf(topic),
    files: listedOf(topic)
      .flatMap((address) => {
        const file = fileAt(address)
        return file && !isArchived(file) ? [file] : []
      })
      .sort(byKindThenTitle),
  }))
}
