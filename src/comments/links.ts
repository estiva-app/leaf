/**
 * What an app link names — SPEC §7.7 — for the chip a pasted link becomes, the
 * card under a comment, the live part of a block link, the `a`, `q` and `part`
 * tags a send or an edit carries, and where a card written as a URL opens:
 * interop's one link reader, which Peek, Ship and the agent read through too
 * (PEEKM-7), with Leaf's relay and the manifests it already holds.
 *
 * One for the tab: somebody else signing in reloads the page (`followOtherTabs`),
 * so it is one per signed-in viewer.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-edit-says-what-the-message-links-now.md
 */
import { useMemo, useSyncExternalStore } from 'react'
import { linkReader } from '@estiva-app/interop'
import type { LinkResolver } from '@estiva-app/protocol'
import { query } from '../relay/bridge'
import { declaredManifests } from '../relay/manifests'
import { referenceOfValue } from './commentBody'

/** The tab's link reader. An empty manifest read is asked again, by `declaredManifests` and by the reader (interop 0.69). */
export const links = linkReader({ query, manifests: declaredManifests })

/** The chip a pasted app URL becomes (`LinkChips`' `referenceOf`): its file's, a block link's too. Leaf draws files, not another app's messages. */
export function linkReferenceOf(url: string): string | undefined {
  const value = links.known(url)
  return value ? referenceOfValue(value) : undefined
}

/** {@link links}' `known`, as a new function each time an answer comes back: a component that draws from it draws again as each lands. */
export function useKnownLinks(): LinkResolver {
  const count = useSyncExternalStore(links.changed, links.version)
  return useMemo(() => (count >= 0 ? (url: string) => links.known(url) : links.known), [count])
}
