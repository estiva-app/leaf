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
const row = (n: number, title: string, folder: string, byName: string, ago: number, summary?: string) => ({
  address: `30842:${'a'.repeat(64)}:p${n}`,
  kind: 30842,
  naddr: `naddr1p${n}`,
  eventId: `e${n}`,
  folderId: folder.toLowerCase(),
  title,
  summary,
  folder,
  at: NOW - ago,
  by: 'a'.repeat(64),
  byName,
})

/** A Ship issue or project whose text, title or summary you changed in Leaf (LTX-2), labelled by its type as the tree labels it. */
const shipRow = (kind: 30850 | 30851, ...args: Parameters<typeof row>) => ({
  ...row(...args),
  address: `${kind}:${'a'.repeat(64)}:s${args[0]}`,
  kind,
  naddr: `naddr1s${args[0]}`,
  type: kind === 30851 ? 'Issue' : 'Project',
})

/**
 * The pages you touched last, newest change first, naming who made it (Katerina's Home story); a summary is the row's
 * second line. A Ship issue or project whose text you changed says what it is.
 */
export const Recent: Story = {
  args: {
    relay: 'http://localhost:3000',
    state: 'live',
    now: NOW,
    recent: [
      row(1, 'Launch plan', 'Launch', 'Ana Duarte', 2 * 60_000, 'What ships on launch day, who does what, and the order we do it in.'),
      shipRow(30851, 5, 'Press notes go out with the launch post', 'Launch', 'Ana Duarte', 5 * 3_600_000, 'The notes and the post go out together, at nine on launch day.'),
      // A title too long for the row ends in "…" before its type, and the tooltip says it whole.
      shipRow(30851, 7, 'The launch post links every press note to the page it came from, and each note names who checked it last', 'Launch', 'Ravi Mehta', 8 * 3_600_000, 'Readers who open a note from the post land on the page it came from, with the person who checked it named.'),
      row(2, 'Checklist', 'Launch', 'Ravi Mehta', 26 * 3_600_000, 'Every check before we switch the domain over, ticked by whoever ran it.'),
      shipRow(30850, 6, 'Beta for the first ten teams', 'Launch', 'Ravi Mehta', 2 * 86_400_000),
      row(3, 'Type scale notes', 'Design', 'Mia Chen', 3 * 86_400_000),
      row(4, 'Interview guide', 'Design', 'Sam Porter', 8 * 86_400_000),
    ],
  },
}

/** A workspace with no pages: New document. */
export const Empty: Story = { args: { relay: 'http://localhost:3000', state: 'live', recent: [], onNew: () => {} } }

/** The pages could not be read. */
export const Failed: Story = { args: { relay: 'http://localhost:3000', state: 'live', recent: 'failed' } }
