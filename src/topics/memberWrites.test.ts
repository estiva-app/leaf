/**
 * Add from an initiative's Members, at the wire: the event Ship's initiative page signs for the same click (Katerina,
 * 23 November: "make it like Ship"). Join is ExploreTopicsPage.test's; Leave is TopicPage.test's, through the page's read.
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { buildMembershipChange } from '@estiva-app/conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HQ, ME, MIKY, relay, sign } from './fixtures/topicsRelay'

vi.mock('../relay/bridge', async () => (await import('./fixtures/topicsRelay')).bridge)
vi.mock('../auth/nip44', async () => ({ nip44: (await import('./fixtures/topicsRelay')).nip44 }))

const { addToTopic } = await import('./joinTopic')

const ANA = 'd'.repeat(64)
const address = `30840:${MIKY}:widgets`
const initiative = { address, folder: HQ }

beforeEach(() => relay.reset())

describe('Members on an initiative', () => {
  it('Add signs one member change naming the person, signed by you', async () => {
    expect(await addToTopic(initiative, ANA, [])).toEqual({ ok: true })
    expect(relay.sent).toHaveLength(1)
    const [add] = relay.sent
    expect(add!.kind).toBe(1851)
    expect(add!.pubkey).toBe(ME)
    expect(add!.tags).toEqual(expect.arrayContaining([['a', address], ['h', HQ], ['field', `member:${ANA}`], ['value', 'true']]))
  })

  it('Add after the person left lands after their leave, so it counts', async () => {
    const leave = sign(buildMembershipChange(ANA, 1_700_000_500_000, { file: address, folder: HQ, person: ANA, member: false })) as SignedEvent
    expect((await addToTopic(initiative, ANA, [leave])).ok).toBe(true)
    expect(relay.sent[0]!.created_at).toBeGreaterThan(leave.created_at)
  })

})
