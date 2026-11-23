import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconFilePlus, IconHome } from '@tabler/icons-react'
import { AppShell, NavItem, NavTree, Sidebar, type AvatarGroupMember, type NavTreeGroup } from '@estiva-app/ui'
import { TopicsSection } from '../topics/TopicsSection'
import type { TopicRowData, TopicsTab } from '../topics/exploreTopics'
import { ExploreTopicsView } from './ExploreTopicsPage'

/* Explore initiatives in Leaf's frame, as `App` draws it: Home, the sidebar's Initiatives with Explore initiatives lit, the teams. */

const NOW = Math.floor(Date.now() / 1000)
const HOUR = 3600
const KEY = (n: number) => String(n).repeat(64)
const PEOPLE: Record<string, AvatarGroupMember> = {
  [KEY(1)]: { name: 'Ana Duarte' },
  [KEY(2)]: { name: 'Ravi Mehta' },
  [KEY(3)]: { name: 'Mara Sato' },
  [KEY(4)]: { name: 'Jonas Berg' },
}
const faceOf = (pubkey: string): AvatarGroupMember => PEOPLE[pubkey] ?? { name: '—' }

const row = (d: string, title: string, team: string, people: number, hoursAgo: number, yours: boolean, summary?: string, archived = false): TopicRowData => ({
  address: `30840:${KEY(9)}:${d}`,
  title,
  ...(summary ? { summary } : {}),
  href: '#',
  team,
  members: people,
  people: Object.keys(PEOPLE).slice(0, people),
  active: NOW - hoursAgo * HOUR,
  archived,
  yours,
})
const YOURS = [
  row('nav', 'Cross-app navigation', 'Product', 4, 1, true, 'Teams and initiatives in every app.'),
  row('speed', 'Speed', 'Engineering', 3, 5, true),
  row('launch', 'Launch', 'Product', 2, 30, true),
]
const OTHERS = [row('brand', 'Brand refresh', 'Design', 1, 72, false, 'A new mark and type for every app.'), row('pricing', 'Pricing', 'Sales', 0, 200, false)]
const ARCHIVED = [row('old', 'Spring offsite', 'Company', 3, 900, false, undefined, true)]
const LISTS: Record<TopicsTab, TopicRowData[]> = { all: [...YOURS, ...OTHERS].sort((a, b) => a.title.localeCompare(b.title)), yours: YOURS, others: OTHERS, archived: ARCHIVED }
const EMPTY: Record<TopicsTab, TopicRowData[]> = { all: [], yours: [], others: [], archived: [] }

const SIDEBAR_INITIATIVES = YOURS.map((topic) => ({ address: topic.address, title: topic.title, files: [] }))
const TEAMS: NavTreeGroup[] = [
  { id: 'hq', title: 'Estiva HQ', open: false, nodes: [] },
  { id: 'leaf', title: 'Leaf', open: false, nodes: [] },
]

/** Leaf's frame around the page, Explore initiatives lit in the sidebar. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen">
      <AppShell
        variant="inset"
        logo="Leaf"
        nav={
          <Sidebar>
            <NavItem href="#" label="Home" icon={<IconHome size={16} stroke={1.5} />} />
            <TopicsSection topics={SIDEBAR_INITIATIVES} exploreNow fileNow={(file) => file} />
            <NavTree title="Teams" titleActions={[{ icon: <IconFilePlus size={16} stroke={1.5} />, tooltip: 'New document', onClick: () => {} }]} groups={TEAMS} />
          </Sidebar>
        }
      >
        {children}
      </AppShell>
    </div>
  )
}

const meta = {
  title: 'Pages/Explore initiatives',
  component: ExploreTopicsView,
  parameters: { layout: 'fullscreen' },
  args: { lists: LISTS, tab: 'all', onTab: () => {}, onRetry: () => {}, onJoin: () => {}, faceOf },
  render: (args) => (
    <Frame>
      <ExploreTopicsView {...args} />
    </Frame>
  ),
} satisfies Meta<typeof ExploreTopicsView>

export default meta
type Story = StoryObj<typeof meta>

/** Every initiative you can open, A to Z: faces and the number in each members pill, Join on the ones you are not in. */
export const All: Story = {}

/** Yours, newest activity first: no Join. */
export const YourInitiatives: Story = { args: { tab: 'yours' } }

/** Join on its way: the button waits. */
export const Joining: Story = { args: { tab: 'others', joining: new Set([OTHERS[0].address]) } }

/** The archived ones, apart, with no Join. */
export const Archived: Story = { args: { tab: 'archived' } }

/** None at all: every tab says the first line. */
export const Empty: Story = { args: { lists: EMPTY, tab: 'yours' } }

/** While the initiatives are read. */
export const Loading: Story = { args: { lists: 'loading' } }

/** The read did not land: said in words, with Try again. */
export const Failed: Story = { args: { lists: 'failed' } }
