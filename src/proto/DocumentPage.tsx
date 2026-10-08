import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { IconCircleCheck, IconLayoutSidebarRight, IconLink, IconMessage, IconMessagePlus, IconX } from '@tabler/icons-react'
import { documentForEditing, toEditorDocument, toRenderTree } from '@estiva-app/protocol'
import {
  Card,
  Chip,
  CollapsibleSection,
  Divider,
  EditableText,
  EmptyState,
  IconButton,
  KindIcon,
  MembersDialog,
  MembersPill,
  MenuItem,
  Panel,
  Person,
  Popover,
  RichText,
  SkeletonBar,
  Toolbar,
  ToolbarButton,
  WithTooltip,
  richTextClassName,
  useToast,
  type HandleBlock,
} from '@estiva-app/ui'
import {
  AttachmentNode,
  BlockId,
  COMPOSE_EDITOR_CLASSES,
  CommentHighlights,
  ComposeBox,
  ComposeKeys,
  EditorBlockHandle,
  ReferenceNode,
  ReferenceTrigger,
  SelectionToolbar,
  SlashCommands,
  UnknownBlock,
  blockDropCursor,
  commentElement,
  commentRange,
  formatSection,
  quoteOfSelection,
  setCommentAnchors,
  typeTrigger,
  type BlockTurnInto,
  type CommentAnchor,
  type ReferenceViewProps,
} from '@estiva-app/ui/editor'
import { PEOPLE, THINGS, kindOf, storedFrom, type Doc, type PersonId, type Stored, type Thread } from './fixtures'
import { Reference } from './Reference'

/** Where a comment is read: the column beside the text, or a bubble on the words. */
export type CommentsIn = 'column' | 'bubble'

/** A comment being written: the block and the words it is about, or null for the whole document. */
type Draft = { block: string; quote: string } | null

/** The draft's highlight id, so the words being commented on are marked while you write. */
const DRAFT = 'draft'

const TURN_INTO: BlockTurnInto[] = [
  { label: 'Text', run: (editor) => editor.chain().setParagraph().run(), active: (node) => node.type.name === 'paragraph' },
  { label: 'Heading', run: (editor) => editor.chain().setHeading({ level: 1 }).run(), active: (node) => node.type.name === 'heading' && node.attrs.level === 1 },
  { label: 'Subheading', run: (editor) => editor.chain().setHeading({ level: 2 }).run(), active: (node) => node.type.name === 'heading' && node.attrs.level === 2 },
  { label: 'Code', run: (editor) => editor.chain().setCodeBlock().run(), active: (node) => node.type.name === 'codeBlock' },
]

/** The `[` list's row icons, from the package's one table. */
const rowIcon = (uri: string) => {
  const kind = kindOf(uri)
  return kind ? <KindIcon kind={kind} /> : undefined
}

/** A reference in the editor: Leaf's chip, the one a reader sees. */
const ReferenceView = ({ uri }: ReferenceViewProps) => <Reference uri={uri} />

/**
 * The grammar of a block document, as Ship's description and Peek's
 * BlockDocumentField have it (BlockNodes.mdx): no link mark and no strike —
 * the stored document has neither — headings 1 to 3, tables, an id on every
 * block, a block it cannot edit kept whole, a reference and a file. `[` inserts
 * the protocol's reference node, which a save keeps.
 */
const blockDocument = () => [
  StarterKit.configure({ link: false, strike: false, heading: { levels: [1, 2, 3] }, dropcursor: blockDropCursor }),
  TableKit.configure({ table: { resizable: false } }),
  BlockId,
  ReferenceNode.configure({ view: ReferenceView }),
  UnknownBlock,
  AttachmentNode,
  ReferenceTrigger.configure({
    items: () => THINGS,
    ariaLabel: 'Point at a file',
    sectionLabel: 'Files in your apps',
    icon: <KindIcon kind="file" />,
    iconFor: rowIcon,
    nodeName: 'reference',
  }),
]

/** Opens a stored body in an editor, through the protocol. */
const opened = (body: Stored) => toEditorDocument(documentForEditing(body.value, body.format))

/** Scroll `box` — a Panel's body — until `el` shows. Only that box moves. */
function scrollWithin(box: HTMLElement | null, el: HTMLElement | null) {
  if (!box || !el) return
  const at = el.getBoundingClientRect()
  const view = box.getBoundingClientRect()
  if (at.top < view.top) box.scrollBy({ top: at.top - view.top - 16, behavior: 'smooth' })
  else if (at.bottom > view.bottom) box.scrollBy({ top: at.bottom - view.bottom + 16, behavior: 'smooth' })
}

/**
 * The editor of one document: the package's block handle, `/`, `[`, the
 * selection strip with Comment in it, and comments drawn on their words.
 */
function DocumentEditor({
  doc,
  onReady,
  onComment,
  onSelectHighlight,
  onCopyLink,
}: {
  doc: Doc
  onReady: (editor: Editor) => void
  onComment: (draft: NonNullable<Draft>) => void
  onSelectHighlight: (id: string) => void
  onCopyLink: () => void
}) {
  const [empty, setEmpty] = useState(!doc.body.value)
  const editor = useEditor({
    extensions: [
      ...blockDocument(),
      CommentHighlights,
      SlashCommands.configure({
        sections: [formatSection('block'), { label: 'Insert', commands: [{ key: 'insert-[', row: { label: 'A file from another app', shortcut: '[' }, run: typeTrigger('[') }] }],
      }),
    ],
    content: opened(doc.body),
    editorProps: { attributes: { 'aria-label': 'Document', role: 'textbox', 'aria-multiline': 'true', class: richTextClassName('default', 'outline-none') } },
    onUpdate: ({ editor: e }) => setEmpty(e.isEmpty),
  })

  useEffect(() => {
    if (editor) onReady(editor)
  }, [editor, onReady])

  // A highlight clicked in the text: its thread.
  useEffect(() => {
    if (!editor) return
    const select = ({ id }: { id: string }) => onSelectHighlight(id)
    editor.on('commentSelect', select)
    return () => {
      editor.off('commentSelect', select)
    }
  }, [editor, onSelectHighlight])

  /** A whole block's words, as the document holds them. */
  const blockText = (id: string) => {
    let text = ''
    editor?.state.doc.descendants((node) => {
      if (text) return false
      if (node.attrs.blockId === id) {
        text = node.textContent
        return false
      }
      return true
    })
    return text
  }

  // A block with no id cannot be pointed at: no rows of Leaf's (Ship's blockRows does the same).
  const rows = (block: HandleBlock) =>
    block.id ? (
      <>
        <MenuItem label="Comment" leading={<IconMessage size={16} stroke={1.5} className="text-text-secondary" />} onClick={() => onComment({ block: block.id!, quote: blockText(block.id!) })} />
        <MenuItem label="Copy link" leading={<IconLink size={16} stroke={1.5} className="text-text-secondary" />} onClick={onCopyLink} />
      </>
    ) : null

  return (
    <>
      <EditorBlockHandle editor={editor} turnInto={TURN_INTO} actions={rows} className="mt-8">
        <EditorContent editor={editor} />
        {/* Ship's pattern: muted words over an empty editor, from the editor's own `isEmpty`. */}
        {empty && <span aria-hidden className="pointer-events-none absolute left-0 top-0 text-body-2 text-text-muted">Type / for headings and lists, or [ to point at a file.</span>}
      </EditorBlockHandle>
      <SelectionToolbar
        editor={editor}
        marks={['bold', 'italic', 'underline', 'code']}
        actions={[
          {
            label: 'Comment',
            icon: <IconMessagePlus size={16} stroke={1.5} />,
            run: (ed) => {
              const quote = quoteOfSelection(ed)
              if (!quote) return
              // The words stay marked by the draft's highlight; the selection itself can go.
              ed.commands.setTextSelection(ed.state.selection.to)
              onComment(quote)
            },
          },
        ]}
      />
    </>
  )
}

/** The box a comment or a reply is written in: the package's ComposeBox, Peek's box, writing the document's grammar. */
function Composer({ placeholder, onSend, autoFocus }: { placeholder: string; onSend: (body: Stored) => void; autoFocus?: boolean }) {
  const editor = useEditor({
    extensions: [...blockDocument(), ComposeKeys],
    editorProps: { attributes: { class: COMPOSE_EDITOR_CLASSES, 'aria-label': placeholder } },
  })
  // A frame late: the selection strip gives the focus back to the text as it closes, after this box mounts.
  useEffect(() => {
    if (!autoFocus || !editor) return
    const frame = requestAnimationFrame(() => editor.commands.focus())
    return () => cancelAnimationFrame(frame)
  }, [autoFocus, editor])
  return <ComposeBox editor={editor} placeholder={<span>{placeholder}</span>} onSend={(ed) => onSend(storedFrom(ed.getJSON()))} />
}

/** One comment: the face and name, when (the date on hover), and what was said, drawn by the package's RichText. */
function CommentBody({ by, when, at, body }: { by: PersonId; when: string; at: string; body: Stored }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 text-body-2-strong text-text-primary">
          <Person name={PEOPLE[by].name} />
        </span>
        <WithTooltip inline label={at}>
          <span className="whitespace-nowrap text-caption text-text-muted">{when}</span>
        </WithTooltip>
      </div>
      <RichText blocks={toRenderTree(body.value, body.format)} renderReference={(uri) => <Reference uri={uri} />} />
    </div>
  )
}

/** What a thread is about, in one line; the whole quote on hover when it is cut. */
function AnchorLine({ thread, detached }: { thread: Thread; detached: boolean }) {
  if (!thread.anchor) return <p className="text-caption text-text-muted">On the whole document</p>
  if (detached) {
    // SPEC §13.6: a detached anchor is said, never shown as a comment on the whole document.
    return <p className="text-caption text-text-muted">{`On “${thread.anchor.quote}”, which has since been changed or deleted`}</p>
  }
  return (
    <WithTooltip label={thread.anchor.quote} wrapperClassName="min-w-0">
      <p className="truncate text-caption text-text-secondary">{`“${thread.anchor.quote}”`}</p>
    </WithTooltip>
  )
}

/** Resolve, as Peek has it: an icon button that turns green when pointed at. */
function ResolveButton({ onResolve }: { onResolve: () => void }) {
  return (
    <IconButton variant="resolve" tooltip="Resolve" aria-label="Resolve" onClick={onResolve}>
      <IconCircleCheck size={16} stroke={1.5} />
    </IconButton>
  )
}

/**
 * A thread, as a card in the comments column. Clicking it marks its words.
 * Stand-in: Peek's `ConversationCard` draws a thread for real; it is app-local.
 */
function ThreadCard({
  thread,
  detached,
  active,
  onActivate,
  onResolve,
  onReply,
}: {
  thread: Thread
  detached: boolean
  active?: boolean
  onActivate?: () => void
  onResolve?: () => void
  onReply?: (body: Stored) => void
}) {
  // Peek's ConversationCard rule: a click on a control inside is the control's, not the card's.
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, [role="button"], [data-interactive], [contenteditable="true"]')) return
    onActivate?.()
  }
  return (
    <Card data-thread-id={thread.id} hover="fill" quietUntilHover selected={active} onClick={onActivate ? click : undefined} className="flex shrink-0 flex-col gap-3 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <AnchorLine thread={thread} detached={detached} />
        </div>
        {onResolve && <ResolveButton onResolve={onResolve} />}
      </div>
      {thread.comments.map((c) => (
        <CommentBody key={c.id} by={c.by} when={c.when} at={c.at} body={c.body} />
      ))}
      {active && onReply && <Composer placeholder="Reply…" onSend={onReply} />}
    </Card>
  )
}

/** Placeholders shaped like a document: its title and its paragraphs, built from the bar. */
function DocumentSkeleton() {
  return (
    <div className="flex animate-skeleton-in flex-col gap-6" aria-hidden>
      <SkeletonBar className="h-6 w-64" />
      <div className="mt-6 flex flex-col gap-3">
        <SkeletonBar className="h-3.5 w-full" />
        <SkeletonBar className="h-3.5 w-11/12" />
        <SkeletonBar className="h-3.5 w-3/5" />
      </div>
      <div className="flex flex-col gap-3">
        <SkeletonBar className="h-3.5 w-full" />
        <SkeletonBar className="h-3.5 w-4/5" />
      </div>
    </div>
  )
}

/** Placeholders shaped like the column's cards. */
function ThreadsSkeleton() {
  return (
    <div className="flex animate-skeleton-in flex-col gap-3" aria-hidden>
      {[0, 1].map((i) => (
        <Card key={i} className="flex flex-col gap-3 p-3">
          <SkeletonBar className="h-3.5 w-40" />
          <SkeletonBar className="h-3.5 w-full" />
          <SkeletonBar className="h-3.5 w-2/3" />
        </Card>
      ))}
    </div>
  )
}

export interface DocumentPageProps {
  doc: Doc
  threads: Thread[]
  /** The comments column shown. */
  sidePanel: boolean
  onToggleSidePanel: () => void
  onRename: (title: string) => void
  /** Where a comment on words is read and written. */
  commentsIn?: CommentsIn
  /** A comment being written when the page opens. */
  initialDraft?: Draft
  /** A thread open when the page opens. */
  initialActive?: string | null
  loading?: boolean
}

/** One document: its header, the text, and its comments, in the column or in bubbles. */
export function DocumentPage({
  doc,
  threads: initialThreads,
  sidePanel,
  onToggleSidePanel,
  onRename,
  commentsIn = 'column',
  initialDraft = null,
  initialActive = null,
  loading,
}: DocumentPageProps) {
  const [threads, setThreads] = useState(initialThreads)
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [active, setActive] = useState<string | null>(initialActive)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [membersOpen, setMembersOpen] = useState(false)
  /** The highlight a bubble stands beside, read after the highlights are drawn. */
  const [bubbleAt, setBubbleAt] = useState<HTMLElement | null>(null)
  const docBody = useRef<HTMLDivElement>(null)
  const columnBody = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()
  const members = (Object.keys(PEOPLE) as PersonId[]).map((id) => ({ id, name: PEOPLE[id].name }))
  const editedBy = PEOPLE[doc.editedBy].name
  const bubbles = commentsIn === 'bubble'
  const title = doc.title || 'Untitled'

  const open = threads.filter((t) => !t.resolved)
  const resolved = threads.filter((t) => t.resolved)
  const detached = (t: Thread) => !!t.anchor && !!editor && commentRange(editor, { id: t.id, ...t.anchor }) === null

  // Draw every open comment on its words, and the draft's words while it is written.
  useEffect(() => {
    if (!editor) return
    const anchors: CommentAnchor[] = threads.flatMap((t) => (!t.resolved && t.anchor ? [{ id: t.id, ...t.anchor }] : []))
    if (draft) anchors.push({ id: DRAFT, ...draft })
    setCommentAnchors(editor, anchors, draft ? DRAFT : active)
    // The bubble stands beside the highlight just drawn: read it on the next frame.
    const frame = requestAnimationFrame(() => setBubbleAt(bubbles ? commentElement(editor, draft ? DRAFT : (active ?? '')) : null))
    return () => cancelAnimationFrame(frame)
  }, [editor, threads, draft, active, bubbles])

  // A thread chosen in the column: its words come into view. A highlight chosen in the text: its card does. Each Panel scrolls its own body.
  useEffect(() => {
    if (!active || !editor) return
    scrollWithin(docBody.current, commentElement(editor, active))
    scrollWithin(columnBody.current, columnBody.current?.querySelector<HTMLElement>(`[data-thread-id="${active}"]`) ?? null)
  }, [active, editor])

  const startComment = useCallback(
    (next: NonNullable<Draft>) => {
      setActive(null)
      setDraft(next)
      if (!bubbles && !sidePanel) onToggleSidePanel()
    },
    [bubbles, sidePanel, onToggleSidePanel],
  )
  const selectHighlight = useCallback((id: string) => {
    setDraft(null)
    setActive(id)
  }, [])
  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(
      () => showToast({ label: 'Link copied', type: 'success' }),
      () => showToast({ label: 'Could not copy the link', type: 'error' }),
    )
  }, [showToast])
  const send = (body: Stored, anchor: Draft = draft) => {
    const id = `t${Date.now()}`
    setThreads((all) => [...all, { id, doc: doc.id, anchor: anchor ?? undefined, comments: [{ id: `c${Date.now()}`, by: 'me', when: 'Just now', at: 'Just now', body }] }])
    setDraft(null)
    setActive(bubbles ? null : id)
  }
  const reply = (id: string, body: Stored) =>
    setThreads((all) => all.map((t) => (t.id === id ? { ...t, comments: [...t.comments, { id: `c${Date.now()}`, by: 'me', when: 'Just now', at: 'Just now', body }] } : t)))
  const resolve = (id: string) => {
    setThreads((all) => all.map((t) => (t.id === id ? { ...t, resolved: true } : t)))
    setActive(null)
  }

  const activeThread = open.find((t) => t.id === active)

  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      {/* Each panel in a column the row stretches to its height, as Peek's frame has them: a Panel alone grows with its content. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel
          title={
            <WithTooltip label={title} wrapperClassName="min-w-0 shrink">
              <p className="truncate text-body-2-strong text-text-primary">{title}</p>
            </WithTooltip>
          }
          actions={
            <div className="flex shrink-0 items-center gap-2">
              <MembersPill members={members.slice(0, 3)} count={members.length} onClick={() => setMembersOpen(true)} />
              <Toolbar aria-label="Document actions" surface={false}>
                <ToolbarButton tooltip={sidePanel ? 'Hide comments' : 'Show comments'} aria-label={sidePanel ? 'Hide comments' : 'Show comments'} pressed={sidePanel} onClick={onToggleSidePanel}>
                  <IconLayoutSidebarRight size={16} stroke={1.5} />
                </ToolbarButton>
                <ToolbarButton tooltip="Copy link" aria-label="Copy link" onClick={copyLink}>
                  <IconLink size={16} stroke={1.5} />
                </ToolbarButton>
              </Toolbar>
            </div>
          }
          bodyRef={docBody}
          bodyClassName="px-12 pt-10 pb-24"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col">
            {loading ? (
              <DocumentSkeleton />
            ) : (
              <>
                <h1 className="text-h1 text-text-primary">
                  <EditableText value={doc.title} placeholder="Untitled" label="Title" onCommit={(v) => (onRename(v), true)} className="-mx-2" />
                </h1>
                <p className="mt-2 text-caption text-text-muted">
                  {`${doc.folder} · `}
                  <WithTooltip inline label={doc.editedAt}>
                    <span>{`edited ${doc.edited}`}</span>
                  </WithTooltip>
                  {` by ${editedBy}`}
                </p>
                <DocumentEditor doc={doc} onReady={setEditor} onComment={startComment} onSelectHighlight={selectHighlight} onCopyLink={copyLink} />
              </>
            )}
          </div>
        </Panel>
      </div>

      {membersOpen && <MembersDialog members={members} count={members.length} onClose={() => setMembersOpen(false)} />}

      {/* Option B: the bubble on the words — a thread to read, or a comment to write. */}
      {bubbles && (
        <Popover
          anchor={bubbleAt}
          open={!!bubbleAt && (!!draft || !!activeThread)}
          onOpenChange={(next) => {
            if (next) return
            setDraft(null)
            setActive(null)
          }}
          side="bottom"
          align="left"
          ariaLabel={draft ? 'New comment' : 'Comment'}
          className="w-80"
          contentClassName="flex flex-col gap-3 p-3"
        >
          {draft ? (
            <Composer placeholder="Comment on these words…" onSend={(body) => send(body)} autoFocus />
          ) : activeThread ? (
            <>
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  {activeThread.comments.map((c) => (
                    <CommentBody key={c.id} by={c.by} when={c.when} at={c.at} body={c.body} />
                  ))}
                </div>
                <ResolveButton onResolve={() => resolve(activeThread.id)} />
              </div>
              <Composer placeholder="Reply…" onSend={(body) => reply(activeThread.id, body)} />
            </>
          ) : null}
        </Popover>
      )}

      {sidePanel && (
        <>
          <Divider orientation="vertical" />
          <div className="flex w-[380px] flex-none flex-col">
            <Panel
              title={
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-body-2-strong text-text-primary">Comments</p>
                  {!loading && open.length > 0 && <Chip type="neutral" label={String(open.length)} className="shrink-0" />}
                </div>
              }
              bodyRef={columnBody}
              bodyClassName="flex flex-col gap-3 p-3"
              footer={
                loading ? undefined : (
                  <div className="flex flex-col gap-2 p-3">
                    {!bubbles && draft && (
                      <div className="flex items-center gap-2">
                        <WithTooltip label={draft.quote} wrapperClassName="min-w-0 flex-1">
                          <p className="truncate text-caption text-text-secondary">{`On “${draft.quote}”`}</p>
                        </WithTooltip>
                        <IconButton tooltip="Comment on the whole document instead" aria-label="Comment on the whole document instead" onClick={() => setDraft(null)}>
                          <IconX size={16} stroke={1.5} />
                        </IconButton>
                      </div>
                    )}
                    <Composer
                      key={!bubbles && draft ? `${draft.block}:${draft.quote}` : 'document'}
                      placeholder={!bubbles && draft ? 'Comment on these words…' : 'Comment on this document…'}
                      // In bubbles, this box is for the whole document only.
                      onSend={(body) => send(body, bubbles ? null : draft)}
                      autoFocus={!bubbles && !!draft}
                    />
                  </div>
                )
              }
            >
              {loading ? (
                <ThreadsSkeleton />
              ) : open.length === 0 && resolved.length === 0 ? (
                <EmptyState scope="section" message="No comments yet. Select words and press Comment, or write below." />
              ) : (
                <>
                  {open.map((t) => (
                    <ThreadCard
                      key={t.id}
                      thread={t}
                      detached={detached(t)}
                      active={t.id === active}
                      onActivate={() => {
                        setDraft(null)
                        setActive(t.id === active ? null : t.id)
                      }}
                      onResolve={() => resolve(t.id)}
                      onReply={(body) => reply(t.id, body)}
                    />
                  ))}
                  {resolved.length > 0 && (
                    <CollapsibleSection title="Resolved" trailing={<Chip type="neutral" label={String(resolved.length)} />} defaultOpen={false} className="shrink-0" contentClassName="flex flex-col gap-3">
                      {resolved.map((t) => (
                        <ThreadCard key={t.id} thread={t} detached={detached(t)} />
                      ))}
                    </CollapsibleSection>
                  )}
                </>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
