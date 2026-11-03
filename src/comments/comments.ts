import {
  buildComment,
  buildReply,
  decorationsOf,
  foldEmbeds,
  groupThreads,
  isCommentOn,
  KIND_ASSERTION,
  KIND_COMMENT,
  KIND_DELETION,
  KIND_EDIT,
  KIND_REACTION,
  mentionTagsFor,
  placeOf,
  urgentTagsFor,
  type ReactionEvent,
} from '@estiva-app/conversation'
import {
  blockRunOf,
  blockRunTag,
  buildDeletion,
  buildEdit,
  buildReaction,
  buildResolution,
  embedsOf,
  embedTagsOf,
  imetaOf,
  imetaTag,
  quoteOf,
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
  /** Its reactions, one per person and emoji, oldest first (SPEC §6.6). */
  reactions: ReactionEvent[]
}

/** A top-level comment and its replies: one card in the column. */
export interface Thread {
  id: string
  /**
   * The run of blocks it is on (SPEC §13.6), or absent: the whole document —
   * or, for a deleted comment, a place none of its replies remembers.
   */
  blocks?: string[]
  /** The words it quotes, when it is on a selection (LEAF-7) rather than whole blocks. */
  quote?: Quote
  /** The top-level comment; `null` once it was deleted and its replies stay (SPEC §6.5). */
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

/** What a write tells the person: `ok`, or the plain words for a refusal. */
export type WriteResult = { ok: true } | { ok: false; reason: string }

/** A document's threads, and what the reaction read left out (SPEC §6.6 makes saying so a MUST). */
export interface Threads {
  threads: Thread[]
  /** How many comments and replies, the oldest, were not asked about reactions: past the horizon. */
  reactionsOmitted: number
  /** The reaction read came back at the relay's page ceiling, so some may be missing. */
  reactionsCut: boolean
}

/**
 * Every thread on a document, oldest first: its comments (`1111` naming it by
 * `A`, roots and replies alike), grouped by NIP-22, each root's resolutions
 * (`9101`), and every comment's and reply's reactions (`7`), read as Peek
 * reads them. Whatever Folder a comment was filed in, it is this document's:
 * reads go by anchor and are never bounded by Folder. Each one shows its
 * latest edit (SPEC §6.8).
 *
 * A reply whose top-level comment is gone keeps its card only when the relay
 * holds a deletion of that comment by its author (SPEC §6.5): the comment is
 * then `null`, and the thread is placed by its earliest reply that copied the
 * comment's place. Gone with no deletion, it is outside this read, and has no
 * card.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/what-belongs-to-a-file-is-stored-with-it.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reply-on-a-page-keeps-its-threads-place.md
 */
export async function readThreads(doc: Commented): Promise<Threads> {
  const events = await query([{ kinds: [KIND_COMMENT], '#A': [doc.address], limit: 500 }])
  const { roots, replies, missingRoots } = groupThreads(events.filter((e) => e.kind === KIND_COMMENT))
  const on = roots.filter((e) => isCommentOn(e, doc.address))
  const deleted = missingRoots.length ? await deletedRoots(missingRoots, replies) : []
  const all = [...on, ...[...on.map((root) => root.id), ...deleted].flatMap((id) => replies[id] ?? [])]
  // The body lets an edit that changed nothing stay unmarked. A deleted comment is a target too, for its thread's resolution.
  const targets = [
    ...all.map((e) => ({ id: e.id, at: e.created_at, body: e.content })),
    ...deleted.map((id) => ({ id, at: replies[id]?.[0]?.created_at ?? 0 })),
  ]
  // The edits that read fetches carry the cards an edit re-chose too (✕ on a sent card), so they are kept on the way past, as Peek does.
  const edits: SignedEvent[] = []
  const recording: typeof query = async (filters) => {
    const answer = await query(filters)
    for (const event of answer) if (event.kind === KIND_EDIT) edits.push(event)
    return answer
  }
  const decorations = targets.length ? await decorationsOf(targets, recording) : null
  const editedCards = foldEmbeds(edits)
  const item = (event: SignedEvent): CommentItem => {
    const edit = decorations?.byId[event.id]?.edit
    return {
      id: event.id,
      by: event.pubkey,
      at: event.created_at * 1000,
      body: edit?.body ?? event.content,
      edited: edit?.edited ?? false,
      ...(edit?.editedAt !== undefined ? { editedAt: edit.editedAt } : {}),
      files: edit?.attachments ?? imetaOf(event),
      cards: editedCards[event.id] ?? embedsOf(event),
      event,
      reactions: decorations?.byId[event.id]?.reactions ?? [],
    }
  }
  const thread = (id: string, root: SignedEvent | null): Thread => {
    const answers = replies[id] ?? []
    // Its comment's place while it is readable, else the earliest reply's that copied it.
    const placed = root ?? answers.find((e) => blockRunOf(e))
    const blocks = placed ? blockRunOf(placed) : undefined
    const quote = placed && blocks ? quoteOf(placed) : undefined
    // A resolved thread stays resolved when its comment is deleted.
    const last = decorations?.byId[id]?.resolutions.at(-1)
    const resolved = last?.action === 'resolved'
    return {
      id,
      ...(blocks ? { blocks } : {}),
      ...(quote ? { quote } : {}),
      root: root ? item(root) : null,
      replies: answers.map(item),
      resolved,
      // Whoever wrote it, in Leaf, Peek or Ship: the relay's seconds as ms, as every moment a card takes.
      ...(resolved ? { resolution: { by: last.by, ...(last.message ? { note: last.message } : {}), at: last.at * 1000 } } : {}),
    }
  }
  const threads = [...on.map((root) => thread(root.id, root)), ...deleted.map((id) => thread(id, null))]
  return { threads, reactionsOmitted: decorations?.reactionTargetsOmitted ?? 0, reactionsCut: decorations?.reactionEventsCut ?? false }
}

/**
 * Of the top-level comments replies point at and the read did not return, the
 * ones the relay holds a `kind:5` for, signed by the comment's author as its
 * replies name them (their first `p`, before any mention's); a deletion by
 * anyone else deletes nothing. Replies that name no author take any deletion
 * as the proof.
 */
async function deletedRoots(missing: string[], replies: Record<string, SignedEvent[]>): Promise<string[]> {
  const deletions = await query([{ kinds: [KIND_DELETION], '#e': missing, limit: 500 }]).catch(() => [])
  return missing.filter((id) => {
    const authors = new Set((replies[id] ?? []).flatMap((r) => r.tags.find((t) => t[0] === 'p' && t[1])?.[1] ?? []))
    return deletions.some((d) => d.tags.some((t) => t[0] === 'e' && t[1] === id) && (authors.size === 0 || authors.has(d.pubkey)))
  })
}

async function send(unsigned: Parameters<typeof publish>[0] | null, refused: string, signedOut = 'Sign in to comment.'): Promise<WriteResult> {
  if (!unsigned) return { ok: false, reason: signedOut }
  const result = await publish(unsigned)
  if (result.ok) return { ok: true }
  // The relay's reason names kinds and rules: the console keeps it.
  console.warn('[relay] write refused', unsigned.kind, result)
  // Too fast is the refusal a person can do something about: they wait and try again (NIP-01's `rate-limited:` prefix).
  if (/^rate-limited/.test(result.reason ?? '')) return { ok: false, reason: 'too many at once, try again in a moment' }
  return { ok: false, reason: refused }
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

// The comment box says these after "Not sent:", and then that the text is back in the box.
const NOT_SENT = 'it did not go through'
const SIGNED_OUT = 'you are signed out'

/**
 * A comment on the document — on a selection or on whole blocks when `anchor` is given (SPEC §13.6), else on the whole of it —
 * in the document's own Folder.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/what-belongs-to-a-file-is-stored-with-it.md
 */
export async function postComment(doc: Commented, written: Written, anchor?: Anchor): Promise<WriteResult> {
  // Signed out says so at once, not after the links' answers (up to 5 s), as an edit does.
  const pubkey = viewerPubkey()
  if (!pubkey) return send(null, NOT_SENT, SIGNED_OUT)
  const place = anchor ? [blockRunTag(anchor.blocks), ...(anchor.quote ? [quoteTag(anchor.quote)] : [])] : []
  const tags = [...place, ...(await earnedTags(written, { file: doc.address })), ...embedTagsOf(written.cards ?? [])]
  return send(buildComment(pubkey, Date.now(), { about: doc.address, folder: doc.folder, body: written.text, files: written.files, tags }), NOT_SENT, SIGNED_OUT)
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
  if (!root) return { ok: false, reason: 'the comment was deleted' }
  if (!pubkey) return send(null, NOT_SENT, SIGNED_OUT)
  const tags = [...(await earnedTags(written, { file: doc.address, parent: thread.id })), ...embedTagsOf(written.cards ?? [])]
  const folder = root.event.tags.find((t) => t[0] === 'h')?.[1] ?? doc.folder
  return send(
    buildReply(pubkey, Date.now(), { comment: { id: thread.id, anchor: doc.address, author: root.by, place: placeOf(root.event) }, folder, body: written.text, files: written.files, tags }),
    NOT_SENT,
    SIGNED_OUT,
  )
}

// The edit box says this after "Not saved:".
const NOT_SAVED = 'it did not go through'

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
  if (!folder) return { ok: false, reason: NOT_SAVED }
  if (!pubkey) return send(null, NOT_SAVED, SIGNED_OUT)
  const changes = { ...(embeds ? { embeds } : {}), mediaTags: files.map(imetaTag) }
  const own = { file: tagged('A'), parent: tagged('e') }
  const linked = await links.tagsFor(toRenderTree(body, 'marker'), own, { edit: true })
  const edit = buildEdit(pubkey, Date.now(), { channelUuid: folder, targetEventId: comment.id, body, ...changes })
  return send({ ...edit, tags: [...edit.tags, ...linked] }, NOT_SAVED, SIGNED_OUT)
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
  return send(pubkey ? buildDeletion(pubkey, Date.now(), { targetEventId: comment.id }) : null, 'Could not delete it. Try again.', SIGNED_OUT)
}

/**
 * Resolve or reopen a thread: the same `kind:9101` Peek writes, so both apps read the same state (Miky, LEAF-5 kickoff).
 * It goes in the Folder its comment was filed in, which may not be the document's.
 */
export function setResolved(doc: Commented, thread: Thread, resolved: boolean): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  const folder = thread.root?.event.tags.find((t) => t[0] === 'h')?.[1] ?? doc.folder
  return send(
    pubkey ? buildResolution(pubkey, Date.now(), { channelUuid: folder, targetEventId: thread.id, action: resolved ? 'resolved' : 'reopened' }) : null,
    resolved ? 'Could not resolve it. Try again.' : 'Could not reopen it. Try again.',
  )
}

// The card says this after "Not reacted:".
const NOT_REACTED = 'it did not go through'

/**
 * React to a comment or a reply: the `kind:7` Ship and Peek write, with no
 * `h` — the relay files it under the comment's Folder, from its `e`.
 */
export function react(comment: CommentItem, emoji: string): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  return send(pubkey ? buildReaction(pubkey, Date.now(), { targetEventId: comment.id, emoji }) : null, NOT_REACTED, SIGNED_OUT)
}

/** Take your reaction back: a `kind:5` naming the reaction's own event, as Ship's and Peek's do. */
export function unreact(reactionId: string): Promise<WriteResult> {
  const pubkey = viewerPubkey()
  return send(pubkey ? buildDeletion(pubkey, Date.now(), { targetEventId: reactionId }) : null, NOT_REACTED, SIGNED_OUT)
}

/** The kinds that change what the column shows: a comment, a reply, an edit, a resolution, a reaction, and a deletion of a comment or a reaction. */
export const COMMENT_KINDS: number[] = [KIND_COMMENT, KIND_EDIT, KIND_ASSERTION, KIND_REACTION, KIND_DELETION]
