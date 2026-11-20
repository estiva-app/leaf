/**
 * A page address Leaf writes reads back as the page it was written for, and the
 * links Ship and Peek write for a file open that file in Leaf (TES-4).
 *
 * Leaf writes a document's address as `/document/<slug>-<d>` and shows another
 * app's file at that app's own word (`ownerPathOf`; record
 * a-files-path-is-the-same-on-every-apps-host). Each must read back as the
 * same file whatever the title holds, and Leaf must never write an address it
 * cannot read back as the file it was written for.
 *
 * Runs 1,000 inputs a rule on a fixed seed; `FC_SEED` / `FC_RUNS` replay or
 * widen a run: `FC_SEED=<seed> npx vitest run src/route.property`.
 */
import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { objectRef } from '@estiva-app/interop'
import { documentPath, pagePath, routeOf } from './route'

// `fileAddress` reads manifests and files from the relay; the rules tested here read neither.
vi.mock('./relay/bridge', () => ({ query: async () => [] }))
const { lookupFor, ownerPathOf } = await import('./fileAddress')

const settings = {
  seed: process.env.FC_SEED ? Number(process.env.FC_SEED) : 20_261_120,
  numRuns: process.env.FC_RUNS ? Number(process.env.FC_RUNS) : 1000,
}
if (!Number.isSafeInteger(settings.seed) || !Number.isSafeInteger(settings.numRuns) || settings.numRuns < 1) {
  throw new Error(`FC_SEED and FC_RUNS must be whole numbers: ${process.env.FC_SEED} ${process.env.FC_RUNS}`)
}

// Ship's and Peek's manifests as they publish them (each repo's `scripts/publish-manifest.ts`).
const SHIP = {
  tags: [
    ['d', 'estiva-ship'], ['k', '30850'], ['k', '30851'], ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://ship.estiva.app/project/<slug>-<d>#block-<block>', '30850'],
    ['urls', 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>', '30851'],
    ['urls', 'https://ship.estiva.app/#/issue/<d>', '30851'],
  ],
}
const PEEK = {
  tags: [
    ['d', 'estiva-peek'], ['k', '30840'], ['web', 'https://peek.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>', '30840'],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>?thread=<id>', '1111'],
  ],
}
const MANIFESTS = [SHIP, PEEK]

const hex64 = fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 64, maxLength: 64 })
/** A title as a person types one: any script, emoji, punctuation, a uuid of its own. */
const titleArb = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 80 }),
  fc.string({ unit: fc.constantFrom('-', ' ', ':', '/', '#', '?', '%', 'a', 'f', '0', 'É', '中', '🙂'), maxLength: 60 }),
  fc.tuple(fc.string({ maxLength: 10 }), fc.uuid()).map(([a, u]) => `${a} ${u}`),
)
/** Any `d` another app could write: a uuid, or text with a colon, a slash, a dash. */
const anyDArb = fc.oneof(
  fc.uuid(),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }),
  fc.tuple(fc.constantFrom('team:', 'a/b-', 'x-', ''), fc.uuid()).map(([a, u]) => `${a}${u.toUpperCase()}`),
)

describe("Leaf's page addresses", () => {
  it("a document's address opens that document again, whatever its title", () => {
    fc.assert(
      fc.property(hex64, fc.uuid(), titleArb, (pubkey, d, title) => {
        const path = pagePath({ kind: 30842, address: `30842:${pubkey}:${d}`, title })
        expect(path).toBe(documentPath(d, title))
        expect(routeOf(path), path).toEqual({ page: 'document', d })
      }),
      settings,
    )
  })

  it("a document whose d an address cannot carry is opened by its naddr, never by an address that names nothing", () => {
    fc.assert(
      fc.property(hex64, anyDArb, titleArb, (pubkey, d, title) => {
        const path = pagePath({ kind: 30842, address: `30842:${pubkey}:${d}`, naddr: 'naddr1qqtest', title })
        const route = routeOf(path)
        if (route.page === 'document') expect(route.d, path).toBe(d)
        else expect(route, path).toEqual({ page: 'file', naddr: 'naddr1qqtest' })
      }),
      settings,
    )
  })

  it('a link Ship or Peek writes for a file opens that file and kind in Leaf', () => {
    fc.assert(
      fc.property(fc.uuid(), titleArb, fc.constantFrom(['issue', 30851], ['project', 30850]), (d, title, [word, kind]) => {
        const ref = objectRef(d, title)
        const route = routeOf(`/${word}/${ref}`)
        expect(route).toEqual({ page: 'path', word, ref })
        expect(lookupFor(word as string, ref, MANIFESTS)).toEqual({ by: 'd', identifier: d, kinds: [kind] })
        // Peek's topic, which Leaf opens as its own topic page (LTN-3).
        expect(routeOf(`/topic/${ref}`)).toEqual({ page: 'topic', d })
      }),
      settings,
    )
  })

  it("the address Leaf shows for another app's file opens that file, and none is written that would not", () => {
    fc.assert(
      fc.property(hex64, anyDArb, titleArb, fc.constantFrom(30850, 30851), (pubkey, d, title, kind) => {
        const file = { kind, address: `${kind}:${pubkey}:${d}`, openUrl: 'https://ship.estiva.app/o/naddr1x', slots: { title: { value: title } } }
        const path = ownerPathOf(file, MANIFESTS)
        if (path === undefined) return
        const route = routeOf(path)
        expect(route.page, path).toBe('path')
        if (route.page !== 'path') return
        expect(lookupFor(route.word, route.ref, MANIFESTS), path).toEqual({ by: 'd', identifier: d, kinds: [kind] })
      }),
      settings,
    )
  })

  it('any pasted path is read without throwing', () => {
    const pathArb = fc.oneof(
      fc.string({ unit: 'grapheme', maxLength: 60 }).map((s) => `/${s}`),
      fc
        .tuple(fc.constantFrom('document', 'topic', 'issue', 'f', 'new', 'x'), fc.string({ unit: fc.constantFrom('%', '2', 'F', 'a', '-', '/', '?', '#'), maxLength: 20 }))
        .map(([word, rest]) => `/${word}/${rest}`),
    )
    fc.assert(
      fc.property(pathArb, (path) => {
        expect(() => routeOf(path), path).not.toThrow()
      }),
      settings,
    )
  })
})
