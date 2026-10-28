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
/* The apps' manifests (kind 31990) the relay holds, answered to a claim on a kind (`#k`). */
let manifests: SignedEvent[] = []

vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => ME,
  // The page's changes, only to a read that asks for them by its address.
  query: async (filters: { kinds?: number[]; '#a'?: string[]; '#k'?: string[]; authors?: string[] }[]) =>
    // An app's manifest the relay never answers for: its author is HANGS.
    filters[0]?.authors?.includes('e'.repeat(64))
      ? new Promise<never>(() => {})
      : filters[0]?.kinds?.[0] === 31990
      ? manifests.filter((m) => m.tags.some((t) => t[0] === 'k' && filters[0]['#k']?.includes(t[1])))
      : filters[0]?.kinds?.[0] === 1851 && filters[0]['#a']?.includes(`30842:${'a'.repeat(64)}:page-1`)
        ? changes
        : [],
  publish: async (event: UnsignedEvent) => {
    published.push(event)
    return answers.shift() ?? { ok: true }
  },
}))

const { FilePage } = await import('./FilePage')
const { shipIssue, shipProject } = await import('./fixtures/shipFiles')
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
async function titleBox(): Promise<EditorBox> {
  const box = (await screen.findByRole('textbox', { name: 'Title' })) as EditorBox
  await waitFor(() => expect(box.editor?.isInitialized).toBe(true))
  return box
}

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
  manifests = []
})

describe('a Ship issue opened in Leaf (LEAF-13)', () => {
  async function documentBox(): Promise<EditorBox> {
    const box = (await screen.findByRole('textbox', { name: 'Document' })) as EditorBox
    await waitFor(() => expect(box.editor?.isInitialized).toBe(true))
    return box
  }

  it("opens as a page: its text in Leaf's editor, under Ship's row with Open in Ship", async () => {
    render(<ToastProvider><FilePage file={shipIssue()} loading={false} /></ToastProvider>)
    const box = await documentBox()
    expect(box.editor.isEditable).toBe(true)
    expect(box.textContent).toContain('What changes')
    expect(screen.getByRole('button', { name: 'Open in Ship' })).toBeTruthy()
    expect(screen.queryByText(/Archived/)).toBeNull()
  })

  it("draws the owner on Ship's row by their profile picture, as Ship does (LFB-1)", async () => {
    const issue = shipIssue()
    const PICTURE = 'https://id.estiva.app/avatar/owner.jpg'
    const people = Object.fromEntries(Object.entries(issue.people ?? {}).map(([pk, p]) => [pk, { ...p, picture: PICTURE }]))
    render(<ToastProvider><FilePage file={{ ...issue, people }} loading={false} /></ToastProvider>)
    await documentBox()
    const row = screen.getByRole('button', { name: 'Open in Ship' }).parentElement!
    expect([...row.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toContain(PICTURE)
  })

  it('saves its text when you leave it: one block-document change on `description`, at the issue, in its own Folder', async () => {
    const issue = shipIssue()
    render(<ToastProvider><FilePage file={issue} loading={false} /></ToastProvider>)
    const box = await documentBox()
    write(box, 'Rewritten in Leaf.')
    leave(box)
    await waitFor(() => expect(published).toHaveLength(1))
    const [change] = published
    expect(change.kind).toBe(1851)
    expect(tag(change, 'a')).toBe(issue.address)
    expect(tag(change, 'field')).toBe('description')
    expect(tag(change, 'content-format')).toBe('estiva-blocks-1')
    expect(tag(change, 'h')).toBe(issue.folder)
    expect(tag(change, 'value')).toContain('Rewritten in Leaf.')
  })

  it('saves its title and its summary as changes at the issue, in its own Folder', async () => {
    const issue = shipIssue()
    render(<ToastProvider><FilePage file={issue} loading={false} /></ToastProvider>)
    const title = await titleBox()
    write(title, ' in Leaf')
    leave(title)
    await waitFor(() => expect(published).toHaveLength(1))
    const summary = await summaryBox()
    write(summary, ' Written in Leaf.')
    leave(summary)
    await waitFor(() => expect(published).toHaveLength(2))
    expect(published.map((change) => [change.kind, tag(change, 'a'), tag(change, 'h'), tag(change, 'field')])).toEqual([
      [1851, issue.address, issue.folder, 'title'],
      [1851, issue.address, issue.folder, 'summary'],
    ])
    expect(tag(published[0], 'value')).toContain('in Leaf')
    expect(tag(published[1], 'value')).toContain('Written in Leaf.')
  })

  it('is read-only when archived: its title, summary and text take nothing, and it says where to unarchive it', async () => {
    render(<ToastProvider><FilePage file={shipIssue({ archived: true })} loading={false} /></ToastProvider>)
    const box = await documentBox()
    expect(box.editor.isEditable).toBe(false)
    expect((await titleBox()).editor.isEditable).toBe(false)
    expect((await summaryBox()).editor.isEditable).toBe(false)
    expect(screen.getByText('Archived. Unarchive it in Ship to edit.')).toBeTruthy()
    write(box, 'Typed into an archived issue.')
    leave(box)
    await act(async () => {})
    expect(published).toHaveLength(0)
  })
})

describe('an archived file is read-only, its comments included (PEEKM-8)', () => {
  const archived = (file: ForeignObject, withAddress?: string): ForeignObject => ({ ...file, archived: { by: ME, at: 1_760_000_000, ...(withAddress ? { with: withAddress } : {}) } })
  const manifestEvent = (event: UnsignedEvent): SignedEvent => ({ ...event, id: event.pubkey.slice(0, 63) + '1', sig: '' }) as SignedEvent

  async function locked() {
    for (const name of ['Title', 'Summary', 'Document']) {
      const box = (await screen.findByRole('textbox', { name })) as EditorBox
      await waitFor(() => expect(box.editor?.isInitialized).toBe(true))
      expect(box.editor.isEditable).toBe(false)
    }
    expect(screen.queryByRole('textbox', { name: 'Comment on this document…' })).toBeNull()
  }

  it('a Leaf page archived itself: unarchived in Peek, said over its text and in the comment box’s place', async () => {
    render(<ToastProvider><FilePage file={archived(doc())} loading={false} /></ToastProvider>)
    expect(await screen.findByText('Archived. Unarchive it in Peek to edit.')).toBeTruthy()
    expect(screen.getByText('Archived. Unarchive it in Peek to comment.')).toBeTruthy()
    await locked()
  })

  it('a page under an archived page: names the document, unarchived in Peek', async () => {
    const { buildManifest } = await import('../manifest')
    manifests = [manifestEvent(buildManifest('b'.repeat(64), 1_700_000_000_000))]
    render(<ToastProvider><FilePage file={archived(doc(), `30842:${ME}:parent-page`)} loading={false} /></ToastProvider>)
    expect(await screen.findByText('Unarchive the document in Peek to edit.')).toBeTruthy()
    expect(screen.getByText('Unarchive the document to comment.')).toBeTruthy()
    await locked()
  })

  it('a Ship issue archived itself: the comment line is the one every app shows', async () => {
    render(<ToastProvider><FilePage file={shipIssue({ archived: true })} loading={false} /></ToastProvider>)
    expect(await screen.findByText('Archived. Unarchive it to comment.')).toBeTruthy()
    expect(screen.getByText('Archived. Unarchive it in Ship to edit.')).toBeTruthy()
    await locked()
  })

  it('a Ship issue archived with its project: names the project, and Estiva Ship from its manifest', async () => {
    const shipManifest = (await import('./fixtures/ship-manifest.json')).default
    manifests = [manifestEvent({ kind: 31990, pubkey: 'c'.repeat(64), created_at: 1_700_000_000, tags: [['d', 'estiva-ship'], ['k', '30850'], ['k', '30851']], content: JSON.stringify(shipManifest) })]
    render(<ToastProvider><FilePage file={archived(shipIssue(), shipProject().address)} loading={false} /></ToastProvider>)
    expect(await screen.findByText('Unarchive the project in Estiva Ship to edit.')).toBeTruthy()
    expect(screen.getByText('Unarchive the project to comment.')).toBeTruthy()
    await locked()
  })

  it('takes no comment while the file above it is still being read, and names nothing yet', async () => {
    render(<ToastProvider><FilePage file={archived(shipIssue(), `30850:${'e'.repeat(64)}:never-read`)} loading={false} /></ToastProvider>)
    await locked()
    expect(screen.queryByText(/Unarchive/)).toBeNull()
  })

  it('writes nothing for its text, title or summary, even what was being typed when the archive came', async () => {
    render(<ToastProvider><FilePage file={archived(doc())} loading={false} /></ToastProvider>)
    const box = (await screen.findByRole('textbox', { name: 'Document' })) as EditorBox
    await waitFor(() => expect(box.editor?.isInitialized).toBe(true))
    write(box, 'Typed into an archived page.')
    leave(box)
    for (const field of [await titleBox(), await summaryBox()]) {
      write(field, 'Typed as it was archived')
      leave(field)
    }
    await act(async () => {})
    expect(published).toHaveLength(0)
  })
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

describe('the comments column hides and comes back (LED-3)', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })
  const page = () => render(<ToastProvider><FilePage file={doc()} loading={false} /></ToastProvider>)

  it('hides from the header and comes back with one click', async () => {
    page()
    expect(await screen.findByText(/No comments yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide comments' }))
    expect(screen.queryByText(/No comments yet/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show comments' }))
    expect(await screen.findByText(/No comments yet/)).toBeTruthy()
  })

  it('stays hidden after a reload, until it is shown again', async () => {
    const { unmount } = page()
    fireEvent.click(await screen.findByRole('button', { name: 'Hide comments' }))
    unmount()
    page()
    expect(await screen.findByRole('button', { name: 'Show comments' })).toBeTruthy()
    expect(screen.queryByText(/No comments yet/)).toBeNull()
  })

  it('starts hidden in a window too narrow for it', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} }))
    page()
    expect(await screen.findByRole('button', { name: 'Show comments' })).toBeTruthy()
    expect(screen.queryByText(/No comments yet/)).toBeNull()
  })
})
