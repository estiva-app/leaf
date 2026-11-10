import type { ForeignObject } from '@estiva-app/interop'
import { EmptyState, KindIcon, NavItem, NavTree, SkeletonList } from '@estiva-app/ui'
import { useState } from 'react'
import { rowOf } from '../folders/tree'
import { dOf, EXPLORE_TOPICS_PATH } from '../route'
import { topicPath } from './topicLinks'
import { TOPICS_SHOWN } from './sidebarTopics'
import type { SidebarTopicsState } from './useSidebarTopics'

/**
 * The sidebar's Topics (LTN-2, TOPI-4, the approved story on `concept/topics-level-up`): your five newest topics
 * (newest activity first, in the order the caller hands them), each folding to the files it lists that Leaf opens, then
 * Explore topics in More's place. With none, or when the read failed, the section still draws, with Explore topics, so
 * there is a way in. A topic's name opens its page in Leaf (LTN-3); its icon, an arrow while pointed at, folds it; one
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
  // No icon: it is a way in, not another kind of topic (Miky, 6 Nov).
  const explore = <NavItem href={EXPLORE_TOPICS_PATH} label="Explore topics" active={exploreNow} />
  if (topics === 'loading')
    return (
      <NavTree title="Topics">
        <SkeletonList rows={3} />
      </NavTree>
    )
  // In the words Leaf's Folders use when they fail.
  if (topics === 'failed')
    return (
      <NavTree title="Topics">
        {/* Lined up with the section's title, as the spec draws it, now that a row follows. */}
        <div className="px-2 py-1">
          <EmptyState scope="section" message="Your topics could not be read. Reload to try again." />
        </div>
        {explore}
      </NavTree>
    )
  if (topics.length === 0)
    return (
      <NavTree title="Topics">
        <div className="px-2 py-1">
          <EmptyState scope="section" message="You’re in no topics yet." />
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
    <NavTree title="Topics">
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
