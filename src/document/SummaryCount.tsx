import { FieldLine } from '@estiva-app/ui'
import { SUMMARY_LIMIT, summaryLength } from './summary'

/** The count a summary past about 240 characters shows under it: a warning, never a refusal. */
export function SummaryCount({ text }: { text: string }) {
  const length = summaryLength(text)
  if (length <= SUMMARY_LIMIT) return null
  return (
    <FieldLine tone="warning">
      {length} characters. A summary reads best in one or two sentences, under {SUMMARY_LIMIT}.
    </FieldLine>
  )
}
