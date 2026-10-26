import { createProjectionCache } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { query } from './bridge'

/**
 * Every resolve's manifest cache, one per tab: the tree, the page and its references open together, so one cache
 * asks a manifest once while it is in flight instead of once per reader (APP-2).
 */
export const projections = createProjectionCache()

/** The manifests apps publish (kind 31990), read once per tab; an empty or failed read is asked again next time. */
let manifests: Promise<SignedEvent[]> | null = null
export function declaredManifests(): Promise<SignedEvent[]> {
  manifests ??= query([{ kinds: [31990], limit: 500 }]).then(
    (found) => {
      if (found.length === 0) manifests = null
      return found
    },
    (error: unknown) => {
      manifests = null
      throw error
    },
  )
  return manifests
}
