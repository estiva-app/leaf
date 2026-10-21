import { describe, expect, it } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { directoryOf, mentionablesOf, namedProfilesOf, rosterOf } from './people'

const ME = 'a'.repeat(64)
const QA2 = 'c'.repeat(64)
const LEFT = 'e'.repeat(64)

const event = (kind: number, pubkey: string, content: string, tags: string[][] = []): SignedEvent => ({ id: `${kind}${pubkey}`.slice(0, 64), pubkey, created_at: 1_760_000_000, kind, tags, content, sig: '' })
const profile = (pubkey: string, name: string) => event(0, pubkey, JSON.stringify({ name }))
const roster = event(13534, 'd'.repeat(64), '', [['member', ME], ['member', QA2]])

describe('who @ offers in a comment', () => {
  const events = [roster, profile(ME, 'QA-1'), profile(QA2, 'QA-2'), profile(LEFT, 'Gone')]

  it('offers the people on the roster with a name, never you and never someone off the roster', () => {
    expect(mentionablesOf(namedProfilesOf(events), rosterOf(events), ME).map((p) => p.pubkey)).toEqual([QA2])
  })

  it('offers every named profile but you when the relay gives no roster', () => {
    const noRoster = events.filter((e) => e.kind === 0)
    expect(mentionablesOf(namedProfilesOf(noRoster), rosterOf(noRoster), ME).map((p) => p.name)).toEqual(['Gone', 'QA-2'])
  })

  it('still names someone who left the roster, so a mention of them reads as their name', () => {
    expect(namedProfilesOf(events).get(LEFT)?.name).toBe('Gone')
  })
})

describe('whom a card’s Lead picker offers', () => {
  const events = [roster, profile(ME, 'QA-1'), profile(QA2, 'QA-2'), profile(LEFT, 'Gone')]

  it('offers the people on the roster with a name, you included, and nobody off the roster', () => {
    expect(directoryOf(namedProfilesOf(events), rosterOf(events))).toEqual({ [ME]: { displayName: 'QA-1' }, [QA2]: { displayName: 'QA-2' } })
  })
})
