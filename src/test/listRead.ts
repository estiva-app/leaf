/*
  The relay's list and open reads (SPEC §6.13), over a test's own events.

  Every app reads files this way since ALL-8: a filter saying `"fields": "newest"` picks first records, and the relay
  answers each with its fields' current changes (the text only with `"text": true`), leaving out a file whose `deleted`
  field is set. A test's fake relay answers through `relayAnswer`, so its scenarios keep their events and the reads go
  the one way.
*/
import { fieldsSetBy, filesOf } from '@estiva-app/interop'
import type { FileTimes, SignedEvent } from '@estiva-app/protocol'

type Filter = Record<string, unknown>
type Matches<E> = (event: E, filter: Filter) => boolean

/** A plain filter: ids, kinds, authors, `#x` tags, since and until. */
export function plainMatches(event: Pick<SignedEvent, 'id' | 'kind' | 'pubkey' | 'created_at' | 'tags'>, filter: Filter): boolean {
  if (Array.isArray(filter.ids) && !filter.ids.includes(event.id)) return false
  if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) return false
  if (Array.isArray(filter.authors) && !filter.authors.includes(event.pubkey)) return false
  if (typeof filter.since === 'number' && event.created_at < filter.since) return false
  if (typeof filter.until === 'number' && event.created_at > filter.until) return false
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#')) continue
    if (!event.tags.some((t) => t[0] === key.slice(1) && (values as string[]).includes(t[1]))) return false
  }
  return true
}

/** The list read's answer to one filter: each first record it picks, with its fields' current changes; a deleted file left out. */
export function listAnswer<E extends Pick<SignedEvent, 'id' | 'kind' | 'pubkey' | 'created_at' | 'tags'>>(
  events: readonly E[],
  filter: Filter,
  matches: Matches<E> = plainMatches,
): E[] {
  const { text, limit, ...picks } = filter
  const rest = Object.fromEntries(Object.entries(picks).filter(([key]) => key !== 'fields'))
  const roots = events.filter((event) => event.kind >= 30000 && matches(event, rest)).sort((a, b) => b.created_at - a.created_at)
  const picked = new Set<unknown>(typeof limit === 'number' ? roots.slice(0, limit) : roots)
  return filesOf(events as unknown as SignedEvent[], { withText: text === true }).flatMap((file) =>
    picked.has(file.root) && file.fields.deleted?.value !== 'true' ? (file.events as unknown as E[]) : [],
  )
}

const addressOf = (event: Pick<SignedEvent, 'kind' | 'pubkey' | 'tags'>) => `${event.kind}:${event.pubkey}:${event.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`
const tagValue = (event: Pick<SignedEvent, 'tags'>, name: string) => event.tags.find((t) => t[0] === name)?.[1]

/**
 * The times read's answer (`"fields": "times"`, SPEC §6.13) over a test's own events: for each file a filter picks by
 * its kinds and `#d`, or by its address in `#a`, when it and each change aimed at it were written, and which fields each
 * change set, never the change itself. A deleted file is left out.
 */
export function timesAnswer(events: readonly SignedEvent[], filters: readonly Filter[]): FileTimes[] {
  const out = new Map<string, FileTimes>()
  for (const filter of filters) {
    if (filter.fields !== 'times') continue
    const { '#a': addresses, ...picks } = filter
    const rest = Object.fromEntries(Object.entries(picks).filter(([key]) => key !== 'fields' && key !== 'under'))
    const roots = events.filter((event) => event.kind >= 30000 && plainMatches(event, rest) && (!Array.isArray(addresses) || addresses.includes(addressOf(event))))
    for (const root of roots) {
      const a = addressOf(root)
      const changes = events.filter((event) => event.kind === 1851 && tagValue(event, 'a') === a)
      if (changes.filter((change) => tagValue(change, 'field') === 'deleted').sort((x, y) => x.created_at - y.created_at).at(-1)?.tags.some((t) => t[0] === 'value' && t[1] === 'true')) continue
      out.set(a, {
        a,
        created_at: root.created_at,
        h: tagValue(root, 'h') ?? null,
        changes: changes.map((change) => ({ id: change.id, created_at: change.created_at, fields: fieldsSetBy(change).map((set) => set.field) })),
      })
    }
  }
  return [...out.values()]
}

/** The relay's answer to `filters` over `events`: the list read for a filter that asks it, the plain match for the rest. */
export function relayAnswer<E extends Pick<SignedEvent, 'id' | 'kind' | 'pubkey' | 'created_at' | 'tags'>>(
  events: readonly E[],
  filters: readonly Filter[],
  matches: Matches<E> = plainMatches,
): E[] {
  const out = new Map<string, E>()
  for (const filter of filters) {
    const hits = filter.fields === 'newest' ? listAnswer(events, filter, matches) : events.filter((event) => matches(event, filter))
    for (const event of hits) out.set(event.id, event)
  }
  return [...out.values()]
}
