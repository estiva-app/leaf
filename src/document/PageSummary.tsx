import { useRef, useState } from 'react'
import { FieldLine } from '@estiva-app/ui'
import { InlineText } from '@estiva-app/ui/editor'
import { SummaryCount } from './SummaryCount'
import { summaryText } from './summary'

/**
 * A page's summary under its title, edited where it stands, as in a document: with a count past about 240 and a refused save said under it.
 *
 * - **Editing feels like a document, not a form** (Miky, 16 October, on
 *   Ship's): the package's `InlineText`, as Ship's issue page has it. Click
 *   anywhere in it and type; Enter saves and goes on into the text; Escape or
 *   leaving saves too. Empty, it says "Add a summary", quietly, and clearing
 *   it removes the summary.
 * - **Past about 240 characters** a count appears under it; nothing is
 *   refused (Miky, 15 Oct).
 * - **A save the relay refuses**: the page keeps the summary the relay holds,
 *   and your text stays where you wrote it with the reason under it, until you
 *   change it or save it.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-refused-action-is-undone-and-your-text-comes-back.md
 *
 * Plain text on one line (SPEC §6.12): pasted line breaks are saved as spaces.
 */
export function PageSummary({
  value,
  onCommit,
  onEnter,
}: {
  /** The summary the relay holds; empty when there is none. */
  value: string
  /** Save it: `true`, or the words for why it was not saved. Empty text clears it. */
  onCommit: (value: string) => Promise<true | string>
  /** Enter, after the save has started: the caret goes into the page's text. */
  onEnter?: () => void
}) {
  // The text being written, for the count; null when you are not in it.
  const [typing, setTyping] = useState<string | null>(null)
  const [refused, setRefused] = useState<string>()
  // The text the reason is about: the reason stays until that text changes.
  const attempted = useRef<string | null>(null)
  // What the field holds now, as last typed: a refusal that answers older text says nothing.
  const written = useRef<string | null>(null)

  const commit = async (next: string) => {
    const text = summaryText(next)
    attempted.current = text
    written.current = text
    // Never compared with `value`: it lags a save just made, so changing straight back would never be
    // written. InlineText already skips an unchanged text.
    const result = await onCommit(text)
    if (result === true) {
      setRefused(undefined)
      return true
    }
    // You changed it while the relay was answering: the reason is about text no longer there.
    if (written.current !== text) return false
    setRefused(result || 'The relay gave no reason.')
    return false
  }

  return (
    <div className="flex flex-col gap-1">
      <InlineText
        variant="summary"
        clearable
        label="Summary"
        placeholder="Add a summary"
        value={value}
        onCommit={commit}
        onEnter={onEnter}
        onText={(text) => {
          // Changing the refused text is a new attempt: the old reason goes.
          if (text !== null) written.current = summaryText(text)
          if (text !== null && summaryText(text) !== attempted.current) setRefused(undefined)
          setTyping(text)
        }}
      />
      {typing !== null && <SummaryCount text={typing} />}
      {refused && <FieldLine tone="error">Summary not saved. {refused}</FieldLine>}
    </div>
  )
}
