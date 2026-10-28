import { resolveManifest } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A page's manifest reads, answered from the tab's one read of every manifest (APP-3). The relay is a fake that
 * answers the filters it is asked as a relay would and records each request, so the tests read what went on the wire.
 */
const relay = vi.hoisted(() => ({
  events: [] as SignedEvent[],
  asked: [] as Record<string, unknown>[][],
  refuse: null as null | ((filters: Record<string, unknown>[]) => boolean),
}))
vi.mock('./bridge', () => ({
  query: async (filters: Record<string, unknown>[]) => {
    relay.asked.push(filters)
    if (relay.refuse?.(filters)) throw new Error('refused')
    const found = new Map<string, SignedEvent>()
    for (const f of filters) {
      const hits = relay.events
        .filter((e) => (f.kinds as number[]).includes(e.kind))
        .filter((e) => !f.authors || (f.authors as string[]).includes(e.pubkey))
        .filter((e) =>
          Object.entries(f).every(([k, v]) => !k.startsWith('#') || e.tags.some((t) => t[0] === k.slice(1) && (v as string[]).includes(t[1]))),
        )
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, (f.limit as number) ?? Infinity)
      for (const e of hits) found.set(e.id, e)
    }
    return [...found.values()]
  },
}))

const LEAF = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const AUTHOR = 'c'.repeat(64)

function manifest(pubkey: string, d: string, name: string, createdAt: number, kinds: string[]): SignedEvent {
  const projections = Object.fromEntries(kinds.map((k) => [k, { noun: 'page', slots: {} }]))
  return {
    id: `${pubkey.slice(0, 4)}-${d}-${createdAt}`,
    pubkey,
    kind: 31990,
    created_at: createdAt,
    content: JSON.stringify({ name, projections }),
    tags: [['d', d], ...kinds.map((k) => ['k', k])],
    sig: '',
  }
}

const pointer = { kind: 30842, pubkey: AUTHOR, identifier: 'weekly-plans', relays: [] }
const declaredReads = () => relay.asked.filter((f) => f.length === 1 && f[0].kinds?.toString() === '31990' && f[0].limit === 500)
const manifestReads = () => relay.asked.filter((f) => f.some((x) => (x.kinds as number[]).includes(31990)))

beforeEach(() => {
  relay.events = [manifest(OTHER, 'notes', 'Older notes', 100, ['30842']), manifest(LEAF, 'leaf', 'Leaf', 200, ['30842'])]
  relay.asked = []
  relay.refuse = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

describe("a page's manifest, from the tab's read of every manifest", () => {
  it('asks the relay for manifests once, however many resolves need one', async () => {
    const { resolveQuery } = await import('./manifests')
    const first = await resolveManifest(pointer, resolveQuery)
    await resolveManifest({ ...pointer, pubkey: OTHER }, resolveQuery)
    expect(first?.manifest.name).toBe('Leaf')
    expect(manifestReads()).toEqual(declaredReads())
    expect(declaredReads()).toHaveLength(1)
  })

  it('picks the newest manifest claiming the kind, as the relay answer did', async () => {
    relay.events.push(manifest(OTHER, 'notes-2', 'Newest notes', 300, ['30842']))
    const { resolveQuery } = await import('./manifests')
    expect((await resolveManifest(pointer, resolveQuery))?.manifest.name).toBe('Newest notes')
    // A limit keeps the newest, as the relay's does.
    const kept = await resolveQuery([{ kinds: [31990], '#k': ['30842'], limit: 2 }])
    expect(kept.map((e) => e.created_at).sort()).toEqual([200, 300])
  })

  it('still finds the manifest on the relay when the tab could not read them all', async () => {
    relay.refuse = (filters) => filters[0].limit === 500
    const { resolveQuery } = await import('./manifests')
    expect((await resolveManifest(pointer, resolveQuery))?.manifest.name).toBe('Leaf')
    expect(relay.asked.some((f) => f[0]['#k'] !== undefined)).toBe(true)
  })

  it('asks the relay when the tab read as many manifests as it asks for, since more may exist', async () => {
    relay.events = Array.from({ length: 500 }, (_, i) => manifest(OTHER, `app-${i}`, `App ${i}`, i + 1, ['1']))
    // The oldest, so a read of the 500 newest leaves it out.
    relay.events.push(manifest(LEAF, 'leaf', 'Leaf', 0, ['30842']))
    const { resolveQuery } = await import('./manifests')
    expect((await resolveManifest(pointer, resolveQuery))?.manifest.name).toBe('Leaf')
  })

  it('sees a republished manifest once the projection cache would have asked again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { resolveQuery } = await import('./manifests')
    await resolveQuery([{ kinds: [31990], '#k': ['30842'], limit: 20 }])
    relay.events.push(manifest(OTHER, 'notes-2', 'Newest notes', 300, ['30842']))
    vi.advanceTimersByTime(5 * 60_000 + 1)
    const [newest] = await resolveQuery([{ kinds: [31990], '#k': ['30842'], limit: 1 }])
    expect(newest.pubkey).toBe(OTHER)
    expect(declaredReads()).toHaveLength(2)
  })

  it('sends every other read to the relay as asked', async () => {
    const { resolveQuery } = await import('./manifests')
    const filters = [{ kinds: [30842], authors: [AUTHOR], '#d': ['weekly-plans'], limit: 1 }]
    await resolveQuery(filters)
    expect(relay.asked).toEqual([filters])
  })
})
