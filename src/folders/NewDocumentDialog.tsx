import type { FolderSummary } from '@estiva-app/interop'
import { Button, DialogShell, EmptyState, Field, Form, Select, Textarea, TextInput } from '@estiva-app/ui'
import { useId, useState } from 'react'
import { heldFields, releaseHeld, useHeldTyping } from '../auth/heldTyping'
import { SummaryCount } from '../document/SummaryCount'
import { SUMMARY_LIMIT, summaryLength, summaryText } from '../document/summary'

/** The page a new document is made under: its address and `ref`, its own Folder, its title, the Folder listing it (LFB-8). */
export interface NewDocumentUnder {
  address: string
  ref: string
  folder: string
  title: string
  listedIn: string
}

/** The page a held New document was open under, if its fields are all there: held text is read back from storage. */
export function heldUnder(key: string): NewDocumentUnder | undefined {
  const under: unknown = heldFields<{ under: unknown }>(key)?.under
  if (!under || typeof under !== 'object') return undefined
  const fields = under as Record<keyof NewDocumentUnder, unknown>
  const named = (['address', 'ref', 'folder', 'title', 'listedIn'] as const).every((k) => typeof fields[k] === 'string' && fields[k] !== '')
  return named ? (under as NewDocumentUnder) : undefined
}

/**
 * New document: a title, an optional summary and the Folder it goes in, as Peek's New topic asks.
 * Only Folders that take a new document are offered (`takesNewDocuments`).
 * Everyone in the chosen Folder can read it. Opened from a page's "New document inside" (`under`), it goes under
 * that page, in the Folder listing it, with no Folder to pick, and the page's readers read it — as Peek's
 * "Start a topic under …" (Miky, LFB-8 kickoff).
 */
export function NewDocumentDialog({
  folders,
  defaultFolder,
  under,
  onCreate,
  onClose,
  holdKey,
}: {
  /** Where its unsaved fields are held when the sign-in ends while it is open (AUT-5); the app reopens it from there. */
  holdKey?: string
  /** The Folders a document can go in. */
  folders: FolderSummary[]
  /** Which one starts chosen: the Folder of the file open in the tree, when there is one. Under a page, the Folder listing it. */
  defaultFolder?: string
  /** The page it is made under, held with the fields so the app reopens it there after a passkey trip. */
  under?: NewDocumentUnder
  /** Resolves `true` when the dialog should close. `summary` is on one line, '' for none. */
  onCreate: (title: string, folder: string, summary: string) => Promise<boolean>
  onClose: () => void
}) {
  // What was typed here when the sign-in last ended, back after the passkey tap (AUT-5).
  const [held] = useState(() => heldFields<{ title: string; summary: string; folder: string }>(holdKey))
  const [title, setTitle] = useState(held?.title ?? '')
  const [summary, setSummary] = useState(held?.summary ?? '')
  const long = summaryLength(summary) > SUMMARY_LIMIT
  const [folder, setFolder] = useState(() => {
    // Under a page, the Folder listing it and no other: anywhere else the new page would not draw beneath it.
    if (under) return under.listedIn
    const first = held?.folder ?? defaultFolder
    return first && folders.some((f) => f.id === first) ? first : (folders[0]?.id ?? '')
  })
  useHeldTyping(holdKey, () => (title.trim() || summary.trim() ? JSON.stringify({ title, summary, folder, under }) : undefined))
  const close = () => {
    if (holdKey) releaseHeld(holdKey)
    onClose()
  }
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
    if (done) close()
  }

  return (
    <DialogShell
      title={under ? `New document under ${under.title}` : 'New document'}
      onClose={close}
      footer={
        <>
          <Button variant="muted" onClick={close}>
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
          <p className="text-body-2 text-text-secondary">
            {under ? `Everyone who can read ${under.title} can read it.` : `Everyone in ${where?.name ?? 'the Folder'} can read it.`}
          </p>
          <Field label="Title">
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What is it about?" aria-label="Document title" autoFocus />
          </Field>
          {/* Optional, as the short-summary story's SummaryField draws it: the helper until the text runs past 240, then the count and a taller box. */}
          <Field label="Summary" helper={long ? undefined : 'One or two sentences. It shows under the title, in lists and on cards.'}>
            <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What is it for, in a sentence?" aria-label="Summary" className={long ? 'h-20' : 'h-16'} />
            <SummaryCount text={summary} />
          </Field>
          {!under && (
            <Field label="Folder">
              <Select
                value={folder}
                onChange={setFolder}
                ariaLabel="Folder"
                options={folders.map((f) => ({ value: f.id, label: f.name ?? f.id }))}
              />
            </Field>
          )}
        </Form>
      )}
    </DialogShell>
  )
}
