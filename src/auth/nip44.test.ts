import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * TOPI-4: Estiva ID's NIP-44 round trip, which reads and rewrites your mute list. Every topics test stands in for this
 * module, so this is the one place its own contract is checked: what is asked of Estiva ID, and what a refusal does.
 */

const session = { token: 'held' as string | null, renewed: 'fresh' as string | null, renewals: 0 }
vi.mock('../config', () => ({ ID_CONFIG: { base: 'https://id.test/' } }))
vi.mock('./estivaId', () => ({
  heldToken: () => (session.token ? { accessToken: session.token } : null),
  renew: async () => {
    session.renewals += 1
    return session.renewed
  },
}))

const { nip44, Nip44Error } = await import('./nip44')

/** Estiva ID answering each call in turn with `answers`, and every request it was asked. */
function idAnswers(...answers: Array<{ status: number; body?: unknown }>) {
  const asked: Array<{ url: string; authorization: string; body: unknown }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      asked.push({ url, authorization: (init.headers as Record<string, string>).authorization, body: JSON.parse(init.body as string) })
      const next = answers.shift() ?? { status: 500, body: 'no answer left' }
      return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {}), { status: next.status })
    }),
  )
  return asked
}

beforeEach(() => {
  session.token = 'held'
  session.renewed = 'fresh'
  session.renewals = 0
})
afterEach(() => vi.unstubAllGlobals())

describe('nip44 through Estiva ID', () => {
  it('encrypts by asking /nip44/encrypt with your session for the plaintext, and answers the ciphertext', async () => {
    const asked = idAnswers({ status: 200, body: { ciphertext: 'sealed' } })
    await expect(nip44.encrypt('muted list')).resolves.toBe('sealed')
    expect(asked).toEqual([{ url: 'https://id.test/nip44/encrypt', authorization: 'Bearer held', body: { plaintext: 'muted list' } }])
  })

  it('decrypts by asking /nip44/decrypt for the ciphertext, and answers the plaintext', async () => {
    const asked = idAnswers({ status: 200, body: { plaintext: 'muted list' } })
    await expect(nip44.decrypt('sealed')).resolves.toBe('muted list')
    expect(asked).toEqual([{ url: 'https://id.test/nip44/decrypt', authorization: 'Bearer held', body: { ciphertext: 'sealed' } }])
  })

  it('renews an expired session once and asks again with the new token', async () => {
    const asked = idAnswers({ status: 401, body: 'expired' }, { status: 200, body: { plaintext: 'muted list' } })
    await expect(nip44.decrypt('sealed')).resolves.toBe('muted list')
    expect(session.renewals).toBe(1)
    expect(asked.map((request) => request.authorization)).toEqual(['Bearer held', 'Bearer fresh'])
  })

  it('throws with the status on a 429, so the mute list reads as "could not read", never as "nothing muted"', async () => {
    idAnswers({ status: 429, body: 'slow down' })
    const refused = nip44.decrypt('sealed')
    await expect(refused).rejects.toBeInstanceOf(Nip44Error)
    await expect(refused).rejects.toMatchObject({ status: 429 })
  })

  it('throws without asking when there is no session', async () => {
    session.token = null
    const asked = idAnswers()
    await expect(nip44.decrypt('sealed')).rejects.toMatchObject({ status: 401 })
    expect(asked).toEqual([])
  })
})
