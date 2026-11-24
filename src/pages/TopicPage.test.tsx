// @vitest-environment-options {"url": "https://leaf.estiva.app/topic/x"}
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { BLOCK_DOCUMENT_FORMAT, BODY_SLOT, planListInTopic } from '@estiva-app/interop'
import { buildMembershipChange } from '@estiva-app/conversation'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { ToastProvider, TooltipProvider } from '@estiva-app/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { drawOnce } from '../test/drawOnce'
import { relayAnswer } from '../test/listRead'

/* LTN-3: a topic's own page in Leaf, as Miky opens it from the sidebar or any topic link inside Leaf. */

const ME = 'a'.repeat(64)
const MIKY = 'b'.repeat(64)
// A team id as the relay mints them (lowercase UUID v4): who is in an initiative is read through its team's roster.
const HQ = '0a0b0c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d'
const PEEK = 'c'.repeat(64)

/* What the relay holds, answered filter by filter as it matches. */
let held: SignedEvent[] = []
type Filter = { ids?: string[]; kinds?: number[]; authors?: string[]; [tag: `#${string}`]: string[] | undefined }
function relay(filters: Filter[]): SignedEvent[] {
  // The list read (`"fields": "newest"`, SPEC §6.13) as the relay answers it; every other filter as it matches.
  return relayAnswer(held, filters as Record<string, unknown>[])
}
/* When set, the relay refuses every read: a busy relay or a dropped socket. */
let down = false
const answer = async (filters: Filter[]) => {
  if (down) throw new Error('rate-limited: slow down')
  return relay(filters)
}
/* Every event this tab handed the relay to sign, as handed; the relay takes it and holds it signed, so a read after sees it. */
let sent: UnsignedEvent[] = []
const take = async (event: UnsignedEvent) => {
  sent.push(event)
  held.push(sign(event))
  return { ok: true as const }
}
vi.mock('../relay/bridge', () => ({ viewerPubkey: () => ME, query: answer, queryAll: answer, publish: take }))
// A fresh cache, as Leaf's own: Peek's manifest names where the topic's conversation is.
vi.mock('../relay/manifests', async () => {
  const { createProjectionCache } = await import('@estiva-app/interop')
  return {
    resolveQuery: async (filters: Filter[]) => relay(filters),
    projections: createProjectionCache(),
    // A card's link reads the declared manifests too: none here.
    declaredManifests: async () => [],
    withDeclaredManifests: (read: unknown) => read,
  }
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

// Drawn once before any test's clock starts: `drawOnce` says why. Ahead of this file's own imports, so the
// copy those load is the one a test's own `import()` finds.
held = [
  {
    kind: 30840,
    pubkey: MIKY,
    created_at: 1_700_000_000,
    tags: [['d', '00000000-0000-4000-8000-999999999999'], ['title', 'Widgets'], ['h', HQ], ['summary', 'Everything about the widgets.']],
    content: '',
    id: 'f'.repeat(64),
    sig: '',
  } as SignedEvent,
]
let forgetRead = () => {}
await drawOnce(async () => {
  const fresh = await import('./TopicPage')
  // That copy marks its conversation read: no publish of it left waiting to fire inside a test.
  forgetRead = (await import('../relay/readState')).resetReadStateForTests
  return (
    <TooltipProvider>
      <ToastProvider>
        <fresh.TopicPage d="00000000-0000-4000-8000-999999999999" folders={[{ id: HQ, name: 'Estiva HQ', hasState: true }]} inTree={() => null} treeRead />
      </ToastProvider>
    </TooltipProvider>
  )
}, () => screen.getByText('Everything about the widgets.'))
forgetRead()
held = []

const { TopicPage } = await import('./TopicPage')
const { resetTopicChoicesForTests } = await import('../document/fileTopics')
const { projections } = await import('../relay/manifests')
const { resetReadStateForTests } = await import('../relay/readState')

let n = 0
const sign = (e: UnsignedEvent): SignedEvent => ({ ...e, id: `e${++n}`.padStart(64, '0'), sig: '' }) as SignedEvent
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

/* A file Leaf opens, as its app's manifest draws it. */
function file(kind: 30842 | 30851, title: string, archived = false, widget: string = 'row'): ForeignObject {
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
    // As its app draws it where nothing is chosen: a row here, so a case reads the row's link unless it says otherwise.
    widget,
    slots: { title: { value: title }, ...(shared ? { [BODY_SLOT]: { field: 'description' } } : {}) },
    meta: [],
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
    <ToastProvider>
      <TopicPage d={d} folders={folders} inTree={(a) => tree.find((f) => f.address === a) ?? null} treeRead={treeRead} />
    </ToastProvider>
  </TooltipProvider>
)
const show = (d: string, tree: ForeignObject[] = []) => render(page(d, tree, true))
/** The initiative's name, in the page's bar: found once it is drawn, and not again over the page (brainstorm 1.A). */
const nameInBar = (title: string) =>
  waitFor(() => {
    const shown = screen.getAllByText(title).filter((element) => !element.closest('[data-topic-page]'))
    expect(shown.length).toBeGreaterThan(0)
    return shown[0]
  })
/** The heading over one kind of file, and the links under it in their order. */
const linksUnder = (heading: string) => {
  const section = [...document.querySelectorAll('[data-topic-kind]')].find((part) => part.querySelector('*')?.textContent?.startsWith(heading))
  return section ? [...section.querySelectorAll('a')].map((link) => link.textContent?.trim() ?? '').filter(Boolean) : []
}

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
  sent = []
  down = false
  resetTopicChoicesForTests()
  // Each case publishes its own manifests: what an earlier case's read remembered about them is forgotten.
  projections.clear()
})
afterEach(() => {
  cleanup()
  // The page marks its conversation read: no publish left waiting to fire inside another case.
  resetReadStateForTests()
})

describe("a topic's page in Leaf", () => {
  it('shows its title, team and summary, its conversation beside it, and what it lists, each opening in Leaf', async () => {
    const plan = file(30842, 'Launch plan')
    const issue = file(30851, 'Write the brief')
    outside = { [plan.address!]: plan, [issue.address!]: issue }
    const d = topic('Widgets', [issue, plan], 'Everything about the widgets.')
    const address = `30840:${MIKY}:${d}`
    held.push(sign({ kind: 1111, pubkey: MIKY, created_at: 1_700_000_100, tags: [['A', address], ['K', '30840'], ['P', MIKY], ['a', address], ['k', '30840'], ['p', MIKY], ['h', HQ]], content: 'Said in the topic' }))
    show(d)
    await nameInBar('Widgets')
    expect(screen.getByText('Estiva HQ')).toBeTruthy()
    expect(screen.getByText('Everything about the widgets.')).toBeTruthy()
    // Its conversation in the column beside the page, as Ship's topic page has it, in place of a link to Peek's.
    expect(screen.queryByRole('link', { name: /Conversation in Peek/ })).toBeNull()
    expect(await screen.findByText('Said in the topic')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Start a conversation…' })).toBeTruthy()
    // Hidden and shown as a document's comments are.
    fireEvent.click(screen.getByRole('button', { name: 'Hide conversation' }))
    expect(document.querySelector('[data-comments-column]')!.closest('[hidden]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show conversation' }))
    expect(document.querySelector('[data-comments-column]')!.closest('[hidden]')).toBeNull()
    // Each under its own kind's heading (brainstorm 1.A), each a link inside Leaf.
    const plans = await screen.findByRole('link', { name: /Launch plan/ })
    expect(plans.getAttribute('href')).toBe(`/document/launch-plan-${plan.address!.split(':')[2]}`)
    expect(screen.getByRole('link', { name: /Write the brief/ }).getAttribute('href')).toBe(`/f/${issue.naddr}`)
    expect(plans.closest('[data-topic-kind]')?.getAttribute('data-topic-kind')).toBe('page')
    expect(screen.getByRole('link', { name: /Write the brief/ }).closest('[data-topic-kind]')?.getAttribute('data-topic-kind')).toBe('issue')
  })

  it('draws every file as a row, even one the initiative shows as a card (Katerina, 23 November: "row and not card")', async () => {
    const plan = file(30842, 'Launch plan')
    const issue = file(30851, 'Write the brief')
    outside = { [plan.address!]: plan, [issue.address!]: issue }
    const d = topic('Widgets', [issue, plan])
    const root = held.find((e) => e.kind === 30840 && e.tags.some((t) => t[0] === 'd' && t[1] === d))!
    const planD = plan.address!.split(':')[2]!
    held.push(
      sign({
        kind: 1851,
        pubkey: MIKY,
        created_at: 1_700_000_100,
        tags: [['a', `30840:${MIKY}:${d}`], ['O', d], ['field', `look:${planD}`], ['value', 'card'], ['h', HQ], ['ts', '1700000100000'], ['prev', root.id], ['o', planD]],
        content: '',
      }),
    )
    show(d)
    // Both are rows, each a link inside Leaf under its own heading; nothing is drawn as a card, whose link is a whole URL.
    const brief = await screen.findByRole('link', { name: /^Write the brief/ })
    const plan2 = await screen.findByRole('link', { name: /^Launch plan/ })
    expect(plan2.getAttribute('href')).toBe(`/document/launch-plan-${planD}`)
    expect(plan2.closest('[role="row"]')).not.toBeNull()
    expect(document.querySelector('[data-topic-page] a[href^="https://"]')).toBeNull()
    expect(plan2.closest('[data-topic-kind]')?.getAttribute('data-topic-kind')).toBe('page')
    expect(brief.closest('[data-topic-kind]')?.getAttribute('data-topic-kind')).toBe('issue')
  })

  it('draws a page its own app shows as a card as a row here too, as Ship lists them', async () => {
    const plan = file(30842, 'Launch plan', false, 'card')
    const issue = file(30851, 'Write the brief')
    outside = { [plan.address!]: plan, [issue.address!]: issue }
    show(topic('Widgets', [plan, issue]))
    const planD = plan.address!.split(':')[2]!
    expect((await screen.findByRole('link', { name: /^Write the brief/ })).getAttribute('href')).toBe(`/f/${issue.naddr}`)
    expect((await screen.findByRole('link', { name: /^Launch plan/ })).getAttribute('href')).toBe(`/document/launch-plan-${planD}`)
    expect(document.querySelector('[data-topic-page] a[href^="https://"]')).toBeNull()
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
    await nameInBar('Widgets')
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
    rerender(page(d, [plan], true))
    expect(await screen.findByRole('link', { name: /Launch plan/ })).toBeTruthy()
    expect(asked).toBe(0)
  })

  it('folds its archived files away at the end, and opening the fold shows them', async () => {
    const plan = file(30842, 'Launch plan')
    const old = file(30842, 'Old plan', true)
    outside = { [plan.address!]: plan, [old.address!]: old }
    show(topic('Widgets', [plan, old]))
    await screen.findByRole('link', { name: /Launch plan/ })
    expect(screen.queryByRole('link', { name: /Old plan/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Archived/ }))
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
    // Nothing of it is drawn on its way to Peek: no list, nor the line an empty one says.
    expect(screen.queryByText('None yet. An initiative can be only a conversation.')).toBeNull()
  })

  it("says the topic didn't load, not that it can't be opened, when the read for a topic made since fails", async () => {
    const { heldTopics, loadTopics } = await import('../document/fileTopics')
    // The tab already holds a read from before the topic was made, as after Add to topic.
    await heldTopics.reload(loadTopics)
    const d = topic('Made since', [])
    down = true
    show(d)
    expect(await screen.findByText('This initiative didn’t load.')).toBeTruthy()
    expect(screen.queryByText("You can't open this initiative")).toBeNull()
    down = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await nameInBar('Made since')
  })

  it('draws the page without a Peek link when the newest conversation app publishes a link that does not parse', async () => {
    held.push(
      sign({
        kind: 31990,
        pubkey: 'd'.repeat(64),
        created_at: 1_800_000_000,
        tags: [['d', 'planted'], ['web', 'https://a b/<bech32>', 'naddr']],
        content: JSON.stringify({ name: 'Planted', aspect: 'conversation' }),
      }),
    )
    show(topic('Widgets', []))
    await nameInBar('Widgets')
    expect(screen.queryByRole('link', { name: /Conversation in Peek/ })).toBeNull()
  })

  it("says it can't be opened when no topic the reader can read has that id", async () => {
    topic('Widgets', [])
    show(uuid(999))
    expect(await screen.findByText("You can't open this initiative")).toBeTruthy()
  })
})

describe("an initiative's page, in Peek's team-page look (brainstorm 1.A)", () => {
  it('says its name once, in the bar, not again as a big title over the page', async () => {
    show(topic('Widgets', [], 'Everything about the widgets.'))
    await nameInBar('Widgets')
    expect(await screen.findByText('Everything about the widgets.')).toBeTruthy()
    expect(screen.getAllByText('Widgets').filter((element) => element.closest('[data-topic-page]'))).toEqual([])
  })

  it('lists each kind under its own heading, keeping the initiative’s own order inside each', async () => {
    const zebra = file(30842, 'Zebra notes')
    const apple = file(30842, 'Apple notes')
    const issue = file(30851, 'Write the brief')
    outside = { [zebra.address!]: zebra, [apple.address!]: apple, [issue.address!]: issue }
    // Listed: Zebra, the issue, Apple. The pages keep Zebra before Apple; the issue is under Issues.
    show(topic('Widgets', [zebra, issue, apple]))
    await screen.findByRole('link', { name: /Apple notes/ })
    expect(linksUnder('Documents')).toEqual(['Zebra notes', 'Apple notes'])
    expect(linksUnder('Issues')).toEqual(['Write the brief'])
  })
})

describe("an initiative's team, in its page's bar (D4)", () => {
  it('names its team once, as the chip with the team icon after its name, not as a line under its title', async () => {
    const d = topic('Widgets', [])
    show(d)
    await nameInBar('Widgets')
    const named = await screen.findAllByText('Estiva HQ')
    expect(named).toHaveLength(1)
    // Not in the page's body, where the grey line under the title was.
    expect(named[0].closest('[data-topic-page]')).toBeNull()
    expect(named[0].closest('a, span, div')?.parentElement?.querySelector('svg.tabler-icon-users')).toBeTruthy()
  })
})

describe("an initiative's rows, in Ship's four columns (Katerina, 23 November: \"make it like Ship\")", () => {
  it('puts each fact in its column: status in words, the owner’s face, and who changed it last and when', async () => {
    const { TopicPageView } = await import('./TopicPage')
    const { shipIssue, shipProject, MIKY: LEAD, KATERINA: ASSIGNEE } = await import('./fixtures/shipFiles')
    const issue = shipIssue()
    const project = shipProject()
    const directory = { [LEAD]: { displayName: 'Ana Duarte' }, [ASSIGNEE]: { displayName: 'Ravi Mehta' } }
    render(
      <TooltipProvider>
        <ToastProvider>
          <TopicPageView
            state={{ address: `30840:${LEAD}:launch`, title: 'Launch', folder: HQ, archived: false, space: false, files: { live: [project, issue], archived: [], looks: new Map() } }}
            directory={directory}
            comments={{ open: false, onOpenChange: () => {} }}
            onRetry={() => {}}
          />
        </ToastProvider>
      </TooltipProvider>,
    )
    // A row's cells: its name, then Status, People, Progress and When, as Ship's.
    const cells = (title: RegExp) => [...screen.getByRole('link', { name: title }).closest('[role="row"]')!.querySelectorAll('[role="cell"]')]
    const issueCells = cells(/^Sidebar should not show Peek topics/)
    expect(issueCells[1]?.textContent).toContain('In Progress')
    expect(issueCells[2]?.querySelector('[aria-label="Ravi Mehta"]')).not.toBeNull()
    const editor = issue.changedBy ? directory[issue.changedBy]?.displayName.split(' ')[0] : undefined
    expect(issueCells[4]?.textContent).toMatch(new RegExp(`^${editor}, `))
    const projectCells = cells(/^Leaf edits any file's text/)
    expect(projectCells[1]?.textContent).toContain('Planned')
    expect(projectCells[2]?.querySelector('[aria-label="Ana Duarte"]')).not.toBeNull()
  })

  describe('who is in it: the members pill in the bar, as on Ship’s initiative page (Katerina, 23 November)', () => {
    /** You in it already: your own member change on the initiative, held before the page opens. */
    const joined = (d: string) =>
      held.push(sign(buildMembershipChange(ME, 1_700_000_200_000, { file: `30840:${MIKY}:${d}`, folder: HQ, person: ME, member: true }) as UnsignedEvent))

    it('shows who its place lists, by count, in the bar', async () => {
      const d = topic('Widgets', [])
      joined(d)
      show(d)
      await nameInBar('Widgets')
      // Its maker and you: the listing Explore counts by.
      expect(await screen.findByRole('button', { name: '2 members' })).toBeTruthy()
    })

    it('Join in its Members signs your own member change, as Explore’s Join does, and says so', async () => {
      const d = topic('Widgets', [])
      show(d)
      fireEvent.click(await screen.findByRole('button', { name: '1 member' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Join' }))
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]!.kind).toBe(1851)
      expect(sent[0]!.tags).toEqual(expect.arrayContaining([['a', `30840:${MIKY}:${d}`], ['h', HQ], ['field', `member:${ME}`], ['value', 'true']]))
      expect(await screen.findByText('You joined Widgets. Notifications: Important.')).toBeTruthy()
      // Read again: you are counted (the pill sits behind the still-open dialog, which hides the page from assistive tech).
      expect(await screen.findByRole('button', { name: '2 members', hidden: true })).toBeTruthy()
    })

    it('Leave in its Members signs your leave, as Ship’s does, and you are no longer counted', async () => {
      const d = topic('Widgets', [])
      joined(d)
      show(d)
      fireEvent.click(await screen.findByRole('button', { name: '2 members' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Leave' }))
      await waitFor(() => expect(sent.length).toBeGreaterThan(0))
      expect(sent.every((event) => event.kind === 1851 && event.tags.some(([name, value]) => name === 'a' && value === `30840:${MIKY}:${d}`))).toBe(true)
      expect(sent.some((event) => event.tags.some(([name, value]) => name === 'field' && value === `member:${ME}`) && event.tags.some(([name, value]) => name === 'value' && value === 'false'))).toBe(true)
      expect(await screen.findByRole('button', { name: '1 member', hidden: true })).toBeTruthy()
    })

    it('an archived initiative’s Members offers no Join', async () => {
      const d = topic('Widgets', [])
      const root = held.find((e) => e.kind === 30840 && e.tags.some((t) => t[0] === 'd' && t[1] === d))!
      held.push(sign({ kind: 1851, pubkey: MIKY, created_at: 1_700_000_300, tags: [['a', `30840:${MIKY}:${d}`], ['e', root.id], ['field', 'archived'], ['value', 'true'], ['h', HQ]], content: '' }))
      show(d)
      fireEvent.click(await screen.findByRole('button', { name: '1 member' }))
      await screen.findByText('Author')
      expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
    })
  })

  /* SHI-64: a move leaves the topic's `h` in the team it left, and the team it went to lists it by its id. */
  it('names the team whose list names it by its id, not the team it was started in', async () => {
    const d = topic('Moved widgets', [])
    const moved: FolderSummary[] = [{ id: HQ, name: 'Estiva HQ', hasState: true, addresses: [] }, { id: 'steer', name: 'Steer', hasState: true, addresses: [], ids: [d] }]
    render(
      <TooltipProvider>
        <ToastProvider>
          <TopicPage d={d} folders={moved} inTree={() => null} treeRead />
        </ToastProvider>
      </TooltipProvider>,
    )
    // The name sits in the page's bar (direction A), not as a heading.
    await nameInBar('Moved widgets')
    expect(screen.getByText('Steer')).toBeTruthy()
    expect(screen.queryByText('Estiva HQ')).toBeNull()
  })
})

describe('the same page as Ship’s and Peek’s (review of 23 November)', () => {
  it('opens the initiative in Peek from the bar: Open, after its team (A4; Katerina, 18 November, D5)', async () => {
    const d = topic('Widgets', [])
    show(d)
    await nameInBar('Widgets')
    const open = await screen.findByRole('link', { name: 'Open in Peek' })
    expect(open.getAttribute('href')).toBe(`https://peek.estiva.app/topic/widgets-${d}`)
    expect(open.getAttribute('target')).toBe('_blank')
    expect(open.textContent).toBe('Open')
    // In the bar, after the team chip, not in the page under it.
    expect(open.closest('[data-topic-page]')).toBeNull()
    expect(screen.getByText('Estiva HQ').compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('calls Leaf’s own files Documents, as Ship does (B1)', async () => {
    const plan = file(30842, 'Launch plan')
    outside = { [plan.address!]: plan }
    show(topic('Widgets', [plan]))
    await screen.findByRole('link', { name: /Launch plan/ })
    expect(linksUnder('Documents')).toEqual(['Launch plan'])
    expect(screen.queryByText('Pages')).toBeNull()
  })

  it('says Peek’s line when it lists nothing (B2)', async () => {
    show(topic('Widgets', []))
    expect(await screen.findByText('None yet. An initiative can be only a conversation.')).toBeTruthy()
  })

  it('says who archived it, when and why, in the kit’s notice, not a grey word (C1)', async () => {
    const { TopicPageView } = await import('./TopicPage')
    render(
      <TooltipProvider>
        <ToastProvider>
          <TopicPageView
            state={{ address: `30840:${MIKY}:launch`, title: 'Launch', folder: HQ, archived: true, archive: { by: MIKY, at: 1_700_000_000, resolution: 'Shipped in March.' }, space: false, files: { live: [], archived: [], looks: new Map() } }}
            directory={{ [MIKY]: { displayName: 'Ana Duarte' } }}
            comments={{ open: false, onOpenChange: () => {} }}
            onRetry={() => {}}
          />
        </ToastProvider>
      </TooltipProvider>,
    )
    expect(screen.getByText(/^Archived by Ana Duarte · /)).toBeTruthy()
    expect(screen.getByText('Shipped in March.')).toBeTruthy()
    // Peek brings an initiative back, not Leaf.
    expect(screen.queryByRole('button', { name: 'Unarchive' })).toBeNull()
  })

  it('draws a page that did not load with the initiative’s ◎ and no team chip before its name is known (B2)', async () => {
    const { TopicPageView } = await import('./TopicPage')
    render(
      <TooltipProvider>
        <ToastProvider>
          <TopicPageView state="failed" team="Launch team" comments={{ open: false, onOpenChange: () => {} }} onRetry={() => {}} />
        </ToastProvider>
      </TooltipProvider>,
    )
    expect(screen.getByText('This initiative didn’t load.')).toBeTruthy()
    expect(screen.queryByText('Launch team')).toBeNull()
    expect(screen.getByText('This initiative didn’t load.').closest('[data-topic-page]')!.querySelector('svg.tabler-icon-target')).not.toBeNull()
  })
})
