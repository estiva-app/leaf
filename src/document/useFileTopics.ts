import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublishResult } from '@estiva-app/protocol'
import { readFileTopics, setListedInTopic, type TopicOfFile } from './fileTopics'

/** The topics that list a file: `undefined` while the first read runs, `'failed'` when it could not be read. */
export type FileTopicsState = TopicOfFile[] | 'failed' | undefined

/**
 * A file's topics (TOP-6), and Add to topic and Remove, as Ship's row has them (ship#359).
 *
 * Read once per file and again after each write: the project says "after a reload", so no live watch. A write shows at
 * once and rolls back when the relay refuses it, with the relay's reason for the caller to say.
 */
export function useFileTopics(file: string | undefined): {
  state: FileTopicsState
  /** Topic addresses with a write on the way. */
  busy: ReadonlySet<string>
  setListed: (topic: TopicOfFile, listed: boolean) => Promise<PublishResult>
} {
  // Held with the file it was read for, so another file's page starts from "reading" without a reset in an effect.
  const [held, setHeld] = useState<{ file?: string; state: FileTopicsState }>({ state: undefined })
  const state = held.file === file ? held.state : undefined
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [nonce, setNonce] = useState(0)
  /** Writes on their way: a read landing meanwhile is not drawn. */
  const writing = useRef(0)

  useEffect(() => {
    if (!file) return
    let live = true
    readFileTopics(file)
      // A read that started before a write still on its way would draw the list without it: the write's own re-read follows.
      .then((topics) => live && writing.current === 0 && setHeld({ file, state: topics }))
      // A failed re-read keeps what was read; only a failed first read says so.
      .catch(() => live && setHeld((was) => (was.file === file && was.state !== undefined ? was : { file, state: 'failed' })))
    return () => {
      live = false
    }
  }, [file, nonce])

  const setListed = useCallback(
    async (topic: TopicOfFile, listed: boolean): Promise<PublishResult> => {
      if (!file) return { ok: false, reason: 'Nothing to add.' }
      const mark = (on: boolean) =>
        setBusy((held) => {
          const next = new Set(held)
          if (on) next.add(topic.address)
          else next.delete(topic.address)
          return next
        })
      const apply = (put: boolean) =>
        setHeld((was) => {
          if (was.file !== file || !Array.isArray(was.state)) return was
          const without = was.state.filter((t) => t.address !== topic.address)
          return { file, state: put ? [...without, topic].sort((a, b) => a.title.localeCompare(b.title)) : without }
        })
      mark(true)
      writing.current += 1
      apply(listed)
      const result = await setListedInTopic(topic, file, listed).finally(() => (writing.current -= 1))
      if (!result.ok) apply(!listed)
      mark(false)
      setNonce((n) => n + 1)
      return result
    },
    [file],
  )

  return { state, busy, setListed }
}
