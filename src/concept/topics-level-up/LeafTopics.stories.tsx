import { useEffect, useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, mocked, userEvent, within } from 'storybook/test'
import { AppProvider, AppShell, IdentityMenu, NavItem, NavTree, Sidebar, ToastProvider, TooltipProvider } from '@estiva-app/ui'
import { IconFilePlus, IconHome } from '@tabler/icons-react'
import { useThreads } from '../../comments/useThreads'
import { fileKey } from '../../folders/tree'
import { HomePage } from '../../pages/HomePage'
import { FilePage } from '../../pages/FilePage'
import { TopicPage } from '../../pages/TopicPage'
import { answer, factsOf } from '../../pages/fixtures/relay'
import { MIKY, PROFILES, threadsOn } from '../../pages/fixtures/shipFiles'
import { query, viewerPubkey } from '../../relay/bridge'
import { documentPath, navigate, replace, routeOf } from '../../route'
import type { SidebarTopicsState } from '../../topics/useSidebarTopics'
import { useTopicPage, type TopicPageState } from '../../topics/useTopicPage'
import { ExploreTopicsPage, type TopicsTab } from './ExploreTopicsPage'
import {
  EVERY_FILE,
  FILES,
  FOLDERS,
  RECENT,
  addressOf,
  dOfId,
  documentOfD,
  exploreLists,
  fileAt,
  fileByKey,
  sidebarTopics,
  teamGroups,
  topicById,
  topicOfD,
  topicPageOf,
} from './fixtures'
import { EXPLORE_PATH, TopicsSection } from './TopicsSection'
import { topicPath } from '../../topics/topicLinks'

/*
  Topics level-up in Leaf, drawn on Leaf as it ships (origin/main 434879c): the frame is App.tsx's AppShell, sidebar
  and identity menu, and the main area is Leaf's own HomePage, TopicPage and FilePage fed fixtures. What the project
  changes is in this folder: the sidebar's Topics (a copy of `src/topics/TopicsSection.tsx`) and Explore topics (Ship's
  Topics page, copied, with search and Join). Every link in the story stays in the story: AppProvider's navigate, and
  the app's own navigate and replace, move only the story's path.
*/

type Read = 'ok' | 'loading' | 'failed'

interface LeafTopicsProps {
  /** Where the story opens: '/', '/topics', a topic's or a page's path. */
  start: string
  /** The sidebar's read of your topics; `none`: you're in no topic. */
  topics?: Read | 'none'
  /** Explore's read. */
  explore?: Read
  /** The tab Explore opens on. */
  tab?: TopicsTab
  /** A topic with newer activity since the last open, read on this open: it leads. */
  bumped?: string
  /** Home's read: `loading` as on a cold open. */
  home?: 'ok' | 'loading'
  /** A topic page that cannot be opened. */
  unavailable?: boolean
}

/** The story's own path, for the app's navigate and replace (mocked) to move. */
let goTo: (href: string) => void = () => {}

function LeafApp({ start, topics: topicsRead = 'ok', explore = 'ok', tab, bumped, home = 'ok', unavailable }: LeafTopicsProps) {
  const [path, setPath] = useState(start)
  const [joined, setJoined] = useState<ReadonlySet<string>>(new Set())
  const [exploreRead, setExploreRead] = useState<Read>(explore)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  useEffect(() => {
    goTo = (href) => setPath(href.split(/[?#]/)[0])
  }, [])
  // The sidebar is read once, on open: a topic joined here or written in elsewhere reorders it on the next open.
  const topics = useMemo<SidebarTopicsState>(
    () => (topicsRead === 'loading' || topicsRead === 'failed' ? topicsRead : topicsRead === 'none' ? [] : sidebarTopics(new Set(), bumped)),
    [topicsRead, bumped],
  )
  const route = path === EXPLORE_PATH ? null : routeOf(path)
  mocked(useTopicPage).mockImplementation((d) => {
    const topic = topicOfD(d)
    const state: TopicPageState = unavailable || !topic ? 'unavailable' : topicPageOf(topic)
    return { state, retry: () => {} }
  })
  const open = route?.page === 'document' ? documentOfD(route.d) : route?.page === 'file' ? fileByKey(route.naddr) : null
  const current = open ? fileKey(open) : undefined

  const main = !route ? (
    <ExploreTopicsPage
      lists={exploreRead === 'ok' ? exploreLists(joined) : exploreRead}
      start={tab}
      onRetry={() => setExploreRead('ok')}
      onJoin={(address) => setJoined((was) => new Set(was).add(idOfAddress(address)))}
    />
  ) : route.page === 'home' ? (
    <HomePage relay="https://estiva.estiva.app" state="live" name="Miky" recent={home === 'loading' ? null : RECENT} onNew={() => {}} />
  ) : route.page === 'topic' ? (
    <TopicPage key={route.d} d={route.d} folders={FOLDERS} inTree={fileAt} treeRead />
  ) : (
    <FilePage key={current ?? path} file={open} loading={false} folders={FOLDERS} />
  )

  return (
    <AppProvider navigate={(href) => goTo(href)}>
      <AppShell
        variant="inset"
        logo="Leaf"
        navOpen={sidebarOpen}
        onNavOpenChange={setSidebarOpen}
        identity={<IdentityMenu me={{ name: 'Miky' }} signedIn onSignOut={() => {}} />}
        nav={
          <Sidebar>
            <NavItem href="/" label="Home" icon={<IconHome size={16} stroke={1.5} />} active={route?.page === 'home'} />
            <TopicsSection
              topics={topics}
              current={current}
              topicNow={route?.page === 'topic' ? route.d : undefined}
              exploreNow={!route}
              fileNow={(file) => file}
            />
            <NavTree
              title="Teams"
              titleActions={[{ icon: <IconFilePlus size={16} stroke={1.5} />, tooltip: 'New document', onClick: () => {} }]}
              groups={teamGroups()}
              selected={current}
              emptyMessage="No teams yet."
            />
          </Sidebar>
        }
      >
        {main}
      </AppShell>
    </AppProvider>
  )
}

/** A topic's spec id from its address, for the story's own record of what you joined. */
const idOfAddress = (address: string) => topicOfD(address.split(':')[2])?.id ?? address

const topicAt = (id: string) => topicPath(addressOf(topicById(id)), topicById(id).title)

const meta = {
  title: 'Prototype/Topics level-up/Leaf: Topics',
  component: LeafApp,
  parameters: { layout: 'fullscreen' },
  // The relay's answers for every page a click can open, the comments beside them, and Miky reading.
  beforeEach: () => {
    mocked(viewerPubkey).mockReturnValue(MIKY)
    const held = EVERY_FILE.flatMap(factsOf)
    mocked(query).mockImplementation(async (filters) => (filters.some((f) => Array.isArray(f.kinds) && f.kinds.includes(0)) ? PROFILES : answer(held, filters)))
    mocked(useThreads).mockImplementation((doc) => threadsOn((doc.address && fileAt(doc.address)) || FILES.spec))
    mocked(navigate).mockImplementation((href) => goTo(href))
    mocked(replace).mockImplementation(() => {})
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <ToastProvider>
          <div className="h-screen">
            <Story />
          </div>
        </ToastProvider>
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof LeafApp>

export default meta
type Story = StoryObj<typeof meta>

/** Folds a sidebar topic open, as a click on its icon does. */
async function unfold(canvasElement: HTMLElement, title: string) {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: `Show what is under ${title}` }))
  // The click's focus ring is not part of the picture.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

/**
 * Home, with your five newest topics in the sidebar, newest activity first, then Explore topics where More was. Widgets
 * folded open shows its pages, projects and issues as today.
 */
export const FiveTopics: Story = {
  name: 'Leaf: five topics',
  args: { start: '/' },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement, 'Widgets')
    await expect(within(canvasElement).getByRole('link', { name: 'Explore topics' })).toBeVisible()
  },
}

/** The next open, after Katerina wrote in Onboarding: it leads the five, and Estiva Suits Update drops out of view. */
export const NextOpen: Story = {
  name: 'Leaf: the next open, after a message in Onboarding',
  args: { start: '/', bumped: 'onb' },
}

/** A topic's page, Leaf's own as today, opened from the sidebar. */
export const TopicsPage: Story = {
  name: 'Leaf: a topic’s page',
  args: { start: topicAt('widgets') },
}

/** A page a topic lists, opened from its fold in the sidebar: Leaf's page as today. */
export const PageFromTopic: Story = {
  name: 'Leaf: a page opened from a topic',
  args: { start: documentPath(dOfId('spec'), 'Widgets spec') },
  play: async ({ canvasElement }) => unfold(canvasElement, 'Widgets'),
}

/** Explore topics: All, A to Z, with Join on the topics you're not in, and a search. */
export const Explore: Story = {
  name: 'Leaf: Explore topics',
  args: { start: EXPLORE_PATH },
}

/** Explore's Your topics: in the sidebar's order, newest activity first, every one of them. */
export const ExploreYours: Story = {
  name: 'Leaf: Explore topics, your topics',
  args: { start: EXPLORE_PATH, tab: 'yours' },
}

/** Explore's Other topics, A to Z: Join on each. */
export const ExploreOthers: Story = {
  name: 'Leaf: Explore topics, other topics',
  args: { start: EXPLORE_PATH, tab: 'others' },
}

/** Explore's Archived, A to Z: no Join; each opens read-only. */
export const ExploreArchived: Story = {
  name: 'Leaf: Explore topics, archived',
  args: { start: EXPLORE_PATH, tab: 'archived' },
}

/** Join on Hiring: it leaves Other topics for Your topics. The sidebar takes it on the next open. */
export const ExploreJoin: Story = {
  name: 'Leaf: joining a topic from Explore',
  args: { start: EXPLORE_PATH, tab: 'others' },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(`[data-topic="${addressOf(topicById('hiring'))}"]`)!
    await userEvent.click(within(row).getByRole('button', { name: 'Join' }))
    await expect(within(canvasElement).queryByText('Hiring')).toBeNull()
  },
}

/** A search that finds nothing. */
export const ExploreNoMatch: Story = {
  name: 'Leaf: Explore topics, nothing found',
  args: { start: EXPLORE_PATH },
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole('textbox', { name: 'Find a topic' }), 'roadmap')
  },
}

/** You're in no topic: the sidebar says so above Explore topics, and Explore's Your topics is empty. */
export const ExploreEmpty: Story = {
  name: 'Leaf: Explore topics, you’re in none',
  args: { start: EXPLORE_PATH, tab: 'yours', topics: 'none' },
}

/** While Explore reads the topics. */
export const ExploreLoading: Story = {
  name: 'Leaf: Explore topics, loading',
  args: { start: EXPLORE_PATH, explore: 'loading' },
}

/** Explore could not read the topics: Try again. */
export const ExploreFailed: Story = {
  name: 'Leaf: Explore topics, read failed',
  args: { start: EXPLORE_PATH, explore: 'failed' },
}

/** An archived topic, opened from Explore's Archived: its page read-only, "Archived" under its title, as today. */
export const ArchivedTopic: Story = {
  name: 'Leaf: an archived topic',
  args: { start: topicAt('comments') },
}

/** A topic you're not in, opened from Explore: its page as today; Join is on Explore's row. */
export const NotAMember: Story = {
  name: 'Leaf: a topic you’re not in',
  args: { start: topicAt('brand') },
}

/** A topic you can't open: the notice any file you can't open gets, as today. */
export const NoAccess: Story = {
  name: 'Leaf: a topic you can’t open',
  args: { start: topicAt('hiring'), unavailable: true },
}

/** You're in no topic yet: Topics stays, says so, and Explore topics is the way in (today Leaf leaves Topics out). */
export const NoTopics: Story = {
  name: 'Leaf: no topics yet',
  args: { start: '/', topics: 'none' },
}

/** A cold open: your topics and Home's Recent still being read. */
export const Loading: Story = {
  name: 'Leaf: loading',
  args: { start: '/', topics: 'loading', home: 'loading' },
}

/** Your topics could not be read: the line Leaf says today, then Explore topics. */
export const ReadFailed: Story = {
  name: 'Leaf: read failed',
  args: { start: '/', topics: 'failed' },
}
