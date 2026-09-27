import { CONTINUE_LABEL, isRecoverable, RETRY_LABEL, SHELL_COPY, type ShellState } from '@estiva-app/identity'
import { Button } from '@estiva-app/ui'
import { APP_TITLE } from '../config'

export interface AuthShellProps {
  state: ShellState
  onContinue: () => void
}

/**
 * What shows while nobody is signed in: the app's name, one line and at most one
 * button. The words are `@estiva-app/identity`'s, so every app says the same.
 */
export function AuthShell({ state, onContinue }: AuthShellProps) {
  const waiting = state.phase === 'checking' || state.phase === 'entering' || state.phase === 'ready'
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg-surface px-6 text-center">
      <h1 className="text-h3 text-text-primary">{APP_TITLE}</h1>
      {!waiting && (
        <>
          <p className="max-w-prose text-body-2 text-text-secondary">{SHELL_COPY[state.reason]}</p>
          {isRecoverable(state.reason) && <Button onClick={onContinue}>{state.phase === 'authenticating' ? CONTINUE_LABEL : RETRY_LABEL}</Button>}
        </>
      )}
    </div>
  )
}
