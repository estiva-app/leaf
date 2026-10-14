import type { FolderSummary } from '@estiva-app/interop'
import { Button, DialogShell, EmptyState, Field, Form, Select, TextInput } from '@estiva-app/ui'
import { useId, useState } from 'react'

/**
 * New page: a title and the Folder it goes in, as Peek's New topic asks. Only
 * Folders that take a new page are offered (`takesNewPages`). Everyone in the
 * chosen Folder can read the page.
 */
export function NewPageDialog({
  folders,
  defaultFolder,
  onCreate,
  onClose,
}: {
  /** The Folders a page can go in. */
  folders: FolderSummary[]
  /** Which one starts chosen: the Folder of the file open in the tree, when there is one. */
  defaultFolder?: string
  /** Resolves `true` when the dialog should close. */
  onCreate: (title: string, folder: string) => Promise<boolean>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState(() =>
    defaultFolder && folders.some((f) => f.id === defaultFolder) ? defaultFolder : (folders[0]?.id ?? ''),
  )
  const [creating, setCreating] = useState(false)
  const formId = useId()
  const trimmed = title.trim()
  const ready = !!trimmed && !!folder
  const where = folders.find((f) => f.id === folder)

  async function create() {
    if (!ready || creating) return
    setCreating(true)
    const done = await onCreate(trimmed, folder)
    setCreating(false)
    if (done) onClose()
  }

  return (
    <DialogShell
      title="New page"
      onClose={onClose}
      footer={
        <>
          <Button variant="muted" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!ready || creating}>
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      {folders.length === 0 ? (
        <EmptyState scope="section" message="There is no Folder to put a page in yet." />
      ) : (
        <Form id={formId} busy={creating} onSubmit={create}>
          <p className="text-body-2 text-text-secondary">{`Everyone in ${where?.name ?? 'the Folder'} can read it.`}</p>
          <Field label="Title">
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What is it about?" aria-label="Page title" autoFocus />
          </Field>
          <Field label="Folder">
            <Select
              value={folder}
              onChange={setFolder}
              ariaLabel="Folder"
              options={folders.map((f) => ({ value: f.id, label: f.name ?? f.id }))}
            />
          </Field>
        </Form>
      )}
    </DialogShell>
  )
}
