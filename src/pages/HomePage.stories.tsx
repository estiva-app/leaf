import type { Meta, StoryObj } from '@storybook/react-vite'
import { HomePage } from './HomePage'

const meta = {
  title: 'Pages/Home',
  component: HomePage,
  parameters: { layout: 'fullscreen' },
  // Stands in for the frame's main: a flex column the height of the screen,
  // which is what the page is drawn into in the app.
  decorators: [
    (Story) => (
      <div className="flex h-screen flex-col">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HomePage>

export default meta
type Story = StoryObj<typeof meta>

/** No relay set: the app runs alone, the way it starts. */
export const RunningAlone: Story = { args: { relay: null, state: 'off' } }

/** A relay set, before it has signed the connection in. */
export const Connecting: Story = { args: { relay: 'http://localhost:3000', state: 'connecting' } }

/** Connected, as the person who signed in, while their pages are read. */
export const Connected: Story = { args: { relay: 'http://localhost:3000', state: 'live', name: 'Alex Kim' } }

const NOW = Date.UTC(2026, 9, 9, 8)
const row = (n: number, title: string, folder: string, byName: string, ago: number) => ({
  address: `30842:${'a'.repeat(64)}:p${n}`,
  naddr: `naddr1p${n}`,
  eventId: `e${n}`,
  title,
  folder,
  at: NOW - ago,
  by: 'a'.repeat(64),
  byName,
})

/** The pages you touched last, newest change first, naming who made it (Katerina's Home story). */
export const Recent: Story = {
  args: {
    relay: 'http://localhost:3000',
    state: 'live',
    now: NOW,
    recent: [
      row(1, 'Launch plan', 'Launch', 'Ana Duarte', 2 * 60_000),
      row(2, 'Checklist', 'Launch', 'Ravi Mehta', 26 * 3_600_000),
      row(3, 'Type scale notes', 'Design', 'Mia Chen', 3 * 86_400_000),
      row(4, 'Interview guide', 'Design', 'You', 8 * 86_400_000),
    ],
  },
}

/** A workspace with no pages: New document. */
export const Empty: Story = { args: { relay: 'http://localhost:3000', state: 'live', recent: [], onNew: () => {} } }

/** The pages could not be read. */
export const Failed: Story = { args: { relay: 'http://localhost:3000', state: 'live', recent: 'failed' } }
