import type { Meta, StoryObj } from '@storybook/react-vite'
import { FieldLine } from '@estiva-app/ui'
import { ArchivedNotice } from './ArchivedNotice'

const noop = () => {}
const at = Math.floor(Date.now() / 1000) - 86400
const PAGE = `30842:${'b'.repeat(64)}:5e1a0c2e-3c1d-4b7e-9f1a-1d2c3b4a5f60`
const PROJECT = `30850:${'b'.repeat(64)}:bea1c4f7-cab4-47a1-bb4b-966e20fcf945`

/**
 * Prototype (a3257366): an archived Leaf page shows the notice Peek and Ship show, under its title — who archived
 * it, when, the resolution, and the way back. The comment box keeps its plain line. For Miky to judge first.
 */
const meta = {
  title: 'Pages/ArchivedNotice',
  component: ArchivedNotice,
  args: { archive: { by: 'x', at, resolution: 'Superseded by the Q4 plan.' }, by: 'Miky', onUnarchive: noop },
  decorators: [
    (Story, { args }) => (
      <div className="flex w-[1040px] bg-bg-surface">
        <div className="flex min-w-0 flex-1 flex-col gap-4 px-16 py-10">
          <div className="flex flex-col gap-1">
            <h1 className="text-h1 text-text-primary">Launch checklist</h1>
            <p className="text-body-1 text-text-secondary">What has to be true before we tell anyone.</p>
          </div>
          <Story />
          <p className="text-body-1 text-text-secondary">Pricing page live, docs reviewed, the demo Folder seeded…</p>
        </div>
        <div className="flex w-96 flex-none flex-col justify-end border-l border-border-subtle p-4">
          <FieldLine tone="helper">{args.withWhat ? `Unarchive the ${args.withWhat} to comment.` : 'Archived. Unarchive it to comment.'}</FieldLine>
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof ArchivedNotice>

export default meta
type Story = StoryObj<typeof meta>

/** Archived by itself, with a resolution: Unarchive restores it here. */
export const Archived: Story = {}

/** Archived by itself, no resolution given: the one line and Unarchive. */
export const NoResolution: Story = { args: { archive: { by: 'x', at } } }

/** Archived with the page above it: Open page opens that page in Leaf, whose ⋯ menu has Unarchive. */
export const WithItsPage: Story = {
  args: { archive: { by: 'x', at, with: PAGE }, withWhat: 'page', parentHref: '#page-above', onUnarchive: undefined },
}

/** Archived with its Ship project: Open project opens the project in Estiva Ship, where it can be unarchived. */
export const WithItsProject: Story = {
  args: {
    archive: { by: 'x', at, with: PROJECT, resolution: 'Shipped; the rest moved to the next project.' },
    withWhat: 'project',
    parentHref: '#ship-project',
    onUnarchive: undefined,
  },
}
