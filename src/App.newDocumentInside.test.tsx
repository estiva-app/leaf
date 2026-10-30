/**
 * New document inside a page, from its ⋯ menu (LFB-8): the new page names the page it sits under, is stored in that
 * page's own Folder, and is listed where the page is listed. Asserted at the wire, on what Leaf publishes.
 */
import { BODY_SLOT, type FolderContents, type FolderSummary, type ForeignObject } from '@estiva-app/interop'
import { descriptionTextToBlockDocument, serializeBlockDocument, type PublishResult, type UnsignedEvent } from '@estiva-app/protocol'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const published = vi.hoisted(() => [] as UnsignedEvent[])
const ME = 'a'.repeat(64)

vi.mock('./relay/bridge', () => ({
  viewerPubkey: () => 'a'.repeat(64),
  query: async () => [],
  publish: async (event: UnsignedEvent): Promise<PublishResult> => {
    published.push(event)
    return { ok: true } as PublishResult
  },
}))

const QA = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const HQ = '0e2f4c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const D = 'a1b2c3d4-0000-4000-8000-00000000000a'
const PAGE = `30842:${ME}:${D}`
// Stored in HQ and listed in QA, as after a move: the new page's two Folders differ.
const launchPlan = {
  ref: 'naddr1launch',
  kind: 30842,
  eventId: 'e',
  widget: 'card',
  meta: [],
  actions: [],
  viaRecommendation: false,
  address: PAGE,
  naddr: 'naddr1launch',
  folder: HQ,
  slots: { title: { value: 'Launch plan' }, [BODY_SLOT]: { value: serializeBlockDocument(descriptionTextToBlockDocument('The plan.')), format: 'blocks' } },
} as unknown as ForeignObject
const folders: FolderSummary[] = [
  { id: HQ, name: 'Estiva HQ', hasState: true, addresses: [] },
  { id: QA, name: 'QA', hasState: true, addresses: [PAGE] },
] as FolderSummary[]

vi.mock('./folders/workspace', async () => {
  const actual = await vi.importActual<typeof import('./folders/workspace')>('./folders/workspace')
  return {
    ...actual,
    readFolders: async () => folders,
    readFolder: async (id: string): Promise<FolderContents> => ({ ...folders.find((f) => f.id === id)!, files: id === QA ? [launchPlan] : [], source: 'state' }),
  }
})

const { App } = await import('./App')
const tag = (event: UnsignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

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
  published.length = 0
  window.history.replaceState(null, '', `/document/launch-plan-${D}`)
})
afterEach(cleanup)

describe('New document inside a page (LFB-8)', () => {
  it("writes a page naming it, stored in the page's own Folder and listed where the page is, and opens it", async () => {
    render(<App />)
    expect(await screen.findByText('The plan.')).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'New document inside' }))
    expect(await screen.findByText('New document under Launch plan')).toBeTruthy()
    expect(screen.getByText('Everyone who can read Launch plan can read it.')).toBeTruthy()
    await userEvent.type(screen.getByLabelText('Document title'), 'Risks')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(published.filter((e) => e.kind === 30842 || e.kind === 1852)).toHaveLength(2))
    const doc = published.find((e) => e.kind === 30842)!
    const add = published.find((e) => e.kind === 1852)!
    expect([tag(doc, 'title'), tag(doc, 'h'), tag(doc, 'a')]).toEqual(['Risks', HQ, PAGE])
    expect([tag(add, 'op'), tag(add, 'h'), tag(add, 'a')]).toEqual(['add', QA, `30842:${ME}:${tag(doc, 'd')}`])
    await waitFor(() => expect(window.location.pathname).toBe(`/document/risks-${tag(doc, 'd')}`))
  })
})
