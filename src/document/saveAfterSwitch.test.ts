import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

/**
 * A relay that makes the switch while a tab is open (ALO-8): before it, it takes a project change with no `prev` and
 * its NIP-11 says nothing of `requires_prev`; after it, its NIP-11 names `osnova.project` and it refuses a project
 * change that names no `prev` with production's words, and one whose `prev` is stale with `conflict:`. It answers the
 * list read (`fields: 'newest'`) with the first record and each field's current change.
 */
const SWITCH_REFUSAL = 'invalid: a project change names the change it follows in prev (the relay keeps projects in order)'
const relay = vi.hoisted(() => ({
  events: [] as SignedEvent[],
  sent: [] as SignedEvent[],
  next: 0,
  switched: false,
  /** Refuse every change with these words, whatever it names. */
  refuseAll: undefined as string | undefined,
}))
const tagOf = (event: { tags: string[][] }, name: string) => event.tags.find((t) => t[0] === name)?.[1]
const newest = (address: string, field: string) => relay.events.filter((e) => e.kind === 1851 && tagOf(e, 'a') === address && tagOf(e, 'field') === field).at(-1)
function answer(event: SignedEvent): { ok: boolean; reason?: string; eventId: string } {
  relay.sent.push(event)
  if (relay.refuseAll) return { ok: false, reason: relay.refuseAll, eventId: event.id }
  const address = tagOf(event, 'a')!
  const field = tagOf(event, 'field')!
  const prev = tagOf(event, 'prev')
  if (relay.switched && address.startsWith('30850:') && !field.startsWith('member:')) {
    if (!prev) return { ok: false, reason: SWITCH_REFUSAL, eventId: event.id }
    const current = newest(address, field)?.id ?? relay.events[0].id
    if (prev !== current) return { ok: false, reason: `conflict: ${field} follows ${current}`, eventId: event.id }
  }
  relay.events.push(event)
  return { ok: true, eventId: event.id }
}
const signed = (event: UnsignedEvent) => ({ ...event, id: (++relay.next).toString(16).padStart(64, '0'), sig: '' }) as SignedEvent
vi.mock('../relay/bridge', () => ({
  query: vi.fn(async (filters: Record<string, unknown>[]) =>
    filters.flatMap((f) => {
      if (f.ids) return relay.events.filter((e) => (f.ids as string[]).includes(e.id))
      if (f.fields === 'newest') {
        const [root] = relay.events
        if (!(f['#d'] as string[]).includes(tagOf(root, 'd')!)) return []
        const changes = relay.events.filter((e) => e.kind === 1851)
        const fields = new Set(changes.map((e) => tagOf(e, 'field')!))
        return [root, ...[...fields].map((field) => newest(tagOf(root, 'a') ?? ADDRESS, field)!)]
      }
      return []
    }),
  ),
  publish: vi.fn(async (event: UnsignedEvent) => answer(signed(event))),
  viewerPubkey: () => 'a'.repeat(64),
  changeWriter: { sign: async (event: UnsignedEvent) => signed(event), publish: async (event: SignedEvent) => answer(event) },
}))
vi.mock('../config', async (original) => ({ ...(await original<typeof import('../config')>()), RELAY_URL: 'https://relay.test' }))

const OWNER = 'b'.repeat(64)
const THEM = 'c'.repeat(64)
const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const ADDRESS = `30850:${OWNER}:p1`
const FORMAT = 'estiva-blocks-1'
const doc = (...paragraphs: [string, string][]) =>
  JSON.stringify({ type: 'doc', content: paragraphs.map(([id, text]) => ({ type: 'paragraph', id, content: [{ type: 'text', text }] })) })
const root = (text: string) =>
  ({ id: 'f'.repeat(64), kind: 30850, pubkey: OWNER, created_at: 1_760_000_000, tags: [['d', 'p1'], ['h', FOLDER], ['description', text], ['content-format', FORMAT]], content: '', sig: '' }) as SignedEvent
/** Someone's change, saved on the relay before the switch: with no `prev`. */
function theirs(field: string, value: string, format?: string): SignedEvent {
  const event = signed({ kind: 1851, pubkey: THEM, created_at: 1_760_000_100, tags: [['a', ADDRESS], ['O', 'p1'], ['field', field], ['value', value], ['h', FOLDER], ...(format ? [['content-format', format]] : [])], content: '' })
  relay.events.push(event)
  return event
}
/** The project as a tab opened it before the switch: read the old way, so it names no change it follows. */
const FILE = { address: ADDRESS, folder: FOLDER, eventId: 'f'.repeat(64) }

let save: typeof import('./save')
beforeEach(async () => {
  relay.events = [root(doc(['b1', 'one'], ['b2', 'two']))]
  relay.sent = []
  relay.switched = false
  relay.refuseAll = undefined
  const nip11 = () => ({ file_list: { newest: true, text: true }, ...(relay.switched ? { files: { requires_prev: ['osnova.project'] } } : {}) })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => nip11() })))
  // A fresh tab, which read the relay's NIP-11 when it opened, before the switch.
  vi.resetModules()
  save = await import('./save')
  expect(await (await import('../relay/projectFields')).projectFields()).toBeUndefined()
})

describe('a tab open across the switch saves a project by itself (ALO-8)', () => {
  it('writes a title refused at the switch again after its current change, and every later save in order', async () => {
    expect(await save.saveField(FILE, 'title', 'Before')).toEqual({ ok: true })
    const before = relay.sent[0]
    expect(tagOf(before, 'prev')).toBeUndefined()
    relay.switched = true
    relay.sent = []

    expect(await save.saveField(FILE, 'title', 'After')).toEqual({ ok: true })
    expect(relay.sent).toHaveLength(2)
    expect(tagOf(relay.sent[0], 'prev')).toBeUndefined()
    expect(tagOf(relay.sent[1], 'prev')).toBe(before.id)
    expect(tagOf(newest(ADDRESS, 'title')!, 'value')).toBe('After')

    // The tab has switched: the next save names the change it follows from the first send.
    const after = relay.sent[1]
    relay.sent = []
    expect(await save.saveField(FILE, 'title', 'Later')).toEqual({ ok: true })
    expect(relay.sent).toHaveLength(1)
    expect(tagOf(relay.sent[0], 'prev')).toBe(after.id)
  })

  it('writes a first summary refused at the switch again after the first record', async () => {
    relay.switched = true
    expect(await save.saveField(FILE, 'summary', 'Short')).toEqual({ ok: true })
    expect(relay.sent).toHaveLength(2)
    expect(tagOf(relay.sent[1], 'prev')).toBe('f'.repeat(64))
  })

  it("writes the text again after the current one, keeping the words someone saved since the tab loaded it", async () => {
    const loaded = doc(['b1', 'one'], ['b2', 'two'])
    const their = theirs('description', doc(['b1', 'ONE'], ['b2', 'two']), FORMAT)
    relay.switched = true
    const result = await save.saveText(FILE, { content: doc(['b1', 'one'], ['b2', 'TWO']), format: FORMAT }, { content: loaded, format: FORMAT })
    expect(result).toEqual({ ok: true, refused: [] })
    const again = relay.sent.at(-1)!
    expect(tagOf(again, 'prev')).toBe(their.id)
    expect(tagOf(again, 'value')).toContain('ONE')
    expect(tagOf(again, 'value')).toContain('TWO')
  })

  it('saves the text after a title already switched the tab, keeping the words someone saved since it loaded', async () => {
    const loaded = doc(['b1', 'one'], ['b2', 'two'])
    const their = theirs('description', doc(['b1', 'ONE'], ['b2', 'two']), FORMAT)
    relay.switched = true
    expect(await save.saveField(FILE, 'title', 'After')).toEqual({ ok: true })
    relay.sent = []

    const result = await save.saveText(FILE, { content: doc(['b1', 'one'], ['b2', 'TWO']), format: FORMAT }, { content: loaded, format: FORMAT })
    expect(result).toEqual({ ok: true, refused: [] })
    expect(relay.sent).toHaveLength(1)
    expect(tagOf(relay.sent[0], 'prev')).toBe(their.id)
    expect(tagOf(relay.sent[0], 'value')).toContain('ONE')
    expect(tagOf(relay.sent[0], 'value')).toContain('TWO')
  })

  it('writes a card choice refused at the switch again after its current change', async () => {
    const status = theirs('status', 'todo')
    relay.switched = true
    const card = { ...FILE, archived: undefined, parentField: undefined, actions: [{ id: 'status', field: 'status', control: 'select', options: [{ value: 'todo' }, { value: 'done' }] }] }
    expect(await save.saveCardChoice(card as never, 'status', 'done')).toEqual({ ok: true })
    expect(relay.sent).toHaveLength(2)
    expect(tagOf(relay.sent[1], 'prev')).toBe(status.id)
    expect(tagOf(newest(ADDRESS, 'status')!, 'value')).toBe('done')
  })

  it('does not write again on a refusal other than the switch', async () => {
    relay.switched = true
    relay.refuseAll = 'blocked: not a member of this team'
    expect(await save.saveField(FILE, 'title', 'After')).toEqual({ ok: false, reason: 'Could not save. Your text is still here.' })
    expect(relay.sent).toHaveLength(1)
  })

  it('shows a second switch refusal as any refusal, writing again only once', async () => {
    relay.switched = true
    relay.refuseAll = SWITCH_REFUSAL
    expect(await save.saveField(FILE, 'title', 'After')).toEqual({ ok: false, reason: 'Could not save. Your text is still here.' })
    expect(relay.sent).toHaveLength(2)
    expect(tagOf(relay.sent[1], 'prev')).toBe('f'.repeat(64))
  })
})
