import type { ForeignObject } from '@estiva-app/interop'
import { EmptyState, KindIcon, NavItem, NavTree, SkeletonList } from '@estiva-app/ui'
import { IconDots } from '@tabler/icons-react'
import { useState, type MouseEvent } from 'react'
import { rowOf } from '../folders/tree'
import { dOf } from '../route'
import { topicPath } from './topicLinks'
import type { SidebarTopicsState } from './useSidebarTopics'

/** How many topics show before More. */
const FIVE = 5

const quietly = (run: () => void) => (event: MouseEvent) => {
  event.preventDefault()
  run()
}

/**
 * The sidebar's Topics (LTN-2): up to five of your topics, each folding to the files it lists that Leaf opens, then a
 * quiet More that opens the rest in place. None, and the section is not drawn. A topic's name opens its page in Leaf
 * (LTN-3); its icon, an arrow while pointed at, folds it.
 */
export function TopicsSection({
  topics,
  current,
  topicNow,
  fileNow,
}: {
  topics: SidebarTopicsState
  /** The open file's key, as the tree selects it. */
  current?: string
  /** The `d` of the topic whose page is open. */
  topicNow?: string
  /** The tree's copy of a file when it holds one, so a rename since the read shows. */
  fileNow: (file: ForeignObject) => ForeignObject
}) {
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
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
        <EmptyState scope="section" message="Your topics could not be read. Reload to try again." />
      </NavTree>
    )
  if (topics.length === 0) return null
  const fold = (address: string, to: boolean) =>
    setOpen((was) => {
      const next = new Set(was)
      if (to) next.add(address)
      else next.delete(address)
      return next
    })
  return (
    <NavTree title="Topics">
      {(more ? topics : topics.slice(0, FIVE)).map((topic) => (
        <NavItem
          key={topic.address}
          href={topicPath(topic.address, topic.title)}
          label={topic.title}
          icon={<KindIcon kind="topic" />}
          active={!!topicNow && dOf(topic.address) === topicNow}
          open={open.has(topic.address)}
          onOpenChange={(to) => fold(topic.address, to)}
        >
          {topic.files.map((file) => {
            const row = rowOf(fileNow(file))
            return <NavItem key={row.id} href={row.href} label={row.label} icon={row.icon} hint={row.hint} active={row.id === current} />
          })}
        </NavItem>
      ))}
      {topics.length > FIVE && (
        <NavItem href="#" label={more ? 'Less' : 'More'} icon={<IconDots size={16} stroke={1.5} />} onClick={quietly(() => setMore(!more))} />
      )}
    </NavTree>
  )
}
