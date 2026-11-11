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
  // Joined, so the dwell restarts when the set changes and not on every render.
  const key = contexts.filter(Boolean).sort().join('|')
  useEffect(() => {
    if (key.length === 0) return
    let t: ReturnType<typeof setTimeout> | undefined
    const fire = () => {
      const now = Date.now()
      markRead(key.split('|'), newestAtMs === undefined ? now : Math.min(newestAtMs, now))
      if (newestAtMs !== undefined && newestAtMs > now) t = setTimeout(fire, newestAtMs - now)
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
