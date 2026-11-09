import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Extension } from '@tiptap/core'
import type { Editor, JSONContent } from '@tiptap/react'
import {
  boxReadOf,
  composerDocument,
  composerDraft,
  composerText,
  createDraftStore,
  draftKeys,
  embedsToEdit,
  embedsToSend,
  namedBefore,
  offersEditAndDelete,
  openingWords,
  REACTION_EMOJI,
  REACTION_HORIZON,
  refusalReason,
  ROW_BLOCK,
  withoutOwnFileLines,
  writtenUrlOf,
  type DraftStore,
  type RowLine,
} from '@estiva-app/conversation'
import { contentFormatOf, decodeNevent, decodeNpub, encodeNaddr, findNostrUris, toRenderTree, type EditorDocument, type Embed, type Imeta } from '@estiva-app/protocol'
import {
  caretOnOpen,
  Chip,
  ConversationCard,
  ConversationLayout,
  EmptyState,
  FieldLine,
  GONE_CLOSED,
  InlineChip,
  LinkChip,
  LinkRow,
  QuotedLine,
  ReactionHorizon,
  ReplyCard,
  RichText,
  Thread as KitThread,
  WithTooltip,
  useToast,
  type ConversationCardProps,
  type ConversationEntryProps,
  type ConversationItem,
  type LinkState,
} from '@estiva-app/ui'
import {
  CommentBox,
  commentBoxRows,
  commentElement,
  commentPlace,
  LinkChips,
  quoteText,
  setCommentAnchors,
  type BoxAbout,
  type CommentAnchor,
  type CommentPlace,
  type BoxFile,
  type BoxSentUnder,
  type BoxUnder,
  type MentionPerson,
  type SendAnswer,
  type UploadAnswer,
} from '@estiva-app/ui/editor'
import { profileOf } from '../document/save'
import { commentReferenceSections, subscribeReferences, type ReferableComment } from '../document/referencePicker'
import { ReferencesProvider, useReferences } from '../document/references'
import { CardActsProvider } from '../document/linked'
import { PageLink } from '../document/PageLink'
import { CommentCard } from './CommentCard'
import { linksIn, MAX_LINKS_ASKED } from '@estiva-app/interop'
import { ownFileOf, placeComment, referenceOfValue } from './commentBody'
import { linkReferenceOf, links, useKnownLinks } from './links'
import { PartView } from './PartView'
import { whenOf } from '../home/recent'
import { deleteComment, editComment, removeCard, postComment, postReply, react, setResolved, unreact, type Anchor, type Commented, type CommentItem, type Thread, type WriteResult, type Written } from './comments'
import { viewerPubkey } from '../relay/bridge'
import { COMMENTS_HASH, pagePath } from '../route'
import { uploadFile } from '../relay/blobs'
import { FileCard } from './CommentFiles'
import { heldFields, releaseHeld, useHeldTyping } from '../auth/heldTyping'
import { knownName, useMentionPeople } from './people'
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
 * Since ONE-5 step 4 the column is the kit's one column (`ConversationLayout`, `threads="under"`): its frame, the one
 * thread open under its comment, the two closed groups, its scrolling, and its loading, empty and below. The order,
 * the words, the box and the text's side are Leaf's.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-comment-points-at-blocks-and-the-words-quoted.md
 */

/** The draft's highlight id, so the block being commented on stays marked while you write. */
const DRAFT = 'draft'

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

/** The keys whose profile is an agent's (NIP-24's `bot`): their face is the robot. */
type Bots = Record<string, true>

/** The names and pictures of the people in the column, and which are agents, from their profiles: each one as it comes, kept once found. */
function useNames(pubkeys: readonly string[]): { names: Record<string, string>; pictures: Record<string, string>; bots: Bots } {
  const [faces, setFaces] = useState<{ names: Record<string, string>; pictures: Record<string, string>; bots: Bots }>({ names: {}, pictures: {}, bots: {} })
  const asked = useRef(new Set<string>())
  const key = [...new Set(pubkeys)].sort().join(',')
  useEffect(() => {
    for (const pk of key ? key.split(',') : []) {
      if (asked.current.has(pk)) continue
      asked.current.add(pk)
      void profileOf(pk)
        .catch(() => null)
        .then((profile) => {
          const { displayName: name, picture, bot } = profile ?? {}
          if (name || picture || bot)
            setFaces((was) => ({
              names: name ? { ...was.names, [pk]: name } : was.names,
              pictures: picture ? { ...was.pictures, [pk]: picture } : was.pictures,
              bots: bot ? { ...was.bots, [pk]: true } : was.bots,
            }))
        })
    }
  }, [key])
  return faces
}

// Ship's `/` Insert rows (Miky, 16 October), after the shared Format section. An edit drops File and Urgent itself.
const INSERT = [commentBoxRows.file, commentBoxRows.mention, commentBoxRows.urgent, commentBoxRows.reference]

/**
 * The box's upload: the file goes on the relay at once, and its `imeta` is what the send names (COMM-6). A refusal is
 * handed on as it came, and the kit's card says it; the kit also stops a file over the relay's limit before this.
 */
async function upload(file: File): Promise<UploadAnswer> {
  const answer = await uploadFile(file)
  return answer.ok ? { accepted: true, value: answer.file } : { accepted: false, reason: answer.reason }
}

/**
 * A page with no team yet has nowhere to file a comment. None of the shared reasons names that, so it is said as
 * "something went wrong, try again".
 */
const NO_TEAM = { cause: 'unknown' } as const

/**
 * A refused delete, resolve or reopen, said where the kit has no sentence of its own around it (the delete question,
 * the Resolve dialog, a toast): "Not deleted: <reason>.", as the box says "Not sent:" and Peek "Not deleted:".
 */
const refusalSentence = (what: 'deleted' | 'resolved' | 'reopened', reason: unknown): string => `Not ${what}: ${refusalReason(reason)}.`

/** The files a send names, in the order they were attached: the box sends only uploaded ones, each with the `imeta` `upload` answered. */
const filesOf = (files: readonly BoxFile[]): Imeta[] => files.flatMap((f) => (f.value ? [f.value as Imeta] : []))

// One store for every box in the tab; a browser that refuses storage keeps no drafts.
let drafts: DraftStore | null = null
function draftStore(): DraftStore {
  if (!drafts) {
    try {
      drafts = createDraftStore(window.localStorage)
    } catch {
      drafts = createDraftStore(undefined)
    }
  }
  return drafts
}

/** The reply box of this thread holds text (its draft keeps every change). */
const replyHoldsText = (threadId: string) => !!draftStore().read(draftKeys.thread(threadId))?.trim()

/** The page the column's comments are on: its file gets no card under a comment, and its blocks no part (Miky, 2026-10-19). */
const PageHere = createContext<string | undefined>(undefined)

/** A pasted app URL becomes its file's chip, as in Peek (`LinkChips`, §7.7). */
const linkChips = () => LinkChips.configure({ referenceOf: linkReferenceOf, ask: links.ask })

/** What an app link names for the box, as answered so far. */
const LINK_CONTEXT = { resolveLink: links.known, blockOf: links.knownBlock }

/**
 * What a box's document names, read as it will be sent, by the package's one rule. An edit's (`previous`, what the
 * comment named before, and `folded`, its cards) shows the comment's own card while the edit still names its file, a
 * card taken off before never again, and a card for a file the edit names first (Katerina, 30 Oct).
 */
const linksOfBox = (body: JSONContent, here: string | undefined, previous?: readonly string[], folded?: readonly Embed[]) =>
  boxReadOf(body as EditorDocument, { ...LINK_CONTEXT, here, previous, folded })

/**
 * What shows under the box while a comment is written or edited (COMM-8): the
 * one file it names, as the card it will be sent with, and the live part of
 * each block link — read as Peek reads its box (`boxReadOf`), from what each
 * app link names as answered so far. Each read asks about the links not
 * answered yet; an answer coming back reads again. An edit's shows the card
 * the comment has now, with its ✕, so it can be seen and taken off there
 * (Katerina, 30 Oct); with none, a card only for a file the edit names first
 * ({@link linksOfBox}). The box shows no part under an edit, which carries none.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md
 */
function boxUnder(here: string | undefined, previous?: readonly string[], folded?: readonly Embed[]): BoxUnder {
  return {
    read: (body) => {
      const read = linksOfBox(body, here, previous, folded)
      void links.ask(read.urls.slice(0, MAX_LINKS_ASKED)).catch(() => {})
      const uri = read.card ? referenceOfValue(read.card) : undefined
      return {
        // The box draws it in its own AttachedCard, with the ✕; the kit draws the one inside as its card alone.
        card: read.card && uri ? { value: read.card, view: <CommentCard uri={uri} /> } : undefined,
        parts: read.parts.map((part) => ({ key: `${part.address}#${part.block}`, view: <PartView pointer={part} /> })),
        names: [...read.values, ...read.parts.map((part) => part.address)],
      }
    },
    changed: links.changed,
  }
}

/** What a box needs from the column: who `@` offers, and whom a key names. */
interface BoxPeople {
  people: readonly MentionPerson[]
  nameOf: (pubkey: string) => string | undefined
}

/**
 * The box a comment or a reply is written in: the package's CommentBox, with
 * `@` and `!@` for the workspace's people, `[` for this page's comments and its
 * Folder's files, and Ship's `/` rows. It holds the words until the relay
 * answers, and a refusal puts them back and says so (record
 * a-refused-action-is-undone-and-your-text-comes-back). What is written is kept
 * as a draft under `draftKey`; give the box a React `key` per destination.
 * Given `editing`, it is the same box in its edit mode: the comment's words
 * with their chips, Save and Cancel, and no draft. What is typed there goes to
 * `editing.onTyped`, so a sign-in ending can hold it (AUT-5).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-app-writes-and-reacts-with-one-shared-box.md
 */
function Box({
  placeholder,
  draftKey,
  scope,
  people,
  onSend,
  autoFocus,
  onSent,
  editing,
  closed,
  about,
  reply,
}: {
  /** A reply box: a send refused because its comment was deleted meanwhile says so (ONE-10). */
  reply?: boolean
  /** Said in the empty box, and its accessible name. */
  placeholder: string
  draftKey?: string
  scope: { here: readonly ReferableComment[]; rest: readonly ReferableComment[] }
  people: BoxPeople
  onSend: (written: Written) => Promise<WriteResult>
  autoFocus?: boolean
  /** Called once the box has let go of an accepted send. */
  onSent?: () => void
  /** The comment being edited, and how to stop: Save is `onSend`. `typed`: the words held through a sign-in ending, to open with instead. */
  editing?: { comment: CommentItem; onCancel: () => void; typed?: () => JSONContent | null; onTyped?: (body: JSONContent) => void }
  /** Why nothing can be written here — an archived file's line (PEEKM-8) — said in the box's place; '' while the line is read, still closed. */
  closed?: string
  /** What a new comment will be on, in the kit's strip above the box, with its ✕ (the kit's `about`). */
  about?: BoxAbout
}) {
  // Names from the latest read of the people, when the draft opens: they may land after the box does.
  const draft = useMemo(() => (draftKey ? composerDraft(draftStore(), draftKey, { personLabel: knownName }) : undefined), [draftKey])
  const here = useContext(PageHere)
  // What the comment named before the edit, so only a file the edit names first gets a card, as in Peek's edit box; and
  // the cards it had then, so the one it shows is under the edit box too.
  const [previous] = useState(() => (editing ? namedBefore(editing.comment.body, LINK_CONTEXT) : undefined))
  const [folded] = useState(() => editing?.comment.cards)
  const under = useMemo(() => boxUnder(here, previous, folded), [here, previous, folded])
  const send = async (body: JSONContent, files: readonly BoxFile[] = [], shown: BoxSentUnder = {}): Promise<SendAnswer> => {
    const attached = filesOf(files)
    if (editing) {
      // A file added or taken off while editing (Miky, 26 Oct, PEEKM-4) rides the edit as the whole set, and none takes every one off.
      // The kit keeps Save off while the edit holds no words and no file.
      const before = editing.comment.files
      const same = attached.length === before.length && attached.every((file, i) => file.x === before[i].x)
      // The card it had stays unless ✕ took it off under the box; with none, a file the edit names first adds its card, unless ✕ took that off.
      const read = linksOfBox(body, here, previous, folded)
      const cards = embedsToEdit(read, new Set(read.card && read.card !== shown.card ? [read.card] : []), editing.comment.cards)
      const result = await onSend({ ...composerText(body as EditorDocument), ...(same ? {} : { files: attached }), ...(cards ? { cards } : {}) })
      return result.ok ? { accepted: true } : { accepted: false, reason: result.reason }
    }
    // What was under the box as it was sent: the card unless ✕ took it off. The block links' parts are the send's to tag.
    const cards = embedsToSend({ card: shown.card }, new Set())
    const written = {
      ...composerText(body as EditorDocument),
      ...(attached.length ? { files: attached } : {}),
      ...(cards.length ? { cards } : {}),
    }
    const result = await onSend(written)
    return result.ok ? { accepted: true } : { accepted: false, reason: result.reason }
  }
  // The words an edit opens with are the comment's as the edit began: a re-read while editing does not reset them.
  const [opened] = useState(() =>
    // Without the line linking its own file, which Ship once appended and no reader draws (ONE-11).
    editing ? (editing.typed?.() ?? (composerDocument(withoutOwnFileLines(editing.comment.body, ownFileOf(editing.comment.event)), { personLabel: knownName }, urgentOf(editing.comment)) as JSONContent)) : undefined,
  )
  // The package's edit mode keeps no draft: this tells the column each change, for the ending to hold.
  const [extensions] = useState(() => {
    const onTyped = editing?.onTyped
    return [
      linkChips(),
      ...(onTyped
        ? [
            Extension.create({
              name: 'keepTypedEdit',
              onUpdate() {
                onTyped(this.editor.getJSON())
              },
            }),
          ]
        : []),
    ]
  })
  // The comment's own files show in the edit box and can be taken off; more can be added, since the save writes them.
  const [editFiles] = useState<BoxFile[] | undefined>(() =>
    editing?.comment.files.map((file, i) => ({ id: `kept-${i}`, name: file.filename ?? file.alt ?? 'file', size: file.size, contentType: file.m, state: 'ready', value: file })),
  )
  const edit =
    editing && opened
      ? { body: opened, files: editFiles, writesFiles: true, onCancel: editing.onCancel, onSave: send }
      : undefined
  // A click inside the box is the box's, never the card's around it: Attach opens the picker with a click on a hidden input, and the card would close the reply under it (LFB-2).
  return (
    <div data-interactive>
      <CommentBox
        label={placeholder}
        placeholder={<span>{placeholder}</span>}
        reply={reply}
        people={people.people}
        references={(typed) => commentReferenceSections(scope, typed, people.nameOf)}
        referencesChanged={subscribeReferences}
        referenceView={PageLink}
        insert={INSERT}
        draft={edit ? undefined : draft}
        edit={edit}
        extensions={extensions}
        upload={upload}
        send={send}
        under={under}
        autoFocus={autoFocus || !!edit}
        onSent={onSent ? () => onSent() : undefined}
        closed={closed !== undefined ? { reason: closed } : undefined}
        about={about}
      />
    </div>
  )
}

/** Where a thread is now: its §13.6 state, from the editor's text. `unaddressable`: the document is not a block document. */
type Where = CommentPlace | { state: 'unaddressable' } | null

/**
 * What a thread is on, the kit card's `about`: the words it quotes as the kit's `QuotedLine`, in the page's highlight
 * (and as they were quoted when they changed since or their blocks are gone, never as what the page says: Miky, LEAF-7
 * /land), or Leaf's words for a place with none (a `label`, on the grey): "On the paragraph", "On the whole document".
 * A deleted comment keeps it, for the replies under it (kit 0.103.0).
 */
function aboutOf(thread: Thread, where: Where, editor: Editor | null): ReactNode {
  // A deleted comment whose replies remember no place: where it was is not known, so nothing is said (record a-reply-on-a-page-keeps-its-threads-place).
  if (!thread.root && !thread.blocks) return undefined
  if (!thread.blocks || !where) return <QuotedLine label="On the whole document" />
  if (where.state === 'unaddressable') return <QuotedLine label="On a part of this document Leaf cannot show" />
  const words = thread.quote ? quoteText(thread.quote) : undefined
  if (where.state === 'detached') return words ? <QuotedLine words={words} state="gone" /> : <QuotedLine label="On blocks deleted from the page" />
  if (!words) return <QuotedLine label={wholeBlocksLine(editor, where)} />
  return <QuotedLine words={words} state={where.state === 'reworded' ? 'reworded' : 'here'} />
}

// The five emoji Peek and Ship offer, each with its meaning.
const REACTION_OPTIONS = REACTION_EMOJI.map(({ emoji, name }) => ({ emoji, label: name }))

/** Your reaction on or off: `mine` is your reaction with that emoji, which taking it back names. */
type OnReact = (comment: CommentItem, emoji: string, mine?: string) => Promise<WriteResult>

/** Whom a comment names urgently, as sent: an edit carries no `urgent`, so an edited comment keeps them. */
const urgentOf = (comment: CommentItem) => comment.event.tags.filter((t) => t[0] === 'urgent' && t[1]).map((t) => t[1])

/**
 * What your own comment or reply offers besides reacting — Edit and Delete,
 * only on your own (record edit-and-delete-are-offered-only-on-your-own-message).
 */
interface OwnActions {
  /** What the edit box offers: the people `@` names, and the comments `[` names. */
  people: BoxPeople
  scope: { here: readonly ReferableComment[]; rest: readonly ReferableComment[] }
  onSave: (written: Written) => Promise<WriteResult>
  onDelete: () => Promise<WriteResult>
  /** ✕ on its sent card: the comment then asks for no card (`value`, its `embed` value). */
  onRemoveCard: (value: string) => Promise<WriteResult>
  /** The replies a deleted comment leaves behind, which the question says stay. */
  replies: number
  /** Whether its edit box is open: the column holds it, so a sign-in ending can put it back (AUT-5). */
  editing: boolean
  onEditing: (open: boolean) => void
  typed: () => JSONContent | null
  onTyped: (body: JSONContent) => void
}

/** Leaf's words on the kit's cards where the kit's differ: the ⋮ menu's, as the approved story drew it (Comments everywhere/Leaf column). */
const LEAF_WORDS = { editLabel: 'Edit message', deleteLabel: 'Delete message', moreLabel: 'More' } as const

/** What a delete is in Leaf, said under the kit's question: the relay decides, and what stays (Peek's `ConfirmDelete` words). */
function deleteNote(replies: number): ReactNode {
  return (
    <>
      <p>Leaf asks the relay to delete it. The relay decides, and copies held by other apps are unaffected.</p>
      {replies > 0 && <p>{replies === 1 ? 'Its reply stays, under “This comment was deleted.”' : `Its ${replies} replies stay, under “This comment was deleted.”`}</p>}
    </>
  )
}

/** "2 minutes ago" inside a sentence: Leaf's time words with a small first letter ("Edited just now"). */
const inSentence = (said: string) => said.charAt(0).toLowerCase() + said.slice(1)

/** What a comment and a reply are drawn from: the comment, the people in the column, and what the viewer may do. */
interface EntryProps {
  comment: CommentItem
  names: Record<string, string>
  now: number
  nameOf: (pubkey: string) => string | undefined
  /** The author's face, from their profile; initials without one. */
  pictures: Record<string, string>
  /** The authors who are agents: their face is the robot. */
  bots: Bots
  page: readonly CommentItem[]
  /** Who is looking: their reactions are lit. */
  viewer?: string
  /** Absent, the reactions only show (signed out, or an archived file). */
  onReact?: OnReact
  /** Present on your own comment: Edit and Delete. */
  own?: OwnActions
  /** An archived file: it only shows (PEEKM-8). */
  closed: boolean
}

/**
 * What the kit's two cards take from one Leaf comment or reply: who, when, "(edited)" with when, Leaf's words
 * ({@link CommentWords}), its files, its reactions, and on your own the edit box and the delete, in Leaf's words. A
 * reaction shows once the relay accepts it, one write at a time until the read after it lands; a refused reaction, a
 * refused ✕ on a sent card and a refused delete each leave things as they were and say why.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-app-writes-and-reacts-with-one-shared-box.md
 */
function useEntry({ comment, names, now, nameOf, pictures, bots, page, viewer, onReact, own, closed }: EntryProps): ConversationEntryProps {
  const reactions = comment.reactions
  // A refused delete keeps the question open and says why, under it (the kit's `deleteRefused`).
  const [deleteRefused, setDeleteRefused] = useState<string>()
  // A refused ✕ leaves the card and says why, as a refused reaction does.
  const [removeRefused, setRemoveRefused] = useState<string | null>(null)
  const removing = useRef(false)
  const removeSentCard = async (value: string) => {
    // One ✕ at a time: a second click before the answer would write the same edit again.
    if (!own || removing.current) return
    removing.current = true
    setRemoveRefused(null)
    const result = await own.onRemoveCard(value).catch((error: unknown) => ({ ok: false, reason: error }) as const)
    removing.current = false
    if (!result.ok) setRemoveRefused(refusalReason(result.reason))
  }
  // One write at a time, until the read after it lands: a second click before then would write from the row as it was.
  const pending = useRef(false)
  useEffect(() => {
    pending.current = false
  }, [comment])
  // The relay's answer goes back to the kit's card, which says a refusal ("Not reacted: …") and keeps it until the next reaction.
  const toggle = async (emoji: string): Promise<{ accepted: true } | { accepted: false; reason: unknown } | undefined> => {
    if (!onReact || pending.current) return undefined
    pending.current = true
    const result = await onReact(comment, emoji, reactions.find((r) => r.emoji === emoji)?.mine).catch((error: unknown) => ({ ok: false, reason: error }) as const)
    if (result.ok) return { accepted: true }
    pending.current = false
    return { accepted: false, reason: result.reason }
  }
  const named = (pubkey: string) => nameOf(pubkey) ?? names[pubkey]
  return {
    ...LEAF_WORDS,
    author: { name: names[comment.by] ?? 'Someone', picture: pictures[comment.by], bot: bots[comment.by] },
    time: whenOf(comment.at, now),
    at: comment.at,
    edited: comment.edited ? `Edited${comment.editedAt === undefined ? '' : ` ${inSentence(whenOf(comment.editedAt, now))}`}` : undefined,
    reactions: { reactions, options: REACTION_OPTIONS, nameOf: (pubkey) => named(pubkey) ?? 'Someone', viewer, onToggle: onReact ? toggle : undefined },
    readOnly: closed,
    own: !!own,
    // The column holds it, so a sign-in ending can put it back (AUT-5).
    editing: !!own?.editing,
    onEditingChange: own && ((open) => own.onEditing(open)),
    editor:
      own &&
      ((done) => (
        <Box
          placeholder="Edit message"
          scope={own.scope}
          people={own.people}
          editing={{ comment, onCancel: done, typed: own.typed, onTyped: own.onTyped }}
          onSend={async (written) => {
            const result = await own.onSave(written)
            if (result.ok) done()
            return result
          }}
        />
      )),
    onDelete:
      own &&
      (async () => {
        setDeleteRefused(undefined)
        const result = await own.onDelete()
        if (!result.ok) setDeleteRefused(refusalSentence('deleted', result.reason))
        return result.ok
      }),
    deleteRefused,
    // Content addressed, so the hash keys each; one file attached twice is the same blob, hence the index.
    files: comment.files.length > 0 ? comment.files.map((file, i) => <FileCard key={`${file.x}_${i}`} file={file} />) : undefined,
    children: <CommentWords comment={comment} names={names} now={now} nameOf={nameOf} pictures={pictures} bots={bots} page={page} onRemoveCard={own && ((value) => void removeSentCard(value))} removeRefused={removeRefused} />,
  }
}

/**
 * A comment's or a reply's words, the kit card's children, as Peek draws a message: its text with its people, chips
 * and rows, the card it carries, and the live part of each block it links.
 */
function CommentWords({
  comment,
  names,
  now,
  nameOf,
  pictures,
  bots,
  page,
  onRemoveCard,
  removeRefused,
}: Pick<EntryProps, 'comment' | 'names' | 'now' | 'nameOf' | 'pictures' | 'bots' | 'page'> & {
  /** ✕ on the card it carries, on your own. */
  onRemoveCard?: (value: string) => void
  /** Why the last ✕ was refused. */
  removeRefused: string | null
}) {
  const blocks = useMemo(() => toRenderTree(comment.body, contentFormatOf(comment.event)), [comment])
  const urgent = useMemo(() => urgentOf(comment), [comment])
  const named = (pubkey: string) => nameOf(pubkey) ?? names[pubkey]
  // Where each line draws, as Peek draws a message (why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md).
  // What its app links name, asked once and drawn again as the answers land: a card or part named only by a URL waits for them.
  const here = useContext(PageHere)
  const resolveLink = useKnownLinks()
  // Asked again on each change to the answers, so a read that failed is retried; one already answered or out costs nothing.
  useEffect(() => {
    void links.ask(linksIn(blocks).slice(0, MAX_LINKS_ASKED)).catch(() => {})
  }, [blocks, resolveLink])
  // The files its app links name, read as its chips are: a link draws as its file only once that file is read (LTX-6).
  const linked = useReferences(linksIn(blocks).flatMap((url) => {
    const value = resolveLink(url)
    const reference = value ? referenceOfValue(value) : undefined
    return reference ? [reference] : []
  }))
  const readableKey = Object.entries(linked).flatMap(([uri, file]) => (file && !file.unreachable ? [uri] : [])).sort().join('\n')
  const placed = useMemo(() => {
    const readable = new Set(readableKey.split('\n'))
    return placeComment(blocks, comment.event, { here, resolveLink, readable: (reference) => readable.has(reference), cards: comment.cards })
  }, [blocks, comment, here, resolveLink, readableKey])
  const messageOf = (quoted: CommentItem) => messageLinkOf(quoted, named, pictures, bots, now, here)
  const reference = (uri: string, opensAt?: string) => <BodyReference uri={uri} urgent={urgent} nameOf={named} page={page} messageOf={messageOf} opensAt={opensAt} />
  const row = (line: RowLine) => <BodyRow line={line} page={page} messageOf={messageOf} fallback={reference(line.reference, line.url)} />
  // The card's words are the kit's size and colour (body-2), as Peek's and Ship's; its blocks 8px apart, the cards and parts too.
  return (
    <>
      <RichText
        blocks={placed.blocks}
        renderReference={(uri, run) => {
          const line = placed.rowRuns.get(run)
          return line ? row(line) : reference(uri, writtenUrlOf(run, resolveLink))
        }}
        renderBlock={(block) => {
          const line = block.type === ROW_BLOCK ? placed.rowOf(block) : undefined
          return line ? row(line) : undefined
        }}
      />
      {placed.cards.length > 0 && (
        <div className="flex flex-col gap-2" data-line-cards={placed.cards.length}>
          {placed.cards.map((card, i) => (
            <CommentCard
              key={`${card.value}-${i}`}
              uri={card.uri}
              compact={card.layout === 'compact'}
              opensAt={card.opensAt}
              onRemove={onRemoveCard && card.layout === 'detailed' ? () => onRemoveCard(card.value) : undefined}
            />
          ))}
        </div>
      )}
      {removeRefused && <FieldLine tone="error">Card not removed: {removeRefused}.</FieldLine>}
      {placed.parts.length > 0 && (
        <div className="flex flex-col gap-2" data-comment-parts={placed.parts.length}>
          {placed.parts.map((part) => (
            <PartView key={`${part.address}#${part.block}`} pointer={part} />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * One of this page's comments as the kit draws a message (widget review, item
 * 53): its author's face and name, its opening words, and when. A comment has
 * no address of its own in Leaf, so it opens the page it is on with its
 * comments shown (`here`, `COMMENTS_HASH`).
 */
function messageLinkOf(quoted: CommentItem, nameOf: (pubkey: string) => string | undefined, pictures: Record<string, string>, bots: Bots, now: number, here: string | undefined): LinkState {
  const name = nameOf(quoted.by) ?? 'Someone'
  const picture = pictures[quoted.by]
  const bot = bots[quoted.by]
  const [kind, pubkey, ...d] = (here ?? '').split(':')
  const page = here ? `${pagePath({ kind: Number(kind), address: here, naddr: encodeNaddr({ kind: Number(kind), pubkey, identifier: d.join(':'), relays: [] }) })}${COMMENTS_HASH}` : ''
  return {
    state: 'ready',
    linked: {
      id: quoted.id,
      kind: 'message',
      title: name,
      href: page,
      author: { name, ...(picture ? { picture } : {}), ...(bot ? { bot } : {}) },
      // An app link in it reads as what it names, never the raw URL (widget review, item 20).
      body: openingWords(quoted.body, nameOf, { resolveLink: links.known }),
      updated: whenOf(quoted.at, now),
    },
  }
}

/**
 * A comment's line that is only a link to a file or a message, as its row
 * (SPEC §13.2): a file as the page's compact card, one of this page's comments
 * as the kit's message row. Anything else keeps the chip it would draw in a
 * sentence, rather than a row with nothing in it.
 */
function BodyRow({ line, page, messageOf, fallback }: { line: RowLine; page: readonly CommentItem[]; messageOf: (quoted: CommentItem) => LinkState; fallback: ReactNode }) {
  if (line.unreadable) return fallback
  if (/^nostr:naddr1/i.test(line.reference)) {
    return (
      <div data-link-row={line.reference.replace(/^nostr:/i, '')}>
        <PageLink uri={line.reference} href={line.url} place="row" />
      </div>
    )
  }
  const id = /^nostr:nevent1/i.test(line.reference) ? eventIdOf(line.reference) : null
  const quoted = id ? page.find((c) => c.id === id) : undefined
  if (!quoted) return fallback
  return (
    <div data-comment-row={quoted.id}>
      <LinkRow link={messageOf(quoted)} />
    </div>
  )
}

/**
 * What a comment's `nostr:` reference draws as, as Peek and Ship draw it: a
 * person as `@Name` (urgent when the comment's `urgent` tags name them, SPEC
 * §13.1), one of this page's comments as the kit's message chip, and a file as
 * the page's own chip. Anything else, or anyone without a name, is its
 * address, quiet.
 */
function BodyReference({
  uri,
  urgent,
  nameOf,
  page,
  messageOf,
  opensAt,
}: {
  uri: string
  urgent: readonly string[]
  nameOf: (pubkey: string) => string | undefined
  page: readonly CommentItem[]
  messageOf: (quoted: CommentItem) => LinkState
  opensAt?: string
}) {
  if (/^nostr:npub1/i.test(uri)) {
    const pubkey = pubkeyOf(uri)
    const name = pubkey ? nameOf(pubkey) : undefined
    if (pubkey && name) {
      return (
        <InlineChip tone={urgent.includes(pubkey) ? 'urgent' : 'person'} data-mention={pubkey}>
          {`@${name}`}
        </InlineChip>
      )
    }
  } else if (/^nostr:nevent1/i.test(uri)) {
    const id = eventIdOf(uri)
    const quoted = id ? page.find((c) => c.id === id) : undefined
    if (quoted) return <LinkChip link={messageOf(quoted)} />
  } else {
    return <PageLink uri={uri} href={opensAt} />
  }
  return (
    <WithTooltip inline label={uri}>
      <InlineChip tone="quiet">{`${uri.replace(/^nostr:/, '').slice(0, 12)}…`}</InlineChip>
    </WithTooltip>
  )
}

/** The key a `nostr:npub…` names, or `null`. */
function pubkeyOf(uri: string): string | null {
  try {
    return decodeNpub(uri)
  } catch {
    return null
  }
}

/** The event id a `nostr:nevent…` names (what `[` writes for a message), or `null`. */
function eventIdOf(uri: string): string | null {
  try {
    return decodeNevent(uri.replace(/^nostr:/i, '')).id
  } catch {
    return null
  }
}

/** The one edit box open in the column, and what is typed in it, held there so a sign-in ending can put both back (AUT-5). */
interface OpenEdit {
  id: string | null
  open: (id: string | null) => void
  typed: () => JSONContent | null
  onTyped: (body: JSONContent) => void
}

/**
 * What the comment's card takes that a reply's does not: what it is on, its replies row, and resolving. Nothing for
 * opening: the kit's layout opens its thread from a press on it, its replies row or Reply (ONE-5, step 4).
 */
type CommentCardProps = Pick<ConversationCardProps, 'about' | 'replies' | 'resolved' | 'onResolve' | 'resolveRefused' | 'onReopen'>

/** A thread's comment on the kit's card, in Leaf's words: "Delete this message?", and Leaf's note with the replies that stay. */
function LeafComment({ card, ...entry }: EntryProps & { card: CommentCardProps }) {
  return <ConversationCard {...useEntry(entry)} {...card} noun="message" deleteNote={deleteNote(entry.own?.replies ?? 0)} />
}

/** A reply on the kit's card: "Delete this reply?", the kit's words and Leaf's, with Leaf's note. */
function LeafReply({ id, ...entry }: EntryProps & { id: string }) {
  return <ReplyCard {...useEntry(entry)} id={id} deleteNote={deleteNote(0)} />
}

/** What a thread's comment and its replies are drawn from: the thread, the people in the column, and what the viewer may do. */
interface ThreadProps {
  thread: Thread
  where: Where
  editor: Editor | null
  names: Record<string, string>
  pictures: Record<string, string>
  bots: Bots
  now: number
  /** Resolve, with the note written in the kit's dialog. */
  onResolve: (note: string) => Promise<WriteResult>
  onReopen: () => void
  onReply: (written: Written) => Promise<WriteResult>
  people: BoxPeople
  /** Every comment on the page, for what `[` offers after this thread's own and for drawing one a comment references. */
  page: readonly CommentItem[]
  viewer?: string
  onReact?: OnReact
  onEdit: (comment: CommentItem, written: Written) => Promise<WriteResult>
  onDelete: (comment: CommentItem) => Promise<WriteResult>
  onRemoveCard: (comment: CommentItem, value: string) => Promise<WriteResult>
  edits: OpenEdit
  /** An archived file: the thread only shows — no reply, reaction, Resolve or Reopen, and no Edit or Delete, your own included (PEEKM-8). */
  closed?: boolean
}

/** What `[` offers in a thread's boxes (its own comments first), and what each of its comments and replies is drawn from. */
function useThreadEntries({ thread, names, pictures, bots, now, people, page, viewer, onReact, onEdit, onDelete, onRemoveCard, edits, closed }: ThreadProps) {
  const own = useMemo(() => commentsOf(thread), [thread])
  const scope = useMemo(() => ({ here: own, rest: page.filter((c) => !own.includes(c)) }), [own, page])
  const actionsOn = (c: CommentItem): OwnActions | undefined =>
    !closed && offersEditAndDelete({ viewer, author: c.by })
      ? {
          people,
          scope,
          onSave: (written) => onEdit(c, written),
          onDelete: () => onDelete(c),
          onRemoveCard: (value) => onRemoveCard(c, value),
          replies: c === thread.root ? thread.replies.length : 0,
          editing: edits.id === c.id,
          onEditing: (opened) => edits.open(opened ? c.id : null),
          typed: edits.typed,
          onTyped: edits.onTyped,
        }
      : undefined
  const entry = (c: CommentItem): EntryProps => ({ comment: c, names, now, nameOf: people.nameOf, pictures, bots, page, viewer, onReact: closed ? undefined : onReact, own: actionsOn(c), closed: !!closed })
  return { scope, entry }
}

/**
 * A thread's comment on the kit's `ConversationCard`, an item's `card` in the kit's layout (ONE-5, step 4): the layout
 * opens its thread from a press on it, its replies row or Reply, and marks it open. Resolve asks for a note (the kit's
 * dialog), and the card then says who resolved it and the note. Its comment gone — deleted, or not read — it says so,
 * still on its place and still resolved when it was, with no reply, Resolve or Reopen, as in Peek and Ship (SPEC §6.5).
 */
function ThreadComment(props: ThreadProps) {
  const { thread, where, editor, names, pictures, bots, now, people, onResolve, onReopen, closed } = props
  const { entry } = useThreadEntries(props)
  const [resolveRefused, setResolveRefused] = useState<string>()
  // Its comment gone, the thread has nothing to resolve or reopen (SPEC §6.5).
  const gone = !thread.root
  const named = (pubkey: string) => people.nameOf(pubkey) ?? names[pubkey] ?? 'Someone'
  const last = thread.replies.at(-1)
  // Who replied, once each, for the replies row's faces.
  const faces = [...new Set(thread.replies.map((r) => r.by))].map((by) => ({ name: names[by] ?? 'Someone', picture: pictures[by], bot: bots[by] }))
  const resolution = thread.resolution
  const card: CommentCardProps = {
    about: aboutOf(thread, where, editor),
    replies: last ? { count: thread.replies.length, faces, last: whenOf(last.at, now) } : undefined,
    resolved: resolution && { by: named(resolution.by), note: resolution.note, at: inSentence(whenOf(resolution.at, now)) },
    onResolve:
      !thread.resolved && !gone && !closed
        ? async (note) => {
            setResolveRefused(undefined)
            const result = await onResolve(note)
            if (!result.ok) setResolveRefused(refusalSentence('resolved', result.reason))
            return result.ok
          }
        : undefined,
    resolveRefused,
    onReopen: thread.resolved && !gone && !closed ? onReopen : undefined,
  }
  return thread.root ? (
    <LeafComment {...entry(thread.root)} card={card} />
  ) : (
    <ConversationCard deleted={thread.gone !== 'missing'} unseen={thread.gone === 'missing'} author={{ name: '' }} time="" {...card}>
      {null}
    </ConversationCard>
  )
}

/**
 * A thread open under its comment, an item's `thread` in the kit's layout: the kit's `Thread`, the replies on
 * `ReplyCard`, then Leaf's reply box. Resolved or archived, no reply box; its comment gone, the box says the kit's
 * one sentence for it, as Peek's and Ship's do.
 */
function ThreadReplies(props: ThreadProps) {
  const { thread, people, onReply, closed } = props
  const { scope, entry } = useThreadEntries(props)
  const opensBox = !thread.resolved && !closed
  // Its comment gone, the thread takes no new replies (SPEC §6.5); deleted while a reply to it is written, the box keeps
  // the text, and Send says why it is refused (ONE-10, Decided 9 November).
  const takesNoReply = !thread.root && !replyHoldsText(thread.id)
  const box = opensBox ? (
    <Box key={thread.id} reply placeholder="Reply…" draftKey={draftKeys.thread(thread.id)} scope={scope} people={people} onSend={onReply} {...(takesNoReply ? { closed: GONE_CLOSED } : {})} />
  ) : undefined
  return (
    <KitThread place="under" box={box}>
      {thread.replies.map((reply) => (
        <LeafReply key={reply.id} id={reply.id} {...entry(reply)} />
      ))}
    </KitThread>
  )
}

/**
 * The caret, for a thread that opens in the kit's layout (K3). The layout counts each time `open` changes, and the box
 * at the open thread's foot takes the caret on each count (`caretOnOpen`). Leaf lets a count through only when the
 * layout itself asked for the open (a press on the card, its replies row, Reply) or when Reply asks again on the open
 * one. Opened any other way, `quiet` — a click in its words in the text, which is often to edit them, or back after a
 * draft — the count this open brings is not passed on, and the caret stays where it is.
 *
 * The open's own count comes a moment after the thread is drawn (the layout's effect): quiet, the box waits for one
 * past it. Once it has come, `onQuiet` tells the column, so the thread drawn again later (moved under "On deleted
 * blocks") counts afresh.
 */
function QuietCaret({ quiet, onQuiet, children }: { quiet: boolean; onQuiet: () => void; children: ReactNode }) {
  const counted = useContext(caretOnOpen)
  const [past] = useState(() => counted + (quiet ? 1 : 0))
  useEffect(() => {
    if (quiet && counted >= past) onQuiet()
  }, [quiet, counted, past, onQuiet])
  return <caretOnOpen.Provider value={counted > past ? counted : 0}>{children}</caretOnOpen.Provider>
}

/** What a new comment will be on, as the card it posts will say it ({@link aboutOf}): the words it quotes, or Leaf's words for its blocks. */
function draftAboutOf(draft: Anchor, editor: Editor | null): ReactNode {
  if (draft.quote) return <QuotedLine words={quoteText(draft.quote)} />
  const place = editor ? commentPlace(editor, { id: DRAFT, ...draft }) : null
  return <QuotedLine label={place ? wholeBlocksLine(editor, place) : 'On whole blocks'} />
}

/** Scroll `box` — a Panel's body — until `el` shows. Only that box moves. */
function scrollWithin(box: HTMLElement | null, el: Element | null) {
  if (!box || !el) return
  const at = el.getBoundingClientRect()
  const view = box.getBoundingClientRect()
  if (at.top < view.top) box.scrollBy({ top: at.top - view.top - 16 })
  else if (at.bottom > view.bottom) box.scrollBy({ top: at.bottom - view.bottom + 16 })
}

/** A thread's comment, while it is not deleted, and its replies. */
const commentsOf = (t: Thread): CommentItem[] => [...(t.root ? [t.root] : []), ...t.replies]

const anchorOf = (t: Thread): CommentAnchor | null => (t.blocks ? { id: t.id, blocks: t.blocks, ...(t.quote ? { quote: t.quote } : {}) } : null)

/**
 * Where a comment was being written when the sign-in ended (AUT-5): the words or blocks it is on, and the thread whose
 * reply box was open. The box's words already live in the draft store; this puts them back on the same place. An open
 * edit box is held here whole, words included.
 */
interface HeldComments {
  draft: Anchor | null
  active: string | null
  /** Your comment whose edit box was open, and the words in it then: the package's edit mode keeps no draft. */
  editing: { id: string; body: JSONContent | null } | null
}
const commentsHoldKey = (address: string | undefined) => (address ? `comments:${address}` : undefined)
export const heldComments = (address: string | undefined) => heldFields<HeldComments>(commentsHoldKey(address))

/** The column's props: the document, its editor, and the block a handle's Comment started a comment on. */
export interface CommentsColumnProps {
  doc: Partial<Commented>
  /** Whether the document's text is a block document, which is what a block can be found in (§13.6). */
  addressable: boolean
  editor: Editor | null
  /** The document's scrolling body, to bring a chosen comment's blocks into view. */
  docBody: RefObject<HTMLDivElement | null>
  /** What a comment is being written on — a block from its handle, or the selection from the strip; `null` for the whole document. */
  draft: Anchor | null
  onDraft: (anchor: Anchor | null) => void
  /** The file is archived: this line takes the box's place, and the comments only show (PEEKM-8). '' is closed too, while the line is read. */
  closed?: string
  /** The column is hidden (LED-3): it keeps an open edit and the chosen thread, and draws no comment on the text. */
  hidden?: boolean
}

/** The comments column of a Leaf document. */
export function CommentsColumn({ doc, addressable, editor, docBody, draft, onDraft, closed, hidden = false }: CommentsColumnProps) {
  const { threads, reactionsOmitted, reactionsCut, failed, readAt, reread } = useThreads(doc)
  const { showToast } = useToast()
  const [held] = useState(() => heldComments(doc.address))
  const [active, setActive] = useState<string | null>(held?.active ?? null)
  // The thread open not by the kit's layout — from its words in the text, or back after a draft — whose box the caret
  // does not go to as it opens ({@link QuietCaret}); `null` once the layout opens one, or the open has been counted.
  const [quiet, setQuiet] = useState<string | null>(null)
  const settled = useCallback(() => setQuiet(null), [])
  // A highlight chosen in the text: its card comes into view in the column, each time; and the thread a sign-in ending
  // held open, once the comments are read (AUT-5).
  const [shown, setShown] = useState<{ id: string } | null>(() => (held?.active ? { id: held.active } : null))
  const [editingId, setEditingId] = useState<string | null>(held?.editing?.id ?? null)
  const typed = useRef<JSONContent | null>(held?.editing?.body ?? null)
  const edits = useMemo<OpenEdit>(
    () => ({
      id: editingId,
      open: (id) => {
        typed.current = null
        setEditingId(id)
      },
      typed: () => typed.current,
      onTyped: (body) => {
        typed.current = body
      },
    }),
    [editingId],
  )
  const holdKey = commentsHoldKey(doc.address)
  useHeldTyping(holdKey, () => {
    const editing = editingId ? { id: editingId, body: typed.current } : null
    return draft || active || editing ? JSON.stringify({ draft, active, editing } satisfies HeldComments) : undefined
  })
  // Taken once it is back (the page took its draft as it drew): a place left open must not come back on the next visit.
  useEffect(() => {
    if (holdKey) releaseHeld(holdKey)
  }, [holdKey])
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

  /*
    The open thread as last read. A comment with no replies leaves the read the moment it is deleted; while its reply
    box holds text it stays on its place, as "This comment was deleted." with the box, so the text is not lost and Send
    says why it is refused (ONE-10, Decided 9 November). Emptied, closed or sent, it goes.
  */
  const [last, setLast] = useState<Thread>()
  const live = threads?.find((t) => t.id === active)
  if (live && live !== last) setLast(live)
  const kept = threads !== null && !live && last && last.id === active && replyHoldsText(last.id) ? last : undefined
  const all = useMemo(() => (kept ? [...(threads ?? []), { ...kept, root: null, replies: [], gone: 'deleted' as const }] : (threads ?? [])), [threads, kept])
  // Authors and reactors: "who reacted" names them too.
  const { names, pictures, bots } = useNames(all.flatMap((t) => commentsOf(t).flatMap((c) => [c.by, ...c.reactions.flatMap((r) => r.by)])))
  const people = useMentionPeople()
  const page = useMemo(() => all.flatMap(commentsOf), [all])
  const pageScope = useMemo(() => ({ here: page, rest: [] }), [page])
  // The files the comments name, read once per tab as the page's own chips are.
  const references = useReferences(useMemo(() => page.flatMap((c) => findNostrUris(c.body).filter((uri) => /^nostr:naddr1/i.test(uri))), [page]))

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
  // A thread whose comment was deleted and whose replies remember no place is drawn apart, after the rest (record a-reply-on-a-page-keeps-its-threads-place).
  const placeless = (t: Thread) => !t.root && !t.blocks
  const open = all.filter((t) => !t.resolved && !placeless(t) && whereOf(t)?.state !== 'detached').sort((a, b) => at(a) - at(b))
  const apart = all.filter((t) => !t.resolved && placeless(t))
  const deleted = all.filter((t) => !t.resolved && whereOf(t)?.state === 'detached')
  const resolved = all.filter((t) => t.resolved)

  // A highlight clicked in the text: its thread opens, and its card comes into view.
  useEffect(() => {
    if (!editor) return
    const select = ({ id }: { id: string }) => {
      if (id === DRAFT) return
      onDraft(null)
      setActive(id)
      // A click in commented words is often to edit them: the caret stays in the text.
      setQuiet(id)
      setShown({ id })
    }
    editor.on('commentSelect', select)
    return () => {
      editor.off('commentSelect', select)
    }
  }, [editor, onDraft])

  // Draw every open comment on its blocks, and what the draft is on while it is written; nothing while hidden.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const anchors = addressable && !hidden ? all.flatMap((t) => (t.resolved ? [] : [anchorOf(t)].filter((a): a is CommentAnchor => !!a))) : []
    if (draft && !hidden) anchors.push({ id: DRAFT, ...draft })
    setCommentAnchors(editor, anchors, hidden ? null : draft ? DRAFT : active)
  }, [editor, all, draft, active, addressable, hidden])

  // A card chosen: its blocks come into view.
  useEffect(() => {
    if (!active || !editor) return
    const thread = all.find((t) => t.id === active)
    const anchor = thread && anchorOf(thread)
    const frame = requestAnimationFrame(() => {
      if (anchor && addressable) scrollWithin(docBody.current, commentElement(editor, anchor))
    })
    return () => cancelAnimationFrame(frame)
  }, [active, editor, all, docBody, addressable])

  // A highlight chosen: its card comes into view, once its thread is drawn open. A card pressed stays where it was:
  // that is the kit's layout's (the pressed comment does not move).
  const read = threads !== null
  useEffect(() => {
    if (!shown || !read) return
    const frame = requestAnimationFrame(() => scrollWithin(columnBody, columnBody?.querySelector(`[data-conversation-item="${CSS.escape(shown.id)}"]`) ?? null))
    return () => cancelAnimationFrame(frame)
  }, [shown, columnBody, read])

  const { address, folder } = doc
  const commented = useMemo(() => (address && folder ? { address, folder } : null), [address, folder])
  const send = useCallback(
    async (written: Written): Promise<WriteResult> => {
      if (!commented) return { ok: false, reason: NO_TEAM }
      const result = await postComment(commented, written, draft ?? undefined)
      if (result.ok) reread()
      return result
    },
    [commented, draft, reread],
  )
  const reply = async (thread: Thread, written: Written): Promise<WriteResult> => {
    if (!commented) return { ok: false, reason: NO_TEAM }
    const result = await postReply(commented, thread, written)
    if (result.ok) reread()
    return result
  }
  // A refused resolve is said in the kit's dialog, which stays open; a refused reopen has no dialog, so a toast says it.
  const resolve = async (thread: Thread, next: boolean, note?: string): Promise<WriteResult> => {
    if (!commented) return { ok: false, reason: NO_TEAM }
    const result = await setResolved(commented, thread, next, note)
    if (!result.ok) return result
    if (next && active === thread.id) setActive(null)
    reread()
    return result
  }
  const reopen = async (thread: Thread) => {
    const result = await resolve(thread, false)
    if (!result.ok) showToast({ label: refusalSentence('reopened', result.reason), type: 'error' })
  }
  const viewer = viewerPubkey() ?? undefined
  const toggleReaction = async (comment: CommentItem, emoji: string, mine?: string): Promise<WriteResult> => {
    const result = mine ? await unreact(mine) : await react(comment, emoji)
    if (result.ok) reread()
    return result
  }
  const edit = async (comment: CommentItem, written: Written): Promise<WriteResult> => {
    const result = await editComment(comment, written)
    if (result.ok) reread()
    return result
  }
  const remove = async (comment: CommentItem): Promise<WriteResult> => {
    const result = await deleteComment(comment)
    if (result.ok) reread()
    return result
  }
  const removeCardOf = async (comment: CommentItem, value: string): Promise<WriteResult> => {
    const result = await removeCard(comment, value)
    if (result.ok) reread()
    return result
  }

  // Back to the whole document: the thread open before the draft comes back, and its box takes no caret from yours.
  const backToWhole = () => {
    setQuiet(active)
    onDraft(null)
  }

  // What each thread's comment and thread are drawn from.
  const propsOf = (t: Thread): ThreadProps => ({
    thread: t,
    where: whereOf(t),
    editor,
    names,
    pictures,
    bots,
    now: readAt,
    onResolve: (note) => resolve(t, true, note),
    onReopen: () => void reopen(t),
    onReply: (written) => reply(t, written),
    people,
    page,
    viewer,
    onReact: viewer ? toggleReaction : undefined,
    onEdit: edit,
    onDelete: remove,
    onRemoveCard: removeCardOf,
    edits,
    closed: closed !== undefined,
  })
  // In Leaf's order: the open ones in the order of the text, the whole document's last, a deleted comment that
  // remembers no place after them. Those on deleted blocks, and the resolved ones, the kit closes under their names at
  // the end. Each thread is drawn only while it is the open one.
  const items: ConversationItem[] = [...open, ...apart, ...deleted, ...resolved].map((t) => ({
    id: t.id,
    card: <ThreadComment {...propsOf(t)} />,
    thread: () => (
      <QuietCaret quiet={quiet === t.id} onQuiet={settled}>
        <ThreadReplies {...propsOf(t)} />
      </QuietCaret>
    ),
    resolved: t.resolved,
    gone: whereOf(t)?.state === 'detached',
  }))

  return (
    <PageHere.Provider value={doc.address}>
      <ReferencesProvider value={references}>
        {/* An archived file's comments only show: their cards' status and owner too (PEEKM-8). */}
        <CardActsProvider value={closed === undefined}>
          <ConversationLayout
            threads="under"
            // Placement: the full height of the column the page puts it in, a `flex flex-col` box (Ship's way).
            className="min-h-0 flex-1"
            title={
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-body-2-strong text-text-primary">Comments</p>
                {open.length > 0 && <Chip type="neutral" label={String(open.length)} className="shrink-0" />}
              </div>
            }
            items={items}
            // A handle's Comment, or the selection's: the draft takes over from the open thread.
            open={draft ? undefined : (active ?? undefined)}
            onOpenChange={(next) => {
              onDraft(null)
              setQuiet(null)
              setActive(next ?? null)
            }}
            bodyRef={setColumnBody}
            loading={threads === null && !failed}
            // Where nothing can be written (an archived page), no hint how to: the kit's own empty line, as Peek's says
            // only that nobody has commented (Katerina, 4 November).
            empty={
              failed ? (
                <EmptyState scope="section" message="Could not read the comments. Try again in a moment." />
              ) : closed === undefined ? (
                'No comments yet. Select words and press Comment, or write below.'
              ) : (
                'No comments yet.'
              )
            }
            // The reaction horizon said out loud (SPEC §6.6): past it, a comment with reactions looks like one nobody reacted to.
            below={(reactionsOmitted > 0 || reactionsCut) && <ReactionHorizon limit={REACTION_HORIZON} omitted={reactionsOmitted} cut={reactionsCut} />}
            box={
              // A new place to comment on is a new box, which takes the focus: its draft keeps what was written.
              <Box
                key={`${address ?? ''}|${draft ? JSON.stringify(draft) : ''}`}
                placeholder={draft ? (draft.quote ? 'Comment on these words…' : draft.blocks.length === 1 ? 'Comment on this block…' : 'Comment on these blocks…') : 'Comment on this document…'}
                draftKey={draftKeys.object(address ?? '')}
                scope={pageScope}
                people={people}
                onSend={send}
                // Back to the whole document once the box has let go of what it sent, so the next box opens empty.
                onSent={backToWhole}
                autoFocus={!!draft && closed === undefined}
                closed={closed}
                about={draft ? { view: draftAboutOf(draft, editor), remove: { label: 'Comment on the whole document instead', onRemove: backToWhole } } : undefined}
              />
            }
          />
        </CardActsProvider>
      </ReferencesProvider>
    </PageHere.Provider>
  )
}
