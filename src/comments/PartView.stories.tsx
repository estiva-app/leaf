import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { descriptionTextToBlockDocument } from '@estiva-app/protocol'
import { PartFrame } from './PartView'

/*
  A part as a comment draws it, from a read handed in: the read itself is the relay's (`usePart`). Its file is what
  interop projects; only what the frame reads is here.
*/

const AUTHOR = 'a'.repeat(64)
const PAGE = `30842:${AUTHOR}:launch-plan`
const ISSUE = `30851:${'b'.repeat(64)}:ltx-3`

const page = { ref: 'r', kind: 30842, eventId: 'e', widget: 'card', address: PAGE, slots: { title: { value: 'Launch plan' } }, meta: [], actions: [], viaRecommendation: false } as unknown as ForeignObject
const issue = {
  ...page,
  kind: 30851,
  address: ISSUE,
  appName: 'Ship',
  openUrl: 'https://ship.estiva.app/o/naddr1ltx3',
  slots: { title: { value: 'Sidebar should not show Peek topics' } },
} as unknown as ForeignObject

const blockOf = (text: string) => descriptionTextToBlockDocument(text).content[0]
const SHORT = blockOf('We ship on Friday, after the last review with Miky.')
const LONG = blockOf(
  'We ship on Friday, after the last review with Miky. Before that, every app takes the new kit, the comments column ' +
    'opens on the right in each of them, and the cards keep their pickers while the text is written. The release notes say ' +
    'what moved and why, one line each, and the screenshots stay out of the repository. Katerina looks at each screen in ' +
    'Storybook first, then in the app, and says what still reads wrong; what she finds goes in before the release, not after. ' +
    'Anything left over becomes its own issue, with the screen it belongs to named in its title.',
)

const meta = {
  title: 'Comments/PartView',
  component: PartFrame,
  args: { pointer: { address: PAGE, block: 'b1' }, read: { state: 'loading' } },
} satisfies Meta<typeof PartFrame>

export default meta
type Story = StoryObj<typeof meta>

/** A block of a Leaf document: "A part of this document", its title and Open take you to it at the block, in Leaf. */
export const OfADocument: Story = { args: { read: { state: 'resolved', block: SHORT, object: page } } }

/** A long block: cut behind Show more, Open level with it. */
export const Long: Story = { args: { read: { state: 'resolved', block: LONG, object: page } } }

/** A block of a Ship issue: Open in Ship, in a new tab, at the block when Ship declares a link to one. */
export const OfAShipIssue: Story = { args: { pointer: { address: ISSUE, block: 'b1' }, read: { state: 'resolved', block: SHORT, object: issue } } }

/** While it is read: the card's placeholder, its kind known from the address. */
export const Loading: Story = { args: { read: { state: 'loading' } } }

/** Deleted, or not this reader's to see, which read the same: no title, no words. */
export const NotAvailable: Story = { args: { read: { state: 'unavailable' } } }

/** Its block deleted from the page: the page's title, and says so. */
export const BlockDeleted: Story = { args: { read: { state: 'detached', object: page } } }

/** The page is not written in blocks, so no block can be found: the page's title, and says so. */
export const CannotBeShown: Story = { args: { read: { state: 'unaddressable', object: page } } }
