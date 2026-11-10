import { byActivity, isArchived, type TopicsRead } from '@estiva-app/interop'
import { isYours, topicTitleOf } from './sidebarTopics'
import { topicPath } from './topicLinks'

/** One row on Explore topics (TOPI-4), as Ship's `TopicRowData`: the same columns in every app. */
export interface TopicRowData {
  address: string
  title: string
  /** The line under its name; absent, nothing is drawn there. */
  summary?: string
  /** Its page here (LTN-3). */
  href: string
  /** Its team's name; absent until the teams are read. */
  team?: string
  /** How many people it lists (record a-place-lists-who-chose-a-level-and-its-teams-members); `undefined` until read. */
  members?: number
  /** When anything last happened in it, Unix seconds (the shared rule, TOPI-10); `undefined` until read. */
  active?: number
  archived: boolean
  /** You are in it: no Join on it. */
  yours: boolean
}

export type TopicsTab = 'all' | 'yours' | 'others' | 'archived'

/** What the rows draw beside the topics read: each read on its own, `undefined` until it lands. */
export interface TopicFacts {
  /** Each topic's newest activity (interop's `readTopicActivity`). */
  at?: ReadonlyMap<string, number>
  /** `undefined` for a topic whose people could not be judged. */
  members?: ReadonlyMap<string, number | undefined>
  /** A team's name, by its id. */
  teamName?: (id: string) => string | undefined
}

const byTitle = (a: TopicRowData, b: TopicRowData) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })

/** A topic is found by the start of a word of its title, as search is everywhere (Miky, 19 Oct). */
export function findsTopic(title: string, query: string): boolean {
  // Split as the title is, so "q4-pl" finds "Q4-plan".
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const titleWords = title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return words.every((word) => titleWords.some((titleWord) => titleWord.startsWith(word)))
}

/**
 * Which topics Explore topics draws on each tab, as Ship's `topicsByTab`: every topic you can open, also those listing
 * nothing Leaf opens, never a space (conversation is Peek's). It is under Archived when it is archived, and only then.
 * Your topics come newest activity first, the order of the sidebar's five (`byActivity`); All, Other topics and
 * Archived A to Z. Your topics' order needs `facts.at`; without it they are A to Z too.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-space-is-the-teams-own-mark-on-a-topic-it-lists.md
 */
export function topicsByTab(read: TopicsRead, facts: TopicFacts = {}, muted?: ReadonlySet<string>): Record<TopicsTab, TopicRowData[]> {
  const lists: Record<TopicsTab, TopicRowData[]> = { all: [], yours: [], others: [], archived: [] }
  for (const topic of read.topics) {
    if (topic.space) continue
    const title = topicTitleOf(topic)
    const archived = isArchived(topic.object)
    const team = facts.teamName?.(topic.folder)
    const members = facts.members?.get(topic.address)
    const active = facts.at?.get(topic.address)
    const summary = topic.object.slots.subtitle?.value?.trim()
    const row: TopicRowData = {
      address: topic.address,
      title,
      // A file's summary is its subtitle slot, built in for every kind (SPEC §6.12).
      ...(summary ? { summary } : {}),
      href: topicPath(topic.address, title),
      ...(team ? { team } : {}),
      ...(members !== undefined ? { members } : {}),
      ...(active ? { active } : {}),
      archived,
      yours: topic.yours && !muted?.has(topic.address),
    }
    if (archived) {
      lists.archived.push(row)
      continue
    }
    lists.all.push(row)
    lists[isYours(topic, muted) ? 'yours' : 'others'].push(row)
  }
  for (const list of Object.values(lists)) list.sort(byTitle)
  if (facts.at) {
    const newest = byActivity(facts.at)
    lists.yours.sort((a, b) => newest(a.address, b.address))
  }
  return lists
}
