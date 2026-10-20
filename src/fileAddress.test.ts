/**
 * Another app's path on Leaf's host (RFC 0.5 §7.7): which file `/<word>/<ref>` names, read off the manifests the
 * relay holds, and which path Leaf's address bar shows for another app's file.
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const MIKY = 'a'.repeat(64)
const MALLORY = 'e'.repeat(64)
const D = '7fd6a466-5c02-49e5-8cbc-0ce71ab32221'

function manifest(pubkey: string, tags: string[][]): SignedEvent {
  return { id: pubkey.slice(0, 63) + '1', sig: '0'.repeat(128), pubkey, kind: 31990, created_at: 1, tags, content: '{}' }
}
// Ship's and Peek's manifests as they publish them (estiva-ship `src/nostr/manifest.ts`, peek-app `scripts/publish-manifest.ts`).
const SHIP = manifest('b'.repeat(64), [
  ['d', 'estiva-ship'], ['k', '30850'], ['k', '30851'], ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'],
  ['urls', 'https://ship.estiva.app/project/<slug>-<d>#block-<block>', '30850'],
  ['urls', 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>', '30851'],
  ['urls', 'https://ship.estiva.app/#/project/<d>', '30850'],
  ['urls', 'https://ship.estiva.app/#/issue/<d>', '30851'],
])
const PEEK = manifest('c'.repeat(64), [
  ['d', 'estiva-peek'], ['k', '30840'], ['web', 'https://peek.estiva.app/o/<bech32>', 'naddr'],
  ['urls', 'https://peek.estiva.app/topic/<slug>-<d>', '30840'],
  ['urls', 'https://peek.estiva.app/topic/<slug>-<d>?thread=<id>', '1111'],
  ['urls', 'https://peek.estiva.app/message/<id>', '9'],
])

// Read once per tab (`relay/manifests.ts`), so every test here sees these two.
const manifests: SignedEvent[] = [SHIP, PEEK]
let held: SignedEvent[] = []
const asked: Record<string, unknown>[] = []
vi.mock('./relay/bridge', () => ({
  query: async (filters: Record<string, unknown>[]) => {
    const [filter] = filters
    asked.push(filter)
    if ((filter.kinds as number[]).includes(31990)) return manifests
    const ds = filter['#d'] as string[]
    return held.filter((e) => (filter.kinds as number[]).includes(e.kind) && e.tags.some((t) => t[0] === 'd' && ds.includes(t[1])))
  },
}))

function root(kind: number, pubkey: string, d: string): SignedEvent {
  return { id: `${kind}${pubkey}`.slice(0, 64), sig: '0'.repeat(128), pubkey, kind, created_at: 1, tags: [['d', d]], content: '' }
}

const { addressOfPath, ownerPathOf } = await import('./fileAddress')

beforeEach(() => {
  held = []
  asked.length = 0
})

describe('the file another app’s path names on Leaf’s host', () => {
  it('reads Ship’s /issue/ as a Ship issue, with or without its slug', async () => {
    held = [root(30851, MIKY, D)]
    expect(await addressOfPath('issue', D)).toBe(`30851:${MIKY}:${D}`)
    expect(await addressOfPath('issue', `a-stale-title-${D}`)).toBe(`30851:${MIKY}:${D}`)
    expect(asked.at(-1)).toMatchObject({ kinds: [30851], '#d': [D], limit: 2 })
  })

  it('reads Peek’s /topic/ as a topic, from Peek’s manifest and no list of words in Leaf', async () => {
    held = [root(30840, MIKY, D)]
    expect(await addressOfPath('topic', D)).toBe(`30840:${MIKY}:${D}`)
    expect(asked.at(-1)).toMatchObject({ kinds: [30840] })
  })

  it('names nothing when two authors hold the `d`, so a copy cannot take the original’s address', async () => {
    held = [root(30851, MIKY, D), root(30851, MALLORY, D)]
    expect(await addressOfPath('issue', D)).toBeNull()
  })

  it('looks a word nobody declares up under every declared kind, never a bare `d`', async () => {
    held = [root(30850, MIKY, D)]
    expect(await addressOfPath('ticket', D)).toBe(`30850:${MIKY}:${D}`)
    expect((asked.at(-1)?.kinds as number[]).sort()).toEqual([30840, 30850, 30851])
  })

  it('names no file for a message’s path, nor for one with no identity in it', async () => {
    expect(await addressOfPath('message', 'f'.repeat(64))).toBeNull()
    expect(await addressOfPath('issue', 'no-identity-here')).toBeNull()
  })
})

describe('the path Leaf shows for another app’s file', () => {
  const issue = { kind: 30851, address: `30851:${MIKY}:${D}`, openUrl: 'https://ship.estiva.app/o/naddr1x', slots: { title: { value: 'Plan the launch' } } }

  it('is its own app’s word on Leaf’s host, with the slug of its title', () => {
    expect(ownerPathOf(issue, [SHIP, PEEK])).toBe(`/issue/plan-the-launch-${D}`)
  })

  it('takes the word from the app its "Open in" goes to, not from another manifest claiming the kind', () => {
    const planted = manifest(MALLORY, [['d', 'x'], ['k', '30851'], ['web', 'https://elsewhere.example/o/<bech32>', 'naddr'], ['urls', 'https://elsewhere.example/ticket/<slug>-<d>', '30851']])
    expect(ownerPathOf(issue, [planted, SHIP])).toBe(`/issue/plan-the-launch-${D}`)
    expect(ownerPathOf({ ...issue, openUrl: 'https://unknown.example/o/naddr1x' }, [planted, SHIP])).toBeUndefined()
  })

  it.each([
    ['Leaf’s own page word, which would read every such file as not found', 'https://ship.estiva.app/document/<slug>-<d>'],
    ['a word the URL parser takes for another origin', 'https://ship.estiva.app/\\evil.example/<slug>-<d>'],
  ])('is not written to the bar when the opener’s manifest names %s', (_, pattern) => {
    const opener = manifest(MALLORY, [['d', 'x'], ['k', '30851'], ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'], ['urls', pattern, '30851']])
    expect(ownerPathOf(issue, [opener])).toBeUndefined()
  })
})

/*
  A path two shapes read as different kinds is looked up under exactly those
  kinds (SPEC §7.7, LTX-6), never every kind the app handles: the one-author
  rule then decides, and a kind no shape names for the path cannot answer it.
*/
describe('the kinds a path read as several kinds is looked up under', () => {
  const wiki = manifest('d'.repeat(64), [
    ['d', 'wiki'],
    ['k', '30851'],
    ['k', '30023'],
    ['k', '30842'],
    ['web', 'https://wiki.example/o/<bech32>', 'naddr'],
    ['urls', 'https://wiki.example/issue/<slug>-<d>', '30851'],
    ['urls', 'https://wiki.example/issue/<slug>-<d>', '30023'],
  ])

  it('asks the kinds the shapes name, not a third the app also handles', async () => {
    const { lookupFor } = await import('./fileAddress')
    expect(lookupFor('issue', `plan-${D}`, [wiki])?.kinds.sort()).toEqual([30023, 30851])
  })
})
