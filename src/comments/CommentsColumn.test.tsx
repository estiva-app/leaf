import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { blockIds, descriptionTextToBlockDocument, encodeNaddr, encodeNevent, encodeNpub, serializeBlockDocument, type BlockDocument, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'

const ME = 'a'.repeat(64)
const publish = vi.hoisted(() => vi.fn<(event: UnsignedEvent) => Promise<{ ok: boolean; reason?: string; eventId?: string }>>(async () => ({ ok: true })))
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
  upload: vi.fn<(file: File) => Promise<{ ok: true; file: Record<string, unknown> } | { ok: false; reason: unknown }>>(),
  read: vi.fn<(url: string) => Promise<string>>(async () => 'blob:leaf/1'),
}))
vi.mock('../relay/blobs', () => ({ uploadFile: blobs.upload, uploadIntoText: blobs.upload, blobObjectUrl: blobs.read }))

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
import { forgetRelayKey, type Anchor } from './comments'
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

/*
  The column draws each thread on the kit's cards (ONE-5, step 3). A thread is its comment and, open, its replies,
  under the id the kit's layout gives each comment (`data-conversation-item`, `data-open` while open); a reply is the
  kit's ReplyCard (`data-reply-id`). Leaf's own `data-thread-id` and `data-comment-id` are gone.
*/
/** A thread in the column, by its comment's id. */
const item = (id: string) => document.querySelector<HTMLElement>(`[data-conversation-item="${id}"]`)
const items = () => [...document.querySelectorAll<HTMLElement>('[data-conversation-item]')]
/** A comment's card (its id is its thread's) or a reply's: the kit's ConversationCard, or its ReplyCard. */
const entry = (id: string) => document.querySelector<HTMLElement>(`[data-reply-id="${id}"]`) ?? item(id)?.querySelector<HTMLElement>('[data-comment-body]')?.parentElement ?? null
/** Every comment's and open reply's card in the column, in order. */
const entries = () => items().flatMap((t) => [t.querySelector<HTMLElement>('[data-comment-body]')?.parentElement, ...t.querySelectorAll<HTMLElement>('[data-reply-id]')].filter((c): c is HTMLElement => !!c))
/** The kit shows a card's strip (React, Reply, Resolve, More) while it is pointed at, as a person does before pressing. */
const pointAt = (card: HTMLElement) => act(() => void fireEvent.mouseEnter(card))
/** Open a thread from its replies row ("1 reply"), as a person does: its replies show under it. */
const openReplies = (id: string) => act(() => void fireEvent.click(within(item(id)!).getByRole('button', { name: /^\d+ repl(y|ies), open the thread$/ })))
/** On a card: point at it, open its More, and choose. */
/** What `get` finds, once it is drawn. */
const found = <T,>(get: () => T | null | undefined) =>
  waitFor(() => {
    const it = get()
    expect(it).toBeTruthy()
    return it!
  })
/** Whether a thread waits in one of the column's groups ("Resolved", "On deleted blocks"): the group whose panel holds it is titled so. */
const under = (group: string, id: string) => {
  const panel = item(id)?.parentElement?.closest<HTMLElement>('[data-closed], [data-open]')
  const title = panel?.parentElement?.querySelector('button[aria-expanded]')
  return !!title && title.textContent?.startsWith(group) === true
}
const choose = (id: string, row: 'Edit message' | 'Delete message' | 'Resolve' | 'Reopen') => {
  pointAt(entry(id)!)
  act(() => void fireEvent.click(within(entry(id)!).getByRole('button', { name: 'More' })))
  act(() => void fireEvent.click(screen.getByRole('menuitem', { name: row })))
}

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
    await waitFor(() => expect(items()).toHaveLength(3))
    expect(items().map((c) => [within(c).queryByText(/^On /)?.textContent, c.querySelector('[data-comment-body]')?.textContent?.match(/Too long\?|About the page|since deleted/)?.[0]])).toEqual([
      ['On the paragraph', 'Too long?'],
      ['On the whole document', 'About the page'],
      // Detached is said, in its own section, never drawn as a comment on the whole document (SPEC §13.6).
      ['On blocks deleted from the page', 'since deleted'],
    ])
    expect(screen.getByText('On deleted blocks')).toBeTruthy()
  })

  it("draws a comment's author by their profile picture, and by no picture when their profile has none (LFB-1)", async () => {
    const PICTURE = 'https://id.estiva.app/avatar/qa1.jpg'
    // A key no other test reads: the profile cache keeps a person's answer across tests.
    const FACE = '5'.repeat(64)
    const pictured: SignedEvent = { ...profile(FACE, 'Katerina'), content: JSON.stringify({ name: 'Katerina', picture: PICTURE }) }
    const byFace: SignedEvent = { ...comment([], 'Mine has a face'), id: '8'.repeat(64), pubkey: FACE }
    const byQa2: SignedEvent = { ...comment([], 'No picture here'), id: '9'.repeat(64), pubkey: QA2 }
    await open([roster, pictured, profile(QA2, 'QA-2'), byFace, byQa2])
    const card = (words: RegExp) => entries().find((c) => words.test(c.textContent ?? ''))
    await waitFor(() => expect(card(/Mine has a face/)?.querySelector('img')?.getAttribute('src')).toBe(PICTURE))
    await waitFor(() => expect(card(/No picture here/)?.textContent).toContain('QA-2'))
    expect(card(/No picture here/)?.querySelector('img')).toBeNull()
  })

  it("draws an agent's comment by the robot, as every app draws an agent, and a person's by their initials", async () => {
    // Keys no other test reads: the profile cache keeps a person's answer across tests.
    const AGENT = '6'.repeat(64)
    const PERSON = '7'.repeat(64)
    const agent: SignedEvent = { ...profile(AGENT, 'Claude'), content: JSON.stringify({ name: 'Claude', bot: true }) }
    const byAgent: SignedEvent = { ...comment([], 'Written by an agent'), id: '6'.repeat(64), pubkey: AGENT }
    const byPerson: SignedEvent = { ...comment([], 'Written by a person'), id: '7'.repeat(64), pubkey: PERSON }
    await open([roster, agent, profile(PERSON, 'Ana'), byAgent, byPerson])
    const card = (words: RegExp) => entries().find((c) => words.test(c.textContent ?? ''))
    // The kit's robot, in place of the initials.
    const robot = (words: RegExp) => !!card(words)?.querySelector('path[d^="M13.5 2C13.5 2.44425"]')
    await waitFor(() => expect(card(/Written by a person/)?.textContent).toContain('Ana'))
    await waitFor(() => expect(robot(/Written by an agent/)).toBe(true))
    expect(robot(/Written by a person/)).toBe(false)
  })

  it('draws a second-level item in a comment nested under the item above it, as the box wrote it', async () => {
    await open([comment([], '- Agenda\n  - budget\n- Next')])
    await waitFor(() => expect(document.querySelector('[data-conversation-item] li')).not.toBeNull())
    const card = entries()[0]
    // Each item's own words, and how many items it sits inside.
    const depth = (li: Element) => {
      let n = 0
      for (let up = li.parentElement?.closest('li'); up; up = up.parentElement?.closest('li')) n += 1
      return n
    }
    const words = (li: Element) => {
      const own = li.cloneNode(true) as Element
      own.querySelectorAll('ul, ol').forEach((list) => list.remove())
      return own.textContent
    }
    expect([...card.querySelectorAll('li')].map((li) => [words(li), depth(li)])).toEqual([
      ['Agenda', 0],
      ['budget', 1],
      ['Next', 0],
    ])
  })

  it("marks a paragraph's card when its highlight is chosen in the text", async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(item(onParagraph.id)).not.toBeNull())
    act(() => void page().editor.emit('commentSelect', { id: onParagraph.id }))
    // The open card takes a reply.
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply…' })).toBeTruthy())
    expect(item(onParagraph.id)!.getAttribute('data-open')).toBe('true')
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
    const card = await waitFor(() => entries()[0])
    await waitFor(() => expect(within(card).getByText('@QA-2')).toBeTruthy())
    expect(card.querySelector('strong')?.textContent).toBe('this')
  })

  it("offers a thread's own comment first under Messages in its reply box, and the pick goes out as a q", async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    const elsewhere = comment([], 'About the page')
    await open([roster, profile(AUTHOR, 'QA-1'), onParagraph, elsewhere])
    await waitFor(() => expect(items()).toHaveLength(2))
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

  it("offers Ship's / rows in the box: Upload, Mention, Urgent and Reference", async () => {
    await open([])
    write('Comment on this document…', '/')
    await screen.findAllByRole('option')
    const rows = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    for (const row of ['Upload', 'Mention', 'Urgent', 'Reference']) expect(rows.some((r) => r.includes(row))).toBe(true)
  })

  it('sends with Ctrl+Enter as with Enter', async () => {
    await open([])
    write('Comment on this document…', 'Sent with the chord')
    act(() => void fireEvent.keyDown(box('Comment on this document…'), { key: 'Enter', ctrlKey: true }))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    expect(publish.mock.calls[0][0].content).toBe('Sent with the chord')
  })

  it('puts your text back and says so when the relay refuses it', async () => {
    publish.mockResolvedValueOnce({ ok: false, reason: 'restricted: not a channel member' })
    await open([])
    await waitFor(() => expect(screen.getByText(/No comments yet/)).toBeTruthy())
    write('Comment on this document…', 'Refused words')
    sendWithEnter('Comment on this document…')
    await waitFor(() => expect(screen.getByText('Not sent: you can no longer write here. Your text is back in the box.')).toBeTruthy())
    expect(box('Comment on this document…').editor.getText()).toBe('Refused words')
  })

  /*
    Guards, not red first (code review of 4 November): what the column kept from before the kit's cards, with no test
    of its own until now. Each passes on the code as it is. The two scrolls (a card → its words in the text, a highlight
    → its card in the column) are not here: jsdom has no layout to scroll.
  */
  /** The comments' read (`#A`), answered by `answer`; every other read as the relay holds it. */
  const commentsReadAnswers = (answer: () => Promise<SignedEvent[]>) => {
    const real = vi.mocked(query).getMockImplementation()!
    vi.mocked(query).mockImplementation(async (filters) => (filters.some((f) => '#A' in f && (f.kinds as number[] | undefined)?.includes(1111)) ? answer() : real(filters)))
    return () => vi.mocked(query).mockImplementation(real)
  }

  it('shows the kit’s placeholders while the comments are read, and no empty line', async () => {
    const restore = commentsReadAnswers(() => new Promise<never>(() => {}))
    try {
      await open([comment([], 'About the page')])
      await waitFor(() => expect(document.querySelectorAll('[aria-hidden="true"] .animate-pulse').length).toBeGreaterThan(0))
      expect(screen.queryByText(/No comments yet/)).toBeNull()
      expect(screen.queryByText('About the page')).toBeNull()
    } finally {
      restore()
    }
  })

  it('says the comments could not be read when their read fails, not that there are none', async () => {
    const restore = commentsReadAnswers(async () => {
      throw new Error('blocked: rate-limited')
    })
    try {
      await open([comment([], 'About the page')])
      expect(await screen.findByText('Could not read the comments. Try again in a moment.')).toBeTruthy()
      expect(screen.queryByText(/No comments yet/)).toBeNull()
      expect(document.querySelectorAll('[aria-hidden="true"] .animate-pulse')).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('moves a thread under Resolved without a reload when someone else resolves it', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(item(onParagraph.id)).not.toBeNull())
    const theirs: SignedEvent = { id: 'e'.repeat(64), pubkey: AUTHOR, created_at: 1_760_000_200, kind: 9101, tags: [['h', FOLDER], ['e', onParagraph.id], ['t', 'resolution'], ['action', 'resolved']], content: '', sig: '' }
    relay.events = [onParagraph, theirs]
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() => live.listeners.forEach((l) => l(FOLDER, theirs)))
      await act(() => vi.advanceTimersByTimeAsync(300))
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(under('Resolved', onParagraph.id)).toBe(true))
  })

  // Changed on purpose: Resolve is on the card's strip, shown while it is pointed at, and asks for an optional note
  // first (the kit's ResolveDialog), where it was a button always shown that resolved at once.
  it('moves a thread under Resolved with the 9101 resolution', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(item(onParagraph.id)).not.toBeNull())
    // The relay keeps what it accepts, so the column's read after the write finds it.
    publish.mockImplementationOnce(async (e) => {
      relay.events = [...relay.events, { ...e, id: 'f'.repeat(64), sig: '' } as SignedEvent]
      return { ok: true }
    })
    pointAt(entry(onParagraph.id)!)
    act(() => void fireEvent.click(within(entry(onParagraph.id)!).getByRole('button', { name: 'Resolve' })))
    const dialog = await screen.findByRole('dialog')
    act(() => void fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' })))
    await waitFor(() => expect(under('Resolved', onParagraph.id)).toBe(true))
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
      const card = await found(() => entries()[0])
      const row = await waitFor(() => {
        const found = card.querySelector<HTMLElement>('[data-link-row]')
        expect(found).toBeTruthy()
        return found!
      })
      expect(within(row).getByText('Fix the login')).toBeTruthy()
      expect(row.closest('p')).toBeNull()
      // In a sentence the other file stays the chip it was written as, with no row.
      await waitFor(() => expect(within(card).getByText('Export to PDF')).toBeTruthy())
      expect(within(card).getByText('Export to PDF').closest('[data-link-row], [data-card]')).toBeNull()
      expect(card.textContent).toContain('See')
    })

    it("draws the card another app's writer carried under the text, and nothing for its file's line, which the card stands for", async () => {
      await open([comment([['embed', ISSUE_ADDRESS, 'detailed']], `See\n${ISSUE}`)])
      const card = await found(() => entries()[0])
      const carried = await waitFor(() => {
        const found = card.querySelector<HTMLElement>('[data-card="detailed"]')
        expect(found).toBeTruthy()
        return found!
      })
      expect(within(carried).getByText('Fix the login, in short.')).toBeTruthy()
      expect(within(card).getAllByText('Fix the login')).toHaveLength(1)
      expect(card.querySelector('[data-link-row]')).toBeNull()
    })

    it('draws a bullet that is only a link as its row, and keeps the bullet', async () => {
      await open([comment([], `Read these:\n\n- ${ISSUE}\n- and ${OTHER} later`)])
      const card = await found(() => entries()[0])
      const row = await waitFor(() => {
        const found = card.querySelector<HTMLElement>('[data-link-row]')
        expect(found).toBeTruthy()
        return found!
      })
      expect(within(row).getByText('Fix the login')).toBeTruthy()
      expect(row.closest('li')).toBeTruthy()
      // The second bullet is a sentence: its file stays a chip.
      await waitFor(() => expect(within(card).getByText('Export to PDF')).toBeTruthy())
      expect(card.querySelectorAll('[data-link-row], [data-card]')).toHaveLength(1)
    })

    it('says a carried card\'s file is not available, rather than drop the link, when it cannot be read', async () => {
      await open([comment([['embed', GONE_ADDRESS, 'detailed']], `See\n${GONE}`)])
      const card = await found(() => entries()[0])
      // Changed on purpose: kit 0.102.0 (ALO-4) says "You can't open this issue", not "Issue not available".
      await waitFor(() => expect(within(card).getByText("You can't open this issue")).toBeTruthy())
      expect(card.querySelector('[data-card="detailed"]')).toBeTruthy()
    })

    it("draws another of this page's comments alone on its line as its row: its author and opening words", async () => {
      const first = comment([], 'The export drops the tables.')
      const second = comment([['q', first.id]], `Same as\nnostr:${encodeNevent({ id: first.id, relays: [] })}`)
      await open([profile(AUTHOR, 'QA-1'), first, second])
      const card = await found(() => entry(second.id))
      const row = await waitFor(() => {
        const found = card.querySelector<HTMLElement>(`[data-comment-row="${first.id}"]`)
        expect(found).toBeTruthy()
        return found!
      })
      expect(row.textContent).toContain('The export drops the tables.')
      expect(row.closest('p')).toBeNull()
    })

    it('draws another of this page’s comments as the kit’s message row and chip: its author by name, its words, and a link to this page’s comments', async () => {
      const first = comment([], 'The export drops the tables.')
      const reference = `nostr:${encodeNevent({ id: first.id, relays: [] })}`
      const alone = comment([['q', first.id]], `Same as\n${reference}`)
      const inSentence = comment([['q', first.id]], `Same as ${reference} again`)
      await open([profile(AUTHOR, 'QA-1'), first, alone, inSentence])
      const row = await waitFor(() => {
        const drawn = entry(alone.id)?.querySelector<HTMLElement>(`[data-comment-row="${first.id}"]`)
        expect(drawn && within(drawn).queryByText('QA-1')).toBeTruthy()
        return drawn!
      })
      expect(within(row).getByText('The export drops the tables.')).toBeTruthy()
      expect(within(row).getByText('QA-1').closest('a')?.getAttribute('href')).toMatch(/^\/document\/.+#comments$/)
      const chip = await waitFor(() => within(entry(inSentence.id)!).getByText('QA-1: The export drops the tables.'))
      expect(chip.closest('a')?.getAttribute('href')).toMatch(/^\/document\/.+#comments$/)
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

  /*
    What a new comment will be on is the kit's strip above the box (CommentBox `about`, ONE-5 step 4), drawn as the
    posted card will say it: the quoted words in the page's highlight (`data-quoted="here"`), or Leaf's words for whole
    blocks on the grey (`data-quoted="part"`). Changed on purpose: Leaf's own line said "On “words”".
  */
  /** The strip's line: how it is drawn, and what it says. */
  const aboutTheBox = () => {
    const line = document.querySelector<HTMLElement>('[data-box-about] [data-quoted]')
    return line && [line.dataset.quoted, line.textContent]
  }

  afterEach(() => vi.useRealTimers())

  it('sends a few selected words as a comment on their paragraph quoting exactly them, and says so over the box', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await open([], PAGE)
    await commentOnSelection('wrote this')
    await waitFor(() => expect(aboutTheBox()).toEqual(['here', 'wrote this']))
    write('Comment on these words…', 'Which draft?')
    sendWithEnter('Comment on these words…')
    await waitFor(() => expect(publish).toHaveBeenCalled())
    const e = publish.mock.calls[0][0]
    expect(e.kind).toBe(1111)
    expect(e.tags).toContainEqual(['block', FIRST])
    expect(e.tags).toContainEqual(['quote', 'wrote this'])
    expect(e.tags.filter((t) => t[0] === 'block')).toHaveLength(1)
  })

  it('✕ on the strip goes back to the whole document, and the thread open before comes back without taking the caret', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onFirst = comment([['block', FIRST]], 'Too long?')
    await open([onFirst], PAGE)
    await waitFor(() => expect(item(onFirst.id)).not.toBeNull())
    act(() => void fireEvent.click(entry(onFirst.id)!))
    await waitFor(() => expect(box('Reply…')).toBeTruthy())
    await commentOnSelection('Katerina owns')
    await waitFor(() => expect(aboutTheBox()).toEqual(['here', 'Katerina owns']))
    // The draft takes over from the open thread.
    expect(screen.queryByRole('textbox', { name: 'Reply…' })).toBeNull()
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Comment on the whole document instead' })))
    await waitFor(() => expect(box('Reply…')).toBeTruthy())
    expect(aboutTheBox()).toBeNull()
    expect(box('Comment on this document…')).toBeTruthy()
    // Two frames and more: the box would take the caret a frame after it is drawn.
    await act(async () => void (await vi.advanceTimersByTimeAsync(100)))
    expect(item(onFirst.id)!.getAttribute('data-open')).toBe('true')
    const reply = box('Reply…')
    expect(reply === document.activeElement || reply.contains(document.activeElement)).toBe(false)
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
    await waitFor(() => expect(aboutTheBox()).toEqual(['here', 'Katerina owns']))
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
    await waitFor(() => expect(aboutTheBox()).toEqual(['part', 'On 2 paragraphs']))
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
    await waitFor(() => expect(aboutTheBox()).toEqual(['here', 'wrote this']))
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
    await waitFor(() => expect(items()).not.toHaveLength(0))
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

  // Changed on purpose: a reply shows once its thread is open (the kit's replies row, one thread open at a time).
  it("draws someone else's reactions on a comment and on its reply, not lit, and names who reacted", async () => {
    const root = comment([], 'Too long?')
    const reply = replyTo(root, 'Cut it')
    await open([root, reply, reaction(root.id, '👍', QA2, '7'.repeat(64)), reaction(reply.id, '🙏', QA2, '6'.repeat(64)), profile(QA2, 'QA-2')])
    const onRoot = await pill('Makes sense, 1')
    expect(onRoot.getAttribute('aria-pressed')).toBe('false')
    openReplies(root.id)
    expect((await pill('Thank you, 1')).closest('[data-reply-id]')?.getAttribute('data-reply-id')).toBe(reply.id)
    fireEvent.pointerEnter(onRoot)
    fireEvent.focus(onRoot)
    expect(await screen.findByText('QA-2 reacted with Makes sense')).toBeTruthy()
  })

  // Changed on purpose: the add button is the card strip's React, shown while the card is pointed at, where it was
  // "Add a reaction" on the comment's header line.
  it('reacts from the picker with a kind:7 on the comment and no h, and the pill shows, lit, once the relay accepts it', async () => {
    const root = comment([], 'Too long?')
    await open([root])
    await waitFor(() => expect(items()).not.toHaveLength(0))
    relayKeeps()
    pointAt(entry(root.id)!)
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'React' })))
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Makes sense' })))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.content, e.tags, e.pubkey]).toEqual([7, '👍', [['e', root.id], ['p', AUTHOR]], ME])
    expect((await pill('Makes sense, 1')).getAttribute('aria-pressed')).toBe('true')
  })

  const reactTo = async (target: SignedEvent, extra: SignedEvent[] = []) => {
    await open([target, ...extra])
    await waitFor(() => expect(items()).not.toHaveLength(0))
    pointAt(entry(target.id)!)
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'React' })))
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Makes sense' })))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    return publish.mock.calls[0][0]
  }

  it("names the comment's author on the reaction, not the page's author or someone the comment mentions (ACT-6)", async () => {
    // QA-2's comment on AUTHOR's page, mentioning ME: it carries a `p` for each of them, and is QA-2's.
    const theirs = { ...comment([['p', ME]], 'Over to you'), pubkey: QA2 }
    const e = await reactTo(theirs)
    expect(e.tags).toEqual([['e', theirs.id], ['p', QA2]])
  })

  // The relay's key is read once a session: each test starts without it.
  beforeEach(() => forgetRelayKey())
  const RELAY = 'e'.repeat(64)
  // A team record: the relay signs it, so its signer is the relay's key.
  const team: SignedEvent = { id: 'd'.repeat(63) + '1', pubkey: RELAY, created_at: 1_760_000_000, kind: 39000, tags: [['d', FOLDER]], content: '', sig: '' }
  const forQa2 = (content: string) => ({ ...comment([['actor', QA2]], content), pubkey: RELAY })
  const readsRelayKey = (filters: Record<string, unknown>[]) => filters.some((f) => (f.kinds as number[] | undefined)?.includes(39000))
  const pick = (target: SignedEvent) => {
    pointAt(entry(target.id)!)
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'React' })))
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Makes sense' })))
  }

  it('names the person the relay signed a comment for, not the relay, once it has read the relay key (ACT-6)', async () => {
    const posted = forQa2('Posted for QA-2')
    const e = await reactTo(posted, [team])
    expect(e.tags).toEqual([['e', posted.id], ['p', QA2]])
  })

  it("names the comment's author on a reaction to an edited comment, not whoever made the edit (ACT-6)", async () => {
    const theirs = { ...comment([], 'Too long?'), pubkey: QA2 }
    const edit: SignedEvent = { id: '6'.repeat(64), pubkey: QA2, created_at: 1_760_000_300, kind: 40003, tags: [['h', FOLDER], ['e', theirs.id], ['ts', '1760000300000']], content: 'Far too long?', sig: '' }
    const e = await reactTo(theirs, [edit])
    expect(within(entry(theirs.id)!).getByText('(edited)')).toBeTruthy()
    expect(e.tags).toEqual([['e', theirs.id], ['p', QA2]])
  })

  it("still reacts when the relay key cannot be read, naming the comment's signer, and reads it again for the next reaction (ACT-6)", async () => {
    const first = forQa2('Posted for QA-2')
    const second = forQa2('Posted for QA-2 again')
    const real = vi.mocked(query).getMockImplementation()!
    let failures = 0
    vi.mocked(query).mockImplementation(async (filters) => {
      if (readsRelayKey(filters) && failures++ === 0) throw new Error('relay unreachable')
      return real(filters)
    })
    try {
      await open([first, second, team])
      await waitFor(() => expect(items()).not.toHaveLength(0))
      pick(first)
      await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
      expect(publish.mock.calls[0][0].tags).toEqual([['e', first.id], ['p', RELAY]])
      pick(second)
      await waitFor(() => expect(publish).toHaveBeenCalledTimes(2))
      expect(publish.mock.calls[1][0].tags).toEqual([['e', second.id], ['p', QA2]])
    } finally {
      vi.mocked(query).mockImplementation(real)
    }
  })

  it('reads the relay key again for the next reaction when the first read found none (ACT-6)', async () => {
    const first = forQa2('Posted for QA-2')
    const second = forQa2('Posted for QA-2 again')
    await open([first, second])
    await waitFor(() => expect(items()).not.toHaveLength(0))
    pick(first)
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    expect(publish.mock.calls[0][0].tags).toEqual([['e', first.id], ['p', RELAY]])
    relay.events = [...relay.events, team]
    pick(second)
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2))
    expect(publish.mock.calls[1][0].tags).toEqual([['e', second.id], ['p', QA2]])
  })

  it('shows your 👍 at once, lit, while the relay key is still being read and before anything is sent (ACT-6)', async () => {
    const posted = forQa2('Posted for QA-2')
    const real = vi.mocked(query).getMockImplementation()!
    vi.mocked(query).mockImplementation((filters) => (readsRelayKey(filters) ? new Promise<never>(() => {}) : real(filters)))
    try {
      await open([posted, team])
      await waitFor(() => expect(items()).not.toHaveLength(0))
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      pick(posted)
      expect(screen.queryByRole('button', { name: 'Makes sense, 1' })?.getAttribute('aria-pressed')).toBe('true')
      expect(publish).not.toHaveBeenCalled()
      await act(() => vi.advanceTimersByTimeAsync(5_000))
      expect(publish.mock.calls.map(([e]) => [e.kind, e.content, e.tags])).toEqual([[7, '👍', [['e', posted.id], ['p', RELAY]]]])
    } finally {
      vi.useRealTimers()
      vi.mocked(query).mockImplementation(real)
    }
  })

  it('takes your 👍 back at once when you click it again while it is still on its way, and sends the take-back after it (ACT-6)', async () => {
    const posted = forQa2('Posted for QA-2')
    const real = vi.mocked(query).getMockImplementation()!
    vi.mocked(query).mockImplementation((filters) => (readsRelayKey(filters) ? new Promise<never>(() => {}) : real(filters)))
    publish.mockResolvedValueOnce({ ok: true, eventId: '9'.repeat(64) })
    try {
      await open([posted, team])
      await waitFor(() => expect(items()).not.toHaveLength(0))
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      pick(posted)
      act(() => void fireEvent.click(screen.getByRole('button', { name: 'Makes sense, 1' })))
      expect(screen.queryByRole('button', { name: 'Makes sense, 1' })).toBeNull()
      await act(() => vi.advanceTimersByTimeAsync(5_000))
      expect(publish.mock.calls.map(([e]) => [e.kind, e.tags])).toEqual([
        [7, [['e', posted.id], ['p', RELAY]]],
        [5, [['e', '9'.repeat(64)]]],
      ])
      expect(screen.queryByRole('button', { name: 'Makes sense, 1' })).toBeNull()
    } finally {
      vi.useRealTimers()
      vi.mocked(query).mockImplementation(real)
    }
  })

  it("takes your reaction off the pill at once, before the relay answers, and leaves the others' on it", async () => {
    const root = comment([], 'Too long?')
    const mine = reaction(root.id, '👍', ME, '8'.repeat(64))
    await open([root, reaction(root.id, '👍', QA2, '7'.repeat(64)), mine])
    publish.mockImplementationOnce(() => new Promise(() => {}))
    const both = await pill('Makes sense, 2')
    act(() => void fireEvent.click(both))
    expect(screen.queryByRole('button', { name: 'Makes sense, 1' })?.getAttribute('aria-pressed')).toBe('false')
  })

  it("still reacts, naming the comment's signer, when the relay key read does not answer (ACT-6)", async () => {
    const posted = forQa2('Posted for QA-2')
    const real = vi.mocked(query).getMockImplementation()!
    vi.mocked(query).mockImplementation((filters) => (readsRelayKey(filters) ? new Promise<never>(() => {}) : real(filters)))
    try {
      await open([posted, team])
      await waitFor(() => expect(items()).not.toHaveLength(0))
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      pick(posted)
      await act(() => vi.advanceTimersByTimeAsync(5_000))
      vi.useRealTimers()
      await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
      expect(publish.mock.calls[0][0].tags).toEqual([['e', posted.id], ['p', RELAY]])
    } finally {
      vi.useRealTimers()
      vi.mocked(query).mockImplementation(real)
    }
  })

  it('signed out, shows the reactions with nothing to click and writes nothing', async () => {
    const root = comment([], 'Too long?')
    signedIn.pubkey = null
    try {
      await open([root, reaction(root.id, '👍', QA2, '7'.repeat(64))])
      const shown = await pill('Makes sense, 1')
      expect((shown as HTMLButtonElement).disabled).toBe(true)
      pointAt(entry(root.id)!)
      for (const name of ['React', 'Add a reaction']) expect(screen.queryByRole('button', { name })).toBeNull()
      act(() => void fireEvent.click(shown))
      await act(async () => {})
      expect(publish).not.toHaveBeenCalled()
    } finally {
      signedIn.pubkey = ME
    }
  })

  // Changed on purpose: your 👍 shows at once, so a second pick before the read lands takes it back, by the id the relay
  // gave it, where it used to write nothing; it never writes a second kind:7 from the row as it was.
  it('takes an accepted reaction back by its id when you pick it again before the read after it lands', async () => {
    const root = comment([], 'Too long?')
    await open([root])
    await waitFor(() => expect(items()).not.toHaveLength(0))
    const real = vi.mocked(query).getMockImplementation()!
    // The relay accepts the reaction; the column's read after it does not answer yet.
    vi.mocked(query).mockImplementation((filters) => (readsRelayKey(filters) ? real(filters) : new Promise(() => {})))
    publish.mockResolvedValueOnce({ ok: true, eventId: '9'.repeat(64) })
    try {
      pick(root)
      await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
      await act(async () => {})
      pick(root)
      await waitFor(() => expect(publish).toHaveBeenCalledTimes(2))
      expect(publish.mock.calls.map(([e]) => [e.kind, e.tags])).toEqual([
        [7, [['e', root.id], ['p', AUTHOR]]],
        [5, [['e', '9'.repeat(64)]]],
      ])
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
    expect(await screen.findByText('Not reacted: you can no longer write here.')).toBeTruthy()
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
    await waitFor(() => expect(items()).not.toHaveLength(0))
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
  const line = entry
  /** What a card's More offers once it is pointed at: its rows, or null when it has no More. */
  const offered = async (id: string) => {
    pointAt(entry(id)!)
    const more = within(entry(id)!).queryByRole('button', { name: 'More' })
    if (!more) return null
    act(() => void fireEvent.click(more))
    const menu = await screen.findByRole('menu')
    const rows = within(menu).getAllByRole('menuitem').map((m) => m.textContent)
    act(() => void fireEvent.keyDown(menu, { key: 'Escape' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    return rows
  }

  // Changed on purpose: the kit's More holds Resolve on every open comment, so someone else's comment has a More too,
  // with Resolve alone; and a reply shows once its thread is open.
  it("offers Edit and Delete on your own comment and reply, and neither on someone else's", async () => {
    const theirs = comment([], 'Too long?')
    const yours = replyTo(theirs, 'Cut it', ME)
    const own = mine([], 'Mine')
    await open([theirs, yours, own])
    await waitFor(() => expect(line(own.id)).not.toBeNull())
    expect(await offered(theirs.id)).toEqual(['Resolve'])
    expect(await offered(own.id)).toEqual(['Resolve', 'Edit message', 'Delete message'])
    openReplies(theirs.id)
    await waitFor(() => expect(line(yours.id)).not.toBeNull())
    expect(await offered(yours.id)).toEqual(['Edit message', 'Delete message'])
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

  // Changed on purpose: More is there for Resolve, which the column offered signed out before too; Edit and Delete are not.
  it('signed out, offers neither on what you wrote', async () => {
    const own = mine([], 'Mine')
    signedIn.pubkey = null
    try {
      await open([own])
      await waitFor(() => expect(line(own.id)).not.toBeNull())
      expect(await offered(own.id)).toEqual(['Resolve'])
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
    expect(within(item(own.id)!).getByText('On the paragraph')).toBeTruthy()
  })

  describe("the one file's card under a sent comment (WBD-6)", () => {
    const CARD_ADDRESS = `30851:${QA2}:card-under`
    const CARD = `nostr:${encodeNaddr({ kind: 30851, pubkey: QA2, identifier: 'card-under', relays: [] })}`
    beforeAll(() => {
      files.known[CARD] = { ref: 'r', kind: 30851, eventId: 'e', widget: 'card', noun: 'issue', meta: [], actions: [], viaRecommendation: false, address: CARD_ADDRESS, slots: { title: { value: 'Card under' } } }
    })
    const cardOf = (id: string) => line(id)?.querySelector<HTMLElement>('[data-card="detailed"]') ?? null

    it('✕ on your own comment’s card writes a 40003 with the words as they are and that card none, and the card goes without marking the comment edited', async () => {
      const own = mine([['embed', CARD_ADDRESS, 'detailed']], `See\n${CARD}`)
      await open([own])
      await waitFor(() => expect(cardOf(own.id)?.textContent).toContain('Card under'))
      publish.mockImplementationOnce(async (e) => {
        relay.events = [...relay.events, { ...e, id: '9'.repeat(64), sig: '' } as SignedEvent]
        return { ok: true }
      })
      act(() => void fireEvent.click(within(cardOf(own.id)!).getByRole('button', { name: 'Remove' })))
      await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
      const e = publish.mock.calls[0][0]
      expect([e.kind, e.content, e.pubkey]).toEqual([40003, `See\n${CARD}`, ME])
      expect(e.tags).toEqual(expect.arrayContaining([['h', FOLDER], ['e', own.id], ['embed', CARD_ADDRESS, 'none']]))
      await waitFor(() => expect(cardOf(own.id)).toBeNull())
      expect(within(line(own.id)!).queryByText('(edited)')).toBeNull()
    })

    it('✕ on a comment you already edited keeps your edited words, not the ones you first sent', async () => {
      const own = mine([['embed', CARD_ADDRESS, 'detailed']], `First\n${CARD}`)
      const reworded: SignedEvent = { id: '5'.repeat(64), pubkey: ME, created_at: own.created_at + 60, kind: 40003, tags: [['h', FOLDER], ['e', own.id]], content: `Reworded\n${CARD}`, sig: '' }
      await open([own, reworded])
      await waitFor(() => expect(cardOf(own.id)?.textContent).toContain('Card under'))
      act(() => void fireEvent.click(within(cardOf(own.id)!).getByRole('button', { name: 'Remove' })))
      await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
      expect(publish.mock.calls[0][0].content).toBe(`Reworded\n${CARD}`)
    })

    // An edit's set replaces the comment's (§13.6.2), so the card it had rides along with the new file's default one.
    it('editing your comment with a card to name a new file saves the new file’s card and keeps the one it had', async () => {
      const SECOND_ADDRESS = `30851:${QA2}:second-file`
      const SECOND = `nostr:${encodeNaddr({ kind: 30851, pubkey: QA2, identifier: 'second-file', relays: [] })}`
      files.known[SECOND] = { ...(files.known[CARD] as object), address: SECOND_ADDRESS, slots: { title: { value: 'Second file' } } }
      const own = mine([['embed', CARD_ADDRESS, 'detailed']], `See\n${CARD}`)
      await open([own])
      await waitFor(() => expect(cardOf(own.id)?.textContent).toContain('Card under'))
      await choose(own.id, 'Edit message')
      act(() => void box('Edit message').editor.chain().focus().selectAll().insertContent(`See ${SECOND} `).run())
      act(() => void fireEvent.click(screen.getByRole('button', { name: 'Save' })))
      await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
      const e = publish.mock.calls[0][0]
      expect([e.kind, e.pubkey]).toEqual([40003, ME])
      expect(e.tags.filter((t) => t[0] === 'embed')).toEqual([
        ['embed', CARD_ADDRESS, 'detailed'],
        ['embed', SECOND_ADDRESS, 'detailed'],
      ])
    })

    it('offers no ✕ on the card under someone else’s comment', async () => {
      const theirs = comment([['embed', CARD_ADDRESS, 'detailed']], `See\n${CARD}`)
      await open([theirs])
      await waitFor(() => expect(cardOf(theirs.id)?.textContent).toContain('Card under'))
      expect(within(cardOf(theirs.id)!).queryByRole('button', { name: 'Remove' })).toBeNull()
    })

    it('draws no card under a comment whose author took it off in Peek or Ship, and the file’s line draws again', async () => {
      const theirs = comment([['embed', CARD_ADDRESS, 'detailed']], `See\n${CARD}`)
      const removed: SignedEvent = { id: '7'.repeat(64), pubkey: AUTHOR, created_at: theirs.created_at + 60, kind: 40003, tags: [['h', FOLDER], ['e', theirs.id], ['embed', CARD_ADDRESS, 'none']], content: theirs.content, sig: '' }
      await open([theirs, removed])
      await waitFor(() => expect(line(theirs.id)?.querySelector('[data-link-row]')?.textContent).toContain('Card under'))
      expect(cardOf(theirs.id)).toBeNull()
    })
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
    publish.mockResolvedValueOnce({ ok: false, reason: 'invalid: target event not found' })
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(await screen.findByText(/^Not saved: this message was deleted, or you can no longer write here\./)).toBeTruthy()
    expect(box('Edit message').textContent).toContain('Far too long?')
  })

  // Changed on purpose: the reply shows once the thread is open (the kit's replies row), here from its highlight in the
  // text; and the deleted card has no strip at all, so no Resolve.
  // A guard (code review, 4 November): one question only. A refusal shown again after Cancel is the kit's to fix
  // (0.104.3), so this test does not ask twice.
  it('keeps the delete question open and says why when the relay refuses it; the comment stays', async () => {
    const own = mine([], 'Too long?')
    await open([own])
    await found(() => entry(own.id))
    publish.mockResolvedValueOnce({ ok: false, reason: 'restricted: not a channel member' })
    choose(own.id, 'Delete message')
    const dialog = await screen.findByRole('alertdialog')
    act(() => void fireEvent.click(within(dialog).getByRole('button', { name: 'Delete message' })))
    expect(await within(dialog).findByText('Not deleted: you can no longer write here.')).toBeTruthy()
    expect(dialog.isConnected).toBe(true)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(within(entry(own.id)!).getByText('Too long?')).toBeTruthy()
  })

  it("deletes your comment after asking; QA-2's reply stays on its paragraph, highlighted, under the note, with no reply box and no Resolve", async () => {
    const own = mine([['block', PARAGRAPH]], 'Too long?')
    const theirs = replyTo(own, 'Cut it', QA2, [['block', PARAGRAPH]])
    await open([own, theirs])
    await waitFor(() => expect(within(item(own.id)!).getByRole('button', { name: /^1 reply/ })).toBeTruthy())
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
      const c = item(own.id)!
      expect(within(c).getByText('This comment was deleted.')).toBeTruthy()
      return c
    })
    expect(within(card).getByText('On the paragraph')).toBeTruthy()
    pointAt(entry(own.id)!)
    expect(within(card).queryByRole('button', { name: 'Resolve' })).toBeNull()
    // Its highlight stays in the text, and choosing it opens the thread: the reply, and no box.
    expect(page().querySelector(`[data-comment-id="${own.id}"]`)).not.toBeNull()
    act(() => void page().editor.emit('commentSelect', { id: own.id }))
    await waitFor(() => expect(card.getAttribute('data-open')).toBe('true'))
    expect(within(card).getByText('Cut it')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Reply…' })).toBeNull()
  })

  it('keeps a comment deleted while you reply to it as "This comment was deleted." with your text, and says why Send is refused (ONE-10)', async () => {
    const theirs = comment([['block', PARAGRAPH]], 'Too long?')
    await open([roster, profile(AUTHOR, 'QA-1'), theirs])
    await waitFor(() => expect(item(theirs.id)).not.toBeNull())
    act(() => void page().editor.emit('commentSelect', { id: theirs.id }))
    await waitFor(() => expect(box('Reply…')).toBeTruthy())
    write('Reply…', 'Shorter now')
    // Its author deletes it: the relay no longer returns it, and the deletion arrives live.
    const deletion: SignedEvent = { id: '7'.repeat(64), pubkey: AUTHOR, created_at: 1_760_000_300, kind: 5, tags: [['e', theirs.id]], content: '', sig: '' }
    relay.events = [roster, profile(AUTHOR, 'QA-1'), deletion]
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      act(() => live.listeners.forEach((l) => l(FOLDER, deletion)))
      await act(() => vi.advanceTimersByTimeAsync(300))
    } finally {
      vi.useRealTimers()
    }
    const card = await found(() => item(theirs.id))
    await waitFor(() => expect(within(card).getByText('This comment was deleted.')).toBeTruthy())
    expect(within(card).queryByText('Too long?')).toBeNull()
    expect(box('Reply…').editor.getText()).toBe('Shorter now')
    publish.mockResolvedValueOnce({ ok: false, reason: 'invalid: reply parent not found in this team' })
    sendWithEnter('Reply…')
    await waitFor(() => expect(screen.getByText('Not sent: this message was deleted, or you can no longer write here. Your text is back in the box.')).toBeTruthy())
    expect(box('Reply…').editor.getText()).toBe('Shorter now')
  })

  it('keeps a resolved comment its author deleted resolved, with who resolved it and the note, and offers no Reopen (SPEC §6.5)', async () => {
    const own = mine([['block', PARAGRAPH]], 'Too long?')
    const theirs = replyTo(own, 'Cut it', QA2, [['block', PARAGRAPH]])
    const resolution: SignedEvent = { id: 'e'.repeat(64), pubkey: ME, created_at: 1_760_000_200, kind: 9101, tags: [['h', FOLDER], ['e', own.id], ['t', 'resolution'], ['action', 'resolved']], content: 'Cut to one line.', sig: '' }
    const deletion: SignedEvent = { id: '7'.repeat(64), pubkey: ME, created_at: 1_760_000_300, kind: 5, tags: [['e', own.id]], content: '', sig: '' }
    // The relay no longer returns the comment; its reply, its resolution and its author's deletion it does.
    await open([roster, profile(ME, 'QA-1'), theirs, resolution, deletion])
    await waitFor(() => expect(under('Resolved', own.id)).toBe(true))
    const card = item(own.id)!
    await waitFor(() => expect(within(card).getByText('This comment was deleted.')).toBeTruthy())
    expect(within(card).getByText('Cut to one line.')).toBeTruthy()
    expect(within(card).getByText('QA-1')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: /Reopen|Resolve|Reply/ })).toBeNull()
  })

  it("says a comment that wasn't read and wasn't deleted can't be shown, never deleted, with its reply under it and no Reply or Resolve", async () => {
    const unread = comment([['block', PARAGRAPH]], 'Too long?')
    const theirs = replyTo(unread, 'Cut it', QA2, [['block', PARAGRAPH]])
    await open([theirs])
    const card = await found(() => item(unread.id))
    await waitFor(() => expect(within(card).getByText('This comment can’t be shown.')).toBeTruthy())
    expect(within(card).queryByText('This comment was deleted.')).toBeNull()
    expect(within(card).getByText('On the paragraph')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: /^(Resolve|Reply)$/ })).toBeNull()
    act(() => void page().editor.emit('commentSelect', { id: unread.id }))
    await waitFor(() => expect(card.getAttribute('data-open')).toBe('true'))
    expect(within(card).getByText('Cut it')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Reply…' })).toBeNull()
    expect(screen.getByText('This thread takes no new replies.')).toBeTruthy()
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

  /* Attach opens the picker with a click on the box's hidden input, inside the thread's card (Katerina, 22 Oct, LFB-2). */
  it('keeps a reply box open when Attach opens the picker, and the reply names the picked picture by imeta', async () => {
    blobs.upload.mockResolvedValue({ ok: true, file: PNG })
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(items()).not.toHaveLength(0))
    act(() => void page().editor.emit('commentSelect', { id: onParagraph.id }))
    await waitFor(() => expect(box('Reply…')).toBeTruthy())
    write('Reply…', 'This one')
    const card = item(onParagraph.id)!
    act(() => void fireEvent.click(within(card).getByRole('button', { name: 'Attach a file' })))
    expect(screen.queryByRole('textbox', { name: 'Reply…' }), 'the reply box stays open').not.toBeNull()
    act(() => void fireEvent.change(card.querySelector('input[type=file]')!, { target: { files: [new File(['png'], 'shot.png', { type: 'image/png' })] } }))
    await waitFor(() => expect(within(card).getByText('shot.png')).toBeTruthy())
    sendWithEnter('Reply…')
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.content]).toEqual([1111, 'This one'])
    expect(e.tags.filter((t) => t[0] === 'imeta')).toEqual([expect.arrayContaining([`url ${PNG.url}`, 'm image/png', `x ${PNG.x}`, 'filename shot.png'])])
  })

  /* A file added while editing (Miky, 26 Oct, PEEKM-4): the edit box opens with the comment's own, and the save writes the whole set. */
  it('adds a picture while editing your comment, and the edit names it beside the file it had, by imeta', async () => {
    blobs.upload.mockResolvedValue({ ok: true, file: PNG })
    const own: SignedEvent = { ...comment([['imeta', `url ${PDF.url}`, 'm application/pdf', `x ${PDF.x}`, 'size 193', 'filename plan.pdf']], 'The plan'), pubkey: ME }
    await open([own])
    await waitFor(() => expect(entry(own.id)).not.toBeNull())
    choose(own.id, 'Edit message')
    let at: HTMLElement | null = box('Edit message')
    while (at && !at.querySelector('input[type=file]')) at = at.parentElement
    expect(within(at!).getByText('plan.pdf')).toBeTruthy()
    act(() => void fireEvent.change(at!.querySelector('input[type=file]')!, { target: { files: [new File(['png'], 'shot.png', { type: 'image/png' })] } }))
    await waitFor(() => expect(within(at!).getByText('shot.png')).toBeTruthy())
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false))
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.content]).toEqual([40003, 'The plan'])
    expect(e.tags.filter((t) => t[0] === 'imeta').map((t) => t.find((part) => part.startsWith('x ')))).toEqual([`x ${PDF.x}`, `x ${PNG.x}`])
  })

  it('takes one of two files off while editing your comment, and the edit names only the one kept, by imeta', async () => {
    const imeta = (f: typeof PNG) => ['imeta', `url ${f.url}`, `m ${f.m}`, `x ${f.x}`, `size ${f.size}`, `filename ${f.filename}`]
    const own: SignedEvent = { ...comment([imeta(PDF), imeta(PNG)], 'The plan'), pubkey: ME }
    await open([own])
    await waitFor(() => expect(entry(own.id)).not.toBeNull())
    choose(own.id, 'Edit message')
    let at: HTMLElement | null = box('Edit message')
    while (at && !at.querySelector('input[type=file]')) at = at.parentElement
    act(() => void fireEvent.click(within(at!).getByRole('button', { name: 'Remove shot.png' })))
    await waitFor(() => expect(within(at!).queryByText('shot.png')).toBeNull())
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false))
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.content]).toEqual([40003, 'The plan'])
    expect(e.tags.filter((t) => t[0] === 'imeta').map((t) => t.find((part) => part.startsWith('x ')))).toEqual([`x ${PDF.x}`])
  })

  it('takes the only file off while editing your comment, and the edit names none, which takes it off (SPEC §6.8)', async () => {
    const own: SignedEvent = { ...comment([['imeta', `url ${PDF.url}`, 'm application/pdf', `x ${PDF.x}`, 'size 193', 'filename plan.pdf']], 'The plan'), pubkey: ME }
    await open([own])
    await waitFor(() => expect(entry(own.id)).not.toBeNull())
    choose(own.id, 'Edit message')
    let at: HTMLElement | null = box('Edit message')
    while (at && !at.querySelector('input[type=file]')) at = at.parentElement
    act(() => void fireEvent.click(within(at!).getByRole('button', { name: 'Remove plan.pdf' })))
    await waitFor(() => expect(within(at!).queryByText('plan.pdf')).toBeNull())
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false))
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const e = publish.mock.calls[0][0]
    expect([e.kind, e.content]).toEqual([40003, 'The plan'])
    expect(e.tags.filter((t) => t[0] === 'imeta')).toEqual([])
    expect(screen.queryByText(/cannot be taken off/)).toBeNull()
  })

  it('cannot save an edit that takes the only file off a comment with no words, and publishes nothing', async () => {
    const own: SignedEvent = { ...comment([['imeta', `url ${PDF.url}`, 'm application/pdf', `x ${PDF.x}`, 'size 193', 'filename plan.pdf']], ''), pubkey: ME }
    await open([own])
    await waitFor(() => expect(entry(own.id)).not.toBeNull())
    choose(own.id, 'Edit message')
    let at: HTMLElement | null = box('Edit message')
    while (at && !at.querySelector('input[type=file]')) at = at.parentElement
    act(() => void fireEvent.click(within(at!).getByRole('button', { name: 'Remove plan.pdf' })))
    await waitFor(() => expect(within(at!).queryByText('plan.pdf')).toBeNull())
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(publish).not.toHaveBeenCalled()
  })

  it('says why a file did not upload, keeps the words, sends nothing on Enter, and sends the words once its ✕ takes it off', async () => {
    // As protocol's uploadBlob throws it, handed on by blobs.ts as it came.
    blobs.upload.mockResolvedValue({ ok: false, reason: new Error('upload failed: 413 file too large: 99999999 bytes (max 10485760)') })
    await open([])
    await waitFor(() => expect(screen.getByText(/No comments yet/)).toBeTruthy())
    write('Comment on this document…', 'Here is the deck')
    pick(new File(['big'], 'deck.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(within(footBox()).getByText('Too large: the most is 10 MB')).toBeTruthy())
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
      const c = entry(posted.id)
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
  /** Where a click on a kit row or card goes: the link it draws. */
  const opensAt = (drawn: HTMLElement) => (drawn.matches('a[href]') ? drawn : drawn.querySelector('a[href]'))?.getAttribute('href')
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
    act(() => void fireEvent.click(within(under()!).getByRole('button', { name: 'Remove' })))
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
    await waitFor(() => expect(entries()).toHaveLength(2))
    const text = (c: Element) => c.textContent ?? ''
    await waitFor(() => expect(entries().map(text).join('|')).toMatch(/Fix it.*\|.*The block that stays live\.|The block that stays live\..*\|.*Fix it/))
  })

  /** A `kind:5` its author signed, naming `address`: a trusted deletion (SPEC §13.6.1). */
  const deletion = (address: string): SignedEvent => ({
    id: `${address.split(':')[2].replace(/-/g, '').padEnd(62, '0').slice(0, 62)}55`,
    pubkey: address.split(':')[1],
    created_at: 1_760_000_500,
    kind: 5,
    tags: [['a', address], ['k', address.split(':')[0]]],
    content: '',
    sig: '',
  })

  it('a sent comment’s card for a file its author deleted says the issue was deleted, not that it is not available (widget review, item 56)', async () => {
    const D = '88888888-8888-4888-8888-888888888888'
    const GONE = `30851:${SHIP}:${D}`
    await open([...EVENTS, deletion(GONE), comment([['embed', GONE, 'detailed']], `See\n${uriOf(GONE)}`)])
    await waitFor(() => expect(document.querySelector('[data-conversation-item] [data-card="detailed"]')?.textContent).toContain('Issue deleted'))
  })

  it('a sent comment’s part of a page its author deleted says that part’s page was deleted (widget review, items 56 and 57)', async () => {
    const D = '99999999-9999-4999-8999-999999999999'
    const GONE = `30842:${AUTHOR}:${D}`
    await open([...EVENTS, deletion(GONE), comment([['part', GONE, 'b1b1b1b1b1b1']], `see ${uriOf(GONE)} here`)])
    await waitFor(() => expect(document.querySelector('[data-part="deleted"]')?.textContent).toBe('A part of this document deleted'))
  })

  it('a quote of a comment reads an app link in it as what it names, never the raw URL (widget review, item 20)', async () => {
    const first = comment([], `Same as ${ISSUE_URL} then`)
    const second = comment([['q', first.id]], `See\nnostr:${encodeNevent({ id: first.id, relays: [] })}`)
    await open([...EVENTS, first, second])
    const row = await waitFor(() => {
      const drawn = entry(second.id)?.querySelector<HTMLElement>(`[data-comment-row="${first.id}"]`)
      expect(drawn?.textContent).toContain('Same as Issue then')
      return drawn!
    })
    expect(row.textContent).not.toContain('https://')
  })

  it('a sent comment’s part of another page is labelled a document, and its title takes you to that page at the block, in Leaf, with no Open button (Katerina, 31 Oct)', async () => {
    await open([...EVENTS, comment([['part', TWO_ADDRESS, TWO_BLOCK]], `see ${PART_URL}`)])
    const part = await waitFor(() => {
      const drawn = document.querySelector<HTMLElement>('[data-part="resolved"]')
      expect(drawn).not.toBeNull()
      return drawn!
    })
    expect(within(part).getByText('A part of this document')).toBeTruthy()
    const atBlock = new URL(PART_URL)
    expect(within(part).getByRole('link', { name: 'Two' }).getAttribute('href')).toBe(`${atBlock.pathname}${atBlock.hash}`)
    expect(within(part).queryByRole('button', { name: /^Open/ })).toBeNull()
  })

  it('a sent comment’s part of a Ship issue opens the issue in Ship at the block from its title, with no Open in Ship button', async () => {
    const D = '77777777-7777-4777-8777-777777777777'
    const PART_ISSUE = `30851:${SHIP}:${D}`
    const text = descriptionTextToBlockDocument('# Fix it too\n\nThe issue’s block.')
    const block = blockIds(text)[1]
    files.known[uriOf(PART_ISSUE)] = { ...object(PART_ISSUE, 'Fix it too', text), appName: 'Ship', openUrl: `https://ship.example/o/${uriOf(PART_ISSUE).slice('nostr:'.length)}` }
    const atBlock = `https://ship.example/issue/fix-it-too-${D}#block-${block}`
    await open([...EVENTS, file(30851, SHIP, D), comment([['part', PART_ISSUE, block]], `see ${atBlock}`)])
    const part = await waitFor(() => {
      const drawn = document.querySelector<HTMLElement>('[data-part="resolved"]')
      expect(drawn).not.toBeNull()
      return drawn!
    })
    await waitFor(() => expect(within(part).getByRole('link', { name: 'Fix it too' }).getAttribute('href')).toBe(atBlock))
    expect(within(part).queryByRole('button', { name: /^Open/ })).toBeNull()
  })

  it('a sent comment’s card for an issue’s path on Leaf’s host opens Leaf at that address, not where the issue opens (LTX-6)', async () => {
    const leafUrl = `https://leaf.example/issue/fix-it-${ISSUE_D}`
    const was = files.known[uriOf(ISSUE)]
    files.known[uriOf(ISSUE)] = { ...object(ISSUE, 'Fix it'), openUrl: `https://ship.example/o/${ISSUE}` } as ForeignObject
    try {
      await open([...EVENTS, comment([['embed', ISSUE, 'detailed']], `see\n${leafUrl}`)])
      const card = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-conversation-item] [data-card="detailed"]')
        expect(found?.textContent).toContain('Fix it')
        return found!
      })
      expect(opensAt(card)).toBe(leafUrl)
    } finally {
      files.known[uriOf(ISSUE)] = was
    }
  })

  it('a sent block comment whose issue chip is written as another file’s Leaf URL: the card opens where the issue opens, not that URL (LTX-6)', async () => {
    const otherUrl = `https://leaf.example/issue/other-issue-${OTHER_ISSUE_D}`
    // Only a block document can hold this run: words that are a URL, marked as a reference to a different file.
    // The plain link after it is asked about, so Leaf knows which hosts the apps declare, as on a real page.
    // An issue no earlier test has drawn, so the card reads where it opens and not a copy read before.
    const FRESH_D = '66666666-6666-4666-8666-666666666666'
    const FRESH = `30851:${SHIP}:${FRESH_D}`
    const doc = descriptionTextToBlockDocument('see')
    doc.content[0] = {
      ...doc.content[0],
      content: [{ type: 'text', text: 'see ' }, { type: 'text', text: otherUrl, marks: [{ type: 'reference', attrs: { uri: uriOf(FRESH) } }] }, { type: 'text', text: ` and ${OTHER_ISSUE_URL}` }],
    }
    const issueOpens = `https://ship.example/o/${FRESH}`
    files.known[uriOf(FRESH)] = { ...object(FRESH, 'Fresh issue'), openUrl: issueOpens } as ForeignObject
    try {
      await open([...EVENTS, file(30851, SHIP, FRESH_D), comment([['embed', FRESH, 'detailed'], ['content-format', 'estiva-blocks-1']], serializeBlockDocument(doc))])
      const card = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-conversation-item] [data-card="detailed"]')
        expect(found?.textContent).toContain('Fresh issue')
        return found!
      })
      expect(opensAt(card)).toBe(issueOpens)
      // Its chip in the sentence is no link to the URL it was written as either.
      const links = [...card.closest('[data-conversation-item]')!.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
      expect(links).not.toContain(otherUrl)
    } finally {
      delete files.known[uriOf(FRESH)]
    }
  })

  describe('an app URL in a sent comment, as Peek and Ship draw it (LTX-6)', () => {
    const leafUrl = `https://leaf.example/issue/fix-it-${ISSUE_D}`
    const sentComment = () => found(() => entries()[0])

    it('draws an issue’s URL in a sentence, on Leaf’s host or Ship’s, as the issue’s chip, which opens the URL as written', async () => {
      await open([...EVENTS, comment([], `see ${leafUrl} and ${ISSUE_URL} now`)])
      const sent = await sentComment()
      await waitFor(() => expect(within(sent).getAllByText('Fix it')).toHaveLength(2))
      expect(sent.textContent).not.toContain('https://')
      expect(within(sent).getAllByText('Fix it').map((chip) => chip.closest('a')?.getAttribute('href'))).toEqual([leafUrl, ISSUE_URL])
      expect(sent.querySelector('[data-card]')).toBeNull()
    })

    it('keeps the same path on a host no app declares as the URL it was written as', async () => {
      const lookalike = `https://lookalike.example/issue/fix-it-${ISSUE_D}`
      await open([...EVENTS, comment([], `see ${lookalike} and ${leafUrl} now`)])
      const sent = await sentComment()
      await waitFor(() => expect(within(sent).getByText('Fix it')).toBeTruthy())
      expect(sent.textContent).toContain(lookalike)
      expect(within(sent).getAllByText('Fix it')).toHaveLength(1)
    })

    it('draws an issue’s URL alone on its line, with no card carried, as the issue’s row, which opens the URL as written', async () => {
      await open([...EVENTS, comment([], `see\n${leafUrl}`)])
      const sent = await sentComment()
      const row = await waitFor(() => {
        const found = sent.querySelector<HTMLElement>('[data-link-row]')
        expect(found?.textContent).toContain('Fix it')
        return found!
      })
      expect(sent.textContent).not.toContain('https://')
      expect(opensAt(row)).toBe(leafUrl)
    })
  })

  describe('editing your comment to link an issue (PEEKM-7)', () => {
    const editSaying = async (own: SignedEvent, words: string) => {
      await open([...EVENTS, own])
      await waitFor(() => expect(entry(own.id)).not.toBeNull())
      choose(own.id, 'Edit message')
      act(() => void box('Edit message').editor.chain().focus().selectAll().insertContent(words).run())
    }
    const saved = async () => {
      act(() => void fireEvent.click(screen.getByRole('button', { name: 'Save' })))
      await waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
      return publish.mock.calls[0][0]
    }

    it('shows the issue’s card under the edit box, as Peek does, and the edit carries it and the issue’s a, but no part', async () => {
      const own = { ...comment([], 'Too long?'), pubkey: ME }
      await editSaying(own, `see ${ISSUE_URL} `)
      await waitFor(() => expect(under()?.textContent).toContain('Fix it'))
      const e = await saved()
      expect([e.kind, e.content]).toEqual([40003, `see ${ISSUE_URL}`])
      expect(named(e.tags, 'embed')).toEqual([['embed', ISSUE, 'detailed']])
      expect(named(e.tags, 'a')).toEqual([['a', ISSUE]])
      expect(named(e.tags, 'part')).toEqual([])
    })

    it('✕ under the edit box saves the link with no card, and the issue still gets its a', async () => {
      const own = { ...comment([], 'Too long?'), pubkey: ME }
      await editSaying(own, `see ${ISSUE_URL} `)
      await waitFor(() => expect(under()).not.toBeNull())
      act(() => void fireEvent.click(within(under()!).getByRole('button', { name: 'Remove' })))
      const e = await saved()
      expect(named(e.tags, 'embed')).toEqual([])
      expect(named(e.tags, 'a')).toEqual([['a', ISSUE]])
    })

    it('shows the card the comment already has under the edit box, with its ✕, and a save that keeps it leaves its cards as they are', async () => {
      const own = { ...comment([['embed', ISSUE, 'detailed']], `see ${ISSUE_URL}`), pubkey: ME }
      await editSaying(own, `see ${ISSUE_URL} again `)
      await waitFor(() => expect(under()?.textContent).toContain('Fix it'))
      expect(within(under()!).getByRole('button', { name: 'Remove' })).toBeTruthy()
      const e = await saved()
      expect(e.content).toBe(`see ${ISSUE_URL} again`)
      expect(named(e.tags, 'embed')).toEqual([])
    })

    it('✕ on the card the comment has, under the edit box, saves the comment with that card taken off', async () => {
      const own = { ...comment([['embed', ISSUE, 'detailed']], `see ${ISSUE_URL}`), pubkey: ME }
      await editSaying(own, `see ${ISSUE_URL} again `)
      await waitFor(() => expect(under()?.textContent).toContain('Fix it'))
      act(() => void fireEvent.click(within(under()!).getByRole('button', { name: 'Remove' })))
      expect(under()).toBeNull()
      const e = await saved()
      expect(named(e.tags, 'embed')).toEqual([['embed', ISSUE, 'none']])
    })

    it('never shows again a card taken off before: the edit box has none, and the save leaves it off', async () => {
      const own = { ...comment([['embed', ISSUE, 'none']], `see ${ISSUE_URL}`), pubkey: ME }
      await editSaying(own, `see ${ISSUE_URL} again `)
      await waitFor(() => expect(asked(ISSUE_D)).toBe(true))
      await act(async () => {})
      expect(under()).toBeNull()
      const e = await saved()
      expect(named(e.tags, 'embed')).toEqual([])
    })
  })

  it('draws no part of this page under a sent comment, nor a part whose link the body no longer names', async () => {
    await open([
      ...EVENTS,
      comment([['part', ADDRESS, PARAGRAPH]], `see ${OWN_BLOCK_URL}`),
      comment([['part', TWO_ADDRESS, TWO_BLOCK]], 'the link was edited out'),
      // The one that draws, so the two that do not are told apart from parts never drawn.
      comment([['part', TWO_ADDRESS, TWO_BLOCK]], `still ${PART_URL}`),
    ])
    await waitFor(() => expect(entries()).toHaveLength(3))
    await waitFor(() => expect(document.querySelectorAll('[data-part-address]')).toHaveLength(1))
    const drawn = document.querySelector('[data-part-address]')!.closest('[data-conversation-item]')!
    expect(drawn.textContent).toContain('still')
  })
})

describe("an archived page's comments only show (PEEKM-8)", () => {
  const CARD_ADDRESS = `30851:${QA2}:archived-card`
  const CARD = `nostr:${encodeNaddr({ kind: 30851, pubkey: QA2, identifier: 'archived-card', relays: [] })}`
  beforeAll(() => {
    files.known[CARD] = { ref: 'r', kind: 30851, eventId: 'e', widget: 'card', noun: 'issue', meta: [], actions: [], viaRecommendation: false, address: CARD_ADDRESS, slots: { title: { value: 'Card on an archived page' } } }
  })
  const line = entry
  const reaction = (target: string): SignedEvent => ({ id: '7'.repeat(64), pubkey: QA2, created_at: 1_760_000_100, kind: 7, tags: [['e', target]], content: '👍', sig: '' })

  async function openArchived(events: SignedEvent[]) {
    relay.events = events
    const file = { ...fileWith(BODY), archived: { by: QA2, at: 1_760_000_050 } } as ForeignObject
    render(
      <ToastProvider>
        <FilePage file={file} loading={false} />
      </ToastProvider>,
    )
    await waitFor(() => expect(page().editor.isInitialized).toBe(true))
  }

  it('says why in the box’s place, and offers no reply, reaction, Resolve, Edit, Delete or card ✕, your own comment included', async () => {
    const own = { ...comment([['embed', CARD_ADDRESS, 'detailed']], `See\n${CARD}`), pubkey: ME }
    const theirs = comment([['block', PARAGRAPH]], 'Too long?')
    await openArchived([own, theirs, reaction(own.id)])
    await waitFor(() => expect(line(own.id)?.querySelector('[data-card="detailed"]')?.textContent).toContain('Card on an archived page'))
    expect(screen.getByText('Archived. Unarchive it to comment.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Comment on this document…' })).toBeNull()
    // Changed on purpose (ONE-5, step 4): a card with nothing to open — no replies, and no box on an archived page —
    // opens nothing when pressed (the kit's layout, Peek's way); its words in the text still open it, with no reply box.
    act(() => void fireEvent.click(line(own.id)!))
    expect(item(own.id)!.hasAttribute('data-open')).toBe(false)
    act(() => void page().editor.emit('commentSelect', { id: theirs.id }))
    await waitFor(() => expect(item(theirs.id)!.getAttribute('data-open')).toBe('true'))
    expect(screen.queryByRole('textbox', { name: 'Reply…' })).toBeNull()
    // Pointed at, a card shows no strip: no React, Reply, Resolve, Reopen or its own More (Edit, Delete); the page's
    // More in the header is the page's (LED-4).
    for (const id of [theirs.id, own.id]) pointAt(line(id)!)
    for (const name of ['Resolve', 'Reopen', 'React', 'Reply', 'Add a reaction', 'Remove']) expect(screen.queryByRole('button', { name })).toBeNull()
    for (const thread of items()) expect(within(thread).queryByRole('button', { name: 'More' })).toBeNull()
    const pill = await screen.findByRole('button', { name: 'Makes sense, 1' })
    act(() => void fireEvent.click(pill))
    await act(async () => {})
    expect(publish).not.toHaveBeenCalled()
  })

  // Nothing can be written: no hint how to (Katerina, 4 November), the kit's empty line as Peek's says nobody has.
  it('with no comments, says there are none, and no hint to select words or write below', async () => {
    await openArchived([])
    expect(await screen.findByText('No comments yet.')).toBeTruthy()
    expect(screen.queryByText(/Select words and press Comment/)).toBeNull()
  })

  it('draws a comment card’s status as words, not its picker, though the card’s own file is not archived', async () => {
    const address = `30851:${QA2}:open-issue`
    const uri = `nostr:${encodeNaddr({ kind: 30851, pubkey: QA2, identifier: 'open-issue', relays: [] })}`
    files.known[uri] = {
      ...(files.known[CARD] as object),
      address,
      slots: { title: { value: 'An open issue' }, status: { value: 'Todo', colour: 'neutral', field: 'status' } },
      actions: [{ id: 'set-status', label: 'Status', control: 'select', field: 'status', current: 'todo', options: [{ value: 'todo', label: 'Todo' }, { value: 'done', label: 'Done' }] }],
    }
    const own = { ...comment([['embed', address, 'detailed']], `See\n${uri}`), pubkey: ME }
    await openArchived([own])
    await waitFor(() => expect(line(own.id)?.querySelector('[data-card="detailed"]')?.textContent).toContain('Todo'))
    expect(within(line(own.id)!).queryByRole('combobox', { name: 'Status' })).toBeNull()
  })

  it('offers no Comment on selected words of its text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await openArchived([])
      const editor = page().editor
      // jsdom has no layout: the strip needs the view focused and somewhere to stand, as in LEAF-7's tests.
      vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true)
      vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 10, bottom: 20, left: 10, right: 20 })
      let from = 0
      editor.state.doc.descendants((node, pos) => {
        const at = !from && node.isText ? (node.text ?? '').indexOf('wrote this') : -1
        if (at !== -1) from = pos + at
        return !from
      })
      act(() => void editor.commands.setTextSelection({ from, to: from + 'wrote this'.length }))
      await act(async () => void (await vi.advanceTimersByTimeAsync(400)))
      expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

/* What the kit's cards do that Leaf's own did not (ONE-5, step 3). */
describe("a thread on the kit's cards", () => {
  const replyTo = (root: SignedEvent, content: string, by = QA2): SignedEvent => ({
    ...comment([], content),
    pubkey: by,
    tags: [['A', ADDRESS], ['K', '30842'], ['P', AUTHOR], ['e', root.id], ['k', '1111'], ['p', root.pubkey], ['h', FOLDER]],
  })
  /** Two frames: the box takes the caret, when it does, a frame after it is drawn. */
  const frames = () => act(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
  const hasCaret = (el: HTMLElement) => el === document.activeElement || el.contains(document.activeElement)

  it("folds a thread's replies behind its replies row until it is opened, one thread open at a time", async () => {
    const first = comment([], 'First?')
    const second = comment([], 'Second?')
    await open([first, second, replyTo(first, 'Cut it'), replyTo(second, 'Keep it')])
    await waitFor(() => expect(within(item(first.id)!).getByRole('button', { name: '1 reply, open the thread' })).toBeTruthy())
    expect(screen.queryByText('Cut it')).toBeNull()
    openReplies(first.id)
    expect(within(item(first.id)!).getByText('Cut it')).toBeTruthy()
    expect(item(first.id)!.getAttribute('data-open')).toBe('true')
    openReplies(second.id)
    expect(within(item(second.id)!).getByText('Keep it')).toBeTruthy()
    expect(screen.queryByText('Cut it')).toBeNull()
    // A second press closes it.
    act(() => void fireEvent.click(within(item(second.id)!).getByRole('button', { name: '1 reply, close the thread' })))
    expect(screen.queryByText('Keep it')).toBeNull()
    expect(items().some((t) => t.hasAttribute('data-open'))).toBe(false)
  })

  it("Reply on a comment's strip opens its thread with the caret in the reply box", async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(item(onParagraph.id)).not.toBeNull())
    pointAt(entry(onParagraph.id)!)
    act(() => void fireEvent.click(within(entry(onParagraph.id)!).getByRole('button', { name: 'Reply' })))
    await waitFor(() => expect(box('Reply…')).toBeTruthy())
    await frames()
    expect(hasCaret(box('Reply…'))).toBe(true)
  })

  /*
    The cursor check (K3). A click in commented words is often to edit them: CommentHighlights says which thread, and it
    opens, but the caret stays in the text. The kit's layout gives the box the caret on every open (`caretOnOpen`);
    the column passes it on only for an open the layout asked for, or for Reply (QuietCaret, ONE-5 step 4).
  */
  it('opening a thread from its words in the text leaves the caret in the text, to go on editing them', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(item(onParagraph.id)).not.toBeNull())
    const editor = page().editor
    let inWords = 0
    editor.state.doc.descendants((node, pos) => {
      if (!inWords && node.isText && node.text?.includes('wrote')) inWords = pos + node.text.indexOf('wrote') + 2
      return !inWords
    })
    // The click: the caret lands in the words, and the highlight under it chooses its thread.
    act(() => void editor.commands.focus(inWords))
    act(() => void editor.emit('commentSelect', { id: onParagraph.id }))
    await waitFor(() => expect(box('Reply…')).toBeTruthy())
    await frames()
    expect(hasCaret(page())).toBe(true)
    expect(hasCaret(box('Reply…'))).toBe(false)
    expect(editor.state.selection.from).toBe(inWords)
  })

  /* The kit's one column (ONE-5, step 4): its layout opens a thread from a press, and gives the thread's box the caret. */
  it('a press on a comment opens its thread with the caret in its reply box', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(item(onParagraph.id)).not.toBeNull())
    act(() => void fireEvent.click(entry(onParagraph.id)!))
    await waitFor(() => expect(box('Reply…')).toBeTruthy())
    await frames()
    expect(item(onParagraph.id)!.getAttribute('data-open')).toBe('true')
    expect(hasCaret(box('Reply…'))).toBe(true)
  })

  it('Reply on a thread opened from its words in the text still puts the caret in its box', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(item(onParagraph.id)).not.toBeNull())
    act(() => void page().editor.emit('commentSelect', { id: onParagraph.id }))
    await waitFor(() => expect(box('Reply…')).toBeTruthy())
    await frames()
    expect(hasCaret(box('Reply…'))).toBe(false)
    pointAt(entry(onParagraph.id)!)
    act(() => void fireEvent.click(within(entry(onParagraph.id)!).getByRole('button', { name: 'Reply' })))
    await frames()
    expect(hasCaret(box('Reply…'))).toBe(true)
  })

  it('says who resolved a thread and their note, on its card under Resolved', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    const resolution: SignedEvent = { id: 'e'.repeat(64), pubkey: QA2, created_at: 1_760_000_200, kind: 9101, tags: [['h', FOLDER], ['e', onParagraph.id], ['t', 'resolution'], ['action', 'resolved']], content: 'Cut to one line.', sig: '' }
    await open([roster, profile(QA2, 'QA-2'), onParagraph, resolution])
    await waitFor(() => expect(under('Resolved', onParagraph.id)).toBe(true))
    const card = entry(onParagraph.id)!
    await waitFor(() => expect(within(card).getByText('Cut to one line.')).toBeTruthy())
    expect(within(card).getByText('QA-2')).toBeTruthy()
    // The kit's check by the time.
    expect(within(card).getByText('Resolved')).toBeTruthy()
  })

  /** Point at a comment, press Resolve on its strip, and write `note` in the kit's dialog. */
  const resolveWith = async (id: string, note: string) => {
    pointAt(entry(id)!)
    act(() => void fireEvent.click(within(entry(id)!).getByRole('button', { name: 'Resolve' })))
    const dialog = await screen.findByRole('dialog')
    act(() => void fireEvent.change(within(dialog).getByRole('textbox', { name: 'Resolution message (optional)' }), { target: { value: note } }))
    act(() => void fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' })))
    return dialog
  }

  it("resolves with the note written in the kit's dialog, which closes once the relay accepts it", async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(item(onParagraph.id)).not.toBeNull())
    await resolveWith(onParagraph.id, 'Cut to one line.')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect([publish.mock.calls[0][0].kind, publish.mock.calls[0][0].content]).toEqual([9101, 'Cut to one line.'])
  })

  it('keeps the Resolve dialog open, the note in it, and says why when the relay refuses the resolve', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(item(onParagraph.id)).not.toBeNull())
    publish.mockResolvedValueOnce({ ok: false, reason: 'restricted: not a channel member' })
    const dialog = await resolveWith(onParagraph.id, 'Cut to one line.')
    expect(await within(dialog).findByText('Not resolved: you can no longer write here.')).toBeTruthy()
    expect(dialog.isConnected).toBe(true)
    expect((within(dialog).getByRole('textbox', { name: 'Resolution message (optional)' }) as HTMLTextAreaElement).value).toBe('Cut to one line.')
    expect(publish).toHaveBeenCalledTimes(1)
  })

  /* Guards, not red first (code review, 4 November): kept behaviour with no test of its own in Leaf until now. */

  it('resolves on a second press after the relay refused the first, from the same dialog, with the same note', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    await waitFor(() => expect(item(onParagraph.id)).not.toBeNull())
    publish.mockResolvedValueOnce({ ok: false, reason: 'rate-limited: slow down' })
    const dialog = await resolveWith(onParagraph.id, 'Cut to one line.')
    expect(await within(dialog).findByText('Not resolved: too many at once, try again in a moment.')).toBeTruthy()
    // The relay keeps what it accepts, so the column's read after the write finds it.
    publish.mockImplementationOnce(async (e) => {
      relay.events = [...relay.events, { ...e, id: 'f'.repeat(64), sig: '' } as SignedEvent]
      return { ok: true }
    })
    act(() => void fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(under('Resolved', onParagraph.id)).toBe(true))
    expect(publish).toHaveBeenCalledTimes(2)
    expect([publish.mock.calls[1][0].kind, publish.mock.calls[1][0].content]).toEqual([9101, 'Cut to one line.'])
  })

  /** A thread resolved by QA-2, as the relay holds it. */
  const resolvedBy = (root: SignedEvent): SignedEvent => ({ id: 'e'.repeat(64), pubkey: QA2, created_at: 1_760_000_200, kind: 9101, tags: [['h', FOLDER], ['e', root.id], ['t', 'resolution'], ['action', 'resolved']], content: '', sig: '' })
  /** Open the column's "Resolved" group, closed at first, and press Reopen on a comment's strip there. */
  const reopenFrom = (id: string) => {
    const group = [...document.querySelectorAll<HTMLElement>('button[aria-expanded="false"]')].find((b) => b.textContent?.startsWith('Resolved'))
    if (group) act(() => void fireEvent.click(group))
    pointAt(entry(id)!)
    act(() => void fireEvent.click(within(entry(id)!).getByRole('button', { name: 'Reopen' })))
  }

  it('Reopen on a resolved comment writes a 9101 reopening it, and the thread leaves Resolved', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph, resolvedBy(onParagraph)])
    await waitFor(() => expect(under('Resolved', onParagraph.id)).toBe(true))
    publish.mockImplementationOnce(async (e) => {
      relay.events = [...relay.events, { ...e, id: 'f'.repeat(64), sig: '' } as SignedEvent]
      return { ok: true }
    })
    reopenFrom(onParagraph.id)
    await waitFor(() => expect(under('Resolved', onParagraph.id)).toBe(false))
    expect(publish.mock.calls[0][0].kind).toBe(9101)
    expect(publish.mock.calls[0][0].tags).toEqual(expect.arrayContaining([['e', onParagraph.id], ['action', 'reopened']]))
  })

  it('says so when the relay refuses a Reopen, and the thread stays under Resolved', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph, resolvedBy(onParagraph)])
    await waitFor(() => expect(under('Resolved', onParagraph.id)).toBe(true))
    publish.mockResolvedValueOnce({ ok: false, reason: 'error: storage unavailable' })
    reopenFrom(onParagraph.id)
    // The toast, and the line read out with it.
    expect((await screen.findAllByText('Not reopened: something went wrong, try again.')).length).toBeGreaterThan(0)
    expect(under('Resolved', onParagraph.id)).toBe(true)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('a comment is a Tab stop, and Enter on it opens its thread', async () => {
    const onParagraph = comment([['block', PARAGRAPH]], 'Too long?')
    await open([onParagraph])
    const card = await found(() => item(onParagraph.id)?.querySelector<HTMLElement>('[tabindex="0"]'))
    expect(within(card).getByText('Too long?')).toBeTruthy()
    act(() => card.focus())
    expect(document.activeElement).toBe(card)
    act(() => void fireEvent.keyDown(card, { key: 'Enter' }))
    await waitFor(() => expect(item(onParagraph.id)!.getAttribute('data-open')).toBe('true'))
  })

  it('says when a comment was edited, under the pointer on its "(edited)"', async () => {
    const theirs = comment([], 'Too long?')
    const edit: SignedEvent = { id: '6'.repeat(64), pubkey: AUTHOR, created_at: Math.floor(Date.now() / 1000) - 120, kind: 40003, tags: [['h', FOLDER], ['e', theirs.id]], content: 'Far too long?', sig: '' }
    await open([theirs, edit])
    const marker = await within(await found(() => entry(theirs.id))).findByText('(edited)')
    fireEvent.pointerEnter(marker)
    fireEvent.focus(marker)
    expect(await screen.findByText('Edited 2 minutes ago')).toBeTruthy()
  })
})
