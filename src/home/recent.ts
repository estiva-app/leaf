import { KIND, type SignedEvent } from '@estiva-app/protocol'
import { CHANGE } from '../document/save'
import { summaryText } from '../document/summary'

/** How many rows Home shows (Miky, LEAF-6's kickoff). */
export const HOME_ROWS = 7

/**
 * A file Home may list: a page in one of the Folders the tree reads, or another app's file whose text Leaf writes
 * and whose title, summary or text the viewer changed (LTX-2).
 */
export interface Page {
  /** `<kind>:<pubkey>:<d>`: what its changes and comments name. */
  address: string
  naddr: string
  kind: number
  /** The file's own event: its `created_at` is when it was made. */
  eventId: string
  title: string
  /** Its summary, the row's second line; left out when it has none (SPEC §6.12). */
  summary?: string
  /** Where it is, as the row says it: a page's Folder, an issue's project. Empty when that could not be read. */
  folder: string
  /** The Folder's id: the `h` every change and comment on the file carries. */
  folderId: string
  /** Another app's file: its type, "Issue", as the tree labels it. A page has none. */
  type?: string
  /**
   * A project read by its fields (ALO-6): its title's, summary's and text's current changes, which Home reads by id
   * instead of every save of it. Absent: every save is read by its `a`.
   */
  changes?: string[]
}

/**
 * Whether only a change to a file's title, summary or text raises it on Home: another app's file, where a comment is
 * that app's conversation, not writing (Miky, LTX-2's kickoff). A page rises on a comment too.
 */
const textOnly = (page: Page) => page.type !== undefined

export interface RecentRow extends Page {
  /** The latest change to the page's text or title, a comment on it, or its making, in ms. */
  at: number
  /** Who made that change. */
  by: string
}

/**
 * The reads Home makes for `pages`: the pages' own events (when each was
 * made), every save of a page's text, title or summary (`1851`, by its `a`) and every
 * comment on it (`1111`, by its root `A` — a reply carries only `A`, and a
 * lowercase `a` on someone else's comment is a mention, SPEC §6.4). Started
 * from the files that exist: a deleted page's saves stay on the relay. Another
 * app's files are found from the viewer's own saves first ({@link textTargets}),
 * then read, so a deleted one is not listed either.
 */
export function recentFilters(pages: Page[]): Record<string, unknown>[] {
  const addresses = pages.map((p) => p.address)
  // A project read by its fields names its current changes: those, not its every save (ALO-6).
  const whole = pages.filter((p) => !p.changes).map((p) => p.address)
  return [
    { ids: [...pages.map((p) => p.eventId), ...pages.flatMap((p) => p.changes ?? [])] },
    ...(whole.length > 0 ? [{ kinds: [CHANGE], '#a': whole }] : []),
    { kinds: [KIND.COMMENT], '#A': addresses },
  ]
}

/** How many of the viewer's own saves Home reads to find other apps' files, newest first. */
export const OWN_SAVES = 200

/** The read of the viewer's own saves that {@link textTargets} looks through. */
export function ownSavesFilter(me: string): Record<string, unknown> {
  return { kinds: [CHANGE], authors: [me], limit: OWN_SAVES }
}

/**
 * The other apps' files the viewer changed the title, summary or text of, newest first and each once: what Home
 * reads next to find which of them Leaf writes. A page is left out (the tree lists those), and so is a change to any
 * other field, such as an issue's status. At most `limit`, so a few the viewer cannot read still leave a full Home.
 */
export function textTargets(saves: SignedEvent[], limit = HOME_ROWS * 3): string[] {
  const targets: string[] = []
  for (const save of [...saves].sort((a, b) => timeOf(b) - timeOf(a))) {
    const field = tag(save, 'field')
    const target = tag(save, 'a')
    if (!target || (field !== 'title' && field !== 'summary' && field !== 'description')) continue
    if (target.startsWith(`${KIND.DOCUMENT}:`) || targets.includes(target)) continue
    targets.push(target)
    if (targets.length === limit) break
  }
  return targets
}

/**
 * The page an event changes or comments on, when it is one of `pages`; `null`
 * for anything else. The tag that names it, not the first of its kind: the
 * read matches an event by any of its `a`s.
 */
function pageOf(event: SignedEvent, pages: ReadonlyMap<string, unknown>): string | null {
  const naming = (name: string) => event.tags.find((t) => t[0] === name && pages.has(t[1]))?.[1] ?? null
  if (event.kind === CHANGE) return isEdit(event) ? naming('a') : null
  return event.kind === KIND.COMMENT ? naming('A') : null
}

/**
 * Whether a change is an edit: to the text, the title or the summary. A `1851` also sets `member:`, `archived` or
 * `parent` (SPEC §11.8), which are not. Home and a page's "Edited …" both ask this, so both follow the text when its
 * saves move out of `1851`.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-type-is-a-shared-meaning-any-app-extends.md
 */
export function isEdit(event: SignedEvent): boolean {
  if (event.kind !== CHANGE) return false
  const field = event.tags.find((t) => t[0] === 'field')?.[1]
  return field === 'title' || field === 'summary' || field === 'description'
}

/**
 * The event's own time in ms: its `ts` tag when it falls in the second its
 * `created_at` names (the same moment, to the millisecond), else `created_at`.
 * A `ts` is the signer's word alone: unbounded, one far in the future would
 * keep a page on top of everyone's Home.
 */
export function timeOf(event: SignedEvent): number {
  const ts = Number(event.tags.find((t) => t[0] === 'ts')?.[1])
  return Number.isFinite(ts) && Math.floor(ts / 1000) === event.created_at ? ts : event.created_at * 1000
}

const tag = (event: SignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

/**
 * Home's rows (Miky, LEAF-6's kickoff): the pages `me` made, edited or
 * commented on, and another app's files whose title, summary or text `me`
 * changed in any app (Miky, LTX-2's kickoff), ordered by the latest change to
 * each by anyone, naming who made it. Someone who touched none sees the most
 * recent pages in their Folders instead. At most {@link HOME_ROWS}.
 */
export function rankRecent(pages: Page[], events: SignedEvent[], me: string | null): RecentRow[] {
  const rows = new Map<string, RecentRow>()
  const byEvent = new Map<string, RecentRow>()
  const touched = new Set<string>()
  const titledAt = new Map<string, number>()
  const summarizedAt = new Map<string, number>()
  for (const page of pages) {
    const maker = page.address.split(':')[1] ?? ''
    const row = { ...page, at: 0, by: maker }
    rows.set(page.address, row)
    byEvent.set(page.eventId, row)
    if (maker === me && !textOnly(page)) touched.add(page.address)
  }
  for (const event of events) {
    const made = byEvent.get(event.id)
    const address = made ? made.address : pageOf(event, rows)
    const row = address ? rows.get(address) : undefined
    if (!row) continue
    // A change or comment carrying another Folder's `h` is ignored by every reader (SPEC §6.2), so here too.
    if (!made && tag(event, 'h') !== row.folderId) continue
    if (textOnly(row) && event.kind === KIND.COMMENT) continue
    if (event.pubkey === me && !(made && textOnly(row))) touched.add(row.address)
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
    // The newest summary, the same way; an empty one clears it (SPEC §6.12).
    const summary = event.kind === CHANGE && tag(event, 'field') === 'summary' ? tag(event, 'value') : undefined
    if (summary !== undefined && at > (summarizedAt.get(row.address) ?? 0)) {
      summarizedAt.set(row.address, at)
      row.summary = summaryText(summary) || undefined
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
