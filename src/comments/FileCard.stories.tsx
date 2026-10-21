import type { Meta, StoryObj } from '@storybook/react-vite'
import { FileCard } from './CommentFiles'

const meta = {
  title: 'Comments/FileCard',
  component: FileCard,
} satisfies Meta<typeof FileCard>

export default meta
type Story = StoryObj<typeof meta>

const PICTURE = { url: 'https://relay.example/a279.png', m: 'image/png', x: 'a279', size: 412_000, filename: 'after-merge.png', alt: 'After the merge' }

/** A picture: its thumbnail, opened full size on a click. Signed out here, so it draws the card that says it can't be read. */
export const Picture: Story = { args: { file: PICTURE } }

/** In a page's text: no Download, as in Ship's description editor; a picture still opens. */
export const InAPage: Story = { args: { file: PICTURE, download: false } }

/** Any other file: its row, which downloads. */
export const File: Story = { args: { file: { url: 'https://relay.example/spec.pdf', m: 'application/pdf', x: 'b1', size: 120_000, filename: 'spec.pdf' } } }
