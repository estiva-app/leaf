import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

/**
 * A relay that keeps a project's fields in order (SPEC §6.2): a change naming a `prev` that is no longer its field's
 * newest is refused with `conflict: <field> follows <id>`, as production answers.
 */
const relay = vi.hoisted(() => ({ events: [] as SignedEvent[], sent: [] as SignedEvent[], next: 0 }))
const newest = (address: string, field: string) =>
  relay.events.filter((e) => e.kind === 1851 && e.tags.some((t) => t[0] === 'a' && t[1] === address) && e.tags.some((t) => t[0] === 'field' && t[1] === field)).at(-1)
vi.mock('../relay/bridge', () => ({
  query: vi.fn(async (filters: Record<string, unknown>[]) =>
    relay.events.filter((e) => filters.some((f) => (f.ids as string[] | undefined)?.includes(e.id))),
  ),
  publish: vi.fn(async () => ({ ok: true })),
  viewerPubkey: () => 'a'.repeat(64),
  changeWriter: {
    sign: async (event: UnsignedEvent) => ({ ...event, id: (++relay.next).toString(16).padStart(64, '0'), sig: '' }) as SignedEvent,
    publish: async (event: SignedEvent) => {
      relay.sent.push(event)
      const address = event.tags.find((t) => t[0] === 'a')![1]
      const field = event.tags.find((t) => t[0] === 'field')![1]
      const prev = event.tags.find((t) => t[0] === 'prev')?.[1]
      const current = newest(address, field)?.id ?? ROOT.id
      if (prev !== current) return { ok: false, reason: `conflict: ${field} follows ${current}`, eventId: event.id }
      relay.events.push(event)
      return { ok: true, eventId: event.id }
    },
  },
}))
import { saveCardChoice, saveField, saveText, setDeleted, noteRead, onMerged } from './save'

const OWNER = 'b'.repeat(64)
const THEM = 'c'.repeat(64)
const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
let ADDRESS = `30850:${OWNER}:p1`
const ROOT = { id: 'f'.repeat(64), kind: 30850, pubkey: OWNER, created_at: 1_760_000_000, tags: [['d', 'p1'], ['h', FOLDER]], content: '', sig: '' } as SignedEvent
const tag = (event: { tags: string[][] }, name: string) => event.tags.find((t) => t[0] === name)?.[1]
const doc = (...paragraphs: [string, string][]) =>
  JSON.stringify({ type: 'doc', content: paragraphs.map(([id, text]) => ({ type: 'paragraph', id, content: [{ type: 'text', text }] })) })
const FORMAT = 'estiva-blocks-1'
/** Someone else's change, already on the relay, after `prev`. */
function theirs(field: string, value: string, prev: string, format?: string): SignedEvent {
  const event = {
    id: (++relay.next).toString(16).padStart(64, '0'),
    kind: 1851,
    pubkey: THEM,
    created_at: 1_760_000_100,
    tags: [['a', ADDRESS], ['O', 'p1'], ['field', field], ['value', value], ['h', FOLDER], ...(format ? [['content-format', format]] : []), ['prev', prev]],
    content: '',
    sig: '',
  } as SignedEvent
  relay.events.push(event)
  return event
}
/** The project as Leaf opened it by its fields, with the text it showed. */
const opened = (text: string, prevs: Record<string, string> = {}) => {
  // Its first record holds the text it was made with: what a first text change follows, and what a merge starts from.
  ROOT.tags = [['d', 'p1'], ['h', FOLDER], ['description', text], ['content-format', FORMAT]]
  const file = { address: ADDRESS, folder: FOLDER, eventId: ROOT.id, prevs, slots: { body: { value: text, format: FORMAT } } }
  noteRead(file as never)
  return file
}

beforeEach(() => {
  relay.events = [ROOT]
  relay.sent = []
})

// A project and an issue (ALO-6, ISS-6): the same saves.
describe.each([
  ['project', 30850],
  ['issue', 30851],
])('a %s read by its fields, saved from Leaf', (noun, kind) => {
  beforeEach(() => {
    ADDRESS = `${kind}:${OWNER}:p1`
    ROOT.kind = kind
  })

  it('names the change a title follows, and the first record for its first change', async () => {
    const file = opened('')
    expect(await saveField(file, 'title', 'Renamed')).toEqual({ ok: true })
    const [sent] = relay.sent
    expect(tag(sent, 'field')).toBe('title')
    expect(tag(sent, 'prev')).toBe(ROOT.id)
    expect(tag(sent, 'O')).toBe('p1')
  })

  it('writes a status picked on its card in order, with what the status means last (EAC-5)', async () => {
    const file = opened('')
    const card = { ...file, archived: undefined, parentField: undefined, actions: [{ id: 'set-status', field: 'status', control: 'select', options: [{ value: 'planned', stage: 'open' }, { value: 'completed', stage: 'done' }] }] }
    expect(await saveCardChoice(card as never, 'set-status', 'completed')).toEqual({ ok: true })
    const [sent] = relay.sent
    expect(tag(sent, 'prev')).toBe(ROOT.id)
    expect(sent.tags.at(-1)).toEqual(['stage', 'status', 'done'])
  })

  it('sets a title again on top of one someone else saved since it was opened, asking nobody', async () => {
    const file = opened('')
    const their = theirs('title', 'Their name', ROOT.id)
    expect(await saveField(file, 'title', 'My name')).toEqual({ ok: true })
    expect(relay.sent).toHaveLength(2)
    expect(tag(relay.sent[1], 'prev')).toBe(their.id)
    expect(tag(newest(ADDRESS, 'title')!, 'value')).toBe('My name')
  })

  it(`writes the first words of a ${noun} nobody has changed since it was made, after its first record (ISS-6)`, async () => {
    // Read with no change at all: no `prevs`, and no body, since its text is empty.
    ROOT.tags = [['d', 'p1'], ['h', FOLDER]]
    const file = { address: ADDRESS, folder: FOLDER, eventId: ROOT.id, slots: {} }
    noteRead(file as never)
    const words = doc(['b1', 'First words'])
    expect(await saveText(file as never, { content: words, format: FORMAT }, { content: '' })).toEqual({ ok: true, refused: [] })
    const [sent] = relay.sent
    expect(tag(sent, 'field')).toBe('description')
    expect(tag(sent, 'prev')).toBe(ROOT.id)
    expect(tag(sent, 'value')).toBe(words)
  })

  it("merges a text onto someone's newer save of another block, keeping both", async () => {
    const base = doc(['b1', 'one'], ['b2', 'two'])
    const file = opened(base)
    theirs('description', doc(['b1', 'ONE'], ['b2', 'two']), ROOT.id, FORMAT)
    const result = await saveText(file, { content: doc(['b1', 'one'], ['b2', 'TWO']), format: FORMAT }, { content: base, format: FORMAT })
    expect(result).toEqual({ ok: true, refused: [] })
    const saved = tag(newest(ADDRESS, 'description')!, 'value')!
    expect(saved).toContain('ONE')
    expect(saved).toContain('TWO')
  })

  it('tells the open page to read the text again when a save merged onto someone’s, and not when it followed mine', async () => {
    const heard: string[] = []
    const stop = onMerged((address) => heard.push(address))
    try {
      const base = doc(['b1', 'one'], ['b2', 'two'])
      const file = opened(base)
      const mine = doc(['b1', 'one'], ['b2', 'TWO'])
      await saveText(file, { content: mine, format: FORMAT }, { content: base, format: FORMAT })
      expect(heard).toEqual([])
      theirs('description', doc(['b1', 'ONE'], ['b2', 'TWO']), newest(ADDRESS, 'description')!.id, FORMAT)
      await saveText(file, { content: doc(['b1', 'one'], ['b2', 'TWO!']), format: FORMAT }, { content: mine, format: FORMAT })
      expect(heard).toEqual([ADDRESS])
    } finally {
      stop()
    }
  })

  it('asks for a block both changed and saves nothing, holding their words beside mine', async () => {
    const base = doc(['b1', 'one'])
    const file = opened(base)
    const their = theirs('description', doc(['b1', 'theirs']), ROOT.id, FORMAT)
    const result = await saveText(file, { content: doc(['b1', 'mine']), format: FORMAT }, { content: base, format: FORMAT })
    expect(result.ok).toBe(false)
    const asks = (result as { asks?: { blocks: readonly string[]; theirs: string; mine: string } }).asks!
    expect(asks.blocks).toEqual(['b1'])
    expect(asks.theirs).toContain('theirs')
    expect(asks.mine).toContain('mine')
    expect(newest(ADDRESS, 'description')!.id).toBe(their.id)
  })

  it(`restores a deleted ${noun} with the deleted field set empty, after the delete`, async () => {
    const del = theirs('deleted', 'true', ROOT.id)
    const file = opened('', { deleted: del.id })
    expect(await setDeleted(file, false)).toEqual({ ok: true })
    const [sent] = relay.sent
    expect(tag(sent, 'field')).toBe('deleted')
    expect(tag(sent, 'value')).toBe('')
    expect(tag(sent, 'prev')).toBe(del.id)
  })
})
