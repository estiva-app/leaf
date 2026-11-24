/**
 * Whether a page is archived with a page above it is found from each page above's current values, not every change
 * ever made to it (ALO-15, SPEC §6.13, ALL-8): every relay offers the list read, and Leaf reads no other way. Asserted
 * on the filters that reach the relay.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/the-old-way-goes-once-miky-has-looked.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDocument, encodeNaddr, KIND, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'

const relay = vi.hoisted(() => ({ events: [] as SignedEvent[] }))
const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../relay/bridge', () => ({ query, queryAll: query, publish: vi.fn(async () => ({ ok: true })), viewerPubkey: () => 'a'.repeat(64) }))

import { buildManifest } from '../manifest'
import { relayAnswer } from '../test/listRead'
// Loaded once here, before any test's clock starts: the first load takes seconds on a busy machine, and
// inside the first test it ran that test out of time. Each test evaluates it again, in milliseconds.
import './fileTopics'

const LEAF = 'b'.repeat(64)
const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
/** A page's id, a v4 UUID as a file id must be, by its letter. */
const uuidOf = (letter: string) => `00000000-0000-4000-8000-${letter.charCodeAt(0).toString().padStart(12, '0')}`
let next = 0
const signed = (event: UnsignedEvent): SignedEvent => ({ ...event, id: String(++next).padStart(64, '0'), sig: '' }) as SignedEvent
const page = (id: string, parent?: string) =>
  signed(buildDocument(LEAF, 1_760_000_000_000, { fileId: uuidOf(id), title: id, channelUuid: FOLDER, ...(parent ? { parent } : {}) }))
const addr = (id: string) => `${KIND.DOCUMENT}:${LEAF}:${uuidOf(id)}`
const change = (id: string, field: string, value: string, at: number) =>
  signed({ kind: 1851, pubkey: LEAF, created_at: at, tags: [['a', addr(id)], ['field', field], ['value', value], ['h', FOLDER]], content: '' })
const naddrOf = (id: string) => encodeNaddr({ kind: KIND.DOCUMENT, pubkey: LEAF, identifier: uuidOf(id), relays: [] })

/** Every filter that asks for every change to a page above C — A or B — with no `since` and not by the list read. */
const historyAbove = () =>
  query.mock.calls
    .flatMap(([filters]) => filters as Record<string, unknown>[])
    .filter(
      (f) =>
        (f.kinds as number[] | undefined)?.includes(1851) &&
        ((f['#a'] as string[] | undefined) ?? []).some((a) => a === addr('A') || a === addr('B')) &&
        f.since === undefined &&
        f.fields === undefined,
    )

beforeEach(async () => {
  vi.resetModules()
  query.mockReset()
  query.mockImplementation(async (filters: Record<string, unknown>[]) => relayAnswer(relay.events, filters))
  // A ⟵ B ⟵ C, and A renamed a few times and then archived.
  relay.events = [
    signed(buildManifest(LEAF, 1_700_000_000_000)),
    page('A'),
    page('B', addr('A')),
    page('C', addr('B')),
    ...[1_760_000_010, 1_760_000_020, 1_760_000_030].map((at) => change('A', 'title', `A ${at}`, at)),
    change('A', 'archived', 'true', 1_760_000_100),
  ]
})

/** `save`, imported afresh for each test. */
const fresh = () => import('./save')

/** A topic under C, as the sidebar's Topics reads it: archived with A only by walking B and A. */
const topicUnderC = () => {
  const topic = signed({ kind: 30840, pubkey: LEAF, created_at: 1_760_000_200, tags: [['d', uuidOf('P')], ['title', 'Plans'], ['a', addr('C')], ['h', FOLDER]], content: '' })
  relay.events.push(topic)
  return `30840:${LEAF}:${uuidOf('P')}`
}
const sidebarTopics = async () => (await import('./fileTopics')).loadTopics()

describe('a page archived with a page above it', () => {
  it('a page opened by its address is archived with its grandparent, without reading every change above it', async () => {
    const c = await (await fresh()).readDocument(naddrOf('C'))

    expect(c?.archived?.with).toBe(addr('A'))
    expect(historyAbove()).toEqual([])
  })

  it('pages read together are archived with their grandparent, without reading every change above them', async () => {
    const read = await (await fresh()).readDocuments([naddrOf('C')])

    expect(read[naddrOf('C')]?.archived?.with).toBe(addr('A'))
    expect(historyAbove()).toEqual([])
  })

  it('the sidebar’s topics are archived with the page above them, without reading every change above it', async () => {
    const topic = topicUnderC()
    const read = await sidebarTopics()

    expect(read.topics.find((t) => t.address === topic)?.object.archived?.with).toBe(addr('A'))
    expect(historyAbove()).toEqual([])
  })

  it('a page’s Topics row shows a topic archived with the page above it, without reading every change above it', async () => {
    const topic = topicUnderC()
    const { planListInTopic } = await import('@estiva-app/interop')
    relay.events.push(signed(planListInTopic(LEAF, 1_760_000_300_000, { topic: { address: topic, folder: FOLDER }, file: uuidOf('D') })[0]))
    const rows = await (await import('./fileTopics')).readFileTopics(uuidOf('D'))

    expect(rows.find((row) => row.address === topic)?.archived).toBe(true)
    expect(historyAbove()).toEqual([])
  })
})
