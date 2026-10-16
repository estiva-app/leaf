/**
 * A comment Leaf writes on a selection is found by every other reader: the
 * anchor the editor gives (`anchorOfSelection`, from `@estiva-app/ui`) resolves
 * in the protocol's reader (`resolveCommentAnchor`), which Peek uses. The two
 * read a block's text separately, and once disagreed on a line break: a
 * comment across two lines of a quote read as reworded everywhere but Leaf.
 */
import { beforeAll, expect, it } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { blockRunTag, descriptionTextToBlockDocument, quoteTag, resolveCommentAnchor, serializeBlockDocument } from '@estiva-app/protocol'
import { anchorOfSelection } from '@estiva-app/ui/editor'
import { LiveDocument } from '../document/LiveDocument'

beforeAll(() => {
  // jsdom has no layout; the editor's selection strip and line cards measure.
  Element.prototype.scrollIntoView = () => {}
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects = rects
    proto.getBoundingClientRect = empty
  }
})

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

const cases: [name: string, text: string, from: string, to: string][] = [
  ['across two lines of a quote', '> first line here\n> second line here', 'line here', 'second line'],
  ['across a line break in a paragraph', 'A line  \nbroken here', 'line', 'broken'],
  ['across two items of a list', '- one item\n- two item', 'item', 'two'],
  ['on a few words of one paragraph', 'Plain words only', 'words', 'words'],
]

for (const [name, text, from, to] of cases) {
  it(`a comment ${name} is found where it was written by the protocol's reader`, async () => {
    const value = serializeBlockDocument(descriptionTextToBlockDocument(text))
    let opened: Editor | null = null
    render(<LiveDocument value={value} format="blocks" changedBy={null} onCommit={async () => true} onLeftUnsaved={() => {}} onEditor={(e) => (opened = e)} onCommentOn={() => {}} />)
    await waitFor(() => expect(opened?.isInitialized).toBe(true))
    const editor = opened as unknown as Editor
    act(() => void editor.commands.setTextSelection({ from: rangeOf(editor, from).from, to: rangeOf(editor, to).to }))
    const anchor = anchorOfSelection(editor)
    expect(anchor?.quote).toBeDefined()
    const tags = [blockRunTag(anchor!.blocks), quoteTag(anchor!.quote!)]
    expect(resolveCommentAnchor({ kind: 1111, tags }, value, 'blocks').state).toBe('resolved')
  })
}
