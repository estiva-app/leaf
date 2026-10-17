import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { ReferenceChip, ReferencesProvider } from './references'

const issue = {
  ref: 'nostr:issue',
  kind: 30851,
  eventId: 'nostr:issue',
  widget: 'card',
  noun: 'issue',
  slots: { title: { value: 'Write a comment in Leaf with @, !@, [ and /, and its formatting is kept' } },
  meta: [],
  actions: [],
  viaRecommendation: false,
} as unknown as ForeignObject

const meta = {
  title: 'Document/ReferenceChip',
  component: ReferenceChip,
  decorators: [
    (Story) => (
      <ReferencesProvider value={{ 'nostr:issue': issue, 'nostr:gone': null }}>
        <p className="text-body-2 text-text-secondary">
          See <Story /> before Friday.
        </p>
      </ReferencesProvider>
    ),
  ],
} satisfies Meta<typeof ReferenceChip>

export default meta
type Story = StoryObj<typeof meta>

/** A file that was read: its kind's icon and its name, cut at 24 characters, the whole of it on hover. */
export const Read: Story = { args: { uri: 'nostr:issue' } }

/** A file that cannot be read, or is not read yet: its address, quiet, never blank. */
export const Unread: Story = { args: { uri: 'nostr:gone' } }
