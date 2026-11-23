import type { ForeignObject } from '@estiva-app/interop'
import { EmptyState, KindIcon, NavItem, NavTree, SkeletonList } from '@estiva-app/ui'
import { IconListSearch } from '@tabler/icons-react'
import { useState } from 'react'
import { rowOf } from '../folders/tree'
import { dOf, EXPLORE_TOPICS_PATH } from '../route'
import { topicPath } from './topicLinks'
import { TOPICS_SHOWN } from './sidebarTopics'
import type { SidebarTopicsState } from './useSidebarTopics'
import { useReportFailure } from '@/lib/failureReports'

/**
 * The sidebar's Initiatives (LTN-2, TOPI-4, the approved story on `concept/topics-level-up`; called Topics until
 * Katerina's rename of 16 November): your five newest initiatives
 * (newest activity first, in the order the caller hands them), each folding to the files it lists that Leaf opens, then
 * Explore initiatives in More's place. With none, or when the read failed, the section still draws, with Explore initiatives, so
 * there is a way in. An initiative's name opens its page in Leaf (LTN-3); its icon, an arrow while pointed at, folds it; one
 * listing nothing Leaf opens has no fold.
 */
export function TopicsSection({
  topics,
  current,
  topicNow,
  exploreNow,
  fileNow,
}: {
  topics: SidebarTopicsState
  /** The open file's key, as the tree selects it. */
  current?: string
  /** The `d` of the topic whose page is open. */
  topicNow?: string
  /** Explore topics is open. */
  exploreNow?: boolean
  /** The tree's copy of a file when it holds one, so a rename since the read shows. */
  fileNow: (file: ForeignObject) => ForeignObject
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  // Peek's row, word for word and with its icon, a list with a magnifier (Katerina, 16 November, her pick A; 18 November:
  // "Explore initiatives along with the icon we used in Peek"). Until then it had none (Miky, 6 Nov).
  const explore = <NavItem href={EXPLORE_TOPICS_PATH} label="Explore initiatives" icon={<IconListSearch size={16} stroke={1.5} aria-hidden />} active={exploreNow} />
  useReportFailure(topics === 'failed' ? 'not-loaded' : undefined)
  // As many placeholder rows as it shows, then the way in, as Ship's sidebar while it reads (review of 23 November, C12).
  if (topics === 'loading')
    return (
      <NavTree title="Initiatives">
        <SkeletonList rows={TOPICS_SHOWN} />
        {explore}
      </NavTree>
    )
  // In Peek's words for its Initiatives column (Katerina, 18 November: "everywhere a topic is mentioned, we should use Initiatives").
  if (topics === 'failed')
    return (
      <NavTree title="Initiatives">
        {/* Lined up with the section's title, as the spec draws it, now that a row follows. */}
        <div className="px-2 py-1">
          <EmptyState scope="section" message="Couldn’t load your initiatives. Reload to try again." />
        </div>
        {explore}
      </NavTree>
    )
  if (topics.length === 0)
    return (
      <NavTree title="Initiatives">
        <div className="px-2 py-1">
          <EmptyState scope="section" message="You’re in no initiatives yet." />
        </div>
        {explore}
      </NavTree>
    )
  const fold = (address: string, to: boolean) =>
    setOpen((was) => {
      const next = new Set(was)
      if (to) next.add(address)
      else next.delete(address)
      return next
    })
  return (
    <NavTree title="Initiatives">
      {topics.slice(0, TOPICS_SHOWN).map((topic) => {
        const link = {
          href: topicPath(topic.address, topic.title),
          label: topic.title,
          icon: <KindIcon kind="topic" />,
          active: !!topicNow && dOf(topic.address) === topicNow,
        }
        // A topic listing nothing Leaf opens has no rows under it, so no fold.
        if (topic.files.length === 0) return <NavItem key={topic.address} {...link} />
        return (
          <NavItem key={topic.address} {...link} open={open.has(topic.address)} onOpenChange={(to) => fold(topic.address, to)}>
            {topic.files.map((file) => {
              const row = rowOf(fileNow(file))
              return <NavItem key={row.id} href={row.href} label={row.label} icon={row.icon} hint={row.hint} active={row.id === current} />
            })}
          </NavItem>
        )
      })}
      {explore}
    </NavTree>
  )
}
