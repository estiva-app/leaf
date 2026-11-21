// @vitest-environment jsdom
/**
 * Leaf's page-open timings, read at the wire: the body that would leave the
 * browser for Estiva ID names the kind of screen and how it was opened, and
 * none of the text planted in a title or the page address. The timer's own
 * rules (quiet spell, hidden tabs, allowance, the sign-in pass) are
 * `@estiva-app/platform`'s, tested there; here, which navigations in Leaf
 * start one, and that leaving for sign-in hands the open on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The sign-in's own token handling is @estiva-app/identity's, tested there; here a signed-in QA-1.
vi.mock('@/config', () => ({ ID_CONFIG: { base: 'https://id.estiva.app', clientId: 'estiva-leaf' } }))
const leaving = new Set<() => void>()
vi.mock('@/auth/estivaId', () => ({
  currentToken: () => ({ accessToken: 'qa-1-token' }),
  onLeavingForSignIn: (listener: () => void) => {
    leaving.add(listener)
    return () => leaving.delete(listener)
  },
}))

// Loaded once here, before any test's clock starts: the first load takes seconds on a busy machine, and
// inside the first `beforeEach` it ran that hook, and the tests behind it, out of time. Each test
// evaluates them again, in milliseconds.
import './pageTimings'
import '@/route'

const PLANTED_TITLE = 'plantedtitle board offsite'
const DOC = '/document/plantedslug-board-offsite-70a66624-a6d2-4ce9-968f-e5adc23e1ede'
const OTHER_DOC = '/document/plantedslug-two-9c69f247-be6a-4ae7-9703-71cb971f5f93'

let requests: Array<{ url: string; body: string }>
let stopTimings: () => void

/** MutationObserver callbacks and the token read are microtasks. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** The page draws a loading placeholder in its main area, then the page itself. */
async function load(ms: number) {
  const main = document.createElement('main')
  main.innerHTML = '<div class="animate-pulse h-4"></div>'
  document.body.replaceChildren(main)
  await flush()
  vi.advanceTimersByTime(ms)
  main.innerHTML = `<h1>${PLANTED_TITLE}</h1>`
  await flush()
  vi.advanceTimersByTime(1000)
  await flush()
}

const bodies = () => requests.map((r) => JSON.parse(r.body))

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  leaving.clear()
  sessionStorage.clear()
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      requests.push({ url, body: init.body })
      return new Response(null, { status: 202 })
    }),
  )
  window.history.replaceState({}, '', DOC)
  document.body.replaceChildren()
  const { startPageTimings } = await import('./pageTimings')
  stopTimings = startPageTimings()
  // This load drew no placeholder: it goes out as such, and the test starts clean.
  vi.advanceTimersByTime(5000)
  await flush()
  requests = []
})

afterEach(() => {
  stopTimings()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Leaf page-open timings', () => {
  it('times a page opened by a link, named by kind of screen, with none of the planted text', async () => {
    const { navigate } = await import('@/route')
    navigate(OTHER_DOC)
    await load(700)
    expect(bodies()).toEqual([
      { release: expect.any(String), screen: 'document', how: 'in-app', waitMs: 700, ready: 'placeholder-gone' },
    ])
    expect(requests[0]?.url).toBe('https://id.estiva.app/timing')
    expect(requests[0]?.body).not.toMatch(/planted|offsite|9c69f247/)
  })

  it('times Home opened by a link', async () => {
    const { navigate } = await import('@/route')
    navigate('/')
    await load(300)
    expect(bodies().map((b) => [b.screen, b.how])).toEqual([['home', 'in-app']])
  })

  it('starts no timing for a redirect in place, nor for a link to the page already open', async () => {
    const { navigate, replace } = await import('@/route')
    replace(OTHER_DOC)
    await load(300)
    navigate(OTHER_DOC)
    await load(300)
    expect(requests).toEqual([])
  })

  it("times the browser's own back button", async () => {
    const { navigate } = await import('@/route')
    navigate(OTHER_DOC)
    await load(100)
    navigate('/')
    await load(100)
    requests = []
    window.history.replaceState({}, '', OTHER_DOC)
    window.dispatchEvent(new PopStateEvent('popstate'))
    await load(400)
    expect(bodies().map((b) => [b.screen, b.how, b.waitMs])).toEqual([['document', 'in-app', 400]])
  })

  it('leaving for sign-in while a page loads sends nothing and keeps the open for the page the tab comes back to', async () => {
    const { navigate } = await import('@/route')
    navigate(OTHER_DOC)
    document.body.innerHTML = '<main><div class="animate-pulse"></div></main>'
    await flush()
    for (const leave of leaving) leave()
    vi.advanceTimersByTime(60_000)
    await flush()
    expect(requests).toEqual([])
    expect(JSON.parse(sessionStorage.getItem('estiva.pageTimer.carried') ?? 'null')).toMatchObject({ how: 'in-app' })
  })
})
