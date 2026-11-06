import { EmptyState, Panel, SearchInput, SkeletonList, Tabs } from '@estiva-app/ui'
import { IconTarget } from '@tabler/icons-react'
import { useState } from 'react'
import { TopicRow, type TopicRowData } from './TopicRow'

export type TopicsTab = 'all' | 'yours' | 'others' | 'archived'

const TABS: Record<TopicsTab, string> = { all: 'All', yours: 'Your topics', others: 'Other topics', archived: 'Archived' }

/** What an empty tab says. */
const EMPTY: Record<TopicsTab, string> = {
  all: 'No topics yet.',
  yours: 'You’re in no topics yet.',
  others: 'No other topics.',
  archived: 'No archived topics.',
}

/**
 * Explore topics in Leaf: Ship's Topics page (estiva-ship `src/views/TopicsView.tsx`) in Leaf's page, as Home is drawn,
 * with the search and Join the project adds. All, Other topics and Archived come A to Z; Your topics in the sidebar's
 * order (the caller's lists). An archived topic opens read-only, as any archived topic's page does.
 */
export function ExploreTopicsPage({
  lists,
  start = 'all',
  onRetry,
  onJoin,
}: {
  /** `loading` before the topics read lands, `failed` when it did not. */
  lists: Record<TopicsTab, TopicRowData[]> | 'loading' | 'failed'
  start?: TopicsTab
  onRetry: () => void
  /** Join on a topic you're not in: every row of Other topics, and those rows on All. */
  onJoin: (address: string) => void
}) {
  const [tab, setTab] = useState<TopicsTab>(start)
  const [q, setQ] = useState('')
  const find = q.trim().toLowerCase()
  const yours = new Set(typeof lists === 'object' ? lists.yours.map((t) => t.address) : [])
  const archived = new Set(typeof lists === 'object' ? lists.archived.map((t) => t.address) : [])
  const rows = typeof lists === 'object' ? lists[tab].filter((t) => t.title.toLowerCase().includes(find)) : []
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel title="Explore topics" bodyClassName="px-12 pt-10 pb-24">
          <div data-surface="explore-topics" className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {lists === 'loading' ? (
              <SkeletonList rows={8} />
            ) : lists === 'failed' ? (
              <EmptyState icon={<IconTarget size={16} stroke={1.5} />} scope="page" message="Topics didn’t load." action={{ label: 'Try again', onClick: onRetry }} />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Tabs<TopicsTab> aria-label="Topics" tabs={(Object.keys(TABS) as TopicsTab[]).map((id) => ({ id, label: TABS[id], count: lists[id].length }))} active={tab} onChange={setTab} />
                  <div className="w-64">
                    <SearchInput placeholder="Find a topic" aria-label="Find a topic" value={q} onChange={(e) => setQ(e.target.value)} />
                  </div>
                </div>
                {rows.length === 0 ? (
                  <EmptyState scope="section" message={find ? `No topic matches “${q.trim()}”.` : EMPTY[tab]} />
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="hidden items-center gap-3 px-3 text-caption text-text-muted sm:flex">
                      <span className="flex-1 pl-7">Name</span>
                      <span className="w-16">Projects</span>
                      <span className="w-28">Conversations</span>
                      <span className="w-14" />
                    </div>
                    <div className="flex flex-col gap-px">
                      {rows.map((topic) => (
                        <TopicRow key={topic.address} topic={topic} onJoin={!yours.has(topic.address) && !archived.has(topic.address) ? () => onJoin(topic.address) : undefined} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
