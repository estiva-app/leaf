import { useCallback, useRef, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { IconLink, IconMessage } from '@tabler/icons-react'
import {
  BLOCK_DOCUMENT_FORMAT,
  descriptionTextToBlockDocument,
  documentForEditing,
  encodeNpub,
  publishableFromEditor,
  toEditorDocument,
  type ContentFormat,
  imetaFromAttrs,
  type EditorDocument,
  type Imeta,
} from '@estiva-app/protocol'
import { uploadIntoText } from '../relay/blobs'
import type { FileText } from '@estiva-app/conversation'
import { MenuItem } from '@estiva-app/ui'
import { DocumentEditor, type AttachmentViewProps, type DocumentCodec, type HeldTyping, type MentionPerson, type SelectionAnchor } from '@estiva-app/ui/editor'
import { PageFocusedProvider, PageLink, PageNamesProvider } from './PageLink'
import { ReferencesProvider, useEditorReferences } from './references'
import { REFERENCE_COPY, referenceSections, subscribeReferences } from './referencePicker'
import type { ChangedBy } from './useLiveDocument'
import { sessionEnded } from '../auth/estivaId'
import { heldText, registerHeld, releaseHeld } from '../auth/heldTyping'
import { FileCard } from '../comments/CommentFiles'
import { MAX_LINKS_ASKED } from '@estiva-app/interop'
import { linkReferenceOf, links } from '../comments/links'
import { useMentionPeople } from '../comments/people'

/**
 * A page's text as the shared editor reads and writes it: Leaf's saved text, a
 * block document once saved. A link on words keeps its link through a save
 * (§13.3, C23): with Ship's descriptions on the shared editor too (WBD-7), it
 * is the only editor of a document's text (Peek edits none), the condition
 * WBD-1 set for turning it on.
 */
const CODEC: DocumentCodec = {
  read: (value, format) => toEditorDocument(documentForEditing(value, format as ContentFormat), { links: true }),
  write: (doc) => publishableFromEditor(doc as EditorDocument),
}

/** Where text typed as the sign-in ends is held until the passkey tap (AUT-5). */
const HOLD: HeldTyping = { text: heldText, release: releaseHeld, register: registerHeld, ended: () => sessionEnded() !== null }

/** `[`: this Folder's files first, then what the relay finds by title (SUM-7). */
const REFERENCES = { sections: referenceSections, subscribe: subscribeReferences, ariaLabel: REFERENCE_COPY.ariaLabel, sectionLabel: REFERENCE_COPY.files }

/** A pasted app URL becomes its file's chip, as in Leaf's comments (`LinkChips`, §7.7). */
const LINK_CHIPS = { referenceOf: linkReferenceOf, ask: links.ask, limit: MAX_LINKS_ASKED }

/** Markdown pasted as plain text lands as the blocks it spells, tables and links on words included, read as the agent reads a description (LEAF-10). */
const readMarkdown = (text: string) => toEditorDocument(descriptionTextToBlockDocument(text), { links: true })

/** A file in the text — a picture is one — as the kit's card, as Ship's description draws it: a picture opens full size (115c8229). */
function PageFile({ attrs }: AttachmentViewProps) {
  // The attributes are whoever saved last's: a block the protocol will not name as a file is not drawn as one (§13.3).
  const file = imetaFromAttrs(attrs)
  if (!file) return <span>{typeof attrs.filename === 'string' ? attrs.filename : 'attachment'}</span>
  return <FileCard file={file} download={false} />
}

/**
 * A document's text: the shared editor every app writes a document with
 * (`DocumentEditor`), its links drawn with the kit's chip, row and card, `[`
 * offering this Folder's files first, `@` the relay's people, and comments on
 * a selection switched on. It saves when you leave it, and someone else's save
 * arrives as the editor says.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-app-edits-a-document-with-one-shared-editor.md
 */
export function LiveDocument({
  value,
  holdKey,
  format,
  changedBy,
  onCommit,
  onLeftUnsaved,
  onEditor,
  onCommentOn,
  onCopyLink,
  upload = uploadIntoText,
  readOnly = false,
}: {
  value: string
  /** `/` → Upload and a pasted picture: put the file on the relay and answer its `imeta`, or throw the words to show (LED-2). */
  upload?: (file: File) => Promise<Imeta>
  /** Read only, as an archived file's text is (SPEC §6.5): nothing is typed or saved. Its page leaves out `onCommentOn` too (PEEKM-8). */
  readOnly?: boolean
  /** Where its unsaved text is held when the sign-in ends while it is open (AUT-5): the document's address. */
  holdKey?: string
  format: ContentFormat
  /** Who saved the text last, when it was not you. */
  changedBy: ChangedBy | null
  /** Save the text, given the text it was edited from, so whoever it names anew is added. */
  onCommit: (saved: FileText & { content: string }, editedFrom: FileText) => Promise<boolean>
  onLeftUnsaved: () => void
  /** The editor, once it is there: the comments column draws its highlights in it and finds its blocks. */
  onEditor?: (editor: Editor | null) => void
  /** Comment, from a block's handle or the selection's strip: start a comment on that block, or on what is selected. */
  onCommentOn?: (anchor: SelectionAnchor) => void
  /** Copy link, from a block's handle: copy the link to that block, as Ship's block menu does. */
  onCopyLink?: (blockId: string) => void
}) {
  // Your last save, so the text the next one is edited from is read in the format it was written in.
  const lastSave = useRef<FileText | null>(null)
  const commit = useCallback(
    async (next: string, contentFormat: string | undefined, editedFrom: string) => {
      const from: FileText =
        lastSave.current && lastSave.current.content === editedFrom
          ? lastSave.current
          : { content: editedFrom, ...(format === 'blocks' ? { format: BLOCK_DOCUMENT_FORMAT } : {}) }
      const saved = { content: next, ...(contentFormat ? { format: contentFormat } : {}) }
      const ok = await onCommit(saved, from)
      if (ok) lastSave.current = saved
      return ok
    },
    [onCommit, format],
  )
  const people = useMentionPeople()
  const mentions = { people: () => people.people, uriOf: (person: MentionPerson) => (person.pubkey ? `nostr:${encodeNpub(person.pubkey)}` : null) }
  const blockRows =
    onCopyLink || onCommentOn
      ? (block: { id?: string | null }) => {
          // A block without an id yet has nothing to address, so it gets neither row (Ship's blockRows).
          const id = block.id
          if (!id) return null
          return (
            <>
              {onCopyLink && <MenuItem label="Copy link" leading={<IconLink size={16} stroke={1.5} className="text-text-secondary" />} onClick={() => onCopyLink(id)} />}
              {onCommentOn && <MenuItem label="Comment" leading={<IconMessage size={16} stroke={1.5} className="text-text-secondary" />} onClick={() => onCommentOn({ blocks: [id] })} />}
            </>
          )
        }
      : undefined
  return (
    <DocumentEditor
      value={value}
      format={format}
      codec={CODEC}
      onCommit={commit}
      label="Document"
      placeholder="Type / for headings and lists."
      readOnly={readOnly}
      changedBy={changedBy ? { name: changedBy.name ?? 'Someone' } : null}
      onLeftUnsaved={onLeftUnsaved}
      hold={HOLD}
      {...(holdKey ? { holdKey } : {})}
      references={REFERENCES}
      mentions={mentions}
      linkChips={LINK_CHIPS}
      readMarkdown={readMarkdown}
      {...(onCommentOn ? { onCommentOnSelection: onCommentOn } : {})}
      {...(blockRows ? { blockRows } : {})}
      referenceView={PageLink}
      // Given while read only too: the editor is built once, and a page unarchived live must offer Upload. A locked page takes no
      // paste or "/", and the editor calls the latest one, so a read-only page refuses here as well (SPEC §6.5).
      upload={async (file) => {
        if (readOnly) throw new Error(`${file.name}: Read only`)
        return { ...(await upload(file)) }
      }}
      attachmentView={PageFile}
      wrap={(children, editor) => (
        <PageReferences editor={editor} nameOf={people.nameOf}>
          {children}
        </PageReferences>
      )}
      {...(onEditor ? { onEditor } : {})}
    />
  )
}

/** Every file the page links to, read in one go and handed to each link, and the people's names to each mention. */
function PageReferences({ editor, nameOf, children }: { editor: Editor | null; nameOf: (pubkey: string) => string | undefined; children: ReactNode }) {
  const references = useEditorReferences(editor)
  const focused = useEditorState({ editor, selector: ({ editor: e }) => !!e?.isFocused }) ?? false
  return (
    <ReferencesProvider value={references}>
      <PageNamesProvider value={nameOf}>
        <PageFocusedProvider value={focused}>{children}</PageFocusedProvider>
      </PageNamesProvider>
    </ReferencesProvider>
  )
}
