import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthShell } from './auth/AuthShell'
import { bootAuth, enterFromShell } from './auth/boot'
import { followOtherTabs } from './auth/estivaId'
import { SessionGate } from './auth/SessionGate'
import { documentFieldsOptIn, fieldsOptIn, issueFieldsOptIn, topicFieldsOptIn } from './relay/fieldsOptIn'
import { ErrorBoundary } from '@estiva-app/ui'
import { startErrorReports } from './lib/errorReports'
import { startPageTimings } from './lib/pageTimings'

// A crash anywhere in Leaf is reported to Estiva ID, built from a fixed list (PROD-4).
startErrorReports()
// How long each page took to open, from the tab's start: before sign-in, which may leave for Estiva ID and come back.
startPageTimings()

// Settle who this load belongs to first, then render: the app itself is imported
// only once sign-in is settled, so nothing in it evaluates as the wrong person.
void (async () => {
  // Before sign-in can move the address: `?fields=on` opts this tab in to reading projects by their fields (ALO-6).
  fieldsOptIn(window.location.search)
  // `?issueFields=on`, the same for issues, apart from projects (ISS-6).
  issueFieldsOptIn(window.location.search)
  // `?documentFields=on` and `?topicFields=on`, the same for pages and a topic's file list (ALL-4).
  documentFieldsOptIn(window.location.search)
  topicFieldsOptIn(window.location.search)
  const root = createRoot(document.getElementById('root')!)
  const boot = await bootAuth()
  if (boot.kind === 'leaving') return
  if (boot.kind === 'shell') {
    root.render(
      <StrictMode>
        <ErrorBoundary label="app" fallbackClassName="h-screen flex flex-col">
          <AuthShell state={boot.state} onContinue={() => void enterFromShell()} />
        </ErrorBoundary>
      </StrictMode>,
    )
    return
  }
  const { App } = await import('./App')
  followOtherTabs()
  // A topic read just before the tab goes away still reaches the relay.
  ;(await import('./relay/readState')).installReadStateFlush()
  // A sign-in that ends from here on draws the passkey screen in the page's place (AUT-5).
  root.render(
    <StrictMode>
      {/* The last line of defence: a crash outside the page (the frame, the
          sidebar, the session gate) shows the message full-screen instead of
          a blank page. The page itself has its own, inside the frame (App). */}
      <ErrorBoundary label="app" fallbackClassName="h-screen flex flex-col">
        <SessionGate>
          <App />
        </SessionGate>
      </ErrorBoundary>
    </StrictMode>,
  )
})()
