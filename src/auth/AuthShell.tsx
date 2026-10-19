import { CONTINUE_LABEL, isRecoverable, RETRY_LABEL, SHELL_COPY, type ShellState } from '@estiva-app/identity'
import { EntryShell } from '@estiva-app/ui'
import { APP_TITLE } from '../config'

export interface AuthShellProps {
  state: ShellState
  onContinue: () => void
}

/**
 * What shows while nobody is signed in: the app's name, one line and at most one
 * button. The screen is the package's `EntryShell`, the one Peek and Ship draw,
 * and the words are `@estiva-app/identity`'s, so every app says the same. It
 * fills the window; mid-session `SessionGate` draws it in place of the page.
 */
export function AuthShell({ state, onContinue }: AuthShellProps) {
  const logo = <h1 className="text-h3 text-text-primary">{APP_TITLE}</h1>
  if (state.phase === 'checking' || state.phase === 'entering' || state.phase === 'ready') {
    return <EntryShell logo={logo} busy className="fixed inset-0 z-50" />
  }
  const { reason } = state
  return (
    <EntryShell
      logo={logo}
      className="fixed inset-0 z-50"
      message={SHELL_COPY[reason]}
      // A reason a passkey cannot clear (an inactive account, a refused token) gets no button.
      action={isRecoverable(reason) ? { label: state.phase === 'authenticating' ? CONTINUE_LABEL : RETRY_LABEL, onClick: onContinue } : undefined}
    />
  )
}
