import type { RelayState } from '@estiva-app/protocol'
import { useSyncExternalStore } from 'react'
import { relayClient } from './client'

const subscribe = (onChange: () => void): (() => void) => relayClient()?.onState(onChange) ?? (() => {})
const snapshot = (): RelayState | 'off' => relayClient()?.state() ?? 'off'

/** The connection's state, for a page to show: `'off'` when this build has no client. */
export function useRelayState(): RelayState | 'off' {
  return useSyncExternalStore(subscribe, snapshot, () => 'off')
}
