import type { FileTimes } from '@estiva-app/protocol'
import { describe, expect, it, vi } from 'vitest'

/*
  Home ranks another app's file by its latest title, summary or text change (ISS-6). Read by the list read, a project
  or an issue names no text change, so Home asks the relay's times read when each field last changed, and reads those
  changes by id: a project whose text was edited last stays on Home.
*/
const asked: Record<string, unknown>[][] = []
let answers: FileTimes[] = []
vi.mock('../relay/bridge', () => ({
  query: async () => [],
  viewerPubkey: () => null,
  queryTimes: async (filters: Record<string, unknown>[]) => {
    asked.push(filters)
    return answers
  },
}))

import * as recent from './useRecent'
import { recentFilters } from './recent'
import { markRowOnly } from '../relay/rowOnly'

describe("Home's rows for a Leaf page the tree read by the list read (ALL-4)", () => {
  const PAGE = `30842:${'a'.repeat(64)}:notes`
  const page = (rowOnly: boolean) => {
    const file = { kind: 30842, address: PAGE, naddr: 'naddr1notes', eventId: 'root', folder: 'team', slots: { title: { value: 'Notes' } }, prevs: { title: 'title-now', summary: 'summary-now' }, actions: [] }
    if (rowOnly) markRowOnly([file as never])
    return [{ folder: { id: 'team', name: 'Team' }, contents: { files: [file] } }] as never
  }

  it('reads the page’s current changes by id, never every save made to it', () => {
    const filters = recentFilters(recent.pagesOf(page(true))!)
    expect(filters.some((f) => '#a' in f)).toBe(false)
    expect(filters[0]).toEqual({ ids: ['root', 'title-now', 'summary-now'] })
  })

  it('reads the page’s newest text change too, so a page just typed into moves up', async () => {
    answers = [{ a: PAGE, created_at: 1, h: 'team', changes: [{ id: 'text-new', created_at: 30, fields: ['description'] }] }]
    const rows = await recent.withEdits(recent.pagesOf(page(true))!)
    asked.length = 0
    expect(recentFilters(rows)[0]).toEqual({ ids: ['root', 'title-now', 'summary-now', 'text-new'] })
  })

  it('reads every save of a file not read as its row only (control)', () => {
    const filters = recentFilters(recent.pagesOf(page(false))!)
    expect(filters).toContainEqual({ kinds: [1851], '#a': [PAGE] })
  })
})

const PROJECT = `30850:${'b'.repeat(64)}:p1`

describe("Home's rows for a file read by the list read (ISS-6)", () => {
  it('names its newest text, title and summary change from the times read, never an older one or a status', async () => {
    answers = [
      {
        a: PROJECT,
        created_at: 1,
        h: 'team',
        changes: [
          { id: 'text-old', created_at: 10, fields: ['description'] },
          { id: 'text-new', created_at: 30, fields: ['description'] },
          { id: 'title', created_at: 20, fields: ['title'] },
          { id: 'status', created_at: 40, fields: ['status'] },
        ],
      },
    ]
    const edits = await recent.editsOf?.([{ address: PROJECT } as never])
    expect(asked).toEqual([[{ fields: 'times', kinds: [30850], '#d': ['p1'] }]])
    expect(edits?.get(PROJECT)).toEqual(['title', 'text-new'])
  })
})
