import {
  cardsIn,
  embedsOf,
  encodeNaddr,
  lineDrawOf,
  linesOf,
  partsOf,
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
}

/** A card its writer carried under the comment (`embed`, SPEC §13.6.2), by the reference the body wrote, as a page's line carries one. */
export interface CarriedCard {
  uri: string
  layout: Exclude<Embed['layout'], 'none'>
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
}

const BREAK: RenderInline = { text: '\n', marks: [] }

/** What a line's drawing reads: the cards and parts the comment carries, and what its app links name. */
interface Drawing {
  cards: readonly Embed[]
  parts: readonly PartPointer[]
  resolveLink?: LinkResolver
}

function rowLineOf(line: readonly RenderInline[], block: Pick<RenderBlock, 'type'>, drawing: Drawing): RowLine | 'nothing' | undefined {
  const drawn = lineDrawOf(line, block, drawing)
  if (drawn.draw === 'nothing') return 'nothing'
  if (drawn.draw === 'unreadable') return { reference: drawn.reference, unreadable: true }
  // A line that is only an app URL stays the link it was; its card or part, when it has one, draws under the comment.
  if (drawn.draw !== 'row' || drawn.url) return undefined
  const run = line.find((r) => r.reference)
  return run?.reference ? { reference: run.reference } : undefined
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
export function placeComment(blocks: readonly RenderBlock[], event: { tags: readonly (readonly string[])[] }, context: PlaceContext = {}): PlacedComment {
  const { here, resolveLink } = context
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
  const cards = carried.flatMap((card): CarriedCard[] => {
    // Named by its `nostr:` reference, or only by an app link: then its address is written as one.
    const reference = written.get(card.value) ?? referenceOfValue(card.value)
    return reference && card.layout !== 'none' ? [{ uri: reference, layout: card.layout }] : []
  })
  const drawing = { cards: carried, parts, resolveLink }

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
