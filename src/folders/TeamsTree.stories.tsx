import type { Meta, StoryObj } from '@storybook/react-vite'
import { AppShell, Sidebar, type NavTreeGroup } from '@estiva-app/ui'
import { fn } from 'storybook/test'
import { TeamsTree } from './TeamsTree'

/* The sidebar's teams: yours first, the rest folded under Other teams, as Peek's Teams column. Invented names only. */

const page = (id: string, label: string) => ({ id, label, href: `#${id}` })
const TEAMS: NavTreeGroup[] = [
  { id: 'launch', title: 'Launch team', nodes: [page('plan', 'Launch plan'), page('press', 'Press notes')] },
  { id: 'design', title: 'Design', nodes: [page('tokens', 'Tokens')] },
  { id: 'support', title: 'Support', nodes: [page('faq', 'Common questions')] },
  { id: 'sales', title: 'Sales', nodes: [] },
]

const meta = {
  title: 'Pages/Teams in the sidebar',
  component: TeamsTree,
  parameters: { layout: 'fullscreen' },
  args: { groups: TEAMS, yours: new Set(['launch', 'design']), failed: false, onNewDocument: fn() },
  argTypes: { groups: { control: false }, yours: { control: false } },
  decorators: [
    (Story) => (
      <div className="h-screen">
        <AppShell
          nav={
            <Sidebar>
              <Story />
            </Sidebar>
          }
        >
          <div />
        </AppShell>
      </div>
    ),
  ],
} satisfies Meta<typeof TeamsTree>

export default meta
type Story = StoryObj<typeof meta>

/** Your teams, each a fold over its pages; the ones you are not in under Other teams, shut, with their count. */
export const Default: Story = {}

/** A page open in a team you are not in: Other teams opens for it. */
export const OnAnOtherTeam: Story = { name: 'On an other team', args: { openTeam: 'support', selected: 'faq' } }

/** Before Leaf knows which teams you are in: every team in one list, as before. */
export const NotKnownYet: Story = { name: 'Not known yet', args: { yours: undefined } }

/** The teams could not be read. */
export const Failed: Story = { args: { failed: true } }
