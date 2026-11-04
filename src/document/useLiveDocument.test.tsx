/**
 * An open page archived with a page above it opens again without a reload when that page is unarchived (PEEKM-8),
 * whether the unarchive is written in the page's own Folder or in another one, as a Ship project's is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ForeignObject } from '@estiva-app/interop'
import { buildDocument, encodeNaddr, KIND, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'

const relay = vi.hoisted(() => ({ events: [] as SignedEvent[] }))
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
/* The tab's one connection: each Folder watch's listener, by Folder, so a test delivers an event where it arrives. */
const live = vi.hoisted(() => ({ watches: [] as { folders: string[]; listener: (folder: string, event?: SignedEvent) => void }[] }))
vi.mock('../relay/client', () => ({
  relayClient: () => ({
    watchFolders: (folders: string[], listener: (folder: string, event?: SignedEvent) => void) => {
      const watch = { folders, listener }
      live.watches.push(watch)
      return { stop: () => void live.watches.splice(live.watches.indexOf(watch), 1) }
    },
  }),
}))

/* A save merged onto someone's, as save.ts announces it (its own test covers when it does): each page's listener. */
const merges = vi.hoisted(() => [] as ((address: string) => void)[])
vi.mock('./save', async (actual) => ({
  ...(await actual<typeof import('./save')>()),
  onMerged: (listener: (address: string) => void) => {
    merges.push(listener)
    return () => void merges.splice(merges.indexOf(listener), 1)
  },
}))

import { buildManifest } from '../manifest'
import { readDocument } from './save'
import { useLiveDocument } from './useLiveDocument'

const LEAF = 'b'.repeat(64)
const HERE = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const THERE = '7c1f1a52-3b0e-4d8e-9a55-0f3f6b0c2d11'
let next = 0
const signed = (event: UnsignedEvent): SignedEvent => ({ ...event, id: String(++next).padStart(64, '0'), sig: '' }) as SignedEvent
const addr = (id: string) => `${KIND.DOCUMENT}:${LEAF}:${id}`
const page = (id: string, folder: string, parent?: string) => signed(buildDocument(LEAF, 1_760_000_000_000, { fileId: id, title: id, channelUuid: folder, ...(parent ? { parent } : {}) }))
const archive = (id: string, value: 'true' | '', folder: string, at: number) =>
  signed({ kind: 1851, pubkey: LEAF, created_at: at, tags: [['a', addr(id)], ['field', 'archived'], ['value', value], ['h', folder]], content: '' })
const naddrOf = (id: string) => encodeNaddr({ kind: KIND.DOCUMENT, pubkey: LEAF, identifier: id, relays: [] })

/** The hook opened on `opened`, once its own first read is in: what it finds after is from what arrives live. */
async function opens(opened: ForeignObject) {
  const hook = renderHook(() => useLiveDocument(opened))
  await act(async () => void (await readDocument(opened.naddr!)))
  return hook
}

/** An event arriving live in `folder`, then the hook's burst wait. */
async function arrives(folder: string, event: SignedEvent) {
  relay.events.push(event)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    act(() => live.watches.filter((w) => w.folders.includes(folder)).forEach((w) => w.listener(folder, event)))
    await act(() => vi.advanceTimersByTimeAsync(300))
  } finally {
    vi.useRealTimers()
  }
}

afterEach(() => {
  live.watches.length = 0
  merges.length = 0
})

describe('an open page whose save merged onto someone else’s', () => {
  it('shows the merged text with nothing arriving live, and ignores a merge of another page', async () => {
    relay.events = [signed(buildManifest(LEAF, 1_700_000_000_000)), page('C', HERE)]
    const { result } = await opens((await readDocument(naddrOf('C')))!)
    relay.events.push(signed({ kind: 1851, pubkey: LEAF, created_at: 1_760_000_300, tags: [['a', addr('C')], ['field', 'description'], ['value', 'Mine merged onto theirs'], ['h', HERE]], content: '' }))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() => merges.forEach((heard) => heard(addr('D'))))
      await act(() => vi.advanceTimersByTimeAsync(300))
      expect(result.current.file.slots.body?.value ?? '').not.toContain('Mine merged')
      act(() => merges.forEach((heard) => heard(addr('C'))))
      await act(() => vi.advanceTimersByTimeAsync(300))
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(result.current.file.slots.body?.value ?? '').toContain('Mine merged onto theirs'))
  })
})

describe('an open page archived with the page above it', () => {
  it('opens again without a reload when that page, in the same Folder, is unarchived', async () => {
    relay.events = [signed(buildManifest(LEAF, 1_700_000_000_000)), page('A', HERE), page('B', HERE, addr('A')), archive('A', 'true', HERE, 1_760_000_100)]
    const opened = (await readDocument(naddrOf('B')))!
    expect(opened.archived?.with).toBe(addr('A'))
    const { result } = await opens(opened)
    await arrives(HERE, archive('A', '', HERE, 1_760_000_200))
    await waitFor(() => expect(result.current.file.archived).toBeUndefined())
  })

  it('opens again without a reload when that page’s unarchive is written in another Folder', async () => {
    relay.events = [signed(buildManifest(LEAF, 1_700_000_000_000)), page('A', THERE), page('B', HERE, addr('A')), archive('A', 'true', THERE, 1_760_000_100)]
    const opened = (await readDocument(naddrOf('B')))!
    expect(opened.archived?.with).toBe(addr('A'))
    const { result } = await opens(opened)
    await waitFor(() => expect(live.watches.some((w) => w.folders.includes(THERE))).toBe(true))
    await arrives(THERE, archive('A', '', THERE, 1_760_000_200))
    await waitFor(() => expect(result.current.file.archived).toBeUndefined())
  })
})
