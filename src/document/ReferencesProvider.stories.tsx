import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
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
  title: 'Document/ReferencesProvider',
  component: ReferencesProvider,
} satisfies Meta<typeof ReferencesProvider>

export default meta
type Story = StoryObj<typeof meta>

/** Two chips inside one provider: the one it knows draws its name, the other waits for its read. */
export const TwoChips: Story = {
  args: {
    value: { 'nostr:project': project },
    children: (
      <p className="text-body-2 text-text-secondary">
        <PageLink uri="nostr:project" /> and <PageLink uri="nostr:unknown" />
      </p>
    ),
  },
}

/** A link whose read answered nothing, or kept failing after its retries: it says it is not available, never a placeholder for good. */
export const NotAvailable: Story = {
  args: {
    value: { 'nostr:gone': null },
    children: (
      <p className="text-body-2 text-text-secondary">
        See <PageLink uri="nostr:gone" />
      </p>
    ),
  },
}
