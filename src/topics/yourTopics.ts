import type { TopicsRead, YourTopicsRead } from '@estiva-app/interop'
import { useEffect, useSyncExternalStore } from 'react'
import { heldTopics, heldYourTopics, loadYourTopics } from '../document/fileTopics'
import { isYours } from './sidebarTopics'
import { REREAD_AFTER_MS } from './topicReads'

const subscribe = (listener: () => void) => heldYourTopics.subscribe(listener)
const snapshot = () => heldYourTopics.snapshot()

/** Your topics from the tab's held lean read (ALO-20): `undefined` while the first is out, `failed` when it did not land. */
export function useYourTopics(): YourTopicsRead | 'failed' | undefined {
  const held = useSyncExternalStore(subscribe, snapshot)
  return held.value ?? (held.error !== undefined ? 'failed' : undefined)
}

/**
 * Whether the tab's read of every topic, read since (Explore's Join, Add to topic), counts other topics as yours than
 * the lean read does: then the lean read is out of date, and is read again on the next page that draws from it. Spaces
 * are left out of both, as the sidebar leaves them out.
 */
export function joinedOrLeftSince(lean: YourTopicsRead, every: TopicsRead | undefined = heldTopics.snapshot().value): boolean {
  if (!every) return false
  const fromEvery = new Set(every.topics.filter((topic) => isYours(topic, lean.muted)).map((topic) => topic.address))
  const fromLean = new Set(lean.topics.filter((topic) => !topic.space).map((topic) => topic.address))
  return fromEvery.size !== fromLean.size || [...fromEvery].some((address) => !fromLean.has(address))
}

/**
 * Read your topics once `ready`, and again when you come back to the tab after {@link REREAD_AFTER_MS} — never while
 * you work, so the five stay put (Miky, 6 Nov). Read again at once when `outOfDate` turns true: the tab's read of every
 * topic says you joined or left one since ({@link joinedOrLeftSince}). Nothing while `ready` is false.
 */
export function useYourTopicsRead(ready: boolean, outOfDate: boolean): void {
  useEffect(() => {
    if (ready && outOfDate) void heldYourTopics.reload(loadYourTopics)
  }, [ready, outOfDate])
  useEffect(() => {
    if (!ready) return
    void heldYourTopics.ensure(loadYourTopics)
    let last = Date.now()
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last <= REREAD_AFTER_MS) return
      last = Date.now()
      void heldYourTopics.reload(loadYourTopics)
    }
    document.addEventListener('visibilitychange', onReturn)
    return () => document.removeEventListener('visibilitychange', onReturn)
  }, [ready])
}
