/**
 * The sidebar shows where the open page lives (LFB-9): its Folder and the page above it open, and its row is the
 * current one; a row the person closes stays closed until another page opens.
 */
import { BODY_SLOT, type FolderContents, type FolderSummary, type ForeignObject } from '@estiva-app/interop'
import { descriptionTextToBlockDocument, serializeBlockDocument, type PublishResult } from '@estiva-app/protocol'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { shipProject } from './pages/fixtures/shipFiles'

const ME = 'a'.repeat(64)

vi.mock('./relay/bridge', () => ({
  viewerPubkey: () => 'a'.repeat(64),
  query: async () => [],
  publish: async (): Promise<PublishResult> => ({ ok: true }) as PublishResult,
}))

const QA = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const HQ = '0e2f4c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const PLAN_D = 'a1b2c3d4-0000-4000-8000-00000000000a'
const WEEK_D = 'a1b2c3d4-0000-4000-8000-00000000000b'
const BRIEF_D = 'a1b2c3d4-0000-4000-8000-00000000000c'
const page = (d: string, title: string, text: string, parentRef?: string) =>
  ({
    ref: `naddr1${d}`,
    kind: 30842,
    eventId: `e${d}`,
    widget: 'card',
    meta: [],
    actions: [],
    viaRecommendation: false,
    address: `30842:${ME}:${d}`,
    naddr: `naddr1${d}`,
    folder: QA,
    parentRef,
    slots: { title: { value: title }, [BODY_SLOT]: { value: serializeBlockDocument(descriptionTextToBlockDocument(text)), format: 'blocks' } },
  }) as unknown as ForeignObject
const plan = page(PLAN_D, 'Plan', 'The plan.')
const week = page(WEEK_D, 'Week of 2 November', 'This week.', plan.address)
// A page moved under a Ship project (LED-5): the project's row lists its own issues, read as it opens.
const project = shipProject()
const brief = page(BRIEF_D, 'Brief', 'The brief.', project.address)
const folders: FolderSummary[] = [
  { id: HQ, name: 'Estiva HQ', hasState: true, addresses: [] },
  { id: QA, name: 'QA', hasState: true, addresses: [plan.address!, week.address!, project.address!, brief.address!] },
] as FolderSummary[]

vi.mock('./folders/workspace', async () => {
  const actual = await vi.importActual<typeof import('./folders/workspace')>('./folders/workspace')
  return {
    ...actual,
    readFolders: async () => folders,
    readFolder: async (id: string): Promise<FolderContents> => ({
      ...folders.find((f) => f.id === id)!,
      files: id === QA ? [plan, week, project, brief] : [],
      source: 'state',
    }),
    readChildren: async () => [],
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
  window.history.replaceState(null, '', `/document/week-of-2-november-${WEEK_D}`)
  // What this browser kept open: each test starts as a first visit.
  window.localStorage.removeItem('leaf.tree.open')
})
afterEach(cleanup)

const sidebar = () => screen.getByRole('navigation')
const folderGroup = () => within(sidebar()).getByRole('button', { name: 'QA' })
const rowOf = (title: string) => within(sidebar()).getByRole('link', { name: new RegExp(title) })

describe('The sidebar shows where the open page lives (LFB-9)', () => {
  it("opens a page's Folder and the page above it, and marks the page as current", async () => {
    render(<App />)
    expect(await screen.findByText('This week.')).toBeTruthy()
    await waitFor(() => expect(rowOf('Week of 2 November').getAttribute('aria-current')).toBe('page'))
    expect(folderGroup().getAttribute('aria-expanded')).toBe('true')
    expect(within(sidebar()).getByRole('button', { name: 'Hide what is under Plan' }).getAttribute('aria-expanded')).toBe('true')
    // The Folder holding nothing open stays as it was.
    expect(within(sidebar()).getByRole('button', { name: 'Estiva HQ' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('opens a Ship project above the page and reads its issues, so the page shows under it, not a loading row', async () => {
    window.history.replaceState(null, '', `/document/brief-${BRIEF_D}`)
    render(<App />)
    expect(await screen.findByText('The brief.')).toBeTruthy()
    await waitFor(() => expect(rowOf('Brief').getAttribute('aria-current')).toBe('page'))
    expect(within(sidebar()).getByRole('button', { name: /^Hide what is under Leaf edits/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('leaves a row the person closed closed, and opens it again when another page opens under it', async () => {
    render(<App />)
    await waitFor(() => expect(rowOf('Week of 2 November').getAttribute('aria-current')).toBe('page'))
    await userEvent.click(within(sidebar()).getByRole('button', { name: 'Hide what is under Plan' }))
    expect(await within(sidebar()).findByRole('button', { name: 'Show what is under Plan' })).toBeTruthy()

    // Plan opens: the mark moves to it, and the row closed by hand stays closed.
    await userEvent.click(rowOf('Plan'))
    expect(await screen.findByText('The plan.')).toBeTruthy()
    await waitFor(() => expect(rowOf('^Plan').getAttribute('aria-current')).toBe('page'))
    expect(within(sidebar()).getByRole('button', { name: 'Show what is under Plan' }).getAttribute('aria-expanded')).toBe('false')

    // The week opens again, from its link: its place opens again.
    window.history.pushState(null, '', `/document/week-of-2-november-${WEEK_D}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(await screen.findByText('This week.')).toBeTruthy()
    expect(await within(sidebar()).findByRole('button', { name: 'Hide what is under Plan' })).toBeTruthy()
  })
})

describe('The sidebar is kept on this browser (Katerina, 30 October)', () => {
  const hq = () => within(sidebar()).getByRole('button', { name: 'Estiva HQ' })

  it('a Folder opened by hand is open again in a new tab, and one closed by hand stays closed there', async () => {
    const first = render(<App />)
    await waitFor(() => expect(rowOf('Week of 2 November').getAttribute('aria-current')).toBe('page'))
    await userEvent.click(hq())
    await userEvent.click(folderGroup())
    expect(hq().getAttribute('aria-expanded')).toBe('true')
    expect(folderGroup().getAttribute('aria-expanded')).toBe('false')
    first.unmount()

    // A new tab, on Home: nothing in it asks for a Folder to open.
    window.history.replaceState(null, '', '/')
    render(<App />)
    await waitFor(() => expect(hq().getAttribute('aria-expanded')).toBe('true'))
    expect(folderGroup().getAttribute('aria-expanded')).toBe('false')
  })
})
