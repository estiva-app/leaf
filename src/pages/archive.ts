import type { Archive } from '@estiva-app/interop'
import type { ArchivedNoticeProps } from '@estiva-app/ui'

/**
 * The kit's `ArchivedNotice`, said in Leaf's words (a3257366): who archived it by name, else the start of their key;
 * when as Peek's card says it, "Today", "Yesterday", else "Tue, Oct 28", with the year when it is not this one; and,
 * archived with the file above it, what that is and its title, read once its manifest is (`above`). One archived with
 * a file above whose kind was not read still says so: "Archived with its parent", as Leaf's own card did.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md
 */
export function archivedNoticeOf(
  archive: Archive,
  nameOf: (pubkey: string) => string | undefined,
  above?: { noun?: string; title?: string },
  now: Date = new Date(),
): Pick<ArchivedNoticeProps, 'by' | 'when' | 'resolution' | 'withWhat' | 'withTitle'> {
  const at = new Date(archive.at * 1000)
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000)
  const when =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Yesterday'
        : at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
  return {
    by: (archive.by && nameOf(archive.by)) || `${(archive.by ?? '').slice(0, 8)}…`,
    when,
    ...(archive.resolution ? { resolution: archive.resolution } : {}),
    ...(archive.with ? { withWhat: above?.noun ?? 'parent', ...(above?.title ? { withTitle: above.title } : {}) } : {}),
  }
}
