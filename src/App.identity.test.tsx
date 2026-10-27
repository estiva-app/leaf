/**
 * The account menu in the top bar draws the signed-in person by their profile picture, as Peek's and Ship's do
 * (LFB-1): Estiva ID's directory answers a name and no picture, so the face is the `kind:0`'s.
 */
import type { PublishResult, SignedEvent } from '@estiva-app/protocol'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const ME = 'a'.repeat(64)
const PICTURE = 'https://id.estiva.app/avatar/me.jpg'

vi.mock('./relay/bridge', () => ({
  viewerPubkey: () => ME,
  query: async (filters: Record<string, unknown>[]): Promise<SignedEvent[]> =>
    filters.some((f) => (f.kinds as number[] | undefined)?.includes(0) && (f.authors as string[] | undefined)?.includes(ME))
      ? [{ id: '1'.repeat(64), pubkey: ME, created_at: 1_760_000_000, kind: 0, tags: [], content: JSON.stringify({ name: 'QA-1', picture: PICTURE }), sig: '' }]
      : [],
  publish: async (): Promise<PublishResult> => ({ ok: true }) as PublishResult,
}))

vi.mock('./auth/estivaId', async () => {
  const actual = await vi.importActual<typeof import('./auth/estivaId')>('./auth/estivaId')
  return { ...actual, heldToken: () => ({ pubkey: ME, accessToken: 't' }), whoAmI: async () => ({ name: 'QA-1', email: 'qa-1@example.test' }) }
})

vi.mock('./folders/workspace', async () => {
  const actual = await vi.importActual<typeof import('./folders/workspace')>('./folders/workspace')
  return { ...actual, readFolders: async () => [] }
})

const { App } = await import('./App')

describe("the top bar's account menu", () => {
  it('draws the signed-in person by their profile picture', async () => {
    render(<App />)
    await waitFor(() => expect(document.querySelectorAll(`img[src="${PICTURE}"]`).length).toBeGreaterThan(0))
  })
})
