/**
 * Another app's file opened by its `/f/<naddr>` address that no listing holds — a Ship issue whose project row was
 * never opened, or one reloaded on its own page (LEAF-13): read by its address, and opened as a page.
 */
import type { FolderContents, FolderSummary } from '@estiva-app/interop'
import type { PublishResult } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { shipIssue } from './pages/fixtures/shipFiles'

const ISSUE_NADDR = 'naddr1shipissue'
const issue = { ...shipIssue(), naddr: ISSUE_NADDR }

vi.mock('./relay/bridge', () => ({
  viewerPubkey: () => 'a'.repeat(64),
  query: async () => [],
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

vi.mock('./document/save', async () => {
  const actual = await vi.importActual<typeof import('./document/save')>('./document/save')
  return { ...actual, readDocument: async (naddr: string) => (naddr === ISSUE_NADDR ? issue : null) }
})

const { App } = await import('./App')
const { FilePage } = await import('./pages/FilePage')

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

describe("a Ship issue's address in Leaf", () => {
  it('opens the issue as a page when no Folder lists it, as after a reload', async () => {
    window.history.replaceState(null, '', `/f/${ISSUE_NADDR}`)
    render(<App />)
    expect(await screen.findByRole('textbox', { name: 'Document' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open in Ship' })).toBeTruthy()
    expect(screen.queryByText('This could not be found, or you cannot read it.')).toBeNull()
  })

  it("opens an issue from its project's row as a page, though that read carries none of its actions", async () => {
    // As Leaf's tree holds an issue: from its project's read, with no actions, so nothing on it says Ship shares its text.
    render(<ToastProvider><FilePage file={{ ...issue, actions: [] }} loading={false} /></ToastProvider>)
    expect(await screen.findByRole('textbox', { name: 'Document' })).toBeTruthy()
  })

  it('says it cannot be found when the address reads nothing', async () => {
    window.history.replaceState(null, '', '/f/naddr1nothing')
    render(<App />)
    expect(await screen.findByText('This could not be found, or you cannot read it.')).toBeTruthy()
  })
})
