/**
 * A page under a parent that was archived and then deleted still reads as archived with that parent (SPEC §6.5,
 * aa0ddf0c). The list read leaves a deleted file out, so the parent is found only by the relay's times read, which
 * Leaf's bridge hands interop on its query. The bridge is real here; only the relay's HTTP answer is faked.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildDocument, encodeNaddr, KIND, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { relayAnswer, timesAnswer } from '../test/listRead'

vi.mock('../config', () => ({
  ID_CONFIG: { base: 'https://id.estiva.app', clientId: 'estiva-leaf' },
  APP_TITLE: 'Leaf',
  RELAY_URL: 'https://estiva.estiva.app',
}))
vi.mock('../auth/estivaId', () => ({
  heldToken: () => ({ accessToken: 'at', pubkey: 'a'.repeat(64), expiresAt: Date.now() + 3_600_000 }),
  renew: vi.fn(),
  sessionEnded: vi.fn(),
}))
// Signed here, not by Estiva ID: only the relay's answer is under test.
vi.mock('@estiva-app/identity', async (original) => ({
  ...(await original<object>()),
  estivaIdSigner: () => ({
    pubkey: 'a'.repeat(64),
    sign: async (event: Record<string, unknown>) => ({ created_at: 1, ...event, pubkey: 'a'.repeat(64), id: 'e'.repeat(64), sig: 's'.repeat(128) }),
  }),
}))

import { buildManifest } from '../manifest'
import { readDocument } from './save'

const LEAF = 'b'.repeat(64)
const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
let next = 0
const signed = (event: UnsignedEvent): SignedEvent => ({ ...event, id: String(++next).padStart(64, '0'), sig: '' }) as SignedEvent
const uuidOf = (letter: string) => `00000000-0000-4000-8000-${letter.charCodeAt(0).toString(16).padStart(12, '0')}`
const addr = (id: string) => `${KIND.DOCUMENT}:${LEAF}:${uuidOf(id)}`
const page = (id: string, parent?: string) => signed(buildDocument(LEAF, 1_760_000_000_000, { fileId: uuidOf(id), title: id, channelUuid: FOLDER, ...(parent ? { parent } : {}) }))
const change = (id: string, field: 'archived' | 'deleted', at: number) =>
  signed({ kind: 1851, pubkey: LEAF, created_at: at, tags: [['a', addr(id)], ['field', field], ['value', 'true'], ['h', FOLDER]], content: '' })
const naddrOf = (id: string) => encodeNaddr({ kind: KIND.DOCUMENT, pubkey: LEAF, identifier: uuidOf(id), relays: [] })

let events: SignedEvent[] = []
/** The relay over HTTP: the times read answered by `{ times }`, every other read by its events, as SPEC §6.13 says. */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { method: string; body?: string }) => {
    if (init.method === 'GET') return new Response(JSON.stringify({ file_list: { fields: ['newest', 'times'] } }), { status: 200 })
    const filters = JSON.parse(init.body ?? '[]') as Record<string, unknown>[]
    const body = filters.every((f) => f.fields === 'times') ? { times: timesAnswer(events, filters) } : { events: relayAnswer(events, filters) }
    return new Response(JSON.stringify(body), { status: 200 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

it('a page under a parent archived and then deleted reads as archived with that parent, found by the times read', async () => {
  // A ⟵ C: A is archived, then deleted, so the list read no longer answers it.
  events = [signed(buildManifest(LEAF, 1_700_000_000_000)), page('A'), page('C', addr('A')), change('A', 'archived', 1_760_000_100), change('A', 'deleted', 1_760_000_200)]
  const c = await readDocument(naddrOf('C'))
  expect(c?.archived?.with).toBe(addr('A'))
})
