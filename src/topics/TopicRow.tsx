import { Button, KindIcon, Link } from '@estiva-app/ui'
import { IconArchive } from '@tabler/icons-react'
import { whenOf } from '../home/recent'
import type { TopicRowData } from './exploreTopics'

/**
 * One topic on Explore topics (TOPI-4), as Ship's `TopicRow`: its name and summary, then the columns every app's
 * Explore draws (Miky, 6 Nov) — its team, how many people it lists, when anything last happened in it — and Join on a
 * topic you are not in. A dash while a column is read; on a phone only the name stays. It opens the topic's page here
 * (LTN-3), an archived one read-only.
 */
export function TopicRow({
  topic,
  now,
  onJoin,
  joining = false,
}: {
  topic: TopicRowData
  /** What Active counts back from, in ms: when the page opened. */
  now: number
  onJoin?: () => void
  joining?: boolean
}) {
  return (
    <div data-topic={topic.address} className="relative flex min-w-0 items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-bg-hover">
      <KindIcon kind="topic" />
      <Link href={topic.href} variant="plain" cover className="flex min-w-0 flex-1">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-2 font-medium text-text-primary">{topic.title}</span>
          {topic.summary && <span className="truncate text-caption text-text-secondary">{topic.summary}</span>}
        </span>
      </Link>
      <span className="hidden w-28 shrink-0 truncate text-caption text-text-secondary sm:block">{topic.team ?? '–'}</span>
      <span className="hidden w-20 shrink-0 text-caption text-text-secondary sm:block">{topic.members ?? '–'}</span>
      <span className="hidden w-24 shrink-0 items-center gap-1 text-caption text-text-secondary sm:flex">
        {topic.archived && <IconArchive size={14} stroke={1.5} aria-label="Archived" />}
        {topic.active ? whenOf(topic.active * 1000, now) : '–'}
      </span>
      {/* Join on a topic you are not in. After the covering link, `relative`, so it stays its own button. */}
      <span className="relative flex w-16 shrink-0 justify-end">
        {onJoin && (
          <Button size="small" variant="outlined" onClick={onJoin} disabled={joining}>
            Join
          </Button>
        )}
      </span>
    </div>
  )
}
