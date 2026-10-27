import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { namedProfilesOf, rosterOf } from '@estiva-app/conversation'
import type { SignedEvent } from '@estiva-app/protocol'
import { directoryOf, useMentionPeople } from './people'

const ME = 'a'.repeat(64)
const QA2 = 'c'.repeat(64)
const LEFT = 'e'.repeat(64)

const event = (kind: number, pubkey: string, content: string, tags: string[][] = []): SignedEvent => ({ id: `${kind}${pubkey}`.slice(0, 64), pubkey, created_at: 1_760_000_000, kind, tags, content, sig: '' })
const profile = (pubkey: string, name: string) => event(0, pubkey, JSON.stringify({ name }))
const roster = event(13534, 'd'.repeat(64), '', [['member', ME], ['member', QA2]])

// The relay as Leaf reads it: every profile for `kinds: [0]`, the roster for its kind; signed in as ME.
vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => ME,
  query: async (filters: { kinds?: number[] }[]) => {
    const kinds = filters.flatMap((f) => f.kinds ?? [])
    return [roster, profile(ME, 'QA-1'), profile(QA2, 'QA-2'), profile(LEFT, 'Gone')].filter((e) => kinds.includes(e.kind))
  },
}))

describe('whom @ offers in a comment', () => {
  async function offered(): Promise<string[]> {
    const view = renderHook(() => useMentionPeople())
    await waitFor(() => expect(view.result.current.people.map((p) => p.name)).toContain('QA-2'))
    return view.result.current.people.map((p) => p.name)
  }

  it('does not offer a named profile that is not on the roster', async () => {
    expect(await offered()).not.toContain('Gone')
  })

  it('does not offer the signed-in viewer, though they are on the roster with a name', async () => {
    expect(await offered()).not.toContain('QA-1')
  })

  it('offers the other named members of the roster', async () => {
    expect(await offered()).toEqual(['QA-2'])
  })
})

describe('whom a card’s Lead picker offers', () => {
  const events = [roster, profile(ME, 'QA-1'), profile(QA2, 'QA-2'), profile(LEFT, 'Gone')]

  it('offers the people on the roster with a name, you included, and nobody off the roster', () => {
    expect(directoryOf(namedProfilesOf(events), rosterOf(events))).toEqual({ [ME]: { displayName: 'QA-1' }, [QA2]: { displayName: 'QA-2' } })
  })
})
