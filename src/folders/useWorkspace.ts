import { isArchived, type FolderContents, type FolderSummary, type ForeignObject, type QueryFn } from '@estiva-app/interop'
import { RelayBusyError } from '@estiva-app/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isDocument } from './tree'
import { loadQuery, readChildren, readFolder, readFolders } from './workspace'

/**
 * Where this browser keeps which Folders and rows are open, so a reload or a new tab — every card in another app opens
 * one — draws the tree as the person left it (Katerina, 30 October). The open file's own place still opens on top.
 */
const OPENED_KEY = 'leaf.tree.open'

function keptOpen(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(OPENED_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** One Folder in the tree: its contents once read, or why they could not be. */
export interface WorkspaceFolder {
  folder: FolderSummary
  /** `null` while being read. */
  contents: FolderContents | null
  /** The files it lists that are archived, read with its contents and not drawn: so Topics need not read them again. */
  archived?: ForeignObject[]
  failed?: boolean
}

export interface Workspace {
  /** `null` while the listing is read. */
  folders: WorkspaceFolder[] | null
  /** The listing itself could not be read. */
  failed: boolean
  /** Read everything again. */
  reload(): Promise<void>
  /** Read one Folder's files again: after a new document went in it. */
  reloadFolder(id: string): Promise<void>
  /** What each opened file lists under it, by its `ref`: absent until opened, `null` while read. */
  children: Record<string, ForeignObject[] | null | 'failed'>
  /** The rows open in the tree, by `ref`, and the Folders, by id: kept on this browser. Leaf owns them, so opening one is always when its rows are read. */
  opened: ReadonlySet<string>
  /** Open or close `file`'s row; opening reads what it lists under it, once. */
  setOpen(file: ForeignObject, open: boolean): void
  /** Open or close a Folder's group, by its id — in the same set as the rows. */
  setFolderOpen(id: string, open: boolean): void
}

/**
 * The workspace as the tree draws it: the Folders, then each one's files, read
 * side by side so one slow Folder does not hold up the rest. Read on mount and
 * on {@link Workspace.reload}; live updates come with LEAF-3.
 */
export function useWorkspace(): Workspace {
  const [folders, setFolders] = useState<WorkspaceFolder[] | null>(null)
  const [failed, setFailed] = useState(false)

  // Each Folder's latest read, so an older read that lands late never replaces a newer one.
  const latest = useRef(new Map<string, number>())
  const readInto = useCallback(async (folder: FolderSummary, read: QueryFn = loadQuery()) => {
    const turn = (latest.current.get(folder.id) ?? 0) + 1
    latest.current.set(folder.id, turn)
    let next: WorkspaceFolder
    let busy = false
    try {
      // The archived files are kept aside, not drawn: Topics would otherwise read each again, every change of it, only
      // to leave it out (LTN-2: three finished projects, 6 MB of every one of Miky's opens).
      const all = await readFolder(folder.id, read, { includeArchived: true })
      next = { folder, contents: { ...all, files: all.files.filter((f) => !isArchived(f)) }, archived: all.files.filter(isArchived) }
    } catch (error) {
      busy = error instanceof RelayBusyError
      next = { folder, contents: null, failed: true }
    }
    if (latest.current.get(folder.id) !== turn) return
    /*
      A relay still busy after its quiet retries does not blank a Folder already read: the tree keeps its files
      (APP-9). Any other failure drops them, since a refusal can mean this person was just removed from the Folder.
      why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/someone-you-remove-loses-access-at-once.md
    */
    setFolders(
      (now) => now?.map((f) => (f.folder.id !== folder.id ? f : busy && f.contents ? { ...f, failed: true } : next)) ?? null,
    )
  }, [])

  // Whether a listing has landed: a busy relay after that keeps the tree drawn rather than saying it could not be read.
  const listed = useRef(false)

  const reload = useCallback(async () => {
    // One load: the listing and every Folder's read share what they have read.
    const read = loadQuery()
    let listing: FolderSummary[]
    try {
      listing = await readFolders(read)
    } catch (error) {
      // Busy once the tree is drawn: keep it, as a Folder's re-read does (APP-9). Only a first read says it failed.
      if (!(error instanceof RelayBusyError && listed.current)) setFailed(true)
      return
    }
    listed.current = true
    setFailed(false)
    // Keep what was read until its new read lands, so a reload does not blank the tree.
    setFolders((before) =>
      listing.map((folder) => ({ folder, contents: before?.find((f) => f.folder.id === folder.id)?.contents ?? null })),
    )
    await Promise.all(listing.map((folder) => readInto(folder, read)))
  }, [readInto])

  /** Read one Folder again — the one a new document went in — leaving the rest as read. */
  const reloadFolder = useCallback(
    async (id: string) => {
      const folder = folders?.find((f) => f.folder.id === id)?.folder
      if (folder) await readInto(folder)
    },
    [folders, readInto],
  )

  useEffect(() => {
    // The first read; a later one comes from `reload`. Every state it sets lands
    // after the relay answers, never during the effect.
    void Promise.resolve().then(reload)
  }, [reload])

  const [children, setChildren] = useState<Workspace['children']>({})
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(keptOpen()))
  useEffect(() => {
    try {
      window.localStorage.setItem(OPENED_KEY, JSON.stringify([...opened]))
    } catch {
      // Storage refused (private mode, full): the tree is kept for this visit only.
    }
  }, [opened])
  // What has been asked for, so opening a row twice reads it once. A failed read may be asked again.
  const asked = useRef(new Set<string>())
  const setOpen = useCallback((file: ForeignObject, open: boolean) => {
    const { naddr, ref } = file
    setOpened((now) => {
      const next = new Set(now)
      if (open) next.add(ref)
      else next.delete(ref)
      return next
    })
    if (!open || !naddr || asked.current.has(ref)) return
    asked.current.add(ref)
    setChildren((now) => ({ ...now, [ref]: null }))
    void readChildren(naddr).then(
      (read) => setChildren((now) => ({ ...now, [ref]: read })),
      () => {
        asked.current.delete(ref)
        setChildren((now) => ({ ...now, [ref]: 'failed' }))
      },
    )
  }, [])

  // A row kept open that lists its own children — a Ship project — reads them once it is listed, as opening it does.
  useEffect(() => {
    for (const folder of folders ?? [])
      for (const file of folder.contents?.files ?? [])
        if (file.listsChildren && !isDocument(file) && opened.has(file.ref) && !asked.current.has(file.ref)) setOpen(file, true)
  }, [folders, opened, setOpen])

  const setFolderOpen = useCallback((id: string, open: boolean) => {
    setOpened((now) => {
      if (now.has(id) === open) return now
      const next = new Set(now)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  return { folders, failed, reload, reloadFolder, children, opened, setOpen, setFolderOpen }
}
