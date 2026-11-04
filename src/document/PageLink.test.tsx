// @vitest-environment-options {"url": "https://leaf.estiva.app/document/plan"}
import type { ForeignObject, TopicsRead } from '@estiva-app/interop'
import { ToastProvider } from '@estiva-app/ui'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Signed in: a card offers its pickers only to someone who can change it.
vi.mock('../relay/bridge', () => ({ query: vi.fn(async () => []), viewerPubkey: () => 'c4'.repeat(32) }))

import { PageLink } from './PageLink'
import { ReferencesProvider } from './references'

afterEach(cleanup)

const LEAD = 'f3'.repeat(32)
const ANA = 'a1'.repeat(32)
const PROJECT_URI = 'nostr:naddr1project'

const file = (over: Partial<ForeignObject>): ForeignObject =>
  ({ ref: 'r', kind: 30851, eventId: 'e', widget: 'card', slots: {}, meta: [], actions: [], comments: [], viaRecommendation: false, ...over }) as ForeignObject

const issue = (d: string, title: string, ref: string, status: string, colour: string) =>
  file({
    address: `30851:${LEAD}:${d}`,
    noun: 'issue',
    slots: { title: { value: title }, status: { value: status, colour } } as ForeignObject['slots'],
    meta: [{ field: 'ref', value: ref }, { label: 'Assignee', field: 'assignee', value: ANA, isPubkey: true }] as ForeignObject['meta'],
    people: { [ANA]: { displayName: 'Ana' } } as ForeignObject['people'],
  })

/** A Ship project as interop reads it: its key and lead in `meta`, its issues as `children`. */
const project = file({
  kind: 30850,
  address: `30850:${LEAD}:p`,
  noun: 'project',
  appName: 'Estiva Ship',
  openUrl: 'https://ship.estiva.app/o/naddr1project',
  slots: { title: { value: 'Widgets 2: build 2' }, status: { value: 'Planned', colour: 'neutral' }, subtitle: { value: 'One shared editor.' } } as ForeignObject['slots'],
  meta: [{ label: 'Lead', field: 'lead', value: LEAD, isPubkey: true }, { label: 'Key', field: 'key', value: 'WBD' }] as ForeignObject['meta'],
  people: { [LEAD]: { displayName: 'Miky' } } as ForeignObject['people'],
  children: [issue('1', 'Write the rule', 'WBD-1', 'Done', 'green'), issue('2', 'Build the editor', 'WBD-3', 'Done', 'green'), issue('3', 'Leaf pages', 'WBD-5', 'In progress', 'blue')],
})

function Link({ uri = PROJECT_URI, place, read = project, editing = true }: { uri?: string; place: 'chip' | 'row' | 'card'; read?: ForeignObject | null; editing?: boolean }) {
  return (
    <ToastProvider>
      <ReferencesProvider value={{ [uri]: read }}>
        <PageLink uri={uri} place={place} editing={editing} />
      </ReferencesProvider>
    </ToastProvider>
  )
}

describe('a Ship project shown as its card in a Leaf page', () => {
  const withStatus = file({
    ...project,
    slots: { ...project.slots, status: { value: 'Planned', colour: 'neutral', field: 'status' } } as ForeignObject['slots'],
    actions: [{ id: 'set-status', label: 'Status', control: 'select', field: 'status', current: 'planned', options: [{ value: 'planned', label: 'Planned' }, { value: 'done', label: 'Done' }] }] as ForeignObject['actions'],
  })

  it('offers its Status picker while the page is read, as the card under a comment does', () => {
    render(<Link place="card" read={withStatus} editing={false} />)
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeNull()
  })

  it('keeps its Status picker while the page’s text is being edited (Katerina, 30 Oct)', () => {
    render(<Link place="card" read={withStatus} />)
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeNull()
  })
})

describe('a Ship project linked in a Leaf page', () => {
  it('alone on its line is its row: key, title, and how far along', () => {
    render(<Link place="row" />)
    // The key under the title, with what it is (ui 0.91.0).
    expect(screen.getByText('WBD · Project')).toBeTruthy()
    expect(screen.getByText('Widgets 2: build 2')).toBeTruthy()
    // Two of its three issues are Done, Ship's green.
    expect(screen.getByText('2/3')).toBeTruthy()
  })

  it("as its card in the row's place: its summary, its issues with their keys and statuses, its status and lead", () => {
    render(<Link place="card" />)
    expect(screen.getByText('One shared editor.')).toBeTruthy()
    for (const [key, title] of [['WBD-1', 'Write the rule'], ['WBD-3', 'Build the editor'], ['WBD-5', 'Leaf pages']]) {
      const row = screen.getByText(title).closest('div')!
      expect(within(row).getByText(key)).toBeTruthy()
    }
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
    expect(screen.getByText('Planned')).toBeTruthy()
    expect(screen.getByText('Miky')).toBeTruthy()
  })

  it('in a sentence is its chip, named by its title', () => {
    render(<Link place="chip" />)
    expect(screen.getByText('Widgets 2: build 2')).toBeTruthy()
    expect(screen.queryByText('One shared editor.')).toBeNull()
  })

  it('that cannot be read says so, by what its address says it is', () => {
    render(<Link place="row" read={null} />)
    // Changed on purpose: kit 0.102.0 (ALO-4) says "You can't open this file", not "File not available".
    expect(screen.getByText("You can't open this file")).toBeTruthy()
  })
})

describe('the comment count on a row (Katerina, 30 Oct)', () => {
  const countLink = async () => (await screen.findByRole('link', { name: /comments — open the conversation/ })).getAttribute('href')

  it('a Leaf document’s row counts its comments, and the count opens its page with the comments shown', async () => {
    const page = file({
      kind: 30842,
      address: `30842:${LEAD}:plan-1`,
      noun: 'document',
      openUrl: 'https://leaf.estiva.app/document/friday-plan-plan-1',
      slots: { title: { value: 'Friday plan' } } as ForeignObject['slots'],
    })
    render(<Link uri="nostr:naddr1page" place="row" read={page} />)
    expect(await countLink()).toBe('/document/friday-plan-plan-1#comments')
  })

  it('a file Leaf does not open as a page has its count open it in its own app, as its title does', async () => {
    render(<Link place="row" />)
    expect(await countLink()).toBe(project.openUrl)
  })
})

describe('where a Ship project written as a URL in a Leaf page opens (WBM-11)', () => {
  // The project's own app opens it at `project.openUrl`, on ship.estiva.app; this page is on leaf.estiva.app.
  const opens = (written: string) => {
    render(
      <ToastProvider>
        <ReferencesProvider value={{ [PROJECT_URI]: project }}>
          <PageLink uri={PROJECT_URI} href={written} place="chip" />
        </ReferencesProvider>
      </ToastProvider>,
    )
    const href = screen.getByText('Widgets 2: build 2').closest('a')?.getAttribute('href')
    cleanup()
    return href
  }

  it('an address on the host its file opens on, or on Leaf’s own, opens as written', () => {
    expect(opens('https://ship.estiva.app/project/widgets-2')).toBe('https://ship.estiva.app/project/widgets-2')
    expect(opens('https://leaf.estiva.app/project/widgets-2')).toBe('https://leaf.estiva.app/project/widgets-2')
  })

  it('another site, a lookalike, user@host, another port, http or javascript: opens the file’s own address instead', () => {
    for (const written of [
      'https://evil.example/project/widgets-2',
      'https://ship.estiva.app.evil.com/project/widgets-2',
      'https://ship.estiva.app@evil.com/project/widgets-2',
      'https://ship.estiva.app:8443/project/widgets-2',
      'http://ship.estiva.app/project/widgets-2',
      'javascript:alert(1)',
    ]) {
      expect(opens(written), written).toBe(project.openUrl)
    }
  })
})

describe('a link written as a URL whose file cannot be read (widget review, item 58)', () => {
  it('stays the URL as written, a plain link, not "not available" (SPEC §13.1)', () => {
    const written = 'https://ship.estiva.app/project/widgets-2'
    render(
      <ToastProvider>
        <ReferencesProvider value={{ [PROJECT_URI]: null }}>
          <PageLink uri={PROJECT_URI} href={written} place="row" />
        </ReferencesProvider>
      </ToastProvider>,
    )
    expect(screen.getByRole('link', { name: written }).getAttribute('href')).toBe(written)
    expect(screen.queryByText(/not available/)).toBeNull()
  })
})

describe('a topic linked in a Leaf page or a comment (LTN-3)', () => {
  const D = '5bd936dc-1111-4222-8333-444455556666'
  const TOPIC_URI = 'nostr:naddr1topic'
  const topic = file({
    kind: 30840,
    address: `30840:${LEAD}:${D}`,
    noun: 'topic',
    appName: 'Peek',
    openUrl: 'https://peek.estiva.app/o/naddr1topic',
    slots: { title: { value: 'Launch chat' } } as ForeignObject['slots'],
  })
  const opens = (place: 'chip' | 'row' | 'card', written?: string) => {
    render(
      <ToastProvider>
        <ReferencesProvider value={{ [TOPIC_URI]: topic }}>
          <PageLink uri={TOPIC_URI} href={written} place={place} editing={false} />
        </ReferencesProvider>
      </ToastProvider>,
    )
    const href = screen.getAllByText('Launch chat')[0].closest('a')?.getAttribute('href')
    cleanup()
    return href
  }

  it("opens the topic's page in Leaf, as a chip, a row or a card, whether picked or written as Peek's URL", () => {
    const page = `/topic/launch-chat-${D}`
    expect(opens('chip')).toBe(page)
    expect(opens('row')).toBe(page)
    expect(opens('card')).toBe(page)
    expect(opens('chip', `https://peek.estiva.app/topic/launch-chat-${D}`)).toBe(page)
  })

  it('opens a link to one message in the topic as written, in Peek, which shows it', () => {
    const message = `https://peek.estiva.app/topic/launch-chat-${D}?thread=${'e'.repeat(64)}`
    expect(opens('chip', message)).toBe(message)
  })

  it('opens the topic in Peek when the tab knows it for a space (D4)', async () => {
    const { heldTopics } = await import('./fileTopics')
    const space = { address: topic.address, space: true, yours: false, folder: 'hq', listed: [], object: topic }
    await heldTopics.reload(async () => ({ me: LEAD, topics: [space], membership: {} }) as unknown as TopicsRead)
    try {
      expect(opens('chip')).toBe(topic.openUrl)
      const written = `https://peek.estiva.app/topic/launch-chat-${D}`
      expect(opens('chip', written)).toBe(written)
    } finally {
      heldTopics.clear()
    }
  })
})
