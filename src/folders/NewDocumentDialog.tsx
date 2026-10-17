import type { FolderSummary } from '@estiva-app/interop'
import { Button, DialogShell, EmptyState, Field, Form, Select, Textarea, TextInput } from '@estiva-app/ui'
import { useId, useState } from 'react'
import { SummaryCount } from '../document/SummaryCount'
import { SUMMARY_LIMIT, summaryLength, summaryText } from '../document/summary'

/**
 * New document: a title, an optional summary and the Folder it goes in, as Peek's New topic asks.
 * Only Folders that take a new document are offered (`takesNewDocuments`).
 * Everyone in the chosen Folder can read it.
 */
export function NewDocumentDialog({
  folders,
  defaultFolder,
  onCreate,
  onClose,
}: {
  /** The Folders a document can go in. */
  folders: FolderSummary[]
  /** Which one starts chosen: the Folder of the file open in the tree, when there is one. */
  defaultFolder?: string
  /** Resolves `true` when the dialog should close. `summary` is on one line, '' for none. */
  onCreate: (title: string, folder: string, summary: string) => Promise<boolean>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const long = summaryLength(summary) > SUMMARY_LIMIT
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
    const done = await onCreate(trimmed, folder, summaryText(summary))
    setCreating(false)
    if (done) onClose()
  }

  return (
    <DialogShell
      title="New document"
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
        <EmptyState scope="section" message="There is no Folder to put a document in yet." />
      ) : (
        <Form id={formId} busy={creating} onSubmit={create}>
          <p className="text-body-2 text-text-secondary">{`Everyone in ${where?.name ?? 'the Folder'} can read it.`}</p>
          <Field label="Title">
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What is it about?" aria-label="Document title" autoFocus />
          </Field>
          {/* Optional, as the short-summary story's SummaryField draws it: the helper until the text runs past 240, then the count and a taller box. */}
          <Field label="Summary" helper={long ? undefined : 'One or two sentences. It shows under the title, in lists and on cards.'}>
            <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What is it for, in a sentence?" aria-label="Summary" className={long ? 'h-20' : 'h-16'} />
            <SummaryCount text={summary} />
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
