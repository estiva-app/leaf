/**
 * A read the relay refuses because the person's minute is spent is asked again once the relay's wait is over
 * (LFB-12): Leaf opened a few times in a minute shows loading, then the page, never "could not be read".
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const ME = 'a'.repeat(64)
vi.mock('../lib/failureReports', () => ({ heardRefusal: vi.fn() }))
vi.mock('../config', () => ({
  ID_CONFIG: { base: 'https://id.estiva.app', clientId: 'estiva-leaf' },
  APP_TITLE: 'Leaf',
  RELAY_URL: 'https://estiva.estiva.app',
}))
vi.mock('../auth/estivaId', () => ({
  heldToken: () => ({ accessToken: 'at', pubkey: 'a'.repeat(64), expiresAt: Date.now() + 3_600_000 }),
  renew: vi.fn(),
  sessionEnded: vi.fn(),
}))
// Signed here, not by Estiva ID: only the relay's answers are under test.
vi.mock('@estiva-app/identity', async (original) => ({
  ...(await original<object>()),
  estivaIdSigner: () => ({
    pubkey: 'a'.repeat(64),
    sign: async (event: Record<string, unknown>) => ({ created_at: 1, ...event, pubkey: 'a'.repeat(64), id: 'e'.repeat(64), sig: 's'.repeat(128) }),
  }),
}))

import { query } from './bridge'

const NOTE = { id: 'f'.repeat(64), kind: 1, pubkey: ME, created_at: 5, tags: [], content: 'Week of 26 October', sig: 's'.repeat(128) }
const reading = [{ kinds: [1], authors: [ME] }]
const spent = (seconds: number) => () => new Response(JSON.stringify({ error: `rate-limited: quota exceeded; retry in ${seconds}s` }), { status: 429 })
const answered = () => new Response(JSON.stringify([NOTE]), { status: 200 })

/** The relay's answers to `/query`, in order; the last one repeats. */
function relayAnswers(...answers: (() => Response)[]) {
  let asked = 0
  const fetch = vi.fn(async () => answers[Math.min(asked++, answers.length - 1)]())
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** What the read has come to so far, without waiting on it. */
function watch<T>(read: Promise<T>) {
  const seen: { value?: T; error?: unknown } = {}
  read.then(
    (value) => (seen.value = value),
    (error: unknown) => (seen.error = error),
  )
  return seen
}

// Each case starts ten minutes after the one before: the tab remembers when the relay said to ask again.
let clock = Date.UTC(2026, 10, 21)
beforeEach(() => {
  clock += 600_000
  vi.useFakeTimers({ now: clock })
  // The spread on top of the relay's seconds: half a second every time, so each wait here is exact.
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})
afterEach(async () => {
  // Past any wait a case left behind, so the next one starts with none.
  await vi.advanceTimersByTimeAsync(200_000)
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('reads refused at different moments of one minute ask again together, as one request', async () => {
  const LIKE = { ...NOTE, id: 'd'.repeat(64), kind: 7 }
  let asked = 0
  const fetch = vi.fn(async () => {
    asked += 1
    if (asked === 1) return spent(8)()
    if (asked === 2) return spent(6)()
    return new Response(JSON.stringify([NOTE, LIKE]), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)

  const first = watch(query(reading))
  await vi.advanceTimersByTimeAsync(1_500)
  const second = watch(query([{ kinds: [7], authors: [ME] }]))
  await vi.advanceTimersByTimeAsync(1_000)
  expect(fetch).toHaveBeenCalledTimes(2)

  await vi.advanceTimersByTimeAsync(8_000)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(first.value).toEqual([NOTE])
  expect(second.value).toEqual([LIKE])
})

it('a read refused because the minute is spent waits the relay’s seconds, asks again and answers', async () => {
  const fetch = relayAnswers(spent(8), answered)
  const seen = watch(query(reading))

  await vi.advanceTimersByTimeAsync(7_000)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(seen).toEqual({})

  await vi.advanceTimersByTimeAsync(3_000)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(seen.value).toEqual([NOTE])
})

it('a read still refused the minute after waits that one out too', async () => {
  relayAnswers(spent(8), spent(59), answered)
  const seen = watch(query(reading))

  await vi.advanceTimersByTimeAsync(60_000)
  expect(seen).toEqual({})
  await vi.advanceTimersByTimeAsync(12_000)
  expect(seen.value).toEqual([NOTE])
})

it('a read refused for any other reason fails at once and is not asked again', async () => {
  const fetch = relayAnswers(() => new Response(JSON.stringify({ error: 'restricted: not a member' }), { status: 403 }), answered)
  const seen = watch(query(reading))

  await vi.advanceTimersByTimeAsync(1_000)
  expect(String(seen.error)).toContain('restricted: not a member')
  await vi.advanceTimersByTimeAsync(120_000)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('a read refused for three minutes running fails, so the page can say it could not be read', async () => {
  relayAnswers(spent(59))
  const seen = watch(query(reading))

  await vi.advanceTimersByTimeAsync(170_000)
  expect(seen).toEqual({})
  await vi.advanceTimersByTimeAsync(20_000)
  expect(String(seen.error)).toContain('rate-limited')
})
