import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TextSelection } from '@tiptap/pm/state'
import { documentForEditing, publishableFromEditor, toEditorDocument, type ContentFormat, type EditorDocument } from '@estiva-app/protocol'
import { Button, FieldLine, richTextClassName } from '@estiva-app/ui'
import {
  AttachmentNode,
  BlockId,
  Callout,
  Checklist,
  CodeBlockColours,
  EditorBlockHandle,
  EditorTableControls,
  ReferenceCards,
  ReferenceMenu,
  ReferenceMenuView,
  ReferenceNode,
  SelectionToolbar,
  SlashCommands,
  UnknownBlock,
  blockDropCursor,
  formatSection,
  isChecklistTick,
  isReferenceMenuOpen,
  isSuggestionOpen,
  type BlockTurnInto,
  type SlashSection,
} from '@estiva-app/ui/editor'
import { EditorLineCards, ReferenceChip, ReferencesProvider, useEditorReferences } from './references'
import type { ChangedBy } from './useLiveDocument'

/** The block handle's Turn into, as Katerina's prototype has it. */
const TURN_INTO: BlockTurnInto[] = [
  { label: 'Text', run: (editor) => editor.chain().setParagraph().run(), active: (node) => node.type.name === 'paragraph' },
  { label: 'Heading', run: (editor) => editor.chain().setHeading({ level: 1 }).run(), active: (node) => node.type.name === 'heading' && node.attrs.level === 1 },
  { label: 'Subheading', run: (editor) => editor.chain().setHeading({ level: 2 }).run(), active: (node) => node.type.name === 'heading' && node.attrs.level === 2 },
  { label: 'Code', run: (editor) => editor.chain().setCodeBlock().run(), active: (node) => node.type.name === 'codeBlock' },
]

/** `/`: the package's Format section, then Leaf's own rows under Insert — the heading every app's own section takes, as in Ship. */
export const SLASH_SECTIONS: SlashSection[] = [
  formatSection('block'),
  // Three by three with a header row, as Ship's Insert → Table makes it.
  { label: 'Insert', commands: [{ key: 'insert-table', row: { label: 'Table' }, run: (editor) => void editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() }] },
]

/**
 * A document's text as one surface that is always an editor — Ship's
 * `LiveDescription`, which Katerina's Leaf prototype draws the same way:
 *
 * - **Saves when you leave:** on blur, and on unmount — opening another file
 *   in the tree. Never while typing. Escape leaves and keeps the text. A
 *   refused save keeps the text and says so; one refused after you left the
 *   page is handed to `onLeftUnsaved`, since there is no editor left to say it.
 * - **Someone else's save arrives** while you are not in it: it is loaded.
 *   While you are in it, it waits, and a line says who saved a newer version
 *   with "Load it" (Miky, LEAF-3's kickoff); leaving without having changed
 *   anything loads it, and leaving with a change saves yours over it — the
 *   later save wins (Miky, 13 October). Your own save coming back is never
 *   mistaken for someone else's.
 *
 * Kept from Ship: the block ids and unknown blocks that keep comments anchored
 * (§13.6), checklists, callouts and tables, and a reference's chosen card
 * drawn after its line (§13.3), chosen from the chip's menu.
 */
export function LiveDocument({
  value,
  format,
  changedBy,
  onCommit,
  onLeftUnsaved,
}: {
  value: string
  format: ContentFormat
  /** Who saved the text last, when it was not you. */
  changedBy: ChangedBy | null
  onCommit: (value: string, contentFormat?: string) => Promise<boolean>
  onLeftUnsaved: () => void
}) {
  const [failed, setFailed] = useState(false)
  const [focused, setFocused] = useState(false)
  /*
    The text the editor holds as saved or loaded. A page value that differs is
    someone else's save: loaded at once while you are not in the page, waiting
    with a line while you are. `saved` is the same, for the editor's callbacks.
  */
  const [base, setBase] = useState(value)
  const saved = useRef(value)
  /*
    The page's value your own save replaced. Until your save comes back from the
    relay the page still holds the text before it, which is not someone else's.
  */
  const [superseded, setSuperseded] = useState<string | null>(null)
  // A save out: nothing is loaded over the text it carries until the relay has answered.
  const [saving, setSaving] = useState(false)
  const committing = useRef(false)
  // The page's value now, for the editor's callbacks.
  const latest = useRef({ value, format })
  useEffect(() => {
    latest.current = { value, format }
  }, [value, format])
  // The text as last typed. Saving on the way out reads this, not the editor, which may already be torn down.
  const typed = useRef<EditorDocument | null>(null)
  const again = useRef(false)
  const left = useRef(false)

  const save = useCallback(
    async (doc: EditorDocument | null) => {
      if (!doc) return
      // A change made while a save is out goes next, not nowhere.
      if (committing.current) {
        again.current = true
        return
      }
      const next = publishableFromEditor(doc)
      if (next.value === saved.current) return
      committing.current = true
      setSaving(true)
      // The later save wins: whatever the page holds as you save is replaced by yours.
      const replaced = latest.current.value
      try {
        const ok = await onCommit(next.value, next.contentFormat)
        if (ok) {
          // The editor already shows it, and may hold more typed since: `shown` keeps the effect below from setting it.
          saved.current = next.value
          shown.current = next.value
          setSuperseded(replaced)
          setBase(next.value)
        }
        if (left.current) {
          if (!ok) onLeftUnsaved()
        } else setFailed(!ok)
      } finally {
        committing.current = false
        setSaving(false)
        if (again.current) {
          again.current = false
          void latestSave.current(typed.current)
        }
      }
    },
    [onCommit, onLeftUnsaved],
  )
  // The latest `save`, for the editor's `onBlur` (created once) and the unmount below.
  const latestSave = useRef(save)
  useEffect(() => {
    latestSave.current = save
  }, [save])
  // The text the editor was last set to, so a `base` it already shows is not set again under the caret.
  const shown = useRef(value)

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false, strike: false, heading: { levels: [1, 2, 3] }, dropcursor: blockDropCursor, codeBlock: false }),
        CodeBlockColours,
        TableKit.configure({ table: { resizable: false } }),
        BlockId,
        Checklist,
        Callout,
        ReferenceNode.configure({ view: ReferenceChip }),
        // The card a chip asks for, after its line (SPEC §13.3); drawn by `EditorLineCards` below.
        ReferenceCards,
        // A click on a chip offers Open and its card: None, Compact or Detailed (Miky, 14 October).
        ReferenceMenu,
        UnknownBlock,
        AttachmentNode,
        SlashCommands.configure({ sections: SLASH_SECTIONS }),
      ],
      // Built once. A value coming back must not rebuild the editor under the caret; see the effect below.
      content: toEditorDocument(documentForEditing(value, format)),
      editorProps: {
        attributes: { 'aria-label': 'Document', role: 'textbox', 'aria-multiline': 'true', class: richTextClassName('default', 'outline-none') },
        handleKeyDown: (view, event) => {
          if (event.key !== 'Escape') return false
          if (isSuggestionOpen() || isReferenceMenuOpen(view.state)) return false
          const { selection, tr } = view.state
          if (!selection.empty) {
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, selection.to)))
            return true
          }
          view.dom.blur()
          return true
        },
      },
      onUpdate: ({ editor: e, transaction }) => {
        typed.current = e.getJSON() as EditorDocument
        // A click on a box does not focus the field, so no blur will save it.
        if (isChecklistTick(transaction)) void latestSave.current(typed.current)
      },
      onFocus: () => setFocused(true),
      onBlur: () => {
        setFocused(false)
        // Yours, if you changed anything: it replaces what waited. If not, what waited is loaded as you leave (below).
        void latestSave.current(typed.current)
      },
    },
    [],
  )

  /*
    Someone else's save. Not in the page: theirs is the text now. In it, or
    with your own text unsaved after a refusal: it waits, and the line below
    says so. Never over a save that is still out.
  */
  const arrived = value !== base && value !== superseded
  if (arrived && !focused && !saving && !failed) setBase(value)
  const waiting = arrived && (focused || failed)

  // The text the editor should hold, set into it when it changes — never under your own typing, which `shown` already holds.
  useEffect(() => {
    saved.current = base
    if (!editor || editor.isDestroyed || base === shown.current) return
    editor.commands.setContent(toEditorDocument(documentForEditing(base, latest.current.format)), { emitUpdate: false })
    shown.current = base
    typed.current = null
  }, [editor, base])

  const empty = useEditorState({ editor, selector: ({ editor: ed }) => !ed || ed.isEmpty })

  // "Load it": theirs replaces what you have not saved.
  const load = () => {
    setBase(latest.current.value)
    setFailed(false)
  }

  // Opening another file unmounts this: save on the way out.
  useEffect(
    () => () => {
      left.current = true
      void latestSave.current(typed.current)
    },
    [],
  )

  const references = useEditorReferences(editor)
  const who = changedBy?.name ?? 'Someone'

  return (
    <ReferencesProvider value={references}>
      <div className="flex flex-col gap-1">
        <EditorBlockHandle editor={editor} turnInto={TURN_INTO}>
          <EditorTableControls editor={editor}>
            <EditorContent editor={editor} className="-mx-2 cursor-text px-2 py-1" data-document="editing" />
          </EditorTableControls>
          {empty && <span aria-hidden className="pointer-events-none absolute left-0 top-1 text-body-2 text-text-muted">Type / for headings and lists.</span>}
        </EditorBlockHandle>
        <EditorLineCards editor={editor} resolved={references} />
        <SelectionToolbar editor={editor} marks={['bold', 'italic', 'underline', 'code']} />
        <ReferenceMenuView editor={editor} />
        {waiting && (
          <FieldLine tone="helper">
            {`${who} saved a newer version.`}{' '}
            {/* Pressing it must not take focus from the page: that blur would save yours over theirs first. */}
            <Button variant="muted" size="small" onMouseDown={(event) => event.preventDefault()} onClick={load}>
              Load it
            </Button>
          </FieldLine>
        )}
        {failed && <FieldLine tone="error">Could not save. Your text is still here.</FieldLine>}
      </div>
    </ReferencesProvider>
  )
}
