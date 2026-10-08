import type { Meta, StoryObj } from '@storybook/react-vite'
import { LeafPrototype } from './LeafPrototype'

/**
 * A clickable prototype of Leaf, built from estiva-ui parts, on invented data.
 *
 * Try: select a few words and press the comment button at the end of the strip;
 * click a yellow highlight to read its comment; click a card in the column to
 * find its words. Also the tree, Home's rows, a block's handle, `/`, `[` and `@`.
 *
 * Two ways to read a comment on words: **A** in the column beside the text,
 * **B** in a bubble on the words.
 */
const meta = {
  title: 'Pages/Leaf prototype',
  component: LeafPrototype,
  parameters: {
    layout: 'fullscreen',
    // Each story is a whole app: on the Docs page, each in its own frame.
    docs: { story: { inline: false, iframeHeight: 820 } },
  },
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

/** A: comments in the column. Highlighted words have a comment; click one, or a card. */
export const ADocument: Story = { name: 'A · Document', args: { start: 'launch-plan' } }

/** A: a comment open. Its words are underlined in the text, its card is marked, and it can be answered. */
export const AReadingAComment: Story = { name: 'A · Reading a comment', args: { start: 'launch-plan', active: 't1' } }

/** A: words selected and Comment pressed. The words stay marked while you write in the column. */
export const ACommentOnWords: Story = {
  name: 'A · Comment on selected words',
  args: { start: 'launch-plan', draft: { block: 'lp-4', quote: 'grow from what they tell us' } },
}

/** B: comments in bubbles. The column starts hidden; the highlights are the way in. */
export const BDocument: Story = { name: 'B · Document', args: { start: 'launch-plan', commentsIn: 'bubble' } }

/** B: a comment open, in a bubble under its words. */
export const BReadingAComment: Story = { name: 'B · Reading a comment', args: { start: 'launch-plan', commentsIn: 'bubble', active: 't1' } }

/** B: words selected and Comment pressed. The bubble opens under them to write in. */
export const BCommentOnWords: Story = {
  name: 'B · Comment on selected words',
  args: { start: 'launch-plan', commentsIn: 'bubble', draft: { block: 'lp-4', quote: 'grow from what they tell us' } },
}

/** Where Leaf opens: the documents you touched last. */
export const Home: Story = { args: { start: 'home' } }

/** A comment on a whole block, from its handle's Comment row. */
export const CommentOnABlock: Story = {
  args: { start: 'launch-plan', draft: { block: 'lp-3c', quote: 'The first week feels calm, not busy.' } },
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
