import { BLOCK_DOCUMENT_FORMAT, filesOf } from '@estiva-app/interop'
import { FILE_KINDS, type SignedEvent as NostrEvent } from '@estiva-app/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  The tree's read of a team once projects are switched (ISS-6): another app's project or issue costs its current
  values, by the relay's list read, while Leaf's own page keeps its current text — a page clicked in the tree opens
  from this copy, and the list read leaves a text unread.
*/
vi.mock('../config', () => ({ RELAY_URL: 'https://relay.test' }))
vi.mock('../relay/bridge', () => ({ viewerPubkey: () => 'a'.repeat(64), query: async () => [], publish: async () => ({ ok: true }), queryTimes: vi.fn() }))

import * as workspace from './workspace'
import { resetRelayReadsForTests } from '../relay/projectFields'
import { isListed } from './tree'

// Read by a path the bundler leaves alone, so the test loads on code with no row-only mark and fails on what it reads.
const ROW_ONLY = '../relay/rowOnly'
const rows: { isRowOnly?: (file: unknown) => boolean } = await import(/* @vite-ignore */ ROW_ONLY).catch(() => ({}))

const KEEPER = 'a'.repeat(64)
const RELAY = 'f'.repeat(64)
const TEAM = '11111111-0000-4000-8000-000000000001'
let seq = 0
const event = (partial: Partial<NostrEvent>): NostrEvent => ({
  id: String(++seq).padStart(64, '0'),
  sig: '',
  pubkey: KEEPER,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  kind: 1,
  ...partial,
})
const addressOf = (e: NostrEvent) => `${e.kind}:${e.pubkey}:${e.tags.find((t: string[]) => t[0] === 'd')![1]}`
type Filter = { kinds?: number[]; authors?: string[]; [key: string]: unknown }

const card = { widget: 'card', slots: { title: { tag: 'title' }, body: { fold: 'description', tag: 'description' } } }
const manifest = event({
  kind: 31990,
  tags: [['d', 'apps'], ['k', '30842'], ['k', '30850']],
  content: JSON.stringify({
    name: 'Apps',
    records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value', order: ['ts', 'created_at', 'id'], rule: 'last-write-wins-per-field' },
    projections: { 30842: card, 30850: card },
    // A project's text is shared, as Ship shares it: the tree lists another app's file only when it is.
    actions: [
      {
        id: 'edit-description',
        label: 'Edit',
        appliesTo: ['30850'],
        emits: { kind: 1851, field: 'description' },
        input: { type: 'string', format: BLOCK_DOCUMENT_FORMAT },
      },
    ],
  }),
})
const team = event({ kind: 39000, pubkey: RELAY, tags: [['d', TEAM], ['name', 'Team']] })
const page = event({ kind: 30842, tags: [['d', 'notes'], ['title', 'Notes'], ['description', 'First words'], ['h', TEAM]] })
const project = event({ kind: 30850, tags: [['d', 'season'], ['title', 'Season plan'], ['description', 'First words'], ['h', TEAM]] })
const changed = (file: NostrEvent) =>
  event({ kind: 1851, tags: [['a', addressOf(file)], ['field', 'description'], ['value', 'Newer words'], ['h', TEAM]] })
const events = [manifest, team, page, project, changed(page), changed(project)]

const matches = (e: NostrEvent, f: Filter) => {
  if (f.kinds && !f.kinds.includes(e.kind)) return false
  if (f.authors && !f.authors.includes(e.pubkey)) return false
  for (const [key, want] of Object.entries(f)) {
    if (!key.startsWith('#')) continue
    const held = e.tags.filter((t: string[]) => t[0] === key.slice(1)).map((t: string[]) => t[1])
    if (!(want as string[]).some((v) => held.includes(v))) return false
  }
  return true
}
/** The relay, with its list read (§6.13): `fields` filters answer their first records and each field's current change. */
const asked: Filter[] = []
async function relay(filters: Filter[]): Promise<NostrEvent[]> {
  asked.push(...filters)
  const byFields = filters.filter((f) => 'fields' in f)
  const plain = (fs: Filter[]) => events.filter((e) => fs.some((f) => matches(e, f)))
  if (byFields.length === 0) return plain(filters)
  if (byFields.length !== filters.length) throw new Error('fields: every filter must ask for "fields"')
  if (byFields.some((f) => f.kinds?.some((kind: number) => !FILE_KINDS.includes(kind)))) throw new Error('fields: kinds must be file kinds')
  const roots = plain(byFields)
  return [...roots, ...filesOf(events).filter((file) => roots.includes(file.root)).flatMap((file) => file.events.slice(1))]
}

function relayKeeps(inOrder: string[], lists = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ files: { requires_prev: inOrder }, ...(lists ? { file_list: { newest: true, text: true, times: true } } : {}) }),
    })),
  )
}

beforeEach(() => {
  resetRelayReadsForTests()
  asked.length = 0
})
afterEach(() => vi.unstubAllGlobals())

describe("the tree's read of a team, once projects are switched (ISS-6)", () => {
  it('reads a project and a Leaf page by the list read, each for its row only, so no old save of a page is read', async () => {
    relayKeeps(['osnova.project'])
    const contents = await workspace.readFolder(TEAM, relay)
    const file = (title: string) => contents.files.find((f) => f.slots.title?.value === title)!
    // Each row costs its current values; its page reads it again by its address, with its current text (ALL-4).
    expect(asked.some((f) => 'fields' in f && f.kinds?.includes(30850))).toBe(true)
    expect(asked.some((f) => 'fields' in f && f.kinds?.includes(30842))).toBe(true)
    expect(asked.some((f) => !('fields' in f) && ((f['#a'] as string[] | undefined) ?? []).some((a) => a.startsWith('30842:')))).toBe(false)
    expect(rows.isRowOnly?.(file('Season plan'))).toBe(true)
    expect(rows.isRowOnly?.(file('Notes'))).toBe(true)
    // Its text unread, the tree still lists each.
    expect(isListed(file('Season plan'))).toBe(true)
    expect(isListed(file('Notes'))).toBe(true)
  })

  it('reads a page by the list read before the relay keeps pages in order (record: the read does not wait for the switch)', async () => {
    relayKeeps([])
    const contents = await workspace.readFolder(TEAM, relay)
    expect(asked.some((f) => 'fields' in f && f.kinds?.includes(30842))).toBe(true)
    expect(rows.isRowOnly?.(contents.files.find((f) => f.slots.title?.value === 'Notes')!)).toBe(true)
  })

  it('reads every file whole on a relay that offers no list read (control)', async () => {
    relayKeeps([], false)
    const contents = await workspace.readFolder(TEAM, relay)
    expect(asked.some((f) => 'fields' in f)).toBe(false)
    const notes = contents.files.find((f) => f.slots.title?.value === 'Notes')!
    expect(notes.slots.body?.value).toBe('Newer words')
    expect(rows.isRowOnly?.(notes)).toBe(false)
    expect(isListed(notes)).toBe(true)
  })
})
