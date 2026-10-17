/**
 * Back where sign-in began. A link into Leaf opened signed out — a page, or
 * New document in a Folder another app linked to — goes through Estiva ID,
 * whose redirect is Leaf's root; the tab must land on the link again, not Home.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ returnTo: '/' as string | null }))

vi.mock('./estivaId', () => ({
  signInAvailable: true,
  callbackParams: () => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code') ?? undefined
    const error = params.get('error') ?? undefined
    return code || error ? { code, error } : null
  },
  completeSignIn: async () => ({ token: {}, returnTo: state.returnTo }),
  clearQuery: () => window.history.replaceState({}, '', window.location.pathname),
  currentToken: () => null,
  guardAttemptedAt: () => null,
  startRenewal: () => {},
  beginSignIn: async () => {},
  stashShellReason: () => {},
  takeShellReason: () => null,
  takeReturnTo: () => {
    const back = state.returnTo
    state.returnTo = null
    return back
  },
}))

const { bootAuth } = await import('./boot')
const here = () => `${window.location.pathname}${window.location.search}`
const LINK = '/new?folder=a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'

describe('finishing sign-in', () => {
  beforeEach(() => window.history.replaceState({}, '', '/?code=c&state=s'))

  it('lands on the link the person opened, query and all', async () => {
    state.returnTo = LINK
    expect(await bootAuth()).toEqual({ kind: 'app' })
    expect(here()).toBe(LINK)
  })
})

describe('a silent attempt that found no session', () => {
  beforeEach(() => window.history.replaceState({}, '', '/?error=login_required&state=s'))

  it('puts the link the person opened back before asking them to sign in, so signing in returns to it', async () => {
    state.returnTo = LINK
    const result = await bootAuth()
    expect(result.kind).toBe('shell')
    // Not `/?error=…`: Continue stores where the tab is as the place to come back to.
    expect(here()).toBe(LINK)
  })
})
