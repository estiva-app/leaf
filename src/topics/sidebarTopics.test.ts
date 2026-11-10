import type { ForeignObject } from '@estiva-app/interop'
import { readTopics } from '@estiva-app/interop'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HQ, ME, MIKY, archive, bridge, file, markSpace, muteList, nip44, readsMuted, readsTopics, relay, said, topic } from './fixtures/topicsRelay'

/* LTN-2, TOPI-4: which of your topics Leaf's sidebar shows, in what order, when it reorders, and the files each folds to. */

vi.mock('../relay/bridge', async () => (await import('./fixtures/topicsRelay')).bridge)
// Estiva ID's encryption is a round trip: the fixture's stand-in reads the mute list (see `fixtures/topicsRelay.ts`).
vi.mock('../auth/nip44', async () => ({ nip44: (await import('./fixtures/topicsRelay')).nip44 }))
vi.mock('../relay/manifests', async () => ({ resolveQuery: (await import('./fixtures/topicsRelay')).bridge.query, projections: undefined }))
// A file outside the tree is drawn through its app's manifest; what that answers is stood in for here, as `outside` says.
let outside: Record<string, ForeignObject> = {}
// Every address resolved outside the tree: each is a read of all of that file's changes.
let resolvedOutside: string[] = []
vi.mock('@estiva-app/interop', async (original) => {
  const interop = await original<typeof import('@estiva-app/interop')>()
  return {
    ...interop,
    resolveForeignRoots: async (addresses: readonly string[]) => {
      resolvedOutside.push(...addresses)
      return addresses.flatMap((a) => outside[a] ?? [])
    },
  }
})

const { readSidebarTopics } = await import('./sidebarTopics')
const { useSidebarTopics } = await import('./useSidebarTopics')
// The tab's per-topic answers and last mute list stay between tests: every test's topics and events are new ones.
const { resetTopicChoicesForTests, setListedInTopic } = await import('../document/fileTopics')

/* The tree holds `tree`; anything else is outside it. */
let tree: ForeignObject[] = []
const inTree = (a: string) => tree.find((f) => f.address === a) ?? null
const read = async () => readSidebarTopics((await readTopics(bridge.queryAll as never, ME)).topics, inTree)
const drawn = (state: ReturnType<typeof useSidebarTopics>) => (Array.isArray(state) ? state.map((t) => t.title) : state)

beforeEach(() => {
  relay.reset()
  nip44.decrypting = undefined
  nip44.decrypts = 0
  tree = []
  outside = {}
  resolvedOutside = []
  resetTopicChoicesForTests()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('which five of your topics the sidebar shows', () => {
  it('shows your five newest by activity; never a muted one, a team’s space, an archived one or one you are not in; one listing nothing Leaf opens still shows', async () => {
    const page = file(30842, 'Launch plan')
    const bare = file(30852, 'A bare file')
    tree = [page]
    for (let i = 1; i <= 6; i++) said(topic(ME, `T${i}`, [page]), 1_700_001_000 + i * 100)
    // Each of these is newer than all six.
    const muted = topic(ME, 'Muted', [page])
    said(muted, 1_700_009_000)
    muteList([muted])
    const space = topic(ME, 'bugs', [page])
    said(space, 1_700_009_100)
    markSpace(space)
    const old = topic(ME, 'Old', [page])
    said(old, 1_700_009_200)
    archive(old)
    said(topic(MIKY, 'Miky’s alone', [page]), 1_700_009_300)
    said(topic(ME, 'Nothing for Leaf', [bare]), 1_700_008_000)

    const { result } = renderHook(() => useSidebarTopics(true, inTree))
    await waitFor(() => expect(Array.isArray(result.current)).toBe(true))
    expect(drawn(result.current)).toEqual(['Nothing for Leaf', 'T6', 'T5', 'T4', 'T3'])
    const nothing = (result.current as Exclude<typeof result.current, string>)[0]
    expect(nothing.files).toEqual([])
  })

  it('draws no topic before your mute list answers, so a muted one is never drawn and then taken out', async () => {
    const page = file(30842, 'Launch plan')
    tree = [page]
    const muted = topic(ME, 'Muted', [page], 1_700_000_900)
    topic(ME, 'Kept', [page], 1_700_000_100)
    muteList([muted])
    let answer = () => {}
    nip44.decrypting = new Promise<void>((resolve) => (answer = resolve))

    const { result } = renderHook(() => useSidebarTopics(true, inTree))
    await waitFor(() => expect(nip44.decrypts).toBe(1))
    // The topics are read and the list is on its way: nothing is drawn yet.
    expect(relay.reads.some(readsTopics)).toBe(true)
    expect(result.current).toBe('loading')
    await act(async () => answer())
    await waitFor(() => expect(drawn(result.current)).toEqual(['Kept']))
  })

  it('draws your topics, nothing muted, when Estiva ID will not decrypt your mute list', async () => {
    const page = file(30842, 'Launch plan')
    tree = [page]
    const muted = topic(ME, 'Muted', [page], 1_700_000_900)
    muteList([muted])
    nip44.decrypting = Promise.reject(new Error('POST /nip44/decrypt failed: 429'))
    nip44.decrypting.catch(() => {})

    const { result } = renderHook(() => useSidebarTopics(true, inTree))
    await waitFor(() => expect(drawn(result.current)).toEqual(['Muted']))
  })
})

describe('when the sidebar’s five move', () => {
  const visible = () => act(async () => void document.dispatchEvent(new Event('visibilitychange')))

  it('reads the topics, the mute list and the activity again when you come back after a minute, and nothing within one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-10T09:00:00Z'))
    const page = file(30842, 'Launch plan')
    tree = [page]
    topic(ME, 'First', [page], 1_700_000_200)
    const second = topic(ME, 'Second', [page], 1_700_000_100)
    const { result } = renderHook(() => useSidebarTopics(true, inTree))
    await waitFor(() => expect(drawn(result.current)).toEqual(['First', 'Second']))

    // Something happens in Second, and a topic is joined elsewhere, while you look away.
    said(second, 1_700_000_900)
    topic(ME, 'Started since', [page], 1_700_000_500)
    relay.reads = []
    vi.setSystemTime(new Date('2026-11-10T09:00:30Z'))
    await visible()
    expect(relay.reads).toEqual([])
    expect(drawn(result.current)).toEqual(['First', 'Second'])

    vi.setSystemTime(new Date('2026-11-10T09:01:01Z'))
    await visible()
    await waitFor(() => expect(drawn(result.current)).toEqual(['Second', 'Started since', 'First']))
    expect(relay.reads.some(readsTopics)).toBe(true)
    expect(relay.reads.some(readsMuted)).toBe(true)
  })
})

describe('the files each of your topics folds to', () => {
  it('folds to its pages, then projects, then issues, each A–Z, a file outside the tree included', async () => {
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

  it('leaves out an archived or unreadable file, and shows a topic listing only those with no files', async () => {
    const page = file(30842, 'Live page')
    const gone = file(30851, 'Shipped issue', { archived: { at: 1 } } as Partial<ForeignObject>)
    const hidden = file(30851, 'Private issue', { unreachable: true } as Partial<ForeignObject>)
    tree = [page]
    outside = { [gone.address!]: gone, [hidden.address!]: hidden }
    topic(ME, 'All done', [gone, hidden])
    topic(ME, 'Going', [page, gone])

    const topics = await read()
    expect(topics.map((t) => [t.title, t.files.map((f) => f.slots.title?.value)])).toEqual([
      ['All done', []],
      ['Going', ['Live page']],
    ])
  })

  it('leaves out a file the tree read archived without reading it again', async () => {
    const page = file(30842, 'Live page')
    const finished = file(30850, 'Finished project', { archived: { at: 1 } } as Partial<ForeignObject>)
    tree = [page, finished]
    topic(ME, 'Going', [page, finished])

    const [going] = await read()
    expect(going.files.map((f) => f.slots.title?.value)).toEqual(['Live page'])
    expect(resolvedOutside).toEqual([])
  })
})

describe('when you add a file to a topic or take one off in this tab', () => {
  it('folds the topic to what you added at once, and drops what you took off', async () => {
    const page = file(30842, 'Launch plan')
    const notes = file(30842, 'Press notes')
    tree = [page, notes]
    const launch = topic(ME, 'Launch', [page], 1_700_000_200)
    const hiring = topic(ME, 'Hiring', [], 1_700_000_100)
    const folds = (state: ReturnType<typeof useSidebarTopics>) =>
      Array.isArray(state) ? state.map((t) => `${t.title}: ${t.files.map((f) => f.slots.title?.value).join(', ')}`) : state
    const { result } = renderHook(() => useSidebarTopics(true, inTree))
    await waitFor(() => expect(folds(result.current)).toEqual(['Launch: Launch plan', 'Hiring: ']))

    await act(() => setListedInTopic({ address: hiring, folder: HQ }, notes.address!, true))
    await act(() => setListedInTopic({ address: launch, folder: HQ }, notes.address!, true))
    await act(() => setListedInTopic({ address: launch, folder: HQ }, page.address!, false))

    // The three entries went to the relay, signed by you, on each topic's list.
    expect(relay.sent.map((e) => [e.kind, e.pubkey, e.tags.find((t) => t[0] === 'a')?.[1]])).toEqual([
      [1851, ME, hiring],
      [1851, ME, launch],
      [1851, ME, launch],
    ])
    await waitFor(() => expect(folds(result.current)).toEqual(['Launch: Press notes', 'Hiring: Press notes']))
  })
})
