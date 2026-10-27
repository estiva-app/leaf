import { describe, expect, it } from 'vitest'
import { namedProfilesOf, rosterOf } from '@estiva-app/conversation'
import type { SignedEvent } from '@estiva-app/protocol'
import { directoryOf } from './people'

const ME = 'a'.repeat(64)
const QA2 = 'c'.repeat(64)
const LEFT = 'e'.repeat(64)

const event = (kind: number, pubkey: string, content: string, tags: string[][] = []): SignedEvent => ({ id: `${kind}${pubkey}`.slice(0, 64), pubkey, created_at: 1_760_000_000, kind, tags, content, sig: '' })
const profile = (pubkey: string, name: string) => event(0, pubkey, JSON.stringify({ name }))
const roster = event(13534, 'd'.repeat(64), '', [['member', ME], ['member', QA2]])

// Who `@` offers is the shared rule's, tested in @estiva-app/conversation (PEEKM-6).
describe('whom a card’s Lead picker offers', () => {
  const events = [roster, profile(ME, 'QA-1'), profile(QA2, 'QA-2'), profile(LEFT, 'Gone')]

  it('offers the people on the roster with a name, you included, and nobody off the roster', () => {
    expect(directoryOf(namedProfilesOf(events), rosterOf(events))).toEqual({ [ME]: { displayName: 'QA-1' }, [QA2]: { displayName: 'QA-2' } })
  })
})
