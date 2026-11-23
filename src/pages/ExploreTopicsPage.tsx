import type { FolderSummary } from '@estiva-app/interop'
import { ExploreList, exploreWords, KindIcon, useToast, type AvatarGroupMember, type ExploreRow, type ExploreTab } from '@estiva-app/ui'
import { useEffect, useMemo, useState } from 'react'
import { useDirectory } from '../comments/people'
import { heldTopics, loadTopics } from '../document/fileTopics'
import { whenOf } from '../home/recent'
import { topicsByTab, type TopicRowData, type TopicsTab } from '../topics/exploreTopics'
import { joinTopic } from '../topics/joinTopic'
import { topicTitleOf, yourTopics } from '../topics/sidebarTopics'
import { useHeldTopics, useMuted, useTopicActivity, useTopicMembers } from '../topics/topicReads'
import { useReportFailure } from '@/lib/failureReports'

/**
 * Peek's Explore initiatives, word for word (Katerina, 18 November: "everywhere a topic is mentioned, we should use
 * Initiatives"): its title, tabs All, Your initiatives, Other initiatives and Archived, what an empty tab says, and the
 * search's words, all made by the kit from what it lists.
 */
const WORDS = exploreWords({ one: 'initiative', many: 'initiatives', a: 'an' })

/** Nobody Leaf can name: a dash, as Peek's page draws them. */
const NO_FACE = (): AvatarGroupMember => ({ name: '—' })

/** One initiative as the kit's Explore row: its name and summary, its team, who is in it, and when it was last active. */
function rowOf(topic: TopicRowData, now: number, faceOf: (pubkey: string) => AvatarGroupMember): ExploreRow {
  return {
    id: topic.address,
    label: topic.title,
    href: topic.href,
    ...(topic.summary ? { description: topic.summary } : {}),
    ...(topic.team !== undefined ? { team: topic.team } : {}),
    // Up to three faces and the number, nothing to press (Katerina, 17 November); `undefined` until read: the dash.
    ...(topic.members !== undefined ? { members: { faces: (topic.people ?? []).slice(0, 3).map(faceOf), count: topic.members } } : {}),
    ...(topic.active ? { active: whenOf(topic.active * 1000, now) } : {}),
    yours: topic.yours,
    archived: topic.archived,
  }
}

/**
 * Explore initiatives as it draws (TOPI-4): Peek's page (peek `ExploreTopicsView`, Katerina, 18 November: "just like in
 * Peek") in Leaf's page, the kit's ExploreList, which Peek's, Ship's and Leaf's each drew by hand (review of 23 November,
 * C6): a search beside tabs All, Your initiatives, Other initiatives and Archived, each with its count, over the kit's
 * list table: each initiative's name and summary, its team, who is in it (up to three faces and the number) and when it
 * was last active, and Join on one you are not in. The search finds the start of a word of its name, as everywhere. The
 * lists' order is the caller's.
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
  // Drawn afresh each time it opens, so "now" is when it opened, as Home's.
  const [opened] = useState(() => Date.now())
  useReportFailure(lists === 'failed' ? 'not-loaded' : undefined)
  const rows = useMemo(
    () => (typeof lists === 'string' ? lists : (Object.fromEntries(Object.entries(lists).map(([id, topics]) => [id, topics.map((topic) => rowOf(topic, opened, faceOf))])) as Record<ExploreTab, ExploreRow[]>)),
    [lists, opened, faceOf],
  )
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The page's whole width, 24px in and 20px down, as Ship's and Peek's lists (Katerina, 23 November: "not compact, fix Leaf"). */}
        <ExploreList
          lists={rows}
          tab={tab}
          onTab={onTab}
          onRetry={onRetry}
          onJoin={(row) => onJoin(row.id)}
          {...(joining ? { joining } : {})}
          words={WORDS}
          icon={<KindIcon kind="topic" />}
        />
      </div>
    </div>
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
