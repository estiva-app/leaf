/**
 * A write the relay refuses reaches the error reports by its reason code alone (PROD-5): "refused: archived",
 * never the relay's sentence, which can quote a title, nor anything that was written.
 */
import { afterEach, expect, it, vi } from 'vitest'

const ME = 'a'.repeat(64)
const heard = vi.hoisted(() => [] as string[])
vi.mock('../lib/failureReports', () => ({ heardRefusal: (code: string) => heard.push(code) }))
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
// Signed here, not by Estiva ID: only the relay's answer is under test.
vi.mock('@estiva-app/identity', async (original) => ({
  ...(await original<object>()),
  estivaIdSigner: () => ({
    pubkey: 'a'.repeat(64),
    sign: async (event: Record<string, unknown>) => ({ created_at: 1, ...event, pubkey: 'a'.repeat(64), id: 'e'.repeat(64), sig: 's'.repeat(128) }),
  }),
}))

import { publish } from './bridge'

afterEach(() => {
  heard.length = 0
  vi.unstubAllGlobals()
})

const answering = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

const writing = { kind: 1111, created_at: 1, tags: [], content: 'Board offsite plan', pubkey: ME }

it('a write the relay refuses is heard by its reason code, without the relay’s sentence or what was written', async () => {
  answering(200, { accepted: false, message: 'restricted: archived: “Board offsite plan” is archived' })
  const result = await publish(writing)
  expect(result.ok).toBe(false)
  expect(heard).toEqual(['archived'])
})

it('a write the relay takes is not heard', async () => {
  answering(200, { accepted: true, message: '' })
  expect((await publish(writing)).ok).toBe(true)
  expect(heard).toEqual([])
})
