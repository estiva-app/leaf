/**
 * A crash in Leaf, read at the wire and on screen (PROD-4): the page that
 * crashed shows "Something went wrong … try again" and Try again draws it
 * again; the body that would leave the browser for Estiva ID holds none of the
 * text planted in a document's title, its body or the page address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@estiva-app/ui'

// The sign-in's own token handling is @estiva-app/identity's, tested there; here a signed-in QA-1.
vi.mock('@/config', () => ({ ID_CONFIG: { base: 'https://id.estiva.app', clientId: 'estiva-leaf' } }))
vi.mock('@/auth/estivaId', () => ({ currentToken: () => ({ accessToken: 'qa-1-token' }) }))

const PLANTED_TITLE = 'plantedtitle board offsite'
const PLANTED_BODY = 'plantedbody quarterly numbers'
const PLANTED_ADDRESS = '/document/plantedslug-board-offsite-da5af161-19e5-46c9-81c9-c49e5d1e391a'

/** The reporter reads the token, then sends: a few turns of the microtask queue, no timer. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
let requests: Array<{ url: string; body: string }>

beforeEach(() => {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      requests.push({ url, body: init.body })
      return new Response(null, { status: 202 })
    }),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
  window.history.pushState({}, '', PLANTED_ADDRESS)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Leaf error reports', () => {
  it('shows the message in place of a crashed document, reports it with none of the planted text, and Try again draws it again', async () => {
    const { startErrorReports, ScreenSteps, CrashOnPurpose } = await import('./errorReports')
    startErrorReports()
    render(
      <>
        <ScreenSteps />
        <ErrorBoundary>
          <CrashOnPurpose />
          <h1>{PLANTED_TITLE}</h1>
          <p>{PLANTED_BODY}</p>
        </ErrorBoundary>
      </>,
    )
    act(() => window.__crashOnPurpose?.(`${PLANTED_BODY} ${PLANTED_TITLE}`))
    await flush()

    expect(screen.queryByText(PLANTED_TITLE)).toBeNull()
    expect(screen.getByText('Something went wrong. Your data is safe — try again.')).toBeTruthy()

    expect(requests.map((r) => r.url)).toEqual(['https://id.estiva.app/report'])
    const [{ body }] = requests as [{ url: string; body: string }]
    for (const planted of ['plantedtitle', 'offsite', 'plantedbody', 'quarterly', 'plantedslug']) {
      expect(body).not.toContain(planted)
    }
    const report = JSON.parse(body)
    expect(report.how).toBe('boundary')
    expect(report.error.type).toBe('SyntaxError')
    expect(report.screen).toBe('document')
    expect(report.trail.map((step: { screen?: string }) => step.screen)).toEqual(['document'])

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText(PLANTED_TITLE)).toBeTruthy()
    expect(screen.queryByText(/Something went wrong/)).toBeNull()
  })
})

describe('screenOf', () => {
  it.each([
    [PLANTED_ADDRESS, 'document'],
    ['/topic/plantedslug-board-offsite-da5af161-19e5-46c9-81c9-c49e5d1e391a', 'topic'],
    ['/topics', 'topics'],
    ['/issue/plantedslug-board-offsite-da5af161', 'path'],
    ['/plantedaddress/a/b', 'home'],
  ])('names %s by its page, %s', async (pathname, page) => {
    const { screenOf } = await import('./errorReports')
    expect(screenOf(pathname)).toBe(page)
  })
})
