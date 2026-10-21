import { describe, expect, it, vi } from 'vitest'

type Sent = { tags: string[][] }
const publish = vi.hoisted(() => vi.fn<(event: { tags: string[][] }) => Promise<{ ok: boolean }>>(async () => ({ ok: true })))
vi.mock('../relay/bridge', () => ({ query: vi.fn(async () => []), publish, viewerPubkey: () => 'a'.repeat(64) }))

import { encodeNpub } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { buildChange, saveCardChoice, saveField, saveText } from './save'

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

const QA2 = 'c2'.repeat(32)
const npub = (hex: string) => `nostr:${encodeNpub(hex)}`
/** A page's text as a block document naming `people` with `@` (§13.3 reference marks). */
const textNaming = (words: string, ...people: string[]) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', id: 'p1', content: [{ type: 'text', text: words }, ...people.map((p) => ({ type: 'text', text: '@someone', marks: [{ type: 'reference', attrs: { uri: npub(p) } }] }))] }],
  })
const blocks = (content: string) => ({ content, format: 'estiva-blocks-1' })

describe('a mention in a page (SPEC §11.8)', () => {
  it('saves the text with no p, then adds the person it names anew, as the Add button does', async () => {
    publish.mockClear()
    const result = await saveText({ address: ADDRESS, folder: FOLDER }, blocks(textNaming('Ask ', QA2)), blocks(textNaming('Ask')))
    expect(result).toEqual({ ok: true, refused: [] })
    expect(publish).toHaveBeenCalledTimes(2)
    const [text, add] = publish.mock.calls.map((call) => call[0] as Sent)
    expect(text.tags).toContainEqual(['field', 'description'])
    expect(text.tags.some((t) => t[0] === 'p')).toBe(false)
    // A file field change (§6.2), signed by the writer: the Add button's own event.
    expect(add).toMatchObject({ kind: 1851, pubkey: 'a'.repeat(64) })
    expect(add.tags).toEqual(expect.arrayContaining([['a', ADDRESS], ['field', `member:${QA2}`], ['value', 'true'], ['h', FOLDER]]))
  })

  it('adds nobody on a typo fix that still names them, so someone who left stays out', async () => {
    publish.mockClear()
    await saveText({ address: ADDRESS, folder: FOLDER }, blocks(textNaming('Ask, ', QA2)), blocks(textNaming('Aks ', QA2)))
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('says who could not be added when the relay refuses the Add, after the text went through', async () => {
    publish.mockClear()
    publish.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })
    expect(await saveText({ address: ADDRESS, folder: FOLDER }, blocks(textNaming('Ask ', QA2)), { content: 'Ask' })).toEqual({ ok: true, refused: [QA2] })
  })

  it('tries a refused Add again on the next save that still names them, and not once the mention is gone', async () => {
    publish.mockClear()
    const result = await saveText({ address: ADDRESS, folder: FOLDER }, blocks(textNaming('Ask, ', QA2)), blocks(textNaming('Ask ', QA2)), [QA2])
    expect(result).toEqual({ ok: true, refused: [] })
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1][0].tags).toContainEqual(['field', `member:${QA2}`])
    publish.mockClear()
    await saveText({ address: ADDRESS, folder: FOLDER }, blocks(textNaming('Ask')), blocks(textNaming('Ask ', QA2)), [QA2])
    expect(publish).toHaveBeenCalledTimes(1)
  })
})

describe('a change from a card', () => {
  const issue = (over: Partial<ForeignObject> = {}) =>
    ({
      address: '30851:f3:i',
      folder: 'folder-1',
      parentField: 'project',
      actions: [
        { id: 'set-status', label: 'Status', control: 'select', field: 'status', current: 'todo', options: [{ value: 'todo', label: 'Todo' }, { value: 'done', label: 'Done' }] },
        { id: 'move', label: 'Project', control: 'select', field: 'project', current: 'p', options: [{ value: 'q', label: 'Done' }] },
        { id: 'rename', label: 'Status', control: 'select', field: 'title', current: '', options: [{ value: 'Taken over', label: 'Done' }] },
      ],
      ...over,
    }) as Pick<ForeignObject, 'address' | 'folder' | 'actions' | 'archived' | 'parentField'>

  it('writes the status as one change of that field, in the file’s Folder', async () => {
    publish.mockClear()
    expect(await saveCardChoice(issue(), 'set-status', 'done')).toEqual({ ok: true })
    const sent = publish.mock.calls.at(-1)![0]
    expect(sent.tags.filter((t) => ['a', 'field', 'value', 'h'].includes(t[0]))).toEqual([
      ['a', '30851:f3:i'],
      ['field', 'status'],
      ['value', 'done'],
      ['h', 'folder-1'],
    ])
  })

  it('writes nothing for a file archived itself or with its project', async () => {
    publish.mockClear()
    expect((await saveCardChoice(issue({ archived: { by: 'f3', at: 1 } } as Partial<ForeignObject>), 'set-status', 'done')).ok).toBe(false)
    expect((await saveCardChoice(issue({ archived: { by: 'f3', at: 1, with: '30850:f3:p' } } as Partial<ForeignObject>), 'set-status', 'done')).ok).toBe(false)
    expect(publish).not.toHaveBeenCalled()
  })

  it('writes nothing to where a file is filed or to its words, from a card', async () => {
    publish.mockClear()
    expect((await saveCardChoice(issue(), 'move', 'q')).ok).toBe(false)
    expect((await saveCardChoice(issue(), 'rename', 'Taken over')).ok).toBe(false)
    expect(publish).not.toHaveBeenCalled()
  })
})
