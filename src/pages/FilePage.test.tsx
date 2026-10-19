import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { blockIds, descriptionTextToBlockDocument, serializeBlockDocument, type PublishResult, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const ME = 'a'.repeat(64)
const FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const published: UnsignedEvent[] = []
let answers: PublishResult[] = []
let changes: SignedEvent[] = []

vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => ME,
  // The page's changes, only to a read that asks for them by its address.
  query: async (filters: { kinds?: number[]; '#a'?: string[] }[]) =>
    filters[0]?.kinds?.[0] === 1851 && filters[0]['#a']?.includes(`30842:${'a'.repeat(64)}:page-1`) ? changes : [],
  publish: async (event: UnsignedEvent) => {
    published.push(event)
    return answers.shift() ?? { ok: true }
  },
}))

const { FilePage } = await import('./FilePage')
const ADDRESS = `30842:${ME}:page-1`
const tag = (event: UnsignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

function doc(summary?: string): ForeignObject {
  return {
    kind: 30842,
    address: ADDRESS,
    folder: FOLDER,
    naddr: 'naddr1page',
    slots: { title: { value: 'Friday notes' }, ...(summary ? { subtitle: { value: summary } } : {}) },
  } as unknown as ForeignObject
}

type EditorBox = HTMLElement & { editor: Editor }
async function summaryBox(): Promise<EditorBox> {
  const box = (await screen.findByRole('textbox', { name: 'Summary' })) as EditorBox
  await waitFor(() => expect(box.editor?.isInitialized).toBe(true))
  return box
}
/* jsdom cannot type into a contenteditable, nor fires focus when the editor focuses itself: done here as a browser would. */
function write(box: EditorBox, text: string) {
  act(() => {
    box.editor.commands.focus('end')
    fireEvent.focus(box)
  })
  act(() => void box.editor.chain().selectAll().insertContent(text).run())
}
function leave(box: EditorBox) {
  act(() => {
    box.editor.commands.blur()
    fireEvent.blur(box)
  })
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
  published.length = 0
  answers = []
  changes = []
})

describe("a page's summary, under its title", () => {
  it('saves what you write when you leave it: one plain-text change on `summary`, in the page’s Folder', async () => {
    render(<ToastProvider><FilePage file={doc()} loading={false} /></ToastProvider>)
    const box = await summaryBox()
    write(box, 'What we decided on Friday.')
    leave(box)
    await waitFor(() => expect(published).toHaveLength(1))
    const [change] = published
    expect(change.kind).toBe(1851)
    expect(tag(change, 'a')).toBe(ADDRESS)
    expect(tag(change, 'field')).toBe('summary')
    expect(tag(change, 'value')).toBe('What we decided on Friday.')
    expect(tag(change, 'h')).toBe(FOLDER)
    expect(tag(change, 'content-format')).toBeUndefined()
  })

  it('shows the summary the page has, and "Add a summary" on a page with none', async () => {
    const { unmount } = render(<ToastProvider><FilePage file={doc('Notes from the Friday call.')} loading={false} /></ToastProvider>)
    expect((await summaryBox()).textContent).toBe('Notes from the Friday call.')
    unmount()
    render(<ToastProvider><FilePage file={doc()} loading={false} /></ToastProvider>)
    const empty = await summaryBox()
    expect(empty.textContent).toBe('')
    expect(empty.getAttribute('aria-placeholder')).toBe('Add a summary')
  })

  it('clears the summary when you empty it: the change carries an empty value', async () => {
    render(<ToastProvider><FilePage file={doc('Notes from the Friday call.')} loading={false} /></ToastProvider>)
    const box = await summaryBox()
    act(() => {
      box.editor.commands.focus('end')
      fireEvent.focus(box)
    })
    act(() => void box.editor.chain().selectAll().deleteSelection().run())
    leave(box)
    await waitFor(() => expect(published).toHaveLength(1))
    expect(published[0].tags.find((t) => t[0] === 'value')).toEqual(['value', ''])
  })

  it('saves an edit to a summary longer than the card’s cut as the whole text, and writes nothing when left unchanged', async () => {
    const long = `${'A sentence about the Friday call. '.repeat(10)}End.`
    const change = (value: string, ts: number, h = FOLDER, forged = false): SignedEvent =>
      ({ id: `c${ts}`, pubkey: ME, kind: 1851, created_at: Math.floor(ts / 1000), tags: [['a', ADDRESS], ['field', 'summary'], ['value', value], ['h', h], ['ts', String(forged ? ts * 1000 : ts)]], content: '', sig: '' }) as SignedEvent
    // An older one, another Folder's, and one whose `ts` claims the far future: none of them is the summary.
    changes = [change('Older.', 1_000_000), change(long, 2_000_000), change('Another Folder.', 3_000_000, 'elsewhere'), change('Forged.', 1_500_000, FOLDER, true)]
    render(<ToastProvider><FilePage file={doc(`${long.slice(0, 280).trimEnd()}…`)} loading={false} /></ToastProvider>)
    // The editor is drawn again once the whole text is in: look it up each time.
    await waitFor(async () => expect((await summaryBox()).editor.getText()).toBe(long))
    const box = await summaryBox()
    act(() => {
      box.editor.commands.focus('end')
      fireEvent.focus(box)
    })
    leave(box)
    write(box, `${long} More.`)
    leave(box)
    await waitFor(() => expect(published).toHaveLength(1))
    expect(tag(published[0], 'value')).toBe(`${long} More.`)
  })

  it('keeps your text and says it was not saved when the relay refuses it', async () => {
    answers = [{ ok: false, reason: 'blocked: not a member' }]
    render(<ToastProvider><FilePage file={doc()} loading={false} /></ToastProvider>)
    const box = await summaryBox()
    write(box, 'What we decided on Friday.')
    leave(box)
    expect(await screen.findByText(/Summary not saved\./)).toBeTruthy()
    expect(box.editor.getText()).toBe('What we decided on Friday.')
  })
})

describe('a page opened at one of its blocks', () => {
  const body = descriptionTextToBlockDocument('# Plan\n\nThe paragraph a link names.')
  const withBody = () =>
    ({ ...doc(), slots: { ...doc().slots, [BODY_SLOT]: { value: serializeBlockDocument(body), format: 'blocks' } } }) as unknown as ForeignObject
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('scrolls the block the link names to the middle of the page, and says nothing', async () => {
    const block = blockIds(body)[1]
    const scrolled: string[] = []
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this.getAttribute('data-block-id') ?? '')
    })
    window.history.replaceState(null, '', `/document/plan-page-1#block-${block}`)
    render(<ToastProvider><FilePage file={withBody()} loading={false} /></ToastProvider>)
    await waitFor(() => expect(scrolled).toContain(block))
    expect(screen.queryByText(/That part of the page/)).toBeNull()
    spy.mockRestore()
  })

  it('says the part was removed when the block is gone, and opens the page', async () => {
    window.history.replaceState(null, '', '/document/plan-page-1#block-0123456789ab')
    render(<ToastProvider><FilePage file={withBody()} loading={false} /></ToastProvider>)
    expect(await screen.findByText('That part of the page was removed.')).toBeTruthy()
    expect(await screen.findByText('The paragraph a link names.')).toBeTruthy()
  })
})
