import type { FolderSummary } from '@estiva-app/interop'
import { EmptyState, Panel, SearchInput, SkeletonList, Tabs, useToast } from '@estiva-app/ui'
import { IconTarget } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { heldTopics, loadTopics } from '../document/fileTopics'
import { findsTopic, topicsByTab, type TopicRowData, type TopicsTab } from '../topics/exploreTopics'
import { joinTopic } from '../topics/joinTopic'
import { topicTitleOf, yourTopics } from '../topics/sidebarTopics'
import { useHeldTopics, useMuted, useTopicActivity, useTopicMembers } from '../topics/topicReads'
import { TopicRow } from '../topics/TopicRow'

const TABS: Record<TopicsTab, string> = { all: 'All', yours: 'Your topics', others: 'Other topics', archived: 'Archived' }

/** What an empty tab says; with no topic shown at all, every open tab says the first. */
const EMPTY: Record<TopicsTab, string> = {
  all: 'No topics yet.',
  yours: 'You are in no topic yet.',
  others: 'No other topics.',
  archived: 'No archived topics.',
}

/**
 * Explore topics as it draws (TOPI-4): Ship's Topics view (estiva-ship `src/views/TopicsView.tsx`) in Leaf's page, as
 * Home is drawn — a search beside tabs All, Your topics, Other topics and Archived, each with its count, and Join on a
 * topic you are not in. The lists' order is the caller's.
 */
export function ExploreTopicsView({
  lists,
  tab,
  onTab,
  onRetry,
  onJoin,
  joining,
}: {
  /** `loading` before the topics read lands, `failed` when it did not. */
  lists: Record<TopicsTab, TopicRowData[]> | 'loading' | 'failed'
  tab: TopicsTab
  onTab: (tab: TopicsTab) => void
  onRetry: () => void
  /** Join a topic you are not in. */
  onJoin: (address: string) => void
  /** The topics whose Join is on its way. */
  joining?: ReadonlySet<string>
}) {
  const [query, setQuery] = useState('')
  // Drawn afresh each time it opens, so "now" is when it opened, as Home's.
  const [opened] = useState(() => Date.now())
  const asked = query.trim()
  const shown = typeof lists === 'string' ? [] : lists[tab].filter((topic) => !asked || findsTopic(topic.title, asked))
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
                  <Tabs<TopicsTab> aria-label="Topics" tabs={(Object.keys(TABS) as TopicsTab[]).map((id) => ({ id, label: TABS[id], count: lists[id].length }))} active={tab} onChange={onTab} />
                  <div className="w-64">
                    <SearchInput placeholder="Find a topic" aria-label="Find a topic" value={query} onChange={(event) => setQuery(event.target.value)} />
                  </div>
                </div>
                {shown.length === 0 ? (
                  <EmptyState scope="section" message={asked ? `No topic matches “${asked}”.` : lists.all.length === 0 && tab !== 'archived' ? EMPTY.all : EMPTY[tab]} />
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="hidden items-center gap-3 px-3 text-caption text-text-muted sm:flex">
                      <span className="flex-1 pl-7">Name</span>
                      <span className="w-28">Team</span>
                      <span className="w-20">Members</span>
                      <span className="w-24">Active</span>
                      <span className="w-16" />
                    </div>
                    <div className="flex flex-col gap-px">
                      {shown.map((topic) => (
                        <TopicRow
                          key={topic.address}
                          topic={topic}
                          now={opened}
                          joining={joining?.has(topic.address)}
                          {...(!topic.yours && !topic.archived ? { onJoin: () => onJoin(topic.address) } : {})}
                        />
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

/**
 * Explore topics, which the sidebar's Explore topics opens at `/topics` (TOPI-4), as Ship's Topics page: every topic you
 * can open, from the tab's one topics read (the sidebar's and Add to topic's), read afresh on open, opening on Your
 * topics, newest first as the sidebar orders them. Your topics' order waits for their activity, shared with the
 * sidebar; a tab's Members and Active are read when it is shown. A topic you join moves to Your topics once the topics
 * are read again, which Join does at once; the sidebar orders it by its activity.
 */
export function ExploreTopicsPage({ folders }: { folders: readonly FolderSummary[] | undefined }) {
  const { showToast } = useToast()
  const [tab, setTab] = useState<TopicsTab>('yours')
  const [joining, setJoining] = useState<ReadonlySet<string>>(new Set())
  /** Joined here, each with whether you followed it before: its row loses Join at once, and counts you once. */
  const [joined, setJoined] = useState<ReadonlyMap<string, boolean>>(new Map())
  useEffect(() => {
    // Read afresh as the page opens, so a topic started since shows; the first read of a tab opened here is shared.
    void (heldTopics.snapshot().value ? heldTopics.reload(loadTopics) : heldTopics.ensure(loadTopics))
  }, [])
  const read = useHeldTopics()
  const held = typeof read === 'object' ? read : undefined
  const { muted, settled } = useMuted(held, held !== undefined)
  const yours = useMemo(() => (held && settled ? yourTopics(held, muted) : undefined), [held, settled, muted])
  const order = useTopicActivity(held, yours)
  const teamName = useMemo(() => {
    const names = new Map((folders ?? []).map((summary) => [summary.id, summary.name ?? 'Untitled team']))
    return (id: string) => names.get(id)
  }, [folders])
  // Which topics the shown tab draws: theirs are the Members and Active read.
  const shownTab = useMemo(() => (held && settled ? topicsByTab(held, {}, muted)[tab].map((row) => row.address) : undefined), [held, settled, muted, tab])
  const active = useTopicActivity(held, shownTab)
  const members = useTopicMembers(held, shownTab)
  const lists = useMemo(() => {
    if (!held || !settled || (!order.values && !order.failed)) return undefined
    const drawn = topicsByTab(held, { at: active.values ?? order.values, members: members.values, teamName }, muted)
    if (joined.size === 0) return drawn
    const withJoined = (row: TopicRowData): TopicRowData =>
      joined.has(row.address) && !row.yours ? { ...row, yours: true, ...(row.members !== undefined && !joined.get(row.address) ? { members: row.members + 1 } : {}) } : row
    return Object.fromEntries(Object.entries(drawn).map(([id, rows]) => [id, rows.map(withJoined)])) as typeof drawn
  }, [held, settled, order.values, order.failed, active.values, members.values, teamName, muted, joined])

  const onJoin = async (address: string) => {
    const topic = held?.topics.find((candidate) => candidate.address === address)
    if (!topic || joining.has(address)) return
    setJoining((now) => new Set(now).add(address))
    const result = await joinTopic(topic)
    setJoining((now) => {
      const next = new Set(now)
      next.delete(address)
      return next
    })
    const title = topicTitleOf(topic)
    // As Peek's Join says it. Joined while the mute stays: Join stays too, so a second click takes the mute out.
    if (!result.ok) showToast({ label: `Nothing changed: “${title}” could not be joined. ${result.reason}`, type: 'error' })
    else if (result.stillMuted) showToast({ label: `Joined “${title}”, but it is still muted. Join again to unmute it.`, type: 'error' })
    else setJoined((now) => new Map(now).set(address, topic.following.in))
    // Read the topics again, so the joined one moves to Your topics now (Miky, 10 Nov).
    if (result.ok) void heldTopics.reload(loadTopics)
  }

  return (
    <ExploreTopicsView
      lists={lists ?? (read === 'failed' ? 'failed' : 'loading')}
      tab={tab}
      onTab={setTab}
      onRetry={() => void heldTopics.reload(loadTopics)}
      onJoin={(address) => void onJoin(address)}
      joining={joining}
    />
  )
}
