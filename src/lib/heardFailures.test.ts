/**
 * The report of a page that did not load says why (34396209), read at the wire: a read the relay refuses for longer
 * than Leaf waits, then a read Estiva ID will not sign because the sign-in ended, each followed by the failure a
 * screen draws. What leaves the browser for Estiva ID names the reason from the fixed list and none of their words.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const ME = 'a'.repeat(64)
const signIn = vi.hoisted(() => ({ ended: false }))
vi.mock('@/config', () => ({
  ID_CONFIG: { base: 'https://id.estiva.app', clientId: 'estiva-leaf' },
  APP_TITLE: 'Leaf',
  RELAY_URL: 'https://estiva.estiva.app',
}))
vi.mock('@/auth/estivaId', () => {
  const token = () => ({ accessToken: 'qa-1-token', pubkey: 'a'.repeat(64), expiresAt: Date.now() + 3_600_000 })
  return { heldToken: token, currentToken: token, renew: vi.fn(), sessionEnded: () => signIn.ended }
})
// Signed here, not by Estiva ID: its answer to a sign-in that ended is the one thing taken from it.
vi.mock('@estiva-app/identity', async (original) => {
  const identity = await original<typeof import('@estiva-app/identity')>()
  return {
    ...identity,
    estivaIdSigner: () => ({
      pubkey: 'a'.repeat(64),
      sign: async (event: Record<string, unknown>) => {
        if (signIn.ended) throw new identity.SignRefused(401, 'the access token has expired')
        return { created_at: 1, ...event, pubkey: 'a'.repeat(64), id: 'e'.repeat(64), sig: 's'.repeat(128) }
      },
    }),
  }
})

import { query } from '@/relay/bridge'
import { startErrorReports } from './errorReports'
import { reportFailureNow } from './failureReports'

let reports: Array<{ how: string; named: string; reason?: string }>
let bodies: string[]

beforeEach(() => {
  reports = []
  bodies = []
  signIn.ended = false
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 23) })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: { body?: string }) => {
      if (String(url).endsWith('/report')) {
        bodies.push(String(init?.body))
        reports.push(JSON.parse(String(init?.body)))
        return new Response(null, { status: 202 })
      }
      // The relay, with this person's minute spent for longer than a read waits.
      return new Response(JSON.stringify({ error: 'rate-limited: quota exceeded; retry in 400s' }), { status: 429 })
    }),
  )
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** A read that fails, then the failure its screen draws. */
async function readFailsAndIsDrawn() {
  let failed = false
  query([{ kinds: [1], authors: [ME] }]).catch(() => (failed = true))
  await vi.advanceTimersByTimeAsync(1_000)
  expect(failed).toBe(true)
  reportFailureNow('not-loaded')
  await vi.advanceTimersByTimeAsync(0)
}

it('a page that did not load is reported with why: the relay said wait, then the sign-in had ended, never in their words', async () => {
  startErrorReports()

  await readFailsAndIsDrawn()

  signIn.ended = true
  await readFailsAndIsDrawn()

  expect(reports.map((r) => [r.how, r.named, r.reason])).toEqual([
    ['failure', 'not-loaded', 'told-to-wait'],
    ['failure', 'not-loaded', 'signed-out'],
  ])
  for (const body of bodies) {
    expect(body).not.toContain('quota')
    expect(body).not.toContain('expired')
  }
})
