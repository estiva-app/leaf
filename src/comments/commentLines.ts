import {
  cardsIn,
  embedsOf,
  encodeNaddr,
  lineDrawOf,
  linesOf,
  linksAsReferences,
  partsOf,
  referenceOfLink,
  referencesIn,
  valueOfReference,
  valuesIn,
  type Embed,
  type LinkResolver,
  type PartPointer,
  type RenderBlock,
  type RenderInline,
} from '@estiva-app/protocol'
import { MAX_PARTS } from '@estiva-app/conversation'

/** The `nostr:` reference a file's address is written as, for its chip and card; undefined for anything that is not an address. */
export function referenceOfValue(value: string): string | undefined {
  const [kind, pubkey, ...d] = value.split(':')
  if (!/^\d+$/.test(kind ?? '') || !/^[0-9a-f]{64}$/i.test(pubkey ?? '') || d.length === 0) return undefined
  return `nostr:${encodeNaddr({ kind: Number(kind), pubkey, identifier: d.join(':'), relays: [] })}`
}

/** Every URL a comment's body names as a reader counts one (bare, or a link's target; none in code): what Leaf asks the relay about. */
export function linksIn(blocks: readonly RenderBlock[]): string[] {
  const urls = new Set<string>()
  valuesIn(blocks, (url) => {
    urls.add(url)
    return undefined
  })
  return [...urls]
}

/**
 * A line of a comment that is only a link to a file or a message, drawn as
 * that file's row in place (SPEC §13.2, §13.6.2; why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md).
 * `reference` is the `nostr:` reference the line names; `unreadable` is one
 * that names no address or event id.
 */
export interface RowLine {
  reference: string
  unreadable?: true
  /** The URL the line wrote for its file, when it wrote one: the row opens it as written (LTX-6). */
  url?: string
}

/**
 * The URL a run wrote for its reference, when it is one that names that same
 * file: what its chip or row opens (LTX-6). A block comment can mark any URL's
 * text as a reference to another file, so the text must itself read as it.
 */
export function writtenUrlOf(run: Pick<RenderInline, 'text' | 'reference'>, resolveLink: LinkResolver | undefined): string | undefined {
  if (!run.reference || !resolveLink || !/^https?:\/\//i.test(run.text)) return undefined
  return referenceOfLink(run.text, resolveLink) === run.reference ? run.text : undefined
}

/** A card its writer carried under the comment (`embed`, SPEC §13.6.2), by the reference the body wrote, as a page's line carries one. */
export interface CarriedCard {
  uri: string
  layout: Exclude<Embed['layout'], 'none'>
  /** The first URL the body wrote for its file: the card opens it, as Peek's and Ship's do (LTX-6). */
  opensAt?: string
}

/** A paragraph's line that is a row, lifted out as a block of its own, so the row is not drawn inside a `<p>`. */
export const ROW_BLOCK = 'linkRow'

export interface PlacedComment {
  blocks: RenderBlock[]
  /** The row a block of type {@link ROW_BLOCK} draws. */
  rowOf: (block: { type: string }) => RowLine | undefined
  /** The row a list item's only run draws, by that run: a bullet that is only a link keeps its bullet. */
  rowRuns: ReadonlyMap<object, RowLine>
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
}

const BREAK: RenderInline = { text: '\n', marks: [] }

/** What a line's drawing reads: the cards and parts the comment carries, and what its app links name. */
interface Drawing {
  cards: readonly Embed[]
  parts: readonly PartPointer[]
  resolveLink?: LinkResolver
  here?: string
}

function rowLineOf(line: readonly RenderInline[], block: Pick<RenderBlock, 'type'>, drawing: Drawing): RowLine | 'nothing' | undefined {
  const drawn = lineDrawOf(line, block, drawing)
  if (drawn.draw === 'nothing') return 'nothing'
  if (drawn.draw === 'unreadable') return { reference: drawn.reference, unreadable: true }
  // A URL whose file is not read yet stays the link it was (it reaches here only once read, as a reference); its card or part draws under the comment.
  if (drawn.draw !== 'row' || drawn.url) return undefined
  // The page the comment is on stays its chip, as Ship keeps it (`stayChip`): a row of the page you are reading says nothing.
  if (drawing.here && drawn.value.toLowerCase() === drawing.here.toLowerCase()) return undefined
  const run = line.find((r) => r.reference)
  if (!run?.reference) return undefined
  const url = writtenUrlOf(run, drawing.resolveLink)
  return url ? { reference: run.reference, url } : { reference: run.reference }
}

/**
 * Where each of a comment's lines draws, as Peek draws a message's (its
 * `placeLines`): a sentence keeps its chips, a line that is only a link to a
 * file or a message is that file's row, and one whose file has a card under
 * the comment draws nothing, since the card stands for it (C26). A person or a
 * Folder alone on its line stays a chip, and a quote's or a heading's line is
 * a sentence (protocol `lineDrawOf`). A card is one its writer carried
 * (`embed`, §13.6.2) and a part a block its writer linked (`part`, §13.6.1);
 * each draws only while the body still names its file, by a `nostr:` reference
 * or an app link (`cardsIn` with `resolveLink`), and a part of the page the
 * comment is on draws nothing (Miky, 2026-10-19).
 */
export function placeComment(body: readonly RenderBlock[], event: { tags: readonly (readonly string[])[] }, context: PlaceContext = {}): PlacedComment {
  const { here, resolveLink, readable } = context
  // An app URL whose file has been read is that file's reference, its run keeping the URL as its text, as Peek and Ship read one (LTX-6).
  const blocks: readonly RenderBlock[] =
    resolveLink && readable
      ? linksAsReferences(body, (url) => {
          // Only a link its chip can open as written (https, `writtenOpenerOf`): any other stays the link it was.
          if (!/^https:\/\//i.test(url)) return undefined
          const value = resolveLink(url)
          const reference = value ? referenceOfValue(value) : undefined
          return reference && readable(reference) ? value : undefined
        })
      : body
  const named = new Set(valuesIn(blocks, resolveLink))
  // At most six live under one comment (§13.6.1): each one re-reads its file every 30 s.
  const parts = partsOf({ tags: event.tags.map((t) => [...t]) })
    .filter((part) => part.address !== here && named.has(part.address))
    .slice(0, MAX_PARTS)
  // A file's card only: Leaf reads files, not another app's messages, so a message's line keeps its row instead of a card that never loads.
  const embeds = embedsOf(event).filter((embed) => embed.value.includes(':'))
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
    return reference && card.layout !== 'none' ? [{ uri: reference, layout: card.layout, ...(opensAt ? { opensAt } : {}) }] : []
  })
  const drawing = { cards: carried, parts, resolveLink, here }

  const rows = new Map<object, RowLine>()
  const rowRuns = new Map<RenderInline, RowLine>()
  const out: RenderBlock[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const lines = linesOf(block)
      const drawn = lines.map((line) => rowLineOf(line, block, drawing))
      if (drawn.every((d) => d === undefined)) {
        out.push(block)
        continue
      }
      let sentence: RenderInline[][] = []
      let first = true
      const flush = () => {
        if (!sentence.length) return
        const inline = sentence.flatMap((line, i) => (i > 0 ? [BREAK, ...line] : line))
        out.push({ ...block, inline, ...(first ? {} : { id: undefined }) })
        first = false
        sentence = []
      }
      lines.forEach((line, i) => {
        const d = drawn[i]
        if (d === undefined) {
          sentence.push(line)
          return
        }
        flush()
        if (d === 'nothing') return
        // Not a protocol block: RichText hands a type it has no design for to `renderBlock`.
        const row = { type: ROW_BLOCK, attrs: {} } as unknown as RenderBlock
        rows.set(row, d)
        out.push(row)
      })
      flush()
      continue
    }
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      const items = (block.children ?? []).flatMap((item) => {
        const lines = linesOf(item)
        if (lines.length !== 1) return [item]
        const d = rowLineOf(lines[0], item, drawing)
        if (d === undefined) return [item]
        if (d === 'nothing') return []
        // A fresh run, so the map names this line and no other drawing of the same body.
        const run = { ...lines[0].find((r) => r.reference || r.text.trim())! }
        rowRuns.set(run, d)
        return [{ ...item, inline: [run] }]
      })
      if (items.length) out.push({ ...block, children: items })
      continue
    }
    out.push(block)
  }
  return { blocks: out, rowOf: (block) => rows.get(block), rowRuns, cards, parts }
}
