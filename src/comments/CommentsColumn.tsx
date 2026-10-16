import { useCallback, useEffect, useMemo, useState, type MouseEvent, type RefObject } from 'react'
import { useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { IconArrowBackUp, IconCircleCheck, IconX } from '@tabler/icons-react'
import { contentFormatOf, toRenderTree } from '@estiva-app/protocol'
import { Card, Chip, CollapsibleSection, EmptyState, FieldLine, IconButton, Panel, Person, RichText, SkeletonList, WithTooltip, useToast } from '@estiva-app/ui'
import { ComposeBox, ComposeKeys, COMPOSE_EDITOR_CLASSES, commentElement, commentPlace, quoteText, setCommentAnchors, type CommentAnchor, type CommentPlace } from '@estiva-app/ui/editor'
import { nameOf } from '../document/save'
import { exactly, whenOf } from '../home/recent'
import { postComment, postReply, setResolved, type Commented, type CommentItem, type Thread, type WriteResult } from './comments'
import { useThreads } from './useThreads'

/**
 * A document's comments, in the column beside its text — Katerina's option A
 * (leaf `proto/leaf-app`), drawn as the text-comments concept story draws it
 * (estiva-ui `concept/text-comments`; Miky, 16 October: build it as drawn).
 *
 * A card per thread, in the order of the text; the whole document's last; a
 * thread whose blocks are all gone in its own "On deleted blocks" section,
 * never among the whole document's (SPEC §13.6); resolved ones closed under
 * "Resolved". A card and its blocks mark each other: choosing one shows the
 * other.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-comment-points-at-blocks-and-the-words-quoted.md
 */

/** The draft's highlight id, so the block being commented on stays marked while you write. */
const DRAFT = 'draft'

/** A tooltip's wrapper around a line that is cut: it must shrink with its row. */
const LINE_WRAPPER = 'flex min-w-0 shrink'

/** What one block is called in a card's line: "On 2 paragraphs". */
function blockNoun(type: string, many: boolean): string {
  const nouns: Record<string, [string, string]> = {
    paragraph: ['paragraph', 'paragraphs'],
    heading: ['heading', 'headings'],
    listItem: ['item', 'items'],
    bulletList: ['list', 'lists'],
    orderedList: ['list', 'lists'],
    table: ['table', 'tables'],
  }
  const [one, more] = nouns[type] ?? ['block', 'blocks']
  return many ? more : one
}

/** "On the paragraph", "On 2 paragraphs", "On 3 blocks": a comment on whole blocks, said in a line. */
function wholeBlocksLine(editor: Editor | null, place: CommentPlace): string {
  if (!editor || place.state === 'detached') return 'On whole blocks'
  const types: string[] = []
  editor.state.doc.nodesBetween(place.from, place.to, (node, pos) => {
    if (pos < place.from || pos + node.nodeSize > place.to) return true
    types.push(node.type.name)
    return false
  })
  if (types.length === 0) return 'On whole blocks'
  if (types.length === 1) return `On the ${blockNoun(types[0], false)}`
  return `On ${types.length} ${types.every((t) => t === types[0]) ? blockNoun(types[0], true) : 'blocks'}`
}

/** The names of the people in the column, from their profiles. */
function useNames(pubkeys: readonly string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})
  const key = [...new Set(pubkeys)].sort().join(',')
  useEffect(() => {
    let live = true
    const wanted = key ? key.split(',') : []
    void Promise.all(wanted.map(async (pk) => [pk, await nameOf(pk).catch(() => null)] as const)).then((found) => {
      if (!live) return
      setNames(Object.fromEntries(found.flatMap(([pk, name]) => (name ? [[pk, name]] : []))))
    })
    return () => {
      live = false
    }
  }, [key])
  return names
}

/**
 * The box a comment or a reply is written in: the package's ComposeBox. It
 * empties as you send; a refused send puts your text back and says so (record
 * a-refused-action-is-undone-and-your-text-comes-back).
 */
function Composer({ placeholder, onSend, autoFocus }: { placeholder: string; onSend: (text: string) => Promise<WriteResult>; autoFocus?: boolean }) {
  const [refused, setRefused] = useState<string | null>(null)
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false }), ComposeKeys],
    editorProps: { attributes: { class: COMPOSE_EDITOR_CLASSES, 'aria-label': placeholder } },
  })
  // A frame late: the block menu gives the focus back to the text as it closes, after this box mounts.
  useEffect(() => {
    if (!autoFocus || !editor) return
    const frame = requestAnimationFrame(() => editor.commands.focus())
    return () => cancelAnimationFrame(frame)
  }, [autoFocus, editor])
  const send = (ed: Editor) => {
    const text = ed.getText({ blockSeparator: '\n' }).trim()
    if (!text) return false
    const json = ed.getJSON()
    setRefused(null)
    void onSend(text).then((result) => {
      if (result.ok || ed.isDestroyed) return
      if (ed.isEmpty) ed.commands.setContent(json)
      setRefused(result.reason)
    })
  }
  return (
    <div className="flex flex-col gap-1">
      <ComposeBox editor={editor} placeholder={<span>{placeholder}</span>} onSend={send} />
      {refused && <FieldLine tone="error">{refused}</FieldLine>}
    </div>
  )
}

/** Where a thread is now: its §13.6 state, from the editor's text. `unaddressable`: the document is not a block document. */
type Where = CommentPlace | { state: 'unaddressable' } | null

/** What a thread is about, in one line — the one place its states differ on a card. */
function AnchorLine({ thread, where, editor, names }: { thread: Thread; where: Where; editor: Editor | null; names: Record<string, string> }) {
  if (!thread.blocks || !where) return <p className="text-caption text-text-muted">On the whole document</p>
  if (where.state === 'unaddressable') return <p data-anchor-state="unaddressable" className="text-caption italic text-text-muted">On a part of this document, which has no parts</p>
  const quoted = thread.quote ? `“${quoteText(thread.quote)}”` : null
  const by = names[thread.root.by] ?? 'Someone'
  if (where.state === 'reworded' || (where.state === 'detached' && quoted)) {
    // §13.6 reworded, and detached with words: the words as the commenter quoted them, never as what the page says (Miky, LEAF-7 /land).
    const gone = where.state === 'reworded' ? 'No longer in the text' : 'Deleted from the page'
    return (
      <WithTooltip label={`${by} quoted: ${quoted}`} wrapperClassName={LINE_WRAPPER}>
        <p data-anchor-state={where.state} className="line-clamp-2 text-caption italic text-text-muted">{`${by} quoted: ${quoted} · ${gone}`}</p>
      </WithTooltip>
    )
  }
  if (where.state === 'detached') return <p data-anchor-state="detached" className="text-caption italic text-text-muted">On blocks deleted from the page</p>
  if (!quoted) return <p data-anchor-state="blocks" className="text-caption text-text-secondary">{wholeBlocksLine(editor, where)}</p>
  return (
    <WithTooltip label={quoted} wrapperClassName={LINE_WRAPPER}>
      <p data-anchor-state="words" className="truncate text-caption text-text-secondary">{quoted}</p>
    </WithTooltip>
  )
}

/** One comment or reply in a card: who, when, and the text. */
function CommentLine({ comment, names, now }: { comment: CommentItem; names: Record<string, string>; now: number }) {
  const blocks = useMemo(() => toRenderTree(comment.body, contentFormatOf(comment.event)), [comment])
  return (
    <div data-comment-id={comment.id} className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 text-body-2-strong text-text-primary">
          <Person name={names[comment.by] ?? 'Someone'} />
        </span>
        <WithTooltip label={exactly(comment.at * 1000)}>
          <span className="whitespace-nowrap text-caption text-text-muted">{whenOf(comment.at * 1000, now)}</span>
        </WithTooltip>
      </div>
      <RichText blocks={blocks} size="small" />
    </div>
  )
}

/** A thread as a card in the column. Clicking it finds its place in the text; open, it takes a reply. */
function ThreadCard({
  thread,
  where,
  editor,
  names,
  now,
  active,
  onActivate,
  onResolve,
  onReply,
}: {
  thread: Thread
  where: Where
  editor: Editor | null
  names: Record<string, string>
  now: number
  active: boolean
  onActivate: () => void
  onResolve: (resolved: boolean) => void
  onReply: (text: string) => Promise<WriteResult>
}) {
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, [role="button"], [data-interactive], [contenteditable="true"]')) return
    onActivate()
  }
  return (
    <Card data-thread-id={thread.id} data-active={active || undefined} data-resolved={thread.resolved || undefined} hover="fill" quietUntilHover selected={active} onClick={click} className="flex shrink-0 flex-col gap-3 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <AnchorLine thread={thread} where={where} editor={editor} names={names} />
        </div>
        {thread.resolved ? (
          <IconButton tooltip="Reopen" aria-label="Reopen" onClick={() => onResolve(false)}>
            <IconArrowBackUp size={16} stroke={1.5} />
          </IconButton>
        ) : (
          <IconButton variant="resolve" tooltip="Resolve" aria-label="Resolve" onClick={() => onResolve(true)}>
            <IconCircleCheck size={16} stroke={1.5} />
          </IconButton>
        )}
      </div>
      {[thread.root, ...thread.replies].map((c) => (
        <CommentLine key={c.id} comment={c} names={names} now={now} />
      ))}
      {active && !thread.resolved && <Composer placeholder="Reply…" onSend={onReply} />}
    </Card>
  )
}

/** Scroll `box` — a Panel's body — until `el` shows. Only that box moves. */
function scrollWithin(box: HTMLElement | null, el: Element | null) {
  if (!box || !el) return
  const at = el.getBoundingClientRect()
  const view = box.getBoundingClientRect()
  if (at.top < view.top) box.scrollBy({ top: at.top - view.top - 16 })
  else if (at.bottom > view.bottom) box.scrollBy({ top: at.bottom - view.bottom + 16 })
}

const anchorOf = (t: Thread): CommentAnchor | null => (t.blocks ? { id: t.id, blocks: t.blocks, ...(t.quote ? { quote: t.quote } : {}) } : null)

/** The column's props: the document, its editor, and the block a handle's Comment started a comment on. */
export interface CommentsColumnProps {
  doc: Partial<Commented>
  /** Whether the document's text is a block document, which is what a block can be found in (§13.6). */
  addressable: boolean
  editor: Editor | null
  /** The document's scrolling body, to bring a chosen comment's blocks into view. */
  docBody: RefObject<HTMLDivElement | null>
  /** The block a comment is being written on, from its handle; `null` for the whole document. */
  draft: string | null
  onDraft: (blockId: string | null) => void
}

/** The comments column of a Leaf document. */
export function CommentsColumn({ doc, addressable, editor, docBody, draft, onDraft }: CommentsColumnProps) {
  const { threads, failed, readAt, reread } = useThreads(doc)
  const { showToast } = useToast()
  const [active, setActive] = useState<string | null>(null)
  const [columnBody, setColumnBody] = useState<HTMLDivElement | null>(null)
  // Every change to the text re-reads where each comment is: someone else's save as much as your typing.
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!editor) return
    const changed = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) setVersion((v) => v + 1)
    }
    editor.on('transaction', changed)
    return () => {
      editor.off('transaction', changed)
    }
  }, [editor])

  const all = useMemo(() => threads ?? [], [threads])
  const names = useNames(all.flatMap((t) => [t.root.by, ...t.replies.map((r) => r.by)]))

  const places = useMemo(() => {
    const map = new Map<string, Where>()
    for (const t of all) {
      const anchor = anchorOf(t)
      map.set(t.id, !anchor ? null : !addressable ? { state: 'unaddressable' } : editor && version >= 0 ? commentPlace(editor, anchor) : null)
    }
    return map
  }, [all, editor, addressable, version])
  const whereOf = (t: Thread): Where => places.get(t.id) ?? null

  // Open threads in the order of the text; the whole document's last; deleted ones in their own section.
  const at = (t: Thread) => {
    const where = whereOf(t)
    return where && 'from' in where ? where.from : Number.MAX_SAFE_INTEGER
  }
  const open = all.filter((t) => !t.resolved && whereOf(t)?.state !== 'detached').sort((a, b) => at(a) - at(b))
  const deleted = all.filter((t) => !t.resolved && whereOf(t)?.state === 'detached')
  const resolved = all.filter((t) => t.resolved)

  // A highlight clicked in the text: its thread.
  useEffect(() => {
    if (!editor) return
    const select = ({ id }: { id: string }) => {
      if (id === DRAFT) return
      onDraft(null)
      setActive(id)
    }
    editor.on('commentSelect', select)
    return () => {
      editor.off('commentSelect', select)
    }
  }, [editor, onDraft])

  // Draw every open comment on its blocks, and the draft's block while it is written.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const anchors = addressable ? all.flatMap((t) => (t.resolved ? [] : [anchorOf(t)].filter((a): a is CommentAnchor => !!a))) : []
    if (draft) anchors.push({ id: DRAFT, blocks: [draft] })
    setCommentAnchors(editor, anchors, draft ? DRAFT : active)
  }, [editor, all, draft, active, addressable])

  // A card chosen: its blocks come into view. A highlight chosen: its card does.
  useEffect(() => {
    if (!active || !editor) return
    const thread = all.find((t) => t.id === active)
    const anchor = thread && anchorOf(thread)
    const frame = requestAnimationFrame(() => {
      if (anchor && addressable) scrollWithin(docBody.current, commentElement(editor, anchor))
      scrollWithin(columnBody, columnBody?.querySelector(`[data-thread-id="${active}"]`) ?? null)
    })
    return () => cancelAnimationFrame(frame)
  }, [active, editor, all, docBody, columnBody, addressable])

  const { address, folder } = doc
  const commented = useMemo(() => (address && folder ? { address, folder } : null), [address, folder])
  const send = useCallback(
    async (text: string): Promise<WriteResult> => {
      if (!commented) return { ok: false, reason: 'This document cannot take comments from here.' }
      const result = await postComment(commented, text, draft ?? undefined)
      if (result.ok) {
        onDraft(null)
        reread()
      }
      return result
    },
    [commented, draft, onDraft, reread],
  )
  const reply = async (thread: Thread, text: string): Promise<WriteResult> => {
    if (!commented) return { ok: false, reason: 'This document cannot take comments from here.' }
    const result = await postReply(commented, thread, text)
    if (result.ok) reread()
    return result
  }
  const resolve = async (thread: Thread, next: boolean) => {
    if (!commented) return
    const result = await setResolved(commented, thread, next)
    if (!result.ok) {
      showToast({ label: result.reason, type: 'error' })
      return
    }
    if (next && active === thread.id) setActive(null)
    reread()
  }

  const draftPlace = editor && draft ? commentPlace(editor, { id: DRAFT, blocks: [draft] }) : null
  const draftLine = draftPlace ? wholeBlocksLine(editor, draftPlace) : ''

  const card = (t: Thread) => (
    <ThreadCard
      key={t.id}
      thread={t}
      where={whereOf(t)}
      editor={editor}
      names={names}
      now={readAt}
      // A handle's Comment: the draft takes over from the open card.
      active={!draft && t.id === active}
      onActivate={() => {
        onDraft(null)
        setActive(t.id === active ? null : t.id)
      }}
      onResolve={(next) => void resolve(t, next)}
      onReply={(text) => reply(t, text)}
    />
  )

  return (
    <Panel
      title={
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-body-2-strong text-text-primary">Comments</p>
          {open.length > 0 && <Chip type="neutral" label={String(open.length)} className="shrink-0" />}
        </div>
      }
      bodyRef={setColumnBody}
      bodyClassName="flex flex-col gap-3 p-3"
      footer={
        <div className="flex flex-col gap-2 p-3">
          {draft && (
            <div className="flex items-center gap-2">
              <WithTooltip label={draftLine} wrapperClassName={`${LINE_WRAPPER} flex-1`}>
                <p data-draft-line className="truncate text-caption text-text-secondary">{draftLine}</p>
              </WithTooltip>
              <IconButton tooltip="Comment on the whole document instead" aria-label="Comment on the whole document instead" onClick={() => onDraft(null)}>
                <IconX size={16} stroke={1.5} />
              </IconButton>
            </div>
          )}
          <Composer key={draft ?? 'document'} placeholder={draft ? 'Comment on this block…' : 'Comment on this document…'} onSend={send} autoFocus={!!draft} />
        </div>
      }
    >
      {threads === null ? (
        failed ? (
          <EmptyState scope="section" message="Could not read the comments. Try again in a moment." />
        ) : (
          <SkeletonList rows={2} />
        )
      ) : all.length === 0 ? (
        <EmptyState scope="section" message="No comments yet. Use Comment on a block's handle, or write below." />
      ) : (
        <>
          {open.map(card)}
          {deleted.length > 0 && (
            <CollapsibleSection title="On deleted blocks" trailing={<Chip type="neutral" label={String(deleted.length)} />} defaultOpen={false} className="shrink-0" contentClassName="flex flex-col gap-3">
              {deleted.map(card)}
            </CollapsibleSection>
          )}
          {resolved.length > 0 && (
            <CollapsibleSection title="Resolved" trailing={<Chip type="neutral" label={String(resolved.length)} />} defaultOpen={false} className="shrink-0" contentClassName="flex flex-col gap-3">
              {resolved.map(card)}
            </CollapsibleSection>
          )}
        </>
      )}
    </Panel>
  )
}
