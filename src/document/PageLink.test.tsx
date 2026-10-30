// @vitest-environment-options {"url": "https://leaf.estiva.app/document/plan"}
import type { ForeignObject } from '@estiva-app/interop'
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
    expect(screen.getByText(/not available/i)).toBeTruthy()
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
