import { createProjectionCache, MANIFEST_TTL_MS, type QueryFn } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { query } from './bridge'

/**
 * Every resolve's manifest cache, one per tab: the tree, the page and its references open together, so one cache
 * asks a manifest once while it is in flight instead of once per reader (APP-2).
 */
export const projections = createProjectionCache()

/** The app manifests' kind (NIP-89 handler information). */
const KIND_MANIFEST = 31990

/** How many manifests the tab reads; a read that fills it may have been cut, so it answers nothing for the relay. */
const DECLARED_LIMIT = 500

/**
 * The manifests apps publish (kind 31990), read once per tab and again after as long as the projection cache keeps
 * a manifest, so a republished one is seen as soon as before. An empty or failed read is asked again next time.
 */
let manifests: { at: number; read: Promise<SignedEvent[]> } | null = null
export function declaredManifests(): Promise<SignedEvent[]> {
  if (manifests && Date.now() - manifests.at < MANIFEST_TTL_MS) return manifests.read
  const read = query([{ kinds: [KIND_MANIFEST], limit: DECLARED_LIMIT }]).then(
    (found) => {
      if (found.length === 0 && manifests?.read === read) manifests = null
      return found
    },
    (error: unknown) => {
      if (manifests?.read === read) manifests = null
      throw error
    },
  )
  manifests = { at: Date.now(), read }
  return read
}

/**
 * `read`, with interop's manifest reads answered from {@link declaredManifests} (APP-3): opening a page asked the
 * relay for the manifests claiming its kind and for every manifest again, two reads before its text that the tab's
 * one read already holds. A call is answered here only when every filter asks for manifests by what this matches
 * (authors, ids, tags, limit); each gets its matches newest first, so "newest wins" picks as the relay's answer would.
 * Anything else, a failed or empty declared read, or one that filled its limit, goes to the relay as before.
 */
export function withDeclaredManifests(read: QueryFn): QueryFn {
  return async (filters) => {
    if (filters.length === 0 || !filters.every(isServed)) return read(filters)
    const declared = await declaredManifests().catch(() => null)
    if (!declared?.length || declared.length >= DECLARED_LIMIT) return read(filters)
    const newest = [...declared].sort((a, b) => b.created_at - a.created_at)
    const found = new Map<string, SignedEvent>()
    for (const filter of filters) {
      const limit = typeof filter.limit === 'number' ? filter.limit : Infinity
      let taken = 0
      for (const event of newest) {
        if (taken >= limit) break
        if (!matches(event, filter)) continue
        found.set(event.id, event)
        taken += 1
      }
    }
    return [...found.values()]
  }
}

/** The bridge's query, with manifests answered from the tab's read: what interop's resolves are handed. */
export const resolveQuery = withDeclaredManifests(query)

/** A filter for manifests alone, by keys {@link matches} reads. */
function isServed(filter: Record<string, unknown>): boolean {
  const { kinds } = filter
  if (!Array.isArray(kinds) || kinds.length !== 1 || kinds[0] !== KIND_MANIFEST) return false
  return Object.entries(filter).every(([key, value]) =>
    key === 'kinds' || key === 'limit' ? true : (key === 'authors' || key === 'ids' || /^#[a-zA-Z]$/.test(key)) && Array.isArray(value),
  )
}

function matches(event: SignedEvent, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (key === 'kinds' || key === 'limit') continue
    const wanted = value as unknown[]
    if (key === 'authors') {
      if (!wanted.includes(event.pubkey)) return false
    } else if (key === 'ids') {
      if (!wanted.includes(event.id)) return false
    } else if (!event.tags.some((tag) => tag[0] === key.slice(1) && wanted.includes(tag[1]))) return false
  }
  return true
}
