import type { Meta, StoryObj } from '@storybook/react-vite'
import { SummaryCount } from './SummaryCount'

const meta = {
  title: 'Document/SummaryCount',
  component: SummaryCount,
} satisfies Meta<typeof SummaryCount>

export default meta
type Story = StoryObj<typeof meta>

/** A summary past about 240 characters: the count, a warning, and nothing refused. */
export const LongSummary: Story = {
  args: { text: 'What we decided on the Friday call, who owns each part, and the order we do it in. '.repeat(4) },
}

/** At or under the limit: nothing is drawn. */
export const ShortSummary: Story = { args: { text: 'What we decided on the Friday call.' } }
