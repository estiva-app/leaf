import { useCallback, useEffect, useRef, useState } from 'react'
import { KIND_COMMENT } from '@estiva-app/conversation'
import { viewerPubkey } from '../relay/bridge'
import { relayClient } from '../relay/client'
import { COMMENT_KINDS, readThreads, type Commented, type Thread } from './comments'

/** The column's threads: `null` while the first read is out, and whether that read failed. */
export interface ThreadsState {
  threads: Thread[] | null
  failed: boolean
  /** When they were read, in ms: the "now" a card's "2 minutes ago" is said from. */
  readAt: number
  /** Read again now: after your own write, so it shows without waiting for the relay to echo it. */
  reread: () => void
}

/**
 * A document's threads, kept current: someone else's comment or reply on it,
 * or a resolution of one of its threads, arrives on the tab's one connection
 * (its Folder, kinds `1111` and `9101`), and the threads are read again, so it
 * shows without a reload. Other files' comments in the Folder are passed by.
 */
export function useThreads(doc: Partial<Commented>): ThreadsState {
  const { address, folder } = doc
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [readAt, setReadAt] = useState(0)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const reread = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    if (!address || !folder) return
    let live = true
    readThreads({ address, folder }).then(
      (next) => {
        if (!live) return
        setThreads(next)
        setReadAt(Date.now())
        setFailed(false)
      },
      (error: unknown) => {
        console.warn('[relay] comments read failed', error)
        if (live) setFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [address, folder, tick])

  // The threads' ids, for the watch: a resolution names a thread only by its comment's id.
  const ids = useRef(new Set<string>())
  useEffect(() => {
    ids.current = new Set(threads?.map((t) => t.id) ?? [])
  }, [threads])

  useEffect(() => {
    const client = relayClient()
    if (!client || !address || !folder) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const me = viewerPubkey()
    const watch = client.watchFolders(
      [folder],
      (_folder, event) => {
        if (!event || !COMMENT_KINDS.includes(event.kind)) return
        // Your own write is read again as it is accepted; its echo here would read it twice.
        if (event.pubkey === me) return
        // The Folder carries every file's comments: only this document's, or a resolution of one of its threads.
        const ours =
          event.kind === KIND_COMMENT
            ? event.tags.some((t) => t[0] === 'A' && t[1] === address)
            : event.tags.some((t) => t[0] === 'e' && ids.current.has(t[1]))
        if (!ours) return
        // A burst — a reply and its resolution — is one read.
        clearTimeout(timer)
        timer = setTimeout(reread, 250)
      },
      // Only what is written from now: what came before is in the first read.
      { kinds: COMMENT_KINDS, since: Math.floor(Date.now() / 1000) },
    )
    return () => {
      clearTimeout(timer)
      watch.stop()
    }
  }, [address, folder, reread])

  return { threads, failed, readAt, reread }
}
