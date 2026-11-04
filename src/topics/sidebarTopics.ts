import { isArchived, resolveForeignRoots, type ForeignObject, type ReadTopic, type TopicsRead } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'
import { isDocument, isListed, titleOf } from '../folders/tree'
import { timeOf } from '../home/recent'
import { query } from '../relay/bridge'
import { projections as manifests, resolveQuery } from '../relay/manifests'

/** The kinds a topic lists that Leaf opens: its pages, and Ship's projects and issues. */
const OPENS = new Set<number>([KIND.DOCUMENT, 30850, 30851])

/** One of your topics as the sidebar draws it: its title, and the files it lists that Leaf opens. */
export interface SidebarTopic {
  address: string
  title: string
  /** Pages, then projects, then issues; each A–Z. Never empty. */
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
    for (const file of await resolveForeignRoots(outside, resolveQuery, manifests, { archivedWith: true }))
      if (file.address && isListed(file)) resolved.set(file.address, file)
  return (address) => inTree(address) ?? resolved.get(address) ?? null
}

/**
 * Your topics for Leaf's sidebar (LTN-2): those that are yours, not a team's space and not archived, listing at least
 * one file Leaf opens that is not archived. Ordered by your newest save or comment on one of their listed files,
 * newest first; topics with none of yours follow, A–Z. Every one is returned: the sidebar shows five and a More.
 *
 * A listed file the tree has read is taken from `inTree`, archived or not; the rest are resolved in one batched read,
 * and an archived one is left out either way. Your times are one request: the newest save and the newest comment of
 * yours on each listed file.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-topic-keeps-its-own-list-of-files.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-space-is-the-teams-own-mark-on-a-topic-it-lists.md
 */
export async function readSidebarTopics(
  read: TopicsRead,
  inTree: (address: string) => ForeignObject | null,
  /** This tab's own adds and removes since the read: they win over the read. */
  listedHere: ListedHere = new Map(),
): Promise<SidebarTopic[]> {
  const candidates = read.topics.filter((topic) => topic.yours && !topic.space && !isArchived(topic.object))
  const listedOf = (topic: ReadTopic) => listedThatLeafOpens(topic, listedHere)
  const fileAt = await readListedFiles([...new Set(candidates.flatMap(listedOf))], inTree)

  const topics = candidates.flatMap((topic): SidebarTopic[] => {
    const files = listedOf(topic)
      .flatMap((address) => {
        const file = fileAt(address)
        return file && !isArchived(file) ? [file] : []
      })
      .sort(byKindThenTitle)
    return files.length ? [{ address: topic.address, title: topicTitleOf(topic), files }] : []
  })
  if (topics.length === 0) return []

  const shown = new Set(topics.flatMap((topic) => topic.files.map((file) => file.address!)))
  // The order is a nicety: when its read fails, the topics still show, A–Z.
  const events = await query(
    [...shown].flatMap((file) => [
      { kinds: [1851], authors: [read.me], '#a': [file], limit: 1 },
      { kinds: [1111], authors: [read.me], '#A': [file], limit: 1 },
    ]),
  ).catch(() => [])
  const last = new Map<string, number>()
  for (const event of events) {
    if (event.pubkey !== read.me) continue
    const at = timeOf(event)
    for (const [name, address] of event.tags)
      if ((name === 'a' || name === 'A') && shown.has(address)) last.set(address, Math.max(last.get(address) ?? 0, at))
  }
  const timeOfTopic = (topic: SidebarTopic) => Math.max(0, ...topic.files.map((file) => last.get(file.address!) ?? 0))
  const at = new Map(topics.map((topic) => [topic.address, timeOfTopic(topic)]))
  return topics.sort((a, b) => at.get(b.address)! - at.get(a.address)! || a.title.localeCompare(b.title))
}
