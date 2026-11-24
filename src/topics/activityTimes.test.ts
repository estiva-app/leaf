import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ME, file, nip44, relay, said, topic } from './fixtures/topicsRelay'

/*
 * ALO-22, ALL-8: ordering the sidebar's topics learns when a listed file changed from the relay's times read, and never
 * reads that file's changes whole. Asserted on the filters that reach the relay.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-may-answer-when-a-file-changed-without-the-change.md
 */

const times = vi.hoisted(() => ({ asked: [] as Record<string, unknown>[][] }))
vi.mock('../relay/bridge', async () => ({
  ...(await import('./fixtures/topicsRelay')).bridge,
  queryTimes: async (filters: Record<string, unknown>[]) => {
    times.asked.push(filters)
    return []
  },
}))
vi.mock('../auth/nip44', async () => ({ nip44: (await import('./fixtures/topicsRelay')).nip44 }))
vi.mock('../relay/manifests', async () => ({ resolveQuery: (await import('./fixtures/topicsRelay')).bridge.query, projections: undefined }))

const { useSidebarTopics } = await import('./useSidebarTopics')
const { resetTopicChoicesForTests } = await import('../document/fileTopics')
const { resetTopicReadsForTests } = await import('./topicReads')
const { resetMutedForTests } = await import('./muted')

/** Every read of a file's changes whole: a 1851 filter naming the page. */
const changesOf = (address: string) => relay.reads.flat().filter((f) => f.kinds?.includes(1851) && (f['#a'] as string[] | undefined)?.includes(address))

beforeEach(() => {
  relay.reset()
  nip44.decrypting = undefined
  nip44.refuseDecrypt = false
  times.asked = []
  resetTopicChoicesForTests()
  resetTopicReadsForTests()
  resetMutedForTests()
})
afterEach(() => {
  cleanup()
})

describe('ordering your topics by when their files changed', () => {
  it('asks the relay for times, not the page’s changes', async () => {
    const page = file(30842, 'Launch plan')
    const address = page.address!
    said(topic(ME, 'Launch', [page]), 1_700_001_000)
    const { result } = renderHook(() => useSidebarTopics(true, (a) => (a === address ? page : null)))
    await waitFor(() => expect(Array.isArray(result.current)).toBe(true))
    await waitFor(() => expect(times.asked.flat().some((f) => f.fields === 'times' && (f['#d'] as string[] | undefined)?.includes(address.split(':')[2]!))).toBe(true))
    expect(changesOf(address)).toEqual([])
  })
})
