import { createContext, useContext, useEffect, useReducer } from 'react'
import { createPortal } from 'react-dom'
import { useEditorState, type Editor } from '@tiptap/react'
import { createPeopleCache, createProjectionCache, resolveForeignObjects, type ForeignObject } from '@estiva-app/interop'
import { Card, InlineChip, KindIcon, LinkUnavailable, SkeletonBar, WithTooltip, thingKindOf } from '@estiva-app/ui'
import { useReferenceCards, type ReferenceCard, type ReferenceViewProps } from '@estiva-app/ui/editor'
import { query } from '../relay/bridge'
import { titleOf, typeOf } from '../folders/tree'

/** What each reference names: the file, `null` when it cannot be read, absent while it is being read. */
export type Resolved = Record<string, ForeignObject | null | undefined>

const manifests = createProjectionCache()
const people = createPeopleCache()
const known: Resolved = {}
/** A failed read is asked again this many times, after 5, 10 and 20 seconds. */
const RETRIES = 3
const RETRY_MS = 5000

/** The files a page's references name, read once per tab and shared by every chip and card. */
export function useReferences(uris: readonly string[]): Resolved {
  const key = [...new Set(uris)].sort().join('\n')
  const [, landed] = useReducer((n: number) => n + 1, 0)
  const [attempt, retry] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const missing = key ? key.split('\n').filter((uri) => !(uri in known)) : []
    if (missing.length === 0) return
    let live = true
    let again: ReturnType<typeof setTimeout> | undefined
    for (const uri of missing) known[uri] = undefined
    void resolveForeignObjects(missing, query, people.viaRelay(query), manifests)
      .then((found) => {
        for (const uri of missing) known[uri] = found[uri] ?? null
      })
      .catch(() => {
        // Read again rather than say "cannot be read" for a dropped connection: a row or a card waits on it, not only a chip.
        for (const uri of missing) delete known[uri]
        if (live && attempt < RETRIES) again = setTimeout(retry, RETRY_MS * 2 ** attempt)
      })
      .finally(() => {
        if (live) landed()
      })
    return () => {
      live = false
      clearTimeout(again)
    }
  }, [key, attempt])
  // A new object on every draw, so a chip reading it through context draws again when a read lands.
  return Object.fromEntries((key ? key.split('\n') : []).map((uri) => [uri, known[uri]]))
}

const References = createContext<Resolved>({})

/** Hands the page's read references to every chip inside the editor, whose node views React does not otherwise reach. */
export const ReferencesProvider = References.Provider

/**
 * A `nostr:` reference where it was written (SPEC §13.1), as Katerina's
 * prototype and Peek's `Reference` draw one: the package's InlineChip, the
 * kind's icon, the name cut at 24ch and the whole of it on hover. Anything
 * not read yet, or unreadable, is its address, quiet, never blank. No link
 * while writing: a click on a chip opens its menu (Open, and its card).
 */
export function ReferenceChip({ uri }: ReferenceViewProps) {
  const file = useContext(References)[uri]
  if (file && !file.unreachable) {
    const name = titleOf(file)
    return (
      <WithTooltip inline label={name}>
        <InlineChip tone="neutral" icon={<KindIcon kind={thingKindOf(file.kind)} size={14} tone="inherit" />} className="max-w-[24ch]">
          <span className="truncate">{name}</span>
        </InlineChip>
      </WithTooltip>
    )
  }
  return (
    <WithTooltip inline label={uri}>
      <InlineChip tone="quiet">{`${uri.replace(/^nostr:/, '').slice(0, 12)}…`}</InlineChip>
    </WithTooltip>
  )
}

/** One file a reference names, as the card its writer chose: a row (compact) or a card with its type (detailed). */
function ReferenceObject({ file, layout }: { file: ForeignObject; layout: ReferenceCard['layout'] }) {
  const opener = file.openUrl && /^https?:\/\//i.test(file.openUrl) ? file.openUrl : undefined
  return (
    // Opened beside Leaf, as "Open in" does: a click on a card never takes the page away.
    <Card
      hover={opener ? 'fill' : 'none'}
      onClick={opener ? () => window.open(opener, '_blank', 'noopener') : undefined}
      className="flex items-center gap-2 px-3 py-2"
      data-reference-card={layout}
    >
      <KindIcon kind={thingKindOf(file.kind)} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body-2-strong text-text-primary">{titleOf(file)}</span>
        {/* Its summary, on the card that has room for it (SPEC §6.12); a row stays one line. */}
        {layout === 'detailed' && file.slots.subtitle && (
          <span className="line-clamp-2 break-words text-body-2 text-text-secondary">{file.slots.subtitle.value}</span>
        )}
        {layout === 'detailed' && <span className="truncate text-body-2 text-text-secondary">{typeOf(file)}</span>}
      </span>
    </Card>
  )
}

/** The cards one line asks for, under it: a placeholder while a file is read, nothing for one that cannot be. */
export function LineCards({ cards, resolved }: { cards: readonly ReferenceCard[]; resolved: Resolved }) {
  if (cards.length === 0) return null
  return (
    <div className="mt-2 flex flex-col gap-2" data-line-cards={cards.length}>
      {cards.map((card, i) => {
        const file = resolved[card.uri]
        if (file === undefined) return <SkeletonBar key={`${card.uri}-${i}`} className="h-12 w-full" />
        if (file === null || file.unreachable) return null
        return <ReferenceObject key={`${card.uri}-${i}`} file={file} layout={card.layout} />
      })}
    </div>
  )
}

/**
 * A file alone on a comment's line, drawn as its row in place (SPEC §13.2):
 * the page's compact card, a placeholder while it is read, and its chip when
 * it cannot be read, so the link never goes blank.
 */
export function ReferenceRow({ uri }: { uri: string }) {
  return <PlacedObject uri={uri} layout="compact" />
}

/**
 * The cards a comment's writer carried (SPEC §13.6.2), under its text, read
 * from the page's references. Its line drew nothing, since the card stands
 * for it, so one that cannot be read still says so rather than vanish, as
 * Peek's card under a message does.
 */
export function CarriedCards({ cards }: { cards: readonly ReferenceCard[] }) {
  if (cards.length === 0) return null
  return (
    <div className="mt-2 flex flex-col gap-2" data-line-cards={cards.length}>
      {cards.map((card, i) => (
        <PlacedObject key={`${card.uri}-${i}`} uri={card.uri} layout={card.layout} />
      ))}
    </div>
  )
}

/** A file a comment draws in a row or a card of its own: a placeholder while it is read, "not available" when it cannot be. */
function PlacedObject({ uri, layout }: { uri: string; layout: ReferenceCard['layout'] }) {
  const file = useContext(References)[uri]
  if (file === undefined) return <SkeletonBar className="h-10 w-full" />
  if (file === null || file.unreachable) {
    const noun = file?.noun ?? 'File'
    return (
      <span data-reference-unavailable>
        <LinkUnavailable kind={file ? thingKindOf(file.kind) : 'file'} noun={noun.charAt(0).toUpperCase() + noun.slice(1)} />
      </span>
    )
  }
  return <ReferenceObject file={file} layout={layout} />
}

/** Every reference in the editor's document, so each chip and card has its file read. */
export function useEditorReferences(editor: Editor | null): Resolved {
  const key = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed || ed.isDestroyed) return ''
      const uris = new Set<string>()
      ed.state.doc.descendants((node) => {
        if (node.type.name === 'reference' && node.attrs.uri) uris.add(String(node.attrs.uri))
      })
      return [...uris].join('\n')
    },
  })
  return useReferences(key ? key.split('\n') : [])
}

/** The cards each line asks for, drawn into the slot `ReferenceCards` leaves after it (SPEC §13.3), as Ship's description does. */
export function EditorLineCards({ editor, resolved }: { editor: Editor | null; resolved: Resolved }) {
  const slots = useReferenceCards(editor)
  const own = useReferences(slots.flatMap((slot) => slot.cards.map((card) => card.uri)))
  const all = { ...own, ...resolved }
  // @estiva-escape(no-rebuilt-behaviour): not a layer over the page — the cards go into the slot `ReferenceCards` leaves in the document after their line, as Ship's `EditorLineCards` does.
  return <>{slots.map((slot) => createPortal(<LineCards cards={slot.cards} resolved={all} />, slot.element, slot.key))}</>
}
