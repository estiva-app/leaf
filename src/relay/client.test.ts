import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
// Loaded once here, before any test's clock starts: the first load takes seconds on a busy machine, and
// inside the first test it ran that test out of time. Each test evaluates it again, in milliseconds.
import './client'

// So the first test, like the rest, evaluates the client under its own settings and not the load above.
beforeAll(() => vi.resetModules())

/**
 * The tab's one relay connection. A fake socket stands in for the relay, so this
 * runs with no network, and counts the sockets opened.
 */
class FakeSocket {
  static opened = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    FakeSocket.opened += 1
  }
  send() {}
  close() {}
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
  FakeSocket.opened = 0
})

describe('the relay client', () => {
  it('opens no connection when no relay is set', async () => {
    vi.stubEnv('VITE_RELAY_URL', '')
    vi.stubEnv('VITE_ESTIVA_ID_ORIGIN', 'http://localhost:8787')
    vi.stubEnv('VITE_ESTIVA_ID_CLIENT_ID', 'leaf')
    vi.stubGlobal('WebSocket', FakeSocket)
    const { relayClient } = await import('./client')
    expect(relayClient()).toBeNull()
    expect(FakeSocket.opened).toBe(0)
  })

  it('opens no connection with a relay and no sign-in', async () => {
    vi.stubEnv('VITE_RELAY_URL', 'http://localhost:3000')
    vi.stubEnv('VITE_ESTIVA_ID_ORIGIN', '')
    vi.stubGlobal('WebSocket', FakeSocket)
    const { relayClient } = await import('./client')
    expect(relayClient()).toBeNull()
    expect(FakeSocket.opened).toBe(0)
  })

  it('holds one connection per tab, however often it is asked', async () => {
    vi.stubEnv('VITE_RELAY_URL', 'http://localhost:3000')
    vi.stubEnv('VITE_ESTIVA_ID_ORIGIN', 'http://localhost:8787')
    vi.stubEnv('VITE_ESTIVA_ID_CLIENT_ID', 'leaf')
    vi.stubGlobal('WebSocket', FakeSocket)
    const { relayClient } = await import('./client')
    const first = relayClient()
    expect(first).not.toBeNull()
    expect(relayClient()).toBe(first)
    expect(FakeSocket.opened).toBe(1)
    first?.close()
  })
})
