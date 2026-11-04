import { KIND_BARE_FILE, objectRef, type ForeignObject } from '@estiva-app/interop'
import { heldTopics } from '../document/fileTopics'
import { dOf } from '../route'

/**
 * Where a topic opens from inside Leaf (LTN-3): its page here, as Ship's opens in Ship (SHIPS-4), except a space,
 * which is Peek's (Miky, 4 Nov, D4), and a link to one message (`?thread=`) or to a block, which no topic page shows.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-opens-in-the-app-you-are-in-when-it-has-a-page-made-for-that-kind.md
 */

/** A topic's page here, slug and all: the path Peek and Ship show it at (SPEC §7.7). */
export function topicPath(address: string, title?: string): string {
  return `/topic/${objectRef(dOf(address), title)}`
}

/** Whether an address is a topic's: a bare file (KINDS), which is what Peek's topics are. */
export function isTopicAddress(address: string | undefined): address is string {
  return !!address && address.startsWith(`${KIND_BARE_FILE}:`)
}

/**
 * The topic on Peek: the same path on the host its manifest's link names, as §7.7 has a person move between apps by
 * changing the host. Absent when Peek's manifest gave no `https:` link: it comes from a manifest anyone may publish.
 */
export function topicInPeek(openUrl: string | undefined, address: string, title: string): string | undefined {
  const url = parsed(openUrl)
  if (!url || url.protocol !== 'https:') return undefined
  return `${url.origin}/topic/${objectRef(dOf(address), title)}`
}

/** A URL from the relay (a manifest's template, a page's written link), or `undefined` where it does not parse: never a throw while a page draws. */
function parsed(url: string | undefined): URL | undefined {
  if (!url) return undefined
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

/**
 * Whether a link is on a host beside this one, under the same parent domain (`peek.estiva.app` from
 * `leaf.estiva.app`): the only place a page may send the reader without a click.
 */
export function isSiblingHost(url: string, here: string): boolean {
  const parent = here.split('.').slice(1).join('.')
  if (!parent.includes('.')) return false
  const host = new URL(url).hostname
  return host !== here && host.endsWith(`.${parent}`) && host.split('.').length === here.split('.').length
}

/** Whether the tab's topics read knows this topic for a space; `false` before any read, and the page sends one on. */
export function isKnownSpace(address: string): boolean {
  return !!heldTopics.snapshot().value?.topics.some((topic) => topic.address === address && topic.space)
}

/**
 * Where a link to a topic opens inside Leaf: its page here, unless it is a space the tab knows, or the link was
 * written to one message (`?thread=`) or one block, which open as written. `undefined` for any other file.
 */
export function topicOpener(file: Pick<ForeignObject, 'address'> & { slots?: ForeignObject['slots'] }, written?: string): string | undefined {
  if (!isTopicAddress(file.address) || isKnownSpace(file.address)) return undefined
  const url = written && /^https?:\/\//i.test(written) ? parsed(written) : undefined
  if (url && (url.searchParams.has('thread') || (url.hash.length >= 2 && !url.hash.startsWith('#/')))) return undefined
  const title = file.slots?.title
  return topicPath(file.address, title && !title.isPubkey ? title.value : undefined)
}
