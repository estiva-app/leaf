/**
 * What an app link names — SPEC §7.7 — for the card under a comment and the
 * live part of a block link (COMM-8). Ship's `api/linkCards.ts` and Peek's
 * `cardValueOfUrl` / `blockOfUrl`, with Leaf's relay.
 *
 * A URL names an object when a published manifest's `urls` pattern claims its
 * host and `<type>`, and then **one author** holds that `d`: the `#d` query asks
 * for two, and a `d` two authors hold names nothing, so somebody publishing the
 * same `(kind, d)` cannot put their object's card under a link to another's. A
 * link to one block (`#block-<id>`) names its file too, so it reads as that
 * file's chip, and the block is its part (§13.6.1).
 *
 * Asked once per link for the tab: a link names the same object for as long as
 * its owner's manifest does. A read that failed is forgotten, so the next ask
 * tries again. Whoever draws from these answers listens with `linksChanged`.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { matchObjectUrl, urlPatternsOf } from '@estiva-app/interop'
import type { LinkResolver, PartPointer } from '@estiva-app/protocol'
import { query } from '../relay/bridge'
import { declaredManifests } from '../relay/manifests'
import { referenceOfValue } from './commentLines'

const EVENT_ID = /^[0-9a-f]{64}$/i

/** What one link names: an address or a message's event id, and the block when it links to one. */
interface Answer {
  value: string | null
  block?: PartPointer
}

/** Throws when the relay could not be asked. */
async function answerOf(url: string): Promise<Answer> {
  const shapes = (await declaredManifests()).flatMap((manifest) => urlPatternsOf(manifest))
  const hit = matchObjectUrl(url, shapes)
  if (!hit) return { value: null }
  if (hit.by === 'id') return { value: EVENT_ID.test(hit.identifier) ? hit.identifier.toLowerCase() : null }
  const filter: Record<string, unknown> = { '#d': [hit.identifier], limit: 2 }
  // A path on another app's host can read as several kinds (SPEC §7.7, LTX-6): ask under each.
  const kinds = hit.kinds ?? (hit.kind === undefined ? undefined : [hit.kind])
  if (kinds) filter.kinds = kinds
  const found = await query([filter])
  const authors = new Set(found.map((event) => `${event.kind}:${event.pubkey}`))
  if (authors.size !== 1) return { value: null }
  const address = `${[...authors][0]}:${hit.identifier}`
  return hit.block ? { value: address, block: { address, block: hit.block } } : { value: address }
}

/** How many URLs one box or one comment asks about, the first ones — as `LinkChips`' `limit`: each answer can cost a relay query. */
export const MAX_LINKS_ASKED = 24
/** A failed read is asked again this many times, after 5, 10 and 20 seconds, by whoever still draws from it. */
const RETRIES = 3
const RETRY_MS = 5000

const asked = new Map<string, Promise<void>>()
const known = new Map<string, Answer>()
const failures = new Map<string, number>()
const listeners = new Set<() => void>()
let answered = 0

function changed() {
  answered += 1
  for (const listener of listeners) listener()
}

function ask(url: string): Promise<void> {
  let pending = asked.get(url)
  if (!pending) {
    pending = answerOf(url).then(
      (answer) => {
        known.set(url, answer)
        changed()
      },
      () => {
        asked.delete(url)
        // Said as a change after a wait, so a comment drawn from it asks again rather than stay without its card.
        const failed = failures.get(url) ?? 0
        failures.set(url, failed + 1)
        if (failed < RETRIES) setTimeout(changed, RETRY_MS * 2 ** failed)
      },
    )
    asked.set(url, pending)
  }
  return pending
}

/** What a link names, from what has come back: undefined until it has, and for nothing. A `LinkResolver`. */
export const knownLinkValue: LinkResolver = (url) => known.get(url)?.value ?? undefined

/** The file and block a link to one block names, from what has come back. */
export const knownBlockOf = (url: string): PartPointer | undefined => known.get(url)?.block

/** The chip a pasted app URL becomes (`LinkChips`' `referenceOf`): its file's, a block link's too. Leaf draws files, not another app's messages. */
export function linkReferenceOf(url: string): string | undefined {
  const value = knownLinkValue(url)
  return value ? referenceOfValue(value) : undefined
}

/**
 * Ask what each of these links names; settles when every answer is in, and
 * rejects when a read failed (it left no answer), so `LinkChips` forgets those
 * links and asks again.
 */
export async function askLinks(urls: readonly string[]): Promise<void> {
  const waiting = [...new Set(urls)].filter((url) => !known.has(url))
  await Promise.all(waiting.map(ask))
  if (waiting.some((url) => !known.has(url))) throw new Error('A link could not be asked about; asked again later.')
}

/** Called with a listener; it is called each time a link's answer comes back. Returns the unsubscribe. */
export function linksChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** {@link knownLinkValue}, as a new function each time an answer comes back: a component that draws from it draws again as each lands. */
export function useKnownLinks(): LinkResolver {
  const count = useSyncExternalStore(linksChanged, () => answered)
  return useMemo(() => (count >= 0 ? (url: string) => knownLinkValue(url) : knownLinkValue), [count])
}
