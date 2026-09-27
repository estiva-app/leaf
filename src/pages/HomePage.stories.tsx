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

/** Connected, as the person who signed in. */
export const Connected: Story = { args: { relay: 'http://localhost:3000', state: 'live', name: 'Alex Kim' } }
