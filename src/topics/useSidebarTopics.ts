import type { ForeignObject, ReadTopic } from '@estiva-app/interop'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { heldTopics, listedInTab, loadTopics } from '../document/fileTopics'
import { fiveNewest, readSidebarTopics, TOPICS_SHOWN, yourTopics, type SidebarTopic } from './sidebarTopics'
import { useHeldTopics, useMuted, useTopicActivity, useTopicsOnReturn } from './topicReads'
import { joinedOrLeftSince, useYourTopics, useYourTopicsRead } from './yourTopics'

/** The sidebar's Topics:`'loading'` until the first read lands, `'failed'` when it could not be read. */
export type SidebarTopicsState = SidebarTopic[] | 'loading' | 'failed'

/**
 * Your five newest topics for the sidebar (LTN-2, TOPI-4), as Ship's, read on open and again when you come back to the
 * tab after a minute, never live, so the five stay put while you work (Miky, 6 Nov).
 *
 * Where it reads them (ALO-20, Ship's ALO-17): from one lean read of only your topics, their activity and your mute
 * list. A page that reads every topic itself (`pageReadsEveryTopic`: Explore topics, a topic's page) draws from that
 * read, its activity and your mute list only when the tab holds no read of yours (a cold open there), or when that read
 * says you joined or left a topic since yours was read; yours is read again on the next page that draws from it.
 *
 * Read once `ready` — the Folders are read — so the page's text is not behind it, and the tree's copy of a listed file
 * is used rather than read again. The five wait for the mute list's first answer, so a muted topic is never drawn and
 * then taken out. Each one's files are drawn again when this tab adds a file to a topic or removes one.
 */
export function useSidebarTopics(
  ready: boolean,
  inTree: (address: string) => ForeignObject | null,
  pageReadsEveryTopic = false,
): SidebarTopicsState {
  const fromEvery = ready && pageReadsEveryTopic
  const held = useHeldTopics()
  const lean = useYourTopics()
  useTopicsOnReturn(fromEvery)
  const every = typeof held === 'object' ? held : undefined
  // Yours, held, counting the same topics as yours as the read of every topic: its five stay drawn on every page, so
  // moving to Explore or a topic's page never reorders them (Miky, 6 Nov). A join or a leave since reads yours again.
  const outOfDate = useMemo(() => typeof lean === 'object' && joinedOrLeftSince(lean, every), [lean, every])
  const leanHolds = typeof lean === 'object' && !outOfDate
  // Yours is read on every other page, and on Explore or a topic's page once held, so its five move on a return there too.
  useYourTopicsRead(ready && (!pageReadsEveryTopic || typeof lean === 'object'), outOfDate)
  // The tree as it is when the read runs: it fills in as Folders and projects are read, and is not a reason to read.
  const lookup = useRef(inTree)
  useEffect(() => {
    lookup.current = inTree
  })

  useEffect(() => {
    if (fromEvery) void heldTopics.ensure(loadTopics)
  }, [fromEvery])

  const read = fromEvery && !leanHolds ? every : undefined
  const { muted, settled } = useMuted(read, read !== undefined)
  const yours = useMemo(() => (read && settled ? yourTopics(read, muted) : undefined), [read, settled, muted])
  const order = useTopicActivity(read, yours)
  const everyFive = useMemo(() => (read && yours && order.values ? fiveNewest(read, order.values, muted) : undefined), [read, yours, order.values, muted])
  // interop's lean read leaves out what is archived, muted or not yours, and orders by activity: the sidebar leaves out spaces.
  const leanFive = useMemo<ReadTopic[] | undefined>(
    () => (ready && typeof lean === 'object' ? lean.topics.filter((topic) => !topic.space).slice(0, TOPICS_SHOWN) : undefined),
    [ready, lean],
  )
  const five = fromEvery && !leanHolds ? (everyFive ?? leanFive) : leanFive

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
  const failed = fromEvery ? held === 'failed' || order.failed : lean === 'failed'
  return failed ? 'failed' : 'loading'
}
