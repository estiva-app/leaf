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

const listeners = new Set<() => void>()

/** Go to `href` without a reload: AppProvider's `navigate`, for every link the package draws. */
export function navigate(href: string): void {
  if (href === window.location.pathname) return
  window.history.pushState(null, '', href)
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
