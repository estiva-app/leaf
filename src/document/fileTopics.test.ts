import type { ForeignObject } from '@estiva-app/interop'
import { planListInTopic, planRemoveFromTopic } from '@estiva-app/interop'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* TOP-6: which topics a Leaf file's Topics row names, and what Add to topic offers, read from the relay. */

const ME = 'a'.repeat(64)
const MIKY = 'b'.repeat(64)
const DOC = '3518cd7b-5b85-49e8-ba94-4aacacad2163'
const HQ = 'hq-folder'

/* What the relay holds, answered filter by filter as it matches. */
let held: SignedEvent[] = []
/* What each topic's projection says: its title, where it opens, archived, or unreachable to this reader. */
let projected: Record<string, { title: string; openUrl?: string; archived?: boolean; unreachable?: boolean }> = {}
/* Who is signed in: nobody when undefined. */
let viewer: string | undefined = ME

type Filter = { ids?: string[]; kinds?: number[]; authors?: string[]; [tag: `#${string}`]: string[] | undefined }
function relay(filters: Filter[]): SignedEvent[] {
  const matches = (e: SignedEvent, f: Filter) =>
    (!f.ids || f.ids.includes(e.id)) &&
    (!f.kinds || f.kinds.includes(e.kind)) &&
    (!f.authors || f.authors.includes(e.pubkey)) &&
    Object.entries(f).every(([key, values]) => !key.startsWith('#') || e.tags.some((t) => t[0] === key.slice(1) && (values as string[]).includes(t[1])))
  return held.filter((e) => filters.some((f) => matches(e, f)))
}

vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => viewer,
  query: async (filters: Filter[]) => relay(filters),
  queryAll: async (filters: Filter[]) => {
    reads += 1
    return relay(filters)
  },
  publish: async () => ({ ok: true }),
}))
vi.mock('../relay/manifests', () => ({ resolveQuery: async (filters: Filter[]) => relay(filters), projections: undefined }))
// A topic's link and its unreachable stub need Peek's manifest; for a topic made with `topic` below, what it answers is
// stood in for here. Any other address is interop's own read of the events the relay holds.
vi.mock('@estiva-app/interop', async (original) => {
  const interop = await original<typeof import('@estiva-app/interop')>()
  return {
    ...interop,
    resolveForeignRoots: async (addresses: readonly string[], ...rest: unknown[]) =>
      !addresses.some((address) => address in projected)
        ? (interop.resolveForeignRoots as (...args: unknown[]) => Promise<ForeignObject[]>)(addresses, ...rest)
        : addresses.map((address) => {
            const p = projected[address]
            return { address, unreachable: p?.unreachable, openUrl: p?.openUrl, archived: p?.archived ? { at: 1 } : undefined, slots: { title: { value: p?.title } } } as unknown as ForeignObject
          }),
  }
})

/* Reads that went to the relay through queryAll. */
let reads = 0

const { readFileTopics, readTopicChoices, resetTopicChoicesForTests, topicChoicesNow } = await import('./fileTopics')

let n = 0
const sign = (e: UnsignedEvent): SignedEvent => ({ ...e, id: `e${++n}`.padStart(64, '0'), sig: '' }) as SignedEvent
function topic(author: string, d: string, title: string, extra: Partial<(typeof projected)[string]> = {}) {
  const address = `30840:${author}:${d}`
  held.push(sign({ kind: 30840, pubkey: author, created_at: 1_700_000_000, tags: [['d', d], ['h', HQ]], content: '' }))
  projected[address] = { title, openUrl: `https://peek.estiva.app/topic/${d}`, ...extra }
  return { address, folder: HQ }
}
const list = (by: string, t: { address: string; folder: string }, at: number) => held.push(sign(planListInTopic(by, at, { topic: t, file: DOC })[0]))
const unlist = (by: string, t: { address: string; folder: string }, at: number) => held.push(sign(planRemoveFromTopic(by, at, { topic: t, file: DOC })[0]))

beforeEach(() => {
  held = []
  projected = {}
  viewer = ME
  reads = 0
  resetTopicChoicesForTests()
})

describe('the topics a file’s row names', () => {
  it('names each topic whose newest entry lists the file, A–Z, with where it opens', async () => {
    const widgets = topic(MIKY, 'widgets', 'Widgets')
    const design = topic(MIKY, 'design', 'Design review')
    const old = topic(MIKY, 'old', 'Old launch')
    list(MIKY, widgets, 1_700_000_100_000)
    list(MIKY, design, 1_700_000_100_000)
    list(MIKY, old, 1_700_000_100_000)
    unlist(ME, old, 1_700_000_200_000)

    const topics = await readFileTopics(DOC)
    expect(topics.map((t) => t.title)).toEqual(['Design review', 'Widgets'])
    expect(topics[1]).toMatchObject({ address: widgets.address, folder: HQ, openUrl: 'https://peek.estiva.app/topic/widgets', archived: false })
  })

  it('leaves out a topic the reader cannot read, and opens nowhere a manifest names that is not https', async () => {
    const hidden = topic(MIKY, 'hidden', 'Private plans', { unreachable: true })
    const plain = topic(MIKY, 'plain', 'Plain link', { openUrl: 'javascript:alert(1)' })
    list(MIKY, hidden, 1_700_000_100_000)
    list(MIKY, plain, 1_700_000_100_000)

    const topics = await readFileTopics(DOC)
    expect(topics.map((t) => t.title)).toEqual(['Plain link'])
    expect(topics[0].openUrl).toBeUndefined()
  })

  it('marks an archived topic, so its chip has no Remove', async () => {
    const old = topic(MIKY, 'old', 'Old launch', { archived: true })
    list(MIKY, old, 1_700_000_100_000)
    expect((await readFileTopics(DOC))[0]).toMatchObject({ title: 'Old launch', archived: true })
  })

  it('marks a topic archived with the one it sits under, so its chip has no Remove either', async () => {
    // What the relay holds, read by interop: the parent's archive is a change on the parent, none on the topic itself.
    const parent = rootOf(MIKY, 'launch', 'Launch')
    archive(parent)
    const under = rootOf(MIKY, 'under', 'Under the launch', HQ, parent)
    list(MIKY, { address: under, folder: HQ }, 1_700_000_100_000)
    expect((await readFileTopics(DOC))[0]).toMatchObject({ title: 'Under the launch', archived: true })
  })
})

/* Add to topic reads interop's one read of every topic (SHIPS-2), which resolves the topics itself: these fixtures are
   what the relay holds, the title on the root and an archive as its change, with no stand-in projection. */
const SUB = 'sub-folder'
const CLOSED = 'closed-folder'
/** A Folder the relay lists for the reader: its state, as `listFolders` reads it. */
const folderState = (id: string) => held.push(sign({ kind: 39000, pubkey: MIKY, created_at: 1_700_000_000, tags: [['d', id], ['name', id]], content: '' }))
function rootOf(author: string, d: string, title: string, folder = HQ, parent?: string) {
  held.push(sign({ kind: 30840, pubkey: author, created_at: 1_700_000_000, tags: [['d', d], ['title', title], ['h', folder], ...(parent ? [['a', parent]] : [])], content: '' }))
  return `30840:${author}:${d}`
}
const archive = (address: string, folder = HQ) =>
  held.push(sign({ kind: 1851, pubkey: MIKY, created_at: 1_700_000_200, tags: [['a', address], ['O', address.split(':')[2]], ['field', 'archived'], ['value', 'true'], ['h', folder]], content: '' }))

describe('what Add to topic offers', () => {
  it('splits the topics you can add to into yours and the others, each A–Z, and leaves out archived ones', async () => {
    folderState(HQ)
    folderState(SUB)
    rootOf(ME, 'mine', 'My notes')
    rootOf(MIKY, 'zeta', 'Zeta')
    // In a second Folder the relay lists for you.
    rootOf(MIKY, 'alpha', 'Alpha', SUB)
    archive(rootOf(MIKY, 'old', 'Old launch'))
    // Archived with the topic it sits under: read-only too.
    const parent = rootOf(MIKY, 'parent', 'Parent')
    archive(parent)
    rootOf(MIKY, 'child', 'Child', HQ, parent)

    const choices = await readTopicChoices()
    expect(choices.yours.map((t) => t.title)).toEqual(['My notes'])
    expect(choices.others.map((t) => t.title)).toEqual(['Alpha', 'Zeta'])
  })

  it('leaves out a topic in a Folder the relay does not list for you, which would refuse the entry', async () => {
    folderState(HQ)
    rootOf(MIKY, 'open', 'Open')
    rootOf(MIKY, 'closed', 'Closed', CLOSED)

    const choices = await readTopicChoices()
    expect([...choices.yours, ...choices.others].map((t) => t.title)).toEqual(['Open'])
  })

  // why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/writing-in-a-place-never-follows-it.md
  it('does not count a topic as yours because you have written in its conversation', async () => {
    folderState(HQ)
    const zeta = rootOf(MIKY, 'zeta', 'Zeta')
    held.push(sign({ kind: 1111, pubkey: ME, created_at: 1_700_000_300, tags: [['A', zeta], ['a', zeta], ['h', HQ]], content: 'On it.' }))

    const choices = await readTopicChoices()
    expect(choices.yours).toEqual([])
    expect(choices.others.map((t) => t.title)).toEqual(['Zeta'])
  })

  it('opened again, gives the held choices at once, and a topic made or archived since once the fresh read lands', async () => {
    folderState(HQ)
    rootOf(MIKY, 'beta', 'Beta')
    const old = rootOf(MIKY, 'old', 'Old')
    expect(topicChoicesNow()).toBeUndefined()
    await readTopicChoices()
    rootOf(MIKY, 'gamma', 'Gamma')
    archive(old)
    expect(topicChoicesNow()?.others.map((t) => t.title)).toEqual(['Beta', 'Old'])
    expect((await readTopicChoices()).others.map((t) => t.title)).toEqual(['Beta', 'Gamma'])
  })

  it('asks the relay nothing when nobody is signed in, and says why', async () => {
    folderState(HQ)
    rootOf(MIKY, 'beta', 'Beta')
    viewer = undefined
    await expect(readTopicChoices()).rejects.toThrow('Sign in to add it to a topic.')
    expect(reads).toBe(0)
  })
})
