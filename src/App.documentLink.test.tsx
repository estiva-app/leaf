/**
 * A document's link, `/document/<slug>-<d>`: what Copy link gives out and every
 * app reads (SPEC §7.7). It opens the page; the old `/f/<naddr>` link still
 * does, and gives way to the new one; a `d` two authors hold opens nothing.
 */
import { BODY_SLOT, type FolderContents, type FolderSummary, type ForeignObject } from '@estiva-app/interop'
import { descriptionTextToBlockDocument, serializeBlockDocument, type PublishResult } from '@estiva-app/protocol'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** What the relay holds outside any listing (an archived page), and what reading each `naddr` on its own gives. */
/**
 * Also: each `d` asked for, and a gate the Folder reads wait on, so a test can hold the tree while the page is read.
 */
const relay = vi.hoisted(() => ({
  documents: [] as { kind: number; pubkey: string; d: string }[],
  read: {} as Record<string, unknown>,
  askedD: [] as string[],
  tree: null as Promise<void> | null,
}))

vi.mock('./relay/bridge', () => ({
  viewerPubkey: () => 'a'.repeat(64),
  query: async (filters: { kinds?: number[]; '#d'?: string[] }[]) => {
    for (const f of filters) relay.askedD.push(...(f['#d'] ?? []))
    return relay.documents
      .filter((e) => filters.some((f) => f.kinds?.includes(e.kind) && f['#d']?.includes(e.d)))
      .map((e) => ({ id: e.pubkey, kind: e.kind, pubkey: e.pubkey, created_at: 1, content: '', tags: [['d', e.d]], sig: '' }))
  },
  publish: async (): Promise<PublishResult> => ({ ok: true }) as PublishResult,
}))

vi.mock('./document/save', async () => {
  const actual = await vi.importActual<typeof import('./document/save')>('./document/save')
  return { ...actual, readDocument: async (naddr: string) => relay.read[naddr] ?? null }
})

const QA = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const HQ = '0e2f4c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const D = 'a1b2c3d4-0000-4000-8000-00000000000a'
const folders: FolderSummary[] = [
  { id: QA, name: 'QA', hasState: true },
  { id: HQ, name: 'Estiva HQ', hasState: true },
]
const page = (author: string, naddr: string, text: string): ForeignObject =>
  ({
    ref: naddr,
    kind: 30842,
    eventId: 'e',
    widget: 'card',
    meta: [],
    actions: [],
    viaRecommendation: false,
    address: `30842:${author}:${D}`,
    naddr,
    folder: QA,
    slots: { title: { value: 'Plan' }, [BODY_SLOT]: { value: serializeBlockDocument(descriptionTextToBlockDocument(text)), format: 'blocks' } },
  }) as unknown as ForeignObject
const listed: Record<string, ForeignObject[]> = {}

vi.mock('./folders/workspace', async () => {
  const actual = await vi.importActual<typeof import('./folders/workspace')>('./folders/workspace')
  return {
    ...actual,
    readFolders: async () => folders,
    readFolder: async (id: string): Promise<FolderContents> => {
      await relay.tree
      return { ...folders.find((f) => f.id === id)!, files: listed[id] ?? [], source: 'state' }
    },
  }
})

const { App } = await import('./App')
const { naddrOf } = await import('./fileAddress')

/* jsdom implements neither `getClientRects` nor `getBoundingClientRect` on text nodes, and ProseMirror calls them on every change. */
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects = rects
    proto.getBoundingClientRect = empty
  }
})

beforeEach(() => {
  for (const id of Object.keys(listed)) delete listed[id]
  relay.documents = []
  relay.read = {}
  relay.askedD = []
  relay.tree = null
})

/** Hold every Folder's read until the returned function is called. */
function holdTree(): () => void {
  let release!: () => void
  relay.tree = new Promise((resolve) => (release = resolve))
  return release
}
afterEach(cleanup)

describe("a document's link", () => {
  it('opens the page it names', async () => {
    listed[QA] = [page('a'.repeat(64), 'naddr1mine', 'Written by QA-1.')]
    window.history.replaceState(null, '', `/document/plan-${D}`)
    render(<App />)
    expect(await screen.findByText('Written by QA-1.')).toBeTruthy()
  })

  it('takes the place of an old /f/ link once the page is found, keeping the block it named', async () => {
    listed[QA] = [page('a'.repeat(64), 'naddr1mine', 'Written by QA-1.')]
    window.history.replaceState(null, '', '/f/naddr1mine#block-28bad0a555e9')
    const entries = window.history.length
    render(<App />)
    expect(await screen.findByText('Written by QA-1.')).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe(`/document/plan-${D}`))
    expect(window.location.hash).toBe('#block-28bad0a555e9')
    expect(window.history.length).toBe(entries)
  })

  it('opens nothing when two authors hold the d it names', async () => {
    listed[QA] = [page('a'.repeat(64), 'naddr1mine', 'Written by QA-1.')]
    listed[HQ] = [page('b'.repeat(64), 'naddr1theirs', 'Planted by someone else.')]
    window.history.replaceState(null, '', `/document/plan-${D}`)
    render(<App />)
    expect(await screen.findByText('This could not be found, or you cannot read it.')).toBeTruthy()
    expect(screen.queryByText('Planted by someone else.')).toBeNull()
  })

  it('opens an archived page, which no Folder lists, so it can be unarchived', async () => {
    const archived = { ...page('a'.repeat(64), 'naddr1archived', 'Archived by QA-1.'), archived: { by: 'a'.repeat(64), at: 1 } }
    relay.documents = [{ kind: 30842, pubkey: 'a'.repeat(64), d: D }]
    relay.read[naddrOf(`30842:${'a'.repeat(64)}:${D}`)] = archived
    window.history.replaceState(null, '', `/document/plan-${D}`)
    render(<App />)
    expect(await screen.findByText('Archived by QA-1.')).toBeTruthy()
    expect(window.location.pathname).toBe(`/document/plan-${D}`)
    fireEvent.click(await screen.findByRole('button', { name: 'More' }))
    expect(await screen.findByRole('menuitem', { name: 'Unarchive' })).toBeTruthy()
  })

  it('shows the page by its link while the Folders are still being read (APP-3)', async () => {
    const release = holdTree()
    const mine = page('a'.repeat(64), naddrOf(`30842:${'a'.repeat(64)}:${D}`), 'Read by its address.')
    relay.documents = [{ kind: 30842, pubkey: 'a'.repeat(64), d: D }]
    relay.read[mine.naddr!] = mine
    window.history.replaceState(null, '', `/document/plan-${D}`)
    render(<App />)
    expect(await screen.findByText('Read by its address.')).toBeTruthy()
    release()
  })

  it('keeps the open page when the Folders arrive and list it, so text being typed stays (APP-3)', async () => {
    const release = holdTree()
    const mine = page('a'.repeat(64), naddrOf(`30842:${'a'.repeat(64)}:${D}`), 'Read by its address.')
    relay.documents = [{ kind: 30842, pubkey: 'a'.repeat(64), d: D }]
    relay.read[mine.naddr!] = mine
    listed[QA] = [mine]
    window.history.replaceState(null, '', `/document/plan-${D}`)
    render(<App />)
    const before = await screen.findByText('Read by its address.')
    release()
    // The sidebar lists it once the tree is read; the editor drawn before is the one still on screen, not a new one.
    await waitFor(() => expect(screen.getAllByText('Plan').length).toBeGreaterThan(1))
    expect(screen.getByText('Read by its address.')).toBe(before)
  })

  it('gives an old /f/ link its own link before the Folders are read, without asking for the page again (APP-3)', async () => {
    const release = holdTree()
    const naddr = naddrOf(`30842:${'a'.repeat(64)}:${D}`)
    relay.read[naddr] = page('a'.repeat(64), naddr, 'Read by its address.')
    window.history.replaceState(null, '', `/f/${naddr}`)
    render(<App />)
    expect(await screen.findByText('Read by its address.')).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe(`/document/plan-${D}`))
    expect(relay.askedD).not.toContain(D)
    release()
  })

  it('says a link names nothing only once the Folders are read without it (APP-3)', async () => {
    const release = holdTree()
    const missing = 'a1b2c3d4-0000-4000-8000-00000000000c'
    window.history.replaceState(null, '', `/document/plan-${missing}`)
    render(<App />)
    await waitFor(() => expect(relay.askedD).toContain(missing))
    expect(screen.queryByText('This could not be found, or you cannot read it.')).toBeNull()
    release()
    expect(await screen.findByText('This could not be found, or you cannot read it.')).toBeTruthy()
  })

  it('opens nothing when two authors hold the d of a page no Folder lists', async () => {
    // Its own `d`: a link already read is remembered for the tab.
    const other = 'a1b2c3d4-0000-4000-8000-00000000000b'
    relay.documents = [
      { kind: 30842, pubkey: 'a'.repeat(64), d: other },
      { kind: 30842, pubkey: 'b'.repeat(64), d: other },
    ]
    for (const author of ['a', 'b']) relay.read[naddrOf(`30842:${author.repeat(64)}:${other}`)] = page(author.repeat(64), `naddr1${author}`, 'Planted by someone else.')
    window.history.replaceState(null, '', `/document/plan-${other}`)
    render(<App />)
    expect(await screen.findByText('This could not be found, or you cannot read it.')).toBeTruthy()
    expect(screen.queryByText('Planted by someone else.')).toBeNull()
  })
})
