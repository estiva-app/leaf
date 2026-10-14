import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'

vi.mock('../relay/bridge', () => ({ query: vi.fn(async () => []), publish: vi.fn(), viewerPubkey: () => null }))

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

type Commit = (value: string, contentFormat?: string) => Promise<boolean>

function mount(onCommit = vi.fn<Commit>(async () => true), onLeftUnsaved = vi.fn()) {
  const props = { format: 'marker' as const, changedBy: KATERINA, onCommit, onLeftUnsaved }
  const view = render(<LiveDocument value="mine" {...props} />)
  const arrive = (value: string) => view.rerender(<LiveDocument value={value} {...props} />)
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
    expect(await screen.findByText('Katerina saved a newer version.')).toBeTruthy()
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
    expect(onCommit.mock.calls[0][0]).toContain('mine and more')
    // The page still holds theirs until your save comes back; it must not replace yours.
    await act(async () => {})
    expect(text()).toBe('mine and more')
    expect(screen.queryByText(/saved a newer version/)).toBeNull()
  })
})

describe('a save the relay refuses', () => {
  it('keeps the text in the page and says so', async () => {
    const { onCommit } = mount(vi.fn(async () => false))
    const box = await ready()
    type(box, ' unsaved')
    leave(box)
    expect(await screen.findByText('Could not save. Your text is still here.')).toBeTruthy()
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(text()).toBe('mine unsaved')
  })

  it('is reported once you have left the page, when there is no editor left to say it', async () => {
    const { unmount, onLeftUnsaved } = mount(vi.fn(async () => false))
    const box = await ready()
    type(box, ' unsaved')
    unmount()
    await waitFor(() => expect(onLeftUnsaved).toHaveBeenCalledTimes(1))
  })
})
