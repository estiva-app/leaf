import { isArchived, type ForeignObject } from '@estiva-app/interop'
import { useEffect, useMemo, useState } from 'react'
import { nameOf, onSaved, readDocuments } from '../document/save'
import { summaryText } from '../document/summary'
import { naddrOf } from '../fileAddress'
import { isDocument, isListed, titleOf, typeOf } from '../folders/tree'
import type { WorkspaceFolder } from '../folders/useWorkspace'
import { query, viewerPubkey } from '../relay/bridge'
import { ownSavesFilter, rankRecent, recentFilters, textTargets, type Page, type RecentRow } from './recent'

/** One of Home's rows as it draws: the row, and the name of who changed it last. */
export interface HomeRow extends RecentRow {
  /** Their profile's name, "Someone" when they have none, or `null` while it is read. */
  byName: string | null
}

/** Home's rows: `null` while read, `'failed'` when the changes could not be read. */
export type Recent = HomeRow[] | null | 'failed'

/** A file as one of Home's rows, placed by `place`. */
function rowOf(file: ForeignObject, place: string, folderId: string): Page {
  return {
    address: file.address!,
    naddr: file.naddr!,
    kind: file.kind,
    eventId: file.eventId,
    title: titleOf(file),
    // Interop's default `subtitle` is the folded summary (SPEC §6.12, §7.2); empty is none.
    summary: summaryText(file.slots.subtitle?.value ?? '') || undefined,
    folder: place,
    // The Folder the file's root names, not the one that lists it: only a change there counts (SPEC §6.2, §6.12).
    folderId: file.folder ?? folderId,
    ...(isDocument(file) ? {} : { type: typeOf(file) }),
  }
}

/** The pages in the Folders the tree has read: `null` until every Folder has been read or has failed. */
export function pagesOf(folders: WorkspaceFolder[] | null): Page[] | null {
  if (!folders || folders.some((f) => f.contents === null && !f.failed)) return null
  return folders.flatMap(({ folder, contents }) =>
    (contents?.files ?? []).filter((f) => isDocument(f) && !f.unreachable && f.address && f.naddr).map((f) => rowOf(f, folder.name ?? folder.id, folder.id)),
  )
}

/**
 * Another app's file as one of Home's rows, when Leaf writes its text and it is not archived; `null` otherwise. Named
 * by the Folder the tree finds it in, as a page is (the approved Ship-file story's Home): a project's by the Folder
 * that lists it, an issue's by the Folder that lists its project. A Folder the tree has not read leaves the place
 * blank, never a Folder's id.
 */
export function otherRowOf(file: ForeignObject | null, folders: WorkspaceFolder[]): Page | null {
  if (!file || !isListed(file) || isArchived(file) || !file.address || !file.naddr || !file.folder) return null
  const lister = (address: string | undefined) => folders.find(({ contents }) => contents?.files.some((f) => f.address === address))?.folder
  const where = lister(file.address) ?? lister(file.parentRef)
  return rowOf(file, where?.name ?? '', file.folder)
}

/**
 * The other apps' files whose title, summary or text you changed (in any app, Miky at LTX-2's kickoff), read by
 * their addresses in one request, and kept when Leaf writes their text. Empty for someone signed out.
 */
async function othersOf(folders: WorkspaceFolder[], me: string | null): Promise<Page[]> {
  if (!me) return []
  const targets = textTargets(await query([ownSavesFilter(me)]))
  if (targets.length === 0) return []
  const read = await readDocuments(targets.map(naddrOf))
  return targets.map((t) => otherRowOf(read[naddrOf(t)] ?? null, folders)).filter((row): row is Page => row !== null)
}

/**
 * Home's rows, from the pages the tree reads, the other apps' files whose text
 * you changed, and every save of and comment on them. Read each time Home is
 * `shown`, so a file you just wrote in is on top when you come back, and again
 * when the tree's pages change; the last rows stay up while that read runs.
 */
export function useRecent(folders: WorkspaceFolder[] | null, shown: boolean): Recent {
  const pages = useMemo(() => pagesOf(folders), [folders])
  const [recent, setRecent] = useState<Recent>(null)
  const [saves, setSaves] = useState(0)

  // Only while Home is shown: elsewhere a save would re-render the whole frame for nothing.
  useEffect(() => (shown ? onSaved(() => setSaves((n) => n + 1)) : undefined), [shown])

  useEffect(() => {
    if (!pages || !folders || !shown) return
    let live = true
    const me = viewerPubkey()
    // Your pages still list when the other apps' files could not be read.
    const others = othersOf(folders, me).catch(() => [])
    const read = others.then(async (others) => {
      const files = [...pages, ...others]
      return { files, events: files.length === 0 ? [] : await query(recentFilters(files)) }
    })
    void read.then(
      async ({ files, events }) => {
        const rows = rankRecent(files, events, me)
        if (!live) return
        setRecent(rows.map((r) => ({ ...r, byName: null })))
        // Your own rows carry your name too, as Katerina's story has them; no name is "Someone", as the page says it.
        const names = await Promise.all(rows.map((r) => nameOf(r.by).catch(() => null)))
        if (live) setRecent(rows.map((r, i) => ({ ...r, byName: names[i] ?? 'Someone' })))
      },
      () => {
        if (live) setRecent('failed')
      },
    )
    return () => {
      live = false
    }
  }, [pages, folders, shown, saves])

  return pages ? recent : null
}
