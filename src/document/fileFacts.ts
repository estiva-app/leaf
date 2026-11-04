import { useCallback, useEffect, useRef, useState } from 'react'
import { buildMembershipChange, membersOf, type Membership } from '@estiva-app/conversation'
import type { ForeignObject } from '@estiva-app/interop'
import { KIND, type SignedEvent } from '@estiva-app/protocol'
import { isEdit, timeOf, whenOf } from '../home/recent'
import { publish, query, viewerPubkey } from '../relay/bridge'
import { byFields } from '../relay/projectFields'
import { CHANGE } from './save'

/** The newest edit to a file's text, title or summary: who made it, and when in ms. */
export interface LastEdit {
  by: string
  at: number
}

/**
 * The reads a file's members and its last edit are folded from, as Peek folds them (§11.8): its own event, which
 * makes its author a member, every change naming it, and its conversation (`1111` by `A`), whose writers and the
 * people its words name are members too. Its own event by the id it was read with, never by its `d` again (APP-3).
 * `since` reads only what is newer than what is held.
 */
export function factsFilters({ address, eventId }: { address: string; eventId: string }, since?: number, current?: readonly string[]): Record<string, unknown>[] {
  const newer = since === undefined ? {} : { since }
  // A project read by its fields, read afresh: each field's current change — its members' and its words' newest —
  // not its every change (ALO-6).
  if (current && since === undefined) return [{ ids: [eventId, ...current] }, { kinds: [KIND.COMMENT], '#A': [address] }]
  return [
    { ids: [eventId] },
    { kinds: [CHANGE], '#a': [address], ...newer },
    { kinds: [KIND.COMMENT], '#A': [address], ...newer },
  ]
}

/**
 * The newest edit among `events` to the file at `address`, or `null` when it has none since it was made. Only a change
 * written in the file's own Folder counts, as interop folds them (SPEC §6.12): the relay checks a change's signer
 * against its own `h`, so one signed in another Folder changed nothing and must not name its signer here.
 */
export function lastEditOf(
  { address, eventId, folder }: { address: string; eventId: string; folder?: string },
  events: readonly SignedEvent[],
): LastEdit | null {
  // The Folders the root is placed in, as interop reads them; the one it was opened in until the root is held.
  const root = events.find((e) => e.id === eventId)
  const folders = new Set<string>(root ? root.tags.filter((t) => (t[0] === 'h' || t[0] === 'buzz-channel') && t[1]).map((t) => t[1]) : folder ? [folder] : [])
  let last: LastEdit | null = null
  for (const event of events) {
    if (!isEdit(event) || !event.tags.some((t) => t[0] === 'a' && t[1] === address)) continue
    // The first `h` with a value, as the relay reads it.
    const own = event.tags.find((t) => t[0] === 'h' && t[1])?.[1]
    if (!own || !folders.has(own)) continue
    const at = timeOf(event)
    if (!last || at > last.at) last = { by: event.pubkey, at }
  }
  return last
}

/**
 * "Edited 2 hours ago by Katerina", "… by you", or "Not edited since it was made", as the LED-1 prototype says it
 * (Katerina, 28 Oct). Someone with no profile is "someone".
 */
export function lastEditLine(edit: LastEdit | null, me: string | null, nameOf: (pubkey: string) => string | undefined, now: number): string {
  if (!edit) return 'Not edited since it was made'
  const when = whenOf(edit.at, now)
  const who = edit.by === me ? 'you' : (nameOf(edit.by) ?? 'someone')
  return `Edited ${when.charAt(0).toLowerCase()}${when.slice(1)} by ${who}`
}

/**
 * Add a person to a file, or take yourself out of it: the same `kind:1851` `member:<person>` change Peek and Ship
 * write, in the file's Folder. Anyone may add anyone; a leave counts only when the person signs it.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/anyone-may-add-a-person-to-a-file.md
 */
export async function setMember(file: Pick<ForeignObject, 'address' | 'folder'>, person: string, member: boolean): Promise<boolean> {
  const pubkey = viewerPubkey()
  if (!pubkey || !file.address || !file.folder) return false
  const result = await publish(
    buildMembershipChange(pubkey, Date.now(), {
      file: file.address,
      folder: file.folder,
      person,
      member,
    }),
  )
  if (!result.ok) console.warn('[relay] membership change refused', result)
  return result.ok
}

/** What a file's header says about it: its members, and its last edit. `undefined` until the first read. */
export interface FileFacts {
  members: ReadonlyMap<string, Membership> | undefined
  lastEdit: LastEdit | null | undefined
}

/**
 * A file's members and its last edit, read when it opens and again each time `file` is read anew — which
 * `useLiveDocument` does when a change naming it arrives — and after `reread()`. The first read holds every change;
 * later ones ask only for what is newer, so a long-written page is not read whole on each save.
 */
export function useFileFacts(file: ForeignObject): FileFacts & { reread: () => void } {
  const { address, eventId } = file
  const [facts, setFacts] = useState<FileFacts>({
    members: undefined,
    lastEdit: undefined,
  })
  const [asked, setAsked] = useState(0)
  const held = useRef<{ address?: string; events: Map<string, SignedEvent> }>({
    events: new Map(),
  })
  const reread = useCallback(() => setAsked((n) => n + 1), [])

  useEffect(() => {
    if (!address) return
    let live = true
    if (held.current.address !== address) held.current = { address, events: new Map() }
    const events = held.current.events
    // A second back, so a change signed in the same second as the newest held is not missed.
    const newest = Math.max(0, ...[...events.values()].map((e) => e.created_at))
    const current = file.prevs && Object.values(file.prevs).filter((id) => !!id)
    byFields(address)
      .then((on) => query(factsFilters({ address, eventId }, events.size > 0 ? newest - 1 : undefined, on ? current : undefined)))
      .then(
      (read) => {
        if (!live) return
        for (const event of read) events.set(event.id, event)
        const all = [...events.values()]
        setFacts({
          members: membersOf(address, all),
          lastEdit: lastEditOf({ address, eventId, folder: file.folder }, all),
        })
      },
      // A refused read keeps what was drawn; the next change asks again.
      () => {},
    )
    return () => {
      live = false
    }
  }, [address, eventId, file, asked])

  return { ...facts, reread }
}
