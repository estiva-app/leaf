import { useEffect } from 'react'

/**
 * The browser tab's title: the page first, then the app, so a narrow tab still
 * shows which page it is (SFX-2; Miky, 2026-10-30). A page that is loading or
 * can't be read is just "Leaf" — never the previous page's title. `null`
 * leaves it to the page drawn inside, which names itself (a topic's, LTN-3).
 */
export function useTabTitle(page: string | undefined | null): void {
  useEffect(() => {
    if (page === null) return
    document.title = page ? `${page} – Leaf` : 'Leaf'
  }, [page])
}
