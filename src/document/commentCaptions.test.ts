import { describe, expect, it, vi } from 'vitest'
import { addrToNaddr, encodeNpub } from '@estiva-app/protocol'

vi.mock('../relay/bridge', () => ({ query: vi.fn(async () => []), publish: vi.fn(), viewerPubkey: () => null }))

import { commentReferenceSections } from './referencePicker'

const QA2 = '3bb30d683788016b85c83604dd5660e4e172e95d46d4e3ebab623ff5847b1f71'
const ISSUE = `nostr:${addrToNaddr(`30851:${'b'.repeat(64)}:widgets`)}`
const nameOf = (pubkey: string) => (pubkey === QA2 ? 'QA-2' : undefined)
const comment = (body: string) => ({ id: 'e'.repeat(64), by: 'a'.repeat(64), at: 1, body })
/** The Messages section, which follows Files (Katerina, 30 Oct). */
const messagesOf = (one: ReturnType<typeof comment>) => commentReferenceSections({ here: [one], rest: [] }, '', nameOf).find((section) => section.label === 'Messages')!

describe("`[`'s row for a comment in a Leaf comment box reads its opening words as Peek and Ship do (PEEKM-6)", () => {
  it('a link as its words, a person by name, and an issue as "Issue", never dropped', () => {
    const body = `Zebra probe: **bold words**, read [the widgets guide](https://example.com/guide) with nostr:${encodeNpub(QA2)} about ${ISSUE} then \`code\``
    const messages = messagesOf(comment(body))
    expect(messages.items[0].snippet).toBe('Zebra probe: bold words, read the widgets guide with @QA-2 about Issue then code')
  })

  it('a person Leaf cannot name as their shortened npub, not "someone"', () => {
    const npub = encodeNpub('d'.repeat(64))
    const messages = messagesOf(comment(`ask nostr:${npub}`))
    expect(messages.items[0].snippet).toBe(`ask @${npub.slice(0, 12)}…`)
  })
})
