import { useEffect } from 'react'
import { dwellContexts, dwellKey, watchDwell } from '@estiva-app/conversation'
import { markRead } from '../relay/readState'

/**
 * Mark what is on screen read once it has stayed there a moment, through the package's `watchDwell`, as Ship's
 * `useMarkRead`: a conversation glanced past is not read. Only while the tab is shown, and again when it comes back.
 *
 * `contexts` are built by `@estiva-app/conversation` (`fileContext`, `threadContext`), so a page cannot mark the wrong
 * thing read. `newestAtMs` is the newest message drawn for them: when it moves the dwell runs again, so a message that
 * arrives while they are on screen is read too, and the mark never runs past it or past the clock. With none drawn
 * (an empty topic), the clock.
 */
export function useMarkRead(contexts: readonly (string | undefined)[], newestAtMs?: number): void {
  // The set, not the array, so the dwell restarts when the set changes and not on every render.
  const key = dwellKey(contexts)
  useEffect(() => watchDwell(dwellContexts(key), newestAtMs, markRead, document), [key, newestAtMs])
}
