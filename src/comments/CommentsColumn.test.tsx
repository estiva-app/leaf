import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { blockIds, descriptionTextToBlockDocument, encodeNpub, serializeBlockDocument, type BlockDocument, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
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
import type { Anchor } from './comments'
import { useRef, useState } from 'react'

/** The page's two halves, with a block's Comment already chosen: what the handle's row does (jsdom has no layout to hover). */
function Drafting({ block }: { block: string }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState<Anchor | null>({ blocks: [block] })
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
  // A box keeps what is written as a draft; each test starts with none.
  localStorage.clear()
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

const QA2 = 'c'.repeat(64)
// The relay's roster (NIP-43) and a profile: who `@` offers.
const roster: SignedEvent = { id: 'f'.repeat(64), pubkey: 'd'.repeat(64), created_at: 1_760_000_000, kind: 13534, tags: [['member', ME], ['member', QA2]], content: '', sig: '' }
const profile = (pubkey: string, name: string): SignedEvent => ({ id: `${pubkey.slice(0, 63)}1`, pubkey, created_at: 1_760_000_000, kind: 0, tags: [], content: JSON.stringify({ name }), sig: '' })

const fileWith = (body: BlockDocument) =>
  ({ ref: 'r', kind: 30842, eventId: 'e', widget: 'card', meta: [], actions: [], viaRecommendation: false, address: ADDRESS, folder: FOLDER, slots: { title: { value: 'Plan' }, [BODY_SLOT]: { value: serializeBlockDocument(body), format: 'blocks' } } }) as unknown as ForeignObject

type EditorBox = HTMLElement & { editor: Editor }
const page = () => screen.getByRole('textbox', { name: 'Document' }) as EditorBox
const box = (name: string) => screen.getByRole('textbox', { name }) as EditorBox
const write = (name: string, text: string) => act(() => void box(name).editor.chain().focus().insertContent(text).run())
const sendWithEnter = (name: string) => act(() => void fireEvent.keyDown(box(name), { key: 'Enter' }))

async function open(events: SignedEvent[], body = BODY) {
  relay.events = events
  render(
    <ToastProvider>
      <FilePage file={fileWith(body)} loading={false} />
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

  it('sends an @ pick, a bold word and its tags, and the card draws the person as a chip and the word bold', async () => {
    await open([roster, profile(QA2, 'QA-2')])
    await waitFor(() => expect(screen.getByText(/No comments yet/)).toBeTruthy())
    write('Comment on this document…', 'Ask @QA')
    const option = await screen.findByRole('option', { name: /QA-2/ })
    expect(option).toBeTruthy()
    sendWithEnter('Comment on this document…') // With the list open, Enter picks the row.
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull())
    write('Comment on this document…', 'about <strong>this</strong>')
    // The Enter that picked a row is not a send for the next 100 ms (ui's suggestionPopup); a person types on well after it.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 1000)
      sendWithEnter('Comment on this document…')
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.content).toBe(`Ask nostr:${encodeNpub(QA2)} about **this**`)
    expect(e.tags).toContainEqual(['p', QA2])

    // The relay now holds it: the card reads it back.
    relay.events = [roster, profile(QA2, 'QA-2'), { ...comment(e.tags.filter((t) => t[0] === 'p' && t[1] === QA2), e.content) }]
    cleanup()
    await open(relay.events)
    const card = await waitFor(() => document.querySelector<HTMLElement>('[data-comment-id]')!)
    await waitFor(() => expect(within(card).getByText('@QA-2')).toBeTruthy())
    expect(card.querySelector('strong')?.textContent).toBe('this')
  })

  it("offers a thread's own comment first under Messages in its reply box, and the pick goes out as a q", async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    const elsewhere = comment([], 'About the page')
    await open([roster, profile(AUTHOR, 'QA-1'), onParagraph, elsewhere])
    await waitFor(() => expect(document.querySelectorAll('[data-thread-id]')).toHaveLength(2))
    act(() => void page().editor.emit('commentSelect', { id: onParagraph.id }))
    await waitFor(() => expect(box('Reply…')).toBeTruthy())
    write('Reply…', '[')
    const list = await screen.findByRole('listbox')
    const rows = within(list).getAllByRole('option').map((o) => o.textContent ?? '')
    expect(rows[0]).toContain('Too long?')
    expect(rows[1]).toContain('About the page')
    act(() => void fireEvent.keyDown(box('Reply…'), { key: 'ArrowDown' }))
    sendWithEnter('Reply…')
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull())
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 1000)
      sendWithEnter('Reply…')
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.tags).toContainEqual(['e', onParagraph.id])
    expect(e.tags).toContainEqual(['q', elsewhere.id])
    expect(e.content).toMatch(/^nostr:nevent1/)
  })

  it("offers Ship's / rows in the box: Mention, Urgent and Reference, and no File", async () => {
    await open([])
    write('Comment on this document…', '/')
    await screen.findAllByRole('option')
    const rows = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    for (const row of ['Mention', 'Urgent', 'Reference']) expect(rows.some((r) => r.includes(row))).toBe(true)
    expect(rows.some((r) => /^File/.test(r))).toBe(false)
  })

  it('sends with Ctrl+Enter as with Enter', async () => {
    await open([])
    write('Comment on this document…', 'Sent with the chord')
    act(() => void fireEvent.keyDown(box('Comment on this document…'), { key: 'Enter', ctrlKey: true }))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    expect(publish.mock.calls[0][0].content).toBe('Sent with the chord')
  })

  it('puts your text back and says so when the relay refuses it', async () => {
    publish.mockResolvedValueOnce({ ok: false, reason: 'blocked' })
    await open([])
    await waitFor(() => expect(screen.getByText(/No comments yet/)).toBeTruthy())
    write('Comment on this document…', 'Refused words')
    sendWithEnter('Comment on this document…')
    await waitFor(() => expect(screen.getByText('Not sent: the relay did not take it. Your text is back in the box.')).toBeTruthy())
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

describe('a comment on a selection (LEAF-7)', () => {
  const PAGE = descriptionTextToBlockDocument('# Plan\n\nQA-2 wrote this paragraph.\n\nKaterina owns the press notes.')
  const [, FIRST, SECOND] = blockIds(PAGE)

  /** The document position of `text`'s first character, and of the one after its last. */
  function rangeOf(editor: Editor, text: string): { from: number; to: number } {
    let found: { from: number; to: number } | null = null
    editor.state.doc.descendants((node, pos) => {
      const at = !found && node.isText ? (node.text ?? '').indexOf(text) : -1
      if (at !== -1) found = { from: pos + at, to: pos + at + text.length }
      return !found
    })
    if (!found) throw new Error(`"${text}" is not on the page`)
    return found
  }

  /** Select from the start of `first` to the end of `last` and press Comment in the strip, as a person does. */
  async function commentOnSelection(first: string, last = first) {
    const editor = page().editor
    // jsdom has no layout: the strip needs the view focused and somewhere to stand.
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true)
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 10, bottom: 20, left: 10, right: 20 })
    act(() => void editor.commands.setTextSelection({ from: rangeOf(editor, first).from, to: rangeOf(editor, last).to }))
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)))
    const button = await screen.findByRole('button', { name: 'Comment' })
    act(() => {
      fireEvent.mouseDown(button)
      fireEvent.click(button)
    })
  }

  afterEach(() => vi.useRealTimers())

  it('sends a few selected words as a comment on their paragraph quoting exactly them, and says so over the box', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await open([], PAGE)
    await commentOnSelection('wrote this')
    await waitFor(() => expect(document.querySelector('[data-draft-line]')?.textContent).toBe('On “wrote this”'))
    write('Comment on these words…', 'Which draft?')
    sendWithEnter('Comment on these words…')
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.kind).toBe(1111)
    expect(e.tags).toContainEqual(['block', FIRST])
    expect(e.tags).toContainEqual(['quote', 'wrote this'])
    expect(e.tags.filter((t) => t[0] === 'block')).toHaveLength(1)
  })

  it('sends a passage across two paragraphs as both, quoting the words where it starts and where it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await open([], PAGE)
    await commentOnSelection('this paragraph.', 'Katerina owns')
    write('Comment on these words…', 'Say who')
    sendWithEnter('Comment on these words…')
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.tags).toContainEqual(['block', FIRST, SECOND])
    expect(e.tags).toContainEqual(['quote', 'this paragraph.', 'Katerina owns'])
  })

  it('keeps what you were writing when you choose other words to comment on, and sends it on those', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await open([], PAGE)
    await commentOnSelection('wrote this')
    write('Comment on these words…', 'Half a thought')
    await commentOnSelection('Katerina owns')
    await waitFor(() => expect(document.querySelector('[data-draft-line]')?.textContent).toBe('On “Katerina owns”'))
    sendWithEnter('Comment on these words…')
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.content).toContain('Half a thought')
    expect(e.tags).toContainEqual(['block', SECOND])
    expect(e.tags).toContainEqual(['quote', 'Katerina owns'])
  })

  it('sends two whole selected paragraphs as a comment on both, with no words', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await open([], PAGE)
    await commentOnSelection('QA-2 wrote this paragraph.', 'Katerina owns the press notes.')
    await waitFor(() => expect(document.querySelector('[data-draft-line]')?.textContent).toBe('On 2 paragraphs'))
    write('Comment on these blocks…', 'Merge these?')
    sendWithEnter('Comment on these blocks…')
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.tags).toContainEqual(['block', FIRST, SECOND])
    expect(e.tags.some((t) => t[0] === 'quote')).toBe(false)
  })
})
