/**
 * Who an initiative lists, read by the changes naming each person who has a profile (ALL-8): a person who joined is
 * listed, and a failed read of who has a profile fails the read, never answering "only you".
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-membership-change-names-the-person-it-is-about.md
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { buildMembershipChange } from '@estiva-app/conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HQ, MIKY, relay, sign } from './fixtures/topicsRelay'

const people = vi.hoisted(() => ({ fail: false }))
vi.mock('../relay/bridge', async () => {
  const { bridge } = await import('./fixtures/topicsRelay')
  return {
    ...bridge,
    queryAll: async (filters: { kinds?: number[] }[]) => {
      if (people.fail && filters.some((f) => f.kinds?.includes(0))) throw new Error('relay: 500')
      return bridge.queryAll(filters)
    },
  }
})

const { readTopicPlace, resetPeopleForTests } = await import('./topicMembers')

const ANA = 'd'.repeat(64)
const address = `30840:${MIKY}:3518cd7b-5b85-49e8-ba94-4aacacad2163`
const initiative = { address, folder: HQ }
const profile = (pubkey: string) => sign({ kind: 0, pubkey, created_at: 1_700_000_000, tags: [], content: '{"name":"Ana"}' }) as SignedEvent

beforeEach(() => {
  relay.reset()
  resetPeopleForTests()
  people.fail = false
})

describe('who an initiative lists', () => {
  it('lists a person who joined it, found among everyone with a profile', async () => {
    relay.held.push(profile(ANA), sign(buildMembershipChange(ANA, 1_700_000_500_000, { file: address, folder: HQ, person: ANA, member: true })) as SignedEvent)
    const { listed } = await readTopicPlace(initiative)
    expect(listed.map((one) => one.pubkey)).toContain(ANA)
  })

  it('fails when who has a profile cannot be read, rather than listing only you', async () => {
    relay.held.push(profile(ANA), sign(buildMembershipChange(ANA, 1_700_000_500_000, { file: address, folder: HQ, person: ANA, member: true })) as SignedEvent)
    people.fail = true
    await expect(readTopicPlace(initiative)).rejects.toThrow()
  })
})
