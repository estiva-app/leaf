import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthShell } from './auth/AuthShell'
import { bootAuth, enterFromShell } from './auth/boot'
import { followOtherTabs } from './auth/estivaId'
import { SessionGate } from './auth/SessionGate'
import { fieldsOptIn } from './relay/fieldsOptIn'

// Settle who this load belongs to first, then render: the app itself is imported
// only once sign-in is settled, so nothing in it evaluates as the wrong person.
void (async () => {
  // Before sign-in can move the address: `?fields=on` opts this tab in to reading projects by their fields (ALO-6).
  fieldsOptIn(window.location.search)
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
  followOtherTabs()
  // A sign-in that ends from here on draws the passkey screen in the page's place (AUT-5).
  root.render(
    <StrictMode>
      <SessionGate>
        <App />
      </SessionGate>
    </StrictMode>,
  )
})()
