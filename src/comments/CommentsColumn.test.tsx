import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { blockIds, descriptionTextToBlockDocument, serializeBlockDocument, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'

const ME = 'a'.repeat(64)
const publish = vi.hoisted(() => vi.fn<(event: UnsignedEvent) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true })))
const relay = vi.hoisted(() => ({ events: [] as SignedEvent[] }))
const matches = (e: SignedEvent, f: Record<string, unknown>) =>
  (!f.kinds || (f.kinds as number[]).includes(e.kind)) &&
  Object.entries(f).every(([k, v]) => !k.startsWith('#') || e.tags.some((t) => t[0] === k.slice(1) && (v as string[]).includes(t[1])))
/* The tab's one connection: every Folder watch's listener, so a test can deliver an event as it arrives live. */
const live = vi.hoisted(() => ({ listeners: [] as ((folder: string, event?: SignedEvent) => void)[] }))
vi.mock('../relay/client', () => ({
  relayClient: () => ({
    watchFolders: (_folders: string[], listener: (folder: string, event?: SignedEvent) => void) => {
      live.listeners.push(listener)
      return { stop: () => void live.listeners.splice(live.listeners.indexOf(listener), 1) }
    },
  }),
}))
vi.mock('../relay/bridge', () => ({
  query: vi.fn(async (filters: Record<string, unknown>[]) => relay.events.filter((e) => filters.some((f) => matches(e, f)))),
  publish,
  viewerPubkey: () => ME,
}))

import { FilePage } from '../pages/FilePage'
import { LiveDocument } from '../document/LiveDocument'
import { CommentsColumn } from './CommentsColumn'
import { useRef, useState } from 'react'

/** The page's two halves, with a block's Comment already chosen: what the handle's row does (jsdom has no layout to hover). */
function Drafting({ block }: { block: string }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState<string | null>(block)
  const body = useRef<HTMLDivElement | null>(null)
  return (
    <ToastProvider>
      <LiveDocument value={serializeBlockDocument(BODY)} format="blocks" changedBy={null} onCommit={async () => true} onLeftUnsaved={() => {}} onEditor={setEditor} onCommentOn={setDraft} />
      <CommentsColumn doc={{ address: ADDRESS, folder: FOLDER }} addressable editor={editor} docBody={body} draft={draft} onDraft={setDraft} />
    </ToastProvider>
  )
}

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
  publish.mockClear()
})

const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const AUTHOR = 'b'.repeat(64)
const ADDRESS = `30842:${AUTHOR}:d1`
const BODY = descriptionTextToBlockDocument('# Plan\n\nQA-2 wrote this paragraph.')
const PARAGRAPH = blockIds(BODY)[1]

let n = 0
const comment = (tags: string[][], content: string): SignedEvent => {
  n += 1
  const tagged = [['A', ADDRESS], ['K', '30842'], ['P', AUTHOR], ['a', ADDRESS], ['k', '30842'], ['p', AUTHOR], ...tags, ['h', FOLDER]]
  return { id: n.toString(16).padStart(64, '0'), pubkey: AUTHOR, created_at: 1_760_000_000 + n, kind: 1111, tags: tagged, content, sig: '' }
}

const file = { ref: 'r', kind: 30842, eventId: 'e', widget: 'card', meta: [], actions: [], viaRecommendation: false, address: ADDRESS, folder: FOLDER, slots: { title: { value: 'Plan' }, [BODY_SLOT]: { value: serializeBlockDocument(BODY), format: 'blocks' } } } as unknown as ForeignObject

type EditorBox = HTMLElement & { editor: Editor }
const page = () => screen.getByRole('textbox', { name: 'Document' }) as EditorBox
const box = (name: string) => screen.getByRole('textbox', { name }) as EditorBox
const write = (name: string, text: string) => act(() => void box(name).editor.chain().focus().insertContent(text).run())
const sendWithEnter = (name: string) => act(() => void fireEvent.keyDown(box(name), { key: 'Enter' }))

async function open(events: SignedEvent[]) {
  relay.events = events
  render(
    <ToastProvider>
      <FilePage file={file} loading={false} />
    </ToastProvider>,
  )
  await waitFor(() => expect(page().editor.isInitialized).toBe(true))
}

describe('the comments column', () => {
  it('lists a comment on a paragraph by its place in the text, the whole document after it, and one on a deleted paragraph apart', async () => {
    await open([comment([], 'About the page'), comment([['block', 'gone00000000']], 'About a paragraph since deleted'), comment([['block', PARAGRAPH]], 'Too long?')])
    await waitFor(() => expect(document.querySelectorAll('[data-thread-id]')).toHaveLength(3))
    const cards = [...document.querySelectorAll<HTMLElement>('[data-thread-id]')]
    expect(cards.map((c) => [within(c).queryByText(/^On /)?.textContent, c.querySelector('[data-comment-id]')?.textContent?.match(/Too long\?|About the page|since deleted/)?.[0]])).toEqual([
      ['On the paragraph', 'Too long?'],
      ['On the whole document', 'About the page'],
      // Detached is said, in its own section, never drawn as a comment on the whole document (SPEC §13.6).
      ['On blocks deleted from the page', 'since deleted'],
    ])
    expect(screen.getByText('On deleted blocks')).toBeTruthy()
  })

  it("marks a paragraph's card when its highlight is chosen in the text", async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(document.querySelector('[data-thread-id]')).not.toBeNull())
    act(() => void page().editor.emit('commentSelect', { id: onParagraph.id }))
    // The open card takes a reply.
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply…' })).toBeTruthy())
  })

  it('sends a comment on the whole document from the box at its foot', async () => {
    await open([])
    await waitFor(() => expect(screen.getByText(/No comments yet/)).toBeTruthy())
    write('Comment on this document…', 'Looks good')
    sendWithEnter('Comment on this document…')
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.kind).toBe(1111)
    expect(e.content).toBe('Looks good')
    expect(e.tags).toContainEqual(['h', FOLDER])
    expect(e.tags.some((t) => t[0] === 'block')).toBe(false)
  })

  it("sends a comment begun from a block's Comment as a comment on that block, then goes back to the whole document", async () => {
    relay.events = []
    render(<Drafting block={PARAGRAPH} />)
    await waitFor(() => expect(screen.getByText('On the paragraph')).toBeTruthy())
    write('Comment on this block…', 'Too long?')
    sendWithEnter('Comment on this block…')
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.kind).toBe(1111)
    expect(e.tags).toContainEqual(['block', PARAGRAPH])
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Comment on this document…' })).toBeTruthy())
  })

  it('puts your text back and says so when the relay refuses it', async () => {
    publish.mockResolvedValueOnce({ ok: false, reason: 'blocked' })
    await open([])
    await waitFor(() => expect(screen.getByText(/No comments yet/)).toBeTruthy())
    write('Comment on this document…', 'Refused words')
    sendWithEnter('Comment on this document…')
    await waitFor(() => expect(screen.getByText('Could not send your comment. Your text is still here.')).toBeTruthy())
    expect(box('Comment on this document…').editor.getText()).toBe('Refused words')
  })

  it('moves a thread under Resolved without a reload when someone else resolves it', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(document.querySelector('[data-thread-id]')).not.toBeNull())
    const theirs: SignedEvent = { id: 'e'.repeat(64), pubkey: AUTHOR, created_at: 1_760_000_200, kind: 9101, tags: [['h', FOLDER], ['e', onParagraph.id], ['t', 'resolution'], ['action', 'resolved']], content: '', sig: '' }
    relay.events = [onParagraph, theirs]
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() => live.listeners.forEach((l) => l(FOLDER, theirs)))
      await act(() => vi.advanceTimersByTimeAsync(300))
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(document.querySelector('[data-thread-id][data-resolved]')).not.toBeNull())
  })

  it('moves a thread under Resolved with the 9101 resolution', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(document.querySelector('[data-thread-id]')).not.toBeNull())
    // The relay keeps what it accepts, so the column's read after the write finds it.
    publish.mockImplementationOnce(async (e) => {
      relay.events = [...relay.events, { ...e, id: 'f'.repeat(64), sig: '' } as SignedEvent]
      return { ok: true }
    })
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Resolve' })))
    await waitFor(() => expect(screen.getByText('Resolved')).toBeTruthy())
    expect(publish.mock.calls[0][0].kind).toBe(9101)
    expect(publish.mock.calls[0][0].tags).toContainEqual(['e', onParagraph.id])
  })
})
