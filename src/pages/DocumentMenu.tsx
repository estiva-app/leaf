import { useRef, useState } from 'react'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { IconDotsVertical } from '@tabler/icons-react'
import { ArchiveDialog, ConfirmDialog, Menu, MenuItem, MenuSeparator, MoveDialog, ToolbarButton, useToast, type MovePlace } from '@estiva-app/ui'
import { copyLink } from '../document/blockLink'
import {
  archiveDocument,
  archiveHides,
  countOf,
  deleteDocument,
  moveDocument,
  moveFoldersFor,
  moveTargetsIn,
  readDeletePlan,
  readMovePlace,
  type DeletePlan,
  type MoveFolder,
  type MoveOutcome,
  type MoveTarget,
} from '../document/fileMenu'
import { titleOf } from '../folders/tree'
import { readFolder, takesNewDocuments } from '../folders/workspace'
import { navigate, pagePath } from '../route'
import { archiveWordsOf } from './archive'

/** The Folder that lists a page, by the sidebar's read, else its `h`. */
export function listedInOf(file: ForeignObject, folders: readonly FolderSummary[] | undefined): string | undefined {
  return (folders ?? []).find((folder) => folder.hasState && !!file.address && !!folder.addresses?.includes(file.address))?.id ?? file.folder
}

/**
 * Archive or unarchive a Leaf page, said in a toast, and its Folder read again: the ⋯ menu's and the archived
 * notice's Unarchive (a3257366) do the same thing. False when the relay refused it.
 */
export function useSetArchived(file: ForeignObject, listedIn: string | undefined, onChanged?: (folder: string) => void | Promise<void>) {
  const { showToast } = useToast()
  const title = titleOf(file)
  return async function setArchived(archived: boolean, resolution?: string): Promise<boolean> {
    const result = await archiveDocument(file, archived, resolution)
    if (!result.ok) {
      showToast({ label: result.reason, type: 'error' })
      return false
    }
    if (listedIn) void onChanged?.(listedIn)
    // Undo, then Peek's Archive view or its link, bring it back (Miky, LED-4 kickoff).
    showToast(
      archived
        ? { label: `Archived “${title}”`, type: 'success', actionLabel: 'Undo', onAction: () => void setArchived(false) }
        : { label: `Unarchived “${title}”`, type: 'success' },
    )
    return true
  }
}

// The Folders it may go to are drawn from the current `folders`, so a Move opened before the sidebar read them fills in.
type Moving = { kind: 'move'; from: MoveFolder[]; targets: MoveTarget[]; under: string }

/**
 * A Leaf document's ⋯ menu, as the LED-1 prototype draws it: Move…, Copy link, Archive… or Unarchive, and Delete
 * (LED-4, LED-5). Archive is offered beside Delete, never as two styles of one control; an archived page keeps
 * Unarchive and Delete, and one archived with a page above it is unarchived there (SPEC §6.5), and may move out of it.
 * `folders` are the Folders the sidebar read, undefined until it has; `onChanged` re-reads one Folder's files.
 */
export function DocumentMenu({
  file,
  folders: sidebarFolders,
  onChanged,
  onNewInside,
  heading,
}: {
  file: ForeignObject
  folders?: readonly FolderSummary[]
  onChanged?: (folder: string) => void | Promise<void>
  /** "New document inside": open New document under this page, in the Folder listing it (LFB-8). */
  onNewInside?: (listedIn: string) => void
  /** A line drawn first and not chosen: the last edit, in a narrow window. */
  heading?: string
}) {
  const folders = sidebarFolders ?? []
  const { showToast } = useToast()
  const [dialog, setDialog] = useState<{ kind: 'archive'; hides: string } | { kind: 'delete'; plan: DeletePlan; words: string } | Moving | null>(null)
  // One read at a time: a second press while the count is read would open a second dialog over the first.
  const reading = useRef(false)
  // The open Move's Folders changed since they were read: the next Move reads them again.
  const stale = useRef(false)
  // The places the open Move offered, by Folder: what the kit's choice names, with the path the toast says.
  const placesRead = useRef<Record<string, MoveTarget[]>>({})
  const title = titleOf(file)
  const refuse = (label: string) => showToast({ label, type: 'error' })
  // The Folder that lists it, not its `h`: after a move they differ. Known from the sidebar, then from the last Move.
  const [movedTo, setMovedTo] = useState<string>()
  const listedIn = movedTo ?? listedInOf(file, folders)
  const changed = () => {
    if (listedIn) void onChanged?.(listedIn)
  }
  const setArchived = useSetArchived(file, listedIn, onChanged)

  function read<T>(what: Promise<T>, open: (found: T) => void, failed: string) {
    if (reading.current) return
    reading.current = true
    void what
      .then(open, () => refuse(failed))
      .finally(() => {
        reading.current = false
      })
  }

  async function remove(shown: DeletePlan): Promise<boolean> {
    // Read again on confirm: a page moved under it while the dialog was open moves up too.
    const plan = await readDeletePlan(file).catch(() => shown)
    const result = await deleteDocument(file, plan)
    if (!result.ok) {
      refuse(result.reason)
      return false
    }
    navigate(plan.to ? pagePath({ ...plan.to, title: titleOf(plan.to) }) : '/')
    changed()
    const after = [
      result.unmoved > 0 && `${result.unmoved === 1 ? '1 page' : `${result.unmoved} pages`} under it could not be moved and ${result.unmoved === 1 ? 'is' : 'are'} at the Folder’s top.`,
      result.stillListed && 'It is still listed in a Folder; reload and try again.',
    ].filter(Boolean)
    showToast({ label: after.length ? [`Deleted “${title}”.`, ...after].join(' ') : `Deleted “${title}”`, type: after.length ? 'warning' : 'success' })
    return true
  }

  /** Open Move on where the page is now, read from the relay, and that Folder's places; another Folder's are read when picked. */
  function openMove() {
    stale.current = false
    read(
      readMovePlace(file, folders),
      ({ from, files, beneath }) => {
        const targets = moveTargetsIn(files, file, { sameFolder: true })
        placesRead.current = { [from[0].id]: targets }
        setDialog({
          kind: 'move',
          from,
          targets,
          under: beneath.length ? `The ${moveCount(beneath)} under it ${beneath.length === 1 ? 'moves' : 'move'} with it.` : '',
        })
      },
      'The Folder it is in could not be read, so nothing was moved. Try again.',
    )
  }

  /** Where Move may put it in another Folder, read when that Folder is picked; kept for the choice's path. */
  async function placesIn(moving: Moving, id: string): Promise<MovePlace[]> {
    const targets = moveTargetsIn((await readFolder(id)).files, file, { sameFolder: id === moving.from[0].id })
    placesRead.current[id] = targets
    return targets.map(placeOf)
  }

  /**
   * The Folders Move offers, from the sidebar's read; undefined until it has read them. None when no other Folder
   * takes it and in its own it is already at the only place there is, so the dialog says there is no other folder.
   */
  function moveDestinations(moving: Moving): MoveFolder[] | undefined {
    if (!sidebarFolders) return undefined
    const offered = moveFoldersFor(file, moving.from[0], sidebarFolders)
    return offered.every((folder) => folder.id === moving.from[0].id) && moving.targets.length === 0 ? [] : offered
  }

  async function relocate(moving: Moving, to: MoveFolder, parent: MoveTarget): Promise<boolean> {
    // After the Folders changed under a move, which Folders list it is read again, so "Try again" can succeed.
    let from = moving.from
    if (stale.current) {
      try {
        from = (await readMovePlace(file, folders)).from
      } catch {
        refuse('The Folder it is in could not be read, so nothing was moved. Try again.')
        return false
      }
      stale.current = false
    }
    const result = await moveDocument(file, { from, to, parent: parent.address })
    if (!result.ok) {
      stale.current = !!result.changed
      refuse(result.reason)
      return false
    }
    setMovedTo(to.id)
    // Both ends, the Folder it went to first, so the open page is found in one of them throughout.
    for (const id of new Set([to.id, ...from.map((folder) => folder.id)])) await onChanged?.(id)
    const half = halfMovedWords(to.name, result)
    if (half) refuse(half)
    else showToast({ label: `Moved to ${parent.path.at(-1) ?? to.name}`, type: 'success' })
    return true
  }

  const archivedSelf = !!file.archived && !file.archived.with
  // Archive's question, once what it would hide is read: from the menu, and from the delete question's Archive instead.
  const openArchive = () =>
    file.address &&
    read(archiveHides(file.address), (hides) => setDialog({ kind: 'archive', hides }), 'What archiving would hide could not be read, so nothing was archived. Try again.')
  return (
    <>
      <Menu
        trigger={
          <ToolbarButton tooltip="More" aria-label="More">
            <IconDotsVertical size={16} stroke={1.5} />
          </ToolbarButton>
        }
        align="right"
      >
        {/* A narrow window: the last edit leaves the bar and heads the menu, as the LED-1 prototype draws it. */}
        {heading && <MenuItem label={heading} disabled />}
        {heading && <MenuSeparator />}
        {/* As Peek's "New topic inside" (Miky, LFB-8 kickoff): not on an archived page, which takes nothing new, and only
            where the Folder listing it takes a document, so the new page draws beneath it there. A page with no address
            or Folder of its own has nothing to name it by. */}
        {onNewInside && !file.archived && file.address && file.folder && listedIn && folders.some((f) => f.id === listedIn && takesNewDocuments(f)) && (
          <MenuItem label="New document inside" onClick={() => onNewInside(listedIn)} />
        )}
        {/* Not on a page archived by itself; one archived with a page above it may move out of it (SPEC §6.5). */}
        {!archivedSelf && <MenuItem label="Move…" onClick={openMove} />}
        <MenuItem
          label="Copy link"
          onClick={() => {
            // The page's own link, as the address bar holds it (App's relink): no slug for a page with no title.
            if (file.address) void copyLink(`${window.location.origin}${pagePath({ ...file, title: file.slots.title?.value })}`, (label) => showToast({ label }))
          }}
        />
        {archivedSelf ? (
          <MenuItem label="Unarchive" onClick={() => void setArchived(false)} />
        ) : (
          !file.archived && <MenuItem label="Archive…" onClick={() => void openArchive()} />
        )}
        <MenuItem
          label="Delete"
          destructive
          onClick={() => read(readDeletePlan(file), (plan) => setDialog({ kind: 'delete', plan, words: deleteWords(file, plan) }), 'The Folder could not be read, so nothing was deleted. Try again.')}
        />
      </Menu>
      {dialog?.kind === 'move' && (
        <MoveDialog
          title={title}
          description={dialog.under ? `Everyone who can read it now still can. ${dialog.under}` : 'Everyone who can read it now still can.'}
          from={dialog.from[0].id}
          folders={moveDestinations(dialog)}
          places={dialog.targets.map(placeOf)}
          placesIn={(id) => placesIn(dialog, id)}
          onMove={({ folder, parent = '' }) => {
            const to = moveDestinations(dialog)?.find((one) => one.id === folder)
            const place = placesRead.current[folder]?.find((one) => one.address === parent)
            return to && place ? relocate(dialog, to, place) : false
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'archive' && (
        <ArchiveDialog
          {...archiveWordsOf(dialog.hides)}
          title={title}
          onArchive={(resolution) => setArchived(true, resolution || undefined)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete “${title}”?`}
          confirmLabel="Delete page"
          destructive
          onConfirm={() => remove(dialog.plan)}
          onClose={() => setDialog(null)}
          // The kit's safer answer, in its and Peek's words, where the menu offers Archive (Katerina, 4 November): it
          // opens Archive's question, which takes this one's place.
          alternative={
            !file.archived
              ? { label: 'Archive instead', sentence: 'To take it out of every list and keep it readable, archive it instead.', onClick: () => void openArchive() }
              : undefined
          }
        >
          <p>It leaves every list, in Leaf, Peek and Ship. Copies someone already has are not erased.</p>
          {dialog.words && <p>{dialog.words}</p>}
        </ConfirmDialog>
      )}
    </>
  )
}

/**
 * Where the pages under a deleted page go, in words: "The 1 page under it moves up into Leaf feedback." On a page
 * archived itself, the pages archived with it come back, live, and are not archived on the way (Miky, LED-4 kickoff).
 * Never "erased". Empty when nothing is under it.
 */
export function deleteWords(file: Pick<ForeignObject, 'archived'>, plan: DeletePlan): string {
  const back = !!file.archived && !file.archived.with
  // On an archived page, only the pages archived with it come back; one archived itself moves up and stays archived.
  const children = back ? plan.children.filter((child) => !child.archived || child.archived.with) : plan.children
  if (children.length === 0) return ''
  const place = plan.to ? titleOf(plan.to) : (plan.folderName ?? 'its Folder')
  const kinds = new Set(children.map((child) => child.kind))
  const what = kinds.size === 1 ? countOf(children[0].kind, children.length) : `${children.length} files`
  const one = children.length === 1
  if (back) return `The ${what} under it ${one ? 'comes' : 'come'} back into ${place}.`
  return `The ${what} under it ${one ? 'moves' : 'move'} up into ${place}.`
}

/**
 * A move that landed in part, in words, each part that did not follow said once: "Moved to Steer, but QA still lists
 * it too: one of the Folders is archived. It is not in its new place yet." Empty when all of it landed.
 */
export function halfMovedWords(to: string, { stillIn, stillWhy, unplaced }: Extract<MoveOutcome, { ok: true }>): string {
  const names = stillIn.map((folder) => folder.name).join(' and ')
  const still = names && `${names} still ${stillIn.length === 1 ? 'lists' : 'list'} it too`
  // "Try moving it again" only once, last, and only when no why says a retry cannot succeed.
  const retry = !stillWhy && (!!still || !!unplaced)
  const first = still ? (stillWhy ? `${still}: ${stillWhy}` : `${still}.`) : stillWhy
  if (!first) return unplaced ? `Moved to ${to}, but not all of it: ${unplaced}. Try moving it again.` : ''
  return [`Moved to ${to}, but ${first}`, unplaced && `${unplaced[0].toUpperCase()}${unplaced.slice(1)}.`, retry && 'Try moving it again.'].filter(Boolean).join(' ')
}

/** A place Move offers, as the kit's dialog takes it: what it goes under by address, `''` for the Folder's top. */
const placeOf = (target: MoveTarget): MovePlace => ({ id: target.address, path: target.path })

/** What moves with a page, in words: "2 pages", or "3 files" when they are of more than one kind. */
function moveCount(beneath: readonly ForeignObject[]): string {
  const kinds = new Set(beneath.map((one) => one.kind))
  return kinds.size === 1 ? countOf(beneath[0].kind, beneath.length) : `${beneath.length} files`
}
