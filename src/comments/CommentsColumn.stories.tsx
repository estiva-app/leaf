import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, mocked, userEvent, within } from 'storybook/test'
import type { Editor } from '@tiptap/react'
import { archivedLine } from '@estiva-app/conversation'
import { blockIds, descriptionTextToBlockDocument, serializeBlockDocument } from '@estiva-app/protocol'
import { Divider, Panel, ToastProvider } from '@estiva-app/ui'
import { LiveDocument } from '../document/LiveDocument'
import { KATERINA, MIKY, PROFILES } from '../pages/fixtures/shipFiles'
import { query, viewerPubkey } from '../relay/bridge'
import { CommentsColumn } from './CommentsColumn'
import type { Anchor, CommentItem, Thread } from './comments'
import { useThreads } from './useThreads'

/*
  A Leaf page's comments column in its states, the kit's one column (ONE-5, step 4): ConversationLayout with its
  threads under their comments, its "On deleted blocks" and "Resolved" groups, and Leaf's box at its foot, with what a
  new comment will be on in the kit's strip above it. Each comment is the kit's ConversationCard, and its thread the
  kit's Thread. Only the reads are handed in.
*/

const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const ADDRESS = `30842:${MIKY}:launch-plan`
const TEXT = descriptionTextToBlockDocument('# Launch plan\n\nWe ship the beta to the first ten teams on Monday.\n\nKaterina owns the press notes and the launch post.')
const [, FIRST, SECOND] = blockIds(TEXT)
const NOW = Date.now()

let serial = 0
/** One comment or reply as the column holds it, written `minutesAgo`. */
function said(by: string, body: string, minutesAgo: number, more: Partial<CommentItem> = {}): CommentItem {
  serial += 1
  const at = Math.floor((NOW - minutesAgo * 60_000) / 1000)
  const id = serial.toString(16).padStart(64, '0')
  return { id, by, at: at * 1000, body, edited: false, files: [], cards: [], reactions: [], event: { id, pubkey: by, created_at: at, kind: 1111, tags: [['h', FOLDER]], content: body, sig: '' }, ...more }
}

const onWords = said(KATERINA, 'Ten feels small. Can we say which teams?', 42)
const onWordsReply = said(MIKY, 'The ten from the pilot. I will list them under this.', 30)
onWords.reactions = [{ emoji: '👍', count: 1, by: [MIKY] }]
const onBlock = said(MIKY, 'Who reviews the post before it goes out?', 20, { edited: true, editedAt: NOW - 5 * 60_000 })
const onPage = said(KATERINA, 'Looks ready to me once the dates are in.', 12)
const resolvedOne = said(MIKY, 'Should Monday be Tuesday, for the time zones?', 90)
const deletedReply = said(KATERINA, 'Agreed, the first ten.', 60)

const THREADS: Thread[] = [
  { id: onWords.id, blocks: [FIRST], quote: { start: 'the first ten teams' }, root: onWords, replies: [onWordsReply], resolved: false },
  { id: onBlock.id, blocks: [SECOND], root: onBlock, replies: [], resolved: false },
  { id: onPage.id, root: onPage, replies: [said(MIKY, 'Dates are in now.', 8)], resolved: false },
  // Deleted, its reply stays on the place it copied.
  { id: 'd'.repeat(64), gone: 'deleted', blocks: [FIRST], root: null, replies: [deletedReply], resolved: false },
  // Not read, and nothing says it was deleted: it can't be shown, its reply stays on the place it copied.
  { id: 'e'.repeat(64), gone: 'missing', blocks: [SECOND], root: null, replies: [said(MIKY, 'Who else is reviewing?', 25)], resolved: false },
  { id: resolvedOne.id, blocks: [FIRST], root: resolvedOne, replies: [], resolved: true, resolution: { by: KATERINA, note: 'Monday stays: the teams are all in Europe.', at: NOW - 70 * 60_000 } },
]

/** The page's text and its comments column beside it, as a Leaf page lays them out. `drafting`: what a comment is begun on, as the selection's Comment does. */
function PageWithComments({ closed, drafting = null }: { closed?: string; drafting?: Anchor | null }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState<Anchor | null>(drafting)
  const docBody = useRef<HTMLDivElement | null>(null)
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel title="Launch plan" bodyRef={docBody} bodyClassName="px-12 pt-10 pb-24">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <LiveDocument
              value={serializeBlockDocument(TEXT)}
              format="blocks"
              changedBy={null}
              onCommit={async () => true}
              onLeftUnsaved={() => {}}
              onEditor={setEditor}
              onCommentOn={closed === undefined ? setDraft : undefined}
              readOnly={closed !== undefined}
            />
          </div>
        </Panel>
      </div>
      <Divider orientation="vertical" />
      <div className="flex flex-none flex-col">
        <CommentsColumn doc={{ address: ADDRESS, folder: FOLDER }} addressable editor={editor} docBody={docBody} draft={draft} onDraft={setDraft} closed={closed} />
      </div>
    </div>
  )
}

const meta = {
  title: 'Comments/Column',
  component: PageWithComments,
  parameters: { layout: 'fullscreen' },
  // The relay's answers, handed in: the page's threads, and the names on them. Miky is reading.
  beforeEach: () => {
    mocked(useThreads).mockReturnValue({ threads: THREADS, reactionsOmitted: 0, reactionsCut: false, failed: false, readAt: NOW, reread: () => {} })
    mocked(viewerPubkey).mockReturnValue(MIKY)
    mocked(query).mockImplementation(async (filters) => (filters.some((f) => Array.isArray(f.kinds) && f.kinds.includes(0)) ? PROFILES : []))
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
} satisfies Meta<typeof PageWithComments>

export default meta
type Story = StoryObj<typeof meta>

/** At rest: each comment on the kit's card, what it is on above its words, its thread folded behind its replies row; the kit's "On deleted blocks" and "Resolved" closed at the end. */
export const AtRest: Story = {}

/** A thread open under its comment, from its replies row: the kit's one card round the comment and its thread, its reply on the kit's ReplyCard, then Leaf's reply box. */
export const ThreadOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const thread = (await canvas.findByText('Ten feels small. Can we say which teams?')).closest<HTMLElement>('[data-conversation-item]')!
    await userEvent.click(within(thread).getByRole('button', { name: '1 reply, open the thread' }))
    await expect(await canvas.findByRole('textbox', { name: 'Reply…' })).toBeVisible()
  },
}

/** Its comment deleted: it says so, still on its place, and its reply stays under it, with no reply box. */
export const Deleted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const deleted = (await canvas.findByText('This comment was deleted.')).closest<HTMLElement>('[data-conversation-item]')!
    await userEvent.click(within(deleted).getByRole('button', { name: '1 reply, open the thread' }))
    await expect(await within(deleted).findByText('Agreed, the first ten.')).toBeVisible()
  },
}

/** Resolved, under "Resolved": "Resolved" by the time, and who resolved it with their note. */
export const Resolved: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Resolved/ }))
    await expect(await canvas.findByText('Monday stays: the teams are all in Europe.')).toBeVisible()
  },
}

/** An archived page: the box's place says why, and the cards only show. */
export const Archived: Story = { args: { closed: archivedLine({}) ?? '' } }

/** A comment begun on selected words: they are marked in the text, and the kit's strip above the box says them as the posted card will, with ✕ to comment on the whole document instead. */
export const DraftingOnWords: Story = {
  args: { drafting: { blocks: [SECOND], quote: { start: 'the press notes' } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: 'Comment on the whole document instead' })).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Comment on these words…' })).toBeVisible()
  },
}
