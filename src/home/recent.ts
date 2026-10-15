import { KIND, type SignedEvent } from '@estiva-app/protocol'
import { CHANGE } from '../document/save'

/** How many rows Home shows (Miky, LEAF-6's kickoff). */
export const HOME_ROWS = 7

/** A page Home may list: a document in one of the Folders the tree reads. */
export interface Page {
  /** `30842:<pubkey>:<d>`: what its changes and comments name. */
  address: string
  naddr: string
  /** The page's own event: its `created_at` is when it was made. */
  eventId: string
  title: string
  /** The Folder's name, as the row says it. */
  folder: string
  /** The Folder's id: the `h` every change and comment on the page carries. */
  folderId: string
}

export interface RecentRow extends Page {
  /** The latest change to the page's text or title, a comment on it, or its making, in ms. */
  at: number
  /** Who made that change. */
  by: string
}

/**
 * The reads Home makes for `pages`: the pages' own events (when each was
 * made), every save of a page's text or title (`1851`, by its `a`) and every
 * comment on it (`1111`, by its root `A` — a reply carries only `A`, and a
 * lowercase `a` on someone else's comment is a mention, SPEC §6.4). Started
 * from the pages that exist, never from the viewer's own `1851`s: a deleted
 * page's saves stay on the relay, and most of a person's `1851`s are Ship's.
 */
export function recentFilters(pages: Page[]): Record<string, unknown>[] {
  const addresses = pages.map((p) => p.address)
  return [
    { ids: pages.map((p) => p.eventId) },
    { kinds: [CHANGE], '#a': addresses },
    { kinds: [KIND.COMMENT], '#A': addresses },
  ]
}

/**
 * The page an event changes or comments on, when it is one of `pages`; `null`
 * for anything else. The tag that names it, not the first of its kind: the
 * read matches an event by any of its `a`s.
 */
function pageOf(event: SignedEvent, pages: ReadonlyMap<string, unknown>): string | null {
  const naming = (name: string) => event.tags.find((t) => t[0] === name && pages.has(t[1]))?.[1] ?? null
  if (event.kind === CHANGE) {
    // A `1851` also sets `member:`, `archived` or `parent` (SPEC §11.8): only the text and the title are an edit.
    const field = event.tags.find((t) => t[0] === 'field')?.[1]
    return field === 'title' || field === 'description' ? naming('a') : null
  }
  return event.kind === KIND.COMMENT ? naming('A') : null
}

/**
 * The event's own time in ms: its `ts` tag when it falls in the second its
 * `created_at` names (the same moment, to the millisecond), else `created_at`.
 * A `ts` is the signer's word alone: unbounded, one far in the future would
 * keep a page on top of everyone's Home.
 */
function timeOf(event: SignedEvent): number {
  const ts = Number(event.tags.find((t) => t[0] === 'ts')?.[1])
  return Number.isFinite(ts) && Math.floor(ts / 1000) === event.created_at ? ts : event.created_at * 1000
}

const tag = (event: SignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

/**
 * Home's rows (Miky, LEAF-6's kickoff): the pages `me` made, edited or
 * commented on, ordered by the latest change to each by anyone, naming who
 * made it. Someone who touched none sees the most recent pages in their
 * Folders instead. At most {@link HOME_ROWS}.
 */
export function rankRecent(pages: Page[], events: SignedEvent[], me: string | null): RecentRow[] {
  const rows = new Map<string, RecentRow>()
  const byEvent = new Map<string, RecentRow>()
  const touched = new Set<string>()
  const titledAt = new Map<string, number>()
  for (const page of pages) {
    const maker = page.address.split(':')[1] ?? ''
    const row = { ...page, at: 0, by: maker }
    rows.set(page.address, row)
    byEvent.set(page.eventId, row)
    if (maker === me) touched.add(page.address)
  }
  for (const event of events) {
    const made = byEvent.get(event.id)
    const address = made ? made.address : pageOf(event, rows)
    const row = address ? rows.get(address) : undefined
    if (!row) continue
    // A change or comment carrying another Folder's `h` is ignored by every reader (SPEC §6.2), so here too.
    if (!made && tag(event, 'h') !== row.folderId) continue
    if (event.pubkey === me) touched.add(row.address)
    const at = timeOf(event)
    if (at > row.at) {
      row.at = at
      row.by = event.pubkey
    }
    // The newest title: the tree's is the one read when Leaf opened, before a rename made since.
    const title = event.kind === CHANGE && tag(event, 'field') === 'title' ? tag(event, 'value')?.trim() : undefined
    if (title && at > (titledAt.get(row.address) ?? 0)) {
      titledAt.set(row.address, at)
      row.title = title
    }
  }
  const all = [...rows.values()]
  const mine = all.filter((r) => touched.has(r.address))
  return (mine.length > 0 ? mine : all).sort((a, b) => b.at - a.at).slice(0, HOME_ROWS)
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Infinity],
]

/** "2 minutes ago", "Yesterday", "Last week": when, as a row says it. */
export function whenOf(at: number, now: number): string {
  let amount = (at - now) / 60_000
  if (amount > -1) return 'Just now'
  for (const [unit, next] of STEPS) {
    if (Math.abs(amount) < next) {
      const said = relative.format(Math.round(amount), unit)
      return said.charAt(0).toUpperCase() + said.slice(1)
    }
    amount /= next
  }
  return ''
}

const exact = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** "9 Oct 2026, 09:58": the time a row's tooltip gives. */
export function exactly(at: number): string {
  return exact.format(at)
}
