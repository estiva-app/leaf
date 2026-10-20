import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { blockIds, descriptionTextToBlockDocument, encodeNaddr, encodeNevent, encodeNpub, serializeBlockDocument, type BlockDocument, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
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
/* Who is signed in: ME, unless a test signs out. */
const signedIn = vi.hoisted(() => ({ pubkey: 'a'.repeat(64) as string | null }))
vi.mock('../relay/bridge', () => ({
  query: vi.fn(async (filters: Record<string, unknown>[]) => relay.events.filter((e) => filters.some((f) => matches(e, f)))),
  publish,
  viewerPubkey: () => signedIn.pubkey,
}))

/* A file's bytes on the relay: the upload answers with its imeta or a reason, and a read with an object URL. Their own contract is `blobs.test.ts`. */
const blobs = vi.hoisted(() => ({
  upload: vi.fn<(file: File) => Promise<{ ok: true; file: Record<string, unknown> } | { ok: false; reason: string }>>(),
  read: vi.fn<(url: string) => Promise<string>>(async () => 'blob:leaf/1'),
}))
vi.mock('../relay/blobs', () => ({ uploadFile: blobs.upload, blobObjectUrl: blobs.read }))

/* Files another app owns, by reference: interop's projection of one needs its app's manifest, which is interop's own contract and tested there. */
const files = vi.hoisted(() => ({ known: {} as Record<string, unknown> }))
vi.mock('@estiva-app/interop', async (importOriginal) => {
  const real = await importOriginal<typeof import('@estiva-app/interop')>()
  return {
    ...real,
    resolveForeignObjects: async (uris: string[], ...rest: unknown[]) => {
      const others = uris.filter((uri) => !(uri in files.known))
      const found = others.length ? await (real.resolveForeignObjects as (...a: unknown[]) => Promise<Record<string, unknown>>)(others, ...rest) : {}
      return { ...found, ...Object.fromEntries(uris.filter((uri) => uri in files.known).map((uri) => [uri, files.known[uri]])) }
    },
    // One file read again on its own: a live part's (COMM-8).
    resolveForeignObject: async (naddr: string, ...rest: unknown[]) => {
      const uri = naddr.startsWith('nostr:') ? naddr : `nostr:${naddr}`
      return uri in files.known ? files.known[uri] : (real.resolveForeignObject as (...a: unknown[]) => Promise<unknown>)(naddr, ...rest)
    },
  }
})

import { FilePage } from '../pages/FilePage'
import { LiveDocument } from '../document/LiveDocument'
import { blockLinkOf } from '../document/blockLink'
import { buildManifest } from '../manifest'
import { CommentsColumn } from './CommentsColumn'
import type { Anchor } from './comments'
import { query } from '../relay/bridge'
import { holdTyping, holdTypingFor } from '../auth/heldTyping'
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
// A uuid, as a page's `d` is: an app URL names it by its last five groups (COMM-8).
const PAGE_D = '11111111-1111-4111-8111-111111111111'
const ADDRESS = `30842:${AUTHOR}:${PAGE_D}`
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

  it("offers Ship's / rows in the box: File, Mention, Urgent and Reference", async () => {
    await open([])
    write('Comment on this document…', '/')
    await screen.findAllByRole('option')
    const rows = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    for (const row of ['File', 'Mention', 'Urgent', 'Reference']) expect(rows.some((r) => r.includes(row))).toBe(true)
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
    await waitFor(() => expect(screen.getByText('Not sent: it did not go through. Your text is back in the box.')).toBeTruthy())
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

  describe('a link alone on its line (SPEC §13.2, as Peek draws a message)', () => {
    const ISSUE_ADDRESS = `30851:${QA2}:login`
    const ISSUE = `nostr:${encodeNaddr({ kind: 30851, pubkey: QA2, identifier: 'login', relays: [] })}`
    const OTHER = `nostr:${encodeNaddr({ kind: 30851, pubkey: QA2, identifier: 'export', relays: [] })}`
    const issue = (title: string, address: string) =>
      ({ ref: 'r', kind: 30851, eventId: 'e', widget: 'card', noun: 'issue', meta: [], actions: [], viaRecommendation: false, address, slots: { title: { value: title }, subtitle: { value: `${title}, in short.` } } }) as unknown as ForeignObject
    const GONE_ADDRESS = `30851:${QA2}:deleted`
    const GONE = `nostr:${encodeNaddr({ kind: 30851, pubkey: QA2, identifier: 'deleted', relays: [] })}`
    beforeAll(() => {
      files.known[ISSUE] = issue('Fix the login', ISSUE_ADDRESS)
      files.known[OTHER] = issue('Export to PDF', `30851:${QA2}:export`)
      files.known[GONE] = null
    })

    it('draws a file alone on its line as its row, and the same file in a sentence as its chip', async () => {
      await open([comment([], `See\n${ISSUE}\nand ${OTHER} too`)])
      const card = await waitFor(() => document.querySelector<HTMLElement>('[data-comment-id]')!)
      const row = await waitFor(() => {
        const found = card.querySelector<HTMLElement>('[data-reference-card="compact"]')
        expect(found).toBeTruthy()
        return found!
      })
      expect(within(row).getByText('Fix the login')).toBeTruthy()
      expect(row.closest('p')).toBeNull()
      // In a sentence the other file stays the chip it was written as, with no row.
      await waitFor(() => expect(within(card).getByText('Export to PDF')).toBeTruthy())
      expect(within(card).getByText('Export to PDF').closest('[data-reference-card]')).toBeNull()
      expect(card.textContent).toContain('See')
    })

    it("draws the card another app's writer carried under the text, and nothing for its file's line, which the card stands for", async () => {
      await open([comment([['embed', ISSUE_ADDRESS, 'detailed']], `See\n${ISSUE}`)])
      const card = await waitFor(() => document.querySelector<HTMLElement>('[data-comment-id]')!)
      const carried = await waitFor(() => {
        const found = card.querySelector<HTMLElement>('[data-reference-card="detailed"]')
        expect(found).toBeTruthy()
        return found!
      })
      expect(within(carried).getByText('Fix the login, in short.')).toBeTruthy()
      expect(within(card).getAllByText('Fix the login')).toHaveLength(1)
      expect(card.querySelector('[data-reference-card="compact"]')).toBeNull()
    })

    it('draws a bullet that is only a link as its row, and keeps the bullet', async () => {
      await open([comment([], `Read these:\n\n- ${ISSUE}\n- and ${OTHER} later`)])
      const card = await waitFor(() => document.querySelector<HTMLElement>('[data-comment-id]')!)
      const row = await waitFor(() => {
        const found = card.querySelector<HTMLElement>('[data-reference-card="compact"]')
        expect(found).toBeTruthy()
        return found!
      })
      expect(within(row).getByText('Fix the login')).toBeTruthy()
      expect(row.closest('li')).toBeTruthy()
      // The second bullet is a sentence: its file stays a chip.
      await waitFor(() => expect(within(card).getByText('Export to PDF')).toBeTruthy())
      expect(card.querySelectorAll('[data-reference-card]')).toHaveLength(1)
    })

    it('says a carried card\'s file is not available, rather than drop the link, when it cannot be read', async () => {
      await open([comment([['embed', GONE_ADDRESS, 'detailed']], `See\n${GONE}`)])
      const card = await waitFor(() => document.querySelector<HTMLElement>('[data-comment-id]')!)
      await waitFor(() => expect(within(card).getByText(/not available/)).toBeTruthy())
      expect(card.querySelector('[data-reference-unavailable]')).toBeTruthy()
    })

    it("draws another of this page's comments alone on its line as its row: its author and opening words", async () => {
      const first = comment([], 'The export drops the tables.')
      const second = comment([['q', first.id]], `Same as\nnostr:${encodeNevent({ id: first.id, relays: [] })}`)
      await open([profile(AUTHOR, 'QA-1'), first, second])
      const card = await waitFor(() => document.querySelector<HTMLElement>(`[data-comment-id="${second.id}"]`)!)
      const row = await waitFor(() => {
        const found = card.querySelector<HTMLElement>(`[data-comment-row="${first.id}"]`)
        expect(found).toBeTruthy()
        return found!
      })
      expect(row.textContent).toContain('The export drops the tables.')
      expect(row.closest('p')).toBeNull()
    })
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

  /* The passkey screen takes the page's place when the sign-in ends (AUT-5): the page unmounts, and draws again after the tap. */
  it('keeps a comment on selected words on those words through a sign-in ending, and sends it on them after the tap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await open([], PAGE)
    await commentOnSelection('wrote this')
    write('Comment on these words…', 'Which draft?')
    act(() => {
      holdTypingFor(ME)
      holdTyping()
    })
    cleanup()

    await open([], PAGE)
    await waitFor(() => expect(document.querySelector('[data-draft-line]')?.textContent).toBe('On “wrote this”'))
    expect(box('Comment on these words…').editor.getText()).toBe('Which draft?')
    sendWithEnter('Comment on these words…')
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.tags).toContainEqual(['block', FIRST])
    expect(e.tags).toContainEqual(['quote', 'wrote this'])
    expect(e.content).toBe('Which draft?')
  })

  it('keeps a reply box open on its thread through a sign-in ending, and the reply goes to that thread after the tap', async () => {
    const onFirst = comment([['block', FIRST]], 'Too long?')
    await open([onFirst], PAGE)
    await waitFor(() => expect(document.querySelector('[data-thread-id]')).not.toBeNull())
    act(() => void page().editor.emit('commentSelect', { id: onFirst.id }))
    await waitFor(() => expect(box('Reply…')).toBeTruthy())
    write('Reply…', 'Shorter now')
    act(() => {
      holdTypingFor(ME)
      holdTyping()
    })
    cleanup()

    await open([onFirst], PAGE)
    await waitFor(() => expect(box('Reply…').editor.getText()).toBe('Shorter now'))
    sendWithEnter('Reply…')
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.tags).toContainEqual(['e', onFirst.id])
    expect(e.content).toBe('Shorter now')
  })
})

describe('reactions on a comment (COMM-4)', () => {
  const reaction = (target: string, emoji: string, by: string, id: string): SignedEvent => ({ id, pubkey: by, created_at: 1_760_000_100, kind: 7, tags: [['e', target]], content: emoji, sig: '' })
  const replyTo = (root: SignedEvent, content: string): SignedEvent => ({
    ...comment([], content),
    pubkey: ME,
    tags: [['A', ADDRESS], ['K', '30842'], ['P', AUTHOR], ['e', root.id], ['k', '1111'], ['h', FOLDER]],
  })
  // The relay keeps what it accepts, and stops returning what a kind:5 takes back: the column's read after the write finds that.
  const relayKeeps = () =>
    publish.mockImplementationOnce(async (e) => {
      const target = e.tags.find((t) => t[0] === 'e')?.[1]
      relay.events = e.kind === 5 ? relay.events.filter((x) => x.id !== target) : [...relay.events, { ...e, id: '9'.repeat(64), sig: '' } as SignedEvent]
      return { ok: true }
    })
  const pill = (name: string) => screen.findByRole('button', { name })
  const deliver = async (event: SignedEvent) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() => live.listeners.forEach((l) => l(FOLDER, event)))
      await act(() => vi.advanceTimersByTimeAsync(300))
    } finally {
      vi.useRealTimers()
    }
  }

  it("draws someone else's reactions on a comment and on its reply, not lit, and names who reacted", async () => {
    const root = comment([], 'Too long?')
    const reply = replyTo(root, 'Cut it')
    await open([root, reply, reaction(root.id, '👍', QA2, '7'.repeat(64)), reaction(reply.id, '🙏', QA2, '6'.repeat(64)), profile(QA2, 'QA-2')])
    const onRoot = await pill('Makes sense, 1')
    expect(onRoot.getAttribute('aria-pressed')).toBe('false')
    expect((await pill('Thank you, 1')).closest('[data-comment-id]')?.getAttribute('data-comment-id')).toBe(reply.id)
    fireEvent.pointerEnter(onRoot)
    fireEvent.focus(onRoot)
    expect(await screen.findByText('QA-2 reacted with Makes sense')).toBeTruthy()
  })

  it('reacts from the picker with a kind:7 on the comment and no h, and the pill shows, lit, once the relay accepts it', async () => {
    const root = comment([], 'Too long?')
    await open([root])
    await waitFor(() => expect(document.querySelector('[data-thread-id]')).not.toBeNull())
    relayKeeps()
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Add a reaction' })))
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Makes sense' })))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.content, e.tags, e.pubkey]).toEqual([7, '👍', [['e', root.id]], ME])
    expect((await pill('Makes sense, 1')).getAttribute('aria-pressed')).toBe('true')
  })

  it('signed out, shows the reactions with nothing to click and writes nothing', async () => {
    const root = comment([], 'Too long?')
    signedIn.pubkey = null
    try {
      await open([root, reaction(root.id, '👍', QA2, '7'.repeat(64))])
      const shown = await pill('Makes sense, 1')
      expect((shown as HTMLButtonElement).disabled).toBe(true)
      expect(screen.queryByRole('button', { name: 'Add a reaction' })).toBeNull()
      act(() => void fireEvent.click(shown))
      await act(async () => {})
      expect(publish).not.toHaveBeenCalled()
    } finally {
      signedIn.pubkey = ME
    }
  })

  it('writes nothing more while the read after an accepted reaction is still out', async () => {
    const root = comment([], 'Too long?')
    await open([root])
    await waitFor(() => expect(document.querySelector('[data-thread-id]')).not.toBeNull())
    const { query } = await import('../relay/bridge')
    const real = vi.mocked(query).getMockImplementation()!
    // The relay accepts the reaction; the column's read after it does not answer yet.
    vi.mocked(query).mockImplementation(() => new Promise(() => {}))
    try {
      const pick = () => {
        act(() => void fireEvent.click(screen.getByRole('button', { name: 'Add a reaction' })))
        act(() => void fireEvent.click(screen.getByRole('button', { name: 'Makes sense' })))
      }
      pick()
      await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
      await act(async () => {})
      pick()
      await act(async () => {})
      expect(publish).toHaveBeenCalledTimes(1)
    } finally {
      vi.mocked(query).mockImplementation(real)
    }
  })

  it('takes your own reaction back with a kind:5 naming that reaction, and the pill goes', async () => {
    const root = comment([], 'Too long?')
    const mine = reaction(root.id, '👍', ME, '8'.repeat(64))
    await open([root, mine])
    relayKeeps()
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Makes sense, 1' })))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.tags]).toEqual([5, [['e', mine.id]]])
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Makes sense, 1' })).toBeNull())
  })

  it('leaves the row as it was and says why when the relay refuses a reaction', async () => {
    const root = comment([], 'Too long?')
    await open([root, reaction(root.id, '👍', QA2, '7'.repeat(64))])
    publish.mockResolvedValueOnce({ ok: false, reason: 'blocked: kind 7 not allowed' })
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Makes sense, 1' })))
    expect(await screen.findByText('Not reacted: it did not go through.')).toBeTruthy()
    expect(publish.mock.calls[0][0].kind).toBe(7)
    expect((await pill('Makes sense, 1')).getAttribute('aria-pressed')).toBe('false')
  })

  it('says to try again in a moment when the relay refuses a reaction for coming too fast', async () => {
    const root = comment([], 'Too long?')
    await open([root, reaction(root.id, '👍', QA2, '7'.repeat(64))])
    publish.mockResolvedValueOnce({ ok: false, reason: 'rate-limited: slow down' })
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Makes sense, 1' })))
    expect(await screen.findByText('Not reacted: too many at once, try again in a moment.')).toBeTruthy()
  })

  it("shows someone else's reaction without a reload, and its going when they take it back", async () => {
    const root = comment([], 'Too long?')
    await open([root])
    await waitFor(() => expect(document.querySelector('[data-thread-id]')).not.toBeNull())
    const theirs = reaction(root.id, '👍', QA2, '7'.repeat(64))
    relay.events = [root, theirs]
    await deliver(theirs)
    await pill('Makes sense, 1')
    relay.events = [root]
    await deliver({ id: '5'.repeat(64), pubkey: QA2, created_at: 1_760_000_300, kind: 5, tags: [['e', theirs.id]], content: '', sig: '' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Makes sense, 1' })).toBeNull())
  })
})

describe('editing and deleting your own comment (COMM-5)', () => {
  const mine = (tags: string[][], content: string): SignedEvent => ({ ...comment(tags, content), pubkey: ME })
  const replyTo = (root: SignedEvent, content: string, by: string, place: string[][] = []): SignedEvent => ({
    ...comment([], content),
    pubkey: by,
    tags: [['A', ADDRESS], ['K', '30842'], ['P', AUTHOR], ['e', root.id], ['k', '1111'], ['p', root.pubkey], ...place, ['h', FOLDER]],
  })
  const line = (id: string) => document.querySelector<HTMLElement>(`[data-thread-id] [data-comment-id="${id}"]`)
  const more = (id: string) => within(line(id)!).queryByRole('button', { name: 'More' })
  const choose = async (id: string, item: 'Edit message' | 'Delete message') => {
    act(() => void fireEvent.click(more(id)!))
    act(() => void fireEvent.click(screen.getByRole('menuitem', { name: item })))
  }

  it("offers Edit and Delete on your own comment and reply, and neither on someone else's", async () => {
    const theirs = comment([], 'Too long?')
    const yours = replyTo(theirs, 'Cut it', ME)
    const own = mine([], 'Mine')
    await open([theirs, yours, own])
    await waitFor(() => expect(line(own.id)).not.toBeNull())
    expect(more(theirs.id)).toBeNull()
    expect(more(yours.id)).not.toBeNull()
    act(() => void fireEvent.click(more(own.id)!))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Edit message', 'Delete message'])
  })

  it("shows someone else's edit, made in Peek, without a reload", async () => {
    const theirs = comment([], 'Too long?')
    await open([theirs])
    await waitFor(() => expect(line(theirs.id)).not.toBeNull())
    const edit: SignedEvent = { id: '6'.repeat(64), pubkey: AUTHOR, created_at: 1_760_000_300, kind: 40003, tags: [['h', FOLDER], ['e', theirs.id], ['ts', '1760000300000']], content: 'Far too long?', sig: '' }
    relay.events = [theirs, edit]
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() => live.listeners.forEach((l) => l(FOLDER, edit)))
      await act(() => vi.advanceTimersByTimeAsync(300))
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(within(line(theirs.id)!).getByText('Far too long?')).toBeTruthy())
  })

  it('signed out, offers neither on what you wrote', async () => {
    const own = mine([], 'Mine')
    signedIn.pubkey = null
    try {
      await open([own])
      await waitFor(() => expect(line(own.id)).not.toBeNull())
      expect(more(own.id)).toBeNull()
    } finally {
      signedIn.pubkey = ME
    }
  })

  it('opens your words in the shared box with the person as a chip, and Escape puts them back unsent', async () => {
    const own = mine([], `Ask nostr:${encodeNpub(QA2)} first`)
    await open([own, roster, profile(QA2, 'QA-2')])
    await waitFor(() => expect(within(line(own.id)!).getByText('@QA-2')).toBeTruthy())
    await choose(own.id, 'Edit message')
    const edit = box('Edit message')
    expect(edit.textContent).toContain('@QA-2')
    expect(edit.textContent).not.toContain('npub')
    act(() => void fireEvent.keyDown(edit, { key: 'Escape' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull())
    expect(within(line(own.id)!).getByText('@QA-2')).toBeTruthy()
    expect(publish).not.toHaveBeenCalled()
  })

  it('saves an edit as a 40003 on the comment, in its Folder, and the card shows the new words, marked edited, on the same paragraph', async () => {
    const own = mine([['block', PARAGRAPH]], 'Too long?')
    await open([own])
    await waitFor(() => expect(line(own.id)).not.toBeNull())
    await choose(own.id, 'Edit message')
    act(() => void box('Edit message').editor.chain().focus().selectAll().insertContent('Far too long?').run())
    publish.mockImplementationOnce(async (e) => {
      relay.events = [...relay.events, { ...e, id: '8'.repeat(64), sig: '' } as SignedEvent]
      return { ok: true }
    })
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.content, e.pubkey]).toEqual([40003, 'Far too long?', ME])
    expect(e.tags).toEqual(expect.arrayContaining([['h', FOLDER], ['e', own.id]]))
    expect(e.tags.some((t) => t[0] === 'block')).toBe(false)
    await waitFor(() => expect(within(line(own.id)!).getByText('Far too long?')).toBeTruthy())
    expect(within(line(own.id)!).getByText('(edited)')).toBeTruthy()
    expect(within(line(own.id)!.closest<HTMLElement>('[data-thread-id]')!).getByText('On the paragraph')).toBeTruthy()
  })

  /* As AUT-5's tests above: the passkey screen takes the page's place, and the page draws again after the tap. */
  it('keeps your edit box open, with the words you typed, through a sign-in ending, and Save writes those words after the tap', async () => {
    const own = mine([], 'Too long?')
    await open([own])
    await waitFor(() => expect(line(own.id)).not.toBeNull())
    await choose(own.id, 'Edit message')
    act(() => void box('Edit message').editor.chain().focus().selectAll().insertContent('Far too long?').run())
    act(() => {
      holdTypingFor(ME)
      holdTyping()
    })
    cleanup()

    await open([own])
    await waitFor(() => expect(box('Edit message').editor.getText()).toBe('Far too long?'))
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.content, e.pubkey]).toEqual([40003, 'Far too long?', ME])
    expect(e.tags).toContainEqual(['e', own.id])
  })

  it('keeps your words in the box and says so when the relay refuses the edit', async () => {
    const own = mine([], 'Too long?')
    await open([own])
    await waitFor(() => expect(line(own.id)).not.toBeNull())
    await choose(own.id, 'Edit message')
    act(() => void box('Edit message').editor.chain().focus().selectAll().insertContent('Far too long?').run())
    publish.mockResolvedValueOnce({ ok: false, reason: 'blocked' })
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(await screen.findByText(/Not saved: it did not go through/)).toBeTruthy()
    expect(box('Edit message').textContent).toContain('Far too long?')
  })

  it("deletes your comment after asking; QA-2's reply stays on its paragraph, highlighted, under the note, with no reply box and no Resolve", async () => {
    const own = mine([['block', PARAGRAPH]], 'Too long?')
    const theirs = replyTo(own, 'Cut it', QA2, [['block', PARAGRAPH]])
    await open([own, theirs])
    await waitFor(() => expect(line(theirs.id)).not.toBeNull())
    await choose(own.id, 'Delete message')
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Its reply stays, under “This comment was deleted.”')).toBeTruthy()
    expect(publish).not.toHaveBeenCalled()
    // The relay stops returning the comment and keeps the deletion.
    publish.mockImplementationOnce(async (e) => {
      relay.events = [...relay.events.filter((x) => x.id !== own.id), { ...e, id: '7'.repeat(64), sig: '' } as SignedEvent]
      return { ok: true }
    })
    act(() => void fireEvent.click(within(dialog).getByRole('button', { name: 'Delete message' })))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    expect([publish.mock.calls[0][0].kind, publish.mock.calls[0][0].tags]).toEqual([5, [['e', own.id]]])
    const card = await waitFor(() => {
      const c = document.querySelector<HTMLElement>(`[data-thread-id="${own.id}"]`)!
      expect(within(c).getByText('This comment was deleted.')).toBeTruthy()
      return c
    })
    expect(within(card).getByText('Cut it')).toBeTruthy()
    expect(within(card).getByText('On the paragraph')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Resolve' })).toBeNull()
    expect(page().querySelector(`[data-comment-id="${own.id}"]`)).not.toBeNull()
    act(() => void page().editor.emit('commentSelect', { id: own.id }))
    await waitFor(() => expect(card.getAttribute('data-active')).toBe('true'))
    expect(screen.queryByRole('textbox', { name: 'Reply…' })).toBeNull()
  })
})

describe('attaching a file to a comment (COMM-6)', () => {
  const PNG = { url: 'https://relay.test/media/' + '1'.repeat(64) + '.png', m: 'image/png', x: '1'.repeat(64), size: 7909, filename: 'shot.png' }
  const PDF = { url: 'https://relay.test/media/' + '2'.repeat(64) + '.pdf', m: 'application/pdf', x: '2'.repeat(64), size: 193, filename: 'plan.pdf' }
  // The box around the editor: the nearest ancestor holding its file picker.
  const footBox = () => {
    let at: HTMLElement | null = box('Comment on this document…')
    while (at && !at.querySelector('input[type=file]')) at = at.parentElement
    expect(at, 'the box offers files').not.toBeNull()
    return at!
  }
  const pick = (file: File) => act(() => void fireEvent.change(footBox().querySelector('input[type=file]')!, { target: { files: [file] } }))
  afterEach(() => blobs.upload.mockReset())

  it('uploads a picked picture and a dropped PDF, and the comment names both by imeta once they are on the relay', async () => {
    blobs.upload.mockImplementation(async (file) => ({ ok: true, file: file.name === 'shot.png' ? PNG : PDF }))
    await open([])
    await waitFor(() => expect(screen.getByText(/No comments yet/)).toBeTruthy())
    write('Comment on this document…', 'See these')
    pick(new File(['png'], 'shot.png', { type: 'image/png' }))
    act(() => void fireEvent.drop(footBox(), { dataTransfer: { files: [new File(['pdf'], 'plan.pdf', { type: 'application/pdf' })] } }))
    await waitFor(() => expect(blobs.upload).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(footBox()).getByText('plan.pdf')).toBeTruthy())
    sendWithEnter('Comment on this document…')
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.content]).toEqual([1111, 'See these'])
    expect(e.tags.filter((t) => t[0] === 'imeta')).toEqual([
      expect.arrayContaining([`url ${PNG.url}`, 'm image/png', `x ${PNG.x}`, 'filename shot.png']),
      expect.arrayContaining([`url ${PDF.url}`, 'm application/pdf', `x ${PDF.x}`, 'filename plan.pdf']),
    ])
  })

  it('says why a file did not upload, keeps the words, sends nothing on Enter, and sends the words once its ✕ takes it off', async () => {
    blobs.upload.mockResolvedValue({ ok: false, reason: 'Too large' })
    await open([])
    await waitFor(() => expect(screen.getByText(/No comments yet/)).toBeTruthy())
    write('Comment on this document…', 'Here is the deck')
    pick(new File(['big'], 'deck.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(within(footBox()).getByText('Too large')).toBeTruthy())
    expect(screen.getByText('Remove the file that did not upload to send.')).toBeTruthy()
    sendWithEnter('Comment on this document…')
    expect(box('Comment on this document…').editor.getText()).toBe('Here is the deck')
    expect(publish).not.toHaveBeenCalled()
    act(() => void fireEvent.click(within(footBox()).getByRole('button', { name: 'Remove deck.pdf' })))
    sendWithEnter('Comment on this document…')
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.content]).toEqual([1111, 'Here is the deck'])
    expect(e.tags.some((t) => t[0] === 'imeta')).toBe(false)
  })

  it("draws a comment's picture and PDF under its words, fetched as the reader", async () => {
    const imeta = (f: typeof PNG) => ['imeta', `url ${f.url}`, `m ${f.m}`, `x ${f.x}`, `size ${f.size}`, `filename ${f.filename}`]
    const posted = comment([['block', PARAGRAPH], imeta(PNG), imeta(PDF)], 'See these')
    await open([posted])
    const card = await waitFor(() => {
      // The column's line, not the page's highlight of the same comment.
      const c = document.querySelector<HTMLElement>(`[data-thread-id] [data-comment-id="${posted.id}"]`)
      expect(c).not.toBeNull()
      return c!
    })
    await waitFor(() => expect(within(card).getByText('plan.pdf')).toBeTruthy())
    await waitFor(() => expect(within(card).getByRole('img', { name: 'shot.png' })).toBeTruthy())
    expect(blobs.read).toHaveBeenCalledWith(PNG.url)
  })
})

describe('the card and the live parts under the box (COMM-8)', () => {
  const SHIP = 'e'.repeat(64)
  // The apps' manifests, as Ship and Leaf publish them: what makes a URL name a file (§7.7), on the app's own `web` origin.
  const manifest = (d: string, pattern: string, kind: number): SignedEvent => ({
    id: `${d.padEnd(63, '0')}9`,
    pubkey: SHIP,
    created_at: 1_760_000_000,
    kind: 31990,
    tags: [['d', d], ['k', String(kind)], ['web', `${/^https:\/\/[^/]+/.exec(pattern)![0]}/o/<bech32>`, 'naddr'], ['urls', pattern, String(kind)]],
    content: '',
    sig: '',
  })
  // Leaf's own shape, as its manifest publishes it: a made-up one hid that production declared none (38796b47).
  const LEAF_SHAPE = buildManifest(SHIP, 1_760_000_000_000, 'https://leaf.example/').tags.find((t) => t[0] === 'urls')![1]
  // A wiki reads `/issue/` as its own kind, so on Leaf's host that path may be either (SPEC §7.7).
  const MANIFESTS = [
    manifest('ship', 'https://ship.example/issue/<slug>-<d>#block-<block>', 30851),
    manifest('leaf', LEAF_SHAPE, 30842),
    manifest('wiki', 'https://wiki.example/issue/<slug>-<d>', 30023),
  ]
  const file = (kind: number, pubkey: string, d: string): SignedEvent => ({ id: `${d.padEnd(62, '0')}77`, pubkey, created_at: 1_760_000_000, kind, tags: [['d', d]], content: '', sig: '' })

  const ISSUE_D = '22222222-2222-4222-8222-222222222222'
  const OTHER_ISSUE_D = '33333333-3333-4333-8333-333333333333'
  const TWO_D = '44444444-4444-4444-8444-444444444444'
  const ISSUE = `30851:${SHIP}:${ISSUE_D}`
  const OTHER_ISSUE = `30851:${SHIP}:${OTHER_ISSUE_D}`
  const ISSUE_URL = `https://ship.example/issue/fix-it-${ISSUE_D}`
  const OTHER_ISSUE_URL = `https://ship.example/issue/other-issue-${OTHER_ISSUE_D}`
  const TWO = descriptionTextToBlockDocument('# Two\n\nThe block that stays live.')
  const TWO_BLOCK = blockIds(TWO)[1]
  const TWO_ADDRESS = `30842:${AUTHOR}:${TWO_D}`
  const PART_URL = blockLinkOf({ kind: 30842, address: TWO_ADDRESS, slots: { title: { value: 'Two' } } } as unknown as ForeignObject, TWO_BLOCK, 'https://leaf.example')!
  const OWN_BLOCK_URL = blockLinkOf({ kind: 30842, address: ADDRESS, slots: { title: { value: 'Plan' } } } as unknown as ForeignObject, PARAGRAPH, 'https://leaf.example')!
  const uriOf = (address: string) => {
    const [kind, pubkey, identifier] = address.split(':')
    return `nostr:${encodeNaddr({ kind: Number(kind), pubkey, identifier, relays: [] })}`
  }
  const object = (address: string, title: string, body?: BlockDocument) =>
    ({
      ref: 'r',
      kind: Number(address.split(':')[0]),
      eventId: 'e',
      widget: 'card',
      meta: [],
      actions: [],
      viaRecommendation: false,
      address,
      folder: FOLDER,
      slots: { title: { value: title }, ...(body ? { [BODY_SLOT]: { value: serializeBlockDocument(body), format: 'blocks' } } : {}) },
    }) as unknown as ForeignObject

  const EVENTS = [...MANIFESTS, file(30851, SHIP, ISSUE_D), file(30851, SHIP, OTHER_ISSUE_D), file(30842, AUTHOR, TWO_D), file(30842, AUTHOR, PAGE_D)]
  beforeAll(() => {
    files.known[uriOf(ISSUE)] = object(ISSUE, 'Fix it')
    files.known[uriOf(OTHER_ISSUE)] = object(OTHER_ISSUE, 'Other issue')
    files.known[uriOf(TWO_ADDRESS)] = object(TWO_ADDRESS, 'Two', TWO)
  })

  const BOX = 'Comment on this document…'
  const under = () => document.querySelector<HTMLElement>('[data-box-under]')
  const asked = (d: string) => vi.mocked(query).mock.calls.some(([filters]) => filters.some((f) => (f['#d'] as string[] | undefined)?.includes(d)))
  const sent = async () => {
    sendWithEnter(BOX)
    await waitFor(() => expect(publish).toHaveBeenCalled())
    return publish.mock.calls[0][0]
  }
  const named = (tags: string[][], name: string) => tags.filter((t) => t[0] === name)

  it('a comment naming one issue by its URL shows its chip in the box and its card under it, and goes out as the URL carrying the card', async () => {
    await open(EVENTS)
    write(BOX, `see ${ISSUE_URL} `)
    await waitFor(() => expect(within(under()!).getByText('Fix it')).toBeTruthy())
    // The chip is the file's, read as the card is, and the link stays the URL a person wrote.
    await waitFor(() => expect(within(box(BOX)).getByText('Fix it')).toBeTruthy())
    const e = await sent()
    expect(e.content).toBe(`see ${ISSUE_URL}`)
    expect(named(e.tags, 'embed')).toEqual([['embed', ISSUE, 'detailed']])
  })

  it('an issue’s path on Leaf’s host draws as the issue, as its Ship address does, and the comment carries its card (LTX-6)', async () => {
    const leafUrl = `https://leaf.example/issue/fix-it-${ISSUE_D}`
    // Another kind no app reads `/issue/` as holds the same d: the link is looked up under Ship's and the wiki's kinds only.
    await open([...EVENTS, file(30818, AUTHOR, ISSUE_D)])
    write(BOX, `see ${leafUrl} `)
    await waitFor(() => expect(within(box(BOX)).getByText('Fix it')).toBeTruthy())
    const e = await sent()
    expect(e.content).toBe(`see ${leafUrl}`)
    expect(named(e.tags, 'embed')).toEqual([['embed', ISSUE, 'detailed']])
  })

  it('✕ takes the card off, and the comment goes out with no card', async () => {
    await open(EVENTS)
    write(BOX, `see ${ISSUE_URL} `)
    await waitFor(() => expect(under()).not.toBeNull())
    act(() => void fireEvent.click(within(under()!).getByRole('button', { name: 'Remove card' })))
    expect(under()).toBeNull()
    const e = await sent()
    expect(named(e.tags, 'embed')).toEqual([])
  })

  it('two issues named, one on words, show no card, and the comment carries none', async () => {
    await open(EVENTS)
    write(BOX, `see ${ISSUE_URL} and `)
    await waitFor(() => expect(under()).not.toBeNull())
    await act(() => void box(BOX).editor.chain().focus('end').insertContent({ type: 'text', text: 'this one', marks: [{ type: 'link', attrs: { href: OTHER_ISSUE_URL } }] }).run())
    await waitFor(() => expect(asked(OTHER_ISSUE_D)).toBe(true))
    await waitFor(() => expect(under()).toBeNull())
    const e = await sent()
    expect(e.content).toBe(`see ${ISSUE_URL} and [this one](${OTHER_ISSUE_URL})`)
    expect(named(e.tags, 'embed')).toEqual([])
  })

  it('a URL whose id two authors hold names nothing: no card under the box, and the comment carries none', async () => {
    const SHARED_D = '55555555-5555-4555-8555-555555555555'
    const SHARED = `30851:${SHIP}:${SHARED_D}`
    files.known[uriOf(SHARED)] = object(SHARED, 'Shared id')
    // Somebody else publishes the same kind and d: the link must not put either one's card under it.
    await open([...EVENTS, file(30851, SHIP, SHARED_D), { ...file(30851, QA2, SHARED_D), id: `${SHARED_D.replace(/-/g, '').slice(0, 30)}${'0'.repeat(33)}1` }])
    write(BOX, `see https://ship.example/issue/shared-${SHARED_D} and ${ISSUE_URL} `)
    // The one issue named alone gets its card; the shared id counts for nothing, not as a second file.
    await waitFor(() => expect(asked(SHARED_D)).toBe(true))
    await waitFor(() => expect(within(under()!).getByText('Fix it')).toBeTruthy())
    expect(within(under()!).queryByText('Shared id')).toBeNull()
    const e = await sent()
    expect(named(e.tags, 'embed')).toEqual([['embed', ISSUE, 'detailed']])
  })

  it('a link to a block of another page shows that block live under the box and no card, and the comment carries its part', async () => {
    await open(EVENTS)
    write(BOX, `see ${ISSUE_URL} and ${PART_URL} `)
    await waitFor(() => expect(within(under()!).getByText('The block that stays live.')).toBeTruthy())
    expect(within(under()!).queryByText('Fix it')).toBeNull()
    const e = await sent()
    expect(named(e.tags, 'part')).toEqual([['part', TWO_ADDRESS, TWO_BLOCK]])
    expect(named(e.tags, 'embed')).toEqual([])
  })

  it('a link to another block of this page shows nothing under the box, and the comment carries no part and no card', async () => {
    await open(EVENTS)
    // With a block of another page beside it: only that one's part shows and goes out.
    write(BOX, `see ${OWN_BLOCK_URL} and ${PART_URL} `)
    await waitFor(() => expect(asked(PAGE_D)).toBe(true))
    await waitFor(() => expect(under()?.querySelectorAll('[data-part-address]')).toHaveLength(1))
    expect(under()!.querySelector('[data-part-address]')?.getAttribute('data-part-address')).toBe(TWO_ADDRESS)
    const e = await sent()
    expect(named(e.tags, 'part')).toEqual([['part', TWO_ADDRESS, TWO_BLOCK]])
    expect(named(e.tags, 'embed')).toEqual([])
  })

  it("draws a sent comment's card named only by its URL, and a block of another page live under it", async () => {
    await open([...EVENTS, comment([['embed', ISSUE, 'detailed']], `see ${ISSUE_URL}`), comment([['part', TWO_ADDRESS, TWO_BLOCK]], `see ${PART_URL}`)])
    await waitFor(() => expect(document.querySelectorAll('[data-comment-id]')).toHaveLength(2))
    const text = (c: Element) => c.textContent ?? ''
    await waitFor(() => expect([...document.querySelectorAll('[data-comment-id]')].map(text).join('|')).toMatch(/Fix it.*\|.*The block that stays live\.|The block that stays live\..*\|.*Fix it/))
  })

  it('draws no part of this page under a sent comment, nor a part whose link the body no longer names', async () => {
    await open([
      ...EVENTS,
      comment([['part', ADDRESS, PARAGRAPH]], `see ${OWN_BLOCK_URL}`),
      comment([['part', TWO_ADDRESS, TWO_BLOCK]], 'the link was edited out'),
      // The one that draws, so the two that do not are told apart from parts never drawn.
      comment([['part', TWO_ADDRESS, TWO_BLOCK]], `still ${PART_URL}`),
    ])
    await waitFor(() => expect(document.querySelectorAll('[data-comment-id]')).toHaveLength(3))
    await waitFor(() => expect(document.querySelectorAll('[data-part-address]')).toHaveLength(1))
    const drawn = document.querySelector('[data-part-address]')!.closest('[data-comment-id]')!
    expect(drawn.textContent).toContain('still')
  })
})
