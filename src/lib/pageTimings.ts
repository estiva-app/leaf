/**
 * Leaf's page-open timings: how long a person waited for a page to open goes
 * to Estiva ID, signed in, and on to Sentry, beside the crash reports. Built
 * from a fixed list by `@estiva-app/platform`'s timer: the kind of screen (the
 * same page names crash reports use), how it was opened, the wait. Never the
 * address, a title or which page it was. A new tab that passes through Estiva
 * ID to sign in is timed from its first page (Miky, 19 Nov).
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/page-open-timings-go-to-sentry-named-by-the-person-built-from-an-allowed-list.md
 */
import { browserPage, createPageTimer } from '@estiva-app/platform'
import { currentToken, onLeavingForSignIn } from '@/auth/estivaId'
import { ID_CONFIG } from '@/config'
import { onOpen } from '@/route'
import { SCREENS, screenOf } from './errorReports'

export const pageTimer = createPageTimer({
  endpoint: `${ID_CONFIG?.base ?? ''}/timing`,
  // The commit this bundle was built from (vite.config.ts), as crash reports say it.
  release: String(import.meta.env.VITE_LEAF_RELEASE ?? 'unknown'),
  // Signed out, or a build without sign-in: nothing is sent.
  token: () => (ID_CONFIG ? currentToken()?.accessToken : undefined),
  screen: () => screenOf(window.location.pathname),
  screens: SCREENS,
  page: browserPage(window),
})

/** Times this page load, then every page opened in place: a link, back or forward. Returns the way to stop. */
export function startPageTimings(): () => void {
  pageTimer.loaded()
  const offOpen = onOpen(() => pageTimer.opened())
  const offLeaving = onLeavingForSignIn(() => pageTimer.leaving())
  return () => {
    offOpen()
    offLeaving()
    pageTimer.stop()
  }
}
