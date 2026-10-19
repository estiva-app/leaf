import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { Banner, Divider, EmptyState, KindIcon, Panel, SkeletonList, thingKindOf, useToast } from '@estiva-app/ui'
import { blockLinkOf, copyLink, useLinkedBlock } from '../document/blockLink'
import { InlineText, type InlineTextHandle } from '@estiva-app/ui/editor'
import { CommentsColumn, heldComments } from '../comments/CommentsColumn'
import type { Anchor } from '../comments/comments'
import { LiveDocument } from '../document/LiveDocument'
import { PageSummary } from '../document/PageSummary'
import { readSummary, saveField } from '../document/save'
import { useLiveDocument } from '../document/useLiveDocument'
import { isDocument, titleOf, typeOf } from '../folders/tree'

/**
 * One file, opened from the tree. A document is written in place. Any other file — a Peek topic as much as a
 * Ship issue — says what it is and offers "Open in <its app>", the only place
 * that app's name appears (PRO-24), with no editor.
 */
export function FilePage({ file, loading }: { file: ForeignObject | null; loading: boolean }) {
  if (!file) {
    return loading ? <SkeletonList rows={3} /> : <EmptyState scope="page" message="This could not be found, or you cannot read it." />
  }
  if (!isDocument(file)) {
    // The address comes from the app's manifest: only a web address is opened, never a script.
    const opener = file.openUrl && /^https?:\/\//i.test(file.openUrl) ? file.openUrl : undefined
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
  const title = titleOf(file)
  const body = file.slots[BODY_SLOT]
  // The file as it was opened: a save made on the way out must not reach for state that is gone.
  const target = useRef(file)
  const summaryEditor = useRef<InlineTextHandle>(null)
  const commitText = useCallback(async (value: string, contentFormat?: string) => (await saveField(target.current, 'description', value, contentFormat)).ok, [])
  // The title now, for a toast after the page is gone.
  const named = useRef(title)
  useEffect(() => {
    named.current = title
  }, [title])
  const leftUnsaved = useCallback(() => showToast({ label: `Your last changes to ${named.current} were not saved.`, type: 'error' }), [showToast])
  async function rename(value: string): Promise<boolean> {
    const next = value.trim()
    if (!next || next === title) return true
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
  function copyBlockLink(block: string) {
    const link = blockLinkOf(file, block)
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
                <InlineText variant="title" className="text-h1" value={title} placeholder="Untitled" label="Title" onCommit={rename} onEnter={() => summaryEditor.current?.focus('start')} />
              </h1>
              {/* Drawn afresh once the whole of a cut summary is in, so the editor's saved text is the whole one. */}
              <PageSummary key={wholeNow === null ? 'slot' : 'whole'} ref={summaryEditor} value={summary} onCommit={summarize} onEnter={toText} readOnly={cut && wholeNow === null} />
            </div>
            <LiveDocument
              value={body?.value ?? ''}
              holdKey={opened.address ? `document:${opened.address}` : undefined}
              format={body?.format ?? 'marker'}
              changedBy={changedBy}
              onCommit={commitText}
              onLeftUnsaved={leftUnsaved}
              onEditor={setEditor}
              onCommentOn={addressable ? setDraft : undefined}
              onCopyLink={addressable ? copyBlockLink : undefined}
            />
          </div>
        </Panel>
      </div>
      <Divider orientation="vertical" />
      <div className="flex w-96 flex-none flex-col">
        <CommentsColumn doc={{ address: file.address, folder: file.folder }} addressable={addressable} editor={editor} docBody={docBody} draft={draft} onDraft={setDraft} />
      </div>
    </div>
  )
}
