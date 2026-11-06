import { IconMessages } from '@tabler/icons-react'
import { Button, KindIcon, Link, UnreadDot } from '@estiva-app/ui'

/** One topic on Explore topics, as Ship's Topics page reads it (estiva-ship `src/lib/topics.ts` `TopicRowData`). */
export interface TopicRowData {
  address: string
  title: string
  /** The line under its name; absent, nothing is drawn there. */
  summary?: string
  /** Its page here. */
  href: string
  /** Its projects Completed, of all it lists, archived ones included (Linear's "2 / 10"). */
  projects: { done: number; total: number }
  /** Its conversations in Peek; `undefined` until they are read. */
  conversations?: number
  /** How many of them have something new for you: only on your own open topics, as Peek's dot. */
  fresh: number
}

/**
 * One topic on Explore topics: Ship's TopicRow (estiva-ship `src/components/TopicRow.tsx`), copied because Leaf cannot
 * import Ship, with one change: `onJoin`, Join on a topic you're not in, after the row's covering link so it stays
 * clickable.
 */
export function TopicRow({ topic, onJoin }: { topic: TopicRowData; onJoin?: () => void }) {
  const { done, total } = topic.projects
  const name = (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-body-2 font-medium text-text-primary">{topic.title}</span>
      {topic.summary && <span className="truncate text-caption text-text-secondary">{topic.summary}</span>}
    </span>
  )
  return (
    <div data-topic={topic.address} className="relative flex min-w-0 items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-bg-hover">
      <KindIcon kind="topic" />
      <Link href={topic.href} variant="plain" cover className="flex min-w-0 flex-1">
        {name}
      </Link>
      {topic.fresh > 0 && (
        <span className="flex shrink-0 sm:hidden">
          <UnreadDot />
          <span className="sr-only">{topic.fresh} new</span>
        </span>
      )}
      {/* A topic that lists no project leaves the cell empty, not "0 / 0" (Miky, 4 Nov). */}
      {total > 0 ? (
        <span className="hidden w-16 shrink-0 items-center gap-1 text-caption text-text-secondary sm:flex" aria-label={`${done} of ${total} projects completed`}>
          <KindIcon kind="project" />
          <span className="font-mono tabular-nums">
            {done} / {total}
          </span>
        </span>
      ) : (
        <span className="hidden w-16 shrink-0 sm:block" />
      )}
      <span className="hidden w-28 shrink-0 items-center gap-1 text-caption text-text-secondary sm:flex">
        <IconMessages size={16} stroke={1.5} aria-hidden />
        {/* A dash while the conversations are read: the rows draw from the topics read alone. */}
        <span className="font-mono tabular-nums">{topic.conversations ?? '–'}</span>
        {topic.fresh > 0 && (
          <span className="ml-1 flex items-center gap-1 text-text-primary">
            <UnreadDot />
            {topic.fresh} new
          </span>
        )}
      </span>
      {/* Join's own column, so the counts stay in line whether a row has it or not; `relative` lifts it over the row's link. */}
      <span className="relative flex w-14 shrink-0 justify-end">
        {onJoin && (
          <Button size="small" variant="outlined" onClick={onJoin}>
            Join
          </Button>
        )}
      </span>
    </div>
  )
}
