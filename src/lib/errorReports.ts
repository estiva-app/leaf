/**
 * Leaf's crash reports (PROD-4): when a part of Leaf breaks, a short report
 * goes to Estiva ID, signed in, and on to Sentry. It says where the code broke
 * and the screens before it, never what anyone wrote: the report is built from
 * a fixed list by `@estiva-app/platform`'s reporter, and Estiva ID rebuilds it
 * from the same list (record error-reports-go-to-hosted-sentry-built-from-an-allowed-list).
 *
 * Reported: an error nobody handled and a promise nobody caught (the window's
 * own events), and every crash an `ErrorBoundary` catches.
 */
import { useEffect, useLayoutEffect, useState } from 'react'
import { createErrorReporter, type Failure } from '@estiva-app/platform'
import { reportCrashesTo, reportFailuresTo } from '@estiva-app/ui'
import { reportDrawnFailuresTo, reportRefusalsTo } from '@/lib/failureReports'
import { heardFailures } from '@/lib/heardFailures'
import { ID_CONFIG } from '@/config'
import { currentToken } from '@/auth/estivaId'
import { routeOf, usePathname, type Route } from '@/route'

/**
 * Leaf's screens are its router's page names (`document`, `home`), never an
 * address: a document's address holds its title (`/document/<slug>-<d>`).
 * Estiva ID keeps the same list and sends anything else as `<unknown>`; a new
 * page is added in both.
 */
export const SCREENS = ['document', 'file', 'home', 'path', 'topic', 'topics'] as const satisfies readonly Route['page'][]

/** The page an address is drawn by, never the address itself. */
export function screenOf(pathname: string): string {
  try {
    return routeOf(pathname).page
  } catch {
    return '<unknown>'
  }
}

export const errorReporter = createErrorReporter({
  endpoint: `${ID_CONFIG?.base ?? ''}/report`,
  // The commit this bundle was built from (vite.config.ts), so Sentry tells versions apart.
  release: String(import.meta.env.VITE_LEAF_RELEASE ?? 'unknown'),
  origin: window.location.origin,
  // Signed out, or a build without sign-in: nothing is sent.
  token: () => (ID_CONFIG ? currentToken()?.accessToken : undefined),
  screen: () => screenOf(window.location.pathname),
  screens: SCREENS,
  // Why: what Leaf's reads last heard (34396209), so each reason a page fails to load is its own error.
  reason: heardFailures.recent,
})

/** Starts reporting: the window's unhandled errors, and every ErrorBoundary's crash. */
export function startErrorReports(): void {
  errorReporter.listen(window)
  reportCrashesTo((error) => errorReporter.report(error, 'boundary'))
  // A failure Leaf shows (every error toast, a warning that names what failed) and a write the relay refuses (PROD-5).
  reportFailuresTo((failure) => errorReporter.failure((failure ?? 'unnamed') as Failure))
  reportRefusalsTo((code) => errorReporter.refused(code))
  reportDrawnFailuresTo((failure) => errorReporter.failure(failure))
  window.__crashOnPurpose = crashOnPurpose
}

declare global {
  interface Window {
    /** A crash in Leaf's own code, to check a report end to end on production. See {@link crashOnPurpose}. */
    __crashOnPurpose?: typeof crashOnPurpose
  }
}

let crashWith: ((text: string) => void) | undefined

/**
 * `window.__crashOnPurpose(text, how)`: Leaf reads `text` as JSON and fails,
 * so a report can be checked end to end as QA-1 (PROD-4). `'render'` (the
 * default) fails inside the page, which shows "Something went wrong … try
 * again" in its place; `'unhandled'` fails in a timer, which nothing catches,
 * and can be repeated.
 *
 * Its crashes are told apart from real ones as a JSON `SyntaxError` breaking
 * in this file, where nothing else parses JSON. The sweep and the process
 * review leave those out of the errors people hit (PROD-3), so keep the
 * failing parse here and no other parse in this file.
 */
function crashOnPurpose(text: string, how: 'render' | 'unhandled' = 'render'): void {
  if (how === 'unhandled') setTimeout(() => JSON.parse(text))
  else crashWith?.(text)
}

/**
 * The part of the page `crashOnPurpose` fails inside; nothing on screen until
 * then. Drawn inside the page's ErrorBoundary, so Try again draws it afresh,
 * without the text.
 */
export function CrashOnPurpose(): null {
  const [text, setText] = useState<string>()
  useEffect(() => {
    crashWith = setText
    return () => {
      crashWith = undefined
    }
  }, [])
  if (text !== undefined) JSON.parse(text)
  return null
}

/**
 * Records each page opened, for the steps a report shows before its error.
 * A layout effect, drawn before the page: a boundary hands its crash over in
 * the same commit, after this, so a page that crashes as it opens is still in
 * the trail.
 */
export function ScreenSteps(): null {
  const page = screenOf(usePathname())
  useLayoutEffect(() => {
    errorReporter.step({ screen: page })
  }, [page])
  return null
}
