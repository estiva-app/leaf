import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SURE, suggestFor, useTypedMark } from './TypedMark'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { mocked } from 'storybook/test'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { serializeBlockDocument, type SignedEvent } from '@estiva-app/protocol'
import { Toast, ToastProvider } from '@estiva-app/ui'
import { ConceptComment } from '../../comments/CommentsColumn'
import type { CommentItem, Thread } from '../../comments/comments'
import { useThreads } from '../../comments/useThreads'
import { ConceptBlockRows } from '../../document/LiveDocument'
import { query, viewerPubkey } from '../../relay/bridge'
import { FilePage } from '../../pages/FilePage'
import { answer, factsOf } from '../../pages/fixtures/relay'
import { KATERINA, MIKY, PROFILES, threadsOn } from '../../pages/fixtures/shipFiles'
import { ConceptSide } from '../../pages/FilePage'
import { MarkAsRows, MarkedLine, MarkedNotice, TYPE_OF, blockLineCss, drawsLine, markedBlockAt, useMarkHover, type ItemType, type Mark, type MarkWord } from './MarkAs'
import { ITEMS, KATERINA as KATERINA_P, TEAM, type Item } from './fixtures'
import { ItemPanel } from './ItemPanel'

/*
  CONCEPT — Insights, Journal and Risks in Leaf (prototype issue 009bc509). Leaf's real FilePage, as Pages/File page
  draws it, with the block menu's Mark as… (through ConceptBlockRows) and a comment's ⋯ Mark as… (through
  ConceptComment). Marking is at once: the title is the block's or comment's first line, a notice offers Open.
*/

const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const ROOT = 'e'.repeat(63) + '1'
const item = (id: string) => ITEMS.find((i) => i.id === id)!

/*
  Katerina's "Navigation notes" as a real page holds them (Miky, 16 Nov: "whole paragraph, a table, a bullet list,
  a checklist, a note or warning"): a paragraph, a list, a table, a checklist, two callouts, a last paragraph. The
  words come from the fixtures' sources; the table and the checklist say where each app's sidebar stood.
*/
const text = (t: string) => [{ type: 'text', text: t }]
const para = (t: string) => ({ type: 'paragraph', content: text(t) })
const item_ = (t: string, checked?: boolean) => ({ type: 'listItem', ...(checked === undefined ? {} : { attrs: { checked } }), content: text(t) })
const cell = (t: string, header = false) => ({ type: header ? 'tableHeader' : 'tableCell', content: [para(t)] })
const row = (cells: string[], header = false) => ({ type: 'tableRow', content: cells.map((c) => cell(c, header)) })
const BLOCKS: { id: string; words: string; node: Record<string, unknown> }[] = [
  { id: 'n1', words: 'One search for everything', node: para(`${item('i4').source!.quote} Katerina looks for a thing, not for an app: she does not want to know whether it is a message, an issue or a page before she finds it.`) },
  {
    id: 'n2',
    words: 'What we keep hitting',
    node: { type: 'bulletList', content: [item_(item('i1').source!.quote), item_('Ship’s and Leaf’s sidebars work differently from Peek’s; a first-time reader sees it at once.'), item_('Being a member of many Ship issues is noisy.')] },
  },
  {
    id: 'n3',
    words: 'Where each sidebar starts',
    node: { type: 'table', content: [row(['App', 'Top of the sidebar', 'Folders'], true), row(['Peek', 'Teams and Topics', 'Gone']), row(['Ship', 'Projects and Issues', 'Listed']), row(['Leaf', 'Documents', 'Listed'])] },
  },
  {
    id: 'n4',
    words: 'Same sidebar everywhere',
    node: { type: 'bulletList', content: [item_('Teams and Topics at the top in Peek', true), item_('The same sidebar in Ship', false), item_('The same sidebar in Leaf', false), item_('An open file selects its team and topic', false)] },
  },
  { id: 'n5', words: item('r3').source!.quote, node: { type: 'blockquote', attrs: { tone: 'warning' }, content: text(item('r3').source!.quote) } },
  { id: 'n6', words: item('j1').source!.quote, node: { type: 'blockquote', attrs: { tone: 'note' }, content: text(item('j1').source!.quote) } },
  { id: 'n7', words: item('r5').source!.quote, node: para(item('r5').source!.quote) },
]
const textOf = Object.fromEntries(BLOCKS.map((b) => [b.id, b.words]))

/** The page as blocks with ids, so a block's menu can mark it and a story can draw its label by id. */
const blocksDoc = () => serializeBlockDocument({ type: 'doc', content: BLOCKS.map((b) => withIds(b.node, b.id)) } as unknown as Parameters<typeof serializeBlockDocument>[0])
/** Every block has an id, nested ones too (§13.3): a list's items, a table's rows and cells, a callout's paragraph. */
function withIds(node: Record<string, unknown>, id: string): Record<string, unknown> {
  const content = node.content as Record<string, unknown>[] | undefined
  const blocks = content && content.length && content[0].type !== 'text' ? content.map((c, i) => withIds(c, `${id}-${i}`)) : content
  return { ...node, id, ...(blocks ? { content: blocks } : {}) }
}

/** Items for the blocks that are not among the fixtures' sources: the table and the checklist. */
const TABLE_INSIGHT: Item = { ...item('i2'), id: 't1', category: 'Product', title: 'Each app’s sidebar starts somewhere else', summary: 'Peek starts with Teams and Topics; Ship with Projects and Issues; Leaf with Documents.', source: { app: 'Leaf', what: 'block', place: 'Navigation notes', author: KATERINA_P, quote: 'App · Top of the sidebar · Folders — Peek: Teams and Topics, gone; Ship: Projects and Issues, listed; Leaf: Documents, listed.' } }
const CHECKLIST_UPDATE: Item = { ...item('j3'), id: 'u1', title: 'Same sidebar everywhere: Peek done, Ship and Leaf next', summary: 'One of four done.', details: undefined, source: { app: 'Leaf', what: 'block', place: 'Navigation notes', author: KATERINA_P, quote: '☑ Teams and Topics at the top in Peek · ☐ The same sidebar in Ship · ☐ The same sidebar in Leaf · ☐ An open file selects its team and topic' } }
/** The item a marked block opens. */
// The Decision opened beside this document comes from this document's own callout, not from a Ship comment (review, 17 Nov).
const CALLOUT_DECISION: Item = { ...item('j1'), source: { app: 'Leaf', what: 'block', place: 'Navigation notes', author: KATERINA_P, quote: textOf.n6 ?? '' } }
const ITEM_OF: Record<string, Item> = { n1: item('i4'), n2: item('i1'), n3: TABLE_INSIGHT, n4: CHECKLIST_UPDATE, n5: item('r3'), n6: CALLOUT_DECISION, n7: item('r5') }

/** The Leaf page "Navigation notes", Katerina's. */
function navigationNotes(): ForeignObject {
  return {
    kind: 30842,
    ref: `30842:${KATERINA}:navigation-notes`,
    address: `30842:${KATERINA}:navigation-notes`,
    folder: FOLDER,
    naddr: 'naddr1navigationnotes',
    eventId: ROOT,
    meta: [],
    actions: [],
    slots: {
      title: { value: 'Navigation notes' },
      subtitle: { value: 'What we keep hitting in the sidebar, in Peek, Ship and Leaf.' },
      [BODY_SLOT]: { value: blocksDoc(), format: 'blocks' },
    },
  } as unknown as ForeignObject
}

/** A whole-page comment as the column holds it, with its own id. */
function comment(id: string, by: string, body: string, minutesAgo: number): CommentItem {
  const at = Math.floor(Date.now() / 1000) - minutesAgo * 60
  const event: SignedEvent = { id, sig: '0'.repeat(128), pubkey: by, kind: 1111, created_at: at, tags: [], content: body }
  return { id, by, at: at * 1000, body, edited: false, files: [], cards: [], reactions: [], event }
}

const SIDEBAR = 'd'.repeat(62) + '01'
const BELONGS = 'd'.repeat(62) + '02'
// threadsOn's own comment (Katerina's question, 42 minutes ago) has the id 'c'×62 + '42' and stays unmarked here.

/** The page's comments: threadsOn's thread, and two more with real words — Miky's on the sidebar, Katerina's on where a file belongs. */
function threads(file: ForeignObject) {
  const state = threadsOn(file)
  const more: Thread[] = [
    { id: SIDEBAR, root: comment(SIDEBAR, MIKY, item('i2').source!.quote, 90), replies: [], resolved: false },
    { id: BELONGS, root: comment(BELONGS, KATERINA, item('i1').source!.quote, 60), replies: [], resolved: false },
  ]
  return { ...state, threads: [...more, ...(state.threads ?? [])] }
}

const firstLine = (text: string) => text.split(/(?<=[.!?])\s/)[0].slice(0, 80)
const marked = (type: ItemType, word: MarkWord, title: string, status: Mark['status'] = 'accepted'): Mark => ({ type, word, title, href: '#', status })

/**
 * The concept hooks around the real page: Mark as… in the block menu and in a comment's ⋯; a marked block's label in
 * its right margin, clear of the block handle; the label opens the item in the comments' place; the notice.
 */
function Marking({ children, blocks = {}, comments = {}, changed = [], open: open0 }: { children: ReactNode; blocks?: Record<string, Mark>; comments?: Record<string, Mark>; changed?: string[]; open?: string }) {
  const [marks, setMarks] = useState<Record<string, Mark | undefined>>({ ...blocks, ...comments })
  const [open, setOpen] = useState<string | undefined>(open0)
  const [notice, setNotice] = useState<MarkWord>()
  const mark = (id: string, text: string, word: MarkWord) => (setMarks((m) => ({ ...m, [id]: marked(TYPE_OF[word], word, firstLine(text)) })), setNotice(word))
  const unmark = (id: string) => setMarks((m) => ({ ...m, [id]: undefined }))
  const rows = (id: string, text: string) => <MarkAsRows mark={marks[id]} onMark={(w) => mark(id, text, w)} onUnmark={() => unmark(id)} />
  // Marking as you write (trial, Miky 19 Nov): a symbol alone in a block and Enter, or Ctrl/⌘ + . and a symbol, marks
  // the block the caret is in, a new one included.
  const page = useRef<HTMLDivElement>(null)
  const marksNow = useRef(marks)
  marksNow.current = marks
  const [typed, setTyped] = useState<string[]>([])
  const picker = useTypedMark(page, {
    block: '[data-block-id]',
    onMark: (w, el) => {
      const id = el.dataset.blockId
      if (!id) return
      setTyped((t) => [...t, id])
      mark(id, el.textContent || 'A new block', w)
    },
    onUnmark: (el) => {
      const id = el.dataset.blockId
      if (!id || !marksNow.current[id]) return false
      unmark(id)
      return true
    },
  })
  // The model's suggestion when you pause in a block (Miky, 19 Nov; a document has no send): sure marks the block at
  // once, with Undo; unsure is only offered, and goes when you ignore it. A block is offered once.
  const [suggestion, setSuggestion] = useState<{ id: string; text: string; word: MarkWord; sure: boolean }>()
  const offered = useRef<string[]>([])
  useEffect(() => {
    const root = page.current
    if (!root) return
    let t: ReturnType<typeof setTimeout>
    const read = () => {
      clearTimeout(t)
      const n = window.getSelection()?.anchorNode
      const el = (n?.nodeType === Node.ELEMENT_NODE ? (n as Element) : n?.parentElement)?.closest('[data-block-id]') as HTMLElement | null
      const id = el?.dataset.blockId
      t = setTimeout(() => {
        const text = el?.textContent ?? ''
        const s = suggestFor(text)
        if (!id || !s || marksNow.current[id] || offered.current.includes(id)) return
        offered.current.push(id)
        setTyped((all) => [...all, id])
        if (s.confidence >= SURE) mark(id, text, s.word)
        setSuggestion({ id, text, word: s.word, sure: s.confidence >= SURE })
      }, 900)
    }
    root.addEventListener('input', read)
    return () => (root.removeEventListener('input', read), clearTimeout(t))
  })
  useEffect(() => {
    if (!suggestion || suggestion.sure) return
    const t = setTimeout(() => setSuggestion(undefined), 10_000)
    return () => clearTimeout(t)
  }, [suggestion])
  const labels = Object.fromEntries(Object.entries(marks).flatMap(([id, m]) => (m && drawsLine(m) && (textOf[id] || typed.includes(id)) ? [[id, m.word]] : [])))
  const opened = open ? ITEM_OF[open] : undefined
  const hover = useMarkHover(labels, 'gutter')
  return (
    <ConceptBlockRows.Provider value={(id) => rows(id, textOf[id] ?? '')}>
      <ConceptComment.Provider value={{ menu: (id, body) => rows(id, body), wrap: (id, card) => <MarkedLine mark={marks[id]}>{card}</MarkedLine> }}>
        <ConceptSide.Provider value={opened ? <ItemPanel key={opened.id} item={opened} onClose={() => setOpen(undefined)} /> : null}>
          <style>{blockLineCss(labels, changed, 'gutter')}</style>
          {hover}
          {/* @estiva-escape(no-raw-interactive): concept only, the margin label is CSS on the editor's own block, so its click is read here */}
          <div ref={page} className="contents" onClickCapture={(e) => { const id = markedBlockAt(e, labels); if (id) setOpen(id) }}>
            {children}
          </div>
          {picker}
          {suggestion ? (
            <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
              {suggestion.sure ? (
                <Toast label={`Suggested: this block is marked as ${suggestion.word}.`} type="success" actionLabel="Undo" onAction={() => (unmark(suggestion.id), setSuggestion(undefined))} />
              ) : (
                <Toast label={`Mark this block as ${suggestion.word}?`} type="neutral" actionLabel="Mark" onAction={() => (mark(suggestion.id, suggestion.text, suggestion.word), setSuggestion(undefined))} />
              )}
            </div>
          ) : (
            notice && <MarkedNotice word={notice} team={TEAM} onClose={() => setNotice(undefined)} />
          )}
        </ConceptSide.Provider>
      </ConceptComment.Provider>
    </ConceptBlockRows.Provider>
  )
}

const meta = {
  title: 'Concept/Insights, Journal and Risks',
  component: FilePage,
  parameters: { layout: 'fullscreen' },
  args: { file: navigationNotes(), loading: false },
  // The relay's answers, handed in as Pages/File page does. Miky is reading, unless a story says Katerina.
  beforeEach: ({ args, parameters }) => {
    const file = args.file
    if (file) mocked(useThreads).mockReturnValue(threads(file))
    mocked(viewerPubkey).mockReturnValue(parameters.viewer ?? MIKY)
    mocked(query).mockImplementation(async (filters) =>
      filters.some((f) => Array.isArray(f.kinds) && f.kinds.includes(0)) ? PROFILES : file ? answer(factsOf(file), filters) : [],
    )
  },
  decorators: [
    (Story) => (
      <ToastProvider>
        <div className="flex h-screen flex-col">
          <Story />
        </div>
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof FilePage>

export default meta
type Story = StoryObj<typeof meta>

const page = (props: Parameters<typeof Marking>[0]['blocks'], more: Omit<Parameters<typeof Marking>[0], 'children' | 'blocks'> = {}) => (args: Story['args']) => (
  <Marking blocks={props} {...more}>
    <FilePage {...(args as Parameters<typeof FilePage>[0])} />
  </Marking>
)

/** A whole paragraph marked as an Insight: its label sits in the right margin, level with its first line, clear of the ⠿ handle. */
export const MarkedParagraph: Story = { render: page({ n1: marked('insight', 'Insight', item('i4').title, 'accepted') }) }

/** A bullet list and a checklist, each marked whole: an Insight on the list, an Update on the checklist. */
export const MarkedLists: Story = {
  render: page({ n2: marked('insight', 'Insight', item('i1').title, 'proposed'), n4: marked('journal', 'Update', CHECKLIST_UPDATE.title, 'accepted') }),
}

/** A table marked as an Insight. */
export const MarkedTable: Story = { render: page({ n3: marked('insight', 'Insight', TABLE_INSIGHT.title, 'proposed') }) }

/** Two callouts: the warning marked as a Question (a Risk), the note as a Decision (a Journal entry). */
export const MarkedCallouts: Story = {
  render: page({ n5: marked('risk', 'Question', item('r3').title, 'open'), n6: marked('journal', 'Decision', item('j1').title, 'proposed') }),
}

/**
 * Trial (Miky, 19 Nov): the list highlighted, not sorted yet (grey: its block menu offers Sort as…), and the checklist
 * marked as a To-do (green), which Ship then lists under the project's Scope to decide.
 */
/**
 * Trial (Miky, 19 Nov): mark as you write. Click at the end of any paragraph, press Enter for a new block, type `?`
 * alone and press Enter: the symbol goes and the block wears Question in the margin. Or press Ctrl/⌘ + . in any
 * block and type a symbol (`!` `*` `?` `[]` `=` `:` `~` `!!`) or pick a row.
 */
export const MarkAsYouWrite: Story = { render: page({}) }

export const MarkedHighlightAndToDo: Story = {
  render: page({ n2: marked('highlight', 'Highlight', 'Are there highlights the seven words don’t cover?', 'proposed'), n4: marked('todo', 'To-do', 'Finish the checklist before the prototype review', 'open') }),
}

/** A marked callout above a paragraph changed since your last visit: "Question" in red, "Changed" in grey, both in the margin. */
export const MarkedBesideChanged: Story = { render: page({ n5: marked('risk', 'Question', item('r3').title, 'open') }, { changed: ['n7'] }) }

/** The label opened: the Decision beside the page, in the comments' place; ✕ brings the comments back. */
export const MarkOpenBeside: Story = { render: page({ n6: marked('journal', 'Decision', item('j1').title, 'proposed'), n3: marked('insight', 'Insight', TABLE_INSIGHT.title, 'proposed') }, { open: 'n6' }) }

/** A comment marked as an Insight (its line around the card); the others offer Mark as… in their ⋯. */
export const MarkedComment: Story = { render: page({}, { comments: { [SIDEBAR]: marked('insight', 'Insight', item('i2').title, 'proposed') } }) }

/** The last paragraph was marked as a Concern and that Risk was Rejected: drawn unmarked, no label, and its menu offers Mark as… again. */
export const RejectedLeavesNoLabel: Story = { render: page({ n7: marked('risk', 'Concern', item('r5').title, 'rejected') }) }

/** Katerina reading her own page: the list Miky marked as an Insight shows the same label to her, Unmark in its menu. */
export const KaterinasView: Story = { parameters: { viewer: KATERINA }, render: page({ n2: marked('insight', 'Insight', item('i1').title, 'proposed') }) }

