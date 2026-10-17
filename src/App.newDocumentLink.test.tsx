/**
 * New document on one Folder, from a link another app offers it by — Peek's
 * launcher, first (Miky, 2026-10-16: you may offer another app's "New …", and
 * that app writes it). Leaf signs its own `kind:30842`; the linking app signs
 * nothing. Asserted at the wire, on what Leaf publishes.
 */
import type { FolderContents, FolderSummary } from '@estiva-app/interop'
import type { PublishResult, UnsignedEvent } from '@estiva-app/protocol'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const published: UnsignedEvent[] = []

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
// A Folder this person reads but whose listing nobody keeps: a document put there could never be listed.
const OLD = '7c3d2b1a-9e8f-4a6b-8c5d-1e2f3a4b5c6d'
const folders: FolderSummary[] = [
  { id: HQ, name: 'Estiva HQ', hasState: true },
  { id: QA, name: 'QA', hasState: true },
  { id: OLD, name: 'Old chat', hasState: false },
]
const relay = { down: false }

vi.mock('./folders/workspace', async () => {
  const actual = await vi.importActual<typeof import('./folders/workspace')>('./folders/workspace')
  return {
    ...actual,
    readFolders: async () => {
      if (relay.down) throw new Error('relay unreachable')
      return folders
    },
    readFolder: async (id: string): Promise<FolderContents> => ({ ...folders.find((f) => f.id === id)!, files: [], source: 'state' }),
  }
})

const { App } = await import('./App')
const { newDocumentPath } = await import('./route')
const tag = (event: UnsignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]
const REFUSAL = 'You can’t add a document to that Folder.'

beforeEach(() => {
  published.length = 0
  relay.down = false
  window.history.replaceState(null, '', '/')
})

describe('a link to New document in a Folder', () => {
  it('opens New document on that Folder, and Create writes the document there and opens it', async () => {
    window.history.replaceState(null, '', newDocumentPath(QA))
    render(<App />)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New document' })).not.toBeNull())
    expect(screen.getByText('Everyone in QA can read it.')).toBeTruthy()
    await userEvent.type(screen.getByLabelText('Document title'), 'Friday notes')
    const entries = window.history.length
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(published).toHaveLength(2))
    const [doc, add] = published
    expect(doc.kind).toBe(30842)
    expect(tag(doc, 'h')).toBe(QA)
    expect(tag(doc, 'title')).toBe('Friday notes')
    expect([add.kind, tag(add, 'op'), tag(add, 'h')]).toEqual([1852, 'add', QA])
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/f\/naddr1/))
    // The page took the link's place: Back does not land on New document again.
    expect(window.history.length).toBe(entries)
  })

  it.each([
    ['a Folder this person cannot read', '5d1e8f9a-0000-4000-8000-000000000001'],
    ['a Folder this person reads that takes no document', OLD],
  ])('refuses %s, and offers no way to write', async (_, folder) => {
    window.history.replaceState(null, '', newDocumentPath(folder))
    render(<App />)

    // The toast and its live region both carry the words.
    await waitFor(() => expect(screen.queryAllByText(REFUSAL).length).toBeGreaterThan(0))
    expect(screen.queryByRole('dialog', { name: 'New document' })).toBeNull()
    expect(published).toEqual([])
    expect(window.location.pathname).toBe('/')
  })

  it('refuses nothing when the Folders could not be read, and keeps the link for a reload', async () => {
    relay.down = true
    window.history.replaceState(null, '', newDocumentPath(QA))
    render(<App />)

    await waitFor(() => expect(screen.queryByText('Your Folders could not be read. Reload to try again.')).not.toBeNull())
    // A refusal replaces the link with Home; the toast region outlives a render, so the address is what tells.
    expect(`${window.location.pathname}${window.location.search}`).toBe(newDocumentPath(QA))
  })
})
