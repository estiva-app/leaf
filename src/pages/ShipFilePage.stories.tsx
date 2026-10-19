import { useRef, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, mocked, userEvent, within } from 'storybook/test'
import type { Editor } from '@tiptap/react'
import { IconExternalLink, IconFilePlus, IconHome } from '@tabler/icons-react'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import {
  AppShell,
  Button,
  Chip,
  Divider,
  FieldLine,
  KindIcon,
  LinkKey,
  LinkPickers,
  NavItem,
  NavTree,
  Panel,
  Sidebar,
  ToastProvider,
  type NavTreeGroup,
  type NavTreeNode,
  type StatusColour,
  type ThingKind,
} from '@estiva-app/ui'
import { InlineText } from '@estiva-app/ui/editor'
import { CommentsColumn } from '../comments/CommentsColumn'
import type { Anchor } from '../comments/comments'
import { useThreads } from '../comments/useThreads'
import { LiveDocument } from '../document/LiveDocument'
import { PageSummary } from '../document/PageSummary'
import type { ChangedBy } from '../document/useLiveDocument'
import { titleOf } from '../folders/tree'
import { query, viewerPubkey } from '../relay/bridge'
import { FilePage } from './FilePage'
import { HomePage } from './HomePage'
import { KATERINA, MIKY, NEWER_DESCRIPTION, PROFILES, shipIssue, shipProject, threadsOn } from './fixtures/shipFiles'

/*
  LTX's prototype, for Miky to judge before anything is built: a Ship issue and a Ship project opened in Leaf. The
  files are projected by interop through Ship's real manifest (`fixtures/shipFiles.ts`), and the row under the title
  is read from the projection's status slot and meta slots in the manifest's order, never from knowing 30850/30851.
  The title, summary, text and comments are Leaf's own parts, as a page draws them; only the reads are handed in.
*/

const COLOURS: readonly StatusColour[] = ['neutral', 'blue', 'green', 'muted']

/**
 * The owning app's row under a file's title: its status, then each of its manifest's meta slots in order (Ship: an
 * issue's key and assignee, a project's lead and key), drawn read-only with the link kit's parts, and "Open in <app>",
 * where those fields are changed (LTX).
 */
function OwnerRow({ file }: { file: ForeignObject }) {
  const status = file.slots.status
  const opener = file.openUrl && /^https?:\/\//i.test(file.openUrl) ? file.openUrl : undefined
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-3">
      {status?.value && (
        <LinkPickers readOnly status={{ value: status.value, options: [{ value: status.value, label: status.value, colour: COLOURS.find((c) => c === status.colour) }] }} />
      )}
      {file.meta.map((slot) =>
        slot.isPubkey ? (
          <LinkPickers
            key={slot.field ?? slot.label}
            readOnly
            ownerLabel={slot.label}
            owner={{ value: slot.value || undefined, options: slot.value ? [{ value: slot.value, label: file.people?.[slot.value]?.displayName ?? '—' }] : [] }}
          />
        ) : slot.value ? (
          <LinkKey key={slot.field ?? slot.label}>{slot.value}</LinkKey>
        ) : null,
      )}
      {opener && file.appName && (
        <Button variant="muted" size="small" className="ml-auto" leadingIcon={<IconExternalLink />} onClick={() => window.open(opener, '_blank', 'noopener')}>
          {`Open in ${file.appName}`}
        </Button>
      )}
    </div>
  )
}

/**
 * Another app's file opened in Leaf, as LTX proposes it: its title and summary written in place, its owner's row
 * under them, its text in Leaf's editor and its comments beside it — a page's layout (FilePage's DocumentView).
 * Archived, its title, summary and text are read-only and its comments stay open (SPEC §6.5).
 */
function SharedTextView({ file, value, changedBy = null, onCommit = async () => true }: { file: ForeignObject; value?: string; changedBy?: ChangedBy | null; onCommit?: (value: string) => Promise<boolean> }) {
  const body = file.slots[BODY_SLOT]
  const locked = !!file.archived
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState<Anchor | null>(null)
  const docBody = useRef<HTMLDivElement | null>(null)
  const addressable = !body?.value || body.format === 'blocks'
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel title={titleOf(file)} bodyRef={docBody} bodyClassName="px-12 pt-10 pb-24">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-h1 text-text-primary">
                <InlineText variant="title" className="text-h1" value={titleOf(file)} placeholder="Untitled" label="Title" readOnly={locked} onCommit={async () => true} />
              </h1>
              <PageSummary value={file.slots.subtitle?.value ?? ''} readOnly={locked} onCommit={async () => true} />
            </div>
            <OwnerRow file={file} />
            {locked && <FieldLine tone="helper">Archived. Unarchive it in {file.appName ?? 'its app'} to edit.</FieldLine>}
            <LiveDocument
              value={value ?? body?.value ?? ''}
              format={body?.format ?? 'blocks'}
              changedBy={changedBy}
              onCommit={onCommit}
              onLeftUnsaved={() => {}}
              onEditor={setEditor}
              onCommentOn={addressable ? setDraft : undefined}
              readOnly={locked}
            />
          </div>
        </Panel>
      </div>
      <Divider orientation="vertical" />
      <div className="flex w-96 flex-none flex-col">
        <CommentsColumn doc={{ address: file.address, folder: file.folder }} addressable={addressable} editor={editor} docBody={docBody} draft={draft} onDraft={setDraft} />
      </div>
    </div>
  )
}

/** Someone else saves while you are in the text: Katerina's save lands a moment after you start typing. */
function WhileYouWrite() {
  const file = shipIssue()
  const [value, setValue] = useState(file.slots[BODY_SLOT]?.value)
  const [changedBy, setChangedBy] = useState<ChangedBy | null>(null)
  const started = useRef(false)
  const arrive = () => {
    if (started.current) return
    started.current = true
    setTimeout(() => {
      setValue(NEWER_DESCRIPTION)
      setChangedBy({ pubkey: KATERINA, name: 'Katerina' })
    }, 1200)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDownCapture={arrive}>
      <SharedTextView file={file} value={value} changedBy={changedBy} />
    </div>
  )
}

const meta = {
  title: 'Pages/Ship file in Leaf',
  component: SharedTextView,
  parameters: { layout: 'fullscreen' },
  // The relay's answers, handed in: the file's comments, and the names on them.
  beforeEach: ({ args }) => {
    mocked(useThreads).mockReturnValue(threadsOn(args.file))
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
} satisfies Meta<typeof SharedTextView>

export default meta
type Story = StoryObj<typeof meta>

/** A Ship issue: Ship's row (status, key, assignee) under its title, its text in Leaf's editor, its comments beside it. */
export const Issue: Story = { args: { file: shipIssue() } }

/** A Ship project: status, lead and key, in the order Ship's manifest gives them. */
export const Project: Story = { args: { file: shipProject() } }

/** An issue nobody has written a description for: the text starts empty, as a new page does. */
export const EmptyText: Story = { args: { file: shipIssue({ description: false }) } }

/** While the file is read: the page's skeleton, as for a page. */
export const Loading: Story = { args: { file: shipIssue() }, render: () => <FilePage file={null} loading /> }

/** A file you cannot read, or that is gone: the two read alike. */
export const NoAccess: Story = { args: { file: shipIssue() }, render: () => <FilePage file={null} loading={false} /> }

/** Archived in Ship: title, summary and text read-only; the comments stay open. */
export const Archived: Story = { args: { file: shipIssue({ archived: true }) } }

/** A save refused when you leave the text — the relay said no, or the sign-in ended: your text stays, and the line says so. */
export const SaveRefused: Story = {
  args: { file: shipIssue(), onCommit: async () => false },
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
  render: () => <WhileYouWrite />,
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
      <SharedTextView {...args} />
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
const recent = (address: string, title: string, folder: string, byName: string, ago: number, summary?: string) => ({
  address,
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
