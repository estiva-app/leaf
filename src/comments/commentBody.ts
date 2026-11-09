import {
  cardsIn,
  embedsOf,
  encodeNaddr,
  linksAsReferences,
  partsOf,
  referencesIn,
  valueOfReference,
  valuesIn,
  type Embed,
  type LinkResolver,
  type PartPointer,
  type RenderBlock,
} from '@estiva-app/protocol'
import { MAX_PARTS, ownFileOf, placeLines, writtenUrlOf, type PlacedLines } from '@estiva-app/conversation'

/** The `nostr:` reference a file's address is written as, for its chip and card; undefined for anything that is not an address. */
export function referenceOfValue(value: string): string | undefined {
  const [kind, pubkey, ...d] = value.split(':')
  if (!/^\d+$/.test(kind ?? '') || !/^[0-9a-f]{64}$/i.test(pubkey ?? '') || d.length === 0) return undefined
  return `nostr:${encodeNaddr({ kind: Number(kind), pubkey, identifier: d.join(':'), relays: [] })}`
}

/** A card its writer carried under the comment (`embed`, SPEC §13.6.2), by the reference the body wrote, as a page's line carries one. */
export interface CarriedCard {
  uri: string
  /** Its `embed` value, which ✕ writes as `none`. */
  value: string
  layout: Exclude<Embed['layout'], 'none'>
  /** The first URL the body wrote for its file: the card opens it, as Peek's and Ship's do (LTX-6). */
  opensAt?: string
}

/** A comment's lines, placed by the shared line rule, and what draws under it. */
export interface PlacedComment extends PlacedLines {
  /** What draws under the comment, in the order its writer carried them. */
  cards: CarriedCard[]
  /** The live blocks under it (`part`, §13.6.1), while the body still names their file; none of this page. */
  parts: PartPointer[]
}

/** What a reader needs beyond the comment: the page it is on, and what an app link names, as answered so far (§7.7). */
export interface PlaceContext {
  here?: string
  resolveLink?: LinkResolver
  /**
   * Whether the file a `nostr:` reference names has been read and can be:
   * an app URL draws as its file's chip or row only then, and until then, or
   * for good when it cannot be, stays the URL it was written as (Ship's OPT-18).
   * Without it, every URL stays as written.
   */
  readable?: (reference: string) => boolean
  /** The comment's cards as its edits left them (`CommentItem.cards`); without it, the event's own `embed` set. */
  cards?: readonly Embed[]
}

/**
 * A comment's body as Leaf draws it: its lines by the line rule every app
 * shares (`placeLines`, SPEC §13.2, §13.6.2, C21), and under it the cards its
 * writer carried (`embed`, §13.6.2) and the blocks it linked live (`part`,
 * §13.6.1). Each of those draws only while the body still names its file, by a
 * `nostr:` reference or an app link (`cardsIn` with `resolveLink`); a part of
 * the page the comment is on draws nothing (Miky, 2026-10-19), and the page
 * itself stays its chip, never its row.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md
 */
export function placeComment(body: readonly RenderBlock[], event: { tags: readonly (readonly string[])[] }, context: PlaceContext = {}): PlacedComment {
  const { here, resolveLink, readable } = context
  // An app URL whose file has been read is that file's reference, its run keeping the URL as its text, as Peek and Ship read one (LTX-6).
  const blocks: RenderBlock[] =
    resolveLink && readable
      ? linksAsReferences(body, (url) => {
          // Only a link its chip can open as written (https, `links.opener`): any other stays the link it was.
          if (!/^https:\/\//i.test(url)) return undefined
          const value = resolveLink(url)
          const reference = value ? referenceOfValue(value) : undefined
          return reference && readable(reference) ? value : undefined
        })
      : [...body]
  const named = new Set(valuesIn(blocks, resolveLink))
  // At most six live under one comment (§13.6.1): each one re-reads its file every 30 s.
  const parts = partsOf({ tags: event.tags.map((t) => [...t]) })
    .filter((part) => part.address !== here && named.has(part.address))
    .slice(0, MAX_PARTS)
  // A file's card only: Leaf reads files, not another app's messages, so a message's line keeps its row instead of a card that never loads.
  const embeds = (context.cards ?? embedsOf(event)).filter((embed) => embed.value.includes(':'))
  const carried = embeds.length ? cardsIn(embeds, blocks, parts, resolveLink) : []
  const written = new Map<string, string>()
  for (const reference of carried.length ? referencesIn(blocks) : []) {
    const value = valueOfReference(reference)
    if (value && !written.has(value)) written.set(value, reference)
  }
  // The first URL written bare for each card's file, as the package reads one for a chip (a link on words keeps its words).
  // Only a URL that itself names that file: a block comment can mark any URL's text as a reference to another (LTX-6 security review).
  const writtenUrl = new Map<string, string>()
  const urlsIn = (bs: readonly RenderBlock[], resolve: LinkResolver) => {
    for (const block of bs) {
      for (const run of block.inline ?? []) {
        const value = writtenUrlOf(run, resolve) ? valueOfReference(run.reference!) : undefined
        if (value && !writtenUrl.has(value)) writtenUrl.set(value, run.text)
      }
      if (block.children) urlsIn(block.children, resolve)
    }
  }
  if (carried.length && resolveLink) urlsIn(linksAsReferences(blocks, resolveLink), resolveLink)
  const cards = carried.flatMap((card): CarriedCard[] => {
    // Named by its `nostr:` reference, or only by an app link: then its address is written as one.
    const reference = written.get(card.value) ?? referenceOfValue(card.value)
    const opensAt = writtenUrl.get(card.value)
    return reference && card.layout !== 'none' ? [{ uri: reference, value: card.value, layout: card.layout, ...(opensAt ? { opensAt } : {}) }] : []
  })
  // The page the comment is on stays its chip: a row of the page you are reading says nothing.
  const stayChip = here ? (value: string) => value.toLowerCase() === here.toLowerCase() : undefined
  // A line that is only a link to the file the comment is on draws nothing (ONE-11; why:
  // https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-comment-draws-no-line-for-the-file-it-is-on.md).
  // Leaf reads comments only (`kind:1111`, comments.ts), so the event is one.
  const ownFile = ownFileOf({ kind: 1111, tags: event.tags })
  const lines = placeLines(blocks, { cards: carried, parts, ...(resolveLink ? { resolveLink } : {}), ...(stayChip ? { stayChip } : {}), ...(ownFile.length ? { ownFile } : {}) })
  return { ...lines, cards, parts }
}
