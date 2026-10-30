import { useId, useRef, useState } from 'react'
import { Button, DialogShell, EmptyState, Field, Form, Select } from '@estiva-app/ui'
import type { MoveFolder, MoveTarget } from '../document/fileMenu'

const TOP = '__top__'

/**
 * Move a Leaf page: the Folder first, then what it goes under there — Peek's Move dialog (FOL-45), as the LED-1
 * prototype draws it in Leaf. It opens on the Folder it is in, as Peek's does, and Move waits for a place to be picked:
 * a preselected destination is a move nobody chose. Its own Folder is listed for a new place inside it; another Folder's targets are read
 * when it is picked. Only real moves are listed: never the page, what is under it, or where it already is.
 */
export function MoveDialog({
  title,
  under,
  from,
  folders,
  targets: initialTargets,
  targetsIn,
  onMove,
  onClose,
}: {
  title: string
  /** "The 3 pages under it move with it.": what moves with it, in words; empty when nothing is under it. */
  under: string
  /** The Folder it is in now. */
  from: string
  /** Undefined while the sidebar is still reading them: the dialog says so rather than "nowhere". */
  folders: MoveFolder[] | undefined
  /** Where it may go in `from`, already read by the caller. */
  targets: MoveTarget[]
  /** Where it may go in another Folder. A rejection is said in the dialog, beside a Try again. */
  targetsIn: (folder: string) => Promise<MoveTarget[]>
  /** Resolves false to keep the dialog open — the caller has said why. */
  onMove: (folder: MoveFolder, parent: MoveTarget) => Promise<boolean>
  onClose: () => void
}) {
  const [pickedFolder, setFolder] = useState('')
  const [read, setRead] = useState<Record<string, MoveTarget[] | 'reading' | 'failed'>>(() => ({ [from]: initialTargets }))
  const [picked, setPicked] = useState<string | undefined>()
  const [moving, setMoving] = useState(false)
  const formId = useId()

  // The Folders read or being read, known now rather than at the next render, so two quick picks read one Folder once.
  const requested = useRef(new Set([from]))
  const readTargets = (id: string) => {
    if (requested.current.has(id)) return
    requested.current.add(id)
    setRead((current) => ({ ...current, [id]: 'reading' }))
    targetsIn(id).then(
      (targets) => setRead((current) => ({ ...current, [id]: targets })),
      () => {
        requested.current.delete(id)
        setRead((current) => ({ ...current, [id]: 'failed' }))
      },
    )
  }
  const chooseFolder = (id: string) => {
    setFolder(id)
    setPicked(undefined)
    readTargets(id)
  }

  // Until another is picked, the Folder it is in, so "Put it under" shows at once, as in Peek (Miky, LFB-7 kickoff);
  // derived rather than set at open, so Folders read after it opened (LED-8) still land on it. Move waits for a place.
  const folder = pickedFolder || (folders?.some((candidate) => candidate.id === from) ? from : '')
  const chosen = folders?.find((candidate) => candidate.id === folder)
  const folderName = chosen?.name ?? 'this folder'
  const status = folder ? read[folder] : undefined
  const targets = Array.isArray(status) ? status : []
  const valueOf = (target: MoveTarget) => target.address || TOP
  const parent = targets.find((target) => valueOf(target) === picked)
  const ready = !!chosen && !!parent
  // Nowhere to go: no other Folder takes it, and in its own it is already at the only place there is.
  const nowhere = !!folders?.every((candidate) => candidate.id === from) && initialTargets.length === 0

  async function move() {
    if (!chosen || !parent || moving) return
    setMoving(true)
    const ok = await onMove(chosen, parent)
    setMoving(false)
    if (ok) onClose()
  }

  return (
    <DialogShell
      title="Move"
      onClose={onClose}
      footer={
        <>
          <Button variant="muted" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!ready || moving}>
            {moving ? 'Moving…' : 'Move'}
          </Button>
        </>
      }
    >
      {nowhere ? (
        <EmptyState scope="section" message="There is no other folder it can be moved to." />
      ) : (
        <Form id={formId} busy={moving} onSubmit={move}>
          <div className="flex flex-col gap-2">
            <p className="text-body-2-strong text-text-primary">{title}</p>
            <p className="text-body-2 text-text-secondary">Everyone who can read it now still can.{under ? ` ${under}` : ''}</p>
          </div>
          <Field label="Folder">
            <Select
              value={folder}
              onChange={chooseFolder}
              options={(folders ?? []).map((candidate) => ({
                value: candidate.id,
                label: candidate.name,
              }))}
              placeholder={folders ? 'Pick a folder' : 'Reading…'}
              ariaLabel="Folder"
            />
          </Field>
          {folder &&
            (status === 'failed' ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-body-2 text-text-secondary">{folderName} could not be read.</p>
                <Button variant="muted" onClick={() => readTargets(folder)}>
                  Try again
                </Button>
              </div>
            ) : Array.isArray(status) && targets.length === 0 ? (
              <EmptyState scope="section" message={`There is nowhere in ${folderName} to put it.`} />
            ) : (
              <Field label="Put it under">
                <Select
                  value={picked ?? ''}
                  onChange={setPicked}
                  options={targets.map((target) => ({
                    value: valueOf(target),
                    label: target.address ? target.path.join(' › ') : `The top of ${folderName}`,
                  }))}
                  placeholder={Array.isArray(status) ? 'Pick where it goes' : 'Reading…'}
                  disabled={!Array.isArray(status)}
                  ariaLabel="Put it under"
                />
              </Field>
            ))}
        </Form>
      )}
    </DialogShell>
  )
}
