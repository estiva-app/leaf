import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, mocked, userEvent, within } from 'storybook/test'
import { IconFilePlus, IconHome } from '@tabler/icons-react'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import type { LiveClient } from '@estiva-app/platform'
import type { SignedEvent } from '@estiva-app/protocol'
import { AppShell, Chip, KindIcon, NavItem, NavTree, Sidebar, ToastProvider, type NavTreeGroup, type NavTreeNode, type ThingKind } from '@estiva-app/ui'
import { useThreads } from '../comments/useThreads'
import { readDocument } from '../document/save'
import { publish, query, viewerPubkey } from '../relay/bridge'
import { relayClient } from '../relay/client'
import { FilePage } from './FilePage'
import { HomePage } from './HomePage'
import { answer, factsOf } from './fixtures/relay'
import { KATERINA, MIKY, NEWER_DESCRIPTION, PROFILES, shipIssue, shipProject, threadsOn } from './fixtures/shipFiles'

/*
  LTX's prototype, for Miky to judge before anything is built: a Ship issue and a Ship project opened in Leaf. The
  files are projected by interop through Ship's real manifest (`fixtures/shipFiles.ts`), and the row under the title
  is read from the projection's status slot and meta slots in the manifest's order, never from knowing 30850/30851.
  Each is drawn by FilePage itself, as the app draws it (ONE-5, step 6), its bar and its column included; only the
  relay is handed in.
*/

type Hear = (folder: string, event?: SignedEvent) => void

/**
 * Katerina saves the file's text a moment after you start typing in it, as the relay hands the open page someone
 * else's save: on the tab's live connection, to what watches the file's Folder, and a read of the file then finds her
 * text. Only typing in this story's own canvas starts it. Gives back the connection and the read when it is left.
 */
function katerinaSavesWhileYouWrite(file: ForeignObject, canvas: HTMLElement): () => void {
  const watching = new Set<Hear>()
  let saved = false
  let timer: ReturnType<typeof setTimeout> | undefined
  mocked(relayClient).mockReturnValue({
    watchFolders: (_folders: string[], hear: Hear) => {
      watching.add(hear)
      return { stop: () => void watching.delete(hear) }
    },
  } as unknown as LiveClient)
  // Before her save, a read finds nothing new and the page keeps what it opened with.
  const newer: ForeignObject = { ...file, slots: { ...file.slots, [BODY_SLOT]: { ...file.slots[BODY_SLOT], value: NEWER_DESCRIPTION } } }
  mocked(readDocument).mockImplementation(async () => (saved ? newer : null))
  const typing = () => {
    canvas.removeEventListener('keydown', typing, true)
    timer = setTimeout(() => {
      saved = true
      const change: SignedEvent = {
        id: 'd'.repeat(64),
        sig: '',
        kind: 1851,
        pubkey: KATERINA,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['a', file.address ?? ''], ['field', 'description'], ['value', NEWER_DESCRIPTION], ['content-format', 'estiva-blocks-1'], ['h', file.folder ?? '']],
        content: '',
      }
      for (const hear of watching) hear(file.folder ?? '', change)
    }, 1200)
  }
  canvas.addEventListener('keydown', typing, true)
  return () => {
    canvas.removeEventListener('keydown', typing, true)
    clearTimeout(timer)
    mocked(relayClient).mockReset()
    mocked(readDocument).mockReset()
  }
}

const meta = {
  title: 'Pages/Ship file in Leaf',
  component: FilePage,
  parameters: { layout: 'fullscreen' },
  args: { loading: false },
  // The relay's answers, handed in: the file's comments, the names on them, and the page's own reads (who is in it
  // and its last edit, `fixtures/relay.ts`). A save is taken, as the relay takes one; Save Refused's is refused.
  beforeEach: ({ args }) => {
    const file = args.file
    if (file) mocked(useThreads).mockReturnValue(threadsOn(file))
    mocked(viewerPubkey).mockReturnValue(MIKY)
    mocked(query).mockImplementation(async (filters) =>
      filters.some((f) => Array.isArray(f.kinds) && f.kinds.includes(0)) ? PROFILES : file ? answer(factsOf(file), filters) : [],
    )
    mocked(publish).mockResolvedValue({ ok: true })
    return () => void mocked(publish).mockReset()
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

/**
 * A Ship issue: "Open" right after its name in the bar, and no ⋯, which is Ship's; its key above the title, Ship's row
 * under it (status, then assignee, the pickers its card has), its text in Leaf's editor, its comments beside it.
 */
export const Issue: Story = {
  args: { file: shipIssue() },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Edited 2 hours ago by Katerina')).toBeVisible()
  },
}

/** A Ship project: its key above the title, then status and lead, the pickers its card has; "Open" after the title in the bar. */
export const Project: Story = { args: { file: shipProject() } }

/**
 * An issue nobody has written a description for. Its projection has no text yet, so Leaf does not offer to write one
 * (`writableFields`): the page names it and offers "Open in Ship", as for a file whose app shares no text.
 */
export const EmptyText: Story = { args: { file: shipIssue({ description: false }) } }

/** While the file is read: the page's skeleton, as for a page. */
export const Loading: Story = { args: { file: shipIssue() }, render: () => <FilePage file={null} loading /> }

/** Archived in Ship: title, summary and text read-only; the comments only show, with the line every app shows in the box's place. */
export const Archived: Story = { args: { file: shipIssue({ archived: true }) } }

/** A save refused when you leave the text — the relay said no, or the sign-in ended: your text stays, and the line says so. */
export const SaveRefused: Story = {
  args: { file: shipIssue() },
  beforeEach: () => {
    mocked(publish).mockResolvedValue({ ok: false, reason: 'blocked: not this time' })
  },
  play: async ({ canvasElement }) => {
    const text = await within(canvasElement).findByRole('textbox', { name: 'Document' })
    await userEvent.click(text)
    await userEvent.keyboard(' One more line.')
    fireEvent.blur(text)
    await expect(await within(canvasElement).findByText('Could not save. Your text is still here.')).toBeVisible()
  },
}

/** Someone else saved while you were writing: theirs waits behind yours, with "Load it". */
export const NewerSave: Story = {
  args: { file: shipIssue() },
  beforeEach: ({ args, canvasElement }) => (args.file ? katerinaSavesWhileYouWrite(args.file, canvasElement) : undefined),
  play: async ({ canvasElement }) => {
    const text = await within(canvasElement).findByRole('textbox', { name: 'Document' })
    await userEvent.click(text)
    await userEvent.keyboard(' One more line.')
    await expect(await within(canvasElement).findByText('Katerina saved a newer version.', { exact: false }, { timeout: 4000 })).toBeVisible()
  },
}

// The tree and Home: Leaf's sidebar lists pages, projects and issues, and no topics.

const node = (id: string, label: string, kind: ThingKind | 'file', more: Partial<NavTreeNode> = {}): NavTreeNode => ({
  id,
  label,
  href: '#',
  icon: <KindIcon kind={kind} />,
  hint: kind === 'file' ? undefined : <Chip type="neutral" label={kind.charAt(0).toUpperCase() + kind.slice(1)} />,
  ...more,
})

const ISSUES = [
  node('i1', 'Prototype: a Ship issue and a Ship project opened in Leaf', 'issue'),
  node('i2', 'Sidebar should not show Peek topics', 'issue'),
  node('i3', 'A topic has no text, and Leaf writes other apps\' shared fields', 'issue'),
]

/** The tree LTX proposes: pages, and Ship's projects with their issues; no Peek topics. */
const PROPOSED: NavTreeGroup[] = [
  { id: 'hq', title: 'Estiva HQ', open: true, nodes: [node('ltx', 'Leaf edits any file\'s text', 'project', { hasChildren: true, open: true, children: ISSUES }), node('p1', 'Weekly notes', 'file')] },
  { id: 'leaf', title: 'Leaf', open: true, nodes: [node('p2', 'Launch plan', 'file'), node('p3', 'Type scale notes', 'file')] },
]

/** Today's tree, for comparison: topics among the pages, each saying only "Open in Peek". */
const TODAY: NavTreeGroup[] = [
  {
    id: 'hq',
    title: 'Estiva HQ',
    open: true,
    nodes: [node('t1', 'Standup', 'topic'), node('ltx', 'Leaf edits any file\'s text', 'project', { hasChildren: true }), node('t2', 'Estiva Suits Updates', 'topic'), node('p1', 'Weekly notes', 'file')],
  },
  { id: 'leaf', title: 'Leaf', open: true, nodes: [node('t3', 'Design review', 'topic'), node('p2', 'Launch plan', 'file'), node('p3', 'Type scale notes', 'file')] },
]

/** Leaf's frame, with Home and the tree in the sidebar, as `App` draws it. */
function Frame({ groups, home, selected, children }: { groups: NavTreeGroup[]; home?: boolean; selected?: string; children: ReactNode }) {
  return (
    <AppShell
      variant="inset"
      logo="Leaf"
      nav={
        <Sidebar>
          <NavItem href="#" label="Home" icon={<IconHome size={16} stroke={1.5} />} active={home} />
          <NavTree title="Folders" titleActions={[{ icon: <IconFilePlus size={16} stroke={1.5} />, tooltip: 'New document', onClick: () => {} }]} groups={groups} selected={selected} />
        </Sidebar>
      }
    >
      {children}
    </AppShell>
  )
}

/** The issue opened from the tree: the tree lists pages, projects and issues, and no topics. */
export const InTheTree: Story = {
  args: { file: shipIssue() },
  render: (args) => (
    <Frame groups={PROPOSED} selected="i2">
      <FilePage {...args} />
    </Frame>
  ),
}

/** Today's tree, for comparison: Peek topics fill it, and open to "Open in Peek". */
export const TreeToday: Story = {
  args: { file: shipIssue() },
  render: () => (
    <Frame groups={TODAY} selected="t1">
      <FilePage file={{ ...shipIssue(), kind: 30840, noun: 'topic', appName: 'Peek', openUrl: 'https://peek.estiva.app/', slots: { title: { value: 'Standup', isPubkey: false } } } as ForeignObject} loading={false} />
    </Frame>
  ),
}

const NOW = Date.UTC(2026, 9, 20, 8)
const TYPES: Record<string, string> = { '30850': 'Project', '30851': 'Issue' }
const recent = (address: string, title: string, folder: string, byName: string, ago: number, summary?: string) => ({
  address,
  kind: Number(address.split(':')[0]),
  type: TYPES[address.split(':')[0]],
  naddr: `naddr1${title.length}`,
  eventId: `e${title.length}`,
  folderId: folder.toLowerCase(),
  title,
  summary,
  folder,
  at: NOW - ago,
  by: MIKY,
  byName,
})

/** Home: the issue whose text you rewrote yesterday, beside your pages. */
export const Home: Story = {
  args: { file: shipIssue() },
  render: () => (
    <Frame groups={PROPOSED} home>
      <HomePage
        relay="http://localhost:3000"
        state="live"
        now={NOW}
        recent={[
          recent(`30842:${MIKY}:p1`, 'Weekly notes', 'Estiva HQ', 'Miky', 40 * 60_000),
          recent(`30851:${MIKY}:ltx-3`, 'Sidebar should not show Peek topics', 'Estiva HQ', 'Miky', 22 * 3_600_000, 'A Ship project or issue opens in Leaf with its row, and Leaf\'s tree stops listing Peek topics.'),
          recent(`30842:${MIKY}:p2`, 'Launch plan', 'Leaf', 'Katerina', 2 * 86_400_000, 'What ships on launch day, who does what, and the order we do it in.'),
          recent(`30850:${MIKY}:ltx`, 'Leaf edits any file\'s text', 'Estiva HQ', 'Miky', 3 * 86_400_000),
        ]}
      />
    </Frame>
  ),
}
