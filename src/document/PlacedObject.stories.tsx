import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { PlacedObject, ReferencesProvider, type Resolved } from './references'

const issue = {
  ref: 'nostr:a',
  kind: 30851,
  eventId: 'nostr:a',
  widget: 'card',
  noun: 'issue',
  slots: { title: { value: 'Fix the login' }, subtitle: { value: 'Passkeys fail on Safari 18 when opened from Mail.' } },
  meta: [],
  actions: [],
  viaRecommendation: false,
} as unknown as ForeignObject

const resolved: Resolved = { 'nostr:a': issue, 'nostr:b': undefined, 'nostr:c': null }

const meta = {
  title: 'Document/Placed object',
  component: PlacedObject,
  decorators: [
    (Story) => (
      <ReferencesProvider value={resolved}>
        {/* The comments column's width, so the card reads at its real size. */}
        <div className="w-96 p-4">
          <Story />
        </div>
      </ReferencesProvider>
    ),
  ],
} satisfies Meta<typeof PlacedObject>

export default meta
type Story = StoryObj<typeof meta>

/** The card a comment carries, or the one under the comment box while it is written: the title, the summary, the type. */
export const Detailed: Story = { args: { uri: 'nostr:a', layout: 'detailed' } }

/** A line that is only a link, drawn as its row: the title alone. */
export const Compact: Story = { args: { uri: 'nostr:a', layout: 'compact' } }

/** While the file is read: a placeholder its height. */
export const Reading: Story = { args: { uri: 'nostr:b', layout: 'detailed' } }

/** A file the reader cannot read: said so, never blank. */
export const Unavailable: Story = { args: { uri: 'nostr:c', layout: 'detailed' } }
