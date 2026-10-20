import { useSyncExternalStore } from 'react'
import { identifierFromRef, objectRef } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'

/**
 * Leaf's places: Home at `/`, a document at `/document/<slug>-<d>`, and any
 * other file at `/f/<naddr>`. A document's link is the shape Leaf's manifest
 * declares in `urls` (SPEC §7.7), so every app reads it as the page's chip and
 * `#block-<id>` as one of its blocks; the word is Miky's (the issue
 * conversation, 2026-10-19). The `/f/` link of a document still opens it, and
 * is replaced by the document's own link once the page is found.
 *
 * Any other `/<word>/<ref>` is another app's address for a file, with Leaf's
 * host in front: `/issue/<slug>-<d>` is the Ship issue `ship.estiva.app` shows
 * at that path, and the manifests say what the word is (`fileAddress.ts`). Kept
 * to the History API: four routes need no router.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-path-is-the-same-on-every-apps-host.md
 */
export type Route =
  | { page: 'home' }
  | { page: 'file'; naddr: string }
  | { page: 'document'; d: string }
  | { page: 'path'; word: string; ref: string }

/** Leaf's own first segments, which are never another app's word. */
const OWN = new Set(['f', 'document', 'new', 'app'])

/** Whether `word` can be another app's type word on Leaf's host: the grammar {@link routeOf} reads, and none of Leaf's own. */
export function isOtherAppsWord(word: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(word) && !OWN.has(word)
}

/** The place a path names. Anything Leaf does not know is Home. */
export function routeOf(pathname: string): Route {
  const file = /^\/f\/([a-z0-9]+)\/?$/.exec(pathname)
  if (file) return { page: 'file', naddr: file[1] }
  // The slug is decoration and may be stale after a rename: only the `d` names the page (SPEC §7.7).
  const document = /^\/document\/([^/]+)\/?$/.exec(pathname)
  const d = document ? identifierFromRef(decodeRef(document[1])) : null
  if (d) return { page: 'document', d }
  const other = /^\/([^/]+)\/([^/]+)\/?$/.exec(pathname)
  if (other && isOtherAppsWord(other[1])) return { page: 'path', word: other[1], ref: decodeRef(other[2]) }
  return { page: 'home' }
}

function decodeRef(ref: string): string {
  try {
    return decodeURIComponent(ref)
  } catch {
    return ref
  }
}

/** The path of a file's page by its `naddr`: what a file of another app opens at. */
export function filePath(naddr: string): string {
  return `/f/${naddr}`
}

/** The path of a document's page: `/document/<slug>-<d>`, the slug from its title. */
export function documentPath(d: string, title?: string): string {
  return `/document/${objectRef(d, title)}`
}

/** The `d` of an address `<kind>:<pubkey>:<d>`. */
export function dOf(address: string): string {
  return address.split(':').slice(2).join(':')
}

/** Where a file opens in Leaf: a document at its own link, anything else at its `naddr`. */
export function pagePath(file: { kind: number; address?: string; naddr?: string; title?: string }): string {
  if (file.kind === KIND.DOCUMENT && file.address) return documentPath(dOf(file.address), file.title)
  return file.naddr ? filePath(file.naddr) : '/'
}

/**
 * The link that opens New document on one Folder, by the Folder's id (its
 * channel uuid). What another app links to when it offers Leaf's New
 * document: Leaf writes the document, signing its own `kind:30842`, and the
 * app that offered it signs nothing (Miky, 2026-10-16).
 *
 * Not yet a published contract: how a manifest advertises an app's "New …"
 * and how its link names the Folder is still Miky's open question, and
 * nothing links here until it is answered. Change it freely until then.
 */
export function newDocumentPath(folder: string): string {
  return `/new?folder=${encodeURIComponent(folder)}`
}

/** The Folder a {@link newDocumentPath} link names, or null for any other place. */
export function newDocumentFolderOf(pathname: string, search: string): string | null {
  if (!/^\/new\/?$/.test(pathname)) return null
  const folder = new URLSearchParams(search).get('folder')?.trim()
  return folder ? folder : null
}

/**
 * A path Leaf may land on after sign-in: its own, never another origin's. The
 * stored `returnTo` is written from this tab's location, so anything else is
 * not one Leaf wrote. A control character is refused too: the URL parser
 * drops a tab or a newline, so `/\t/x` would read as `//x`.
 */
export function ownPath(returnTo: string | null | undefined): string | null {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('\\')) return null
  for (const char of returnTo) if (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) return null
  return returnTo
}

const listeners = new Set<() => void>()

/** Go to `href` without a reload: AppProvider's `navigate`, for every link the package draws. */
export function navigate(href: string): void {
  if (href === window.location.pathname) return
  window.history.pushState(null, '', href)
  for (const listener of listeners) listener()
}

/** Be at `href` in place of where this tab is, so Back does not return to it: a link that has done its job. */
export function replace(href: string): void {
  window.history.replaceState(null, '', href)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

/** The current path, kept current through {@link navigate} and Back/Forward. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}
