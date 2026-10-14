import type { PublishResult, UnsignedEvent } from '@estiva-app/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const published: UnsignedEvent[] = []
let answers: PublishResult[] = []

vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => 'a'.repeat(64),
  query: async () => [],
  publish: async (event: UnsignedEvent) => {
    published.push(event)
    return answers.shift() ?? { ok: true }
  },
}))

const { createDocument, listDocument } = await import('./workspace')
const FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const tag = (event: UnsignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

describe('New document', () => {
  beforeEach(() => {
    published.length = 0
    answers = []
  })

  it("publishes a document — never a topic — under the Folder's own h with no text, then the Folder's add naming it", async () => {
    const result = await createDocument({ folder: FOLDER, title: 'Friday notes' })
    expect(result.ok).toBe(true)
    const [doc, add] = published
    expect(doc.kind).toBe(30842)
    expect(doc.content).toBe('')
    expect(tag(doc, 'title')).toBe('Friday notes')
    expect(tag(doc, 'h')).toBe(FOLDER)
    expect(tag(doc, 'd')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(add.kind).toBe(1852)
    expect(tag(add, 'h')).toBe(FOLDER)
    expect(tag(add, 'op')).toBe('add')
    expect(tag(add, 'a')).toBe(`30842:${'a'.repeat(64)}:${tag(doc, 'd')}`)
    expect(published).toHaveLength(2)
  })

  it('says nothing was made, and lists nothing, when the relay refuses the document', async () => {
    answers = [{ ok: false, reason: 'blocked: not a member' }]
    const result = await createDocument({ folder: FOLDER, title: 'Friday notes' })
    expect(result).toEqual({ ok: false, made: false, reason: 'The document could not be made in that Folder. Try again.' })
    expect(published).toHaveLength(1)
  })

  it('says the document was made but is not listed when only the add is refused, so it can be retried', async () => {
    answers = [{ ok: true }, { ok: false, reason: 'rate-limited' }]
    const result = await createDocument({ folder: FOLDER, title: 'Friday notes' })
    expect(result).toMatchObject({ ok: false, made: true, reason: 'The Folder did not take it. Try again.' })
    if (result.ok || !result.made) throw new Error('unreachable')
    expect(await listDocument({ folder: FOLDER, address: result.address })).toEqual({ ok: true })
    expect(tag(published[2], 'a')).toBe(result.address)
  })
})
