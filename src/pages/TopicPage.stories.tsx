import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { fn } from 'storybook/test'
import { ToastProvider, TooltipProvider } from '@estiva-app/ui'
import { TopicPageView } from './TopicPage'
import { Members } from './Members'
import { shipIssue, shipProject, KATERINA, MIKY } from './fixtures/shipFiles'
import type { TopicPageData } from '../topics/useTopicPage'

/*
  An initiative's page in Leaf, handed what it shows (TopicPageView): a page of Leaf's, a Ship project and a Ship issue,
  in the initiative's order, every one a row in Ship's four columns (Katerina, 23 November: "make it like row and not
  card"), and one archived. Invented names only: the directory names the fixtures' two keys.
*/

const FOLDER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
/** A third invented person, so the pill draws three faces. */
const MARA = 'd'.repeat(64)
const NOW = Math.floor(Date.now() / 1000)

/** Who the rows name: a face and a first name in When ("Ana, 1h ago"). */
const DIRECTORY = { [MIKY]: { displayName: 'Ana Duarte' }, [KATERINA]: { displayName: 'Ravi Mehta' }, [MARA]: { displayName: 'Mara Sato' } }

/** A Leaf page, as the tree reads one: who changed it last and when. */
const page = (d: string, title: string, hoursAgo = 2): ForeignObject =>
  ({
    kind: 30842,
    ref: `30842:${MIKY}:${d}`,
    address: `30842:${MIKY}:${d}`,
    folder: FOLDER,
    naddr: `naddr1${d.replace(/[^a-z0-9]/g, '')}`,
    eventId: d,
    meta: [],
    actions: [],
    slots: { title: { value: title }, subtitle: { value: 'Who does what on launch day, and in which order.' } },
    changedAt: NOW - hoursAgo * 3600,
    changedBy: MIKY,
  }) as unknown as ForeignObject

/** Another app's file, which Leaf opens as a page because its app shares its text. */
const tide = {
  kind: 30911,
  ref: `30911:${MIKY}:spring`,
  address: `30911:${MIKY}:spring`,
  folder: FOLDER,
  naddr: 'naddr1spring',
  eventId: 'spring',
  appName: 'Tide table',
  noun: 'reading',
  meta: [],
  actions: [],
  slots: { title: { value: 'Spring tides' } },
  changedAt: NOW - 3 * 86400,
  changedBy: KATERINA,
} as unknown as ForeignObject

const issue = shipIssue()
const project = shipProject()
const archivedIssue = { ...shipIssue({ archived: true }), address: `30851:${MIKY}:ltx-9`, ref: `30851:${MIKY}:ltx-9`, naddr: 'naddr1ltx9', slots: { ...shipIssue({ archived: true }).slots, title: { value: 'Old sidebar notes' } } } as ForeignObject

const initiative = (over: Partial<TopicPageData> = {}): TopicPageData => ({
  address: `30840:${MIKY}:launch`,
  title: 'Launch',
  summary: 'Everything that has to be true on launch day.',
  folder: FOLDER,
  archived: false,
  space: false,
  files: { live: [page('launch-plan', 'Launch plan'), project, issue], archived: [archivedIssue], looks: new Map() },
  ...over,
})

/**
 * Who is in it: Leaf's Members, the members pill and its dialog, as Ship's initiative page has them — its place listing
 * by key, the author's row captioned "Author". You are Ana; Join and Leave, and Add once you are in, say nothing here.
 */
const members = (readOnly = false) => (
  <Members
    members={new Map([MIKY, KATERINA, MARA].map((key) => [key, { pubkey: key } as never]))}
    me={MIKY}
    directory={DIRECTORY}
    readOnly={readOnly}
    roles={[{ pubkey: MIKY, role: 'Author' }]}
    onSetMine={async () => true}
    onAdd={async () => true}
  />
)

const meta = {
  title: 'Pages/Initiative page',
  component: TopicPageView,
  parameters: { layout: 'fullscreen' },
  args: { state: initiative(), team: 'Launch team', directory: DIRECTORY, members: members(), comments: { open: false, onOpenChange: fn() }, onRetry: fn() },
  // The app's own providers (App.tsx): a card's actions say what they did in a toast.
  decorators: [
    (Story) => (
      <TooltipProvider>
        <ToastProvider>
          <div className="flex h-screen bg-bg-base">{Story()}</div>
        </ToastProvider>
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof TopicPageView>

export default meta
type Story = StoryObj<typeof meta>

/** A page, a project and an issue it lists, each a row with its facts in Ship's four columns, and one archived. */
export const Default: Story = {}

/**
 * Every kind it can list, each a row, the initiative's order kept inside each kind: two pages, a project, an issue, and
 * another app's file, which says its type under its name. A look someone gave a file on the initiative (a card) is a hint
 * Leaf leaves to its rows, as Ship does.
 */
export const AllRows: Story = {
  args: {
    state: initiative({
      files: { live: [page('launch-plan', 'Launch plan'), tide, project, page('press-notes', 'Press notes', 26), issue], archived: [], looks: new Map([[project.address!, 'card']]) },
    }),
  },
}

/** The initiative itself is archived. */
export const Archived: Story = { args: { state: initiative({ archived: true }), members: members(true) } }

/** It lists nothing Leaf opens. */
export const Empty: Story = { args: { state: initiative({ files: { live: [], archived: [], looks: new Map() } }) } }

/** Everything it lists is archived. */
export const OnlyArchived: Story = { args: { state: initiative({ files: { live: [], archived: [archivedIssue], looks: new Map() } }) } }

/** Read, but not yet what it lists. */
export const ListLoading: Story = { args: { state: initiative({ files: 'loading' }) } }

/** What it lists did not load. */
export const ListFailed: Story = { args: { state: initiative({ files: 'failed' }) } }

/** Not read yet. */
export const Loading: Story = { args: { state: 'loading' } }

/** Did not load. */
export const Failed: Story = { args: { state: 'failed' } }
