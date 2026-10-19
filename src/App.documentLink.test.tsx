/**
 * A document's link, `/document/<slug>-<d>`: what Copy link gives out and every
 * app reads (SPEC §7.7). It opens the page; the old `/f/<naddr>` link still
 * does, and gives way to the new one; a `d` two authors hold opens nothing.
 */
import { BODY_SLOT, type FolderContents, type FolderSummary, type ForeignObject } from '@estiva-app/interop'
import { descriptionTextToBlockDocument, serializeBlockDocument, type PublishResult } from '@estiva-app/protocol'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./relay/bridge', () => ({
  viewerPubkey: () => 'a'.repeat(64),
  query: async () => [],
  publish: async (): Promise<PublishResult> => ({ ok: true }) as PublishResult,
}))

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
    readFolder: async (id: string): Promise<FolderContents> => ({ ...folders.find((f) => f.id === id)!, files: listed[id] ?? [], source: 'state' }),
  }
})

const { App } = await import('./App')

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
})

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
})
