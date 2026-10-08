import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  IconArchive,
  IconArrowsMove,
  IconCursorText,
  IconDotsVertical,
  IconHistory,
  IconLayoutSidebarRight,
  IconLink,
  IconMessage,
  IconMessagePlus,
  IconX,
} from '@tabler/icons-react'
import {
  Button,
  Card,
  Chip,
  CollapsibleSection,
  Divider,
  EditableText,
  EmptyState,
  Form,
  IconButton,
  KindIcon,
  MembersPill,
  Menu,
  MenuItem,
  MenuSeparator,
  Panel,
  Person,
  Popover,
  SkeletonBar,
  SkeletonList,
  Textarea,
  Toolbar,
  ToolbarButton,
  richTextClassName,
  type HandleBlock,
} from '@estiva-app/ui'
import {
  BlockId,
  CaptionedReference,
  CommentHighlights,
  EditorBlockHandle,
  KeptSelection,
  PersonMention,
  ReferenceTrigger,
  SelectionToolbar,
  SlashCommands,
  blockDropCursor,
  commentElement,
  commentRange,
  formatSection,
  quoteOfSelection,
  setCommentAnchors,
  typeTrigger,
  type BlockTurnInto,
  type CommentAnchor,
} from '@estiva-app/ui/editor'
import { MENTION_PEOPLE, PEOPLE, THINGS, kindOf, type Doc, type PersonId, type Thread } from './fixtures'

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

/** The icon each thing wears, from the package's one table: 14px in a chip, 16px in a row. */
const chipIcon = (uri: string | null) => {
  const kind = kindOf(uri)
  return kind ? <KindIcon kind={kind} size={14} tone="inherit" /> : undefined
}
const rowIcon = (uri: string) => {
  const kind = kindOf(uri)
  return kind ? <KindIcon kind={kind} /> : undefined
}

/**
 * Scroll the panel `el` sits in until it shows — that panel only. The browser's
 * own scrollIntoView also scrolls the frame around the panel, and the headers
 * left the screen (measured 9 October).
 */
function reveal(el: HTMLElement | null) {
  let box = el?.parentElement ?? null
  // The nearest box that scrolls at all is the panel's; when it has room, nothing moves.
  while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement
  if (!el || !box) return
  const at = el.getBoundingClientRect()
  const view = box.getBoundingClientRect()
  if (at.top < view.top) box.scrollBy({ top: at.top - view.top - 16, behavior: 'smooth' })
  else if (at.bottom > view.bottom) box.scrollBy({ top: at.bottom - view.bottom + 16, behavior: 'smooth' })
}

/**
 * The editor of one document: the package's block handle, `/`, `[`, `@`, the
 * selection strip with Comment in it, and comments drawn on their words.
 */
function DocumentEditor({
  doc,
  onReady,
  onComment,
  onSelectHighlight,
}: {
  doc: Doc
  onReady: (editor: Editor) => void
  onComment: (draft: NonNullable<Draft>) => void
  onSelectHighlight: (id: string) => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ dropcursor: blockDropCursor, link: { openOnClick: false } }),
      BlockId,
      KeptSelection,
      CommentHighlights,
      PersonMention.configure({ people: () => MENTION_PEOPLE }),
      CaptionedReference.configure({ icon: <KindIcon kind="file" size={14} tone="inherit" />, iconFor: chipIcon }),
      ReferenceTrigger.configure({
        items: () => THINGS,
        ariaLabel: 'Point at a file',
        sectionLabel: 'Files in your apps',
        icon: <KindIcon kind="file" />,
        iconFor: rowIcon,
        nodeName: 'captionedReference',
      }),
      SlashCommands.configure({
        sections: [
          formatSection('block'),
          {
            label: 'Insert',
            commands: [
              { key: 'insert-[', row: { label: 'A file from another app', shortcut: '[' }, run: typeTrigger('[') },
              { key: 'insert-@', row: { label: 'Mention', shortcut: '@' }, run: typeTrigger('@') },
            ],
          },
        ],
      }),
    ],
    content: doc.content,
    editorProps: { attributes: { class: richTextClassName('default', 'outline-none'), 'aria-label': 'Document' } },
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

  /** A whole block's words, as the document holds them: chips carry no words, so the page's text would not be found again. */
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

  const rows = (block: HandleBlock) => (
    <>
      <MenuItem
        label="Comment"
        leading={<IconMessage size={16} stroke={1.5} />}
        onClick={() => block.id && onComment({ block: block.id, quote: blockText(block.id) })}
      />
      <MenuItem label="Copy link" leading={<IconLink size={16} stroke={1.5} />} />
    </>
  )

  return (
    <>
      <EditorBlockHandle editor={editor} turnInto={TURN_INTO} actions={rows} className="mt-8">
        <EditorContent editor={editor} />
      </EditorBlockHandle>
      <SelectionToolbar
        editor={editor}
        marks={['bold', 'italic', 'underline', 'code']}
        link
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

/** One comment: the face and name, when, and what was said. */
function CommentBody({ by, when, text }: { by: PersonId; when: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-body-2-strong text-text-primary">
          <Person name={PEOPLE[by].name} />
        </span>
        <span className="text-caption text-text-muted">{when}</span>
      </div>
      <p className="text-body-2 text-text-primary">{text}</p>
    </div>
  )
}

/** The box a comment or a reply is written in: one field, and its buttons. */
function Composer({
  placeholder,
  send,
  onSend,
  onCancel,
  autoFocus,
}: {
  placeholder: string
  send: string
  onSend: (text: string) => void
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  // A frame late: the selection strip gives the focus back to the text as it closes, after this box mounts.
  useEffect(() => {
    if (!autoFocus) return
    const frame = requestAnimationFrame(() => field.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [autoFocus])
  return (
    <Form
      layout="free"
      className="flex flex-col gap-2"
      onSubmit={() => {
        if (!text.trim()) return
        onSend(text.trim())
        setText('')
      }}
    >
      <Textarea ref={field} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button size="small" variant="muted" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="small" variant="primary" type="submit" disabledReason={text.trim() ? undefined : 'Write something first'}>
          {send}
        </Button>
      </div>
    </Form>
  )
}

/** What a thread is about, said in one line over its comments. */
function AnchorLine({ thread, detached }: { thread: Thread; detached: boolean }) {
  if (!thread.anchor) return <p className="text-caption text-text-muted">On the whole document</p>
  if (detached) {
    // SPEC §13.6: a detached anchor is said, never shown as a comment on the whole document.
    return <p className="text-caption text-text-muted">{`On “${thread.anchor.quote}”, which has since been changed or deleted`}</p>
  }
  return <p className="line-clamp-2 text-caption text-text-secondary">{`“${thread.anchor.quote}”`}</p>
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
  onReply?: (text: string) => void
}) {
  return (
    <Card data-thread-id={thread.id} selected={active} onClick={onActivate} className="flex flex-col gap-3 p-3">
      <AnchorLine thread={thread} detached={detached} />
      {thread.comments.map((c) => (
        <CommentBody key={c.id} by={c.by} when={c.when} text={c.text} />
      ))}
      {active && onReply && (
        // A press inside the box must not reach the card's own click.
        <div onClickCapture={(e) => e.stopPropagation()}>
          <Composer placeholder="Reply…" send="Reply" onSend={onReply} />
        </div>
      )}
      {onResolve && (
        <div className="flex items-center gap-2">
          <Button
            size="small"
            variant="resolve"
            onClick={(e) => {
              e.stopPropagation()
              onResolve()
            }}
          >
            Resolve
          </Button>
        </div>
      )}
    </Card>
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
  /** The highlight a bubble stands beside, read after the highlights are drawn. */
  const [bubbleAt, setBubbleAt] = useState<HTMLElement | null>(null)
  const members = [PEOPLE.ana, PEOPLE.ravi, PEOPLE.mia, PEOPLE.me]
  const editedBy = PEOPLE[doc.editedBy].name
  const bubbles = commentsIn === 'bubble'

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

  // A thread chosen in the column: bring its words into view. A highlight chosen in the text: bring its card into view.
  useEffect(() => {
    if (!active || !editor) return
    reveal(commentElement(editor, active))
    reveal(document.querySelector<HTMLElement>(`[data-thread-id="${active}"]`))
  }, [active, editor])

  const startComment = (next: NonNullable<Draft>) => {
    setActive(null)
    setDraft(next)
    if (!bubbles && !sidePanel) onToggleSidePanel()
  }
  const send = (text: string, anchor: Draft = draft) => {
    const id = `t${Date.now()}`
    setThreads((all) => [...all, { id, doc: doc.id, anchor: anchor ?? undefined, comments: [{ id: `c${Date.now()}`, by: 'me', when: 'Just now', text }] }])
    setDraft(null)
    setActive(bubbles ? null : id)
  }
  const reply = (id: string, text: string) =>
    setThreads((all) => all.map((t) => (t.id === id ? { ...t, comments: [...t.comments, { id: `c${Date.now()}`, by: 'me', when: 'Just now', text }] } : t)))
  const resolve = (id: string) => {
    setThreads((all) => all.map((t) => (t.id === id ? { ...t, resolved: true } : t)))
    setActive(null)
  }

  const selectHighlight = useCallback((id: string) => {
    setDraft(null)
    setActive(id)
  }, [])

  const activeThread = open.find((t) => t.id === active)

  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      {/* Each panel in a column the row stretches to its height, as Peek's frame has them: a Panel alone grows with its content. */}
      <div className="flex min-w-0 flex-1 flex-col">
      <Panel
        title={<p className="truncate text-body-2-strong text-text-primary">{doc.title || 'Untitled'}</p>}
        actions={
          <div className="flex shrink-0 items-center gap-2">
            <MembersPill members={members} />
            <Toolbar aria-label="Document actions" surface={false}>
              <ToolbarButton tooltip={sidePanel ? 'Hide comments' : 'Show comments'} aria-label={sidePanel ? 'Hide comments' : 'Show comments'} pressed={sidePanel} onClick={onToggleSidePanel}>
                <IconLayoutSidebarRight size={16} stroke={1.5} />
              </ToolbarButton>
              <ToolbarButton tooltip="Copy link" aria-label="Copy link">
                <IconLink size={16} stroke={1.5} />
              </ToolbarButton>
              <Menu
                align="right"
                trigger={
                  <ToolbarButton tooltip="More actions" aria-label="More actions">
                    <IconDotsVertical size={16} stroke={1.5} />
                  </ToolbarButton>
                }
              >
                <MenuItem label="Rename" leading={<IconCursorText size={16} stroke={1.5} />} />
                <MenuItem label="Move to…" leading={<IconArrowsMove size={16} stroke={1.5} />} />
                <MenuItem label="Version history" leading={<IconHistory size={16} stroke={1.5} />} />
                <MenuSeparator />
                <MenuItem label="Archive" leading={<IconArchive size={16} stroke={1.5} />} />
              </Menu>
            </Toolbar>
          </div>
        }
        bodyClassName="px-12 pt-10 pb-24"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          {loading ? (
            <div className="flex flex-col gap-4">
              <SkeletonBar className="h-8 w-64" />
              <SkeletonList rows={6} />
            </div>
          ) : (
            <>
              <h1 className="text-h1 text-text-primary">
                <EditableText value={doc.title} placeholder="Untitled" label="Title" onCommit={(v) => (onRename(v), true)} className="-mx-2" />
              </h1>
              <p className="mt-2 text-caption text-text-muted">{`${doc.folder} · edited ${doc.edited} by ${editedBy}`}</p>
              <DocumentEditor doc={doc} onReady={setEditor} onComment={startComment} onSelectHighlight={selectHighlight} />
              {doc.content.content?.length === 1 && !doc.content.content[0].content && (
                <p className="mt-2 text-caption text-text-muted">Type / for headings, lists and links to other apps. [ points at a file, @ names someone.</p>
              )}
            </>
          )}
        </div>
      </Panel>
      </div>

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
            <Composer placeholder="Comment on these words…" send="Comment" onSend={(text) => send(text)} onCancel={() => setDraft(null)} autoFocus />
          ) : activeThread ? (
            <>
              {activeThread.comments.map((c) => (
                <CommentBody key={c.id} by={c.by} when={c.when} text={c.text} />
              ))}
              <Composer placeholder="Reply…" send="Reply" onSend={(text) => reply(activeThread.id, text)} />
              <Divider />
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption text-text-muted">{`${activeThread.comments.length} ${activeThread.comments.length === 1 ? 'comment' : 'comments'}`}</span>
                <Button size="small" variant="resolve" onClick={() => resolve(activeThread.id)}>
                  Resolve
                </Button>
              </div>
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
            bodyClassName="flex flex-col gap-3 p-3"
            footer={
              loading ? undefined : (
                <div className="flex flex-col gap-2 p-3">
                  {!bubbles && draft && (
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-caption text-text-secondary">{`On “${draft.quote}”`}</p>
                      <IconButton tooltip="Comment on the whole document instead" aria-label="Comment on the whole document instead" onClick={() => setDraft(null)}>
                        <IconX size={16} stroke={1.5} />
                      </IconButton>
                    </div>
                  )}
                  <Composer
                    key={!bubbles && draft ? `${draft.block}:${draft.quote}` : 'document'}
                    placeholder={!bubbles && draft ? 'Comment on these words…' : 'Comment on this document…'}
                    send="Comment"
                    // In bubbles, this box is for the whole document only.
                    onSend={(text) => send(text, bubbles ? null : draft)}
                    autoFocus={!bubbles && !!draft}
                  />
                </div>
              )
            }
          >
            {loading ? (
              <SkeletonList rows={4} />
            ) : open.length === 0 && resolved.length === 0 ? (
              <EmptyState scope="section" icon={<IconMessage size={20} stroke={1.5} />} message="No comments yet. Select words and press Comment, or write below." />
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
                    onReply={(text) => reply(t.id, text)}
                  />
                ))}
                {resolved.length > 0 && (
                  <CollapsibleSection title="Resolved" trailing={<Chip type="neutral" label={String(resolved.length)} />} defaultOpen={false} contentClassName="flex flex-col gap-3">
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
