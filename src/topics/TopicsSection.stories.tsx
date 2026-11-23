import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { Sidebar } from '@estiva-app/ui'
import { TopicsSection } from './TopicsSection'

/* The sidebar's Initiatives: your five newest, each folding to the pages it lists, then Explore initiatives. */

const KAT = 'a'.repeat(64)
const page = (d: string, title: string) =>
  ({ kind: 30842, ref: `30842:${KAT}:${d}`, address: `30842:${KAT}:${d}`, naddr: `naddr-${d}`, slots: { title: { value: title } }, meta: [], actions: [] }) as unknown as ForeignObject
const initiative = (d: string, title: string, files: ForeignObject[] = []) => ({ address: `30840:${KAT}:${d}`, title, files })

const FIVE = [
  initiative('nav', 'Cross-app navigation', [page('brief', 'Navigation brief'), page('notes', 'Call notes')]),
  initiative('speed', 'Speed'),
  initiative('launch', 'Launch', [page('plan', 'Launch plan')]),
  initiative('brand', 'Brand refresh'),
  initiative('hiring', 'Hiring'),
]

const meta = {
  title: 'Pages/Initiatives in the sidebar',
  component: TopicsSection,
  args: { topics: FIVE, fileNow: (file: ForeignObject) => file },
  render: (args) => (
    <div className="flex h-screen w-72">
      <Sidebar>
        <TopicsSection {...args} />
      </Sidebar>
    </div>
  ),
} satisfies Meta<typeof TopicsSection>

export default meta
type Story = StoryObj<typeof meta>

/** Your five newest; one with pages folds to them. */
export const Five: Story = {}

/** An initiative's page open: its row is lit, its fold left as it is: only its arrow folds it, as Peek's rows (Katerina, 23 November). */
export const OnAnInitiative: Story = { args: { topicNow: 'nav' } }

/**
 * A page clicked under an initiative: that initiative opens to it, the page's row lit there; the teams' tree lights
 * nothing (Katerina, 23 November: one place lit). Opened any other way, it is lit in its team and nothing here is.
 */
export const AFileOpen: Story = { args: { lit: { topic: `30840:${KAT}:launch`, file: 'naddr-plan' } } }

/** Explore initiatives open: its row is lit. */
export const ExploreOpen: Story = { args: { exploreNow: true } }

/** In none yet: the line, and Explore initiatives as the way in. */
export const None: Story = { args: { topics: [] } }

/** While they are read. */
export const Loading: Story = { args: { topics: 'loading' } }

/** The read did not land: said in words, with Explore initiatives still there. */
export const Failed: Story = { args: { topics: 'failed' } }
