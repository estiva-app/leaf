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

  it("made under a page listed in another Folder: its root names the page and takes the page's own h; the add goes where the page is listed (LFB-8)", async () => {
    const OWN = '22222222-2222-4222-8222-222222222222'
    const PAGE = `30842:${'a'.repeat(64)}:launch-plan`
    expect((await createDocument({ folder: FOLDER, title: 'Risks', parent: { address: PAGE, folder: OWN } })).ok).toBe(true)
    const [doc, add] = published
    expect(doc.kind).toBe(30842)
    expect(tag(doc, 'h')).toBe(OWN)
    expect(tag(doc, 'a')).toBe(PAGE)
    expect([add.kind, tag(add, 'h'), tag(add, 'op'), tag(add, 'a')]).toEqual([1852, FOLDER, 'add', `30842:${'a'.repeat(64)}:${tag(doc, 'd')}`])
  })

  it("seeds the page's summary as its root's last tag, on one line (SPEC §6.12)", async () => {
    await createDocument({ folder: FOLDER, title: 'Friday notes', summary: '  What we decided\non Friday.  ' })
    const [doc] = published
    expect(doc.tags.at(-1)).toEqual(['summary', 'What we decided on Friday.'])
  })

  it('puts no summary tag on a page made without one, or with only spaces', async () => {
    await createDocument({ folder: FOLDER, title: 'Friday notes' })
    await createDocument({ folder: FOLDER, title: 'Friday notes', summary: '  \n ' })
    const roots = published.filter((e) => e.kind === 30842)
    expect(roots).toHaveLength(2)
    expect(roots.every((doc) => !doc.tags.some((t) => t[0] === 'summary'))).toBe(true)
  })

  it('says nothing was made, and lists nothing, when the relay refuses the document', async () => {
    // The relay refuses as 200 with `accepted: false`, and its answer always carries the status.
    answers = [{ ok: false, reason: 'blocked: not a member', httpStatus: 200 }]
    const result = await createDocument({ folder: FOLDER, title: 'Friday notes' })
    expect(result).toEqual({ ok: false, made: false, reason: 'The document could not be made in that team. Try again.' })
    expect(published).toHaveLength(1)
  })

  it('says the document was made but is not listed when only the add is refused, so it can be retried', async () => {
    answers = [{ ok: true }, { ok: false, reason: 'rate-limited', httpStatus: 429 }]
    const result = await createDocument({ folder: FOLDER, title: 'Friday notes' })
    expect(result).toMatchObject({ ok: false, made: true, reason: 'The team did not take it. Try again.' })
    if (result.ok || !result.made) throw new Error('unreachable')
    expect(await listDocument({ folder: FOLDER, address: result.address })).toEqual({ ok: true })
    expect(tag(published[2], 'a')).toBe(result.address)
  })
})
