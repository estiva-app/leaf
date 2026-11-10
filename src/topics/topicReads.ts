import { activityTopics, readTopicActivity, type ReadTopic, type TopicsRead } from '@estiva-app/interop'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { heldTopics, loadTopics } from '../document/fileTopics'
import { query, viewerPubkey } from '../relay/bridge'
import { readMuted } from './muted'
import { readTopicMembers } from './topicMembers'

/** How long after a read coming back to the tab reads again: a quick look away and back reads nothing (Ship's). */
export const REREAD_AFTER_MS = 60_000

/** A per-topic answer as a page draws it: `undefined` while it is read, `failed` when it did not land. */
export interface PerTopic<T> {
  values: ReadonlyMap<string, T> | undefined
  failed: boolean
  retry: () => void
}

/** The topics of `read` a `key` (their addresses, sorted, space-separated) names. */
const topicsOf = (read: TopicsRead, key: string): ReadTopic[] => {
  const wanted = new Set(key ? key.split(' ') : [])
  return read.topics.filter((topic) => wanted.has(topic.address))
}

/**
 * One answer per topic, read for a set of topics at a time and held in this tab across pages, so the sidebar and
 * Explore topics share it and a page opened again reads nothing it holds (TOPI-4, Ship's `perTopicRead`). Read again
 * when you come back to the tab, {@link REREAD_AFTER_MS} after the last read, and never while you are working in it: a
 * topic moves on the next open or the next return, not under the pointer (Miky, 6 Nov). No live watch.
 */
function perTopicRead<T>(read: (topics: ReadTopic[]) => Promise<ReadonlyMap<string, T>>, { onReturn: rereads = true } = {}) {
  let values = new Map<string, T>()
  const failed = new Set<string>()
  const inFlight = new Map<string, Promise<void>>()
  /** When each topic's answer was last read, by its address. */
  const readAt = new Map<string, number>()
  const listeners = new Set<() => void>()
  let version = 0
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }
  const load = (topics: ReadTopic[]): Promise<void> => {
    const key = topics.map((topic) => topic.address).join(' ')
    const on = inFlight.get(key)
    if (on) return on
    const reading = read(topics)
      .then(
        (next) => {
          values = new Map([...values, ...next])
          failed.delete(key)
          for (const address of next.keys()) readAt.set(address, Date.now())
        },
        (error: unknown) => {
          console.warn('[topics] could not read:', error)
          failed.add(key)
        },
      )
      .finally(() => {
        inFlight.delete(key)
        version += 1
        for (const listener of listeners) listener()
      })
    inFlight.set(key, reading)
    return reading
  }
  const missingOf = (topics: ReadTopic[]) => topics.filter((topic) => !values.has(topic.address))
  return {
    reset() {
      values = new Map()
      failed.clear()
      inFlight.clear()
      readAt.clear()
    },
    /**
     * `addresses`: the topics to answer for; `undefined` while which ones is not known. `values` once any topic asked
     * is answered, and from then on: a topic asked later (joined, or started) is read on its own and has no answer
     * until it lands, so what is drawn never goes back to loading.
     */
    useRead(topics: TopicsRead | undefined, addresses: readonly string[] | undefined): PerTopic<T> {
      useSyncExternalStore(subscribe, () => version)
      const key = addresses ? [...addresses].sort().join(' ') : undefined
      useEffect(() => {
        if (!topics || key === undefined) return
        const wanted = topicsOf(topics, key)
        // Only what is not held: the sidebar's topics are held when Explore asks for all of them.
        const missing = missingOf(wanted)
        if (missing.length > 0) void load(missing)
        if (!rereads) return
        const onReturn = () => {
          const stale = wanted.some((topic) => Date.now() - (readAt.get(topic.address) ?? 0) > REREAD_AFTER_MS)
          if (document.visibilityState === 'visible' && stale) void load(wanted)
        }
        document.addEventListener('visibilitychange', onReturn)
        return () => document.removeEventListener('visibilitychange', onReturn)
      }, [topics, key])
      if (!topics || key === undefined) return { values: undefined, failed: false, retry: () => undefined }
      const wanted = topicsOf(topics, key)
      const missing = missingOf(wanted)
      const answered = missing.length < wanted.length || wanted.length === 0
      return {
        values: answered ? values : undefined,
        failed: !answered && failed.has(missing.map((topic) => topic.address).join(' ')),
        retry: () => {
          const now = missingOf(wanted)
          if (now.length > 0) void load(now)
        },
      }
    },
  }
}

/**
 * Each topic's newest activity, the one rule Peek, Ship and Leaf order topics by (interop's `readTopicActivity`,
 * TOPI-10): the sidebar's five and Your topics, and Explore's Active.
 */
const activity = perTopicRead<number>(async (topics) => (await readTopicActivity(query, activityTopics(topics))).at)

/**
 * How many people each topic lists: Explore's Members. Read once per topic in a tab, not again on return: it reads each
 * topic's whole roster and changes, and a count a minute old orders nothing.
 */
const members = perTopicRead<number | undefined>((topics) => readTopicMembers(topics), { onReturn: false })

export const useTopicActivity = activity.useRead
export const useTopicMembers = members.useRead

/** Test seam: forget every per-topic answer. */
export function resetTopicReadsForTests(): void {
  activity.reset()
  members.reset()
}

const subscribeHeld = (listener: () => void) => heldTopics.subscribe(listener)
const snapshotHeld = () => heldTopics.snapshot()

/** Every topic the reader can read, from the tab's one held read: `undefined` while the first is out, `failed` when it did not land. */
export function useHeldTopics(): TopicsRead | 'failed' | undefined {
  const held = useSyncExternalStore(subscribeHeld, snapshotHeld)
  return held.value ?? (held.error !== undefined ? 'failed' : undefined)
}

/**
 * Read the topics again when you come back to the tab (TOPI-4), at most once a {@link REREAD_AFTER_MS}: a topic joined
 * in Peek, or started since, enters the sidebar's five then, never while you work. Nothing while `ready` is false.
 */
export function useTopicsOnReturn(ready = true): void {
  useEffect(() => {
    if (!ready) return
    let last = Date.now()
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last <= REREAD_AFTER_MS) return
      last = Date.now()
      void heldTopics.reload(loadTopics)
    }
    document.addEventListener('visibilitychange', onReturn)
    return () => document.removeEventListener('visibilitychange', onReturn)
  }, [ready])
}

/**
 * The files and topics you muted (`estiva:muted:v1`, encrypted to you), as Ship's `useMuted`: `muted` is `undefined`
 * until the list is in hand, and `settled` once the first read came back, in hand or not — a list that cannot be read
 * (Estiva ID refuses, or a 429) is settled with nothing taken out. Asked again each time `again` changes: the callers
 * pass the topics read, so a topic muted or unmuted elsewhere moves when you come back to the tab. Nothing while
 * `ready` is false.
 */
export function useMuted(again: unknown, ready = true): { muted: ReadonlySet<string> | undefined; settled: boolean } {
  const [read, setRead] = useState<{ muted?: ReadonlySet<string>; settled: boolean; for?: unknown }>({ settled: false })
  useEffect(() => {
    if (!ready || (read.settled && Object.is(read.for, again))) return
    let live = true
    const me = viewerPubkey()
    const asking = me ? readMuted(me) : Promise.resolve(undefined)
    void asking
      .then((keys) => live && setRead((now) => (keys ? { muted: keys, settled: true, for: again } : { ...now, settled: true, for: again })))
      .catch(() => live && setRead((now) => ({ ...now, settled: true, for: again })))
    return () => {
      live = false
    }
  }, [ready, read.settled, read.for, again])
  return { muted: read.muted, settled: read.settled }
}
