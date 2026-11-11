import { useEffect } from 'react'
import { markRead, READ_DWELL_MS } from '../relay/readState'

/**
 * Mark what is on screen read once it has stayed there a moment, as Ship's `useMarkRead` and Peek's `useDwell`: a
 * conversation glanced past is not read. Only while the tab is shown, and again when it comes back.
 *
 * `contexts` are built by `@estiva-app/conversation` (`fileContext`, `threadContext`), so a page cannot mark the wrong
 * thing read. `newestAtMs` is the newest message drawn for them: when it moves the dwell runs again, so a message that
 * arrives while they are on screen is read too, and the mark never runs past it or past the clock. With none drawn
 * (an empty topic), the clock, as Ship's.
 */
export function useMarkRead(contexts: readonly (string | undefined)[], newestAtMs?: number): void {
  // As one string, so the dwell restarts when the set changes and not on every render; JSON, never split back on a
  // character an address may hold.
  const key = JSON.stringify(contexts.filter(Boolean).sort())
  useEffect(() => {
    const marks = JSON.parse(key) as string[]
    if (marks.length === 0) return
    let t: ReturnType<typeof setTimeout> | undefined
    const fire = () => {
      const now = Date.now()
      markRead(marks, newestAtMs === undefined ? now : Math.min(newestAtMs, now))
      // A message dated ahead of the clock is read once the clock gets there, asked again at most a minute apart: a
      // date far ahead would overflow the timer and fire at once, over and over.
      if (newestAtMs !== undefined && newestAtMs > now) t = setTimeout(fire, Math.min(newestAtMs - now, 60_000))
    }
    const arm = () => {
      clearTimeout(t)
      if (!document.hidden) t = setTimeout(fire, READ_DWELL_MS)
    }
    arm()
    document.addEventListener('visibilitychange', arm)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', arm)
    }
  }, [key, newestAtMs])
}
