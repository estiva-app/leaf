import type { ForeignObject } from '@estiva-app/interop'
import { ToastProvider } from '@estiva-app/ui'
import type { UnsignedEvent } from '@estiva-app/protocol'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
  A Ship project's card under a Leaf comment is the card Peek and Ship draw
  (5ebf2756): its comment count, and Status and Lead pickers that write the
  one-field change Ship reads, in the project's Folder.
*/

const LEAD = 'f3'.repeat(32)
const ANA = 'a1'.repeat(32)
const ME = 'c4'.repeat(32)
const FOLDER = 'folder-1'
const ADDRESS = `30850:${LEAD}:p`
const URI = 'nostr:naddr1project'

const published: UnsignedEvent[] = []
let comments: { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; sig: string }[] = []

vi.mock('../relay/bridge', () => ({
  query: vi.fn(async (filters: { kinds?: number[] }[]) => (filters.some((f) => f.kinds?.includes(1111)) ? comments : [])),
  publish: vi.fn(async (event: UnsignedEvent) => {
    published.push(event)
    return { ok: true }
  }),
  viewerPubkey: () => ME,
}))

import { CommentCard } from './CommentCard'
import { ReferencesProvider } from '../document/references'

/** A comment on `on`, or a reply to `parent` in its conversation. */
const comment = (id: string, on: string, parent?: string) => ({
  id: id.padStart(64, '0'),
  kind: 1111,
  pubkey: ANA,
  created_at: 1_700_000_000,
  tags: [
    ['A', on],
    ['K', '30850'],
    ['P', LEAD],
    ...(parent ? [['e', parent.padStart(64, '0')], ['k', '1111'], ['p', ANA]] : [['a', on], ['k', '30850'], ['p', LEAD]]),
  ],
  content: 'Said about it',
  sig: '',
})

const project = {
  ref: ADDRESS,
  address: ADDRESS,
  eventId: 'e',
  kind: 30850,
  widget: 'card',
  noun: 'project',
  appName: 'Estiva Ship',
  folder: FOLDER,
  openUrl: 'https://ship.estiva.app/o/naddr1project',
  slots: { title: { value: 'Widgets 2: build 2', field: 'title' }, status: { value: 'Planned', colour: 'neutral', field: 'status' } },
  meta: [
    { label: 'Lead', field: 'lead', value: LEAD, isPubkey: true },
    { label: 'Key', field: 'key', value: 'WBD' },
  ],
  people: { [LEAD]: { displayName: 'Miky' }, [ANA]: { displayName: 'Ana' } },
  actions: [
    {
      id: 'set-status',
      label: 'Status',
      control: 'select',
      field: 'status',
      current: 'planned',
      options: [
        { value: 'planned', label: 'Planned', colour: 'neutral' },
        { value: 'done', label: 'Done', colour: 'green' },
      ],
    },
    { id: 'set-lead', label: 'Lead', control: 'pubkey', field: 'lead', current: LEAD },
  ],
  comments: [],
  viaRecommendation: true,
} as unknown as ForeignObject

function Card({ read = project }: { read?: ForeignObject }) {
  return (
    <ToastProvider>
      <ReferencesProvider value={{ [URI]: read }}>
        <CommentCard uri={URI} />
      </ReferencesProvider>
    </ToastProvider>
  )
}

beforeEach(() => {
  published.length = 0
  comments = []
})
afterEach(cleanup)

describe('a Ship project’s card under a Leaf comment', () => {
  it('changes its status from the card: one change of its status, in its Folder', async () => {
    const user = userEvent.setup()
    render(<Card />)
    const status = screen.queryByRole('combobox', { name: 'Status' })
    expect(status).not.toBeNull()
    await user.click(status!)
    await user.click(await screen.findByRole('option', { name: /Done/ }))
    await waitFor(() => expect(published).toHaveLength(1))
    const [change] = published
    expect(change.kind).toBe(1851)
    expect(change.pubkey).toBe(ME)
    expect(change.tags.filter((t) => ['a', 'field', 'value', 'h'].includes(t[0]))).toEqual([
      ['a', ADDRESS],
      ['field', 'status'],
      ['value', 'done'],
      ['h', FOLDER],
    ])
  })

  it('offers its lead as a picker too', () => {
    render(<Card />)
    expect(screen.queryByRole('combobox', { name: 'Lead' })).not.toBeNull()
  })

  it('counts its conversations, not their replies', async () => {
    // An address no other test carded, so no count is held for it yet.
    const counted = `30850:${LEAD}:counted`
    comments = [comment('1', counted), comment('2', counted), comment('3', counted, '1')]
    render(<Card read={{ ...project, ref: counted, address: counted }} />)
    await waitFor(() => expect(screen.queryByRole('link', { name: /comments — open the conversation/ })?.textContent).toMatch(/^2/))
  })

  it('shows an archived project’s status and lead as words, and writes nothing', () => {
    render(<Card read={{ ...project, archived: { by: LEAD, at: 1 } }} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(published).toHaveLength(0)
  })
})
