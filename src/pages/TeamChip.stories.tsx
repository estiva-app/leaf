import type { Meta, StoryObj } from '@storybook/react-vite'
import { KindIcon, PageHeader } from '@estiva-app/ui'
import { TeamChip } from './TeamChip'

const meta = {
  title: 'Pages/TeamChip',
  component: TeamChip,
  args: { name: 'Launch team' },
} satisfies Meta<typeof TeamChip>

export default meta
type Story = StoryObj<typeof meta>

/** The chip alone. */
export const Default: Story = {}

/** In a page's bar, right after the name: an initiative's page, as Peek's. */
export const InAnInitiativesBar: Story = {
  render: (args) => (
    <div className="w-full border border-border-default bg-bg-surface">
      <PageHeader title="Cross-app navigation" leading={<KindIcon kind="topic" />} after={<TeamChip {...args} />} />
    </div>
  ),
}
