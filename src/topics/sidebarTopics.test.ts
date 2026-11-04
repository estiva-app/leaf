import type { ForeignObject } from '@estiva-app/interop'
import { BLOCK_DOCUMENT_FORMAT, BODY_SLOT, planListInTopic, readTopics } from '@estiva-app/interop'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* LTN-2: which of your topics Leaf's sidebar shows, in what order, and the files each folds to. */

const ME = 'a'.repeat(64)
const MIKY = 'b'.repeat(64)
const HQ = 'hq-folder'

/* What the relay holds, answered filter by filter as it matches. */
let held: SignedEvent[] = []
type Filter = { ids?: string[]; kinds?: number[]; authors?: string[]; [tag: `#${string}`]: string[] | undefined }
function relay(filters: Filter[]): SignedEvent[] {
  const matches = (e: SignedEvent, f: Filter) =>
    (!f.ids || f.ids.includes(e.id)) &&
    (!f.kinds || f.kinds.includes(e.kind)) &&
    (!f.authors || f.authors.includes(e.pubkey)) &&
    Object.entries(f).every(([key, values]) => !key.startsWith('#') || e.tags.some((t) => t[0] === key.slice(1) && (values as string[]).includes(t[1])))
  return held.filter((e) => filters.some((f) => matches(e, f)))
}

/* When set, the relay refuses the read of your changes: the order's read. */
let changesRefused = false
/* What this tab sent to the relay. */
let sent: UnsignedEvent[] = []
vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => ME,
  query: async (filters: Filter[]) => {
    if (changesRefused && filters.some((f) => f.kinds?.includes(1111))) throw new Error('rate-limited')
    return relay(filters)
  },
  queryAll: async (filters: Filter[]) => relay(filters),
  publish: async (event: UnsignedEvent) => {
    sent.push(event)
    held.push(sign(event))
    return { ok: true }
  },
}))
vi.mock('../relay/manifests', () => ({ resolveQuery: async (filters: Filter[]) => relay(filters), projections: undefined }))
// A file outside the tree is drawn through its app's manifest; what that answers is stood in for here, as `outside` says.
let outside: Record<string, ForeignObject> = {}
vi.mock('@estiva-app/interop', async (original) => {
  const interop = await original<typeof import('@estiva-app/interop')>()
  return { ...interop, resolveForeignRoots: async (addresses: readonly string[]) => addresses.flatMap((a) => outside[a] ?? []) }
})

const { readSidebarTopics } = await import('./sidebarTopics')
const { useSidebarTopics } = await import('./useSidebarTopics')
const { resetTopicChoicesForTests, setListedInTopic } = await import('../document/fileTopics')

let n = 0
const sign = (e: UnsignedEvent): SignedEvent => ({ ...e, id: `e${++n}`.padStart(64, '0'), sig: '' }) as SignedEvent
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

/* A file Leaf opens, as the tree or its app's manifest draws it. */
function file(kind: 30842 | 30850 | 30851 | 30852, title: string, extra: Partial<ForeignObject> = {}): ForeignObject {
  const d = uuid(++n)
  const address = `${kind}:${MIKY}:${d}`
  held.push(sign({ kind, pubkey: MIKY, created_at: 1_700_000_000, tags: [['d', d], ['title', title], ['h', HQ]], content: '' }))
  // Ship's issue and project share their text with Leaf: a block-document description in the body slot.
  const shared = kind === 30850 || kind === 30851
  return {
    address,
    kind,
    ref: address,
    naddr: `naddr-${d}`,
    slots: { title: { value: title }, ...(shared ? { [BODY_SLOT]: { field: 'description' } } : {}) },
    actions: shared ? [{ control: 'text', field: 'description', format: BLOCK_DOCUMENT_FORMAT }] : [],
    ...extra,
  } as unknown as ForeignObject
}
function topic(author: string, title: string, files: ForeignObject[]) {
  const d = uuid(++n)
  const address = `30840:${author}:${d}`
  held.push(sign({ kind: 30840, pubkey: author, created_at: 1_700_000_000, tags: [['d', d], ['title', title], ['h', HQ]], content: '' }))
  for (const f of files) held.push(sign(planListInTopic(author, 1_700_000_050_000, { topic: { address, folder: HQ }, file: f.address!.split(':')[2] })[0]))
  return address
}
/* A save of a file's field by `by`, at `at` seconds. */
const save = (by: string, f: ForeignObject, at: number) =>
  held.push(sign({ kind: 1851, pubkey: by, created_at: at, tags: [['a', f.address!], ['field', 'title'], ['value', 'x'], ['h', HQ]], content: '' }))
const comment = (by: string, f: ForeignObject, at: number) =>
  held.push(sign({ kind: 1111, pubkey: by, created_at: at, tags: [['A', f.address!], ['a', f.address!], ['h', HQ]], content: 'On it.' }))

/* The tree holds `tree`; anything else is outside it. */
let tree: ForeignObject[] = []
const read = async () => readSidebarTopics(await readTopics(async (f) => relay(f as Filter[]), ME), (a) => tree.find((f) => f.address === a) ?? null)
const titles = async () => (await read()).map((t) => t.title)

beforeEach(() => {
  held = []
  tree = []
  outside = {}
  sent = []
  changesRefused = false
  resetTopicChoicesForTests()
})

describe('which of your topics the sidebar shows', () => {
  it('shows yours that list a file Leaf opens, and not one only someone else is in, a team’s space, an archived one, or one listing nothing Leaf opens', async () => {
    const page = file(30842, 'Launch plan')
    const elsewhere = file(30852, 'A bare file')
    tree = [page]
    topic(ME, 'Mine', [page])
    topic(MIKY, 'Miky’s alone', [page])
    const space = topic(ME, 'bugs', [page])
    // A team's list marks it one of its spaces.
    held.push(sign({ kind: 30890, pubkey: MIKY, created_at: 1_700_000_000, tags: [['d', 'team'], ['a', space, '', 'space']], content: '' }))
    const old = topic(ME, 'Old', [page])
    held.push(sign({ kind: 1851, pubkey: ME, created_at: 1_700_000_100, tags: [['a', old], ['field', 'archived'], ['value', 'true'], ['h', HQ]], content: '' }))
    topic(ME, 'Nothing for Leaf', [elsewhere])

    expect(await titles()).toEqual(['Mine'])
  })

  it('leaves out a topic whose every listed file is archived or unreadable, and the archived file from one it shows', async () => {
    const page = file(30842, 'Live page')
    const gone = file(30851, 'Shipped issue', { archived: { at: 1 } } as Partial<ForeignObject>)
    const hidden = file(30851, 'Private issue', { unreachable: true } as Partial<ForeignObject>)
    tree = [page]
    outside = { [gone.address!]: gone, [hidden.address!]: hidden }
    topic(ME, 'All done', [gone, hidden])
    topic(ME, 'Going', [page, gone])

    const topics = await read()
    expect(topics.map((t) => t.title)).toEqual(['Going'])
    expect(topics[0].files.map((f) => f.slots.title?.value)).toEqual(['Live page'])
  })

  it('folds each topic to its pages, then projects, then issues, each A–Z, a file outside the tree included', async () => {
    const issue = file(30851, 'An issue')
    const project = file(30850, 'Website')
    const second = file(30842, 'Notes')
    const first = file(30842, 'Agenda')
    tree = [second, first, project]
    outside = { [issue.address!]: issue }
    topic(ME, 'Launch', [issue, project, second, first])

    const [launch] = await read()
    expect(launch.files.map((f) => f.slots.title?.value)).toEqual(['Agenda', 'Notes', 'Website', 'An issue'])
  })
})

describe('the order of your topics', () => {
  it('puts first the topic where you last saved or commented on a listed file; someone else’s change does not count; the rest A–Z', async () => {
    const a = file(30842, 'A')
    const b = file(30842, 'B')
    const c = file(30842, 'C')
    const d = file(30842, 'D')
    tree = [a, b, c, d]
    topic(ME, 'Saved in', [a])
    topic(ME, 'Commented on', [b])
    topic(ME, 'Zebra, untouched by you', [c])
    topic(ME, 'Apple, untouched by you', [d])
    save(ME, a, 1_700_000_200)
    comment(ME, b, 1_700_000_300)
    // Miky's change is the newest of all, on a file of a topic you never touched.
    save(MIKY, c, 1_700_000_900)

    expect(await titles()).toEqual(['Commented on', 'Saved in', 'Apple, untouched by you', 'Zebra, untouched by you'])
  })

  it('dates a topic by the newest of its files', async () => {
    const old = file(30842, 'Old page')
    const fresh = file(30842, 'Fresh page')
    const middle = file(30842, 'Middle page')
    tree = [old, fresh, middle]
    topic(ME, 'Two files', [old, fresh])
    topic(ME, 'One file', [middle])
    save(ME, old, 1_700_000_100)
    save(ME, middle, 1_700_000_200)
    save(ME, fresh, 1_700_000_300)

    expect(await titles()).toEqual(['Two files', 'One file'])
  })

  it('still shows your topics, A–Z, when the relay refuses the read of your changes', async () => {
    const a = file(30842, 'A')
    const b = file(30842, 'B')
    tree = [a, b]
    topic(ME, 'Zebra', [a])
    topic(ME, 'Apple', [b])
    save(ME, a, 1_700_000_200)
    changesRefused = true

    await expect(titles()).resolves.toEqual(['Apple', 'Zebra'])
  })
})

describe('when you add a file to a topic or take one off in this tab', () => {
  it('folds the topic to what you added at once, shows a topic it is the first file of, and drops what you took off', async () => {
    const page = file(30842, 'Launch plan')
    const notes = file(30842, 'Press notes')
    tree = [page, notes]
    const launch = topic(ME, 'Launch', [page])
    const hiring = topic(ME, 'Hiring', [])
    const drawn = (state: ReturnType<typeof useSidebarTopics>) =>
      Array.isArray(state) ? state.map((t) => `${t.title}: ${t.files.map((f) => f.slots.title?.value).join(', ')}`) : state
    const { result } = renderHook(() => useSidebarTopics(true, (a) => tree.find((f) => f.address === a) ?? null))
    await waitFor(() => expect(drawn(result.current)).toEqual(['Launch: Launch plan']))

    await act(() => setListedInTopic({ address: hiring, folder: HQ }, notes.address!, true))
    await act(() => setListedInTopic({ address: launch, folder: HQ }, notes.address!, true))
    await act(() => setListedInTopic({ address: launch, folder: HQ }, page.address!, false))

    // The three entries went to the relay, signed by you, on each topic's list.
    expect(sent.map((e) => [e.kind, e.pubkey, e.tags.find((t) => t[0] === 'a')?.[1]])).toEqual([
      [1851, ME, hiring],
      [1851, ME, launch],
      [1851, ME, launch],
    ])
    await waitFor(() => expect(drawn(result.current)).toEqual(['Hiring: Press notes', 'Launch: Press notes']))
  })
})
