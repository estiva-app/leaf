/**
 * The sidebar lights one place (Katerina, 23 November: "you have 2 selections in the sidebar"): a page clicked under an
 * initiative is lit there and its team leaves it be, as Peek lights a row only in the column it was opened from; opened
 * any other way, it is lit in its team, and the initiative listing it stays as it was.
 */
import { BODY_SLOT, type FolderContents, type FolderSummary, type ForeignObject } from '@estiva-app/interop'
import { descriptionTextToBlockDocument, serializeBlockDocument, type PublishResult } from '@estiva-app/protocol'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidebarTopic } from './topics/sidebarTopics'
import { drawOnce } from './test/drawOnce'

const ME = 'a'.repeat(64)

vi.mock('./relay/bridge', () => ({
  viewerPubkey: () => 'a'.repeat(64),
  query: async () => [],
  publish: async (): Promise<PublishResult> => ({ ok: true }) as PublishResult,
}))

vi.mock('./auth/estivaId', async () => {
  const actual = await vi.importActual<typeof import('./auth/estivaId')>('./auth/estivaId')
  return { ...actual, heldToken: () => ({ pubkey: 'a'.repeat(64), accessToken: 't' }), whoAmI: async () => ({ name: 'QA-1', email: 'qa-1@example.test' }) }
})

const QA = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const WEEK_D = 'a1b2c3d4-0000-4000-8000-00000000000b'
const week = {
  ref: `naddr1${WEEK_D}`,
  kind: 30842,
  eventId: `e${WEEK_D}`,
  widget: 'card',
  meta: [],
  actions: [],
  viaRecommendation: false,
  address: `30842:${ME}:${WEEK_D}`,
  naddr: `naddr1${WEEK_D}`,
  folder: QA,
  slots: { title: { value: 'Week of 2 November' }, [BODY_SLOT]: { value: serializeBlockDocument(descriptionTextToBlockDocument('This week.')), format: 'blocks' } },
} as unknown as ForeignObject
const folders = [{ id: QA, name: 'QA', hasState: true, addresses: [week.address!] }] as FolderSummary[]

vi.mock('./folders/workspace', async () => {
  const actual = await vi.importActual<typeof import('./folders/workspace')>('./folders/workspace')
  return {
    ...actual,
    readFolders: async () => folders,
    readFolder: async (id: string): Promise<FolderContents> => ({ ...folders.find((f) => f.id === id)!, files: id === QA ? [week] : [], source: 'state' }),
    readChildren: async () => [],
  }
})

/** One initiative of yours, listing the week. */
const LAUNCH: SidebarTopic = { address: `30840:${ME}:launch`, title: 'Launch', files: [week] }
vi.mock('./topics/useSidebarTopics', () => ({ useSidebarTopics: () => [LAUNCH] }))

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
  window.history.replaceState(null, '', '/')
  window.localStorage.removeItem('leaf.tree.open')
})
afterEach(cleanup)

const sidebar = () => screen.getByRole('navigation')
/** Every row lit as the open page, by its name. */
const lit = () => [...sidebar().querySelectorAll('a[aria-current="page"]')].map((a) => a.textContent)
const launchFold = () => within(sidebar()).getByRole('button', { name: /what is under Launch$/ })
const team = () => within(sidebar()).getByRole('button', { name: 'QA' })

// Drawn once before any test's clock starts: `drawOnce` says why.
await drawOnce(async () => { const fresh = await import('./App'); return <fresh.App /> }, () => screen.getByRole('link', { name: 'Launch' }))

describe('The sidebar lights one place (Katerina, 23 November)', () => {
  it('a page clicked under an initiative is lit there alone: its team neither lights it nor opens for it', async () => {
    render(<App />)
    await userEvent.click(await within(sidebar()).findByRole('button', { name: 'Show what is under Launch' }))
    await userEvent.click(within(sidebar()).getByRole('link', { name: /Week of 2 November/ }))
    expect(await screen.findByText('This week.')).toBeTruthy()
    await waitFor(() => expect(lit()).toEqual(['Week of 2 November']))
    expect(launchFold().getAttribute('aria-expanded')).toBe('true')
    expect(team().getAttribute('aria-expanded')).toBe('false')
  })

  it('a page opened from its link is lit in its team alone, and the initiative listing it stays shut', async () => {
    window.history.replaceState(null, '', `/document/week-of-2-november-${WEEK_D}`)
    render(<App />)
    expect(await screen.findByText('This week.')).toBeTruthy()
    await waitFor(() => expect(team().getAttribute('aria-expanded')).toBe('true'))
    expect(lit()).toEqual(['Week of 2 November'])
    expect(launchFold().getAttribute('aria-expanded')).toBe('false')
  })
})
