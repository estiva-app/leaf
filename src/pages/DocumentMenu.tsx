import { useRef, useState } from 'react'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { IconDots } from '@tabler/icons-react'
import { Button, ConfirmDialog, DialogShell, Field, Form, Menu, MenuItem, MenuSeparator, Textarea, ToolbarButton, useToast } from '@estiva-app/ui'
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
  type MoveTarget,
} from '../document/fileMenu'
import { titleOf } from '../folders/tree'
import { readFolder, takesNewDocuments } from '../folders/workspace'
import { navigate, pagePath } from '../route'
import { MoveDialog } from './MoveDialog'

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
    read(
      readMovePlace(file, folders),
      ({ from, files, beneath }) => {
        setDialog({
          kind: 'move',
          from,
          targets: moveTargetsIn(files, file, { sameFolder: true }),
          under: beneath.length ? `The ${moveCount(beneath)} under it ${beneath.length === 1 ? 'moves' : 'move'} with it.` : '',
        })
      },
      'The Folder it is in could not be read, so nothing was moved. Try again.',
    )
  }

  async function relocate(moving: Moving, to: MoveFolder, parent: MoveTarget): Promise<boolean> {
    const result = await moveDocument(file, { from: moving.from, to, parent: parent.address })
    if (!result.ok) {
      refuse(result.reason)
      return false
    }
    setMovedTo(to.id)
    // Both ends, the Folder it went to first, so the open page is found in one of them throughout.
    for (const id of new Set([to.id, ...moving.from.map((folder) => folder.id)])) await onChanged?.(id)
    if (result.stillIn.length) refuse(`Moved to ${to.name}, but ${result.stillIn.map((folder) => folder.name).join(' and ')} still lists it too. Try moving it again.`)
    else if (result.unplaced) refuse(`Moved to ${to.name}, but not all of it: ${result.unplaced}. Try moving it again.`)
    else showToast({ label: `Moved to ${parent.path.at(-1) ?? to.name}`, type: 'success' })
    return true
  }

  const archivedSelf = !!file.archived && !file.archived.with
  return (
    <>
      <Menu
        trigger={
          <ToolbarButton tooltip="More" aria-label="More">
            <IconDots size={16} stroke={1.5} />
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
          !file.archived && (
            <MenuItem
              label="Archive…"
              onClick={() =>
                file.address &&
                read(archiveHides(file.address), (hides) => setDialog({ kind: 'archive', hides }), 'What archiving would hide could not be read, so nothing was archived. Try again.')
              }
            />
          )
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
          under={dialog.under}
          from={dialog.from[0].id}
          folders={sidebarFolders && moveFoldersFor(file, dialog.from[0], sidebarFolders)}
          targets={dialog.targets}
          targetsIn={async (id) => moveTargetsIn((await readFolder(id)).files, file, { sameFolder: id === dialog.from[0].id })}
          onMove={(to, parent) => relocate(dialog, to, parent)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'archive' && (
        <ArchiveDialog title={title} hides={dialog.hides} onArchive={(resolution) => setArchived(true, resolution || undefined)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog title={`Delete “${title}”?`} confirmLabel="Delete page" destructive onConfirm={() => remove(dialog.plan)} onClose={() => setDialog(null)}>
          <p>It leaves every list, in Leaf, Peek and Ship. Copies someone already has are not erased.</p>
          {dialog.words && <p>{dialog.words}</p>}
          {!file.archived && <p className="text-text-secondary">Archiving is reversible and usually what you want.</p>}
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

/** What moves with a page, in words: "2 pages", or "3 files" when they are of more than one kind. */
function moveCount(beneath: readonly ForeignObject[]): string {
  const kinds = new Set(beneath.map((one) => one.kind))
  return kinds.size === 1 ? countOf(beneath[0].kind, beneath.length) : `${beneath.length} files`
}

/** "Archive …?" for a Leaf page: what it hides with it, that nothing is deleted, and an optional resolution (the prototype's words). */
function ArchiveDialog({ title, hides, onArchive, onClose }: { title: string; hides: string; onArchive: (resolution: string) => Promise<boolean>; onClose: () => void }) {
  const [resolution, setResolution] = useState('')
  const archive = async () => {
    if (await onArchive(resolution.trim())) onClose()
  }
  return (
    <DialogShell
      title={`Archive “${title}”?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="muted" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="archive-form">
            Archive page
          </Button>
        </>
      }
    >
      <Form id="archive-form" onSubmit={archive}>
        <div className="flex flex-col gap-2 text-body-2 text-text-primary">
          <p>{hides ? `This hides the page and the ${hides} under it from every list, in Leaf, Peek and Ship.` : 'This hides the page from every list, in Leaf, Peek and Ship.'}</p>
          <p className="text-text-secondary">Nothing is deleted: a link still opens it, and Unarchive brings everything back as it was.</p>
        </div>
        <Field label="Resolution (optional)">
          <Textarea value={resolution} rows={3} placeholder="What happened with this page?" onChange={(event) => setResolution(event.target.value)} />
        </Field>
      </Form>
    </DialogShell>
  )
}
