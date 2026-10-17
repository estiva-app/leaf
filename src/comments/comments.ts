import {
  buildComment,
  buildReply,
  decorationsOf,
  groupThreads,
  isCommentOn,
  KIND_ASSERTION,
  KIND_COMMENT,
  mentionTagsFor,
  quoteTagsFor,
  referenceTagsFor,
  urgentTagsFor,
} from '@estiva-app/conversation'
import { blockRunOf, blockRunTag, buildResolution, quoteOf, quoteTag, type Quote, type SignedEvent } from '@estiva-app/protocol'
import { publish, query, viewerPubkey } from '../relay/bridge'

/** A document as its comments name it: its address, its Folder (the `h` every comment carries) and its author. */
export interface Commented {
  address: string
  folder: string
}

/** One comment or reply, as the column draws it. */
export interface CommentItem {
  id: string
  by: string
  /** Unix seconds. */
  at: number
  body: string
  event: SignedEvent
}

/** A top-level comment and its replies: one card in the column. */
export interface Thread {
  id: string
  /** The run of blocks it is on (SPEC §13.6), or absent: the whole document. */
  blocks?: string[]
  /** The words it quotes, when it is on a selection (LEAF-7) rather than whole blocks. */
  quote?: Quote
  root: CommentItem
  replies: CommentItem[]
  /** The last resolution says resolved. */
  resolved: boolean
}

/** What a write tells the person: `ok`, or the plain words for a refusal. */
export type WriteResult = { ok: true } | { ok: false; reason: string }

const item = (event: SignedEvent): CommentItem => ({ id: event.id, by: event.pubkey, at: event.created_at, body: event.content, event })

/**
 * Every thread on a document, oldest first: its comments (`1111` naming it by
 * `A`, roots and replies alike), grouped by NIP-22, and each root's
 * resolutions (`9101`), read as Peek reads them. Whatever Folder a comment
 * was filed in, it is this document's: reads go by anchor and are never
 * bounded by Folder. A reply whose root is gone has no card: there is no
 * top-level comment to draw it under.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-thread-belongs-to-what-it-is-about.md
 */
export async function readThreads(doc: Commented): Promise<Thread[]> {
  const events = await query([{ kinds: [KIND_COMMENT], '#A': [doc.address], limit: 500 }])
  const { roots, replies } = groupThreads(events.filter((e) => e.kind === KIND_COMMENT))
  const on = roots.filter((e) => isCommentOn(e, doc.address))
  const decorations = on.length ? await decorationsOf(on.map((e) => ({ id: e.id, at: e.created_at })), query) : null
  return on.map((root) => {
    const blocks = blockRunOf(root)
    const quote = blocks ? quoteOf(root) : undefined
    const last = decorations?.byId[root.id]?.resolutions.at(-1)
    return {
      id: root.id,
      ...(blocks ? { blocks } : {}),
      ...(quote ? { quote } : {}),
      root: item(root),
      replies: (replies[root.id] ?? []).map(item),
      resolved: last?.action === 'resolved',
    }
  })
}

async function send(unsigned: Parameters<typeof publish>[0] | null, refused: string, signedOut = 'Sign in to comment.'): Promise<WriteResult> {
  if (!unsigned) return { ok: false, reason: signedOut }
  const result = await publish(unsigned)
  if (result.ok) return { ok: true }
  // The relay's reason names kinds and rules: the console keeps it.
  console.warn('[relay] comment refused', result)
  return { ok: false, reason: refused }
}

/** Where a comment is: a run of blocks, and the words where the selection starts and ends unless it covers them whole (SPEC §13.6). */
export interface Anchor {
  blocks: string[]
  quote?: Quote
}

/** What the comment box writes: the body's marker text, and whom it names urgently (`composerText`). */
export interface Written {
  text: string
  urgent?: readonly string[]
}

/**
 * The tags a body earns, as Ship and Peek write them (SPEC §13.1): a `p` per
 * person it names, an `urgent` beside each urgent one, an `a` per other file
 * it names and a `q` per message it references — never the page itself, nor
 * the comment a reply already answers by `e`.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-urgent-mention-is-a-tag-beside-the-mention.md
 */
export function earnedTags(written: Written, own: { address: string; event?: string }): string[][] {
  return [
    ...mentionTagsFor(written.text),
    ...urgentTagsFor(written.text, written.urgent ? [...written.urgent] : undefined),
    ...referenceTagsFor(written.text, own.address),
    ...quoteTagsFor(written.text, own.event),
  ]
}

// The comment box says these after "Not sent:", and then that the text is back in the box.
const NOT_SENT = 'it did not go through'
const SIGNED_OUT = 'you are signed out'

/** A comment on the document — on a selection or on whole blocks when `anchor` is given (SPEC §13.6), else on the whole of it. */
export function postComment(doc: Commented, written: Written, anchor?: Anchor): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  const place = anchor ? [blockRunTag(anchor.blocks), ...(anchor.quote ? [quoteTag(anchor.quote)] : [])] : []
  const tags = [...place, ...earnedTags(written, { address: doc.address })]
  return send(pubkey ? buildComment(pubkey, Date.now(), { about: doc.address, folder: doc.folder, body: written.text, tags }) : null, NOT_SENT, SIGNED_OUT)
}

/** A reply in a thread. It names the top-level comment and carries no `block`: it inherits the thread's place (SPEC §13.6). */
export function postReply(doc: Commented, thread: Thread, written: Written): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  const tags = earnedTags(written, { address: doc.address, event: thread.id })
  return send(
    pubkey ? buildReply(pubkey, Date.now(), { comment: { id: thread.id, anchor: doc.address, author: thread.root.by }, folder: doc.folder, body: written.text, tags }) : null,
    NOT_SENT,
    SIGNED_OUT,
  )
}

/**
 * Resolve or reopen a thread: the same `kind:9101` Peek writes, so both apps read the same state (Miky, LEAF-5 kickoff).
 * It goes in the Folder its comment was filed in, which may not be the document's.
 */
export function setResolved(doc: Commented, thread: Thread, resolved: boolean): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  const folder = thread.root.event.tags.find((t) => t[0] === 'h')?.[1] ?? doc.folder
  return send(
    pubkey ? buildResolution(pubkey, Date.now(), { channelUuid: folder, targetEventId: thread.id, action: resolved ? 'resolved' : 'reopened' }) : null,
    resolved ? 'Could not resolve it. Try again.' : 'Could not reopen it. Try again.',
  )
}

/** The kinds that change what the column shows: a comment, a reply, a resolution. */
export const COMMENT_KINDS: number[] = [KIND_COMMENT, KIND_ASSERTION]
