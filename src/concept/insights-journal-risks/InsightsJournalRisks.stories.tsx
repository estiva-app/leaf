import { useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { mocked } from 'storybook/test'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { serializeBlockDocument, type SignedEvent } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'
import { ConceptComment } from '../../comments/CommentsColumn'
import type { CommentItem, Thread } from '../../comments/comments'
import { useThreads } from '../../comments/useThreads'
import { ConceptBlockRows } from '../../document/LiveDocument'
import { query, viewerPubkey } from '../../relay/bridge'
import { FilePage } from '../../pages/FilePage'
import { answer, factsOf } from '../../pages/fixtures/relay'
import { KATERINA, MIKY, PROFILES, threadsOn } from '../../pages/fixtures/shipFiles'
import { MarkAsRows, MarkedLine, MarkedNotice, TYPE_OF, blockLineCss, drawsLine, type ItemType, type Mark, type MarkWord } from './MarkAs'
import { ITEMS, TEAM } from './fixtures'

/*
  CONCEPT — Insights, Journal and Risks in Leaf (prototype issue 009bc509). Leaf's real FilePage, as Pages/File page
  draws it, with the block menu's Mark as… (through ConceptBlockRows) and a comment's ⋯ Mark as… (through
  ConceptComment). Marking is at once: the title is the block's or comment's first line, a notice offers Open.
*/

const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const ROOT = 'e'.repeat(63) + '1'
const item = (id: string) => ITEMS.find((i) => i.id === id)!

/** Katerina's "Navigation notes": each paragraph's words are the real ones, from the fixtures' sources. */
const BLOCKS: [string, string][] = [
  ['n1', item('i4').source!.quote],
  ['n2', item('i5').source!.quote],
  ['n3', item('i1').source!.quote],
  ['n4', item('j1').source!.quote],
  ['n5', item('r3').source!.quote],
  ['n6', item('r5').source!.quote],
]
const textOf = Object.fromEntries(BLOCKS)

/** A description as blocks with ids, so a block's menu can mark it and a story can draw its line by id. */
const blocksDoc = (paragraphs: [string, string][]) =>
  serializeBlockDocument({ type: 'doc', content: paragraphs.map(([id, words]) => ({ type: 'paragraph', id, content: [{ type: 'text', text: words }] })) })

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
      [BODY_SLOT]: { value: blocksDoc(BLOCKS), format: 'blocks' },
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

/** The two concept hooks around the real page: Mark as… in the block menu and in a comment's ⋯; the lines; the notice. */
function Marking({ children, blocks = {}, comments = {}, changed = [] }: { children: ReactNode; blocks?: Record<string, Mark>; comments?: Record<string, Mark>; changed?: string[] }) {
  const [marks, setMarks] = useState<Record<string, Mark | undefined>>({ ...blocks, ...comments })
  const [notice, setNotice] = useState<MarkWord>()
  const mark = (id: string, text: string, word: MarkWord) => (setMarks((m) => ({ ...m, [id]: marked(TYPE_OF[word], word, firstLine(text)) })), setNotice(word))
  const unmark = (id: string) => setMarks((m) => ({ ...m, [id]: undefined }))
  const rows = (id: string, text: string) => <MarkAsRows mark={marks[id]} onMark={(w) => mark(id, text, w)} onUnmark={() => unmark(id)} />
  const lines = Object.fromEntries(Object.entries(marks).flatMap(([id, m]) => (m && drawsLine(m) && textOf[id] ? [[id, m.type]] : [])))
  return (
    <ConceptBlockRows.Provider value={(id) => rows(id, textOf[id] ?? '')}>
      <ConceptComment.Provider value={{ menu: (id, body) => rows(id, body), wrap: (id, card) => <MarkedLine mark={marks[id]}>{card}</MarkedLine> }}>
        <style>{blockLineCss(lines, changed)}</style>
        {children}
        {notice && <MarkedNotice word={notice} team={TEAM} onClose={() => setNotice(undefined)} />}
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

/** A Risk-marked block (red line) right above one changed since your last visit (grey, dashed): can you tell them apart? */
export const MarkedBesideChanged: Story = {
  render: (args) => (
    <Marking blocks={{ n5: marked('risk', 'Question', item('r3').title, 'open') }} changed={['n6']}>
      <FilePage {...args} />
    </Marking>
  ),
}

/** Every type once on one page: an Insight (amber), a Decision (blue, a Journal entry) and a Risk (red). */
export const EveryType: Story = {
  render: (args) => (
    <Marking
      blocks={{ n3: marked('insight', 'Insight', item('i1').title, 'proposed'), n4: marked('journal', 'Decision', item('j1').title, 'proposed'), n5: marked('risk', 'Question', item('r3').title, 'open') }}
    >
      <FilePage {...args} />
    </Marking>
  ),
}

/** A comment marked as an Insight (amber line around the card); the others offer Mark as… in their ⋯. */
export const MarkedComment: Story = {
  render: (args) => (
    <Marking comments={{ [SIDEBAR]: marked('insight', 'Insight', item('i2').title, 'proposed') }}>
      <FilePage {...args} />
    </Marking>
  ),
}

/** The last block was marked as a Concern and that Risk was Rejected: drawn unmarked — no line — and its menu offers Mark as… again. */
export const RejectedLeavesNoLine: Story = {
  render: (args) => (
    <Marking blocks={{ n6: marked('risk', 'Concern', item('r5').title, 'rejected') }}>
      <FilePage {...args} />
    </Marking>
  ),
}

/** Katerina reading her own page: the block Miky marked as an Insight shows the same line to her, Unmark in its menu. */
export const KaterinasView: Story = {
  parameters: { viewer: KATERINA },
  render: (args) => (
    <Marking blocks={{ n3: marked('insight', 'Insight', item('i1').title, 'proposed') }}>
      <FilePage {...args} />
    </Marking>
  ),
}
