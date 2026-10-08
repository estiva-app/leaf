import type { Meta, StoryObj } from '@storybook/react-vite'
import { LeafPrototype } from './LeafPrototype'

/**
 * A clickable prototype of Leaf, built only from estiva-ui parts, on invented
 * data. Click the tree, Home's rows, a block's handle (Comment), `/`, `[` and
 * `@` in the text, and select words for the formatting strip.
 */
const meta = {
  title: 'Pages/Leaf prototype',
  component: LeafPrototype,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LeafPrototype>

export default meta
type Story = StoryObj<typeof meta>

/** Where Leaf opens: the documents you touched last. */
export const Home: Story = { args: { start: 'home' } }

/** A document with its comments beside it. */
export const Document: Story = { args: { start: 'launch-plan' } }

/** Commenting on one block: its handle's Comment row opened a draft in the column. */
export const CommentOnABlock: Story = {
  args: { start: 'launch-plan', draft: { id: 'lp-6', quote: 'Pricing questions go to Pricing in Peek, and @Ravi Mehta owns the press notes.' } },
}

/** The same document with the comments column hidden. */
export const CommentsHidden: Story = { args: { start: 'launch-plan', sidePanel: false } }

/** A new document: no title, no text, no comments, so no column. */
export const NewDocument: Story = { args: { start: 'blank' } }

/** Another app's file picked in the tree. */
export const AnotherAppsFile: Story = { args: { start: 'onboarding' } }

/** Everything still being read. */
export const Loading: Story = { args: { start: 'launch-plan', loading: true } }

/** A workspace with nothing in it yet. */
export const Empty: Story = { args: { start: 'home', empty: true } }
