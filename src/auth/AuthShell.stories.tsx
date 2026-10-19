import type { Meta, StoryObj } from '@storybook/react-vite'
import { AuthShell } from './AuthShell'

const meta = {
  title: 'Auth/AuthShell',
  component: AuthShell,
  args: { state: { phase: 'authenticating', reason: 'session_expired' }, onContinue: () => {} },
} satisfies Meta<typeof AuthShell>

export default meta
type Story = StoryObj<typeof meta>

/** The sign-in ended while Leaf was open (AUT-5): it takes the page's place, and Continue comes back to it. */
export const SessionEnded: Story = {}

/** Another tab signed out: the plain screen, as Peek draws it. */
export const SignedOutInAnotherTab: Story = { args: { state: { phase: 'authenticating', reason: 'no_session' } } }

/** Waiting on Estiva ID: no words, nothing that would flash. */
export const Checking: Story = { args: { state: { phase: 'checking' } } }
