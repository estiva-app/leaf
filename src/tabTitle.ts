import { useEffect } from 'react'

/**
 * The browser tab's title: the page first, then the app, so a narrow tab still
 * shows which page it is (SFX-2; Miky, 2026-10-30). A page that is loading or
 * can't be read is just "Leaf" — never the previous page's title.
 */
export function useTabTitle(page: string | undefined): void {
  useEffect(() => {
    document.title = page ? `${page} – Leaf` : 'Leaf'
  }, [page])
}
