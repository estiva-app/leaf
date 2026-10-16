import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import type { ReferenceCandidate } from '@estiva-app/conversation'
import type { ForeignObject } from '@estiva-app/interop'

vi.mock('../relay/bridge', () => ({ query: vi.fn(async () => []), publish: vi.fn(), viewerPubkey: () => null }))

/*
  The rows interop builds from a Folder's files and from relay search, given
  here: interop's own tests hold how a summary and an issue's caption are read
  off a file. What Leaf is tested for is what `[` shows and what a pick saves.
*/
const rows = vi.hoisted(() => ({ folder: [] as ReferenceCandidate[], search: [] as ReferenceCandidate[] }))
vi.mock('@estiva-app/interop', async (original) => ({
  ...(await original<typeof import('@estiva-app/interop')>()),
  fileCandidates: vi.fn(async () => rows.folder),
  searchFileReferences: vi.fn(async (text: string) => rows.search.filter((r) => r.title.toLowerCase().includes(text.toLowerCase()))),
}))

import { LiveDocument } from './LiveDocument'
import { useReferencePage } from './referencePicker'

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
afterEach(() => {
  cleanup()
  rows.folder = []
  rows.search = []
})

type EditorBox = HTMLElement & { editor: Editor }
const page = () => screen.getByRole('textbox', { name: 'Document' }) as EditorBox
const ready = async () => {
  await waitFor(() => expect(page().editor.isInitialized).toBe(true))
  return page()
}
/* jsdom cannot type into a contenteditable: text goes in through the editor's own command, after focusing it as a browser would. */
const type = (box: EditorBox, text: string) => {
  act(() => {
    box.editor.commands.focus('end')
    fireEvent.focus(box)
  })
  act(() => void box.editor.chain().insertContent(text).run())
}
const press = (box: EditorBox, key: string) =>
  act(async () => {
    box.editor.view.someProp('handleKeyDown', (handle) => handle(box.editor.view, new KeyboardEvent('keydown', { key })))
  })
const options = async () => (await screen.findAllByRole('option')).map((o) => o.textContent ?? '')

const HERE = '30842:' + 'a'.repeat(64) + ':here'
const file = (d: string, title: string, more: Partial<ReferenceCandidate> = {}): ReferenceCandidate => ({
  id: `30851:${'b'.repeat(64)}:${d}`,
  uri: `nostr:naddr-${d}`,
  type: 'issue',
  kind: 30851,
  title,
  caption: '',
  tier: 0,
  ...more,
})

/** A Leaf page open in a Folder, as App wires it: the page publishes its Folder's files as `[`'s first tier. */
function Page({ onCommit }: { onCommit: (value: string, contentFormat?: string) => Promise<boolean> }) {
  useReferencePage({ address: HERE, folder: FOLDER })
  return <LiveDocument value="" format="blocks" changedBy={null} onCommit={onCommit} onLeftUnsaved={vi.fn()} />
}
const FOLDER: ForeignObject[] = []

describe('[ on a Leaf page', () => {
  it("offers the Folder's files, each with its summary as the second line, and an issue's ref and project beside the title", async () => {
    rows.folder = [
      file('ledger', 'Quokka ledger', { caption: 'SUM-9 · Finance', summary: 'Match the quokka ledger to the bank' }),
      file('plain', 'Quokka plain', { caption: 'SUM-10 · Finance' }),
    ]
    render(<Page onCommit={vi.fn(async () => true)} />)
    const box = await ready()
    type(box, '[quok')
    await waitFor(async () => expect(await options()).toHaveLength(2))
    const [ledger, plain] = screen.getAllByRole('option')
    expect(ledger.textContent).toContain('Quokka ledger')
    expect(ledger.textContent).toContain('Match the quokka ledger to the bank')
    expect(ledger.textContent).toContain('SUM-9 · Finance')
    // No summary: today's row, the caption as its second line.
    expect(plain.textContent).toContain('Quokka plain')
    expect(plain.textContent).toContain('SUM-10 · Finance')
  })

  it('never offers the page you are writing in', async () => {
    rows.folder = [file('other', 'Quokka other'), { ...file('here', 'Quokka here', { type: 'document', kind: 30842 }), id: HERE }]
    render(<Page onCommit={vi.fn(async () => true)} />)
    const box = await ready()
    type(box, '[quok')
    await waitFor(async () => expect(await options()).toEqual([expect.stringContaining('Quokka other')]))
  })

  it('finds a file outside the Folder by its title once you type', async () => {
    rows.search = [file('far', 'Wombat roadmap', { tier: 2, summary: 'Where the wombats go next' })]
    render(<Page onCommit={vi.fn(async () => true)} />)
    const box = await ready()
    type(box, '[wombat')
    await waitFor(async () => expect((await options()).join()).toContain('Where the wombats go next'))
  })

  it('a pick saves the file as a nostr: reference in the page', async () => {
    rows.folder = [file('ledger', 'Quokka ledger', { summary: 'Match the quokka ledger to the bank' })]
    const onCommit = vi.fn(async () => true)
    render(<Page onCommit={onCommit} />)
    const box = await ready()
    type(box, '[quok')
    await screen.findByRole('option')
    await press(box, 'Enter')
    act(() => void fireEvent.blur(box))
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    const [saved] = onCommit.mock.calls[0] as unknown as [string]
    expect(saved).toContain('nostr:naddr-ledger')
    expect(saved).not.toContain('[quok')
  })
})
