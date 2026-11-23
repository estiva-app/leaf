import type { FolderSummary } from '@estiva-app/interop'
import { Button, EmptyState, KindIcon, ListTable, ListTableRow, MembersPill, Panel, SearchInput, SkeletonList, Tabs, useToast, type AvatarGroupMember, type ListTableColumn } from '@estiva-app/ui'
import { useEffect, useMemo, useState } from 'react'
import { useDirectory } from '../comments/people'
import { heldTopics, loadTopics } from '../document/fileTopics'
import { whenOf } from '../home/recent'
import { findsTopic, topicsByTab, type TopicRowData, type TopicsTab } from '../topics/exploreTopics'
import { joinTopic } from '../topics/joinTopic'
import { topicTitleOf, yourTopics } from '../topics/sidebarTopics'
import { useHeldTopics, useMuted, useTopicActivity, useTopicMembers } from '../topics/topicReads'
import { useReportFailure } from '@/lib/failureReports'

/** Peek's Explore initiatives, word for word (Katerina, 18 November: "everywhere a topic is mentioned, we should use Initiatives"). */
const TABS: Record<TopicsTab, string> = { all: 'All', yours: 'Your initiatives', others: 'Other initiatives', archived: 'Archived' }

/** What an empty tab says; with no initiative shown at all, every open tab says the first. */
const EMPTY: Record<TopicsTab, string> = {
  all: 'No initiatives yet.',
  yours: 'You’re in no initiatives yet.',
  others: 'No other initiatives.',
  archived: 'No archived initiatives.',
}

/** Nobody Leaf can name: a dash, as Peek's page draws them. */
const NO_FACE = (): AvatarGroupMember => ({ name: '—' })

/** Peek's columns: its team stays longest; who is in it and when it was last active give way first in a narrow window (Katerina, 16 November). */
const COLUMNS: ListTableColumn[] = [
  { label: 'Team', width: 'large' },
  // The members pill's width: three faces and the number (Katerina, 17 November).
  { label: 'Members', width: 'large', keep: 'low' },
  { label: 'Active', width: 'medium', keep: 'low' },
]

/**
 * Explore initiatives as it draws (TOPI-4): Peek's page (peek `ExploreTopicsView`, Katerina, 18 November: "just like in
 * Peek") in Leaf's page, as Home is drawn — a search beside tabs All, Your initiatives, Other initiatives and Archived,
 * each with its count, over the kit's list table: each initiative's name and summary, its team, who is in it (up to
 * three faces and the number) and when it was last active, and Join on one you are not in. The lists' order is the
 * caller's.
 */
export function ExploreTopicsView({
  lists,
  tab,
  onTab,
  onRetry,
  onJoin,
  joining,
  faceOf = NO_FACE,
}: {
  /** `loading` before the topics read lands, `failed` when it did not. */
  lists: Record<TopicsTab, TopicRowData[]> | 'loading' | 'failed'
  tab: TopicsTab
  onTab: (tab: TopicsTab) => void
  onRetry: () => void
  /** Join an initiative you are not in. */
  onJoin: (address: string) => void
  /** The initiatives whose Join is on its way. */
  joining?: ReadonlySet<string>
  /** A person's face by their key, for each row's members pill. Default a dash: the number alone tells. */
  faceOf?: (pubkey: string) => AvatarGroupMember
}) {
  const [query, setQuery] = useState('')
  // Drawn afresh each time it opens, so "now" is when it opened, as Home's.
  const [opened] = useState(() => Date.now())
  const asked = query.trim()
  useReportFailure(lists === 'failed' ? 'not-loaded' : undefined)
  const shown = typeof lists === 'string' ? [] : lists[tab].filter((topic) => !asked || findsTopic(topic.title, asked))
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel title="Explore initiatives" bodyClassName="px-6 py-5">
          {/* The page's whole width, 24px in and 20px down, as Ship's and Peek's lists (Katerina, 23 November: "not compact, fix Leaf"). */}
          {/* 24px between the tabs and the list, the kit's step between a page's parts, as Peek's (Katerina, 16 November: 16 was too tight). */}
          <div data-surface="explore-topics" className="flex w-full flex-col gap-6">
            {lists === 'loading' ? (
              <SkeletonList rows={8} />
            ) : lists === 'failed' ? (
              <EmptyState icon={<KindIcon kind="topic" />} scope="page" message="Initiatives didn’t load." action={{ label: 'Try again', onClick: onRetry }} />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Tabs<TopicsTab> aria-label="Explore initiatives" tabs={(Object.keys(TABS) as TopicsTab[]).map((id) => ({ id, label: TABS[id], count: lists[id].length }))} active={tab} onChange={onTab} />
                  <div className="w-64">
                    <SearchInput placeholder="Find an initiative" aria-label="Find an initiative" value={query} onChange={(event) => setQuery(event.target.value)} />
                  </div>
                </div>
                {shown.length === 0 ? (
                  <EmptyState scope="section" message={asked ? `No initiative matches “${asked}”.` : lists.all.length === 0 && tab !== 'archived' ? EMPTY.all : EMPTY[tab]} />
                ) : (
                  <ListTable aria-label="Explore initiatives" columns={COLUMNS} end>
                    {shown.map((topic) => (
                      <InitiativeRow
                        key={topic.address}
                        topic={topic}
                        now={opened}
                        faceOf={faceOf}
                        joining={joining?.has(topic.address) ?? false}
                        {...(!topic.yours && !topic.archived ? { onJoin: () => onJoin(topic.address) } : {})}
                      />
                    ))}
                  </ListTable>
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
 * One initiative, as Peek's Explore row: the kit's list row with its name and summary, its team, who is in it — the kit's
 * members pill, nothing to press, up to three faces and the number (Katerina, 17 November) — when anything last
 * happened in it, and Join on a live one you are not in. The Archived tab says it is archived; the row does not say it
 * again. It opens the initiative's page here (LTN-3), an archived one read-only.
 */
function InitiativeRow({
  topic,
  now,
  faceOf,
  joining,
  onJoin,
}: {
  topic: TopicRowData
  /** What Active counts back from, in ms: when the page opened. */
  now: number
  faceOf: (pubkey: string) => AvatarGroupMember
  joining: boolean
  onJoin?: () => void
}) {
  return (
    <ListTableRow
      data-topic={topic.address}
      href={topic.href}
      label={topic.title}
      {...(topic.summary ? { description: topic.summary } : {})}
      icon={<KindIcon kind="topic" />}
      cells={[
        topic.team,
        topic.members === undefined ? undefined : topic.members === 0 ? '0' : <MembersPill readOnly members={(topic.people ?? []).slice(0, 3).map(faceOf)} count={topic.members} />,
        topic.active ? whenOf(topic.active * 1000, now) : undefined,
      ]}
      end={
        // Outlined on a list's rows, where many are on screen; a place's own header has it primary (kit Button, 16 November).
        onJoin && (
          <Button size="small" variant="outlined" onClick={onJoin} disabled={joining}>
            Join
          </Button>
        )
      }
    />
  )
}

/**
 * Explore initiatives, which the sidebar's Explore initiatives opens at `/topics` (TOPI-4), as Peek's: every initiative you
 * can open, from the tab's one topics read (the sidebar's and Add to topic's), read afresh on open, opening on Your
 * topics, newest first as the sidebar orders them. Your topics' order waits for their activity, shared with the
 * sidebar; a tab's Members and Active are read when it is shown. A topic you join moves to Your topics once the topics
 * are read again, which Join does at once; the sidebar orders it by its activity.
 */
export function ExploreTopicsPage({ folders }: { folders: readonly FolderSummary[] | undefined }) {
  const { showToast } = useToast()
  // Who is in each row, by face: the workspace's people as every page here reads them; one not among them is a dash.
  const directory = useDirectory()
  const faceOf = useMemo(() => (pubkey: string): AvatarGroupMember => {
    const person = directory[pubkey]
    return person ? { name: person.displayName, ...(person.picture ? { picture: person.picture } : {}), ...(person.bot ? { bot: true } : {}) } : NO_FACE()
  }, [directory])
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
    if (!result.ok) showToast({ label: `Nothing changed: “${title}” could not be joined. ${result.reason}`, type: 'error', failure: 'not-joined' })
    else if (result.stillMuted) showToast({ label: `Joined “${title}”, but it is still muted. Join again to unmute it.`, type: 'error', failure: 'not-saved' })
    else {
      // Peek's words for a Join on its Explore (Katerina, 18 November, E1), no Undo, as Peek's has none there. It lands at
      // Important, as Peek's (her "let's make it to important"); a level you chose before stays, and is said as Peek's bell
      // says All: Everything.
      showToast({ label: `You joined ${title}. Notifications: ${result.level === 'all' ? 'Everything' : 'Important'}.`, type: 'success' })
      setJoined((now) => new Map(now).set(address, topic.following.in))
    }
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
      faceOf={faceOf}
    />
  )
}
