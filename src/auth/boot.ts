import {
  decideAfterRenewal,
  decideBoot,
  type BootAction,
  type BootObservation,
  type Renewal,
  type ShellReason,
  type ShellState,
} from '@estiva-app/identity'
import {
  beginSignIn,
  callbackParams,
  canRenew,
  clearQuery,
  completeSignIn,
  currentToken,
  guardAttemptedAt,
  renewInPlace,
  signInAvailable,
  startRenewal,
  stashShellReason,
  takeReturnTo,
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

  const observation: BootObservation = {
    callback: callbackParams(),
    hasValidToken: currentToken() !== null,
    canRenew: canRenew(),
    guardAttemptedAt: guardAttemptedAt(),
    enteredThisPageLoad: false,
    now: Date.now(),
  }
  return act(decideBoot(observation), observation)
}

/**
 * How long the boot waits on a renewal before entering on what it holds: a
 * network that neither answers nor fails would otherwise hold a blank page. The
 * schedule finishes the same renewal once it answers. Ship's and Peek's
 * `RENEWAL_WAIT_MS`.
 */
export const RENEWAL_WAIT_MS = 3_000

async function act(action: BootAction, observation: BootObservation): Promise<BootResult> {
  const callback = observation.callback
  switch (action.do) {
    case 'renew': {
      // An expired access token and a refresh token to spend: renew here and stay on the page asked for, with no trip
      // to Estiva ID (AUT-5, as Ship's AUT-4). A refusal asks for the passkey on this page; no answer enters.
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<Renewal>((resolve) => {
        timer = setTimeout(() => resolve({ outcome: 'unreachable' }), RENEWAL_WAIT_MS)
      })
      const outcome = await Promise.race([renewInPlace(), late]).then((r) => r.outcome)
      clearTimeout(timer)
      return act(decideAfterRenewal(outcome, observation), observation)
    }
    case 'enter':
      startRenewal()
      return { kind: 'app' }
    case 'complete_callback':
      try {
        const { returnTo } = await completeSignIn()
        clearQuery()
        // Back where sign-in began: a page's link, or New document in a Folder another app linked to.
        landOn(returnTo)
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
      /*
        A silent attempt that found no session lands on `/?error=…`, but it began on the link the person
        opened. Put that link back before the shell draws, so Continue starts from it and signing in lands
        there, and a reload does not read the old answer again (as Ship and Peek do, PEEK-123).
      */
      if (callback?.error) {
        const back = takeReturnTo()
        clearQuery()
        landOn(back)
      }
      return { kind: 'shell', state: { phase: 'authenticating', reason: takeShellReason() ?? action.reason } }
    case 'fail':
      return shell(action.reason)
  }
}

/** Be on `returnTo` if it is one of Leaf's own paths; otherwise stay put. Never throws: a signed-in person stays signed in. */
function landOn(returnTo: string | null): void {
  const back = ownPath(returnTo)
  if (!back) return
  try {
    window.history.replaceState({}, '', back)
  } catch (cause) {
    console.warn('[auth] could not return to', back, cause)
  }
}

function shell(reason: ShellReason, cause?: unknown): BootResult {
  if (cause) console.warn('[auth] entry failed:', cause)
  return { kind: 'shell', state: { phase: 'failed', reason } }
}

export async function enterFromShell(): Promise<void> {
  await beginSignIn()
}
