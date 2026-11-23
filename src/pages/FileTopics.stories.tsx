import type { Meta, StoryObj } from '@storybook/react-vite'
import type { TopicsRead } from '@estiva-app/interop'
import { TooltipProvider } from '@estiva-app/ui'
import { fn } from 'storybook/test'
import { heldTopics, type TopicOfFile } from '../document/fileTopics'
import { FileTopics } from './FileTopics'

/*
  A file's Initiatives line, as a document's page draws it under its title: each initiative that lists the file as a
  chip with ✕, then Add to initiative. Invented names only.
*/

const AUTHOR = 'b'.repeat(64)
const ME = 'a'.repeat(64)
const LAUNCH: TopicOfFile = { address: `30840:${AUTHOR}:launch`, folder: 'launch-team', title: 'Launch', openUrl: 'https://peek.estiva.app/topic/launch-launch', archived: false }
const PRESS: TopicOfFile = { address: `30840:${AUTHOR}:press`, folder: 'launch-team', title: 'Press kit', openUrl: 'https://peek.estiva.app/topic/press-kit-press', archived: false }
/** A team's # topic in Peek (a space), listing the file too. */
const GENERAL: TopicOfFile = { address: `30840:${AUTHOR}:general`, folder: 'launch-team', title: 'general', openUrl: 'https://peek.estiva.app/topic/general-general', archived: false }

const meta = {
  title: 'Pages/File initiatives',
  component: FileTopics,
  parameters: { layout: 'padded' },
  args: { topics: [LAUNCH, PRESS], busy: new Set<string>(), onChange: fn(), readChoices: async () => ({ yours: [], others: [] }) },
  decorators: [
    (Story) => (
      <TooltipProvider>{Story()}</TooltipProvider>
    ),
  ],
} satisfies Meta<typeof FileTopics>

export default meta
type Story = StoryObj<typeof meta>

/** Two initiatives list the file: each opens its page in Leaf. */
export const Default: Story = {}

/**
 * The file is also listed on a team's # topic (a Peek space, `isKnownSpace`): its chip opens Peek beside Leaf. Drawn as
 * the app draws it today, with the initiative's ◎ (review of 23 November, A1 and E4; what it should wear waits on
 * Katerina's answer to question 1).
 */
export const OnATopic: Story = {
  args: { topics: [LAUNCH, GENERAL] },
  // The tab's read of every topic knows `general` for a space, as the page's read would; forgotten when the story is left.
  beforeEach: async () => {
    const space = { address: GENERAL.address, space: true, yours: true, folder: GENERAL.folder, listed: [], object: {} }
    await heldTopics.reload(async () => ({ me: ME, topics: [space], membership: {} }) as unknown as TopicsRead)
    return () => heldTopics.clear()
  },
}

/** Nothing lists it yet. */
export const None: Story = { args: { topics: [] } }
