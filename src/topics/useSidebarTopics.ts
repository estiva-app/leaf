import type { ForeignObject } from '@estiva-app/interop'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { heldTopics, listedInTab, loadTopics } from '../document/fileTopics'
import { fiveNewest, readSidebarTopics, yourTopics, type SidebarTopic } from './sidebarTopics'
import { useHeldTopics, useMuted, useTopicActivity, useTopicsOnReturn } from './topicReads'

/** The sidebar's Topics:`'loading'` until the first read lands, `'failed'` when it could not be read. */
export type SidebarTopicsState = SidebarTopic[] | 'loading' | 'failed'

/**
 * Your five newest topics for the sidebar (LTN-2, TOPI-4), as Ship's: the tab's one held read of every topic (which Add
 * to topic and Explore topics share), your mute list and the topics' activity, read on open and again when you come
 * back to the tab after a minute, never live, so the five stay put while you work (Miky, 6 Nov).
 *
 * Read once `ready` — the Folders are read — so the page's text is not behind it, and the tree's copy of a listed file
 * is used rather than read again. The five wait for the mute list's first answer, so a muted topic is never drawn and
 * then taken out. Each one's files are drawn again when this tab adds a file to a topic or removes one.
 */
export function useSidebarTopics(ready: boolean, inTree: (address: string) => ForeignObject | null): SidebarTopicsState {
  useTopicsOnReturn(ready)
  const held = useHeldTopics()
  // The tree as it is when the read runs: it fills in as Folders and projects are read, and is not a reason to read.
  const lookup = useRef(inTree)
  useEffect(() => {
    lookup.current = inTree
  })

  useEffect(() => {
    if (ready) void heldTopics.ensure(loadTopics)
  }, [ready])

  const read = ready && typeof held === 'object' ? held : undefined
  const { muted, settled } = useMuted(read, read !== undefined)
  const yours = useMemo(() => (read && settled ? yourTopics(read, muted) : undefined), [read, settled, muted])
  const order = useTopicActivity(read, yours)
  const five = useMemo(() => (read && yours && order.values ? fiveNewest(read, order.values, muted) : undefined), [read, yours, order.values, muted])

  const [drawn, setDrawn] = useState<SidebarTopic[] | 'failed' | null>(null)
  const listedHere = useSyncExternalStore(listedInTab.subscribe, listedInTab.snapshot)
  useEffect(() => {
    if (!five) return
    let live = true
    readSidebarTopics(five, (address) => lookup.current(address), listedHere)
      .then((topics) => live && setDrawn(topics))
      // A failed re-read keeps what was drawn; only a failed first read says so.
      .catch(() => live && setDrawn((was) => (was && was !== 'failed' ? was : 'failed')))
    return () => {
      live = false
    }
  }, [five, listedHere])

  if (!ready) return 'loading'
  if (drawn) return drawn
  return held === 'failed' || order.failed ? 'failed' : 'loading'
}
