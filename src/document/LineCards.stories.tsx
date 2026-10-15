import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { LineCards } from './references'

const file = (uri: string, title: string, noun: string, summary?: string): [string, ForeignObject] => [
  uri,
  {
    ref: uri,
    kind: 30851,
    eventId: uri,
    widget: 'card',
    noun,
    slots: { title: { value: title }, ...(summary ? { subtitle: { value: summary } } : {}) },
    meta: [],
    actions: [],
    viaRecommendation: false,
  } as unknown as ForeignObject,
]

const LONG =
  'Passkeys fail on Safari 18 when the page was opened from a link in Mail, because the window has no opener and ' +
  'the ceremony is started before focus returns; the fix is to wait for focus and retry once, and to say so on the ' +
  'sign-in screen while it waits rather than showing a spinner that never ends…'

const resolved = Object.fromEntries([
  file('nostr:a', 'Fix the login', 'issue', 'Passkeys fail on Safari 18 when opened from Mail.'),
  file('nostr:b', 'Fix the login', 'issue', LONG),
  file('nostr:c', 'Q4 planning', 'project'),
])

const meta = {
  title: 'Document/Reference cards',
  component: LineCards,
  decorators: [
    (Story) => (
      <div className="max-w-[640px] p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LineCards>

export default meta
type Story = StoryObj<typeof meta>

/** A detailed card shows the file's summary under its title (SPEC §6.12), two lines at most. */
export const DetailedWithSummary: Story = {
  args: {
    resolved,
    cards: [
      { uri: 'nostr:a', layout: 'detailed' },
      { uri: 'nostr:b', layout: 'detailed' },
      { uri: 'nostr:c', layout: 'detailed' },
    ],
  },
}

/** A row stays one line: the title alone, summary or not. */
export const Rows: Story = {
  args: {
    resolved,
    cards: [
      { uri: 'nostr:a', layout: 'compact' },
      { uri: 'nostr:c', layout: 'compact' },
    ],
  },
}
