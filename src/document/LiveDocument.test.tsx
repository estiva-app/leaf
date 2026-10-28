import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import type { FileText } from '@estiva-app/conversation'

vi.mock('../relay/bridge', () => ({ query: vi.fn(async () => []), publish: vi.fn(), viewerPubkey: () => null, relaySigner: () => null }))
// What the page's links read: nothing, unless a test hands one its file.
const references = vi.hoisted(() => vi.fn((): Record<string, unknown> => ({})))
vi.mock('./references', async (actual) => ({ ...(await actual<typeof import('./references')>()), useEditorReferences: references }))

import { ToastProvider } from '@estiva-app/ui'
import { LiveDocument } from './LiveDocument'

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
afterEach(cleanup)

type EditorBox = HTMLElement & { editor: Editor }
const page = () => screen.getByRole('textbox', { name: 'Document' }) as EditorBox
const ready = async () => {
  await waitFor(() => expect(page().editor.isInitialized).toBe(true))
  return page()
}
/* jsdom fires no focus event when the editor focuses itself, so it is fired here, as a browser would. */
const enter = (box: EditorBox) =>
  act(() => {
    box.editor.commands.focus('end')
    fireEvent.focus(box)
  })
/* jsdom cannot type into a contenteditable: text goes in through the editor's own command. */
const type = (box: EditorBox, text: string) => {
  enter(box)
  act(() => void box.editor.chain().insertContent(text).run())
}
const leave = (box: EditorBox) => act(() => void fireEvent.blur(box))
const text = () => page().editor.getText()

const KATERINA = { pubkey: 'k'.repeat(64), name: 'Katerina' }

type Commit = (saved: FileText & { content: string }, editedFrom: FileText) => Promise<boolean>

function mount(onCommit = vi.fn<Commit>(async () => true), onLeftUnsaved = vi.fn()) {
  const props = { format: 'marker' as const, changedBy: KATERINA, onCommit, onLeftUnsaved }
  // A card's pickers say a refused change in a toast.
  const page = (value: string) => (
    <ToastProvider>
      <LiveDocument value={value} {...props} />
    </ToastProvider>
  )
  const view = render(page('mine'))
  const arrive = (value: string) => view.rerender(page(value))
  return { ...view, arrive, onCommit, onLeftUnsaved }
}

describe('someone else saves the page', () => {
  it('draws their text at once while you are not in the page', async () => {
    const { arrive } = mount()
    await ready()
    arrive('theirs')
    await waitFor(() => expect(text()).toBe('theirs'))
    expect(screen.queryByText(/saved a newer version/)).toBeNull()
  })

  it('waits while you are in the page, says who saved, and Load it shows theirs', async () => {
    const { arrive, onCommit } = mount()
    const box = await ready()
    enter(box)
    arrive('theirs')
    expect(await screen.findByText(/Katerina saved a newer version\./)).toBeTruthy()
    expect(text()).toBe('mine')
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Load it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load it' }))
    await waitFor(() => expect(text()).toBe('theirs'))
    expect(screen.queryByText(/saved a newer version/)).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('loads theirs as you leave when you changed nothing', async () => {
    const { arrive, onCommit } = mount()
    const box = await ready()
    enter(box)
    arrive('theirs')
    await screen.findByText(/saved a newer version/)
    leave(box)
    await waitFor(() => expect(text()).toBe('theirs'))
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('saves yours over theirs when you changed something: the later save wins, and theirs is not drawn back', async () => {
    const { arrive, onCommit } = mount()
    const box = await ready()
    type(box, ' and more')
    arrive('theirs')
    await screen.findByText(/saved a newer version/)
    leave(box)
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    expect(onCommit.mock.calls[0][0].content).toContain('mine and more')
    // The page still holds theirs until your save comes back; it must not replace yours.
    await act(async () => {})
    expect(text()).toBe('mine and more')
    expect(screen.queryByText(/saved a newer version/)).toBeNull()
  })
})

describe('a save the relay refuses', () => {
  it('keeps the text in the page and says so', async () => {
    const { onCommit } = mount(vi.fn<Commit>(async () => false))
    const box = await ready()
    type(box, ' unsaved')
    leave(box)
    expect(await screen.findByText('Could not save. Your text is still here.')).toBeTruthy()
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(text()).toBe('mine unsaved')
  })

  it('is reported once you have left the page, when there is no editor left to say it', async () => {
    const { unmount, onLeftUnsaved } = mount(vi.fn<Commit>(async () => false))
    const box = await ready()
    type(box, ' unsaved')
    unmount()
    await waitFor(() => expect(onLeftUnsaved).toHaveBeenCalledTimes(1))
  })
})

describe('the text a save was edited from', () => {
  it('is the page as opened, in its format, and after your save it is your save, as a block document', async () => {
    const { onCommit } = mount()
    const box = await ready()
    type(box, ' one')
    leave(box)
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    const [first, openedFrom] = onCommit.mock.calls[0]
    // An old page is marker text: compared as marker text, not as a block document.
    expect(openedFrom).toEqual({ content: 'mine' })
    type(box, ' two')
    leave(box)
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2))
    // Edited from your first save: whoever it named is not named anew by the second (SPEC §11.8).
    expect(onCommit.mock.calls[1][1]).toEqual({ content: first.content, format: 'estiva-blocks-1' })
  })
})

describe('a link on words in a page', () => {
  it('keeps its link through a save of another change (WBD-7)', async () => {
    const HREF = 'https://example.com/docs'
    const saved = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', id: 'a1', content: [{ type: 'text', text: 'Read ' }, { type: 'text', text: 'the docs', marks: [{ type: 'link', attrs: { href: HREF } }] }] }],
    })
    const onCommit = vi.fn<Commit>(async () => true)
    render(
      <ToastProvider>
        <LiveDocument value={saved} format="blocks" changedBy={null} onCommit={onCommit} onLeftUnsaved={vi.fn()} />
      </ToastProvider>,
    )
    const box = await ready()
    type(box, ' first.')
    leave(box)
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    const { content } = onCommit.mock.calls[0][0]
    expect(content).toContain(`"href":"${HREF}"`)
    expect(content).toContain('first.')
  })
})

describe('a table', () => {
  it('goes in from / → Insert → Table, and the saved text opens with it', async () => {
    const { onCommit } = mount()
    const box = await ready()
    // Through the `/` menu itself: its query text is deleted in the same step as the row runs.
    type(box, ' /table')
    expect((await screen.findAllByRole('option')).map((o) => o.textContent?.replace('↩ Enter', ''))).toEqual(['Table'])
    await act(async () => {
      box.editor.view.someProp('handleKeyDown', (handle) => handle(box.editor.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    })
    act(() => void box.editor.chain().insertContent('Name').run())
    expect(box.querySelectorAll('tr')).toHaveLength(3)
    expect(box.querySelectorAll('tr:first-child th')).toHaveLength(3)
    leave(box)
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    const [{ content: value, format: contentFormat }] = onCommit.mock.calls[0]
    // The saved tag, read back as `contentFormatOf` reads it.
    expect(contentFormat).toBe('estiva-blocks-1')
    cleanup()
    render(<LiveDocument value={value} format="blocks" changedBy={KATERINA} onCommit={vi.fn()} onLeftUnsaved={vi.fn()} />)
    const reopened = await ready()
    expect(reopened.querySelectorAll('tr')).toHaveLength(3)
    expect(reopened.querySelector('th')?.textContent).toBe('Name')
  })
})

describe('a project shown as its card in the page', () => {
  const URI = 'nostr:naddr1project'
  const lead = 'f3'.repeat(32)
  const PROJECT = {
    ref: 'r',
    kind: 30850,
    eventId: 'e',
    widget: 'card',
    address: `30850:${lead}:p`,
    noun: 'project',
    appName: 'Estiva Ship',
    slots: { title: { value: 'Widgets 2: build 2' }, status: { value: 'Planned', colour: 'neutral', field: 'status' } },
    meta: [{ label: 'Key', field: 'key', value: 'WBD' }],
    actions: [{ id: 'set-status', label: 'Status', control: 'select', field: 'status', current: 'planned', options: [{ value: 'planned', label: 'Planned' }, { value: 'done', label: 'Done' }] }],
    comments: [],
    viaRecommendation: false,
  }
  it('has its Status picker while its writer is not in the text, and words while they are', async () => {
    references.mockReturnValue({ [URI]: PROJECT })
    // The page as saved with the link alone on its line, shown as its card.
    const { onCommit } = mount()
    const first = await ready()
    enter(first)
    act(() => void first.editor.chain().clearContent().insertContent({ type: 'reference', attrs: { uri: URI, embed: 'detailed' } }).run())
    leave(first)
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    const [{ content: value }] = onCommit.mock.calls[0]
    cleanup()
    render(
      <ToastProvider>
        <LiveDocument value={value} format="blocks" changedBy={KATERINA} onCommit={vi.fn(async () => true)} onLeftUnsaved={vi.fn()} />
      </ToastProvider>,
    )
    const box = await ready()
    // The writer's page is always editable: editable alone is not "being edited".
    expect(box.editor.isEditable).toBe(true)
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeNull())
    // A press on the picker is the picker's: the text does not take it (ProseMirror skips a press whose default is
    // prevented), so the caret does not come in and turn the card to words under the pointer.
    const status = screen.getByRole('combobox', { name: 'Status' })
    expect(fireEvent.mouseDown(status.querySelector('span') ?? status)).toBe(false)
    enter(box)
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull())
    expect(screen.getByText('Planned')).toBeTruthy()
  })
})

describe('a picture in the text', () => {
  const SHOT = { url: 'https://relay.example/a279.png', m: 'image/png', x: 'a279'.padEnd(64, '0'), size: 2048, filename: 'shot.png' }
  type Saved = { content: { type: string; attrs?: { x?: string } }[] }
  const attachments = (content: string) => (JSON.parse(content) as Saved).content.filter((block) => block.type === 'attachment')

  it('draws as its file card, not its name, and a word typed beside it keeps it in the saved text', async () => {
    const { onCommit } = mount()
    const first = await ready()
    enter(first)
    act(() => void first.editor.chain().insertContent({ type: 'attachment', attrs: SHOT }).run())
    leave(first)
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    const [{ content: value }] = onCommit.mock.calls[0]
    cleanup()
    const reopen = vi.fn<Commit>(async () => true)
    render(<LiveDocument value={value} format="blocks" changedBy={KATERINA} onCommit={reopen} onLeftUnsaved={vi.fn()} />)
    const box = await ready()
    // The kit's card for a picture, where the editor alone draws the file name as a line of text.
    await waitFor(() => expect(box.querySelector('[data-attachment="image"]')).not.toBeNull())
    type(box, ' and more')
    leave(box)
    await waitFor(() => expect(reopen).toHaveBeenCalledTimes(1))
    expect(attachments(reopen.mock.calls[0][0].content)).toMatchObject([{ attrs: { x: SHOT.x } }])
  })

  /* `/upload` and Enter, then the file chosen in the picker the row opens. */
  const pickThroughSlash = async (box: EditorBox, file: File) => {
    type(box, ' /upload')
    expect((await screen.findAllByRole('option')).map((o) => o.textContent?.replace('↩ Enter', ''))).toEqual(['Upload'])
    await act(async () => {
      box.editor.view.someProp('handleKeyDown', (handle) => handle(box.editor.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    })
    const picker = document.querySelector<HTMLInputElement>('input[type=file]')
    expect(picker).not.toBeNull()
    await act(async () => void fireEvent.change(picker!, { target: { files: [file] } }))
    // The window has focus again once the picker closes, as a browser says it.
    act(() => void window.dispatchEvent(new Event('focus')))
  }

  it('goes in from / → Upload, and the save keeps the uploaded file (LED-2)', async () => {
    const onCommit = vi.fn<Commit>(async () => true)
    const upload = vi.fn(async () => SHOT)
    render(<LiveDocument value="mine" format="marker" changedBy={KATERINA} onCommit={onCommit} onLeftUnsaved={vi.fn()} upload={upload} />)
    const box = await ready()
    const file = new File(['png'], 'shot.png', { type: 'image/png' })
    await pickThroughSlash(box, file)
    expect(upload).toHaveBeenCalledWith(file)
    await waitFor(() => expect(box.querySelector('[data-attachment="image"]')).not.toBeNull())
    leave(box)
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    expect(attachments(onCommit.mock.calls[0][0].content)).toMatchObject([{ attrs: { x: SHOT.x, url: SHOT.url } }])
  })

  it('offers Upload once a page opened read only is unlocked while open (an unarchive arriving live)', async () => {
    const upload = vi.fn(async () => SHOT)
    const at = (readOnly: boolean) => <LiveDocument value="mine" format="marker" changedBy={KATERINA} onCommit={vi.fn(async () => true)} onLeftUnsaved={vi.fn()} upload={upload} readOnly={readOnly} />
    const view = render(at(true))
    await ready()
    view.rerender(at(false))
    const box = await ready()
    await waitFor(() => expect(box.editor.isEditable).toBe(true))
    await pickThroughSlash(box, new File(['png'], 'shot.png', { type: 'image/png' }))
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('a refused upload says why under the page and adds nothing', async () => {
    const upload = vi.fn(async () => {
      throw new Error('big.png: Too large')
    })
    render(<LiveDocument value="mine" format="marker" changedBy={KATERINA} onCommit={vi.fn()} onLeftUnsaved={vi.fn()} upload={upload} />)
    const box = await ready()
    await pickThroughSlash(box, new File(['png'], 'big.png', { type: 'image/png' }))
    expect(await screen.findByText('big.png: Too large')).toBeTruthy()
    expect(box.querySelector('[data-attachment]')).toBeNull()
  })

  it('whose stored attributes are not a file draws as words, and the page still opens', async () => {
    const hostile = JSON.stringify({ type: 'doc', content: [{ type: 'attachment', id: 'b1', attrs: { ...SHOT, m: 5, filename: { a: 1 } } }] })
    render(<LiveDocument value={hostile} format="blocks" changedBy={KATERINA} onCommit={vi.fn()} onLeftUnsaved={vi.fn()} />)
    const box = await ready()
    expect(box.querySelector('[data-attachment]')).toBeNull()
    expect(box.textContent).toContain('attachment')
  })
})
