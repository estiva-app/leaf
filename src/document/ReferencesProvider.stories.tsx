import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { ReferenceChip, ReferencesProvider } from './references'

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

/** Two chips inside one provider: the one it knows draws its name, the other its address. */
export const TwoChips: Story = {
  args: {
    value: { 'nostr:project': project },
    children: (
      <p className="text-body-2 text-text-secondary">
        <ReferenceChip uri="nostr:project" /> and <ReferenceChip uri="nostr:unknown" />
      </p>
    ),
  },
}
