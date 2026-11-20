import type { FileTimes } from '@estiva-app/protocol'
import { describe, expect, it, vi } from 'vitest'

/*
  Home ranks another app's file by its latest title, summary or text change (ISS-6). Read by the list read, a project
  or an issue names no text change, so Home asks the relay's times read when each field last changed, and reads those
  changes by id: a project whose text was edited last stays on Home.
*/
const asked: Record<string, unknown>[][] = []
let answers: FileTimes[] = []
vi.mock('../relay/bridge', () => ({ query: async () => [], viewerPubkey: () => null, queryTimes: vi.fn() }))
vi.mock('../relay/projectFields', async (original) => ({
  ...(await original<typeof import('../relay/projectFields')>()),
  timesRead: async () => ({
    times: async (filters: Record<string, unknown>[]) => {
      asked.push(filters)
      return answers
    },
  }),
}))

import * as recent from './useRecent'

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
