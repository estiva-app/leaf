import { useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import type { LauncherContext, LauncherMessage } from '@estiva-app/launcher'
import type { Thread } from '../comments/comments'
import { knownName } from '../comments/people'

/*
  KIN-5 — what ⌘K asks about in Leaf: the page that is open. Its passages are its blocks as the editor holds them now
  (typing not yet saved included), then every comment on it, a resolved thread's marked (Miky, KIN-5 kickoff). The page
  puts itself here while it is drawn, and the comments column its threads; the box reads it when it is opened.
*/

/** What the open page lets the box do: put an answer in a new comment, or into the page; show a part it cites. */
export interface OpenPageActions {
  /** Whether a new comment can be written on it (not archived, an address to comment on). */
  canComment: boolean
  /** Whether its text can be changed by you now. */
  canEdit: boolean
  /** Bring the comments column into view, when it was hidden. */
  showComments: () => void
  /** A new comment on these blocks (or the whole page), holding the text, for the person to edit and send. */
  draftComment: (text: string, blocks: string[] | null) => boolean
  /** The text as a new block under this one (or at the end of the page). False when the page cannot be edited. */
  insert: (text: string, after: string | null) => boolean
}

interface OpenPage extends OpenPageActions {
  address: string
  title: string
  editor: Editor | null
}

let page: OpenPage | null = null
let threads: { address: string; list: readonly Thread[]; show: (thread: string) => void } | null = null
/** Each comment the box was last handed: its thread, and the blocks it was written on (none: the whole page). */
const comments = new Map<string, { thread: string; blocks: string[] | null }>()
/** The block the cursor was in when the box was opened from the page you were writing in; none from anywhere else. */
let cursorBlock: string | null = null

/** The page puts itself here while it is drawn. */
export function useOpenPage(open: OpenPage | null): void {
  useEffect(() => {
    if (!open) return
    page = open
    return () => {
      if (page === open) page = null
    }
  }, [open])
}

/** The comments column puts the page's threads here as they are read, and how it brings one into view. */
export function useOpenThreads(address: string | undefined, list: readonly Thread[] | null, show: (thread: string) => void): void {
  useEffect(() => {
    if (!address || !list) return
    const held = { address, list, show }
    threads = held
    return () => {
      if (threads === held) threads = null
    }
  }, [address, list, show])
}

/**
 * The blocks of the page as the editor holds them: id and words, in order; an empty block is no passage. A list's
 * items and a table's cells are blocks of their own (each has its id, and a comment can be on one), so each is a
 * passage, not their list glued into one line (KIN-5 review).
 */
function passagesOf(editor: Editor | null): { id: string; text: string }[] {
  if (!editor) return []
  const out: { id: string; text: string }[] = []
  editor.state.doc.descendants((node) => {
    const id = node.attrs.blockId
    if (!id) return true
    // A block holding blocks (a list, a table, a row) is read through them.
    let inner = false
    node.descendants((child) => {
      if (child.attrs.blockId) inner = true
      return !inner
    })
    if (inner) return true
    const text = node.textContent.trim()
    if (text) out.push({ id: String(id), text })
    return false
  })
  return out
}

const PASSAGE = 'In the page'
const short = (text: string) => (text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text)

/** What is open, for the box: the page and its parts, or nothing on a page that is no document (Home, a topic). */
export function captureOpenPage(): LauncherContext {
  cursorBlock = null
  if (!page) return {}
  // Opened with ⌘K while writing: the editor still has focus, and the answer can go where you were.
  const editor = page.editor
  if (editor?.isFocused && editor.isEditable) {
    const top = editor.state.selection.$from.node(1)
    cursorBlock = top?.attrs.blockId ? String(top.attrs.blockId) : null
  }
  const passages = passagesOf(page.editor)
  const textOf = new Map(passages.map((p) => [p.id, p.text]))
  comments.clear()
  const said: LauncherMessage[] = (threads?.address === page.address ? threads.list : []).flatMap((thread) => {
    const on = thread.blocks?.length ? textOf.get(thread.blocks[0]) : undefined
    const where = on ? `Comment on “${short(on)}”` : 'Comment on the whole document'
    return [thread.root, ...thread.replies].flatMap((item): LauncherMessage[] => {
      if (!item?.body.trim()) return []
      comments.set(item.id, { thread: thread.id, blocks: thread.blocks?.length ? [...thread.blocks] : null })
      return [{ id: item.id, author: knownName(item.by) ?? 'Someone', timestamp: '', where, body: item.body, ...(thread.resolved ? { resolved: true } : {}) }]
    })
  })
  return {
    open: {
      kind: 'page',
      title: page.title,
      references: [],
      messages: [...passages.map((p) => ({ id: p.id, author: '', timestamp: '', where: PASSAGE, body: p.text })), ...said],
    },
  }
}

/** The blocks a part is about: a passage is its own block; a comment, the blocks it was written on (none: the whole page). */
export function blocksOfPart(part: LauncherMessage): string[] | null {
  if (part.where === PASSAGE) return [part.id]
  return comments.get(part.id)?.blocks ?? null
}

/**
 * The words as a new paragraph under a block of the page (or at its end), through the editor, so the page saves it as
 * it saves your typing. False on a page that cannot be edited, or with no editor yet.
 */
export function insertBlock(editor: Editor | null, locked: boolean, text: string, after: string | null): boolean {
  if (!editor || locked || !editor.isEditable) return false
  // One paragraph per paragraph of the answer; nothing for an answer with no words.
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean)
  if (paragraphs.length === 0) return false
  let at = editor.state.doc.content.size
  if (after) {
    // A block inside a list or a table: the answer goes under the whole list, as a block of the page.
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.blockId !== after) return true
      const top = editor.state.doc.resolve(pos)
      at = top.depth === 0 ? pos + node.nodeSize : top.after(1)
      return false
    })
  }
  const content = paragraphs.map((words) => ({ type: 'paragraph', content: [{ type: 'text', text: words }] }))
  const done = editor.chain().insertContentAt(at, content).scrollIntoView().run()
  if (!done) return false
  /*
    The page saves its text when the editor is left (DocumentEditor's blur), and a newer save arriving while it is not
    being written in replaces what it holds. So the answer is saved now, the way your typing is when you leave the
    editor: its own "left" event, which runs the page's save (KIN-5 review: an answer inserted while reading was
    otherwise never saved). The box holds the focus, so the editor is not being written in.
  */
  editor.emit('blur', { editor, event: new FocusEvent('blur'), transaction: editor.state.tr })
  return true
}

/** The open page's actions, while a page is open. */
export function openPageActions(): OpenPageActions | null {
  return page
}

/** Where you were writing when the box was opened, if you were. */
export function cursorBlockAtOpen(): string | null {
  return cursorBlock
}

/** Bring a cited part into view: a passage's block, or a comment's thread in the column. False when it is not there. */
export function showPart(part: LauncherMessage): boolean {
  if (part.where !== PASSAGE) {
    const comment = comments.get(part.id)
    if (!comment || !threads) return false
    page?.showComments()
    threads.show(comment.thread)
    return true
  }
  const element = document.querySelector(`[data-document-editor] [data-block-id="${CSS.escape(part.id)}"]`)
  if (!element) return false
  element.scrollIntoView({ block: 'center' })
  return true
}
