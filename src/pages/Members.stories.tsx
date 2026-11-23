import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ToastProvider, TooltipProvider } from '@estiva-app/ui'
import { Members } from './Members'

/* Who is in a document or an initiative: the members pill and the Members dialog it opens. Invented names only. */

const ANA = 'a'.repeat(64)
const RAVI = 'b'.repeat(64)
const MARA = 'c'.repeat(64)
const DIRECTORY = { [ANA]: { displayName: 'Ana Duarte' }, [RAVI]: { displayName: 'Ravi Mehta' }, [MARA]: { displayName: 'Mara Sato' } }

const meta = {
  title: 'Pages/Members',
  component: Members,
  args: {
    members: new Map([ANA, RAVI, MARA].map((key) => [key, { pubkey: key } as never])),
    me: ANA,
    directory: DIRECTORY,
    onSetMine: fn(async () => true),
    onAdd: fn(async () => true),
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <ToastProvider>
          <div className="p-6">{Story()}</div>
        </ToastProvider>
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof Members>

export default meta
type Story = StoryObj<typeof meta>

/** The pill: up to three faces and how many, in a page's bar. */
export const Pill: Story = {}

/** Opened on an initiative: everyone it lists, its author captioned, Leave on your own row and Add members. */
export const Open: Story = {
  args: { roles: [{ pubkey: ANA, role: 'Author' }] },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: '3 members' }))
    await expect(await within(document.body).findByText('Author')).toBeVisible()
  },
}

/** An author who left: still listed, after the rest, "· not following", so a missed message has its reason. */
export const AuthorLeft: Story = {
  args: { me: RAVI, members: new Map([RAVI, MARA].map((key) => [key, { pubkey: key } as never])), roles: [{ pubkey: ANA, role: 'Author' }] },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: '2 members' }))
    await expect(await within(document.body).findByText('Author · not following')).toBeVisible()
  },
}

/** Archived: who is in it shows; nothing joins, leaves or adds. */
export const ReadOnly: Story = { args: { readOnly: true } }
