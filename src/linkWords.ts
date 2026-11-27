import { fileLinkWordsOf, type FileLinkWords, type LinkManifest } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'
import { useSyncExternalStore } from 'react'

/**
 * The words Leaf writes a file's link with (LIN-5): the shared writer's, read off the manifests, as Peek, Ship and the
 * agent write it, so Copy link, the address bar and every row hand out the same `/<word>/<slug>-<d>`.
 *
 * Two words are Leaf's own and stay so whatever a newer manifest says: a document opens at `/document/`, Leaf's page
 * route, and a topic at `/topic/`, Leaf's topic page. Any other word that is one of Leaf's own root paths is dropped,
 * and that kind falls back to its `/o/<naddr>`, which opens the file: any member can publish a manifest, and one naming
 * `/f/…` or `/document/…` for an issue would send every such link to a page that opens something else (Ship and Peek
 * drop their own the same way, LIN-3 and LIN-4 security reviews).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-path-is-the-same-on-every-apps-host.md
 */

const KIND_BARE_FILE = 30840

/** The word each kind Leaf has a page of its own for opens at here: what `routeOf` reads back. */
const OWN_WORDS: Readonly<Record<number, string>> = { [KIND.DOCUMENT]: 'document', [KIND_BARE_FILE]: 'topic' }

/** Leaf's own kind, whose word is Leaf's to declare: its document page. */
const LEAF_WORDS: Readonly<Record<number, string>> = { [KIND.DOCUMENT]: 'document' }

/**
 * Leaf's root paths that are not another app's word: its pages, the old `/f/` and the `naddr` form `/o/`, and
 * `assets`, which the server answers from disk and never hands to the app (`deploy/nginx.conf`).
 */
export const LEAF_ROOT_PATHS: readonly string[] = ['f', 'o', 'document', 'topic', 'topics', 'new', 'app', 'assets']

/**
 * The shared writer's words, minus a word that is one of Leaf's own pages unless it is that kind's own (`topic` for a
 * topic, as Peek declares it), with the document's kept: Leaf owns that kind. A word the shared writer withholds, as
 * when a stranger's manifest makes it read back as another kind, stays withheld, so Leaf writes the `/o/` Peek and
 * Ship write.
 */
export function leafLinkWordsOf(manifests: readonly LinkManifest[]): FileLinkWords {
  const byKind = Object.fromEntries(
    Object.entries(fileLinkWordsOf(manifests).byKind).filter(([kind, word]) => !LEAF_ROOT_PATHS.includes(word.toLowerCase()) || OWN_WORDS[Number(kind)] === word),
  )
  return { byKind: { ...byKind, ...LEAF_WORDS } }
}

/** The words before the manifests are read: Leaf's own only, so another app's file links its `/o/<naddr>` until then. */
const UNREAD: FileLinkWords = { byKind: OWN_WORDS }

let current: { words: FileLinkWords; read: boolean } = { words: UNREAD, read: false }
const listeners = new Set<() => void>()

/** Takes the words from a read of the manifests: each read, so a republished manifest is followed. */
export function setLinkWords(manifests: readonly LinkManifest[]): void {
  current = { words: leafLinkWordsOf(manifests), read: true }
  for (const listener of listeners) listener()
}

/** The words now; Leaf's own only until the manifests are read. */
export function linkWords(): FileLinkWords {
  return current.words
}

/** The words, and whether the manifests have been read yet, re-rendering when they are. */
export function useLinkWords(): { words: FileLinkWords; read: boolean } {
  return useSyncExternalStore(subscribe, snapshot)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): { words: FileLinkWords; read: boolean } {
  return current
}

/** For tests: back to before the manifests were read. */
export function resetLinkWords(): void {
  current = { words: UNREAD, read: false }
}
