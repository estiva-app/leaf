/**
 * Whether a page is archived with a page above it is found from each page above's current values, not every change
 * ever made to it (ALO-15, SPEC §6.13), as soon as the relay offers the list read, whether or not this tab is switched.
 * A relay that does not offer it is read as before. Asserted on the filters that reach the relay.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDocument, encodeNaddr, KIND, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'

const relay = vi.hoisted(() => ({ events: [] as SignedEvent[] }))
const matches = (event: SignedEvent, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([key, wanted]) => {
    if (!['kinds', 'authors', 'ids'].includes(key) && !key.startsWith('#')) return true
    const values = wanted as (string | number)[]
    if (key === 'kinds') return values.includes(event.kind)
    if (key === 'authors') return values.includes(event.pubkey)
    if (key === 'ids') return values.includes(event.id)
    return event.tags.some((t) => t[0] === key.slice(1) && values.includes(t[1]))
  })
const tag = (event: SignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]
const addressOf = (event: SignedEvent) => `${event.kind}:${event.pubkey}:${tag(event, 'd')}`
/** The list read (SPEC §6.13): each file it names, with each field's newest change aimed at it. */
const listed = (filter: Record<string, unknown>) =>
  relay.events
    .filter((root) => matches(root, filter))
    .flatMap((root) => {
      const newest = new Map<string, SignedEvent>()
      for (const change of relay.events.filter((e) => e.kind === 1851 && tag(e, 'a') === addressOf(root))) {
        const held = newest.get(tag(change, 'field') ?? '')
        if (!held || held.created_at < change.created_at) newest.set(tag(change, 'field') ?? '', change)
      }
      return [root, ...newest.values()]
    })
const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../relay/bridge', () => ({ query, queryAll: query, publish: vi.fn(async () => ({ ok: true })), viewerPubkey: () => 'a'.repeat(64) }))
// A build with a relay, so its NIP-11 is asked.
vi.mock('../config', async (importOriginal) => ({ ...(await importOriginal<typeof import('../config')>()), RELAY_URL: 'https://relay.test' }))

import { buildManifest } from '../manifest'

const LEAF = 'b'.repeat(64)
const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
let next = 0
const signed = (event: UnsignedEvent): SignedEvent => ({ ...event, id: String(++next).padStart(64, '0'), sig: '' }) as SignedEvent
const page = (id: string, parent?: string) =>
  signed(buildDocument(LEAF, 1_760_000_000_000, { fileId: id, title: id, channelUuid: FOLDER, ...(parent ? { parent } : {}) }))
const addr = (id: string) => `${KIND.DOCUMENT}:${LEAF}:${id}`
const change = (id: string, field: string, value: string, at: number) =>
  signed({ kind: 1851, pubkey: LEAF, created_at: at, tags: [['a', addr(id)], ['field', field], ['value', value], ['h', FOLDER]], content: '' })
const naddrOf = (id: string) => encodeNaddr({ kind: KIND.DOCUMENT, pubkey: LEAF, identifier: id, relays: [] })

/** The relay's NIP-11: production on 6 Nov offers the list read with the switch off (`'list'`); `false` says nothing. */
function relayInfo(offered: 'list' | false) {
  const info = offered === 'list' ? { file_list: { newest: true, text: true } } : { supported_nips: [1, 11] }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => info })))
}

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
  query.mockImplementation(async (filters: Record<string, unknown>[]) => [
    ...new Set([
      ...relay.events.filter((event) => filters.some((filter) => filter.fields !== 'newest' && matches(event, filter))),
      ...filters.filter((filter) => filter.fields === 'newest').flatMap(listed),
    ]),
  ])
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

afterEach(() => {
  vi.unstubAllGlobals()
})

/** `save`, imported afresh so the relay's NIP-11 is asked again for each test. */
const fresh = () => import('./save')

/** A topic under C, as the sidebar's Topics reads it: archived with A only by walking B and A. */
const topicUnderC = () => {
  const topic = signed({ kind: 30840, pubkey: LEAF, created_at: 1_760_000_200, tags: [['d', 'plans'], ['title', 'Plans'], ['a', addr('C')], ['h', FOLDER]], content: '' })
  relay.events.push(topic)
  return `30840:${LEAF}:plans`
}
const sidebarTopics = async () => (await import('./fileTopics')).loadTopics()

describe('where the relay offers the list read, with the switch off', () => {
  beforeEach(() => relayInfo('list'))

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
})

describe('where the relay does not offer the list read', () => {
  beforeEach(() => relayInfo(false))

  it('a page is still archived with its grandparent, by the changes above it as before', async () => {
    const c = await (await fresh()).readDocument(naddrOf('C'))

    expect(c?.archived?.with).toBe(addr('A'))
    expect(historyAbove().length).toBeGreaterThan(0)
  })

  it('the sidebar’s topics are still archived with the page above them, by the changes above as before', async () => {
    const topic = topicUnderC()
    const read = await sidebarTopics()

    expect(read.topics.find((t) => t.address === topic)?.object.archived?.with).toBe(addr('A'))
    expect(historyAbove().length).toBeGreaterThan(0)
  })
})
