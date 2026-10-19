/**
 * The app, or the passkey screen once the sign-in ends (AUT-4 in Ship, AUT-5 here).
 *
 * Instead of the page, not over it, as Peek's `AuthGate`: a signed-out page left
 * mounted under the screen stays reachable by keyboard, copy, print and any
 * dialog it had open, and the copy of what was read must go at sign-out
 * (why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/peek-keeps-a-plain-copy-on-the-device-until-sign-out.md).
 * The route stays in the address bar, which is where Continue sends the person
 * back to, and what they were typing is held on the device as the page
 * unmounts ({@link holdTyping}). The ending comes from {@link sessionEnded}: a
 * renewal Estiva ID refused, or another tab signing out.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { AuthShell } from './AuthShell'
import { enterFromShell } from './boot'
import { sessionEnded, subscribeSessionEnded } from './estivaId'

export function SessionGate({ children }: { children: ReactNode }) {
  const reason = useSyncExternalStore(subscribeSessionEnded, sessionEnded)
  if (!reason) return <>{children}</>
  // Another tab signing out is a sign-out, not an ending: the plain screen, as Peek draws it.
  return <AuthShell state={{ phase: 'authenticating', reason }} onContinue={() => void enterFromShell()} />
}
