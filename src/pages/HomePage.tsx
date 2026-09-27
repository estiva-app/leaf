import type { RelayState } from '@estiva-app/protocol'
import { EmptyState } from '@estiva-app/ui'
import { relayLabel } from '../config'

export interface HomePageProps {
  /** The relay this build is set to, or `null` when the app runs alone. */
  relay: string | null
  /** The connection's state: `'off'` when this build has no client. */
  state: RelayState | 'off'
  /** The signed-in person's name, once Estiva ID has said it. */
  name?: string
}

const SAYS: Record<RelayState, (host: string, name?: string) => string> = {
  connecting: (host) => `Connecting to ${host}…`,
  authenticating: (host) => `Signing in to ${host}…`,
  live: (host, name) => (name ? `Connected to ${host} as ${name}.` : `Connected to ${host}.`),
  reconnecting: (host) => `Reconnecting to ${host}…`,
  failed: (host) => `Could not connect to ${host}.`,
}

/**
 * The first page. What it becomes is this app's own work; until then it says
 * whether the app is connected to the relay, and as whom.
 *
 * The empty state goes straight into the frame's `main`, with no box around it:
 * `main` is a flex column, so the empty state takes the room left and centres
 * in it both ways, as its own page says. A box around it would place it
 * instead, and no gate reads a box. The connection is a quiet caption after it,
 * at the foot of the page.
 */
export function HomePage({ relay, state, name }: HomePageProps) {
  const line = !relay
    ? 'Running alone: no relay is set. Set VITE_RELAY_URL in .env.local to connect.'
    : state === 'off'
      ? `Not connected: ${relayLabel(relay)} needs sign-in, and this build has none.`
      : SAYS[state](relayLabel(relay), name)
  return (
    <>
      <EmptyState message="Nothing here yet." />
      <p className="px-6 pb-6 text-center text-caption text-text-muted">{line}</p>
    </>
  )
}
