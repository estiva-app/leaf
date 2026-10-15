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
  folder: string
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

/** The page an event changes or comments on, when it is one of Home's; `null` for anything else. */
function pageOf(event: SignedEvent): string | null {
  if (event.kind === CHANGE) {
    // A `1851` also sets `member:`, `archived` or `parent` (SPEC §11.8): only the text and the title are an edit.
    const field = event.tags.find((t) => t[0] === 'field')?.[1]
    if (field !== 'title' && field !== 'description') return null
    return event.tags.find((t) => t[0] === 'a')?.[1] ?? null
  }
  if (event.kind === KIND.COMMENT) return event.tags.find((t) => t[0] === 'A')?.[1] ?? null
  return null
}

/** The event's own time in ms: its `ts` tag when it has one (to the millisecond), else `created_at`. */
function timeOf(event: SignedEvent): number {
  const ts = Number(event.tags.find((t) => t[0] === 'ts')?.[1])
  return Number.isFinite(ts) && ts > 0 ? ts : event.created_at * 1000
}

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
  for (const page of pages) {
    const maker = page.address.split(':')[1] ?? ''
    const row = { ...page, at: 0, by: maker }
    rows.set(page.address, row)
    byEvent.set(page.eventId, row)
    if (maker === me) touched.add(page.address)
  }
  for (const event of events) {
    const made = byEvent.get(event.id)
    const address = made ? made.address : pageOf(event)
    const row = address ? rows.get(address) : undefined
    if (!row) continue
    if (event.pubkey === me) touched.add(row.address)
    const at = timeOf(event)
    if (at > row.at) {
      row.at = at
      row.by = event.pubkey
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
