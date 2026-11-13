import { addrToNaddr } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  ALO-24: a card under a comment reads its file as it is now, once for every card asking in the same moment. The relay
  is the seam: `query` answers from the events below, each filter on its own as the relay does, and every filter that
  reaches it is counted. The relay keeps projects in order (the switch), as production has since 4 Nov.
*/
const query = vi.hoisted(() => vi.fn())
vi.mock('../relay/bridge', () => ({ query: (filters: unknown[]) => query(filters), publish: vi.fn(), viewerPubkey: () => 'c4'.repeat(32) }))
vi.mock('../relay/projectFields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../relay/projectFields')>()),
  archivedRootsOptions: async () => ({ archivedWith: true, listRead: true }),
}))

import { CommentCard } from '../comments/CommentCard'
import { ReferencesProvider, useReferences } from './references'

const OWNER = 'd'.repeat(64)

let seq = 0
const event = (partial: { kind: number; tags?: string[][]; content?: string; pubkey?: string }) => ({
  id: String(++seq).padStart(64, '0'),
  sig: '',
  pubkey: OWNER,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  ...partial,
})

// A project whose app lists its issues under it, recommended by its author, and three changes to its title.
const projections = {
  30850: { widget: 'card', slots: { title: { tag: 'title' }, list: { children: { kind: 30851, via: 'a', limit: 50 } } } },
  30851: { widget: 'card', slots: { title: { tag: 'title' } } },
}
const recommend = (kind: number) => event({ kind: 31989, tags: [['d', String(kind)], ['a', `31990:${OWNER}:tracker`]] })
const world = [
  event({ kind: 31990, tags: [['d', 'tracker'], ['k', '30850'], ['k', '30851']], content: JSON.stringify({ name: 'Tracker', projections }) }),
  recommend(30850),
  recommend(30851),
]

/** A project of its own for each test, since a tab keeps what it read: titled through three changes, with two issues. */
function aProject(d: string) {
  const project = `30850:${OWNER}:${d}`
  world.push(
    event({ kind: 30850, tags: [['d', d], ['title', 'Universal Navigation']] }),
    event({ kind: 30851, tags: [['d', `${d}-i1`], ['title', 'Draw the sidebar'], ['a', project]] }),
    event({ kind: 30851, tags: [['d', `${d}-i2`], ['title', 'Name the topics'], ['a', project]] }),
    ...['Nav', 'Navigation', 'Universal Navigation'].map((title) => event({ kind: 1851, tags: [['a', project], ['title', title]] })),
  )
  return { project, issue: `30851:${OWNER}:${d}-i1`, d }
}

const matches = (f: Record<string, unknown>) => (e: (typeof world)[number]) => {
  if (f.kinds && !(f.kinds as number[]).includes(e.kind)) return false
  if (f.authors && !(f.authors as string[]).includes(e.pubkey)) return false
  for (const [key, want] of Object.entries(f)) {
    if (!key.startsWith('#')) continue
    const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
    if (!(want as string[]).some((v) => held.includes(v))) return false
  }
  return true
}
/** The relay answers every filter on its own: an event two filters match comes back twice. */
const answer = async (filters: Record<string, unknown>[]) => filters.flatMap((f) => world.filter(matches(f)))

/** Every filter that reached the relay. */
const sent = () => (query.mock.calls as [Record<string, unknown>[]][]).flatMap(([filters]) => filters)
/** The filters asking a project's every change, as a full read does: its `1851`s by `#a`, not the list read's newest. */
const historyReads = () => sent().filter((f) => (f.kinds as number[] | undefined)?.includes(1851) && !('fields' in f))
/** The filters that read project `d` itself. */
const projectReads = (d: string) => sent().filter((f) => (f.kinds as number[] | undefined)?.includes(30850) && (f['#d'] as string[] | undefined)?.includes(d))

/** A comment column's cards: the page's references read as the column reads them, then each card. */
function Cards({ uris }: { uris: string[] }) {
  return (
    <ToastProvider>
      <ReferencesProvider value={useReferences(uris)}>
        {uris.map((uri) => (
          <CommentCard key={uri} uri={uri} />
        ))}
      </ReferencesProvider>
    </ToastProvider>
  )
}

beforeEach(() => {
  query.mockReset().mockImplementation(answer)
})
afterEach(cleanup)

describe("a card under a comment, once the relay keeps projects in order", () => {
  it("draws a project's card from the project as it is now, with its issues, and never reads its every change", async () => {
    const { project } = aProject('q1')
    render(<Cards uris={[`nostr:${addrToNaddr(project)}`]} />)
    expect(await screen.findByText('Universal Navigation')).toBeTruthy()
    expect(screen.getByText('Draw the sidebar')).toBeTruthy()
    expect(historyReads()).toEqual([])
  })

  it('reads a project once when two comments link it by two spellings of its address', async () => {
    const { project, d } = aProject('q2')
    // Each comment reads its own links, as the column does: one by a link's address, one by a mention with a relay hint.
    render(
      <>
        <Cards uris={[`nostr:${addrToNaddr(project)}`]} />
        <Cards uris={[`nostr:${addrToNaddr(project, ['wss://estiva.estiva.app'])}`]} />
      </>,
    )
    expect(await screen.findAllByText('Universal Navigation')).toHaveLength(2)
    await act(async () => {})
    expect(projectReads(d)).toHaveLength(1)
  })

  it("lists each of a project's issues once when one of them has a card of its own beside it", async () => {
    const { project, issue } = aProject('q3')
    render(<Cards uris={[`nostr:${addrToNaddr(project)}`, `nostr:${addrToNaddr(issue)}`]} />)
    expect(await screen.findByText('Universal Navigation')).toBeTruthy()
    // Its own card, and once under the project.
    expect(screen.getAllByText('Draw the sidebar')).toHaveLength(2)
  })
})
