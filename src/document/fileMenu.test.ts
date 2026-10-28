import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import type { PublishResult, UnsignedEvent } from '@estiva-app/protocol'

const ME = 'a'.repeat(64)
const KAT = 'c'.repeat(64)
const RELAY = 'd'.repeat(64)
const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const OTHER_FOLDER = '11111111-1111-4111-8111-111111111111'

const published: UnsignedEvent[] = []
let answers: PublishResult[] = []
let viewer = ME
/* The Folder states naming the document, and who signed each Folder's channel record. */
let states: { d: string; pubkey: string }[] = []

vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => viewer,
  query: async (filters: { kinds?: number[]; '#d'?: string[] }[]) => {
    const [filter] = filters
    if (filter.kinds?.[0] === 30890) return states.map(({ d, pubkey }) => ({ kind: 30890, pubkey, tags: [['d', d]], content: '', created_at: 1, id: d, sig: '' }))
    if (filter.kinds?.[0] === 39000) return (filter['#d'] ?? []).map((d) => ({ kind: 39000, pubkey: RELAY, tags: [['d', d]], content: '', created_at: 1, id: `c-${d}`, sig: '' }))
    return []
  },
  publish: async (event: UnsignedEvent) => {
    published.push(event)
    return answers.shift() ?? { ok: true }
  },
}))

const { archiveDocument, deleteDocument, planDelete } = await import('./fileMenu')
const { deleteWords } = await import('../pages/DocumentMenu')

const page = (d: string, parent?: string, more: Partial<ForeignObject> = {}): ForeignObject =>
  ({
    kind: 30842,
    ref: d,
    address: `30842:${ME}:${d}`,
    folder: FOLDER,
    parentRef: parent ? `30842:${ME}:${parent}` : undefined,
    parentField: 'parent',
    slots: { title: { value: d } },
    actions: [],
    ...more,
  }) as unknown as ForeignObject
const tag = (event: UnsignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

afterEach(() => {
  published.length = 0
  answers = []
  viewer = ME
  states = []
})

describe('deleting a Leaf page', () => {
  it('sends the kind:5, then the 1852 remove from its Folder, then moves each page under it up to the Folder top, in that order', async () => {
    states = [{ d: FOLDER, pubkey: RELAY }]
    const listing = [page('a'), page('b', 'a'), page('c', 'a', { folder: OTHER_FOLDER }), page('d', 'b')]
    const plan = planDelete(listing[0], listing, 'Leaf feedback')
    const result = await deleteDocument(listing[0], plan)
    expect(result).toEqual({ ok: true, stillListed: false, unmoved: 0 })
    expect(published.map((e) => e.kind)).toEqual([5, 1852, 1851, 1851])
    expect(published[0].tags).toContainEqual(['a', `30842:${ME}:a`])
    expect([tag(published[1], 'h'), tag(published[1], 'op'), tag(published[1], 'a')]).toEqual([FOLDER, 'remove', `30842:${ME}:a`])
    // Only the direct children move; each in its own Folder, to the top ('').
    const moves = published.slice(2)
    expect(moves.map((e) => [tag(e, 'a'), tag(e, 'field'), tag(e, 'value'), tag(e, 'h')])).toEqual([
      [`30842:${ME}:b`, 'parent', '', FOLDER],
      [`30842:${ME}:c`, 'parent', '', OTHER_FOLDER],
    ])
  })

  it("moves the pages under a page that sits under another page up one level, under that page", async () => {
    const listing = [page('top'), page('b', 'top'), page('c', 'b')]
    const plan = planDelete(listing[1], listing)
    await deleteDocument(listing[1], plan)
    const move = published.find((e) => e.kind === 1851)!
    expect([tag(move, 'a'), tag(move, 'value')]).toEqual([`30842:${ME}:c`, `30842:${ME}:top`])
  })

  it('writes nothing more when the relay refuses the kind:5, and says only the writer may delete', async () => {
    viewer = KAT
    states = [{ d: FOLDER, pubkey: RELAY }]
    answers = [{ ok: false, reason: 'blocked: only the author may delete' }]
    const listing = [page('a'), page('b', 'a')]
    const result = await deleteDocument(listing[0], planDelete(listing[0], listing))
    expect(result).toEqual({ ok: false, reason: 'Delete rejected — only the person who wrote it can delete it.' })
    expect(published.map((e) => e.kind)).toEqual([5])
  })

  it('never unlists from a Folder state someone other than its Folder’s signer wrote', async () => {
    states = [{ d: FOLDER, pubkey: KAT }]
    const listing = [page('a')]
    await deleteDocument(listing[0], planDelete(listing[0], listing))
    expect(published.map((e) => e.kind)).toEqual([5])
  })

  it('counts a page under it the relay refused to move, which stays at the Folder top', async () => {
    answers = [{ ok: true }, { ok: false, reason: 'blocked' }]
    const listing = [page('a'), page('b', 'a'), page('c', 'a')]
    const result = await deleteDocument(listing[0], planDelete(listing[0], listing))
    expect(result).toEqual({ ok: true, stillListed: false, unmoved: 1 })
  })
})

describe('the Delete dialog’s words for the pages under it', () => {
  it('says how many pages move up, and into which Folder', () => {
    const listing = [page('a'), page('b', 'a')]
    expect(deleteWords(listing[0], planDelete(listing[0], listing, 'Leaf feedback'))).toBe('The 1 page under it moves up into Leaf feedback.')
  })

  it('names the page above as where they move, for a page under a page', () => {
    const listing = [page('Plans'), page('b', 'Plans'), page('c', 'b'), page('d', 'b')]
    expect(deleteWords(listing[1], planDelete(listing[1], listing, 'Leaf feedback'))).toBe('The 2 pages under it move up into Plans.')
  })

  it('on a page archived itself, says the pages archived with it come back, and never that anything is erased', () => {
    const listing = [page('a'), page('b', 'a'), page('c', 'a')]
    const words = deleteWords({ archived: { by: ME, at: 1 } }, planDelete(listing[0], listing, 'Leaf feedback'))
    expect(words).toBe('The 2 pages under it come back into Leaf feedback.')
    expect(words).not.toMatch(/erase/i)
  })

  it('says nothing about pages when none is under it', () => {
    const listing = [page('a')]
    expect(deleteWords(listing[0], planDelete(listing[0], listing, 'Leaf feedback'))).toBe('')
  })
})

describe('archiving a Leaf page', () => {
  it('is one 1851 on `archived` in its own Folder, carrying the resolution as content', async () => {
    expect(await archiveDocument(page('a'), true, 'Moved to the wiki')).toEqual({ ok: true })
    expect(published).toHaveLength(1)
    const [change] = published
    expect([change.kind, tag(change, 'a'), tag(change, 'field'), tag(change, 'value'), tag(change, 'h'), change.content]).toEqual([
      1851,
      `30842:${ME}:a`,
      'archived',
      'true',
      FOLDER,
      'Moved to the wiki',
    ])
  })

  it('unarchives with an empty value and no resolution', async () => {
    await archiveDocument(page('a'), false, 'ignored')
    expect([tag(published[0], 'value'), published[0].content]).toEqual(['', ''])
  })
})
