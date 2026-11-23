import type { Meta, StoryObj } from '@storybook/react-vite'
import { mocked } from 'storybook/test'
import { useState } from 'react'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { descriptionTextToBlockDocument, serializeBlockDocument } from '@estiva-app/protocol'
import {
  AppShell,
  Avatar,
  CommandPalette,
  CommandPaletteAnswer,
  CommandPaletteSearch,
  KindIcon,
  NavItem,
  Sidebar,
  ToastProvider,
  type CommandPaletteGroup,
  type NavTreeGroup,
} from '@estiva-app/ui'
import { IconCornerDownLeft, IconFilePlus, IconHome, IconMessagePlus, IconRowInsertBottom } from '@tabler/icons-react'
import { useThreads } from '../comments/useThreads'
import { TeamsTree } from '../folders/TeamsTree'
import { FilePage } from '../pages/FilePage'
import { answer as relayAnswer, factsOf } from '../pages/fixtures/relay'
import { MIKY, PROFILES, threadsOn } from '../pages/fixtures/shipFiles'
import { query, viewerPubkey } from '../relay/bridge'

/*
  KIN-5, concept: ⌘K in Leaf, for Miky's look before it is built. Leaf's frame as it ships (the kit's AppShell, the
  teams tree, the real file page); Changed from today: the search in the top bar. New here: nothing — the box is the
  one Peek ships (@estiva-app/launcher), drawn here from the kit's palette parts it is built from, in the states Leaf adds:
  two words find files from every app; a sentence asks about the open page, reading its text and its comments; the
  answer can be drafted as a comment or inserted into the page (Miky, KIN-5 kickoff, 23 Nov).
*/

const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'

/** The page that is open: the launch plan, as the file page stories draw it. */
function launchPlan(): ForeignObject {
  return {
    kind: 30842,
    ref: `30842:${MIKY}:launch-plan`,
    address: `30842:${MIKY}:launch-plan`,
    folder: FOLDER,
    naddr: 'naddr1launchplan',
    eventId: 'f'.repeat(64),
    meta: [],
    actions: [],
    slots: {
      title: { value: 'Launch plan' },
      subtitle: { value: 'What ships on launch day, who does what, and the order we do it in.' },
      [BODY_SLOT]: {
        value: serializeBlockDocument(
          descriptionTextToBlockDocument(
            'We ship the beta to the first ten teams on Monday.\n\nRavi owns the press notes and the launch post.\n\nLaunch date: to be confirmed.',
          ),
        ),
        format: 'blocks',
      },
    },
  } as unknown as ForeignObject
}

const page = (id: string, label: string) => ({ id, label, href: `#${id}` })
const TEAMS: NavTreeGroup[] = [
  { id: 'launch', title: 'Launch team', nodes: [page('plan', 'Launch plan'), page('press', 'Press notes')] },
  { id: 'design', title: 'Design', nodes: [page('tokens', 'Tokens')] },
]

type BoxState = 'closed' | 'search' | 'answer' | 'hidden-with-answer'

const SENTENCE = 'what is still open on this page?'

/** Two words: files from every app, each opening where it lives, and Leaf's own action. */
const searchGroups = (): CommandPaletteGroup[] => [
  {
    label: 'Files',
    rows: [
      { id: 'press', label: 'Press notes', description: 'Who we brief, and when', aside: 'Launch team', leading: <KindIcon kind="file" />, onSelect: () => {} },
      { id: 'kin', label: 'Launch checklist', description: 'Opens in Ship', aside: 'WEB-12 · Website launch', leading: <KindIcon kind="issue" />, onSelect: () => {} },
      { id: 'web', label: 'Website launch', description: 'Opens in Ship', leading: <KindIcon kind="project" />, onSelect: () => {} },
      { id: 'topic', label: 'Launch', description: 'Topic · opens here, in Leaf', leading: <KindIcon kind="topic" />, onSelect: () => {} },
    ],
  },
  { label: 'Actions', rows: [{ id: 'new', label: 'New document', description: 'In Launch team', icon: <IconFilePlus size={16} stroke={1.5} />, onSelect: () => {} }] },
]

/** A sentence about the page: its passages and its comments are the sources, and the answer can go into a comment or the page. */
const answerGroups = (): CommandPaletteGroup[] => [
  {
    label: 'Sources',
    rows: [
      { id: 's1', label: 'Launch date: to be confirmed.', description: '[1] In the page', icon: <IconRowInsertBottom size={16} stroke={1.5} />, onSelect: () => {} },
      { id: 's2', label: 'Can the row under "Launch plan" show the status as words, not only its colour?', description: '[2] Ravi Mehta · comment on the whole document', leading: <Avatar name="Ravi Mehta" size={24} />, onSelect: () => {} },
    ],
  },
  {
    label: 'Next',
    rows: [
      { id: 'comment', label: 'Draft a comment', description: 'On the passage it cites first. It will not send: edit it first.', icon: <IconMessagePlus size={16} stroke={1.5} />, onSelect: () => {} },
      { id: 'insert', label: 'Insert into the page', description: 'As a block where your cursor was, or under the passage it cites first.', icon: <IconCornerDownLeft size={16} stroke={1.5} />, onSelect: () => {} },
    ],
  },
  { label: 'Suggested', rows: [{ id: 'new', label: 'New document', description: 'In Launch team', icon: <IconFilePlus size={16} stroke={1.5} />, onSelect: () => {} }] },
]

/** Leaf's frame with the search in its bar, and the ⌘K box in one of its states. */
function LeafWithLauncher({ state }: { state: BoxState }) {
  const [open, setOpen] = useState(state === 'search' || state === 'answer')
  const asking = state !== 'search'
  const [query, setQuery] = useState(asking ? SENTENCE : 'launch pl')
  const hiddenAnswer = !open && state === 'hidden-with-answer'
  return (
    <ToastProvider>
      <div className="h-screen">
        <AppShell
          variant="inset"
          logo="Leaf"
          onSearch={() => setOpen(true)}
          searchPlaceholder="Search Leaf..."
          {...(hiddenAnswer ? { searchStatus: 'waiting' as const, searchStatusLabel: 'An answer is waiting' } : {})}
          nav={
            <Sidebar>
              <NavItem href="#" label="Home" icon={<IconHome size={16} stroke={1.5} />} />
              <TeamsTree groups={TEAMS} yours={new Set(['launch', 'design'])} failed={false} selected="plan" openTeam="launch" />
            </Sidebar>
          }
        >
          <FilePage file={launchPlan()} loading={false} />
        </AppShell>
        <CommandPalette open={open} onOpenChange={setOpen} label="Launcher" where="On this page" escWord={asking ? 'hide' : 'close'}>
          <CommandPaletteSearch
            query={query}
            onQueryChange={setQuery}
            placeholder="Search, or ask about this page"
            groups={asking ? answerGroups() : searchGroups()}
            {...(asking ? { prompt: { onSubmit: () => {}, submitWord: 'ask' }, about: 'Launch plan' } : {})}
          >
            {asking ? (
              <div data-testid="answer">
                <CommandPaletteAnswer>
                  {'Two things are open: the launch date is still to be confirmed [1], and Ravi asked whether the row under Launch plan can show its status as words, not only its colour [2].'}
                </CommandPaletteAnswer>
              </div>
            ) : undefined}
          </CommandPaletteSearch>
        </CommandPalette>
      </div>
    </ToastProvider>
  )
}

const meta = {
  title: 'Concept/Search and ask in Leaf (KIN-5)',
  component: LeafWithLauncher,
  parameters: { layout: 'fullscreen' },
  args: { state: 'closed' },
  argTypes: { state: { control: 'inline-radio', options: ['closed', 'search', 'answer', 'hidden-with-answer'] } },
  // The page's relay answers, handed in as the file page stories do. Miky is reading.
  beforeEach: () => {
    const file = launchPlan()
    mocked(useThreads).mockReturnValue(threadsOn(file))
    mocked(viewerPubkey).mockReturnValue(MIKY)
    mocked(query).mockImplementation(async (filters) =>
      filters.some((f) => Array.isArray(f.kinds) && f.kinds.includes(0)) ? PROFILES : relayAnswer(factsOf(file), filters),
    )
  },
} satisfies Meta<typeof LeafWithLauncher>

export default meta
type Story = StoryObj<typeof meta>

/** Changed from today: the top bar has a search, "Search Leaf...", and Ctrl+K opens it. Click it to open the box. */
export const SearchInTheBar: Story = {}

/** Two words: files from every app — a Leaf page opens here, a Ship issue or project in Ship, a topic on Leaf's own topic page — and New document. */
export const TwoWords: Story = { args: { state: 'search' } }

/** A sentence about the open page: the answer reads the page's text and its comments, cites both, and can be drafted as a comment or inserted into the page. */
export const AskAboutThePage: Story = { args: { state: 'answer' } }

/** Escape hides the box and keeps the sentence and the answer; the search carries a dot until you have seen the answer. */
export const HiddenWithAnAnswer: Story = { args: { state: 'hidden-with-answer' } }
