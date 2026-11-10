import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { ReferencesProvider } from '../document/references'
import { CommentCard } from './CommentCard'

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
  title: 'Comments/CommentCard',
  component: CommentCard,
  decorators: [
    (Story) => (
      <ReferencesProvider value={{ 'nostr:project': project }}>
        <div className="max-w-md">
          <Story />
        </div>
      </ReferencesProvider>
    ),
  ],
} satisfies Meta<typeof CommentCard>

export default meta
type Story = StoryObj<typeof meta>

/** A project as its card, taken from the page's read: on a topic's page, or under a comment. */
export const Card: Story = { args: { uri: 'nostr:project' } }

/** The same file as an old comment's one-line row. */
export const Compact: Story = { args: { uri: 'nostr:project', compact: true } }
