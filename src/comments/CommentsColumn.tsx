import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { Extension } from '@tiptap/core'
import type { Editor, JSONContent } from '@tiptap/react'
import { IconArrowBackUp, IconCircleCheck, IconDotsVertical, IconMessage, IconPencil, IconTrash, IconX } from '@tabler/icons-react'
import {
  boxReadOf,
  composerDocument,
  composerDraft,
  composerText,
  createDraftStore,
  draftKeys,
  embedsToSend,
  groupReactions,
  offersEditAndDelete,
  REACTION_EMOJI,
  REACTION_HORIZON,
  type DraftStore,
} from '@estiva-app/conversation'
import { contentFormatOf, decodeNevent, decodeNpub, findNostrUris, toRenderTree, type EditorDocument, type Imeta } from '@estiva-app/protocol'
import {
  AddReactionButton,
  Card,
  Chip,
  CollapsibleSection,
  ConfirmDialog,
  EmptyState,
  FieldLine,
  IconButton,
  InlineChip,
  Menu,
  MenuItem,
  MenuPanel,
  Panel,
  Person,
  ReactionRow,
  RichText,
  SkeletonList,
  WithTooltip,
  useToast,
} from '@estiva-app/ui'
import {
  CommentBox,
  commentBoxRows,
  commentElement,
  commentPlace,
  LinkChips,
  quoteText,
  setCommentAnchors,
  type CommentAnchor,
  type CommentPlace,
  type BoxFile,
  type BoxSentUnder,
  type BoxUnder,
  type MentionPerson,
  type SendAnswer,
  type UploadAnswer,
} from '@estiva-app/ui/editor'
import { nameOf } from '../document/save'
import { commentReferenceSections, snippetOf, subscribeReferences, type ReferableComment } from '../document/referencePicker'
import { CarriedCards, PlacedObject, ReferenceChip, ReferenceRow, ReferencesProvider, useReferences } from '../document/references'
import { linksIn, placeComment, referenceOfValue, ROW_BLOCK, type RowLine } from './commentLines'
import { askLinks, knownBlockOf, knownLinkValue, linkReferenceOf, linksChanged, useKnownLinks } from './links'
import { PartView } from './PartView'
import { exactly, whenOf } from '../home/recent'
import { deleteComment, editComment, postComment, postReply, react, setResolved, unreact, type Anchor, type Commented, type CommentItem, type Thread, type WriteResult, type Written } from './comments'
import { viewerPubkey } from '../relay/bridge'
import { uploadFile } from '../relay/blobs'
import { CommentFiles } from './CommentFiles'
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

/** The names of the people in the column, from their profiles: each one as it comes, kept once found. */
function useNames(pubkeys: readonly string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})
  const asked = useRef(new Set<string>())
  const key = [...new Set(pubkeys)].sort().join(',')
  useEffect(() => {
    for (const pk of key ? key.split(',') : []) {
      if (asked.current.has(pk)) continue
      asked.current.add(pk)
      void nameOf(pk)
        .catch(() => null)
        .then((name) => {
          if (name) setNames((was) => ({ ...was, [pk]: name }))
        })
    }
  }, [key])
  return names
}

// Ship's `/` Insert rows (Miky, 16 October), after the shared Format section. An edit drops File and Urgent itself.
const INSERT = [commentBoxRows.file, commentBoxRows.mention, commentBoxRows.urgent, commentBoxRows.reference]

/** The box's upload: the file goes on the relay at once, and its `imeta` is what the send names (COMM-6). */
async function upload(file: File): Promise<UploadAnswer> {
  const answer = await uploadFile(file)
  return answer.ok ? { accepted: true, value: answer.file } : { accepted: false, reason: answer.reason }
}

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

/** The page the column's comments are on: its file gets no card under a comment, and its blocks no part (Miky, 2026-10-19). */
const PageHere = createContext<string | undefined>(undefined)

/** A pasted app URL becomes its file's chip, as in Peek (`LinkChips`, §7.7). */
const linkChips = () => LinkChips.configure({ referenceOf: linkReferenceOf, ask: askLinks })

/**
 * What shows under the box while a new comment is written (COMM-8): the one
 * file it names, as the card it will be sent with, and the live part of each
 * block link — read as Peek reads its box (`boxReadOf`), from what each app
 * link names as answered so far. Each read asks about the links not answered
 * yet; an answer coming back reads again.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md
 */
function boxUnder(here: string | undefined): BoxUnder {
  return {
    read: (body) => {
      const links = boxReadOf(body as EditorDocument, { resolveLink: knownLinkValue, blockOf: knownBlockOf, here })
      void askLinks(links.urls).catch(() => {})
      const uri = links.card ? referenceOfValue(links.card) : undefined
      return {
        card: links.card && uri ? { value: links.card, view: <PlacedObject uri={uri} layout="detailed" /> } : undefined,
        parts: links.parts.map((part) => ({ key: `${part.address}#${part.block}`, view: <PartView pointer={part} /> })),
        names: [...links.values, ...links.parts.map((part) => part.address)],
      }
    },
    changed: linksChanged,
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
}: {
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
}) {
  // Names from the latest read of the people, when the draft opens: they may land after the box does.
  const draft = useMemo(() => (draftKey ? composerDraft(draftStore(), draftKey, { personLabel: knownName }) : undefined), [draftKey])
  const here = useContext(PageHere)
  // An edit carries no `part`, and Leaf does not fold an edit's `embed` set yet, so the edit box shows nothing under it.
  const isEdit = !!editing
  const under = useMemo(() => (isEdit ? undefined : boxUnder(here)), [isEdit, here])
  const send = async (body: JSONContent, files: readonly BoxFile[] = [], shown: BoxSentUnder = {}): Promise<SendAnswer> => {
    const attached = filesOf(files)
    // What was under the box as it was sent: the card unless ✕ took it off, and the parts as they read now.
    const parts = under ? boxReadOf(body as EditorDocument, { resolveLink: knownLinkValue, blockOf: knownBlockOf, here }).parts : []
    const cards = under ? embedsToSend({ card: shown.card }, new Set()) : []
    const written = {
      ...composerText(body as EditorDocument),
      ...(attached.length ? { files: attached } : {}),
      ...(cards.length ? { cards } : {}),
      ...(parts.length ? { parts } : {}),
    }
    const result = await onSend(written)
    return result.ok ? { accepted: true } : { accepted: false, reason: result.reason }
  }
  // The words an edit opens with are the comment's as the edit began: a re-read while editing does not reset them.
  const [opened] = useState(() =>
    editing ? (editing.typed?.() ?? (composerDocument(editing.comment.body, { personLabel: knownName }, urgentOf(editing.comment)) as JSONContent)) : undefined,
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
  const edit = editing && opened ? { body: opened, onCancel: editing.onCancel, onSave: (body: JSONContent) => send(body) } : undefined
  return (
    <CommentBox
      label={placeholder}
      placeholder={<span>{placeholder}</span>}
      people={people.people}
      references={(typed) => commentReferenceSections(scope, typed, people.nameOf)}
      referencesChanged={subscribeReferences}
      referenceView={ReferenceChip}
      insert={INSERT}
      draft={edit ? undefined : draft}
      edit={edit}
      extensions={extensions}
      upload={upload}
      send={send}
      under={under}
      autoFocus={autoFocus || !!edit}
      onSent={onSent ? () => onSent() : undefined}
    />
  )
}

/** Where a thread is now: its §13.6 state, from the editor's text. `unaddressable`: the document is not a block document. */
type Where = CommentPlace | { state: 'unaddressable' } | null

/** What a thread is about, in one line — the one place its states differ on a card. */
function AnchorLine({ thread, where, editor, names }: { thread: Thread; where: Where; editor: Editor | null; names: Record<string, string> }) {
  // A deleted comment whose replies remember no place: where it was is not known, so nothing is said (record a-reply-on-a-page-keeps-its-threads-place).
  if (!thread.root && !thread.blocks) return null
  if (!thread.blocks || !where) return <p className="text-caption text-text-muted">On the whole document</p>
  if (where.state === 'unaddressable') return <p data-anchor-state="unaddressable" className="text-caption italic text-text-muted">On a part of this document Leaf cannot show</p>
  const quoted = thread.quote ? `“${quoteText(thread.quote)}”` : null
  const by = (thread.root && names[thread.root.by]) || 'Someone'
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
  /** It is a reply, not the thread's comment: what the delete question names. */
  reply: boolean
  /** The replies a deleted comment leaves behind, which the question says stay. */
  replies: number
  /** Whether its edit box is open: the column holds it, so a sign-in ending can put it back (AUT-5). */
  editing: boolean
  onEditing: (open: boolean) => void
  typed: () => JSONContent | null
  onTyped: (body: JSONContent) => void
}

/** The ⋮ menu on your own comment, as the approved story draws it (Comments everywhere/Leaf column). */
function OwnMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <Menu
      align="right"
      trigger={
        <IconButton variant="muted" tooltip="More" aria-label="More">
          <IconDotsVertical size={16} stroke={1.5} />
        </IconButton>
      }
    >
      <MenuPanel className="min-w-[180px]">
        <MenuItem label="Edit message" leading={<IconPencil size={16} stroke={1.5} />} onClick={onEdit} />
        <MenuItem label="Delete message" destructive leading={<IconTrash size={16} stroke={1.5} />} onClick={onDelete} />
      </MenuPanel>
    </Menu>
  )
}

/**
 * The question before a delete, in Peek's words (`ConfirmDelete`), and that the
 * replies stay. A refusal keeps it open and says why.
 */
function ConfirmDeleteComment({ own, onClose }: { own: OwnActions; onClose: () => void }) {
  const noun = own.reply ? 'reply' : 'message'
  const [refused, setRefused] = useState<string | null>(null)
  return (
    <ConfirmDialog
      title={`Delete this ${noun}?`}
      confirmLabel={`Delete ${noun}`}
      destructive
      onConfirm={async () => {
        setRefused(null)
        const result = await own.onDelete()
        if (!result.ok) setRefused(result.reason)
        return result.ok
      }}
      onClose={onClose}
    >
      <p>Leaf asks the relay to delete it. The relay decides, and copies held by other apps are unaffected.</p>
      {own.replies > 0 && <p>{own.replies === 1 ? 'Its reply stays, under “This comment was deleted.”' : `Its ${own.replies} replies stay, under “This comment was deleted.”`}</p>}
      {refused && <FieldLine tone="error">{refused}</FieldLine>}
    </ConfirmDialog>
  )
}

/**
 * One comment or reply in a card: who, when, the text, and its reactions. The
 * add button sits on the header line, shown on hover or focus as in the
 * approved story (Comments everywhere/Leaf column). A reaction shows once the
 * relay accepts it; a refused one leaves the row as it was and says why.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-app-writes-and-reacts-with-one-shared-box.md
 */
function CommentLine({
  comment,
  names,
  now,
  nameOf,
  page,
  viewer,
  onReact,
  own,
}: {
  comment: CommentItem
  names: Record<string, string>
  now: number
  nameOf: (pubkey: string) => string | undefined
  page: readonly CommentItem[]
  /** Who is looking: their reactions are lit. */
  viewer?: string
  /** Absent, the reactions only show (signed out). */
  onReact?: OnReact
  /** Present on your own comment: Edit and Delete. */
  own?: OwnActions
}) {
  const editing = !!own?.editing
  const setEditing = (open: boolean) => own?.onEditing(open)
  const [confirming, setConfirming] = useState(false)
  const reactions = useMemo(() => groupReactions(comment.reactions, viewer)[comment.id] ?? [], [comment, viewer])
  const [refused, setRefused] = useState<string | null>(null)
  // One write at a time, until the read after it lands: a second click before then would write from the row as it was.
  const pending = useRef(false)
  useEffect(() => {
    pending.current = false
  }, [comment])
  const toggle = async (emoji: string) => {
    if (!onReact || pending.current) return
    pending.current = true
    setRefused(null)
    const result = await onReact(comment, emoji, reactions.find((r) => r.emoji === emoji)?.mine).catch(() => ({ ok: false, reason: 'it did not go through' }) as const)
    if (!result.ok) {
      pending.current = false
      setRefused(result.reason)
    }
  }
  const blocks = useMemo(() => toRenderTree(comment.body, contentFormatOf(comment.event)), [comment])
  const urgent = useMemo(() => urgentOf(comment), [comment])
  const named = (pubkey: string) => nameOf(pubkey) ?? names[pubkey]
  // Where each line draws, as Peek draws a message (why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md).
  // What its app links name, asked once and drawn again as the answers land: a card or part named only by a URL waits for them.
  const here = useContext(PageHere)
  const resolveLink = useKnownLinks()
  useEffect(() => {
    void askLinks(linksIn(blocks)).catch(() => {})
  }, [blocks])
  const placed = useMemo(() => placeComment(blocks, comment.event, { here, resolveLink }), [blocks, comment, here, resolveLink])
  const reference = (uri: string) => <BodyReference uri={uri} urgent={urgent} nameOf={named} page={page} />
  const row = (line: RowLine) => <BodyRow line={line} nameOf={named} page={page} fallback={reference(line.reference)} />
  return (
    <div data-comment-id={comment.id} className="group/comment flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 text-body-2-strong text-text-primary">
          <Person name={names[comment.by] ?? 'Someone'} />
        </span>
        <WithTooltip label={exactly(comment.at * 1000)}>
          <span className="whitespace-nowrap text-caption text-text-muted">{whenOf(comment.at * 1000, now)}</span>
        </WithTooltip>
        {comment.edited && <span className="text-caption text-text-muted">(edited)</span>}
        {(onReact || own) && !editing && (
          <div className="-my-1 ml-auto flex items-center opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100">
            {onReact && <AddReactionButton options={REACTION_OPTIONS} onPick={(emoji) => void toggle(emoji)} />}
            {own && <OwnMenu onEdit={() => setEditing(true)} onDelete={() => setConfirming(true)} />}
          </div>
        )}
      </div>
      {editing && own ? (
        <Box
          placeholder="Edit message"
          scope={own.scope}
          people={own.people}
          editing={{ comment, onCancel: () => setEditing(false), typed: own.typed, onTyped: own.onTyped }}
          onSend={async (written) => {
            const result = await own.onSave(written)
            if (result.ok) setEditing(false)
            return result
          }}
        />
      ) : (
        <>
          <RichText
            blocks={placed.blocks}
            size="small"
            renderReference={(uri, run) => {
              const line = placed.rowRuns.get(run)
              return line ? row(line) : reference(uri)
            }}
            renderBlock={(block) => {
              const line = block.type === ROW_BLOCK ? placed.rowOf(block) : undefined
              return line ? row(line) : undefined
            }}
          />
          <CarriedCards cards={placed.cards} />
          {placed.parts.length > 0 && (
            <div className="mt-2 flex flex-col gap-2" data-comment-parts={placed.parts.length}>
              {placed.parts.map((part) => (
                <PartView key={`${part.address}#${part.block}`} pointer={part} />
              ))}
            </div>
          )}
        </>
      )}
      {/* Under the edit box too: an edit leaves a comment's files as they are. */}
      <CommentFiles files={comment.files} />
      {confirming && own && <ConfirmDeleteComment own={own} onClose={() => setConfirming(false)} />}
      <ReactionRow reactions={reactions} options={REACTION_OPTIONS} nameOf={(pubkey) => named(pubkey) ?? 'Someone'} viewer={viewer} onToggle={onReact ? (emoji) => void toggle(emoji) : undefined} className="pt-1" />
      {refused && <FieldLine tone="error">Not reacted: {refused}.</FieldLine>}
    </div>
  )
}

/**
 * A comment's line that is only a link to a file or a message, as its row
 * (SPEC §13.2): a file as the page's compact card, one of this page's comments
 * as its author and opening words. Anything else keeps the chip it would draw
 * in a sentence, rather than a row with nothing in it.
 */
function BodyRow({ line, nameOf, page, fallback }: { line: RowLine; nameOf: (pubkey: string) => string | undefined; page: readonly CommentItem[]; fallback: ReactNode }) {
  if (line.unreadable) return fallback
  if (/^nostr:naddr1/i.test(line.reference)) return <ReferenceRow uri={line.reference} />
  const id = /^nostr:nevent1/i.test(line.reference) ? eventIdOf(line.reference) : null
  const quoted = id ? page.find((c) => c.id === id) : undefined
  if (!quoted) return fallback
  return (
    <Card className="flex items-center gap-2 px-3 py-2" data-comment-row={quoted.id}>
      <IconMessage size={16} stroke={1.5} />
      <span className="truncate text-body-2 text-text-secondary">{`${nameOf(quoted.by) ?? 'Someone'}: ${snippetOf(quoted.body, nameOf)}`}</span>
    </Card>
  )
}

/**
 * What a comment's `nostr:` reference draws as, as Peek and Ship draw it: a
 * person as `@Name` (urgent when the comment's `urgent` tags name them, SPEC
 * §13.1), one of this page's comments as its author and opening words, and a
 * file as the page's own chip. Anything else, or anyone without a name, is its
 * address, quiet.
 */
function BodyReference({ uri, urgent, nameOf, page }: { uri: string; urgent: readonly string[]; nameOf: (pubkey: string) => string | undefined; page: readonly CommentItem[] }) {
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
    if (quoted) {
      const words = `${nameOf(quoted.by) ?? 'Someone'}: ${snippetOf(quoted.body, nameOf)}`
      return (
        <WithTooltip inline label={words}>
          <InlineChip tone="neutral" icon={<IconMessage size={14} stroke={1.5} />} className="max-w-full">
            <span className="truncate">{words}</span>
          </InlineChip>
        </WithTooltip>
      )
    }
  } else {
    return <ReferenceChip uri={uri} />
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
  people,
  page,
  viewer,
  onReact,
  onEdit,
  onDelete,
  edits,
}: {
  thread: Thread
  where: Where
  editor: Editor | null
  names: Record<string, string>
  now: number
  active: boolean
  onActivate: () => void
  onResolve: (resolved: boolean) => void
  onReply: (written: Written) => Promise<WriteResult>
  people: BoxPeople
  /** Every comment on the page, for what `[` offers after this thread's own and for drawing one a comment references. */
  page: readonly CommentItem[]
  viewer?: string
  onReact?: OnReact
  onEdit: (comment: CommentItem, written: Written) => Promise<WriteResult>
  onDelete: (comment: CommentItem) => Promise<WriteResult>
  edits: OpenEdit
}) {
  const own = useMemo(() => commentsOf(thread), [thread])
  const scope = useMemo(() => ({ here: own, rest: page.filter((c) => !own.includes(c)) }), [own, page])
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, [role="button"], [data-interactive], [contenteditable="true"]')) return
    onActivate()
  }
  // Its comment deleted, the thread takes no new replies and has nothing to resolve, as in Peek (PER-24).
  const deleted = !thread.root
  const actionsOn = (c: CommentItem): OwnActions | undefined =>
    offersEditAndDelete({ viewer, author: c.by })
      ? {
          people,
          scope,
          onSave: (written) => onEdit(c, written),
          onDelete: () => onDelete(c),
          reply: c !== thread.root,
          replies: c === thread.root ? thread.replies.length : 0,
          editing: edits.id === c.id,
          onEditing: (open) => edits.open(open ? c.id : null),
          typed: edits.typed,
          onTyped: edits.onTyped,
        }
      : undefined
  const line = (c: CommentItem) => <CommentLine key={c.id} comment={c} names={names} now={now} nameOf={people.nameOf} page={page} viewer={viewer} onReact={onReact} own={actionsOn(c)} />
  return (
    <Card data-thread-id={thread.id} data-active={active || undefined} data-resolved={thread.resolved || undefined} data-deleted={deleted || undefined} hover="fill" quietUntilHover selected={active} onClick={click} className="flex shrink-0 flex-col gap-3 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <AnchorLine thread={thread} where={where} editor={editor} names={names} />
        </div>
        {deleted ? null : thread.resolved ? (
          <IconButton tooltip="Reopen" aria-label="Reopen" onClick={() => onResolve(false)}>
            <IconArrowBackUp size={16} stroke={1.5} />
          </IconButton>
        ) : (
          <IconButton variant="resolve" tooltip="Resolve" aria-label="Resolve" onClick={() => onResolve(true)}>
            <IconCircleCheck size={16} stroke={1.5} />
          </IconButton>
        )}
      </div>
      {deleted && <p className="text-body-2 italic text-text-muted">This comment was deleted.</p>}
      {own.map(line)}
      {active && !thread.resolved && !deleted && <Box key={thread.id} placeholder="Reply…" draftKey={draftKeys.thread(thread.id)} scope={scope} people={people} onSend={onReply} />}
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
}

/** The comments column of a Leaf document. */
export function CommentsColumn({ doc, addressable, editor, docBody, draft, onDraft }: CommentsColumnProps) {
  const { threads, reactionsOmitted, reactionsCut, failed, readAt, reread } = useThreads(doc)
  const { showToast } = useToast()
  const [held] = useState(() => heldComments(doc.address))
  const [active, setActive] = useState<string | null>(held?.active ?? null)
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

  const all = useMemo(() => threads ?? [], [threads])
  // Authors and reactors: "who reacted" names them too.
  const names = useNames(all.flatMap((t) => commentsOf(t).flatMap((c) => [c.by, ...c.reactions.map((r) => r.by)])))
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

  // Draw every open comment on its blocks, and what the draft is on while it is written.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const anchors = addressable ? all.flatMap((t) => (t.resolved ? [] : [anchorOf(t)].filter((a): a is CommentAnchor => !!a))) : []
    if (draft) anchors.push({ id: DRAFT, ...draft })
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
    async (written: Written): Promise<WriteResult> => {
      if (!commented) return { ok: false, reason: 'this page is not in a Folder yet' }
      const result = await postComment(commented, written, draft ?? undefined)
      if (result.ok) reread()
      return result
    },
    [commented, draft, reread],
  )
  const reply = async (thread: Thread, written: Written): Promise<WriteResult> => {
    if (!commented) return { ok: false, reason: 'this page is not in a Folder yet' }
    const result = await postReply(commented, thread, written)
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

  const draftPlace = editor && draft ? commentPlace(editor, { id: DRAFT, ...draft }) : null
  const draftLine = draft?.quote ? `On “${quoteText(draft.quote)}”` : draftPlace ? wholeBlocksLine(editor, draftPlace) : ''

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
      onReply={(written) => reply(t, written)}
      people={people}
      page={page}
      viewer={viewer}
      onReact={viewer ? toggleReaction : undefined}
      onEdit={edit}
      onDelete={remove}
      edits={edits}
    />
  )

  return (
    <PageHere.Provider value={doc.address}>
      <ReferencesProvider value={references}>
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
              {/* A new place to comment on is a new box, which takes the focus: its draft keeps what was written. */}
              <Box
                key={`${address ?? ''}|${draft ? JSON.stringify(draft) : ''}`}
                placeholder={draft ? (draft.quote ? 'Comment on these words…' : draft.blocks.length === 1 ? 'Comment on this block…' : 'Comment on these blocks…') : 'Comment on this document…'}
                draftKey={draftKeys.object(address ?? '')}
                scope={pageScope}
                people={people}
                onSend={send}
                // Back to the whole document once the box has let go of what it sent, so the next box opens empty.
                onSent={() => onDraft(null)}
                autoFocus={!!draft}
              />
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
            <EmptyState scope="section" message="No comments yet. Select words and press Comment, or write below." />
          ) : (
            <>
              {open.map(card)}
              {apart.map(card)}
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
              {(reactionsOmitted > 0 || reactionsCut) && (
                // The reaction horizon said out loud, in Peek's words (SPEC §6.6): past it, a comment with reactions looks like one nobody reacted to.
                <p className="shrink-0 text-caption text-text-muted">
                  {reactionsOmitted > 0 &&
                    `Reactions are shown for ${REACTION_HORIZON} comments and replies on this page. ${reactionsOmitted} older ${reactionsOmitted === 1 ? 'one was' : 'ones were'} not checked.`}
                  {reactionsOmitted > 0 && reactionsCut && ' '}
                  {reactionsCut && 'Some reactions may be missing.'}
                </p>
              )}
            </>
          )}
        </Panel>
      </ReferencesProvider>
    </PageHere.Provider>
  )
}
