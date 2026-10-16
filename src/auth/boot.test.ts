/**
 * Back where sign-in began. A link into Leaf opened signed out — a page, or
 * New document in a Folder another app linked to — goes through Estiva ID,
 * whose redirect is Leaf's root; the tab must land on the link again, not Home.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ returnTo: '/' }))

vi.mock('./estivaId', () => ({
  signInAvailable: true,
  callbackParams: () => (new URLSearchParams(window.location.search).get('code') ? { code: 'c' } : null),
  completeSignIn: async () => ({ token: {}, returnTo: state.returnTo }),
  clearQuery: () => window.history.replaceState({}, '', window.location.pathname),
  currentToken: () => null,
  guardAttemptedAt: () => null,
  startRenewal: () => {},
  beginSignIn: async () => {},
  stashShellReason: () => {},
  takeShellReason: () => null,
}))

const { bootAuth } = await import('./boot')

beforeEach(() => window.history.replaceState({}, '', '/?code=c&state=s'))

describe('finishing sign-in', () => {
  it('lands on the link the person opened, query and all', async () => {
    state.returnTo = '/new?folder=a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
    expect(await bootAuth()).toEqual({ kind: 'app' })
    expect(`${window.location.pathname}${window.location.search}`).toBe('/new?folder=a78e60b1-a41f-48c9-bcb0-6ceacdee8c69')
  })

  it('never lands on another origin, whatever was stored', async () => {
    state.returnTo = '//elsewhere.example/f/x'
    await bootAuth()
    expect(window.location.origin).toBe(new URL(document.baseURI).origin)
    expect(`${window.location.pathname}${window.location.search}`).toBe('/')
  })
})
