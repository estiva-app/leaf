import { useEffect, useMemo, useState } from 'react'
import { nameOf, onSaved } from '../document/save'
import { isDocument, titleOf } from '../folders/tree'
import type { WorkspaceFolder } from '../folders/useWorkspace'
import { query, viewerPubkey } from '../relay/bridge'
import { rankRecent, recentFilters, type Page, type RecentRow } from './recent'

/** One of Home's rows as it draws: the row, and the name of who changed it last. */
export interface HomeRow extends RecentRow {
  /** "You", their profile's name, or `null` while it is read or when they have none. */
  byName: string | null
}

/** Home's rows: `null` while read, `'failed'` when the changes could not be read. */
export type Recent = HomeRow[] | null | 'failed'

/** The pages in the Folders the tree has read: `null` until every Folder has been read or has failed. */
export function pagesOf(folders: WorkspaceFolder[] | null): Page[] | null {
  if (!folders || folders.some((f) => f.contents === null && !f.failed)) return null
  return folders.flatMap(({ folder, contents }) =>
    (contents?.files ?? [])
      .filter((f) => isDocument(f) && !f.unreachable && f.address && f.naddr)
      .map((f) => ({
        address: f.address!,
        naddr: f.naddr!,
        eventId: f.eventId,
        title: titleOf(f),
        folder: folder.name ?? folder.id,
      })),
  )
}

/**
 * Home's rows, from the pages the tree reads and every save of and comment on
 * them. Read each time Home is `shown`, so a page you just wrote in is on top
 * when you come back, and again when the tree's pages change; the last rows
 * stay up while that read runs.
 */
export function useRecent(folders: WorkspaceFolder[] | null, shown: boolean): Recent {
  const pages = useMemo(() => pagesOf(folders), [folders])
  const [recent, setRecent] = useState<Recent>(null)
  const [saves, setSaves] = useState(0)

  useEffect(() => onSaved(() => setSaves((n) => n + 1)), [])

  useEffect(() => {
    if (!pages || !shown) return
    let live = true
    const me = viewerPubkey()
    const read = pages.length === 0 ? Promise.resolve([]) : query(recentFilters(pages))
    void read.then(
      async (events) => {
        const rows = rankRecent(pages, events, me)
        if (!live) return
        setRecent(rows.map((r) => ({ ...r, byName: r.by === me ? 'You' : null })))
        const names = await Promise.all(rows.map((r) => (r.by === me ? 'You' : nameOf(r.by).catch(() => null))))
        if (live) setRecent(rows.map((r, i) => ({ ...r, byName: names[i] })))
      },
      () => {
        if (live) setRecent('failed')
      },
    )
    return () => {
      live = false
    }
  }, [pages, shown, saves])

  return pages ? recent : null
}
