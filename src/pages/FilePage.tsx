import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { BODY_SLOT, isArchived, type ForeignObject } from '@estiva-app/interop'
import { Banner, Divider, EmptyState, FieldLine, KindIcon, Panel, SkeletonList, thingKindOf, useToast } from '@estiva-app/ui'
import { blockLinkOf, copyLink, useLinkedBlock } from '../document/blockLink'
import { InlineText, type InlineTextHandle } from '@estiva-app/ui/editor'
import { CommentsColumn, heldComments } from '../comments/CommentsColumn'
import type { Anchor } from '../comments/comments'
import { LiveDocument } from '../document/LiveDocument'
import { PageSummary } from '../document/PageSummary'
import { archivedAbove, readSummary, saveField, saveText } from '../document/save'
import { archivedLine, type FileText } from '@estiva-app/conversation'
import { knownName } from '../comments/people'
import { useLiveDocument } from '../document/useLiveDocument'
import { writableFields, sharesText } from '../document/writable'
import { isDocument, titleOf, typeOf } from '../folders/tree'
import { OwnerRow, openerOf } from './OwnerRow'
import { useFileByAddress } from './useFileByAddress'
import { useOwnerBlockLinker } from './usePathAddress'

/**
 * One file, opened from the tree or by its address. A document is written in place, and so is any file whose own
 * app shares its text — a Ship project or issue — with that app's row under its title. Any other file, such as a
 * Peek topic, says what it is and offers "Open in <its app>", the only place that app's name appears (PRO-24), with
 * no editor.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-card-changes-what-a-files-app-shares.md
 */
export function FilePage({ file: listed, loading }: { file: ForeignObject | null; loading: boolean }) {
  // A project's issues come from its row's read, which carries no actions: such a file is read on its own before it
  // is taken for one Leaf cannot write.
  const recheck = listed && !listed.unreachable && listed.naddr && !sharesText(listed) ? listed.naddr : null
  const reread = useFileByAddress(recheck)
  const file = reread.file && !reread.file.unreachable ? reread.file : listed
  if (!file || file.unreachable) {
    return loading ? <SkeletonList rows={3} /> : <EmptyState scope="page" message="This could not be found, or you cannot read it." />
  }
  if (!sharesText(file)) {
    if (reread.loading) return <SkeletonList rows={3} />
    const opener = openerOf(file)
    return (
      <EmptyState
        scope="page"
        icon={<KindIcon kind={thingKindOf(file.kind)} />}
        message={`${typeOf(file)}: ${titleOf(file)}`}
        action={opener && file.appName ? { label: `Open in ${file.appName}`, onClick: () => window.open(opener, '_blank', 'noopener') } : undefined}
      />
    )
  }
  return <DocumentView key={file.address ?? file.ref} opened={file} />
}

/**
 * A document, written in place: its title at the top and its text below,
 * each saved when you leave it, and someone else's save drawn as it arrives
 * (LEAF-3). Keyed by the document, so opening another one starts afresh and
 * the one you left saves on the way out.
 */
function DocumentView({ opened }: { opened: ForeignObject }) {
  const { file, changedBy } = useLiveDocument(opened)
  const { showToast } = useToast()
  const own = isDocument(file)
  const writes = writableFields(file)
  // Any file archived, itself or with the closest archived file above it at any depth (interop's walk, PEEKM-2), Leaf's
  // own pages included: its fields and its comments wait for it to be unarchived (SPEC §6.5), and Leaf has no Unarchive.
  const locked = isArchived(file)
  const { field: fieldLine, comment: commentLine } = useArchivedLines(file, own)
  const title = titleOf(file)
  const body = file.slots[BODY_SLOT]
  // The file as it was opened: a save made on the way out must not reach for state that is gone.
  const target = useRef(file)
  const summaryEditor = useRef<InlineTextHandle>(null)
  // The text, and an Add for each person it names anew; someone who could not be added is told, and tried again on the next save.
  const unadded = useRef<string[]>([])
  const commitText = useCallback(
    async (saved: FileText & { content: string }, editedFrom: FileText) => {
      const result = await saveText(target.current, saved, editedFrom, unadded.current)
      if (!result.ok) return false
      unadded.current = result.refused
      if (result.refused.length > 0) {
        const names = result.refused.map((pubkey) => knownName(pubkey) ?? 'someone').join(', ')
        showToast({ label: `Could not add ${names}. Leaf tries again when you next save.`, type: 'error' })
      }
      return true
    },
    [showToast],
  )
  // The title now, for a toast after the page is gone.
  const named = useRef(title)
  useEffect(() => {
    named.current = title
  }, [title])
  const leftUnsaved = useCallback(() => showToast({ label: `Your last changes to ${named.current} were not saved.`, type: 'error' }), [showToast])
  async function rename(value: string): Promise<boolean> {
    const next = value.trim()
    if (!next || next === title) return true
    // Archived while it was being typed: read-only now, nothing is written, and it says so (PEEKM-8).
    if (locked) {
      showToast({ label: `Not renamed. ${fieldLine ?? 'It was archived.'}`, type: 'error' })
      return false
    }
    const result = await saveField(target.current, 'title', next)
    if (!result.ok) showToast({ label: 'Could not rename it. Try again.', type: 'error' })
    return result.ok
  }
  // The summary: the folded `summary` field, which interop draws as `subtitle` (SPEC §6.12, §7.2). A slot cut at
  // 280 with an "…" is read whole before it can be edited, so a save never writes the cut text back.
  const slot = file.slots.subtitle?.value ?? ''
  const cut = slot.endsWith('…')
  // Read again with every read of the page (each is a new `file`), so a change past the cut — yours or someone
  // else's — is what the line shows; a read that fails is tried again a few times, 3 s apart.
  const [whole, setWhole] = useState<string | null>(null)
  useEffect(() => {
    if (!cut) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = (left: number) => {
      void readSummary(target.current).then((value) => {
        if (!live) return
        if (value !== null) setWhole(value)
        else if (left > 0) timer = setTimeout(() => read(left - 1), 3000)
      })
    }
    read(3)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [cut, file])
  // The last whole read stays up while the next one runs: the line is never cut, and never drawn afresh under your caret.
  const wholeNow = cut ? whole : null
  const summary = wholeNow ?? slot
  async function summarize(value: string): Promise<true | string> {
    if (locked) return fieldLine ?? 'It was archived.'
    const result = await saveField(target.current, 'summary', value)
    return result.ok ? true : result.reason
  }
  // The comments column (LEAF-5): it draws in the editor, and a block's handle starts a comment in it.
  const [editor, setEditor] = useState<Editor | null>(null)
  // Enter in the summary goes on into the text, on its first line: 'start' can be a selection, which opens the
  // format toolbar over the whole page when it is empty (Ship's HeaderEditing, ship#307).
  function toText() {
    if (!editor) return
    editor.commands.focus('start')
    if (editor.state.selection.empty) return
    const caret = TextSelection.findFrom(editor.state.doc.resolve(0), 1, true)
    if (caret) editor.view.dispatch(editor.state.tr.setSelection(caret))
  }
  // A comment being written on words or blocks when the sign-in ended is back on them after the tap (AUT-5).
  const [draft, setDraft] = useState<Anchor | null>(() => heldComments(opened.address)?.draft ?? null)
  const docBody = useRef<HTMLDivElement | null>(null)
  // A block is found only in a block document (SPEC §13.6); an empty page becomes one with its first save.
  const addressable = !body?.value || body.format === 'blocks'
  // Another app's file: Leaf's address for its block, from the block shape its own app declares (LTX-6); none for an app that declares none.
  const ownerBlockLink = useOwnerBlockLinker(own ? null : file)
  const linksBlocks = own || !!ownerBlockLink
  function copyBlockLink(block: string) {
    const link = own ? blockLinkOf(file, block) : ownerBlockLink?.(block, file.slots.title?.value)
    if (link) void copyLink(link, (label) => showToast({ label }))
  }
  // Opened at `#block-<id>`: scrolled to it, or told it is gone (Ship's issue page says the same).
  const [missing, dismissMissing] = useLinkedBlock(body?.value ?? '', body?.format ?? 'marker')
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel title={title} bodyRef={docBody} bodyClassName="px-12 pt-10 pb-24">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {missing && (
              <Banner tone="info" onDismiss={dismissMissing}>
                {missing === 'detached' ? 'That part of the page was removed.' : 'That link is to a part of the page, which is no longer written in parts.'}
              </Banner>
            )}
            {/* The page's heading, as Katerina's prototype draws it, and its summary 4px under it (the short-summary story's LeafFilePage). */}
            <div className="flex flex-col gap-1">
              <h1 className="text-h1 text-text-primary">
                {/* In place, as Ship's title (ui InlineText, ship#306), at Leaf's own heading size; Enter goes on into the summary. */}
                <InlineText
                  variant="title"
                  className="text-h1"
                  value={title}
                  placeholder="Untitled"
                  label="Title"
                  readOnly={locked || !writes.has('title')}
                  onCommit={rename}
                  onEnter={() => summaryEditor.current?.focus('start')}
                />
              </h1>
              {/* Drawn afresh once the whole of a cut summary is in, so the editor's saved text is the whole one. */}
              <PageSummary
                key={wholeNow === null ? 'slot' : 'whole'}
                ref={summaryEditor}
                value={summary}
                onCommit={summarize}
                onEnter={toText}
                readOnly={locked || !writes.has('summary') || (cut && wholeNow === null)}
              />
            </div>
            {!own && <OwnerRow file={file} />}
            {fieldLine && <FieldLine tone="helper">{fieldLine}</FieldLine>}
            <LiveDocument
              readOnly={locked}
              value={body?.value ?? ''}
              holdKey={opened.address ? `document:${opened.address}` : undefined}
              format={body?.format ?? 'marker'}
              changedBy={changedBy}
              onCommit={commitText}
              onLeftUnsaved={leftUnsaved}
              onEditor={setEditor}
              onCommentOn={addressable && !locked ? setDraft : undefined}
              onCopyLink={addressable && linksBlocks ? copyBlockLink : undefined}
            />
          </div>
        </Panel>
      </div>
      <Divider orientation="vertical" />
      <div className="flex w-96 flex-none flex-col">
        <CommentsColumn
          doc={{ address: file.address, folder: file.folder }}
          addressable={addressable}
          editor={editor}
          docBody={docBody}
          draft={locked ? null : draft}
          onDraft={setDraft}
          closed={locked ? (commentLine ?? '') : undefined}
        />
      </div>
    </div>
  )
}

/**
 * The two lines on an archived file (PEEKM-8). In the comment box's place, the words every app shows ("Archived.
 * Unarchive it to comment.", "Unarchive the project to comment."), and "in Peek" on a Leaf page archived itself, since
 * Leaf has no Unarchive. Over its locked text, the file to unarchive and where: "Unarchive the project in Estiva Ship
 * to edit." The closest archived file above is named once its manifest is read; until then no line, never "the parent".
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md
 */
function useArchivedLines(file: ForeignObject, own: boolean): { field?: string; comment?: string } {
  const archive = file.archived
  const withAddress = archive?.with
  const [above, setAbove] = useState<{ of: string; noun?: string; app?: string } | null>(null)
  useEffect(() => {
    if (!withAddress) return
    let live = true
    void archivedAbove(withAddress).then((found) => {
      if (live) setAbove({ of: withAddress, ...found })
    })
    return () => {
      live = false
    }
  }, [withAddress])
  if (!archive) return {}
  if (!withAddress) {
    const where = own ? 'Peek' : (file.appName ?? 'its app')
    return { field: archivedLine(archive, undefined, { in: where, to: 'edit' }), comment: archivedLine(archive, undefined, own ? { in: 'Peek' } : {}) }
  }
  if (above?.of !== withAddress) return {}
  return { field: archivedLine(archive, above.noun, { in: above.app, to: 'edit' }), comment: archivedLine(archive, above.noun) }
}
