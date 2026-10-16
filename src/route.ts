import { useSyncExternalStore } from 'react'

/**
 * Leaf's two places: Home at `/`, and one file at `/f/<naddr>`. The address is
 * the file's own `naddr`, so a link to a page names the page rather than where
 * it was opened from. Kept to the History API: two routes need no router.
 */
export type Route = { page: 'home' } | { page: 'file'; naddr: string }

/** The place a path names. Anything Leaf does not know is Home. */
export function routeOf(pathname: string): Route {
  const match = /^\/f\/([a-z0-9]+)\/?$/.exec(pathname)
  return match ? { page: 'file', naddr: match[1] } : { page: 'home' }
}

/** The path of a file's page. */
export function filePath(naddr: string): string {
  return `/f/${naddr}`
}

/**
 * The link that opens New document on one Folder, by the Folder's id (its
 * channel uuid). What another app links to when it offers Leaf's New
 * document: Leaf writes the document, signing its own `kind:30842`, and the
 * app that offered it signs nothing (Miky, 2026-10-16).
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
 * not one Leaf wrote.
 */
export function ownPath(returnTo: string | null | undefined): string | null {
  return returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\') ? returnTo : null
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
