import type { FolderContents, FolderSummary, ForeignObject } from '@estiva-app/interop'
import { useCallback, useEffect, useRef, useState } from 'react'
import { readChildren, readFolder, readFolders } from './workspace'

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
  /** Read one Folder's files again: after a new page went in it. */
  reloadFolder(id: string): Promise<void>
  /** What each opened file lists under it, by its `ref`: absent until opened, `null` while read. */
  children: Record<string, ForeignObject[] | null | 'failed'>
  /** The rows open in the tree, by `ref`. Leaf owns them, so opening one is always when its rows are read. */
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
  const readInto = useCallback(async (folder: FolderSummary) => {
    const turn = (latest.current.get(folder.id) ?? 0) + 1
    latest.current.set(folder.id, turn)
    const next: WorkspaceFolder = await readFolder(folder.id).then(
      (contents) => ({ folder, contents }),
      () => ({ folder, contents: null, failed: true }),
    )
    if (latest.current.get(folder.id) !== turn) return
    setFolders((now) => now?.map((f) => (f.folder.id === folder.id ? next : f)) ?? null)
  }, [])

  const reload = useCallback(async () => {
    let listing: FolderSummary[]
    try {
      listing = await readFolders()
    } catch {
      setFailed(true)
      return
    }
    setFailed(false)
    // Keep what was read until its new read lands, so a reload does not blank the tree.
    setFolders((before) =>
      listing.map((folder) => ({ folder, contents: before?.find((f) => f.folder.id === folder.id)?.contents ?? null })),
    )
    await Promise.all(listing.map(readInto))
  }, [readInto])

  /** Read one Folder again — the one a new page went in — leaving the rest as read. */
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

  return { folders, failed, reload, reloadFolder, children, opened, setOpen, setFolderOpen }
}
