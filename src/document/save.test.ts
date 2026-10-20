import { describe, expect, it, vi } from 'vitest'

type Sent = { tags: string[][] }
const publish = vi.hoisted(() => vi.fn<(event: { tags: string[][] }) => Promise<{ ok: boolean }>>(async () => ({ ok: true })))
vi.mock('../relay/bridge', () => ({ query: vi.fn(async () => []), publish, viewerPubkey: () => 'a'.repeat(64) }))

import { buildChange, saveField } from './save'

const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const ADDRESS = `30842:${'b'.repeat(64)}:d1`

describe("a document's save", () => {
  it("is a 1851 change on the document, carrying the document's own Folder as h, with ts agreeing with created_at", () => {
    const event = buildChange('a'.repeat(64), 1_760_000_000_123, { target: ADDRESS, field: 'description', value: 'text', folder: FOLDER, contentFormat: 'estiva-blocks-1' })
    expect(event.kind).toBe(1851)
    expect(event.created_at).toBe(1_760_000_000)
    expect(event.tags.slice(0, 6)).toEqual([
      ['a', ADDRESS],
      ['field', 'description'],
      ['value', 'text'],
      ['h', FOLDER],
      ['content-format', 'estiva-blocks-1'],
      ['ts', '1760000000123'],
    ])
  })

  it('signs with the h of the document it saves, never another', async () => {
    await saveField({ address: ADDRESS, folder: FOLDER }, 'title', 'New name')
    const sent: Sent = publish.mock.calls.at(-1)![0]
    expect(sent.tags).toContainEqual(['h', FOLDER])
    expect(sent.tags).toContainEqual(['field', 'title'])
    expect(sent.tags.some((t) => t[0] === 'content-format')).toBe(false)
  })

  it('refuses to save a document whose Folder it does not know, rather than publish one readers would ignore', async () => {
    publish.mockClear()
    expect(await saveField({ address: ADDRESS, folder: undefined }, 'title', 'x')).toEqual({ ok: false, reason: 'This cannot be saved from here.' })
    expect(publish).not.toHaveBeenCalled()
  })
})
