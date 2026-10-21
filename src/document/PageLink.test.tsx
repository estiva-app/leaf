import type { ForeignObject } from '@estiva-app/interop'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../relay/bridge', () => ({ query: vi.fn(async () => []) }))

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

function Link({ uri = PROJECT_URI, place, read = project }: { uri?: string; place: 'chip' | 'row' | 'card'; read?: ForeignObject | null }) {
  return (
    <ReferencesProvider value={{ [uri]: read }}>
      <PageLink uri={uri} place={place} editing />
    </ReferencesProvider>
  )
}

describe('a Ship project linked in a Leaf page', () => {
  it('alone on its line is its row: key, title, and how far along', () => {
    render(<Link place="row" />)
    expect(screen.getByText('WBD')).toBeTruthy()
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
