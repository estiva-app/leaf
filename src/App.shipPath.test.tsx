/**
 * Ship's address for an issue, with Leaf's host (RFC 0.5 §7.7): it opens the issue as a Leaf page, and an issue
 * opened at `/f/<naddr>` gets that address in the bar, so swapping the host opens it in Ship.
 */
import type { FolderContents, FolderSummary, ForeignObject } from '@estiva-app/interop'
import { encodeNaddr, type PublishResult, type SignedEvent } from '@estiva-app/protocol'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { MIKY, shipIssue } from './pages/fixtures/shipFiles'

const D = '7fd6a466-5c02-49e5-8cbc-0ce71ab32221'
const TOPIC_D = '5bd936dc-1111-4222-8333-444455556666'
const ISSUE = `30851:${MIKY}:${D}`
const TOPIC = `30840:${MIKY}:${TOPIC_D}`

function event(kind: number, pubkey: string, tags: string[][]): SignedEvent {
  return { id: `${kind}${pubkey}${tags.length}`.slice(0, 64).padEnd(64, '0'), sig: '0'.repeat(128), pubkey, kind, created_at: 1, tags, content: '{}' }
}
const MANIFESTS = [
  event(31990, 'b'.repeat(64), [
    ['d', 'estiva-ship'], ['k', '30850'], ['k', '30851'], ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://ship.estiva.app/project/<slug>-<d>#block-<block>', '30850'],
    ['urls', 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>', '30851'],
  ]),
  event(31990, 'c'.repeat(64), [
    ['d', 'estiva-peek'], ['k', '30840'], ['web', 'https://peek.estiva.app/o/<bech32>', 'naddr'], ['urls', 'https://peek.estiva.app/topic/<slug>-<d>', '30840'],
  ]),
]
let held: SignedEvent[] = []

vi.mock('./relay/bridge', () => ({
  viewerPubkey: () => 'a'.repeat(64),
  query: async ([filter]: Record<string, unknown>[]) => {
    const kinds = (filter.kinds as number[] | undefined) ?? []
    if (kinds.includes(31990)) return MANIFESTS
    const ds = (filter['#d'] as string[] | undefined) ?? []
    return held.filter((e) => kinds.includes(e.kind) && e.tags.some((t) => t[0] === 'd' && ds.includes(t[1])))
  },
  publish: async (): Promise<PublishResult> => ({ ok: true }) as PublishResult,
}))

const QA = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const folders: FolderSummary[] = [{ id: QA, name: 'QA', hasState: true }]
vi.mock('./folders/workspace', async () => {
  const actual = await vi.importActual<typeof import('./folders/workspace')>('./folders/workspace')
  return {
    ...actual,
    readFolders: async () => folders,
    readFolder: async (id: string): Promise<FolderContents> => ({ ...folders.find((f) => f.id === id)!, files: [], source: 'state' }),
  }
})

function naddrOf(address: string): string {
  const [kind, pubkey, d] = address.split(':')
  return encodeNaddr({ kind: Number(kind), pubkey, identifier: d, relays: [] })
}
const issue: ForeignObject = { ...shipIssue(), address: ISSUE, naddr: naddrOf(ISSUE), openUrl: `https://ship.estiva.app/o/${naddrOf(ISSUE)}` }
const topic: ForeignObject = {
  ...shipIssue(),
  kind: 30840,
  address: TOPIC,
  naddr: naddrOf(TOPIC),
  noun: 'topic',
  actions: [],
  appName: 'Peek',
  openUrl: `https://peek.estiva.app/o/${naddrOf(TOPIC)}`,
  slots: { title: { value: 'Launch chat' } },
}
vi.mock('./document/save', async () => {
  const actual = await vi.importActual<typeof import('./document/save')>('./document/save')
  return { ...actual, readDocument: async (naddr: string) => [issue, topic].find((f) => f.naddr === naddr) ?? null }
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

// One tab per test: an App left mounted would move the shared address bar under the next one.
afterEach(cleanup)

beforeEach(() => {
  held = [event(30851, MIKY, [['d', D]]), event(30840, MIKY, [['d', TOPIC_D]])]
})

const title = issue.slots.title?.value ?? ''
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

describe("Ship's address for an issue, on Leaf's host", () => {
  it('opens the issue as a Leaf page, and the bar takes the slug of its title', async () => {
    window.history.replaceState(null, '', `/issue/${D}`)
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Document' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open in Ship' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe(`/issue/${slug}-${D}`))
  })

  it('gives an issue opened at /f/ the address Ship shows it at, on Leaf’s host', async () => {
    window.history.replaceState(null, '', `/f/${issue.naddr}`)
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Document' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe(`/issue/${slug}-${D}`))
  })

  it('says it cannot be found when two authors hold the `d`', async () => {
    held.push(event(30851, 'e'.repeat(64), [['d', D]]))
    // A path of its own: a path that named a file once names it for the rest of the tab.
    window.history.replaceState(null, '', `/issue/copied-${D}`)
    render(<App />)
    expect(await screen.findByText('This could not be found, or you cannot read it.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Document' })).toBeNull()
  })

  it('says it cannot be found when the address names nothing', async () => {
    window.history.replaceState(null, '', '/issue/00000000-0000-4000-8000-000000000000')
    render(<App />)
    expect(await screen.findByText('This could not be found, or you cannot read it.')).toBeTruthy()
  })

  it('gives Copy link on a block of the issue as Ship’s block address with Leaf’s host (LTX-6)', async () => {
    const copied: string[] = []
    const was = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } })
    onTestFinished(() => {
      if (was) Object.defineProperty(navigator, 'clipboard', was)
      else delete (navigator as { clipboard?: unknown }).clipboard
    })
    window.history.replaceState(null, '', `/issue/${slug}-${D}`)
    render(<App />)
    const doc = await screen.findByRole('textbox', { name: 'Document' })
    const block = await waitFor(() => {
      const found = doc.querySelector<HTMLElement>('[data-block-id]')
      expect(found).toBeTruthy()
      return found!
    })
    // The handle follows the pointer: over the text, its menu offers the link.
    fireEvent.mouseMove(block)
    fireEvent.click(await screen.findByRole('button', { name: 'Block menu' }))
    await screen.findByRole('menuitem', { name: 'Comment' })
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toContain('Copy link')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    // jsdom measures every block at the same place, so the handle may stand by any of them.
    const ids = [...doc.querySelectorAll<HTMLElement>('[data-block-id]')].map((b) => b.dataset.blockId)
    await waitFor(() => expect(copied).toHaveLength(1))
    expect(ids.map((id) => `${window.location.origin}/issue/${slug}-${D}#block-${id}`)).toContain(copied[0])
  })

  it("hands a Peek topic's address to Peek rather than showing Home", async () => {
    window.history.replaceState(null, '', `/topic/${TOPIC_D}`)
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Open in Peek' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Document' })).toBeNull()
    await waitFor(() => expect(window.location.pathname).toBe(`/topic/launch-chat-${TOPIC_D}`))
  })
})
