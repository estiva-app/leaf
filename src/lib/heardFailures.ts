/**
 * Why Leaf's requests last failed, for a failure a screen draws a moment later holding only "it failed" (34396209):
 * the bridge says what each failed read threw, and the error reporter puts the latest reason on a failure report, so
 * Sentry files "the relay said wait" apart from "the sign-in had ended". 23 Nov: nine "Could not load" reports after
 * the per-minute fixes sat in one error, and none was the limit.
 *
 * Kept apart from `errorReports`, which reads the window as it loads: `relay/bridge.ts` and a test use this freely.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/error-reports-go-to-hosted-sentry-built-from-an-allowed-list.md
 */
import { createHeardFailures, failureReasonOf } from '@estiva-app/platform'

export const heardFailures = createHeardFailures()

/** A read or a signature that failed, by what it threw: its name, status and the relay's prefix. Never throws. */
export function heardFailure(error: unknown): void {
  try {
    heardFailures.heard(failureReasonOf(error))
  } catch {
    /* what the request said stands */
  }
}
