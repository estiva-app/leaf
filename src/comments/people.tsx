import { useEffect, useMemo, useState } from 'react'
import type { SignedEvent } from '@estiva-app/protocol'
import { Avatar } from '@estiva-app/ui'
import type { MentionPerson } from '@estiva-app/ui/editor'
import { query, viewerPubkey } from '../relay/bridge'

/**
 * Who `@` and `!@` offer in a comment: the workspace's people, as Peek's
 * `mentionablePeopleOf` and Ship's `mentionPeople` have them. The relay's
 * roster (NIP-43's `kind:13534`) narrowed to the keys with a named profile —
 * the roster also lists keys that are not people, and a shortened key is
 * nobody a person can pick — agents included, since mentioning one is how you
 * ask it something, and never the viewer.
 */

/** NIP-43's relay membership list. */
const KIND_MEMBERSHIP_LIST = 13534

/** A person `@` can name: their key, their name, and their face when they have one. */
export interface Mentionable {
  pubkey: string
  name: string
  picture?: string
}

/**
 * Every named profile, newest `kind:0` per key. Not narrowed to the roster:
 * this answers "what is this key called", which a mention of someone who has
 * left still needs answered, as Peek's `profilesOf` does.
 */
export function namedProfilesOf(events: readonly SignedEvent[]): Map<string, Mentionable> {
  const newest = new Map<string, SignedEvent>()
  for (const e of events) {
    if (e.kind !== 0) continue
    const seen = newest.get(e.pubkey)
    if (!seen || e.created_at > seen.created_at) newest.set(e.pubkey, e)
  }
  const out = new Map<string, Mentionable>()
  for (const [pubkey, event] of newest) {
    let content: { display_name?: unknown; name?: unknown; picture?: unknown }
    try {
      content = JSON.parse(event.content) as typeof content
    } catch {
      continue
    }
    const name = [content.display_name, content.name].find((n): n is string => typeof n === 'string' && n.trim() !== '')
    if (!name) continue
    out.set(pubkey, { pubkey, name, ...(typeof content.picture === 'string' && content.picture ? { picture: content.picture } : {}) })
  }
  return out
}

/** The newest roster's members, or `null` when there is none to read: then every profile is offered, as Peek does. */
export function rosterOf(events: readonly SignedEvent[]): Set<string> | null {
  const roster = events.filter((e) => e.kind === KIND_MEMBERSHIP_LIST).sort((a, b) => b.created_at - a.created_at)[0]
  return roster ? new Set(roster.tags.filter((t) => (t[0] === 'member' || t[0] === 'p') && typeof t[1] === 'string').map((t) => t[1])) : null
}

/** Who `@` offers: the named profiles on the roster, never the viewer, by name. */
export function mentionablesOf(profiles: ReadonlyMap<string, Mentionable>, members: ReadonlySet<string> | null, me: string | null): Mentionable[] {
  return [...profiles.values()]
    .filter((p) => p.pubkey !== me && (!members || members.has(p.pubkey)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/**
 * Whom a card's owner picker offers (a lead, an assignee), as Peek's and
 * Ship's cards have their workspace's people: the named profiles on the
 * roster, the viewer included, since taking it yourself is a choice.
 */
export function directoryOf(profiles: ReadonlyMap<string, Mentionable>, members: ReadonlySet<string> | null): Record<string, { displayName: string; picture?: string }> {
  return Object.fromEntries(
    [...profiles.values()]
      .filter((p) => !members || members.has(p.pubkey))
      .map((p) => [p.pubkey, { displayName: p.name, ...(p.picture ? { picture: p.picture } : {}) }]),
  )
}

interface Known {
  offered: Mentionable[]
  profiles: ReadonlyMap<string, Mentionable>
  members: ReadonlySet<string> | null
}

// The last answer, offered at once by the next page while its own read is out.
let known: Known = { offered: [], profiles: new Map(), members: null }

/** A person's name from the last answer: what a draft's `@` chips are drawn with as it opens. */
export function knownName(pubkey: string): string | undefined {
  return known.profiles.get(pubkey)?.name
}

// The read out now: the page's text and its comments column open together, and ask once between them.
let reading: Promise<void> | null = null

/** Read the roster and every profile into `known`, or join the read already out. */
function readPeople(): Promise<void> {
  reading ??= Promise.all([query([{ kinds: [0], limit: 500 }]), query([{ kinds: [KIND_MEMBERSHIP_LIST], limit: 1 }]).then(rosterOf, () => null)])
    .then(([events, members]) => {
      const profiles = namedProfilesOf(events)
      known = { offered: mentionablesOf(profiles, members, viewerPubkey()), profiles, members }
    })
    .finally(() => {
      reading = null
    })
  return reading
}

/**
 * The people `@` offers, as the box's list draws them, and the name of anyone
 * with a profile. Read once each time a page's column opens — the roster and
 * every profile, as Peek asks for them — so someone who joined since shows up
 * on the next page. The roster is its own read: a relay that will not give it
 * leaves every profile offered rather than nobody.
 */
export function useMentionPeople(): { people: MentionPerson[]; nameOf: (pubkey: string) => string | undefined } {
  const found = usePeople()
  return useMemo(
    () => ({
      people: found.offered.map((p) => ({ id: p.pubkey, name: p.name, pubkey: p.pubkey, avatar: <Avatar size={32} src={p.picture} name={p.name} /> })),
      nameOf: (pubkey: string) => found.profiles.get(pubkey)?.name,
    }),
    [found],
  )
}

/** The workspace's people for a card's owner picker, read as `@` reads them. */
export function useDirectory(): Record<string, { displayName: string; picture?: string }> {
  const found = usePeople()
  return useMemo(() => directoryOf(found.profiles, found.members), [found])
}

/** The last answer at once, then this page's own read of the roster and every profile. */
function usePeople(): Known {
  const [found, setFound] = useState<Known>(known)
  useEffect(() => {
    let live = true
    readPeople()
      .then(() => {
        if (live) setFound(known)
      })
      // A refused read keeps the last answer; the next page asks again.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return found
}
