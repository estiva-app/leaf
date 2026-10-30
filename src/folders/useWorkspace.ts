import type { FolderContents, FolderSummary, ForeignObject, QueryFn } from '@estiva-app/interop'
import { RelayBusyError } from '@estiva-app/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadQuery, readChildren, readFolder, readFolders } from './workspace'

/** One Folder in the tree: its contents once read, or why they could not be. */
export interface WorkspaceFolder {
  folder: FolderSummary
  /** `null` while being read. */
  contents: FolderContents | null
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
  /** The rows open in the tree, by `ref`. Leaf owns them, so opening one is always when its rows are read. */
  opened: ReadonlySet<string>
  /** Open or close `file`'s row; opening reads what it lists under it, once. */
  setOpen(file: ForeignObject, open: boolean): void
  /** Open or close a Folder's group, by its id — in the same set as the rows. */
  setFolderOpen(id: string, open: boolean): void
  /** Open each of these Folders and rows, closing none: where an opened file sits (LFB-9). They are read already. */
  reveal(ids: readonly string[]): void
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
      next = { folder, contents: await readFolder(folder.id, read) }
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
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
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

  const setFolderOpen = useCallback((id: string, open: boolean) => {
    setOpened((now) => {
      if (now.has(id) === open) return now
      const next = new Set(now)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const reveal = useCallback((ids: readonly string[]) => {
    setOpened((now) => (ids.every((id) => now.has(id)) ? now : new Set([...now, ...ids])))
  }, [])

  return { folders, failed, reload, reloadFolder, children, opened, setOpen, setFolderOpen, reveal }
}
