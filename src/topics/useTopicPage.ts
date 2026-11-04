import { isArchived, type ForeignObject, type ReadTopic, type TopicsRead } from '@estiva-app/interop'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { heldTopics, listedInTab, loadTopics } from '../document/fileTopics'
import { dOf } from '../route'
import { byKindThenTitle, listedThatLeafOpens, readListedFiles, topicTitleOf } from './sidebarTopics'
import { topicInPeek } from './topicLinks'

/** A topic's page as Leaf draws it (LTN-3): its title, summary, team, where its conversation is, and what it lists. */
export interface TopicPageData {
  address: string
  title: string
  summary?: string
  /** Its team's id, from its root (§6.2). */
  folder: string
  archived: boolean
  /** A team marks it one of its spaces: Peek's, so the page sends it on (D4). */
  space: boolean
  /** "Conversation in Peek": the topic's path on Peek's host. */
  peekUrl?: string
  /** What it lists that Leaf opens, pages then projects then issues, each A–Z; the archived ones apart. */
  files: { live: ForeignObject[]; archived: ForeignObject[] } | 'loading' | 'failed'
}

export type TopicPageState = TopicPageData | 'loading' | 'failed' | 'unavailable'

const subscribe = (listener: () => void) => heldTopics.subscribe(listener)
const snapshot = () => heldTopics.snapshot()

/** The one topic a `d` names in the read; none when two authors hold it, as a link names only one. */
export function topicOfD(read: TopicsRead, d: string): ReadTopic | undefined {
  const held = read.topics.filter((topic) => dOf(topic.address) === d)
  return held.length === 1 ? held[0] : undefined
}

/**
 * A topic's page, from the tab's one held read of every topic the sidebar and Add to topic draw from, so a topic opened
 * from the sidebar reads nothing more for itself. Asked for at once, not after the Folders as the sidebar's is, so a
 * cold open draws the topic's title, summary and Peek link before the tree is read. What it lists waits for the tree,
 * whose copies are taken as they are, and the rest is read in one batch: read before the tree, a listed Ship project
 * was read twice, 0.53 MB more on QA-1's cold open (4 Nov). A topic the read held at open does not have is read for
 * once more before the page says it is not available.
 */
export function useTopicPage(
  d: string,
  inTree: (address: string) => ForeignObject | null,
  /** The Folders are read (or failed): what it lists is read only then, so a file the tree reads is not read twice. */
  treeRead: boolean,
): { state: TopicPageState; retry: () => void } {
  const held = useSyncExternalStore(subscribe, snapshot)
  const listedHere = useSyncExternalStore(listedInTab.subscribe, listedInTab.snapshot)
  const lookup = useRef(inTree)
  useEffect(() => {
    lookup.current = inTree
  })

  useEffect(() => {
    void heldTopics.ensure(loadTopics)
  }, [])

  const topic = held.value ? topicOfD(held.value, d) : undefined
  // A read this open made has every topic the reader can read; only one held from before is read again.
  const [heldAtOpen] = useState(() => !!heldTopics.snapshot().value)
  const [readAgain, setReadAgain] = useState<'landed' | 'failed'>()
  const askedAgain = useRef(false)
  // A failed read keeps the held answer, so whether it landed is whether the answer changed: "didn't load", not "can't open".
  const readOnceMore = () => {
    const before = heldTopics.snapshot().value
    void heldTopics.reload(loadTopics).then(() => setReadAgain(heldTopics.snapshot().value !== before ? 'landed' : 'failed'))
  }
  useEffect(() => {
    if (!held.value || topic || !heldAtOpen || askedAgain.current) return
    askedAgain.current = true
    readOnceMore()
  }, [held.value, topic, heldAtOpen])

  const [attempt, setAttempt] = useState(0)
  const [files, setFiles] = useState<{ topic: ReadTopic; listedHere: unknown; attempt: number; files: TopicPageData['files'] }>()
  useEffect(() => {
    if (!topic || !treeRead) return
    let live = true
    const addresses = listedThatLeafOpens(topic, listedHere)
    readListedFiles(addresses, (address) => lookup.current(address))
      .then((fileAt) => {
        const all = addresses.flatMap((address) => fileAt(address) ?? []).sort(byKindThenTitle)
        const shown = { live: all.filter((file) => !isArchived(file)), archived: all.filter(isArchived) }
        if (live) setFiles({ topic, listedHere, attempt, files: shown })
      })
      .catch(() => live && setFiles({ topic, listedHere, attempt, files: 'failed' }))
    return () => {
      live = false
    }
  }, [topic, listedHere, attempt, treeRead])

  const retry = () => {
    if (topic) return setAttempt((n) => n + 1)
    if (readAgain === 'failed') {
      setReadAgain(undefined)
      readOnceMore()
    } else void heldTopics.reload(loadTopics)
  }

  if (!topic) {
    if (held.value && (!heldAtOpen || readAgain === 'landed')) return { state: 'unavailable', retry }
    return { state: (held.error && !held.value) || readAgain === 'failed' ? 'failed' : 'loading', retry }
  }
  const title = topicTitleOf(topic)
  const summary = topic.object.slots.subtitle?.value?.trim()
  const peekUrl = topicInPeek(topic.object.openUrl, topic.address, title)
  return {
    state: {
      address: topic.address,
      title,
      ...(summary ? { summary } : {}),
      folder: topic.folder,
      archived: isArchived(topic.object),
      space: topic.space,
      ...(peekUrl ? { peekUrl } : {}),
      // Drawn from what was read for this topic and this tab's adds; a newer ask is still on its way until then.
      files: files && files.topic === topic && files.listedHere === listedHere && files.attempt === attempt ? files.files : 'loading',
    },
    retry,
  }
}
