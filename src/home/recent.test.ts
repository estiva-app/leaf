import type { SignedEvent } from '@estiva-app/protocol'
import { describe, expect, it } from 'vitest'
import { HOME_ROWS, rankRecent, recentFilters, whenOf, type Page } from './recent'

const ME = 'a'.repeat(64)
const ANA = 'b'.repeat(64)
const RAVI = 'c'.repeat(64)

function page(n: number, maker = ANA): Page {
  return { address: `30842:${maker}:p${n}`, naddr: `naddr1p${n}`, eventId: `e${n}`, title: `Page ${n}`, folder: 'QA', folderId: 'f1' }
}
function made(p: Page, at: number): SignedEvent {
  return { id: p.eventId, pubkey: p.address.split(':')[1], kind: 30842, created_at: at, tags: [['h', 'f1']], content: '', sig: '' }
}
function save(p: Page, by: string, at: number, field = 'description', value = 'x', h = 'f1'): SignedEvent {
  return { id: `s${at}`, pubkey: by, kind: 1851, created_at: at, tags: [['a', p.address], ['field', field], ['value', value], ['h', h]], content: '', sig: '' }
}
function comment(p: Page, by: string, at: number, tag: 'A' | 'a' = 'A'): SignedEvent {
  return { id: `c${at}`, pubkey: by, kind: 1111, created_at: at, tags: [[tag, p.address], ['h', 'f1']], content: 'hi', sig: '' }
}

describe("Home's rows", () => {
  it('lists the pages you touched, by the latest change by anyone, naming who made it', () => {
    const [one, two, three] = [page(1), page(2), page(3)]
    const rows = rankRecent(
      [one, two, three],
      [made(one, 10), made(two, 20), made(three, 30), save(one, ME, 40), save(two, ME, 50), save(one, RAVI, 60)],
      ME,
    )
    expect(rows.map((r) => [r.title, r.by, r.at])).toEqual([
      ['Page 1', RAVI, 60_000],
      ['Page 2', ME, 50_000],
    ])
  })

  it('counts a page you made, and one you commented on by its root A — not one that only mentions it', () => {
    const [mine, commented, mentioned] = [page(1, ME), page(2), page(3)]
    const rows = rankRecent(
      [mine, commented, mentioned],
      [made(mine, 10), made(commented, 20), made(mentioned, 30), comment(commented, ME, 40), comment(mentioned, ME, 50, 'a')],
      ME,
    )
    expect(rows.map((r) => r.title)).toEqual(['Page 2', 'Page 1'])
  })

  it('does not count leaving, archiving or moving a page as an edit', () => {
    const [kept, left] = [page(1), page(2)]
    const rows = rankRecent(
      [kept, left],
      [made(kept, 10), made(left, 20), save(kept, ME, 30), save(left, ME, 40, `member:${ME}`), save(kept, ANA, 50, 'archived')],
      ME,
    )
    expect(rows.map((r) => [r.title, r.by, r.at])).toEqual([['Page 1', ME, 30_000]])
  })

  it('counts a summary change as an edit, like a rename, and shows the newest summary', () => {
    const [summarised, renamed] = [page(1), page(2)]
    const rows = rankRecent(
      [summarised, renamed],
      [made(summarised, 10), made(renamed, 10), save(renamed, ME, 20, 'title', 'Renamed'), save(summarised, ME, 40, 'summary', 'Newer'), save(summarised, ME, 30, 'summary', 'Older')],
      ME,
    )
    expect(rows.map((r) => [r.address, r.summary])).toEqual([
      [summarised.address, 'Newer'],
      [renamed.address, undefined],
    ])
    expect(rows[0].at).toBe(40_000)
  })

  it('shows no summary once the newest change clears it, even over the one the page was listed with', () => {
    const listed = { ...page(1), summary: 'From the tree' }
    // An empty value is what clearing sends; only spaces reads the same.
    for (const cleared of ['', '  ']) {
      const rows = rankRecent([listed], [made(listed, 10), save(listed, ME, 20, 'summary', cleared)], ME)
      expect(rows[0].summary).toBeUndefined()
    }
  })

  it("shows the Folders' latest pages to someone who touched none", () => {
    const [one, two] = [page(1), page(2)]
    const rows = rankRecent([one, two], [made(one, 10), made(two, 20), save(one, RAVI, 30)], ME)
    expect(rows.map((r) => r.title)).toEqual(['Page 1', 'Page 2'])
  })

  it('ignores the saves of a page that is no longer in a Folder', () => {
    const gone = page(9)
    expect(rankRecent([page(1)], [made(page(1), 10), save(gone, ME, 99)], ME).map((r) => r.title)).toEqual(['Page 1'])
  })

  it('names a page by its newest title, not the one the tree read when Leaf opened', () => {
    const one = page(1)
    const rows = rankRecent([one], [made(one, 10), save(one, ME, 20, 'title', 'Plan'), save(one, ANA, 15, 'title', 'Older')], ME)
    expect(rows[0].title).toBe('Plan')
  })

  it("ignores a change carrying another Folder's h, as every reader does", () => {
    const one = page(1)
    const rows = rankRecent([one], [made(one, 10), save(one, RAVI, 90, 'title', 'Hijack', 'f2')], ME)
    expect(rows.map((r) => [r.title, r.by, r.at])).toEqual([['Page 1', ANA, 10_000]])
  })

  it('credits a change to the page its a names, not to its first a', () => {
    const one = page(1)
    const both = { ...save(one, ME, 40), tags: [['a', '30842:x:elsewhere'], ...save(one, ME, 40).tags] }
    expect(rankRecent([one], [made(one, 10), both], ME).map((r) => [r.by, r.at])).toEqual([[ME, 40_000]])
  })

  it('takes a ts only within the second its created_at names', () => {
    const one = page(1)
    const early = { ...save(one, ME, 20), tags: [...save(one, ME, 20).tags, ['ts', '20250']] }
    const future = { ...save(one, ANA, 30), tags: [...save(one, ANA, 30).tags, ['ts', '9999999999999']] }
    expect(rankRecent([one], [made(one, 10), early], ME)[0].at).toBe(20_250)
    expect(rankRecent([one], [made(one, 10), future], ME)[0].at).toBe(30_000)
  })

  it(`shows at most ${HOME_ROWS}`, () => {
    const pages = Array.from({ length: 12 }, (_, i) => page(i, ME))
    expect(rankRecent(pages, pages.map((p, i) => made(p, i)), ME)).toHaveLength(HOME_ROWS)
  })

  it('reads by the page, its saves by `a` and its comments by root `A`', () => {
    expect(recentFilters([page(1)])).toEqual([
      { ids: ['e1'] },
      { kinds: [1851], '#a': [`30842:${ANA}:p1`] },
      { kinds: [1111], '#A': [`30842:${ANA}:p1`] },
    ])
  })
})

describe('when a row says', () => {
  const now = Date.UTC(2026, 9, 15, 12)
  it.each([
    [now - 20_000, 'Just now'],
    [now - 2 * 60_000, '2 minutes ago'],
    [now - 3 * 3_600_000, '3 hours ago'],
    [now - 26 * 3_600_000, 'Yesterday'],
    [now - 3 * 86_400_000, '3 days ago'],
    [now - 9 * 86_400_000, 'Last week'],
  ])('%s', (at, said) => {
    expect(whenOf(at, now)).toBe(said)
  })
})
