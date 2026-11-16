import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ME, file, nip44, relay, said, topic } from './fixtures/topicsRelay'

/*
 * ALO-22: ordering the sidebar's topics learns when a listed file changed from the relay's times read, where the relay
 * offers it (NIP-11 `file_list.times`), and no longer reads that file's changes whole. Any other relay is read as
 * before. Asserted on the filters that reach the relay.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-may-answer-when-a-file-changed-without-the-change.md
 */

const times = vi.hoisted(() => ({ asked: [] as Record<string, unknown>[][] }))
// A build with a relay, so its NIP-11 is asked.
vi.mock('../config', async (original) => ({ ...(await original<typeof import('../config')>()), RELAY_URL: 'https://relay.test' }))
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
const { resetRelayReadsForTests } = await import('../relay/projectFields')

function relayOffers(fileList: Record<string, boolean> | undefined) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => (fileList ? { file_list: fileList } : { supported_nips: [1, 11] }) })))
}

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
  resetRelayReadsForTests()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ordering your topics by when their files changed', () => {
  it('asks the relay for times, not the page’s changes, when it offers the times read', async () => {
    relayOffers({ newest: true, text: true, times: true })
    const page = file(30842, 'Launch plan')
    const address = page.address!
    said(topic(ME, 'Launch', [page]), 1_700_001_000)
    const { result } = renderHook(() => useSidebarTopics(true, (a) => (a === address ? page : null)))
    await waitFor(() => expect(Array.isArray(result.current)).toBe(true))
    await waitFor(() => expect(times.asked.flat().some((f) => f.fields === 'times' && (f['#d'] as string[] | undefined)?.includes(address.split(':')[2]!))).toBe(true))
    expect(changesOf(address)).toEqual([])
  })

  it('reads the page’s changes as before on a relay that does not offer it', async () => {
    relayOffers({ newest: true, text: true })
    const page = file(30842, 'Launch plan')
    const address = page.address!
    said(topic(ME, 'Launch', [page]), 1_700_001_000)
    const { result } = renderHook(() => useSidebarTopics(true, (a) => (a === address ? page : null)))
    await waitFor(() => expect(Array.isArray(result.current)).toBe(true))
    await waitFor(() => expect(changesOf(address).length).toBeGreaterThan(0))
    expect(times.asked).toEqual([])
  })
})
