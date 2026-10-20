import type { SignedEvent } from '@estiva-app/protocol'
import { query } from './bridge'

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
