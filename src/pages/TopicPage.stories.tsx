import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { fn } from 'storybook/test'
import { ToastProvider, TooltipProvider } from '@estiva-app/ui'
import { TopicPageView } from './TopicPage'
import { shipIssue, shipProject, MIKY } from './fixtures/shipFiles'
import type { TopicPageData } from '../topics/useTopicPage'

/*
  An initiative's page in Leaf, handed what it shows (TopicPageView): a page of Leaf's, a Ship project and a Ship issue,
  in the initiative's order, each drawn with the look it has there (a page and a project as cards, an issue as a row, as
  their manifests say), and one archived. Invented names only.
*/

const FOLDER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'

/** A Leaf page, as the tree reads one. */
const page = (d: string, title: string): ForeignObject =>
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
  }) as unknown as ForeignObject

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

const meta = {
  title: 'Pages/Initiative page',
  component: TopicPageView,
  parameters: { layout: 'fullscreen' },
  args: { state: initiative(), team: 'Launch team', comments: { open: false, onOpenChange: fn() }, onRetry: fn() },
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

/** A page, a project and an issue it lists, and one archived. */
export const Default: Story = {}

/** Every file it lists drawn as a row: the look chosen on the initiative (TOPI-5). */
export const AllRows: Story = {
  args: {
    state: initiative({
      files: { live: [page('launch-plan', 'Launch plan'), page('press-notes', 'Press notes'), project, issue], archived: [], looks: new Map([[`30842:${MIKY}:launch-plan`, 'row'], [`30842:${MIKY}:press-notes`, 'row'], [project.address!, 'row']]) },
    }),
  },
}

/** The initiative itself is archived. */
export const Archived: Story = { args: { state: initiative({ archived: true }) } }

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
