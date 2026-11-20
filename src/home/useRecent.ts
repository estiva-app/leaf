import { isArchived, type ForeignObject } from '@estiva-app/interop'
import { useEffect, useMemo, useState } from 'react'
import { nameOf, onSaved, readFileRows } from '../document/save'
import { summaryText } from '../document/summary'
import { isDocument, isListed, titleOf, typeOf } from '../folders/tree'
import type { WorkspaceFolder } from '../folders/useWorkspace'
import { query, viewerPubkey } from '../relay/bridge'
import { isIssue, isProject, isSwitchedKind, issueFields, projectFields, timesRead } from '../relay/projectFields'
import { isRowOnly } from '../relay/rowOnly'
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
    (contents?.files ?? []).filter((f) => isDocument(f) && !f.unreachable && f.address && f.naddr).map((f) => pageRowOf(f, folder.name ?? folder.id, folder.id)),
  )
}

/**
 * A page as one of Home's rows. One the tree read by the list read (ALL-4) names its title's and summary's current
 * changes, and its text's comes from the times read ({@link withEdits}), so Home reads those by id and never every
 * save made to the page: 12.96 MB of QA-1's cold open on 20 Nov.
 */
function pageRowOf(file: ForeignObject, place: string, folderId: string): Page {
  const row = rowOf(file, place, folderId)
  if (!isRowOnly(file) || !file.prevs) return row
  return { ...row, changes: EDITS.map((field) => file.prevs![field]).filter((id): id is string => !!id) }
}

/** `rows`, each that names its current changes given its newest text change too, from the times read. */
async function withEdits(rows: Page[]): Promise<Page[]> {
  const edits = await editsOf(rows.filter((row) => row.changes))
  return rows.map((row) => (edits.has(row.address) ? { ...row, changes: [...new Set([...(row.changes ?? []), ...edits.get(row.address)!])] } : row))
}

/**
 * Another app's file as one of Home's rows, when Leaf writes its text and it is not archived; `null` otherwise. Named
 * by the Folder the tree finds it in, as a page is (the approved Ship-file story's Home): a project's by the Folder
 * that lists it, an issue's by the Folder that lists its project. A Folder the tree has not read leaves the place
 * blank, never a Folder's id.
 */
export function otherRowOf(file: ForeignObject | null, folders: WorkspaceFolder[], byFields = false): Page | null {
  // A deleted project is gone from Home as from every list (SPEC §6.5, ALO-6).
  if (!file || !isListed(file) || isArchived(file) || file.deleted || !file.address || !file.naddr || !file.folder) return null
  const lister = (address: string | undefined) => folders.find(({ contents }) => contents?.files.some((f) => f.address === address))?.folder
  const where = lister(file.address) ?? lister(file.parentRef)
  const row = rowOf(file, where?.name ?? '', file.folder)
  if (!byFields || !isSwitchedKind(file.address) || !file.prevs) return row
  const changes = EDITS.map((field) => file.prevs![field]).filter((id): id is string => !!id)
  return { ...row, changes }
}

/** The fields whose change raises another app's file on Home. */
const EDITS = ['title', 'summary', 'description'] as const

/**
 * The other apps' files whose title, summary or text you changed (in any app, Miky at LTX-2's kickoff), read by
 * their addresses in one request, and kept when Leaf writes their text. Empty for someone signed out.
 */
async function othersOf(folders: WorkspaceFolder[], me: string | null): Promise<Page[]> {
  if (!me) return []
  const targets = textTargets(await query([ownSavesFilter(me)]))
  if (targets.length === 0) return []
  const [read, projects, issues] = await Promise.all([readFileRows(targets), projectFields(), issueFields()])
  // A project or an issue read by its fields names its current changes, each by its own switch (ISS-6).
  const switched = (address: string) => (isProject(address) ? !!projects : isIssue(address) ? !!issues : false)
  const rows = targets.map((t) => otherRowOf(read[t] ?? null, folders, switched(t))).filter((row): row is Page => row !== null)
  // A row read by the list read names no text change (§6.13): its newest edits come from the times read.
  const edits = await editsOf(rows.filter((row) => row.changes && read[row.address] && isRowOnly(read[row.address]!)))
  return rows.map((row) => (edits.has(row.address) ? { ...row, changes: [...new Set([...(row.changes ?? []), ...edits.get(row.address)!])] } : row))
}

/**
 * The newest title, summary and text change of each of `rows`, by id, from the relay's times read (SPEC §6.13): when
 * each changed, without the changes. Home reads those changes by id, as it reads a whole-read file's. Empty where
 * the relay has no times read, or when it fails: the row then ranks by the changes it names.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-may-answer-when-a-file-changed-without-the-change.md
 */
export async function editsOf(rows: Pick<Page, 'address'>[]): Promise<Map<string, string[]>> {
  const { times } = await timesRead()
  if (!times || rows.length === 0) return new Map()
  const byKind = new Map<number, string[]>()
  for (const { address } of rows) {
    const [kind, , d] = address.split(':')
    byKind.set(Number(kind), [...(byKind.get(Number(kind)) ?? []), d])
  }
  const answers = await times([...byKind].map(([kind, ds]) => ({ fields: 'times', kinds: [kind], '#d': ds }))).catch(() => [])
  const edits = new Map<string, string[]>()
  for (const file of answers) {
    const newest = EDITS.flatMap((field) => {
      const changes = file.changes.filter((change) => change.fields.includes(field))
      return changes.length ? [changes.reduce((a, b) => (b.created_at > a.created_at ? b : a)).id] : []
    })
    if (newest.length) edits.set(file.a, newest)
  }
  return edits
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
    // Your pages' changes are read beside the other apps' files, not after them, and your pages still list when
    // those files or their changes could not be read.
    const pageEvents = pages.length === 0 ? Promise.resolve({ rows: pages, events: [] }) : withEdits(pages).then(async (rows) => ({ rows, events: await query(recentFilters(rows)) }))
    const others = othersOf(folders, me).then(
      async (others) => ({ others, events: others.length === 0 ? [] : await query(recentFilters(others)) }),
      () => ({ others: [] as Page[], events: [] }),
    )
    const read = Promise.all([pageEvents, others]).then(([own, more]) => ({
      files: [...own.rows, ...more.others],
      events: [...own.events, ...more.events],
    }))
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
