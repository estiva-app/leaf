import { KIND_FOLDER_STATE } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/*
  The tree's load against a relay that answers like production's (probed 26 Oct): each filter in full, so an event two
  filters match is sent twice. Before APP-2 the listing and every Folder's read each asked for every change, and a
  Weekly Plans load read 79 MB for 36.9 MB of changes.
*/

type Filter = Record<string, unknown>

const relay = vi.hoisted(() => ({ events: [] as SignedEvent[], sent: [] as SignedEvent[] }))

const matches = (f: Filter, e: SignedEvent) => {
  if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false
  if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false
  if (Array.isArray(f.ids) && !f.ids.includes(e.id)) return false
  if (typeof f.since === 'number' && e.created_at < f.since) return false
  if (typeof f.until === 'number' && e.created_at > f.until) return false
  for (const [key, want] of Object.entries(f)) {
    if (!key.startsWith('#')) continue
    const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
    if (!(want as string[]).some((v) => held.includes(v))) return false
  }
  return true
}

vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => 'a'.repeat(64),
  publish: async () => ({ ok: true }),
  query: async (filters: Filter[]) => {
    const out = filters.flatMap((f) =>
      relay.events
        .filter((e) => matches(f, e))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, typeof f.limit === 'number' ? f.limit : Infinity),
    )
    relay.sent.push(...out)
    return out
  },
}))

const { useWorkspace } = await import('./useWorkspace')

const KEEPER = 'a'.repeat(64)
const RELAY = 'f'.repeat(64)
const APIARY = '7b32200c-e4c0-4216-b79a-8490fc05e0bd'
const ORCHARD = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const HIVE = 30871

let seq = 0
const event = (partial: Partial<SignedEvent> & Pick<SignedEvent, 'kind'>): SignedEvent => ({
  id: String(++seq).padStart(64, '0'),
  sig: '',
  pubkey: KEEPER,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  ...partial,
})

const hiveLog = event({
  kind: 31990,
  tags: [['d', 'hive-log'], ['k', String(HIVE)]],
  content: JSON.stringify({
    name: 'Hive log',
    records: {
      changeKind: 1851,
      targetTag: 'a',
      fieldTag: 'field',
      valueTag: 'value',
      order: ['ts', 'created_at', 'id'],
      rule: 'last-write-wins-per-field',
    },
    projections: { [HIVE]: { widget: 'card', slots: { title: { tag: 'title' }, status: { fold: 'status' } } } },
  }),
})
const addressOf = (e: SignedEvent) => `${e.kind}:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')![1]}`
const channelOf = (id: string, name: string) => event({ kind: 39000, pubkey: RELAY, tags: [['d', id], ['name', name]] })
const stateOf = (id: string, name: string, files: SignedEvent[]) =>
  event({ kind: KIND_FOLDER_STATE, pubkey: RELAY, tags: [['d', id], ['name', name], ...files.map((f) => ['a', addressOf(f)])] })
const hive = (d: string, folder: string) => event({ kind: HIVE, tags: [['d', d], ['title', `${d} hive`], ['h', folder]] })
const change = (file: SignedEvent, field: string, value: string, folder: string) =>
  event({ kind: 1851, tags: [['a', addressOf(file)], ['field', field], ['value', value], ['h', folder]] })

const north = hive('north', APIARY)
const south = hive('south', APIARY)
const pear = hive('pear', ORCHARD)
const changes = [
  change(north, 'status', 'queen seen', APIARY),
  change(north, 'status', 'swarming', APIARY),
  change(south, 'status', 'quiet', APIARY),
  change(pear, 'status', 'in bloom', ORCHARD),
]
const world = () => [
  hiveLog,
  channelOf(APIARY, 'Apiary'),
  channelOf(ORCHARD, 'Orchard'),
  stateOf(APIARY, 'Apiary', [north, south]),
  stateOf(ORCHARD, 'Orchard', [pear]),
  north,
  south,
  pear,
  ...changes,
]

const timesSent = (e: SignedEvent) => relay.sent.filter((s) => s.id === e.id).length
const statusOf = (workspace: ReturnType<typeof useWorkspace>, folder: string, ref: string) =>
  workspace.folders
    ?.find((f) => f.folder.id === folder)
    ?.contents?.files.find((file) => file.ref === ref)
    ?.slots.status?.value

async function loaded() {
  const view = renderHook(() => useWorkspace())
  // A whole load runs every interop read; the default 1 s is short for it when the suite runs in parallel.
  await waitFor(() => expect(view.result.current.folders?.every((f) => f.contents)).toBe(true), { timeout: 4000 })
  return view
}

describe('the tree reads each change once per load', () => {
  it('the listing and every Folder’s contents get each change from the relay once between them', async () => {
    relay.events = world()
    relay.sent = []
    const { result } = await loaded()
    expect(changes.map(timesSent)).toEqual(changes.map(() => 1))
    expect(statusOf(result.current, APIARY, addressOf(north))).toBe('swarming')
    expect(statusOf(result.current, ORCHARD, addressOf(pear))).toBe('in bloom')
  })

  it('a reload reads afresh: a change made since the last load shows', async () => {
    relay.events = world()
    relay.sent = []
    const { result } = await loaded()
    relay.events.push(change(north, 'status', 'requeened', APIARY))
    await act(() => result.current.reload())
    expect(statusOf(result.current, APIARY, addressOf(north))).toBe('requeened')
  })
})
