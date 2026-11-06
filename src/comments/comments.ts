import {
  buildComment,
  buildReply,
  decorationsOf,
  foldThreads,
  groupThreads,
  isAbout,
  isCommentOn,
  KIND_ASSERTION,
  KIND_COMMENT,
  KIND_DELETION,
  KIND_EDIT,
  KIND_REACTION,
  mentionTagsFor,
  placeOf,
  urgentTagsFor,
  type Message,
  type Reaction,
  type RootState,
  type Thread as FoldedThread,
} from '@estiva-app/conversation'
import {
  blockRunTag,
  buildDeletion,
  buildEdit,
  buildReaction,
  buildResolution,
  embedTagsOf,
  imetaTag,
  quoteTag,
  toRenderTree,
  withCard,
  type Embed,
  type Imeta,
  type Quote,
  type SignedEvent,
} from '@estiva-app/protocol'
import { publish, query, viewerPubkey } from '../relay/bridge'
import { links } from './links'

/** A document as its comments name it: its address, its Folder (the `h` every comment carries) and its author. */
export interface Commented {
  address: string
  folder: string
}

/** One comment or reply, as the column draws it. */
export interface CommentItem {
  id: string
  by: string
  /** When it was written, in ms: the moment the card says exactly under the pointer. */
  at: number
  /** What it says now: its latest edit's body, else its own (SPEC §6.8). */
  body: string
  /** An edit changed the body. */
  edited: boolean
  /** When an edit last changed the body, in ms: what the card says on its "(edited)" ("Edited 2 minutes ago"). */
  editedAt?: number
  /** Its files now: its own `imeta`, replaced by the latest edit's, an edit with none taking them all off (SPEC §6.8). */
  files: Imeta[]
  /** Its cards now (`embed`, §13.6.2): its own, replaced by the latest edit carrying any, as Peek and Ship fold them. */
  cards: Embed[]
  event: SignedEvent
  /** Its reactions by emoji, each person once and known by their key, the viewer's own marked `mine` (SPEC §6.6). */
  reactions: Reaction[]
}

/** A top-level comment and its replies: one card in the column. */
export interface Thread {
  id: string
  /**
   * Its comment is gone (SPEC §6.5): `deleted`, its author's deletion read, or `missing`, not returned and with no sign
   * it was deleted. Either is drawn in the comment's place, its replies under it. Absent while the comment is there.
   */
  gone?: Exclude<RootState, 'present'>
  /**
   * The run of blocks it is on (SPEC §13.6), or absent: the whole document —
   * or, for a comment that is gone, a place none of its replies remembers.
   */
  blocks?: string[]
  /** The words it quotes, when it is on a selection (LEAF-7) rather than whole blocks. */
  quote?: Quote
  /** The top-level comment while `present`, else `null`: its replies stay (SPEC §6.5). */
  root: CommentItem | null
  replies: CommentItem[]
  /** The last resolution says resolved. */
  resolved: boolean
  /** While it stands resolved: who resolved it, the note they wrote with it, and when, in ms — what the card says. */
  resolution?: Resolved
}

/** A thread's resolution, as the card says it: who, the note when there is one, and when (ms). */
export interface Resolved {
  by: string
  note?: string
  at: number
}

/**
 * What a write answered: `ok`, or the refusal as it came — the relay's words, an error, or `{ cause }` for Leaf's own —
 * which the kit says in `@estiva-app/conversation`'s plain words (`refusalReason`), the same in every app (ONE-4).
 */
export type WriteResult = { ok: true } | { ok: false; reason: unknown }

/** A write with no sign-in to sign it: the kit says "you are signed out; sign in again". */
const SIGNED_OUT = { cause: 'signed-out' } as const

/** A document's threads, and what the reaction read left out (SPEC §6.6 makes saying so a MUST). */
export interface Threads {
  threads: Thread[]
  /** How many comments and replies, the oldest, were not asked about reactions: past the horizon. */
  reactionsOmitted: number
  /** The reaction read came back at the relay's page ceiling, so some may be missing. */
  reactionsCut: boolean
  /** What a live resolution, reaction or take-back names by `e`: every comment, reply, gone comment and reaction read. */
  watched: string[]
}

/**
 * Every thread on a document, oldest first: its comments (`1111` naming it by
 * `A`, roots and replies alike), and what is read by `#e` on them — edits,
 * resolutions (`9101`) and reactions (`7`), as Peek reads them — folded by the
 * one shared fold (`foldThreads`, SPEC §6.3–§6.8), as Peek and Ship fold them.
 * Whatever Folder a comment was filed in, it is this document's: reads go by
 * anchor and are never bounded by Folder.
 *
 * A thread whose top-level comment the read did not return asks the relay for
 * its `kind:5`: with its author's, it is `deleted`; with none, `missing`. Either
 * way it keeps its replies and its resolution, placed by its earliest reply that
 * copied the comment's place (SPEC §6.5).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/what-belongs-to-a-file-is-stored-with-it.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reply-on-a-page-keeps-its-threads-place.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-conversation-is-one-shared-thing-and-only-its-colours-are-the-apps.md
 */
export async function readThreads(doc: Commented): Promise<Threads> {
  const comments = (await query([{ kinds: [KIND_COMMENT], '#A': [doc.address], limit: 500 }])).filter((e) => e.kind === KIND_COMMENT)
  const { roots, replies, missingRoots } = groupThreads(comments)
  // A comment that names this document by `A` but is about another (§6.4) is not this column's, nor are its replies.
  const on = roots.filter((e) => isCommentOn(e, doc.address))
  // A reply under a comment not returned is kept only when it is itself about this document, as a root must be.
  const kept = [...on, ...on.flatMap((root) => replies[root.id] ?? []), ...missingRoots.flatMap((id) => (replies[id] ?? []).filter((e) => isAbout(e, doc.address)))]
  // Everything the reads by `#e` return goes to the fold with the comments.
  const read: SignedEvent[] = []
  const recording: typeof query = async (filters) => {
    const answer = await query(filters)
    read.push(...answer)
    return answer
  }
  if (missingRoots.length) await recording([{ kinds: [KIND_DELETION], '#e': missingRoots, limit: 500 }]).catch(() => [])
  // A gone comment is a target too, for its thread's resolution.
  const targets = [...kept.map((e) => ({ id: e.id, at: e.created_at })), ...missingRoots.map((id) => ({ id, at: replies[id]?.[0]?.created_at ?? 0 }))]
  const decorations = targets.length ? await decorationsOf(targets, recording) : null
  const viewer = viewerPubkey() ?? undefined
  const threads = foldThreads([...kept, ...read], viewer ? { viewer } : {}).map(threadOf)
  const watched = [...kept.map((e) => e.id), ...missingRoots, ...read.filter((e) => e.kind === KIND_REACTION).map((e) => e.id)]
  return { threads, reactionsOmitted: decorations?.reactionTargetsOmitted ?? 0, reactionsCut: decorations?.reactionEventsCut ?? false, watched }
}

/** A message of the shared fold, as the column draws it. */
function itemOf(message: Message): CommentItem {
  return {
    id: message.id,
    by: message.author,
    at: message.at,
    body: message.body,
    edited: message.edited,
    ...(message.editedAt !== undefined ? { editedAt: message.editedAt } : {}),
    files: message.files,
    cards: message.cards,
    event: message.event,
    reactions: message.reactions,
  }
}

/** A thread of the shared fold, as the column draws it: on its comment's place, else its earliest reply's copy of it. */
function threadOf(thread: FoldedThread): Thread {
  const anchor = thread.root ? thread.root.anchor : thread.replies.find((r) => r.anchor)?.anchor
  const resolution = thread.resolution
  const resolved = resolution?.action === 'resolved'
  return {
    id: thread.id,
    ...(thread.state !== 'present' ? { gone: thread.state } : {}),
    ...(anchor ? { blocks: anchor.blocks, ...(anchor.quote ? { quote: anchor.quote } : {}) } : {}),
    root: thread.root ? itemOf(thread.root) : null,
    replies: thread.replies.map(itemOf),
    resolved,
    // Whoever wrote it, in Leaf, Peek or Ship, at the moment it sorts by (§6.3), in ms as every moment a card takes.
    ...(resolved ? { resolution: { by: resolution.by, ...(resolution.message ? { note: resolution.message } : {}), at: resolution.orderMs } } : {}),
  }
}

/** Publish `unsigned`, or answer signed out when there is none. A refusal is handed on as the relay said it; the console keeps it too. */
async function send(unsigned: Parameters<typeof publish>[0] | null): Promise<WriteResult> {
  if (!unsigned) return { ok: false, reason: SIGNED_OUT }
  const result = await publish(unsigned)
  if (result.ok) return { ok: true }
  console.warn('[relay] write refused', unsigned.kind, result)
  return { ok: false, reason: result.reason }
}

/** Where a comment is: a run of blocks, and the words where the selection starts and ends unless it covers them whole (SPEC §13.6). */
export interface Anchor {
  blocks: string[]
  quote?: Quote
}

/** What the comment box writes: the body's marker text, whom it names urgently (`composerText`), and the files already on the relay. */
export interface Written {
  text: string
  urgent?: readonly string[]
  /** Uploaded before the send: the relay refuses a comment naming a file it does not hold. An edit's only when it changed them: the whole set after it. */
  files?: readonly Imeta[]
  /**
   * The cards (`embed`, §13.6.2). A new comment's: the card shown under the box as it was sent, none after ✕.
   * An edit's: the whole set after it, only when the edit added a card.
   */
  cards?: readonly Embed[]
}

/**
 * The tags a body earns, as Ship and Peek write them (SPEC §13.1): a `p` per
 * person it names and an `urgent` beside each urgent one, then, from the link
 * reader, an `a` per other file it names and a `q` per message it references,
 * by a `nostr:` reference or an app link, and a `part` per file a block link
 * names — never the page itself, nor the comment a reply already answers by `e`.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-urgent-mention-is-a-tag-beside-the-mention.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-edit-says-what-the-message-links-now.md
 */
async function earnedTags(written: Written, own: { file: string; parent?: string }): Promise<string[][]> {
  return [
    ...mentionTagsFor(written.text),
    ...urgentTagsFor(written.text, written.urgent ? [...written.urgent] : undefined),
    ...(await links.tagsFor(toRenderTree(written.text, 'marker'), own)),
  ]
}

/**
 * A comment on the document — on a selection or on whole blocks when `anchor` is given (SPEC §13.6), else on the whole of it —
 * in the document's own Folder.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/what-belongs-to-a-file-is-stored-with-it.md
 */
export async function postComment(doc: Commented, written: Written, anchor?: Anchor): Promise<WriteResult> {
  // Signed out says so at once, not after the links' answers (up to 5 s), as an edit does.
  const pubkey = viewerPubkey()
  if (!pubkey) return send(null)
  const place = anchor ? [blockRunTag(anchor.blocks), ...(anchor.quote ? [quoteTag(anchor.quote)] : [])] : []
  const tags = [...place, ...(await earnedTags(written, { file: doc.address })), ...embedTagsOf(written.cards ?? [])]
  return send(buildComment(pubkey, Date.now(), { about: doc.address, folder: doc.folder, body: written.text, files: written.files, tags }))
}

/**
 * A reply in a thread. It names the top-level comment and copies its `block`
 * and `quote`, so the thread keeps its place if the comment is deleted (SPEC
 * §13.6). It goes into its comment's Folder (its `h`), so a thread filed in
 * another Folder stays in one. A thread whose comment was deleted takes no reply.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reply-on-a-page-keeps-its-threads-place.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/what-belongs-to-a-file-is-stored-with-it.md
 */
export async function postReply(doc: Commented, thread: Thread, written: Written): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  const root = thread.root
  // A send on a deleted message says "you can no longer write here" (ui 0.106): "deleted" is an edit's or a reaction's.
  if (!root) return { ok: false, reason: { cause: 'no-access' } }
  if (!pubkey) return send(null)
  const tags = [...(await earnedTags(written, { file: doc.address, parent: thread.id })), ...embedTagsOf(written.cards ?? [])]
  const folder = root.event.tags.find((t) => t[0] === 'h')?.[1] ?? doc.folder
  return send(
    buildReply(pubkey, Date.now(), { comment: { id: thread.id, anchor: doc.address, author: root.by, place: placeOf(root.event) }, folder, body: written.text, files: written.files, tags }),
  )
}

/**
 * Your comment or reply, reworded: the `kind:40003` Peek and Ship write (SPEC
 * §6.8), in the Folder the comment was filed in. It carries no `block` or
 * `quote`, so the comment stays where it is. A file added or taken off while
 * editing (Miky, 26 Oct, PEEKM-4) rides it as the whole `imeta` set; with no
 * `written.files` the files it has ride it as they are. A card the new words
 * add rides it as the whole card set (`written.cards`), as Peek's edit writes it.
 */
export function editComment(comment: CommentItem, written: Written): Promise<WriteResult> {
  return sendEdit(comment, written.text, written.cards, written.files)
}

/**
 * A `kind:40003` on `comment`, in the Folder it was filed in: its new body, its whole card set when it changes, and
 * its whole file set always — the files it keeps when they did not change, since an edit with none takes them off.
 * It carries every `a` and `q` its words earn, so a file lists the comment while its latest words link it, but
 * never the page it is on nor the comment it answers, and no `p`, `urgent` or `part`: those stay as the send wrote them.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-edit-is-the-whole-new-message.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-edit-says-what-the-message-links-now.md
 */
async function sendEdit(comment: CommentItem, body: string, embeds?: readonly Embed[], files: readonly Imeta[] = comment.files): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  const tagged = (name: string) => comment.event.tags.find((t) => t[0] === name)?.[1]
  const folder = tagged('h')
  // A comment read with no Folder cannot be edited where it was filed: nothing a person can do about it.
  if (!folder) return { ok: false, reason: { cause: 'unknown' } }
  if (!pubkey) return send(null)
  const changes = { ...(embeds ? { embeds } : {}), mediaTags: files.map(imetaTag) }
  const own = { file: tagged('A'), parent: tagged('e') }
  const linked = await links.tagsFor(toRenderTree(body, 'marker'), own, { edit: true })
  const edit = buildEdit(pubkey, Date.now(), { channelUuid: folder, targetEventId: comment.id, body, ...changes })
  return send({ ...edit, tags: [...edit.tags, ...linked] })
}

/**
 * ✕ on your sent comment's card (`value`, its `embed` value): an edit with
 * the words as they are and the comment's whole card set, that one `none`
 * (§13.6.2), as Peek's and Ship's ✕ write it. The words unchanged, it is not
 * marked edited.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md
 */
export function removeCard(comment: CommentItem, value: string): Promise<WriteResult> {
  return sendEdit(comment, comment.body, withCard(comment.cards, value, 'none'))
}

/** Delete your comment or reply: a `kind:5` naming it, as Peek's and Ship's Delete do. Its replies stay (SPEC §6.5). */
export function deleteComment(comment: CommentItem): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  return send(pubkey ? buildDeletion(pubkey, Date.now(), { targetEventId: comment.id }) : null)
}

/**
 * Resolve or reopen a thread: the same `kind:9101` Peek writes, so both apps read the same state (Miky, LEAF-5 kickoff).
 * It goes in the Folder its comment was filed in, which may not be the document's. A resolve carries the note written
 * in the kit's Resolve dialog, as its content, as Peek's does; a reopen carries none.
 */
export function setResolved(doc: Commented, thread: Thread, resolved: boolean, note = ''): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  const folder = thread.root?.event.tags.find((t) => t[0] === 'h')?.[1] ?? doc.folder
  const rationale = resolved && note ? { rationale: note } : {}
  return send(
    pubkey ? buildResolution(pubkey, Date.now(), { channelUuid: folder, targetEventId: thread.id, action: resolved ? 'resolved' : 'reopened', ...rationale }) : null,
  )
}

/**
 * React to a comment or a reply: the `kind:7` Ship and Peek write, with no
 * `h` — the relay files it under the comment's Folder, from its `e`.
 */
export function react(comment: CommentItem, emoji: string): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  return send(pubkey ? buildReaction(pubkey, Date.now(), { targetEventId: comment.id, emoji }) : null)
}

/** Take your reaction back: a `kind:5` naming the reaction's own event, as Ship's and Peek's do. */
export function unreact(reactionId: string): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  return send(pubkey ? buildDeletion(pubkey, Date.now(), { targetEventId: reactionId }) : null)
}

/** The kinds that change what the column shows: a comment, a reply, an edit, a resolution, a reaction, and a deletion of a comment or a reaction. */
export const COMMENT_KINDS: number[] = [KIND_COMMENT, KIND_EDIT, KIND_ASSERTION, KIND_REACTION, KIND_DELETION]
