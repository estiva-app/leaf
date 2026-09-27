import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthShell } from './auth/AuthShell'
import { bootAuth, enterFromShell } from './auth/boot'

// Settle who this load belongs to first, then render: the app itself is imported
// only once sign-in is settled, so nothing in it evaluates as the wrong person.
void (async () => {
  const root = createRoot(document.getElementById('root')!)
  const boot = await bootAuth()
  if (boot.kind === 'leaving') return
  if (boot.kind === 'shell') {
    root.render(
      <StrictMode>
        <AuthShell state={boot.state} onContinue={() => void enterFromShell()} />
      </StrictMode>,
    )
    return
  }
  const { App } = await import('./App')
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})()
