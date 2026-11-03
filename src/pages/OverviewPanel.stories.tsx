import type { Meta, StoryObj } from '@storybook/react-vite'
import { OverviewPanel } from './OverviewPanel'

const meta = {
  title: 'Pages/OverviewPanel',
  component: OverviewPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OverviewPanel>

export default meta
type Story = StoryObj<typeof meta>

/** Empty for now: its name, and the kit's line for one empty part of a page. */
export const Empty: Story = {}
