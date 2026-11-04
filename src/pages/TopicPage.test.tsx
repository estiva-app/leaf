// @vitest-environment-options {"url": "https://leaf.estiva.app/topic/x"}
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { BLOCK_DOCUMENT_FORMAT, BODY_SLOT, planListInTopic } from '@estiva-app/interop'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { TooltipProvider } from '@estiva-app/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

/* LTN-3: a topic's own page in Leaf, as Miky opens it from the sidebar or any topic link inside Leaf. */

const ME = 'a'.repeat(64)
const MIKY = 'b'.repeat(64)
const HQ = 'hq-folder'
const PEEK = 'c'.repeat(64)

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
vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => ME,
  query: async (filters: Filter[]) => relay(filters),
  queryAll: async (filters: Filter[]) => relay(filters),
}))
// A fresh cache, as Leaf's own: Peek's manifest names where the topic's conversation is.
vi.mock('../relay/manifests', async () => {
  const { createProjectionCache } = await import('@estiva-app/interop')
  return { resolveQuery: async (filters: Filter[]) => relay(filters), projections: createProjectionCache() }
})
// A listed file outside the tree is drawn through its app's manifest; what that answers is stood in for here.
let outside: Record<string, ForeignObject> = {}
vi.mock('@estiva-app/interop', async (original) => {
  const interop = await original<typeof import('@estiva-app/interop')>()
  return {
    ...interop,
    // The topics themselves are read as interop reads them, through Peek's manifest.
    resolveForeignRoots: async (...args: Parameters<typeof interop.resolveForeignRoots>) =>
      args[0].every((a) => a.startsWith('30840:')) ? interop.resolveForeignRoots(...args) : args[0].flatMap((a) => outside[a] ?? []),
  }
})

const { TopicPage } = await import('./TopicPage')
const { resetTopicChoicesForTests } = await import('../document/fileTopics')

let n = 0
const sign = (e: UnsignedEvent): SignedEvent => ({ ...e, id: `e${++n}`.padStart(64, '0'), sig: '' }) as SignedEvent
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

/* A file Leaf opens, as its app's manifest draws it. */
function file(kind: 30842 | 30851, title: string, archived = false): ForeignObject {
  const d = uuid(++n)
  const address = `${kind}:${MIKY}:${d}`
  held.push(sign({ kind, pubkey: MIKY, created_at: 1_700_000_000, tags: [['d', d], ['title', title], ['h', HQ]], content: '' }))
  // Ship's issue shares its text with Leaf: a block-document description in the body slot.
  const shared = kind === 30851
  return {
    address,
    kind,
    ref: address,
    naddr: `naddr-${d}`,
    slots: { title: { value: title }, ...(shared ? { [BODY_SLOT]: { field: 'description' } } : {}) },
    actions: shared ? [{ control: 'text', field: 'description', format: BLOCK_DOCUMENT_FORMAT }] : [],
    ...(archived ? { archived: { at: 1 } } : {}),
  } as unknown as ForeignObject
}
function topic(title: string, files: ForeignObject[], summary?: string): string {
  const d = uuid(++n)
  const address = `30840:${MIKY}:${d}`
  held.push(sign({ kind: 30840, pubkey: MIKY, created_at: 1_700_000_000, tags: [['d', d], ['title', title], ['h', HQ], ...(summary ? [['summary', summary]] : [])], content: '' }))
  for (const f of files) held.push(sign(planListInTopic(MIKY, 1_700_000_050_000, { topic: { address, folder: HQ }, file: f.address!.split(':')[2] })[0]))
  return d
}

const folders: FolderSummary[] = [{ id: HQ, name: 'Estiva HQ', hasState: true }]
const page = (d: string, tree: ForeignObject[], treeRead: boolean) => (
  <TooltipProvider>
    <TopicPage d={d} folders={folders} inTree={(a) => tree.find((f) => f.address === a) ?? null} treeRead={treeRead} />
  </TooltipProvider>
)
const show = (d: string, tree: ForeignObject[] = []) => render(page(d, tree, true))

beforeEach(() => {
  held = [
    sign({
      kind: 31990,
      pubkey: PEEK,
      created_at: 1_700_000_000,
      tags: [['d', 'estiva-peek'], ['k', '30840'], ['web', 'https://peek.estiva.app/o/<bech32>', 'naddr'], ['urls', 'https://peek.estiva.app/topic/<slug>-<d>', '30840']],
      // A conversation app, as Peek declares itself: the app every bare file's conversation opens in.
      content: JSON.stringify({ name: 'Peek', aspect: 'conversation' }),
    }),
  ]
  outside = {}
  resetTopicChoicesForTests()
})
afterEach(cleanup)

describe("a topic's page in Leaf", () => {
  it('shows its title, team and summary, its conversation in Peek, and what it lists, each opening in Leaf', async () => {
    const plan = file(30842, 'Launch plan')
    const issue = file(30851, 'Write the brief')
    outside = { [plan.address!]: plan, [issue.address!]: issue }
    const d = topic('Widgets', [issue, plan], 'Everything about the widgets.')
    show(d)
    expect(await screen.findByRole('heading', { name: 'Widgets' })).toBeTruthy()
    expect(screen.getByText('Estiva HQ')).toBeTruthy()
    expect(screen.getByText('Everything about the widgets.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Conversation in Peek/ }).getAttribute('href')).toBe(`https://peek.estiva.app/topic/widgets-${d}`)
    // Pages first, then Ship's files; each a link inside Leaf.
    const plans = await screen.findByRole('link', { name: /Launch plan/ })
    expect(plans.getAttribute('href')).toBe(`/document/launch-plan-${plan.address!.split(':')[2]}`)
    expect(screen.getByRole('link', { name: /Write the brief/ }).getAttribute('href')).toBe(`/f/${issue.naddr}`)
    expect(plans.compareDocumentPosition(screen.getByRole('link', { name: /Write the brief/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('takes a listed file the tree already read from the tree, with the title the tree has now', async () => {
    const plan = file(30842, 'Launch plan')
    const d = topic('Widgets', [plan])
    show(d, [{ ...plan, slots: { title: { value: 'Launch plan, renamed' } } } as ForeignObject])
    expect(await screen.findByRole('link', { name: /Launch plan, renamed/ })).toBeTruthy()
  })

  it('draws its title before the tree is read, and what it lists once the tree is, taking the tree’s copy', async () => {
    const plan = file(30842, 'Launch plan')
    let asked = 0
    outside = new Proxy({} as Record<string, ForeignObject>, { get: () => (asked++, undefined) })
    const d = topic('Widgets', [plan])
    const { rerender } = render(page(d, [], false))
    expect(await screen.findByRole('heading', { name: 'Widgets' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
    rerender(page(d, [plan], true))
    expect(await screen.findByRole('link', { name: /Launch plan/ })).toBeTruthy()
    expect(asked).toBe(0)
  })

  it('puts its archived files behind a link, which shows them', async () => {
    const plan = file(30842, 'Launch plan')
    const old = file(30842, 'Old plan', true)
    outside = { [plan.address!]: plan, [old.address!]: old }
    show(topic('Widgets', [plan, old]))
    await screen.findByRole('link', { name: /Launch plan/ })
    expect(screen.queryByRole('link', { name: /Old plan/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Archived · 1' }))
    expect(screen.getByRole('link', { name: /Old plan/ })).toBeTruthy()
  })

  it('shows the archived files at once when everything it lists is archived, and says so', async () => {
    const old = file(30842, 'Old plan', true)
    outside = { [old.address!]: old }
    show(topic('Widgets', [old]))
    expect(await screen.findByText('Everything it lists is archived.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Old plan/ })).toBeTruthy()
  })

  it('sends a space on to Peek rather than drawing it (D4)', async () => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, replace, hostname: 'leaf.estiva.app', pathname: '/topic/x', search: '', hash: '' })
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    const d = topic('Bugs', [])
    // The team's own list marks it one of its spaces.
    held.push(sign({ kind: 30890, pubkey: MIKY, created_at: 1_700_000_000, tags: [['d', 'team'], ['h', HQ], ['a', `30840:${MIKY}:${d}`, '', 'space']], content: '' }))
    show(d)
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`https://peek.estiva.app/topic/bugs-${d}`))
    expect(screen.queryByRole('heading', { name: 'Bugs' })).toBeNull()
  })

  it("says it can't be opened when no topic the reader can read has that id", async () => {
    topic('Widgets', [])
    show(uuid(999))
    expect(await screen.findByText("You can't open this topic")).toBeTruthy()
  })
})
