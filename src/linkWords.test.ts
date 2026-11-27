/**
 * The link Leaf writes for a file (LIN-5): the shared writer's, so Copy link, the address bar and the sidebar give the
 * same `/<word>/<slug>-<d>` as Peek and Ship, and a manifest anyone may publish cannot point one of Leaf's own pages at
 * another app's file.
 */
import { addrToNaddr } from '@estiva-app/protocol'
import { describe, expect, it } from 'vitest'
import { leafLinkWordsOf } from './linkWords'
import { pagePath, routeOf } from './route'

const AUTHOR = 'e'.repeat(64)
const D = '7fd6a466-5c02-49e5-8cbc-0ce71ab32221'
const ISSUE = `30851:${AUTHOR}:${D}`

type Manifest = { pubkey: string; created_at: number; tags: string[][]; content: string }

/** The three manifests as production holds them (`kind:31990`, read off the relay on 27 Nov), Leaf's with its new `/o/`. */
const SHIP: Manifest = {
  pubkey: 'b'.repeat(64),
  created_at: 1_793_500_000,
  content: JSON.stringify({ projections: { 30850: {}, 30851: {} } }),
  tags: [
    ['d', 'estiva-ship'], ['k', '30850'], ['k', '30851'], ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://ship.estiva.app/project/<slug>-<d>#block-<block>', '30850'],
    ['urls', 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>', '30851'],
  ],
}
const PEEK: Manifest = {
  pubkey: 'a'.repeat(64),
  created_at: 1_793_000_000,
  content: JSON.stringify({ aspect: 'conversation' }),
  tags: [
    ['d', 'estiva-peek'], ['k', '30840'], ['web', 'https://peek.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>', '30840'],
  ],
}
const LEAF: Manifest = {
  pubkey: 'c'.repeat(64),
  created_at: 1_795_000_000,
  content: JSON.stringify({ projections: { 30842: {} } }),
  tags: [
    ['d', 'estiva-leaf'], ['k', '30842'], ['web', 'https://leaf.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://leaf.estiva.app/document/<slug>-<d>#block-<block>', '30842'],
  ],
}
const PRODUCTION = [LEAF, SHIP, PEEK]

/** A newer manifest claiming the issue's kind with `pattern` as its address. */
function planted(pattern: string): Manifest {
  return { ...SHIP, pubkey: 'f'.repeat(64), created_at: SHIP.created_at + 10, tags: [['d', 'x'], ['k', '30851'], ['web', 'https://elsewhere.example/o/<bech32>', 'naddr'], ['urls', pattern, '30851']] }
}

describe('the link Leaf writes for a file', () => {
  it('is the owner’s word and the title’s slug for every kind, as Ship and Peek write it', () => {
    const words = leafLinkWordsOf(PRODUCTION)
    expect(pagePath({ kind: 30851, address: ISSUE, title: 'Plan the launch' }, words)).toBe(`/issue/plan-the-launch-${D}`)
    expect(pagePath({ kind: 30850, address: `30850:${AUTHOR}:${D}`, title: 'Launch' }, words)).toBe(`/project/launch-${D}`)
    expect(pagePath({ kind: 30840, address: `30840:${AUTHOR}:${D}`, title: 'Ops' }, words)).toBe(`/topic/ops-${D}`)
    expect(pagePath({ kind: 30842, address: `30842:${AUTHOR}:${D}`, title: 'Notes' }, words)).toBe(`/document/notes-${D}`)
  })

  it.each([
    ['the old /f/', 'https://elsewhere.example/f/<slug>-<d>'],
    ['Leaf’s document page', 'https://elsewhere.example/document/<slug>-<d>'],
    ['the /o/ form', 'https://elsewhere.example/o/<slug>-<d>'],
    ['the server’s assets folder', 'https://elsewhere.example/assets/<slug>-<d>'],
  ])('falls back to the issue’s /o/ address when a newer manifest names %s as its word', (_, pattern) => {
    const path = pagePath({ kind: 30851, address: ISSUE, title: 'Plan' }, leafLinkWordsOf([planted(pattern), ...PRODUCTION]))
    expect(path).toBe(`/o/${addrToNaddr(ISSUE)}`)
    expect(routeOf(path)).toEqual({ page: 'file', naddr: addrToNaddr(ISSUE) })
  })

  it('keeps a document at /document/ when a newer manifest claims the document kind with another word', () => {
    const doc = { ...LEAF, pubkey: 'f'.repeat(64), created_at: LEAF.created_at + 10, tags: [['d', 'x'], ['k', '30842'], ['urls', 'https://elsewhere.example/doc/<slug>-<d>', '30842']] }
    expect(pagePath({ kind: 30842, address: `30842:${AUTHOR}:${D}`, title: 'Notes' }, leafLinkWordsOf([doc, ...PRODUCTION]))).toBe(`/document/notes-${D}`)
  })
})
