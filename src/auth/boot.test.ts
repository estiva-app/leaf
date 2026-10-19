/**
 * Back where sign-in began. A link into Leaf opened signed out — a page, or
 * New document in a Folder another app linked to — goes through Estiva ID,
 * whose redirect is Leaf's root; the tab must land on the link again, not Home.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  returnTo: '/' as string | null,
  // An expired access token with a refresh token to spend, and what Estiva ID answers it.
  canRenew: false,
  renewal: 'renewed' as 'renewed' | 'refused' | 'unreachable',
  leftFor: [] as string[],
}))

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
  canRenew: () => state.canRenew,
  renewInPlace: async () => (state.renewal === 'renewed' ? { outcome: 'renewed', token: {} } : { outcome: state.renewal }),
  guardAttemptedAt: () => null,
  startRenewal: () => {},
  beginSignIn: async (options: { silent?: boolean } = {}) => {
    state.leftFor.push(options.silent ? 'silent' : 'passkey')
  },
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

describe('opening a document with an expired access token and a live sign-in (AUT-5)', () => {
  const PAGE = '/f/naddr1qqjrjepj89skxef595erwwp3956xvepn943xydnz95mxyvrzxfjnvdpjxfsnyq3q8wes66ph3qqkhpwgxczd64nqunsh962agm2w86atvglltprmracsxpqqqpu856jena5'
  beforeEach(() => {
    window.history.replaceState({}, '', PAGE)
    state.canRenew = true
    state.leftFor = []
  })

  it('renews here and opens the document, with no trip to Estiva ID', async () => {
    state.renewal = 'renewed'
    expect(await bootAuth()).toEqual({ kind: 'app' })
    expect(state.leftFor).toEqual([])
    expect(here()).toBe(PAGE)
  })

  it('asks for the passkey on the document when Estiva ID refuses the renewal', async () => {
    state.renewal = 'refused'
    const result = await bootAuth()
    expect(result).toMatchObject({ kind: 'shell', state: { phase: 'authenticating' } })
    expect(state.leftFor).toEqual([])
    expect(here()).toBe(PAGE)
  })
})
