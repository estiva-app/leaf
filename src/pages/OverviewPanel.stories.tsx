import type { Meta, StoryObj } from '@storybook/react-vite'
import { TooltipProvider } from '@estiva-app/ui'
import { fn } from 'storybook/test'
import { FileTopics } from './FileTopics'
import { OverviewPanel } from './OverviewPanel'

const meta = {
  title: 'Pages/OverviewPanel',
  component: OverviewPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-screen">
        <TooltipProvider>
          <Story />
        </TooltipProvider>
      </div>
    ),
  ],
} satisfies Meta<typeof OverviewPanel>

export default meta
type Story = StoryObj<typeof meta>

const AUTHOR = 'b'.repeat(64)

/** A page two initiatives list: their chips under the heading, then Add to initiative. Invented names only. */
export const WithInitiatives: Story = {
  name: 'With initiatives',
  args: {
    topics: (
      <FileTopics
        topics={[
          { address: `30840:${AUTHOR}:launch`, folder: 'launch-team', title: 'Launch', archived: false },
          { address: `30840:${AUTHOR}:press`, folder: 'launch-team', title: 'Press kit', archived: false },
        ]}
        busy={new Set()}
        onChange={fn()}
        readChoices={async () => ({ yours: [], others: [] })}
      />
    ),
  },
}

/** A page no initiative can list: its name, and the kit's line for one empty part of a page. */
export const Empty: Story = {}
