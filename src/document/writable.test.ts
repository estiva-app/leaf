import { describe, expect, it } from 'vitest'
import { resolveForeignObject, type ForeignObject } from '@estiva-app/interop'
import { encodeNaddr } from '@estiva-app/protocol'
import { shipIssue, shipProject } from '../pages/fixtures/shipFiles'
import { sharesText, writableFields } from './writable'

// A topic as interop's built-in bare-file projection draws it: a title and a conversation, no text (SPEC §6.7).
async function topic(): Promise<ForeignObject> {
  const pubkey = 'd'.repeat(64)
  const root = { id: '1'.repeat(64), sig: '0'.repeat(128), pubkey, kind: 30840, created_at: 1, tags: [['d', 't'], ['title', 'A topic'], ['h', 'f']], content: '' }
  const query = async (filters: { kinds?: number[] }[]) => (filters.some((f) => f.kinds?.includes(30840)) ? [root] : [])
  const found = await resolveForeignObject(encodeNaddr({ kind: 30840, pubkey, identifier: 't', relays: [] }), query, async () => ({}))
  if (!found || found.unreachable) throw new Error('no topic projected')
  return found
}

describe('which fields Leaf writes on a file', () => {
  it("writes a Ship issue's and project's title, summary and text, because Ship's manifest shares all three", () => {
    expect([...writableFields(shipIssue())].sort()).toEqual(['description', 'summary', 'title'])
    expect([...writableFields(shipProject())].sort()).toEqual(['description', 'summary', 'title'])
    expect(sharesText(shipIssue())).toBe(true)
  })

  it('writes no text on a file whose owner shares none, such as a topic', async () => {
    const bare = await topic()
    expect(sharesText(bare)).toBe(false)
    expect(writableFields(bare).has('title')).toBe(true)
  })

  it('writes no text the owner shares only as plain text, or that the page does not draw as its body', () => {
    const issue = shipIssue()
    const plain = { ...issue, actions: issue.actions.map((a) => (a.field === 'description' ? { ...a, format: undefined } : a)) }
    expect(sharesText(plain)).toBe(false)
    const undrawn = { ...issue, slots: { ...issue.slots, body: { ...issue.slots.body, field: 'notes' } } }
    expect(sharesText(undrawn)).toBe(false)
  })

  it("never writes a field through another app's borrowed action", () => {
    const issue = shipIssue()
    const borrowed = { ...issue, actions: issue.actions.map((a) => (a.field === 'description' ? { ...a, declaredBy: { address: 'x', appName: 'Other' } } : a)) }
    expect(sharesText(borrowed)).toBe(false)
  })
})
