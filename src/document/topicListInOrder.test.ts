import type { UnsignedEvent } from '@estiva-app/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'

/* ALL-4, ALL-8: Leaf's Add to topic and Remove name the entry's change they follow. */

const ME = 'a'.repeat(64)
const MIKY = 'b'.repeat(64)
const TEAM = 'hq-folder'
const TOPIC = `30840:${MIKY}:topic-1`
const FILE = '3518cd7b-5b85-49e8-ba94-4aacacad2163'
const ROOT_ID = 'e'.repeat(64)

/* What went out: through the ordered writer, or the plain publish. */
const published: UnsignedEvent[] = []

vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => ME,
  // The open read of the topic: its first record, with no entry for the file yet.
  query: async (filters: { fields?: string; '#d'?: string[] }[]) =>
    filters[0]?.fields === 'newest'
      ? [{ kind: 30840, pubkey: MIKY, tags: [['d', 'topic-1'], ['title', 'Launch'], ['h', TEAM]], content: '', created_at: 1, id: ROOT_ID, sig: '' }]
      : [],
  queryAll: async () => [],
  changeWriter: {
    sign: async (event: UnsignedEvent) => ({ ...event, id: 'f'.repeat(64), sig: '' }),
    publish: async (event: UnsignedEvent) => {
      published.push(event)
      return { ok: true, eventId: 'f'.repeat(64) }
    },
  },
  publish: async (event: UnsignedEvent) => {
    published.push(event)
    return { ok: true }
  },
}))
vi.mock('../relay/manifests', () => ({ resolveQuery: async () => [], projections: undefined }))

const { setListedInTopic } = await import('./fileTopics')
const tag = (event: UnsignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

afterEach(() => {
  published.length = 0
})

describe('putting a file on a topic’s list from Leaf', () => {
  it('names the change it follows: the topic’s first record for a file never listed', async () => {
    expect((await setListedInTopic({ address: TOPIC, folder: TEAM }, FILE, true)).ok).toBe(true)
    expect(published).toHaveLength(1)
    const [entry] = published
    expect([entry.kind, tag(entry, 'a'), tag(entry, 'field'), tag(entry, 'value'), tag(entry, 'h'), tag(entry, 'prev')]).toEqual([1851, TOPIC, `lists:${FILE}`, 'true', TEAM, ROOT_ID])
  })

  it('takes it off the same way', async () => {
    await setListedInTopic({ address: TOPIC, folder: TEAM }, FILE, false)
    expect([tag(published[0], 'value'), tag(published[0], 'prev')]).toEqual(['false', ROOT_ID])
  })
})
