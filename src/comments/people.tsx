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

/** The newest profile per key that has a name, and the newest roster's members (`null`: the relay keeps none). */
export function mentionablesOf(events: readonly SignedEvent[], me: string | null): Mentionable[] {
  const newest = new Map<string, SignedEvent>()
  for (const e of events) {
    if (e.kind !== 0) continue
    const seen = newest.get(e.pubkey)
    if (!seen || e.created_at > seen.created_at) newest.set(e.pubkey, e)
  }
  const roster = events.filter((e) => e.kind === KIND_MEMBERSHIP_LIST).sort((a, b) => b.created_at - a.created_at)[0]
  const members = roster ? new Set(roster.tags.filter((t) => (t[0] === 'member' || t[0] === 'p') && typeof t[1] === 'string').map((t) => t[1])) : null
  const out: Mentionable[] = []
  for (const [pubkey, event] of newest) {
    if (pubkey === me || (members && !members.has(pubkey))) continue
    let content: { display_name?: unknown; name?: unknown; picture?: unknown }
    try {
      content = JSON.parse(event.content) as typeof content
    } catch {
      continue
    }
    const name = [content.display_name, content.name].find((n): n is string => typeof n === 'string' && n.trim() !== '')
    if (!name) continue
    out.push({ pubkey, name, ...(typeof content.picture === 'string' && content.picture ? { picture: content.picture } : {}) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

// The last answer, offered at once by the next page while its own read is out.
let known: Mentionable[] = []

/** A person's name from the last answer: what a draft's `@` chips are drawn with as it opens. */
export function knownName(pubkey: string): string | undefined {
  return known.find((p) => p.pubkey === pubkey)?.name
}

/**
 * The people `@` offers, as the box's list draws them. Read once each time a
 * page's column opens — the roster and every profile, as Peek asks for them —
 * so someone who joined since shows up on the next page.
 */
export function useMentionPeople(): { people: MentionPerson[]; nameOf: (pubkey: string) => string | undefined } {
  const [found, setFound] = useState<Mentionable[]>(known)
  useEffect(() => {
    let live = true
    query([
      { kinds: [KIND_MEMBERSHIP_LIST], limit: 1 },
      { kinds: [0], limit: 500 },
    ])
      .then((events) => {
        known = mentionablesOf(events, viewerPubkey())
        if (live) setFound(known)
      })
      // A refused read keeps the last answer; the next page asks again.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return useMemo(() => {
    const names = new Map(found.map((p) => [p.pubkey, p.name]))
    return {
      people: found.map((p) => ({ id: p.pubkey, name: p.name, pubkey: p.pubkey, avatar: <Avatar size={32} src={p.picture} name={p.name} /> })),
      nameOf: (pubkey: string) => names.get(pubkey),
    }
  }, [found])
}
