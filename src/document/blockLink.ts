import { useEffect, useState, useSyncExternalStore } from 'react'
import { blockUrlOf, urlPatternsOf, type ForeignObject } from '@estiva-app/interop'
import { KIND, resolveBlockAnchor, type ContentFormat } from '@estiva-app/protocol'
import { buildManifest } from '../manifest'
import { dOf } from '../route'

/**
 * A link to one block of a document: `/document/<slug>-<d>#block-<id>`, built
 * from the `urls` shape Leaf's own manifest declares (SPEC §7.7), at this tab's
 * origin. Never from manifests read off the relay, where anyone may publish a
 * 31990 that claims documents under another host. Only a document has one: a
 * file another app owns opens there, so its link is that app's.
 */
export function blockLinkOf(file: Pick<ForeignObject, 'kind' | 'address' | 'slots'>, block: string, origin: string = window.location.origin): string | undefined {
  if (file.kind !== KIND.DOCUMENT || !file.address) return undefined
  const shapes = urlPatternsOf(buildManifest('', 0, origin))
  return blockUrlOf(shapes, { kind: KIND.DOCUMENT, d: dOf(file.address), title: file.slots.title?.value, block })
}

/** Copy a link and say so; where the clipboard is refused, offer it to copy by hand (Ship's copyText). */
export async function copyLink(link: string, say: (label: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(link)
    say('Link copied')
  } catch {
    window.prompt('Copy this link:', link)
  }
}

const PREFIX = '#block-'

/** The block a link opened this page at, if it did. */
export function linkedBlock(hash: string = window.location.hash): string | undefined {
  if (!hash.startsWith(PREFIX) || hash.length === PREFIX.length) return undefined
  // A pasted link cut mid-escape must open the page, not take it down.
  try {
    return decodeURIComponent(hash.slice(PREFIX.length))
  } catch {
    return undefined
  }
}

/** What a person does that means they have taken the page over from a block link's scroll. */
const PERSON = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const

/*
  The fragment: a new one is a new arrival. Not the path — the page is drawn afresh for each document, and an
  old `/f/` link replaced by the document's own link is the same arrival, not a second one.
*/
const currentArrival = () => window.location.hash
function subscribeArrival(changed: () => void): () => void {
  window.addEventListener('popstate', changed)
  window.addEventListener('hashchange', changed)
  return () => {
    window.removeEventListener('popstate', changed)
    window.removeEventListener('hashchange', changed)
  }
}

/**
 * Opened at `#block-<id>`: the block scrolled to the centre, as Ship's issue
 * page does (ship LiveHeader's useLinkedBlock), or — when the block is gone —
 * what to say instead. The editor's chunk can draw late on a first visit, so
 * the block is looked for for up to ten seconds, and never after the person
 * has scrolled or typed themselves.
 */
export function useLinkedBlock(value: string, format: ContentFormat): [missing: 'detached' | 'unaddressable' | null, dismiss: () => void] {
  const arrival = useSyncExternalStore(subscribeArrival, currentArrival)
  /*
    The block as the link arrived, read against the text then: a later edit is not a new arrival, so a
    block someone removes while you read says nothing. Taken afresh, during render, at each arrival.
  */
  const [seen, setSeen] = useState(() => ({ arrival, missing: missingAt(value, format), dismissed: false }))
  if (seen.arrival !== arrival) setSeen({ arrival, missing: missingAt(value, format), dismissed: false })
  const found = seen.arrival === arrival && !seen.missing
  useEffect(() => {
    const id = linkedBlock()
    if (!id || !found) return
    let tries = 0
    let scrolled: Element | null = null
    const stop = () => {
      clearInterval(timer)
      for (const type of PERSON) window.removeEventListener(type, stop, true)
    }
    const timer = setInterval(() => {
      const element = document.querySelector(`[data-document="editing"] [data-block-id="${CSS.escape(id)}"]`)
      // Stopped once the same block is still there a tick later: the editor can draw its text afresh as it settles.
      if (element && element === scrolled) return stop()
      if (element) {
        element.scrollIntoView({ block: 'center' })
        scrolled = element
      }
      if (++tries >= 100) stop()
    }, 100)
    for (const type of PERSON) window.addEventListener(type, stop, { capture: true, passive: true })
    return stop
  }, [arrival, found])
  return [seen.dismissed ? null : seen.missing, () => setSeen((s) => ({ ...s, dismissed: true }))]
}

/** Why the block a link names cannot be shown: removed, or the text has no blocks (SPEC §13.6) — or null. */
function missingAt(value: string, format: ContentFormat): 'detached' | 'unaddressable' | null {
  const id = linkedBlock()
  if (!id) return null
  const state = resolveBlockAnchor(id, value, format).state
  return state === 'detached' || state === 'unaddressable' ? state : null
}
