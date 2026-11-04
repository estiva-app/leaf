import type { ForeignObject, TopicsRead } from '@estiva-app/interop'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { heldTopics, listedInTab, loadTopics } from '../document/fileTopics'
import { readSidebarTopics, type SidebarTopic } from './sidebarTopics'

const subscribe = (listener: () => void) => heldTopics.subscribe(listener)
const snapshot = () => heldTopics.snapshot()

/** The sidebar's Topics:`'loading'` until the first read lands, `'failed'` when it could not be read. */
export type SidebarTopicsState = SidebarTopic[] | 'loading' | 'failed'

/**
 * Your topics for the sidebar (LTN-2), from the tab's one held read of every topic, which Add to topic shares.
 *
 * Read once `ready` — the Folders are read — so the page's text is not behind it, and the tree's copy of a listed file
 * is used rather than read again. Read again when Add to topic reads the topics afresh, and when this tab adds a file
 * to a topic or removes one. No live watch.
 */
export function useSidebarTopics(ready: boolean, inTree: (address: string) => ForeignObject | null): SidebarTopicsState {
  const held = useSyncExternalStore(subscribe, snapshot)
  const [drawn, setDrawn] = useState<{ read: TopicsRead; state: SidebarTopic[] | 'failed' } | null>(null)
  // The tree as it is when the read runs: it fills in as Folders and projects are read, and is not a reason to read.
  const lookup = useRef(inTree)
  useEffect(() => {
    lookup.current = inTree
  })

  useEffect(() => {
    if (ready) void heldTopics.ensure(loadTopics)
  }, [ready])

  const read = held.value
  const listedHere = useSyncExternalStore(listedInTab.subscribe, listedInTab.snapshot)
  useEffect(() => {
    if (!ready || !read) return
    let live = true
    readSidebarTopics(read, (address) => lookup.current(address), listedHere)
      .then((topics) => live && setDrawn({ read, state: topics }))
      // A failed re-read keeps what was drawn; only a failed first read says so.
      .catch(() => live && setDrawn((was) => (was && was.state !== 'failed' ? was : { read, state: 'failed' })))
    return () => {
      live = false
    }
  }, [ready, read, listedHere])

  if (drawn) return drawn.state
  return held.error ? 'failed' : 'loading'
}
