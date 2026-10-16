import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { Divider, EditableText, EmptyState, KindIcon, Panel, SkeletonList, thingKindOf, useToast } from '@estiva-app/ui'
import { CommentsColumn } from '../comments/CommentsColumn'
import { LiveDocument } from '../document/LiveDocument'
import { saveField } from '../document/save'
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
  // The comments column (LEAF-5): it draws in the editor, and a block's handle starts a comment in it.
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const docBody = useRef<HTMLDivElement | null>(null)
  // A block is found only in a block document (SPEC §13.6); an empty page becomes one with its first save.
  const addressable = !body?.value || body.format === 'blocks'
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel title={title} bodyRef={docBody} bodyClassName="px-12 pt-10 pb-24">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {/* The page's heading, as Katerina's prototype draws it. */}
            <h1 className="text-h1 text-text-primary">
              <EditableText value={title} placeholder="Untitled" label="Title" onCommit={rename} className="-mx-2" />
            </h1>
            <LiveDocument
              value={body?.value ?? ''}
              format={body?.format ?? 'marker'}
              changedBy={changedBy}
              onCommit={commitText}
              onLeftUnsaved={leftUnsaved}
              onEditor={setEditor}
              onCommentOn={addressable ? setDraft : undefined}
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
