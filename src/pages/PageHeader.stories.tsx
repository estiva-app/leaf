import { useRef, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { mocked } from 'storybook/test'
import type { Editor } from '@tiptap/react'
import { IconDots, IconFilePlus, IconHome, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconMessage, IconMessageOff } from '@tabler/icons-react'
import {
  AppShell,
  Button,
  ConfirmDialog,
  DialogShell,
  Divider,
  EmptyState,
  Field,
  FieldLine,
  Form,
  IconButton,
  KindIcon,
  MembersDialog,
  MembersPill,
  Menu,
  MenuItem,
  MenuSeparator,
  NavItem,
  NavTree,
  Panel,
  Select,
  Sidebar,
  Textarea,
  ToastProvider,
  Toolbar,
  ToolbarButton,
  useToast,
  type MembersDialogMember,
  type NavTreeGroup,
  type NavTreeNode,
} from '@estiva-app/ui'
import { InlineText } from '@estiva-app/ui/editor'
import { BODY_SLOT } from '@estiva-app/interop'
import { CommentsColumn } from '../comments/CommentsColumn'
import type { Anchor } from '../comments/comments'
import { useThreads } from '../comments/useThreads'
import { LiveDocument } from '../document/LiveDocument'
import { PageSummary } from '../document/PageSummary'
import { query, viewerPubkey } from '../relay/bridge'
import { OwnerRow } from './OwnerRow'
import { KATERINA, MIKY, PROFILES, shipIssue, threadsOn } from './fixtures/shipFiles'

/*
  LED-1's prototype, for Miky and then Katerina to judge before any of it is built: Leaf's page header with the
  comments toggle, the sidebar fold, the document's menu (Copy link, Move, Archive/Unarchive, Delete) and its dialogs,
  the members pill with Add, and "Edited <when> by <whom>". Everything here is drawn from fixtures and nothing writes:
  the four build issues wire it. The menu is Peek's `TopicMoreMenu` items, the Move dialog Peek's `MoveDialog`, the
  Archive words Ship's and Peek's `ArchiveDialog`; the delete dialog follows SPEC §6.5 and never says the text is erased.

  Decided (LED-1, Miky, 27 Oct): every file Leaf opens gets this header, a Ship issue included; deleting a page moves
  the pages under it up one level, under its parent page or into its Folder, and the dialog says how many and where.
  Where the controls sit is a proposal for Katerina: the fold is the top bar's menu button (AppShell's `menu`, "in an
  app whose navigation collapses"), the comments toggle and the menu sit top right, as Peek's header buttons.
*/

type Archived = 'no' | 'self' | 'above'

interface Person {
  id: string
  name: string
}

const ME: Person = { id: MIKY, name: 'Miky' }
const KAT: Person = { id: KATERINA, name: 'Katerina' }
const JAN: Person = { id: 'd'.repeat(64), name: 'Jana' }

/** What one story opens on: the page, who wrote it, and the state of the frame. */
interface HeaderProps {
  /** A Leaf page, or a Ship issue opened in Leaf (the same header, Miky 27 Oct). */
  file?: 'page' | 'ship'
  /** Whether you wrote it: the relay refuses anyone else's Delete. */
  own?: boolean
  archived?: Archived
  members?: Person[]
  /** The newest change to the title, summary or text; null for a page never changed since it was made. */
  edited?: { by: Person; ago: string } | null
  /** How many pages are filed under this one. */
  under?: number
  /** A window too narrow for both columns. */
  narrow?: boolean
  commentsOpen?: boolean
  sidebarOpen?: boolean
  dialog?: 'move' | 'archive' | 'delete' | 'members' | null
}

const TITLE = 'Notes on the editor'
const SUMMARY = 'What Katerina and I noticed writing in Leaf this week.'
const TEXT = [
  'Writing with both panels folded away is the way I want to read a long page.',
  '',
  '- Pasting a picture should just work.',
  '- The "/" menu mid-line now does what it says.',
  '',
  'Next: the document menu, so a page can be moved, archived or deleted from where I read it.',
].join('\n')

// The tree: "Notes on the editor" sits under "Leaf feedback", with pages of its own under it.
const node = (id: string, label: string, more: Partial<NavTreeNode> = {}): NavTreeNode => ({ id, label, href: '#', icon: <KindIcon kind="file" />, ...more })
const SUBPAGES = ['Pictures', 'Slash menu', 'Arrows in the tree']

function treeOf({ under, gone, archived }: { under: number; gone: boolean; archived: boolean }): NavTreeGroup[] {
  const sub = SUBPAGES.slice(0, under).map((label, i) => node(`s${i}`, label))
  // After a delete its pages move up one level, under "Leaf feedback"; an archived page leaves the tree with them.
  const here = gone || archived ? [] : [node('notes', TITLE, { hasChildren: sub.length > 0, open: true, children: sub })]
  const parentChildren = gone ? sub : here
  return [
    { id: 'leaf', title: 'Leaf', open: true, nodes: [node('fb', 'Leaf feedback', { hasChildren: parentChildren.length > 0, open: true, children: parentChildren }), node('launch', 'Launch plan')] },
    { id: 'hq', title: 'Estiva HQ', open: true, nodes: [node('weekly', 'Weekly notes')] },
  ]
}

/** The header's prototype in Leaf's frame: the page, its header, its comments, and the menu's dialogs. */
function PageHeaderPrototype({
  file = 'page',
  own = true,
  archived: initialArchived = 'no',
  members: initialMembers = [ME, KAT],
  edited = { by: KAT, ago: '2 hours ago' },
  under = 3,
  narrow = false,
  commentsOpen = !narrow,
  sidebarOpen = !narrow,
  dialog: initialDialog = null,
}: HeaderProps) {
  const { showToast } = useToast()
  const [archived, setArchived] = useState<Archived>(initialArchived)
  const [members, setMembers] = useState(initialMembers)
  const [comments, setComments] = useState(commentsOpen)
  const [sidebar, setSidebar] = useState(sidebarOpen)
  const [dialog, setDialog] = useState(initialDialog)
  const [gone, setGone] = useState(false)
  const ship = file === 'ship'
  const issue = shipIssue({ archived: archived !== 'no' })
  const title = ship ? 'Sidebar should not show Peek topics' : TITLE
  const what = ship ? 'issue' : 'page'
  const locked = archived !== 'no'

  const fold = (
    <IconButton tooltip={sidebar ? 'Hide the sidebar' : 'Show the sidebar'} aria-label={sidebar ? 'Hide the sidebar' : 'Show the sidebar'} onClick={() => setSidebar(!sidebar)}>
      {sidebar ? <IconLayoutSidebarLeftCollapse size={16} stroke={1.5} /> : <IconLayoutSidebarLeftExpand size={16} stroke={1.5} />}
    </IconButton>
  )
  const nav = sidebar ? (
    <Sidebar>
      <NavItem href="#" label="Home" icon={<IconHome size={16} stroke={1.5} />} active={gone} />
      <NavTree title="Folders" titleActions={[{ icon: <IconFilePlus size={16} stroke={1.5} />, tooltip: 'New document', onClick: () => {} }]} groups={treeOf({ under, gone, archived: archived === 'self' })} selected={gone || ship ? undefined : 'notes'} />
    </Sidebar>
  ) : (
    // Folded: only the inset card's left margin is left, as its right one.
    <div className="w-4 flex-none" />
  )

  const lastEdit = edited ? `Edited ${edited.ago} by ${edited.by.id === ME.id ? 'you' : edited.by.name}` : 'Not edited since it was made'

  const menu = (
    <Menu trigger={<ToolbarButton tooltip="More" aria-label="More"><IconDots size={16} stroke={1.5} /></ToolbarButton>} align="right">
      {/* Narrow: the last edit leaves the bar and heads the menu. */}
      {narrow && <MenuItem label={lastEdit} disabled />}
      {narrow && <MenuSeparator />}
      {/* Moving an archived page is offered only out of an archived parent (SPEC §6.5). */}
      {archived !== 'self' && <MenuItem label="Move…" onClick={() => setDialog('move')} />}
      <MenuItem label="Copy link" onClick={() => showToast({ label: 'Link copied', type: 'success' })} />
      {archived !== 'above' && (
        <MenuItem
          label={archived === 'self' ? 'Unarchive' : 'Archive…'}
          onClick={() => {
            if (archived === 'self') {
              setArchived('no')
              showToast({ label: `${ship ? 'Issue' : 'Page'} unarchived`, type: 'success' })
            } else setDialog('archive')
          }}
        />
      )}
      <MenuItem label="Delete" destructive onClick={() => setDialog('delete')} />
    </Menu>
  )

  const actions = (
    <>
      {/* The last edit and the members pill are one group, 12px clear of the buttons, as Peek's header (Katerina, 8 Oct). */}
      <div className="flex items-center gap-3 pr-2">
        {!narrow && <span className="whitespace-nowrap text-body-2 text-text-secondary">{lastEdit}</span>}
        <MembersPill members={members.map(({ name }) => ({ name }))} count={members.length} onClick={() => setDialog('members')} />
      </div>
      <Toolbar aria-label="Page actions" surface={false}>
        <ToolbarButton tooltip={comments ? 'Hide comments' : 'Show comments'} aria-label={comments ? 'Hide comments' : 'Show comments'} onClick={() => setComments(!comments)}>
          {comments ? <IconMessageOff size={16} stroke={1.5} /> : <IconMessage size={16} stroke={1.5} />}
        </ToolbarButton>
        {menu}
      </Toolbar>
    </>
  )

  const page = gone ? (
    <EmptyState scope="page" message={`“${title}” was deleted. ${under ? `Its ${under} pages are now under Leaf feedback.` : ''}`} />
  ) : (
    <PageBody title={title} ship={ship} issue={issue} locked={locked} archived={archived} comments={comments} actions={actions} />
  )

  return (
    <div className={narrow ? 'flex h-screen w-full max-w-3xl flex-col' : 'flex h-screen flex-col'}>
      <AppShell variant="inset" logo="Leaf" menu={fold} nav={nav}>
        {page}
      </AppShell>
      {dialog === 'move' && <MoveDialogPrototype title={title} under={under} onClose={() => setDialog(null)} onMoved={(to) => showToast({ label: `Moved to ${to}`, type: 'success' })} />}
      {dialog === 'archive' && (
        <ArchiveDialogPrototype
          title={title}
          what={what}
          hides={under ? `${under} pages under it` : ''}
          onClose={() => setDialog(null)}
          onArchive={() => {
            setArchived('self')
            showToast({ label: `${ship ? 'Issue' : 'Page'} archived`, type: 'success', actionLabel: 'Undo', onAction: () => setArchived('no') })
          }}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={`Delete “${title}”?`}
          confirmLabel={`Delete ${what}`}
          destructive
          onClose={() => setDialog(null)}
          onConfirm={() => {
            if (!own) {
              // Ship's words for a refused delete (IssuePage); the relay takes a delete only from whoever wrote it.
              showToast({ label: 'Delete rejected — only the person who wrote it can delete it.', type: 'error' })
              return false
            }
            setGone(true)
            showToast({ label: `${ship ? 'Issue' : 'Page'} deleted`, type: 'success' })
            return true
          }}
        >
          <p>It leaves every list, in Leaf, Peek and Ship. Copies someone already has are not erased.</p>
          {under > 0 && <p>{`The ${under} pages under it move up into Leaf feedback.`}</p>}
          {archived === 'no' && <p className="text-text-secondary">Archiving is reversible and usually what you want.</p>}
        </ConfirmDialog>
      )}
      {dialog === 'members' && (
        <MembersDialog
          members={members.map(({ id, name }): MembersDialogMember => ({ id, name: id === ME.id ? 'You' : name }))}
          count={members.length}
          candidates={[ME, KAT, JAN].filter((p) => !members.some((m) => m.id === p.id)).map(({ id, name }) => ({ id, label: name }))}
          onAdd={locked ? undefined : (chosen) => setMembers([...members, ...chosen.map((c) => ({ id: c.id, name: c.label }))])}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/** The page under the header: title, summary, an owner's row for a Ship file, the text, and the comments beside it. */
function PageBody({ title, ship, issue, locked, archived, comments, actions }: { title: string; ship: boolean; issue: ReturnType<typeof shipIssue>; locked: boolean; archived: Archived; comments: boolean; actions: ReactNode }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState<Anchor | null>(null)
  const docBody = useRef<HTMLDivElement | null>(null)
  const archivedLine = archived === 'above' ? 'Archived with “Leaf feedback”. Unarchive the page to edit.' : 'Archived. Unarchive it to edit.'
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel title={title} actions={actions} bodyRef={docBody} bodyClassName="px-12 pt-10 pb-24">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-h1 text-text-primary">
                <InlineText variant="title" className="text-h1" value={title} placeholder="Untitled" label="Title" readOnly={locked} onCommit={async () => true} />
              </h1>
              <PageSummary value={ship ? (issue.slots.subtitle?.value ?? '') : SUMMARY} readOnly={locked} onCommit={async () => true} />
            </div>
            {ship && <OwnerRow file={issue} />}
            {locked && <FieldLine tone="helper">{archivedLine}</FieldLine>}
            <LiveDocument value={ship ? (issue.slots[BODY_SLOT]?.value ?? '') : TEXT} format={ship ? (issue.slots[BODY_SLOT]?.format ?? 'blocks') : 'marker'} changedBy={null} onCommit={async () => true} onLeftUnsaved={() => {}} onEditor={setEditor} onCommentOn={setDraft} readOnly={locked} />
          </div>
        </Panel>
      </div>
      {comments && (
        <>
          <Divider orientation="vertical" />
          <div className="flex w-96 flex-none flex-col">
            <CommentsColumn doc={{ address: issue.address, folder: issue.folder }} addressable editor={editor} docBody={docBody} draft={draft} onDraft={setDraft} />
          </div>
        </>
      )}
    </div>
  )
}

const FOLDERS = [
  { value: 'leaf', label: 'Leaf' },
  { value: 'hq', label: 'Estiva HQ' },
]
const UNDER: Record<string, { value: string; label: string }[]> = {
  leaf: [
    { value: '', label: 'The top of Leaf' },
    { value: 'fb', label: 'Leaf feedback' },
    { value: 'launch', label: 'Launch plan' },
  ],
  hq: [
    { value: '', label: 'The top of Estiva HQ' },
    { value: 'weekly', label: 'Weekly notes' },
  ],
}

/** Peek's Move dialog, as Leaf would open it: the Folder first, then what it goes under there. */
function MoveDialogPrototype({ title, under, onClose, onMoved }: { title: string; under: number; onClose: () => void; onMoved: (to: string) => void }) {
  const [folder, setFolder] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const move = () => {
    const to = UNDER[folder]?.find((t) => t.value === parent)?.label.replace('The top of ', '') ?? ''
    onMoved(to)
    onClose()
  }
  return (
    <DialogShell
      title="Move"
      onClose={onClose}
      footer={
        <>
          <Button variant="muted" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="move-form" disabled={!folder || parent === null}>
            Move
          </Button>
        </>
      }
    >
      <Form id="move-form" onSubmit={move}>
        <div className="flex flex-col gap-2">
          <p className="text-body-2-strong text-text-primary">{title}</p>
          <p className="text-body-2 text-text-secondary">
            Everyone who can read it now still can.{under > 0 ? ` The ${under} pages under it move with it.` : ''}
          </p>
        </div>
        <Field label="Folder">
          <Select value={folder} onChange={(v) => { setFolder(v); setParent(null) }} options={FOLDERS} placeholder="Pick a folder" ariaLabel="Folder" />
        </Field>
        {folder && (
          <Field label="Put it under">
            <Select value={parent ?? ''} onChange={setParent} options={UNDER[folder]} placeholder="Pick where it goes" ariaLabel="Put it under" />
          </Field>
        )}
      </Form>
    </DialogShell>
  )
}

/** Ship's and Peek's Archive dialog, in Leaf's words: what it hides, counted, and an optional resolution. */
function ArchiveDialogPrototype({ title, what, hides, onClose, onArchive }: { title: string; what: string; hides: string; onClose: () => void; onArchive: () => void }) {
  const [resolution, setResolution] = useState('')
  const archive = () => {
    onArchive()
    onClose()
  }
  return (
    <DialogShell
      title={`Archive “${title}”?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="muted" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="archive-form">
            {`Archive ${what}`}
          </Button>
        </>
      }
    >
      <Form id="archive-form" onSubmit={archive}>
        <div className="flex flex-col gap-2 text-body-2 text-text-primary">
          <p>{hides ? `This hides the ${what} and ${hides} from every list, in Leaf, Peek and Ship.` : `This hides the ${what} from every list, in Leaf, Peek and Ship.`}</p>
          <p className="text-text-secondary">Nothing is deleted: a link still opens it, and Unarchive brings everything back as it was.</p>
        </div>
        <Field label="Resolution (optional)">
          <Textarea value={resolution} rows={3} placeholder={`What happened with this ${what}? Shown first to anyone who opens it.`} onChange={(event) => setResolution(event.target.value)} />
        </Field>
      </Form>
    </DialogShell>
  )
}

const meta = {
  title: 'Prototypes/Page header (LED-1)',
  component: PageHeaderPrototype,
  parameters: { layout: 'fullscreen' },
  // The relay's answers, handed in: the page's comments and the names on them.
  beforeEach: ({ args }) => {
    const issue = shipIssue()
    mocked(useThreads).mockReturnValue(threadsOn(args.file === 'ship' ? issue : { ...issue, slots: { ...issue.slots, title: { value: TITLE, isPubkey: false } } }))
    mocked(viewerPubkey).mockReturnValue(MIKY)
    mocked(query).mockImplementation(async (filters) => (filters.some((f) => Array.isArray(f.kinds) && f.kinds.includes(0)) ? PROFILES : []))
  },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof PageHeaderPrototype>

export default meta
type Story = StoryObj<typeof meta>

/** Your page: last edit, members, the comments toggle and the menu, top right; the sidebar fold, top left. */
export const YourPage: Story = { args: {} }

/** Focus: both the comments and the sidebar folded away; each button brings its column back. */
export const Focus: Story = { args: { commentsOpen: false, sidebarOpen: false } }

/** A page Katerina wrote: the same header and menu; her page's Delete is refused (try it). */
export const SomeoneElsesPage: Story = { args: { own: false, edited: { by: KAT, ago: 'yesterday' } } }

/** Edited last by you, and the pill with three members. */
export const EditedByYou: Story = { args: { edited: { by: ME, ago: '5 minutes ago' }, members: [ME, KAT, JAN] } }

/** A page nobody has changed since it was made, and nobody added yet but you. */
export const NewPage: Story = { args: { edited: null, members: [ME], under: 0 } }

/** No members yet: a page read before anyone joined it. */
export const NoMembers: Story = { args: { members: [] } }

/**
 * Archived by itself: read-only, out of the tree; the menu offers Copy link, Unarchive and Delete, no Move. The comment
 * box still shows: closing it on an archived file is PEEKM-8's, in the shared comments column, not this header's.
 */
export const Archived: Story = { args: { archived: 'self' } }

/** Archived with "Leaf feedback" above it: the line names that page; Move out of it and Delete stay, Unarchive is on "Leaf feedback". */
export const ArchivedAbove: Story = { args: { archived: 'above' } }

/** The Archive dialog, counting the pages it hides. Archive, and the page stays open read-only, with Undo in the toast. */
export const ArchiveDialog: Story = { args: { dialog: 'archive' } }

/** The Delete dialog with three pages under it: they move up into "Leaf feedback". Delete, and you land on what is left. */
export const DeleteDialog: Story = { args: { dialog: 'delete' } }

/** The Delete dialog for a page with nothing under it. */
export const DeleteDialogNothingUnder: Story = { args: { dialog: 'delete', under: 0 } }

/** Delete on a page someone else wrote: the relay refuses it, and the toast says so in Ship's words. */
export const DeleteRefused: Story = { args: { dialog: 'delete', own: false } }

/** The Move dialog: Folder, then where it goes; who can read it is unchanged and the pages under it move too. */
export const MoveDialog: Story = { args: { dialog: 'move' } }

/** The members dialog from the pill, with Add. */
export const Members: Story = { args: { dialog: 'members' } }

/** A Ship issue opened in Leaf: the same header and menu (Miky, 27 Oct), Ship's row under its title. */
export const ShipIssue: Story = { args: { file: 'ship', edited: { by: ME, ago: '1 day ago' } } }

/** A narrow window: both columns start folded, and the last edit moves into the menu. */
export const Narrow: Story = { args: { narrow: true } }
