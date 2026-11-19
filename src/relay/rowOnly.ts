import type { ForeignObject } from '@estiva-app/interop'

/**
 * The files read for their row only, by the relay's list read (ISS-6): what each is now, its text unread. Interop
 * draws an empty text as no `body` slot at all, so such a row says nothing about where its page shows the text, and
 * its page reads the file again by its address before anything is drawn or written.
 */
const rowOnly = new WeakSet<ForeignObject>()

/** Marks `files` as read for their rows only. */
export function markRowOnly(files: Iterable<ForeignObject>): void {
  for (const file of files) rowOnly.add(file)
}

/** Whether `file` was read for its row only: a page opening it reads it again on its own, for its text and actions. */
export function isRowOnly(file: ForeignObject): boolean {
  return rowOnly.has(file)
}
