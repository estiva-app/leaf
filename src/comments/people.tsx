import { useEffect, useMemo, useState } from 'react'
import { KIND_MEMBERSHIP_LIST, mentionablePeople, namedProfilesOf, rosterOf, type NamedProfile } from '@estiva-app/conversation'
import { Avatar } from '@estiva-app/ui'
import type { MentionPerson } from '@estiva-app/ui/editor'
import { query, viewerPubkey } from '../relay/bridge'

/**
 * Who `@` and `!@` offer in a comment: the workspace's people, by the rule
 * Peek and Ship use too (`mentionablePeople`, PEEKM-6) — the relay's roster
 * (NIP-43's `kind:13534`) narrowed to the keys with a named profile, agents
 * included, never the viewer, by name. Leaf reads the two itself; the package
 * maps them.
 */

/**
 * Whom a card's owner picker offers (a lead, an assignee), as Peek's and
 * Ship's cards have their workspace's people: the named profiles on the
 * roster, the viewer included, since taking it yourself is a choice.
 */
export function directoryOf(profiles: ReadonlyMap<string, NamedProfile>, members: ReadonlySet<string> | null): Record<string, { displayName: string; picture?: string }> {
  return Object.fromEntries(
    [...profiles.values()]
      .filter((p) => !members || members.has(p.pubkey))
      .map((p) => [p.pubkey, { displayName: p.name, ...(p.picture ? { picture: p.picture } : {}) }]),
  )
}

interface Known {
  offered: NamedProfile[]
  profiles: ReadonlyMap<string, NamedProfile>
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
      known = { offered: mentionablePeople(profiles.values(), members, viewerPubkey()), profiles, members }
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
