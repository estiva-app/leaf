import { decideBoot, type ShellReason, type ShellState } from '@estiva-app/identity'
import {
  beginSignIn,
  callbackParams,
  clearQuery,
  completeSignIn,
  currentToken,
  guardAttemptedAt,
  signInAvailable,
  startRenewal,
  stashShellReason,
  takeShellReason,
} from './estivaId'
import { ownPath } from '../route'

export type BootResult = { kind: 'app' } | { kind: 'shell'; state: ShellState } | { kind: 'leaving' }

/**
 * Settle who this load belongs to, before the app renders. The decision is
 * `decideBoot` from `@estiva-app/identity`; this is the reading and acting
 * around it. It never throws: a blank page is worse than an honest shell.
 */
export async function bootAuth(): Promise<BootResult> {
  if (!signInAvailable) return { kind: 'app' }

  const action = decideBoot({
    callback: callbackParams(),
    hasValidToken: currentToken() !== null,
    guardAttemptedAt: guardAttemptedAt(),
    enteredThisPageLoad: false,
    now: Date.now(),
  })

  switch (action.do) {
    case 'enter':
      startRenewal()
      return { kind: 'app' }
    case 'complete_callback':
      try {
        const { returnTo } = await completeSignIn()
        clearQuery()
        // Back where sign-in began: a page's link, or New document in a Folder another app linked to.
        const back = ownPath(returnTo)
        if (back) window.history.replaceState({}, '', back)
        startRenewal()
        return { kind: 'app' }
      } catch (cause) {
        clearQuery()
        stashShellReason('exchange_failed')
        return shell('exchange_failed', cause)
      }
    case 'probe_silently':
      try {
        await beginSignIn({ silent: true })
        return { kind: 'leaving' }
      } catch {
        return shell('network')
      }
    case 'prompt_passkey':
      return { kind: 'shell', state: { phase: 'authenticating', reason: takeShellReason() ?? action.reason } }
    case 'fail':
      return shell(action.reason)
  }
}

function shell(reason: ShellReason, cause?: unknown): BootResult {
  if (cause) console.warn('[auth] entry failed:', cause)
  return { kind: 'shell', state: { phase: 'failed', reason } }
}

export async function enterFromShell(): Promise<void> {
  await beginSignIn()
}
