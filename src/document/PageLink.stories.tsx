import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { ToastProvider } from '@estiva-app/ui'
import { mocked } from 'storybook/test'
import { query, viewerPubkey } from '../relay/bridge'
import { PageLink } from './PageLink'
import { ReferencesProvider } from './references'

const project = {
  ref: 'nostr:project',
  kind: 30850,
  eventId: 'nostr:project',
  widget: 'card',
  noun: 'project',
  slots: { title: { value: 'Comments work the same everywhere' } },
  meta: [],
  actions: [],
  viaRecommendation: false,
} as unknown as ForeignObject

const meta = {
  title: 'Document/PageLink',
  component: PageLink,
  // A card's pickers say a refused change in a toast.
  decorators: [
    (Story) => (
      <ToastProvider>
        <ReferencesProvider value={{ 'nostr:project': project }}>{Story()}</ReferencesProvider>
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof PageLink>

export default meta
type Story = StoryObj<typeof meta>

/** A link in a sentence: the kit's chip. */
export const Chip: Story = { args: { uri: 'nostr:project' } }

/** A link alone on its line: the kit's row. */
export const Row: Story = { args: { uri: 'nostr:project', place: 'row' } }

/** A link its writer chose Card for, in the row's place. */
export const AsCard: Story = { args: { uri: 'nostr:project', place: 'card' } }

const LEAD = 'f3'.repeat(32)
const PAGE = `30842:${LEAD}:5a1e0c2b-9a41-4c0e-8d7f-3b2a1c0d9e8f`
const page = {
  ref: 'nostr:page',
  kind: 30842,
  eventId: 'e',
  widget: 'card',
  noun: 'document',
  address: PAGE,
  openUrl: 'https://leaf.estiva.app/document/launch-plan-5a1e0c2b-9a41-4c0e-8d7f-3b2a1c0d9e8f',
  slots: { title: { value: 'Launch plan' } },
  meta: [],
  actions: [],
  viaRecommendation: false,
} as unknown as ForeignObject
/** Two comments on the page, as the relay answers its count's read. */
const comments = [1, 2].map((n) => ({ id: String(n).repeat(64), pubkey: LEAD, created_at: 1_760_000_000 + n, kind: 1111, tags: [['A', PAGE], ['K', '30842']], content: 'Looks right.', sig: '' }))

/** A Leaf document alone on its line: the kit's row with its comment count, which opens the page with its comments shown. */
export const RowWithItsComments: Story = {
  args: { uri: 'nostr:page', place: 'row' },
  decorators: [(Story) => <ReferencesProvider value={{ 'nostr:page': page }}>{Story()}</ReferencesProvider>],
  beforeEach: () => {
    mocked(query).mockResolvedValue(comments)
  },
}

const withStatus = {
  ...project,
  address: `30850:${LEAD}:p`,
  slots: { title: { value: 'Comments work the same everywhere' }, status: { value: 'Planned', colour: 'neutral', field: 'status' } },
  actions: [{ id: 'set-status', label: 'Status', control: 'select', field: 'status', current: 'planned', options: [{ value: 'planned', label: 'Planned' }, { value: 'done', label: 'Done' }] }],
} as unknown as ForeignObject

/** A card while the caret is in the page's text: its Status picker stays (Katerina, 30 Oct). Signed in here. */
export const CardWhileEditing: Story = {
  args: { uri: 'nostr:status', place: 'card', editing: true },
  decorators: [(Story) => <ReferencesProvider value={{ 'nostr:status': withStatus }}>{Story()}</ReferencesProvider>],
  beforeEach: () => {
    mocked(viewerPubkey).mockReturnValue(LEAD)
    mocked(query).mockResolvedValue([])
  },
}
