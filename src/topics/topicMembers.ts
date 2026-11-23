import { placeFilters, placeListing, type Listed } from '@estiva-app/conversation'
import type { ReadTopic } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { useCallback, useEffect, useState } from 'react'
import { queryAll, viewerPubkey } from '../relay/bridge'

const KIND_ROSTER = 39002
const ROSTER_COMMANDS: readonly number[] = [9000, 9001, 9021, 9022, 9007]
const KIND_FOLDER_STATE = 30890
const KIND_FOLDER_COMMAND = 1852
/** The viewer's private teams list, which `placeFilters` asks for too. */
const KIND_APP_DATA = 30078

type Filter = Record<string, unknown>

/**
 * Filters asking the same kinds by the same tags, as one: each tag's values together. It asks for more than each alone
 * (an author with another's `d`), so every topic takes back only what its own filters answer.
 */
function mergedFilters(filters: readonly Filter[]): Filter[] {
  const groups = new Map<string, Filter>()
  for (const filter of filters) {
    const shape = JSON.stringify([filter.kinds, Object.keys(filter).sort()])
    const into = groups.get(shape)
    if (!into) {
      groups.set(shape, { ...filter })
      continue
    }
    for (const [key, value] of Object.entries(filter)) {
      if (key !== 'kinds' && Array.isArray(value)) into[key] = [...new Set([...(into[key] as unknown[]), ...value])]
    }
  }
  return [...groups.values()]
}

/** Whether an event answers a filter by its kinds, authors and `#x` tags, as NIP-01 reads them: the only parts `placeFilters` uses. */
function answersFilter(event: SignedEvent, filter: Filter): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const wanted = value as unknown[]
    if (key === 'kinds') return wanted.includes(event.kind)
    if (key === 'authors') return wanted.includes(event.pubkey)
    if (key.startsWith('#')) return event.tags.some((tag) => tag[0] === key.slice(1) && wanted.includes(tag[1]))
    return true
  })
}

/**
 * Who each initiative lists, by key, in the listing's order, for Explore initiatives' Members (TOPI-4, as Ship's
 * `readTopicMembers`): conversation's `placeListing`, the rule Peek's people list draws — who chose a level, was added or
 * made it, and its team's members. The keys, not only the count, so the members pill draws up to three faces beside the
 * number, as Peek's `topicMembersAsViewer` does (Katerina, 17 November: "the members and their avatars is known already").
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-place-lists-who-chose-a-level-and-its-teams-members.md
 *
 * One paged read for every topic asked: each topic's `placeFilters` without the viewer's private teams list (a topic's
 * listing never needs it), merged by shape. A failed read rejects: a failed read is not "nobody".
 */
export async function readTopicMembers(topics: readonly ReadTopic[]): Promise<Map<string, string[] | undefined>> {
  if (topics.length === 0) return new Map()
  const me = viewerPubkey()
  if (!me) throw new Error('Sign in to read who is in an initiative.')
  const asked = topics.map((topic) => {
    const place = { address: topic.address, team: topic.folder }
    try {
      const filters = (placeFilters(place, me) as Filter[]).filter((filter) => !(filter.kinds as number[]).includes(KIND_APP_DATA))
      return { topic, place, filters }
    } catch {
      // A topic whose team is no team id cannot be read for its people: it draws no count, and the others still do.
      return { topic, place, filters: undefined }
    }
  })
  const events = await queryAll(mergedFilters(asked.flatMap(({ filters }) => filters ?? [])))
  return new Map(
    asked.map(({ topic, place, filters }): [string, string[] | undefined] => {
      if (!filters) return [topic.address, undefined]
      const mine = events.filter((event) => filters.some((filter) => answersFilter(event, filter)))
      const roster = mine.filter((event) => event.kind === KIND_ROSTER || ROSTER_COMMANDS.includes(event.kind))
      const listing = mine.filter((event) => event.kind === KIND_FOLDER_STATE || event.kind === KIND_FOLDER_COMMAND)
      const own = mine.filter((event) => !roster.includes(event) && !listing.includes(event))
      return [topic.address, placeListing(place, { events: own, roster, listing }).map((listed) => listed.pubkey)]
    }),
  )
}

/**
 * Who one initiative lists, for its page's members pill, and its own events (as Ship's `readTopicPlace`, TOPI-8): the
 * same `placeListing` Explore counts with, and the events an Add needs to follow a leave. A failed read rejects.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-place-lists-who-chose-a-level-and-its-teams-members.md
 */
export async function readTopicPlace(topic: { address: string; folder: string }): Promise<{ listed: Listed[]; events: SignedEvent[] }> {
  const me = viewerPubkey()
  if (!me) throw new Error('Sign in to read who is in an initiative.')
  const place = { address: topic.address, team: topic.folder }
  const filters = (placeFilters(place, me) as Filter[]).filter((filter) => !(filter.kinds as number[]).includes(KIND_APP_DATA))
  const events = await queryAll(filters)
  const roster = events.filter((event) => event.kind === KIND_ROSTER || ROSTER_COMMANDS.includes(event.kind))
  const listing = events.filter((event) => event.kind === KIND_FOLDER_STATE || event.kind === KIND_FOLDER_COMMAND)
  const own = events.filter((event) => !roster.includes(event) && !listing.includes(event))
  return { listed: placeListing(place, { events: own, roster, listing }), events: own }
}

/**
 * One initiative's place, read when its page opens and again after a Join, Leave or Add (as Ship's `useTopicPlace`):
 * `undefined` until read, and while a read fails — the pill then draws nothing rather than a wrong count.
 */
export function useTopicPlace(topic: { address: string; folder: string } | undefined): {
  place: Awaited<ReturnType<typeof readTopicPlace>> | undefined
  reload: () => Promise<void>
} {
  const [answer, setAnswer] = useState<{ key: string; value: Awaited<ReturnType<typeof readTopicPlace>> }>()
  const address = topic?.address
  const folder = topic?.folder
  const key = address && folder ? `${address} ${folder}` : ''
  useEffect(() => {
    if (!address || !folder) return
    let live = true
    readTopicPlace({ address, folder }).then(
      (value) => {
        if (live) setAnswer({ key: `${address} ${folder}`, value })
      },
      (error: unknown) => console.warn('[topics] members:', error),
    )
    return () => {
      live = false
    }
  }, [address, folder])
  // After a Join, Leave or Add: read again and resolve once the answer is drawn, so the pill is right before the caller goes on.
  const reload = useCallback(async () => {
    if (!address || !folder) return
    try {
      const value = await readTopicPlace({ address, folder })
      setAnswer({ key: `${address} ${folder}`, value })
    } catch (error) {
      console.warn('[topics] members:', error)
    }
  }, [address, folder])
  return { place: answer?.key === key ? answer.value : undefined, reload }
}
