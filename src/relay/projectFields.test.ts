import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  Each type's switch, as the relay's NIP-11 and the tab's opt-in set it (ISS-6): projects and issues apart, so an
  issue is read and written by its fields only once issues are switched, never because projects are.
*/
vi.mock('../config', () => ({ RELAY_URL: 'https://relay.test' }))
vi.mock('./bridge', () => ({ queryTimes: vi.fn() }))

import * as switches from './projectFields'

const { byFields, openReadOption, resetRelayReadsForTests } = switches

const PROJECT = `30850:${'b'.repeat(64)}:p1`
const ISSUE = `30851:${'b'.repeat(64)}:i1`
const DOCUMENT = `30842:${'b'.repeat(64)}:d1`

/** The relay's NIP-11, keeping `inOrder` in order, with the list, open and search reads. */
function relayKeeps(inOrder: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        files: { requires_prev: inOrder },
        file_list: { newest: true, text: true, times: true },
        file_search: { types: ['osnova.project', 'osnova.issue'] },
      }),
    })),
  )
}

beforeEach(() => {
  resetRelayReadsForTests()
  sessionStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('the switch per type (ISS-6)', () => {
  it('reads and writes an issue the old way while only projects are kept in order', async () => {
    relayKeeps(['osnova.project'])
    expect(await byFields(PROJECT)).toBe(true)
    expect(await byFields(ISSUE)).toBe(false)
    expect(await openReadOption()).toEqual({ openRead: [30850] })
  })

  it('reads and writes an issue by its fields once the relay keeps issues in order', async () => {
    relayKeeps(['osnova.project', 'osnova.issue'])
    expect(await byFields(ISSUE)).toBe(true)
    expect(await openReadOption()).toEqual({ openRead: [30850, 30851] })
  })

  it('switches an issue for a tab opened with ?issueFields=on, and never a document', async () => {
    relayKeeps(['osnova.project'])
    sessionStorage.setItem('estiva.issueFields', 'on')
    expect(await byFields(ISSUE)).toBe(true)
    expect(await byFields(DOCUMENT)).toBe(false)
  })
})
