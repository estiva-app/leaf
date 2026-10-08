import { useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
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
  IconButton,
  KindIcon,
  MembersPill,
  Menu,
  MenuItem,
  MenuSeparator,
  Panel,
  Person,
  SkeletonBar,
  SkeletonList,
  Textarea,
  Toolbar,
  ToolbarButton,
  Form,
  richTextClassName,
  type HandleBlock,
} from '@estiva-app/ui'
import {
  BlockId,
  CaptionedReference,
  EditorBlockHandle,
  KeptSelection,
  PersonMention,
  ReferenceTrigger,
  SelectionToolbar,
  SlashCommands,
  blockDropCursor,
  formatSection,
  typeTrigger,
  type BlockTurnInto,
} from '@estiva-app/ui/editor'
import { MENTION_PEOPLE, PEOPLE, THINGS, kindOf, type Doc, type Thread } from './fixtures'

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

/** The editor of one document: the package's block handle, `/`, `[`, `@` and the selection strip. */
function DocumentEditor({ doc, onComment }: { doc: Doc; onComment: (block: HandleBlock) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ dropcursor: blockDropCursor, link: { openOnClick: false } }),
      BlockId,
      KeptSelection,
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

  const rows = (block: HandleBlock) => (
    <>
      <MenuItem label="Comment" leading={<IconMessage size={16} stroke={1.5} />} onClick={() => onComment(block)} />
      <MenuItem label="Copy link" leading={<IconLink size={16} stroke={1.5} />} />
    </>
  )

  return (
    <>
      <EditorBlockHandle editor={editor} turnInto={TURN_INTO} actions={rows} className="mt-8">
        <EditorContent editor={editor} />
      </EditorBlockHandle>
      <SelectionToolbar editor={editor} marks={['bold', 'italic', 'underline', 'code']} link />
    </>
  )
}

/** One comment: the face and name, when, and what was said. */
function CommentBody({ by, when, text }: { by: keyof typeof PEOPLE; when: string; text: string }) {
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

/**
 * A thread, as a card in the comments column.
 * Stand-in: Peek's `ConversationCard` draws a thread for real; it is app-local.
 */
function ThreadCard({ thread, onResolve }: { thread: Thread; onResolve?: () => void }) {
  return (
    <Card className="flex flex-col gap-3 p-3">
      <p className="line-clamp-2 text-caption text-text-secondary">{thread.block ? `“${thread.block.quote}”` : 'On the whole document'}</p>
      {thread.comments.map((c) => (
        <CommentBody key={c.id} by={c.by} when={c.when} text={c.text} />
      ))}
      {onResolve && (
        <div className="flex items-center gap-2">
          <Button size="small" variant="muted">
            Reply
          </Button>
          <Button size="small" variant="resolve" onClick={onResolve}>
            Resolve
          </Button>
        </div>
      )}
    </Card>
  )
}

/** The column beside the document: its threads, and a box to start one. */
function CommentsPanel({
  threads,
  draft,
  onDropDraft,
  onSend,
  onResolve,
  loading,
}: {
  threads: Thread[]
  draft: { id: string; quote: string } | null
  onDropDraft: () => void
  onSend: (text: string) => void
  onResolve: (id: string) => void
  loading?: boolean
}) {
  const [text, setText] = useState('')
  const open = threads.filter((t) => !t.resolved)
  const resolved = threads.filter((t) => t.resolved)

  return (
    <Panel
      className="w-[380px] flex-none"
      title={
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-body-2-strong text-text-primary">Comments</p>
          {!loading && open.length > 0 && <Chip type="neutral" label={String(open.length)} className="shrink-0" />}
        </div>
      }
      bodyClassName="flex flex-col gap-3 p-3"
      footer={
        loading ? undefined : (
        <Form
          layout="free"
          className="flex flex-col gap-2 p-3"
          onSubmit={() => {
            if (!text.trim()) return
            onSend(text.trim())
            setText('')
          }}
        >
          {draft && (
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-caption text-text-secondary">{`On “${draft.quote}”`}</p>
              <IconButton tooltip="Comment on the whole document instead" aria-label="Comment on the whole document instead" onClick={onDropDraft}>
                <IconX size={16} stroke={1.5} />
              </IconButton>
            </div>
          )}
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={draft ? 'Comment on this block…' : 'Comment on this document…'}
            aria-label="Comment"
            autoFocus={!!draft}
          />
          <div className="flex justify-end">
            <Button size="small" variant="primary" type="submit" disabled={!text.trim()} disabledReason="Write something first">
              Comment
            </Button>
          </div>
        </Form>
        )
      }
    >
      {loading ? (
        <SkeletonList rows={4} />
      ) : open.length === 0 && resolved.length === 0 ? (
        <EmptyState scope="section" icon={<IconMessage size={20} stroke={1.5} />} message="No comments yet. Open a block's handle and choose Comment, or write below." />
      ) : (
        <>
          {open.map((t) => (
            <ThreadCard key={t.id} thread={t} onResolve={() => onResolve(t.id)} />
          ))}
          {resolved.length > 0 && (
            <CollapsibleSection title="Resolved" trailing={<Chip type="neutral" label={String(resolved.length)} />} defaultOpen={false} contentClassName="flex flex-col gap-3">
              {resolved.map((t) => (
                <ThreadCard key={t.id} thread={t} />
              ))}
            </CollapsibleSection>
          )}
        </>
      )}
    </Panel>
  )
}

export interface DocumentPageProps {
  doc: Doc
  threads: Thread[]
  /** The comments column shown. */
  sidePanel: boolean
  onToggleSidePanel: () => void
  onRename: (title: string) => void
  /** A block the person is commenting on, its draft open in the column. */
  initialDraft?: { id: string; quote: string } | null
  loading?: boolean
}

/** One document: its header, the text, and the comments column beside it. */
export function DocumentPage({ doc, threads: initialThreads, sidePanel, onToggleSidePanel, onRename, initialDraft = null, loading }: DocumentPageProps) {
  const [threads, setThreads] = useState(initialThreads)
  const [draft, setDraft] = useState(initialDraft)
  const members = [PEOPLE.ana, PEOPLE.ravi, PEOPLE.mia, PEOPLE.me]
  const editor = PEOPLE[doc.editedBy].name

  const comment = (block: HandleBlock) => {
    setDraft({ id: block.id ?? '', quote: block.element.textContent ?? '' })
    if (!sidePanel) onToggleSidePanel()
  }

  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <Panel
        className="min-w-0 flex-1"
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
              <p className="mt-2 text-caption text-text-muted">{`${doc.folder} · edited ${doc.edited} by ${editor}`}</p>
              <DocumentEditor doc={doc} onComment={comment} />
              {doc.content.content?.length === 1 && !doc.content.content[0].content && (
                <p className="mt-2 text-caption text-text-muted">Type / for headings, lists and links to other apps. [ points at a file, @ names someone.</p>
              )}
            </>
          )}
        </div>
      </Panel>
      {sidePanel && (
        <>
          <Divider orientation="vertical" />
          <CommentsPanel
            loading={loading}
            threads={threads}
            draft={draft}
            onDropDraft={() => setDraft(null)}
            onSend={(text) => {
              setThreads((all) => [
                ...all,
                { id: `t${all.length + 1}`, doc: doc.id, block: draft ?? undefined, comments: [{ id: `c${Date.now()}`, by: 'me', when: 'Just now', text }] },
              ])
              setDraft(null)
            }}
            onResolve={(id) => setThreads((all) => all.map((t) => (t.id === id ? { ...t, resolved: true } : t)))}
          />
        </>
      )}
    </div>
  )
}
