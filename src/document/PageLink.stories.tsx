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
  title: 'Document/PageLink',
  component: PageLink,
  decorators: [(Story) => <ReferencesProvider value={{ 'nostr:project': project }}>{Story()}</ReferencesProvider>],
} satisfies Meta<typeof PageLink>

export default meta
type Story = StoryObj<typeof meta>

/** A link in a sentence: the kit's chip. */
export const Chip: Story = { args: { uri: 'nostr:project' } }

/** A link alone on its line: the kit's row. */
export const Row: Story = { args: { uri: 'nostr:project', place: 'row' } }

/** A link its writer chose Card for, in the row's place. */
export const AsCard: Story = { args: { uri: 'nostr:project', place: 'card' } }
