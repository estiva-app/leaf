import { IconArchive } from '@tabler/icons-react'
import { Button, Card } from '@estiva-app/ui'
import type { Archive } from '@estiva-app/interop'

/**
 * What an archived Leaf page shows under its title (a3257366): who archived it and when, the resolution they gave,
 * and the way back — Peek's and Ship's `ArchivedNotice` card, said in the same words and order, so the three apps
 * match (Miky, 2026-10-29). A page archived by itself offers Unarchive; one archived with a page or project above it
 * is restored there (SPEC §6.5), so it opens that file instead: a Leaf page here, a Ship project in Estiva Ship.
 * The comment box keeps its plain line.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md
 */
export interface ArchivedNoticeProps {
  archive: Archive
  /** The archiver's name. */
  by: string
  /** "page", "project" — what `archive.with` is, for "Archived with its project". */
  withWhat?: string
  /** Restore it. Absent when it is archived with a file above it, or cannot be restored here. */
  onUnarchive?: () => void
  /** Open the file it is archived with: a Leaf page here, anything else in its own app. Absent while that is read. */
  onOpenParent?: () => void
}

export function ArchivedNotice({ archive, by, withWhat, onUnarchive, onOpenParent }: ArchivedNoticeProps) {
  const when = new Date(archive.at * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const line = archive.with ? `Archived with its ${withWhat ?? 'parent'} by ${by} · ${when}` : `Archived by ${by} · ${when}`
  return (
    <Card fill="inset" className="flex items-start gap-3 px-4 py-3">
      <IconArchive size={16} stroke={1.5} className="mt-0.5 shrink-0 text-text-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-body-2-strong text-text-primary">{line}</span>
        {archive.resolution && <p className="whitespace-pre-wrap text-caption text-text-secondary">{archive.resolution}</p>}
      </div>
      {archive.with
        ? onOpenParent && (
            <Button variant="outlined" size="small" className="shrink-0" onClick={onOpenParent}>
              {`Open ${withWhat ?? 'parent'}`}
            </Button>
          )
        : onUnarchive && (
            <Button variant="outlined" size="small" className="shrink-0" onClick={onUnarchive}>
              Unarchive
            </Button>
          )}
    </Card>
  )
}
