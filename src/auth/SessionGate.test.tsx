// @vitest-environment jsdom
/**
 * A sign-in ending while Leaf is open (AUT-5, as Ship's AUT-4): Katerina, 18 Aug, came back to a
 * "not signed in" banner in Ship under her own avatar, with only Sign out in the menu,
 * because a refused renewal only logged. Now the passkey screen takes the page's
 * place, at the same address, and another tab signing out does the same.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config', () => ({
  ID_CONFIG: { base: 'https://id.estiva.app', clientId: 'estiva-leaf' },
  APP_TITLE: 'Leaf',
  RELAY_URL: 'https://estiva.estiva.app',
}))

const KEY = 'leaf.estiva-id.token'
const PERSON = 'b3'.repeat(32)
const store = (over: Record<string, unknown> = {}) =>
  localStorage.setItem(KEY, JSON.stringify({ accessToken: 'at', pubkey: PERSON, expiresAt: Date.now() + 3_600_000, refreshToken: 'rt-1', ...over }))
/** What another tab writing the shared session looks like from this one. */
const otherTabWrote = () => window.dispatchEvent(new StorageEvent('storage', { key: KEY, storageArea: localStorage }))

const mount = async () => {
  vi.resetModules()
  const id = await import('./estivaId')
  const { SessionGate } = await import('./SessionGate')
  render(
    <SessionGate>
      <p>The document you were reading</p>
    </SessionGate>,
  )
  return id
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

/** Each test's listener on `window`, removed after it: a module from an earlier test would otherwise still answer. */
let stopFollowing = () => {}

afterEach(() => {
  cleanup()
  stopFollowing()
  stopFollowing = () => {}
  vi.useRealTimers()
})

describe('a renewal Estiva ID refuses while Leaf is open', () => {
  it('asks for the passkey in place of the page, leaving none of it readable', async () => {
    vi.useFakeTimers()
    store({ expiresAt: Date.now() + 120_000 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) } as Response)
    const id = await mount()
    id.startRenewal()
    await act(() => vi.advanceTimersByTimeAsync(130_000))
    expect(screen.getByText('Your Estiva ID session ended. Continue with your passkey.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with passkey' })).toBeTruthy()
    expect(screen.queryByText('The document you were reading')).toBeNull()
  })

  it('draws nothing over the page when the renewal succeeds', async () => {
    vi.useFakeTimers()
    store({ expiresAt: Date.now() + 120_000 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at-2', expires_in: 3600, refresh_token: 'rt-2', pubkey: PERSON }),
    } as Response)
    const id = await mount()
    id.startRenewal()
    await act(() => vi.advanceTimersByTimeAsync(130_000))
    expect(screen.queryByRole('button', { name: 'Continue with passkey' })).toBeNull()
    expect(JSON.parse(localStorage.getItem(KEY)!).accessToken).toBe('at-2')
  })

  it('asks for the passkey when a save finds the sign-in expired and Estiva ID refuses to renew it', async () => {
    // The schedule is late (a throttled background tab), so the save's 401 is what renews; clearing the
    // store tells only the other tabs.
    store({ expiresAt: Date.now() - 1_000 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) } as Response)
    const id = await mount()
    await act(async () => expect(await id.renew()).toBeNull())
    expect(screen.getByRole('button', { name: 'Continue with passkey' })).toBeTruthy()
  })
})

describe('another Leaf tab', () => {
  it('signing out signs this tab out at once, not at its next write, leaving none of the page readable', async () => {
    store()
    const id = await mount()
    stopFollowing = id.followOtherTabs()
    // What Sign out in the other tab leaves: its moment, then no token.
    localStorage.setItem('leaf.estiva-id.signed-out', String(Date.now()))
    localStorage.removeItem(KEY)
    act(otherTabWrote)
    expect(screen.getByText('Continue with your passkey to enter.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with passkey' })).toBeTruthy()
    expect(screen.queryByText('The document you were reading')).toBeNull()
  })

  it('renewing leaves this tab signed in, on the new token', async () => {
    store()
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    const id = await mount()
    stopFollowing = id.followOtherTabs()
    store({ accessToken: 'at-2', refreshToken: 'rt-2' })
    act(otherTabWrote)
    expect(screen.queryByRole('button', { name: 'Continue with passkey' })).toBeNull()
    expect(reload).not.toHaveBeenCalled()
    expect(id.heldToken()?.accessToken).toBe('at-2')
  })

  it('signing in as somebody else reloads this one, whose store holds what the last person read', async () => {
    store()
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    const id = await mount()
    stopFollowing = id.followOtherTabs()
    store({ pubkey: 'c4'.repeat(32) })
    act(otherTabWrote)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
