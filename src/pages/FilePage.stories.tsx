import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, mocked, userEvent, within } from 'storybook/test'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { descriptionTextToBlockDocument, serializeBlockDocument } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'
import { useThreads } from '../comments/useThreads'
import { query, viewerPubkey } from '../relay/bridge'
import { FilePage } from './FilePage'
import { answer, factsOf } from './fixtures/relay'
import { MIKY, PROFILES, shipIssue, threadsOn } from './fixtures/shipFiles'

/*
  A page as Leaf draws it, its bar included (ONE-5, step 5): FilePage itself, not a copy of it. Only the relay's reads
  are handed in: the page's own event, its changes and its comments, which say who is in it and its last edit
  (`fixtures/relay.ts`), the names on them, and its comments.
*/

const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const ROOT = 'f'.repeat(64)

/** A Leaf page: its title, its summary and its text. */
function leafPage(): ForeignObject {
  return {
    kind: 30842,
    ref: `30842:${MIKY}:launch-plan`,
    address: `30842:${MIKY}:launch-plan`,
    folder: FOLDER,
    naddr: 'naddr1launchplan',
    eventId: ROOT,
    meta: [],
    actions: [],
    slots: {
      title: { value: 'Launch plan' },
      subtitle: { value: 'What ships on launch day, who does what, and the order we do it in.' },
      [BODY_SLOT]: {
        value: serializeBlockDocument(descriptionTextToBlockDocument('We ship the beta to the first ten teams on Monday.\n\nKaterina owns the press notes and the launch post.')),
        format: 'blocks',
      },
    },
  } as unknown as ForeignObject
}

const meta = {
  title: 'Pages/File page',
  component: FilePage,
  parameters: { layout: 'fullscreen' },
  args: { file: leafPage(), loading: false },
  // The relay's answers, handed in. Miky is reading.
  beforeEach: ({ args }) => {
    const file = args.file
    if (file) mocked(useThreads).mockReturnValue(threadsOn(file))
    mocked(viewerPubkey).mockReturnValue(MIKY)
    mocked(query).mockImplementation(async (filters) =>
      filters.some((f) => Array.isArray(f.kinds) && f.kinds.includes(0)) ? PROFILES : file ? answer(factsOf(file), filters) : [],
    )
  },
  decorators: [
    (Story) => (
      <ToastProvider>
        <div className="flex h-screen flex-col">
          <Story />
        </div>
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof FilePage>

export default meta
type Story = StoryObj<typeof meta>

/** A Leaf page: its name in the bar, when it was last edited and by whom, who is in it, and the page's own buttons; its comments beside it. */
export const LeafPage: Story = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Edited 2 hours ago by Katerina')).toBeVisible()
  },
}

/** A Ship issue opened in Leaf: "Open" right after its name in the bar, and no ⋯, which is Ship's. */
export const AnotherAppsFile: Story = {
  args: { file: shipIssue() },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Edited 2 hours ago by Katerina')).toBeVisible()
  },
}

/** The side-panel button pressed: the Overview in the comments' place, empty for now. Press it again and the comments come back. */
export const OverviewOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Edited 2 hours ago by Katerina')
    await userEvent.click(canvas.getByRole('button', { name: 'Show side panel' }))
    await expect(await canvas.findByText('Nothing here yet.')).toBeVisible()
    // As after a mouse press: the pressed fill, without the focus ring the scripted press leaves.
    canvas.getByRole('button', { name: 'Hide side panel' }).blur()
  },
}

/**
 * A window narrower than 1024px (the Tablet viewport): the comments start hidden, and the last edit leaves the bar to
 * head the ⋯ menu, opened here.
 */
export const NarrowWindow: Story = {
  globals: { viewport: { value: 'tablet', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: '2 members' })
    await userEvent.click(canvas.getByRole('button', { name: /^More/ }))
    await expect(await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'Edited 2 hours ago by Katerina' })).toBeVisible()
  },
}
