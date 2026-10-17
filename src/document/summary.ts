/**
 * A page's summary as text (SPEC §6.12): plain, on one line, with no limit on
 * the wire. Shared by what writes one (New document's seed, the page's line)
 * and what counts one, so a summary is the same text wherever it goes. Ship's
 * and Peek's `summary.ts` say the same.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-summary-is-its-own-field.md
 */

/** Where a summary is kept to: about 240 characters (Miky, 14 Oct). Past it a count appears and nothing is refused (Miky, 15 Oct). */
export const SUMMARY_LIMIT = 240

/** A summary on one line: every run of spaces and line breaks is one space, and none at either end. Blank is ''. */
export function summaryText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** How many characters a summary is, as a person counts them: what would be saved, letter by letter. */
export function summaryLength(text: string): number {
  return Array.from(summaryText(text)).length
}
