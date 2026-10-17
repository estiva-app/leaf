import { cardsIn, embedsOf, lineDrawOf, linesOf, referencesIn, valueOfReference, type Embed, type RenderBlock, type RenderInline } from '@estiva-app/protocol'

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
}

const BREAK: RenderInline = { text: '\n', marks: [] }

function rowLineOf(line: readonly RenderInline[], block: Pick<RenderBlock, 'type'>, cards: readonly Embed[]): RowLine | 'nothing' | undefined {
  const drawn = lineDrawOf(line, block, { cards })
  if (drawn.draw === 'nothing') return 'nothing'
  if (drawn.draw === 'unreadable') return { reference: drawn.reference, unreadable: true }
  if (drawn.draw !== 'row') return undefined
  const run = line.find((r) => r.reference)
  return run?.reference ? { reference: run.reference } : undefined
}

/**
 * Where each of a comment's lines draws, as Peek draws a message's (its
 * `placeLines`): a sentence keeps its chips, a line that is only a link to a
 * file or a message is that file's row, and one whose file has a card under
 * the comment draws nothing, since the card stands for it (C26). A person or a
 * Folder alone on its line stays a chip, and a quote's or a heading's line is
 * a sentence (protocol `lineDrawOf`). Leaf writes no `embed`; a card is one
 * another app's writer carried (Peek, on this page's conversation), and it
 * draws only while the body still names its file (`cardsIn`).
 */
export function placeComment(blocks: readonly RenderBlock[], event: { tags: readonly (readonly string[])[] }): PlacedComment {
  // A file's card only: Leaf reads files, not another app's messages, so a message's line keeps its row instead of a card that never loads.
  const embeds = embedsOf(event).filter((embed) => embed.value.includes(':'))
  const carried = embeds.length ? cardsIn(embeds, blocks) : []
  const written = new Map<string, string>()
  for (const reference of carried.length ? referencesIn(blocks) : []) {
    const value = valueOfReference(reference)
    if (value && !written.has(value)) written.set(value, reference)
  }
  const cards = carried.flatMap((card): CarriedCard[] => {
    const reference = written.get(card.value)
    return reference && card.layout !== 'none' ? [{ uri: reference, layout: card.layout }] : []
  })

  const rows = new Map<object, RowLine>()
  const rowRuns = new Map<RenderInline, RowLine>()
  const out: RenderBlock[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const lines = linesOf(block)
      const drawn = lines.map((line) => rowLineOf(line, block, carried))
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
        const d = rowLineOf(lines[0], item, carried)
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
  return { blocks: out, rowOf: (block) => rows.get(block), rowRuns, cards }
}
