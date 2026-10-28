import { afterEach, describe, expect, it, vi } from 'vitest'
import { BLOCK_DOCUMENT_FORMAT, BODY_SLOT, type FolderSummary, type ForeignObject } from '@estiva-app/interop'
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

const { archiveDocument, deleteDocument, moveDocument, moveFoldersFor, moveSourcesOf, moveTargetsIn, planDelete } = await import('./fileMenu')
const { deleteWords } = await import('../pages/DocumentMenu')

const page = (d: string, parent?: string, more: Partial<ForeignObject> = {}): ForeignObject =>
  ({
    kind: 30842,
    // An addressable file's `ref` is its address, which the move planner walks `parentRef` by.
    ref: `30842:${ME}:${d}`,
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

  it('on a page archived itself, does not count a page under it that was archived on its own, which stays archived', () => {
    const listing = [page('a'), page('b', 'a', { archived: { by: ME, at: 1, with: `30842:${ME}:a` } }), page('c', 'a', { archived: { by: ME, at: 1 } })]
    expect(deleteWords({ archived: { by: ME, at: 1 } }, planDelete(listing[0], listing, 'Leaf feedback'))).toBe('The 1 page under it comes back into Leaf feedback.')
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

const tags = (event: UnsignedEvent, name: string) => event.tags.filter((t) => t[0] === name).map((t) => t[1])
const folderOf = (id: string, name: string, more: Partial<FolderSummary> = {}) => ({ id, name, hasState: true, addresses: [], ...more }) as FolderSummary
const HERE = { id: FOLDER, name: 'QA', hasState: true, addresses: [`30842:${ME}:a`] }
const THERE = { id: OTHER_FOLDER, name: 'Steer', hasState: true }
/** A Ship project, which shares its text with Leaf: Leaf's sidebar draws it. */
const project = (d: string) =>
  ({
    kind: 30850,
    ref: `30850:${KAT}:${d}`,
    address: `30850:${KAT}:${d}`,
    folder: FOLDER,
    slots: { title: { value: d }, [BODY_SLOT]: { field: 'description' } },
    actions: [{ id: 'describe', control: 'text', field: 'description', format: BLOCK_DOCUMENT_FORMAT }],
  }) as unknown as ForeignObject
/** A Peek topic: no text, so Leaf's sidebar does not draw it. */
const topic = (d: string) => ({ kind: 30840, ref: `30840:${KAT}:${d}`, address: `30840:${KAT}:${d}`, folder: FOLDER, slots: { title: { value: d } }, actions: [] }) as unknown as ForeignObject

describe('moving a Leaf page', () => {
  it('to another Folder: one 1852 add there naming it and the page under it, then the remove here, then its place at the top', async () => {
    const listing = [page('p'), page('a', 'p', { scopedTo: FOLDER }), page('b', 'a')]
    const result = await moveDocument(listing[1], { from: [HERE], to: THERE, parent: '' }, async () => listing)
    expect(result).toEqual({ ok: true, stillIn: [] })
    expect(published.map((e) => [e.kind, tag(e, 'h'), tag(e, 'op')])).toEqual([
      [1852, OTHER_FOLDER, 'add'],
      [1852, FOLDER, 'remove'],
      [1851, FOLDER, undefined],
    ])
    expect(tags(published[0], 'a').sort()).toEqual([`30842:${ME}:a`, `30842:${ME}:b`])
    // Its place is a change on its own `parent`, in the Folder it was filed in: the `h` never moves.
    expect([tag(published[2], 'a'), tag(published[2], 'field'), tag(published[2], 'value')]).toEqual([`30842:${ME}:a`, 'parent', ''])
  })

  it('under another page in the same Folder: only the change of its place, naming that page', async () => {
    const listing = [page('a'), page('c')]
    await moveDocument(listing[0], { from: [HERE], to: HERE, parent: `30842:${ME}:c` }, async () => listing)
    expect(published.map((e) => [e.kind, tag(e, 'field'), tag(e, 'value'), tag(e, 'h')])).toEqual([[1851, 'parent', `30842:${ME}:c`, FOLDER]])
  })

  it('sends nothing more when the relay refuses the add, and says nothing was moved', async () => {
    answers = [{ ok: false, message: 'blocked' } as PublishResult]
    const result = await moveDocument(page('a', 'p'), { from: [HERE], to: THERE, parent: '' }, async () => [page('a', 'p')])
    expect(result).toEqual({ ok: false, reason: 'Nothing was moved. Try again.' })
    expect(published).toHaveLength(1)
  })

  it('names the Folder that still lists it when its remove is refused, and still gives it its new place', async () => {
    answers = [{ ok: true } as PublishResult, { ok: false, message: 'blocked' } as PublishResult]
    const result = await moveDocument(page('a', 'p'), { from: [HERE], to: THERE, parent: '' }, async () => [page('a', 'p')])
    expect(result).toEqual({ ok: true, stillIn: [HERE] })
    expect(published.map((e) => e.kind)).toEqual([1852, 1852, 1851])
  })

  it('refuses a private Folder for a page filed elsewhere, before anything is sent', async () => {
    const filed = page('a', undefined, { scopedTo: FOLDER })
    const result = await moveDocument(filed, { from: [HERE], to: { ...THERE, private: true }, parent: '' }, async () => [filed])
    expect(result).toEqual({ ok: false, reason: 'Can’t move this into a private Folder: it would stay readable by everyone who can read it now.' })
    expect(published).toHaveLength(0)
  })

  it('sends nothing when the Folder it is in cannot be read', async () => {
    const result = await moveDocument(page('a'), { from: [HERE], to: THERE, parent: '' }, async () => {
      throw new Error('busy')
    })
    expect(result.ok).toBe(false)
    expect(published).toHaveLength(0)
  })
})

describe('where Move may put a page', () => {
  it('offers the top and what Leaf’s sidebar draws — pages and a Ship project, by path — never a topic, the page or what is under it', () => {
    const listing = [page('a'), page('b', 'a'), project('plan'), page('spec', undefined, { parentRef: `30850:${KAT}:plan` }), topic('sync'), page('c')]
    const elsewhere = moveTargetsIn(listing, page('x'), { sameFolder: false })
    expect(elsewhere.map((t) => t.path.join(' › '))).toEqual(['', 'a', 'a › b', 'plan', 'plan › spec', 'c'])
    // At the top already, so the top is not offered; b is under it.
    const here = moveTargetsIn(listing, listing[0], { sameFolder: true })
    expect(here.map((t) => t.path.join(' › '))).toEqual(['plan', 'plan › spec', 'c'])
  })

  it('offers the Folder it is in and the others that take files, never a stateless one or someone else’s private one', () => {
    const folders = [
      folderOf(FOLDER, 'QA'),
      folderOf(OTHER_FOLDER, 'Steer'),
      folderOf('f-private', 'Board', { private: true }),
      folderOf('f-stateless', 'Chat', { hasState: false }),
    ]
    expect(moveFoldersFor(page('a'), FOLDER, folders).map((f) => f.name)).toEqual(['QA', 'Steer'])
  })

  it('takes where it is from the Folder states that list it, not from the Folder it was filed in', () => {
    const folders = [folderOf(FOLDER, 'QA'), folderOf(OTHER_FOLDER, 'Steer')]
    expect(moveSourcesOf(page('a'), [OTHER_FOLDER], folders).map((f) => [f.id, f.name])).toEqual([[OTHER_FOLDER, 'Steer']])
    expect(moveSourcesOf(page('a'), [], folders).map((f) => f.id)).toEqual([FOLDER])
  })
})
