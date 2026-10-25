/**
 * A page under an archived page, at any depth, is read as archived with the
 * closest archived one above it (SPEC §6.5, PEEKM-2): `with` is the page a
 * reader is sent to unarchive. Leaf's own read of a file by its address,
 * against a relay faked at `query`; the walk itself is interop's.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDocument, encodeNaddr, KIND, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'

const relay = vi.hoisted(() => ({ events: [] as SignedEvent[] }))
/** A relay answering by the filter's fields, as the real one does; `limit` is not met here. */
const matches = (event: SignedEvent, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([key, wanted]) => {
    if (key === 'limit' || key === 'since' || key === 'until' || key === 'search') return true
    const values = wanted as (string | number)[]
    if (key === 'kinds') return values.includes(event.kind)
    if (key === 'authors') return values.includes(event.pubkey)
    if (key === 'ids') return values.includes(event.id)
    if (key.startsWith('#')) return event.tags.some((t) => t[0] === key.slice(1) && values.includes(t[1]))
    return true
  })
vi.mock('../relay/bridge', () => ({
  query: vi.fn(async (filters: Record<string, unknown>[]) => relay.events.filter((event) => filters.some((filter) => matches(event, filter)))),
  publish: vi.fn(async () => ({ ok: true })),
  viewerPubkey: () => 'a'.repeat(64),
}))

import { buildManifest } from '../manifest'
import { readDocument } from './save'

const LEAF = 'b'.repeat(64)
const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
let next = 0
const signed = (event: UnsignedEvent): SignedEvent => ({ ...event, id: String(++next).padStart(64, '0'), sig: '' }) as SignedEvent
const page = (id: string, parent?: string) => signed(buildDocument(LEAF, 1_760_000_000_000, { fileId: id, title: id, channelUuid: FOLDER, ...(parent ? { parent } : {}) }))
const addr = (id: string) => `${KIND.DOCUMENT}:${LEAF}:${id}`
const archive = (id: string, value: 'true' | '', at: number) =>
  signed({ kind: 1851, pubkey: LEAF, created_at: at, tags: [['a', addr(id)], ['field', 'archived'], ['value', value], ['h', FOLDER]], content: '' })
const naddrOf = (id: string) => encodeNaddr({ kind: KIND.DOCUMENT, pubkey: LEAF, identifier: id, relays: [] })

// A ⟵ B ⟵ C: C sits under B, which sits under A.
const pages = () => [page('A'), page('B', addr('A')), page('C', addr('B'))]

beforeEach(() => {
  relay.events = [signed(buildManifest(LEAF, 1_700_000_000_000)), ...pages()]
})

describe('a page under an archived page, at any depth', () => {
  it('is archived with its grandparent when only the grandparent is archived', async () => {
    relay.events.push(archive('A', 'true', 1_760_000_100))
    const c = await readDocument(naddrOf('C'))
    expect(c?.archived?.with).toBe(addr('A'))
  })

  it('names the closest archived page: B while A and B are both archived, then A once B is unarchived', async () => {
    relay.events.push(archive('A', 'true', 1_760_000_100), archive('B', 'true', 1_760_000_200))
    expect((await readDocument(naddrOf('C')))?.archived?.with).toBe(addr('B'))
    relay.events.push(archive('B', '', 1_760_000_300))
    expect((await readDocument(naddrOf('C')))?.archived?.with).toBe(addr('A'))
  })

  it('is open again once every page above it is unarchived', async () => {
    relay.events.push(archive('A', 'true', 1_760_000_100), archive('A', '', 1_760_000_200))
    expect((await readDocument(naddrOf('C')))?.archived).toBeUndefined()
  })
})
