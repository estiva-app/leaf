import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { descriptionTextToBlockDocument } from '@estiva-app/protocol'
import { PartFrame } from './PartView'

/*
  A part as a comment draws it, from a read handed in: the read itself is the relay's (`usePart`). Its file is what
  interop projects; only what the frame reads is here.
*/

const AUTHOR = 'a'.repeat(64)
const PAGE = `30842:${AUTHOR}:5a1e0c2b-9a41-4c0e-8d7f-3b2a1c0d9e8f`
const ISSUE = `30851:${'b'.repeat(64)}:7c3d9e10-2f4b-4a6c-9b8d-1e0f2a3b4c5d`

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
const pointerOf = (address: string, block: { id?: string }) => ({ address, block: block.id ?? '' })
const SHORT = blockOf('We ship on Friday, after the last review with Miky.')
const LONG = blockOf(
  'We ship on Friday, after the last review with Miky. Before that, every app takes the new kit, the comments column ' +
    'opens on the right in each of them, and the cards keep their pickers while the text is written. The release notes say ' +
    'what moved and why, one line each, and the screenshots stay out of the repository. Katerina looks at each screen in ' +
    'Storybook first, then in the app, and says what still reads wrong; what she finds goes in before the release, not after. ' +
    'Anything left over becomes its own issue, with the screen it belongs to named in its title. On the day itself, the ' +
    'apps go out one at a time, Peek first, then Ship, then Leaf, each read back on its own host before the next one goes, ' +
    'and a link to every story that changed is posted under the release, so anyone can look before they ask.',
)

const meta = {
  title: 'Comments/PartView',
  component: PartFrame,
  args: { pointer: pointerOf(PAGE, SHORT), read: { state: 'loading' } },
} satisfies Meta<typeof PartFrame>

export default meta
type Story = StoryObj<typeof meta>

/** A block of a Leaf document: "A part of this document", its title takes you to it at the block, in Leaf. */
export const OfADocument: Story = { args: { read: { state: 'resolved', block: SHORT, object: page } } }

/** A long block: cut behind Show more. */
export const Long: Story = { args: { pointer: pointerOf(PAGE, LONG), read: { state: 'resolved', block: LONG, object: page } } }

/** A block of a Ship issue: its title opens it in Ship, in a new tab, at the block when Ship declares a link to one. */
export const OfAShipIssue: Story = { args: { pointer: pointerOf(ISSUE, SHORT), read: { state: 'resolved', block: SHORT, object: issue } } }

/** While it is read: the card's placeholder, its kind known from the address. */
export const Loading: Story = { args: { read: { state: 'loading' } } }

/** Not this reader's to see: no title, no words. */
export const NotAvailable: Story = { args: { read: { state: 'unavailable' } } }

/** Its page deleted, as a trusted deletion naming it says (SPEC §13.6.1): "A part of this document deleted", no way out. */
export const Deleted: Story = { args: { read: { state: 'deleted' } } }

/** Its block deleted from the page, which is still there: "This part was deleted", in the kit's words. */
export const BlockDeleted: Story = { args: { read: { state: 'detached', object: page } } }

/** The page is not written in blocks, so no block can be found: "This part can't be shown", linking to the whole page. */
export const CannotBeShown: Story = { args: { read: { state: 'unaddressable', object: page } } }
