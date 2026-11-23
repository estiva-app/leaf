import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { archivedLine } from '@estiva-app/conversation'
import {
  Avatar,
  Button,
  CollapsibleSection,
  Divider,
  EmptyState,
  KindIcon,
  LinkPickers,
  ListTable,
  ListTableRow,
  NoAccessNotice,
  PageHeader,
  Panel,
  ProgressRing,
  SectionHeader,
  SkeletonList,
  Toolbar,
  ToolbarButton,
  WithTooltip,
  linkedFrom,
  thingKindOf,
  useToast,
  type LinkedProfile,
  type ListTableColumn,
} from '@estiva-app/ui'
import { IconExternalLink, IconMessage, IconMessageOff } from '@tabler/icons-react'
import { useEffect, useMemo, type ReactNode, type RefObject } from 'react'
import { CommentsColumn } from '../comments/CommentsColumn'
import { useSideColumn } from './sideColumn'
import { isDocument, rowOf, typeOf } from '../folders/tree'
import { replace } from '../route'
import { useTabTitle } from '../tabTitle'
import { isSiblingHost, topicPath } from '../topics/topicLinks'
import { useTopicPage, type TopicPageState } from '../topics/useTopicPage'
import { useDirectory } from '../comments/people'
import { TeamChip } from './TeamChip'
import { Members } from './Members'
import { heldTopics, loadTopics } from '../document/fileTopics'
import { viewerPubkey } from '../relay/bridge'
import { addToTopic, joinTopic, leaveTopic } from '../topics/joinTopic'
import { useTopicPlace } from '../topics/topicMembers'
import { useHeldTopics } from '../topics/topicReads'
import { useReportFailure } from '@/lib/failureReports'
import { listedInOf } from './DocumentMenu'

/**
 * A topic's page in Leaf (LTN-3), as the approved story draws it (estiva-ui `concept/cross-app-navigation`,
 * `LeafTopics.tsx`): its title with its team under it, its summary, what it
 * lists that Leaf opens, each opening in Leaf, and the archived ones behind a link. A space goes on to Peek (D4); a
 * topic the reader cannot read is the notice any file they cannot open gets. The address bar gets the topic's current
 * slug, whichever link brought the reader here.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-opens-in-the-app-you-are-in-when-it-has-a-page-made-for-that-kind.md
 */
export function TopicPage({
  d,
  folders,
  inTree,
  treeRead,
}: {
  d: string
  /** The teams as the tree read them, for the topic's team's name. */
  folders?: readonly FolderSummary[]
  /** The tree's copy of a file when it holds one: read once, not twice. */
  inTree: (address: string) => ForeignObject | null
  /** The tree is read, or could not be: what the topic lists is read then. */
  treeRead: boolean
}) {
  const { state, retry } = useTopicPage(d, inTree, treeRead)
  // The workspace's people, for each row's face and "who changed it last" (as the cards read them).
  const directory = useDirectory()
  // Shown or hidden as a document's comments are, remembered on this browser across both (LED-3).
  const { comments } = useSideColumn()
  const page = typeof state === 'object' ? state : null
  // A space goes on to Peek by itself only on a host beside Leaf's; anywhere else its page is drawn, with the link.
  const sendsOn = !!page?.space && !!page.peekUrl && isSiblingHost(page.peekUrl, window.location.hostname)

  const address = page?.address
  const title = page?.title
  const peekUrl = page?.peekUrl
  useEffect(() => {
    if (!address) return
    if (sendsOn && peekUrl) return void window.location.replace(peekUrl)
    const path = topicPath(address, title)
    if (window.location.pathname !== path) replace(`${path}${window.location.search}${window.location.hash}`)
  }, [address, title, peekUrl, sendsOn])
  useTabTitle(page && !sendsOn ? page.title : undefined)

  useReportFailure(state === 'failed' || page?.files === 'failed' ? 'not-loaded' : undefined)
  // The team whose list names it, by address or id; its `h` only when none does: a move leaves the `h` behind (SHI-64).
  const listedIn = page ? listedInOf(page, folders) : undefined
  const team = listedIn ? folders?.find((folder) => folder.id === listedIn)?.name : undefined

  /*
    Who is in it: the members pill in the bar and the Members dialog it opens, with Join or Leave for you and Add members,
    as Ship's initiative page has them (TOPI-8; Katerina, 23 November: "unify initiative page in Leaf and make it like
    Ship"). Its people are the initiative's place listing, read when the page opens and after each change; its record
    (your level, for Leave) is the one the topics read holds.
  */
  const { showToast } = useToast()
  const heldRead = useHeldTopics()
  const topic = page && typeof heldRead === 'object' ? heldRead.topics.find((candidate) => candidate.address === page.address) : undefined
  const { place, reload: reloadPlace } = useTopicPlace(topic && !sendsOn ? topic : undefined)
  const members = useMemo(() => (place ? new Map(place.listed.map((listed) => [listed.pubkey, listed])) : undefined), [place])
  const me = viewerPubkey()
  const nameOf = (pubkey: string) => directory[pubkey]?.displayName ?? 'Someone'
  const pill = page && topic && !sendsOn && (
    <Members
      key={page.address}
      members={members}
      me={me}
      directory={directory}
      // Nothing changes on an archived initiative; Peek brings it back.
      readOnly={page.archived}
      // Who made it: the key in its address.
      roles={[{ pubkey: page.address.split(':')[1] ?? '', role: 'Author' }]}
      onSetMine={async (member) => {
        if (member) {
          const joined = await joinTopic(topic)
          // As Explore initiatives' Join says it (Peek's words; lands at Important, a level chosen before stays).
          if (!joined.ok) {
            showToast({ label: `Nothing changed: “${page.title}” could not be joined. ${joined.reason}`, type: 'error' })
            return false
          }
          if (joined.stillMuted) showToast({ label: `Joined “${page.title}”, but it is still muted. Join again to unmute it.`, type: 'error' })
          else showToast({ label: `You joined ${page.title}. Notifications: ${joined.level === 'all' ? 'Everything' : 'Important'}.`, type: 'success' })
        } else {
          // Ship's Leave from its Members: Not following, said only when refused.
          const left = await leaveTopic(topic)
          if (!left.ok) {
            showToast({ label: `Nothing changed: “${page.title}” could not be left. ${left.reason}`, type: 'error' })
            return false
          }
        }
        await Promise.all([reloadPlace(), heldTopics.reload(loadTopics)])
        return true
      }}
      onAdd={async (pubkeys) => {
        for (const pubkey of pubkeys) {
          const added = await addToTopic(topic, pubkey, place?.events ?? [])
          if (!added.ok) {
            showToast({ label: `Nothing changed: ${nameOf(pubkey)} could not be added to “${page.title}”. ${added.reason}`, type: 'error' })
            await reloadPlace()
            return false
          }
        }
        await reloadPlace()
        return true
      }}
    />
  )
  // Drawn once the topic is known and stays here: a space goes on to Peek, and a topic that did not load has none.
  const conversation = page && !sendsOn && (
    <CommentsColumn
      key={page.address}
      doc={{ address: page.address, folder: page.folder }}
      addressable={false}
      editor={null}
      docBody={noBody}
      draft={null}
      onDraft={noDraft}
      // An archived topic's conversation only shows, with the line every app says in the box's place (Ship's too).
      closed={page.archived ? (archivedLine({}, undefined, { in: 'Peek', to: 'reply' }) ?? '') : undefined}
      hidden={!comments.open}
      topic
    />
  )
  return <TopicPageView state={state} sendsOn={sendsOn} team={team} directory={directory} members={pill || undefined} comments={comments} conversation={conversation} onRetry={retry} />
}

/**
 * The initiative's page as it draws, handed what it shows: the page above keeps the reads, the address bar and the tab's
 * title. `conversation` is the column beside it, shown or hidden by the header's button.
 */
export function TopicPageView({
  state,
  sendsOn = false,
  team,
  directory = {},
  members,
  comments,
  conversation,
  onRetry,
}: {
  state: TopicPageState
  /** A space on a host beside Peek's: the page goes on to Peek, a skeleton until it does. */
  sendsOn?: boolean
  /** Its team's name, as the tree read the teams. */
  team?: string
  /** The workspace's people by key: a row's face and who changed it last. */
  directory?: Record<string, LinkedProfile>
  /** Who is in it: the members pill (Leaf's `Members`), in the bar's members place, as on Ship's initiative page. */
  members?: ReactNode
  /** The column beside the page, open or not, remembered with a document's (LED-3). */
  comments: { open: boolean; onOpenChange: (open: boolean) => void }
  /** The initiative's conversation, drawn in that column. */
  conversation?: ReactNode
  onRetry: () => void
}) {
  const page = typeof state === 'object' ? state : null
  if (state === 'unavailable') return <NoAccessNotice what="initiative" />
  // The topic's conversation is in the column beside the page, as on Ship's topic page, in place of the link to Peek;
  // the header's button shows or hides it, as on a document.
  const toggle = (
    <Toolbar aria-label="Initiative actions" surface={false}>
      <ToolbarButton
        // Ship's words on a topic's page: a topic has a conversation, not comments.
        tooltip={comments.open ? 'Hide conversation' : 'Show conversation'}
        aria-label={comments.open ? 'Hide conversation' : 'Show conversation'}
        onClick={() => comments.onOpenChange(!comments.open)}
      >
        {comments.open ? <IconMessageOff size={16} stroke={1.5} /> : <IconMessage size={16} stroke={1.5} />}
      </ToolbarButton>
    </Toolbar>
  )
  const files = page?.files
  const column = conversation && (
    <div className={comments.open ? 'contents' : 'hidden'} hidden={!comments.open}>
      <Divider orientation="vertical" />
      {/* The kit's one column, 384px, the page's full height, as a document's and as Ship's topic page places it. */}
      <div className="flex flex-none flex-col" data-comments-column>
        {conversation}
      </div>
    </div>
  )
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel
          title={page?.title ?? 'Initiative'}
          header={
            <PageHeader
              title={page?.title ?? ''}
              leading={<KindIcon kind="topic" />}
              // Its team, the one chip after its name, as on Peek's initiative page (Katerina, 18 November, D4); none before
              // the name is known, so a page that did not load shows no chip with nothing before it (review, B2). Then Open
              // into Peek, as Ship's initiative page has it and as Leaf opens another app's file (18 November, D5; review, A4).
              after={
                page && !sendsOn && (team || page.peekUrl) ? (
                  <>
                    {team && <TeamChip name={team} />}
                    {page.peekUrl && (
                      <WithTooltip label="Open in Peek">
                        <Button href={page.peekUrl} external size="small" className="shrink-0" leadingIcon={<IconExternalLink size={14} stroke={1.5} />} aria-label="Open in Peek">
                          Open
                        </Button>
                      </WithTooltip>
                    )}
                  </>
                ) : undefined
              }
              members={page && !sendsOn ? members : undefined}
              actions={page && !sendsOn ? toggle : undefined}
            />
          }
          bodyClassName="px-6 py-5"
        >
          {/* The page's whole width, 24px in and 20px down, as Ship's and Peek's lists (Katerina, 23 November: "not compact, fix Leaf"). */}
          <div data-topic-page className="flex w-full flex-col gap-4">
            {state === 'failed' ? (
              // The initiative's ◎, as Ship's page that did not load (review, B2).
              <EmptyState icon={<KindIcon kind="topic" />} scope="page" message="This initiative didn’t load." action={{ label: 'Try again', onClick: onRetry }} />
            ) : !page || sendsOn ? (
              <SkeletonList rows={6} />
            ) : (
              <>
                {/* Its name is said once, in the bar (Katerina, 18 November, brainstorm 1.A); an archived one still says so first. */}
                {page.archived && <span className="text-caption text-text-muted">Archived</span>}
                {page.summary && <p className="text-body-2 text-text-secondary">{page.summary}</p>}
                {files === 'loading' || files === undefined ? (
                  <SkeletonList rows={3} />
                ) : files === 'failed' ? (
                  <EmptyState scope="section" message="What it lists didn’t load." action={{ label: 'Try again', onClick: onRetry }} />
                ) : (
                  <Listed files={files} directory={directory} />
                )}
              </>
            )}
          </div>
        </Panel>
      </div>
      {column}
    </div>
  )
}

/** A topic has no text: nothing for a comment to point at, nor to scroll to. */
const noBody: RefObject<HTMLDivElement | null> = { current: null }
const noDraft = () => {}

type Kind = 'page' | 'project' | 'issue' | 'file'

/**
 * The kinds in the page's order, each under its own heading. Leaf's own files are "Documents", as Ship's initiative page
 * and Leaf's own New document say them (review of 23 November, B1); a document's pages stay pages. "Files": another
 * app's, its type on its line.
 */
const KINDS: { kind: Kind; title: string }[] = [
  { kind: 'page', title: 'Documents' },
  { kind: 'project', title: 'Projects' },
  { kind: 'issue', title: 'Issues' },
  { kind: 'file', title: 'Files' },
]

/** Which heading a file is under: a page of Leaf's, a project, an issue, or another app's file. */
function kindOf(file: ForeignObject): Kind {
  if (isDocument(file)) return 'page'
  const thing = thingKindOf(file.kind)
  return thing === 'project' || thing === 'issue' ? thing : 'file'
}

/**
 * The four columns Ship's initiative page lists every file in (Ship's `WorkList`), the same widths, so a row's facts sit
 * where Ship's do (Katerina, 23 November: "unify initiative page in Leaf and make it like Ship"): its status, its person
 * (a project's lead, an issue's assignee, a page's last editor), its progress, and who changed it last and when. Who and
 * when give way first in a narrow window.
 */
const COLUMNS: ListTableColumn[] = [
  { label: 'Status', width: 'medium' },
  { label: 'People', width: 'large', keep: 'low' },
  { label: 'Progress', width: 'small' },
  { label: 'When', width: 'medium', keep: 'low' },
]

/** Nothing: a fact this file does not have. The kit's row draws its dash only for an absent cell ("not read yet"). */
const NONE = ''

/**
 * **What an initiative lists, by kind** (Katerina, 18 November, brainstorm 1.A; 23 November: "make it like row and not
 * card"): one part per kind, under the kit's heading with its count, every file a row in Ship's four columns, the
 * initiative's own order kept inside each, as the record asks of an app that groups its files ("an app that groups
 * them, by kind say, keeps it inside each group"). The look a file was given on the initiative is a hint the record
 * leaves to the reading app ("the reading app decides how it looks"): Leaf lists them as its own rows, as Ship does.
 * The archived ones are one fold at the end, open when nothing else is listed, each kind its own list inside it.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/each-file-on-a-topic-keeps-its-own-place-and-look.md
 */
function Listed({ files, directory }: { files: { live: ForeignObject[]; archived: ForeignObject[] }; directory: Record<string, LinkedProfile> }) {
  return (
    // 24px between its parts, as Peek's team page and Explore (Katerina, 16 November).
    <div className="flex flex-col gap-6">
      {/* Peek's own line when it lists nothing (peek `TopicFiles`); Ship's says the same (review of 23 November, B2). */}
      {files.live.length === 0 && <EmptyState scope="section" message={files.archived.length > 0 ? 'Everything it lists is archived.' : 'None yet. An initiative can be only a conversation.'} />}
      {KINDS.map(({ kind, title }) => {
        const ofKind = files.live.filter((file) => kindOf(file) === kind)
        if (ofKind.length === 0) return null
        return (
          <section key={kind} className="flex flex-col gap-1" data-topic-kind={kind}>
            <SectionHeader title={title} count={ofKind.length} hover="none" />
            <FileRows files={ofKind} label={title} directory={directory} />
          </section>
        )
      })}
      {files.archived.length > 0 && (
        <CollapsibleSection title="Archived" count={files.archived.length} defaultOpen={files.live.length === 0} contentClassName="flex flex-col gap-2">
          {KINDS.map(({ kind, title }) => {
            const ofKind = files.archived.filter((file) => kindOf(file) === kind)
            return ofKind.length > 0 ? <FileRows key={kind} files={ofKind} label={`Archived ${title.toLowerCase()}`} directory={directory} /> : null
          })}
        </CollapsibleSection>
      )}
    </div>
  )
}

/** The first word of a name: "Ana" of "Ana Duarte", as Ship's rows say who changed a file ("Ana, 1h ago"). */
const firstName = (name: string) => name.split(' ')[0] ?? name

/**
 * Files of one kind in their order, each a row of the kit's list in Ship's four columns. Each row's facts are the ones
 * the kit's card reads from the file (`linkedFrom`): its status in words, its owner's face (a lead, an assignee; a page,
 * who changed it last), its progress as the kit's small ring, and When as Ship words it, who changed it last and when
 * ("Ana, 1h ago"). Another app's file says its type on the line under its name, which nothing else here says; an issue
 * says what it is in, as Ship's rows name an issue's project.
 */
function FileRows({ files, label, directory }: { files: readonly ForeignObject[]; label: string; directory: Record<string, LinkedProfile> }) {
  return (
    <ListTable aria-label={label} columns={COLUMNS} headings={false}>
      {files.map((file) => {
        const row = rowOf(file)
        const kind = kindOf(file)
        const linked = linkedFrom(file, { hrefOf: () => row.href, previewText: () => '', directory })
        const status = linked.status?.options.find((option) => option.value === linked.status?.value)
        const owner = linked.owner?.options.find((option) => option.value === linked.owner?.value)
        // Who changed it last, as the directory names them; a key the directory does not name says only when.
        const editor = file.changedBy ? directory[file.changedBy] : undefined
        const editorName = editor?.displayName
        // A page's person is who changed it last; a project's or an issue's, its owner.
        const person = owner ? { name: owner.label, picture: owner.picture, bot: owner.bot } : kind === 'page' && editorName ? { name: editorName, picture: editor?.picture, bot: editor?.bot } : undefined
        const when = linked.updated ? (editorName ? `${firstName(editorName)}, ${linked.updated}` : linked.updated) : NONE
        const line = kind === 'file' ? typeOf(file) : kind === 'issue' ? linked.subtitle : undefined
        return (
          <ListTableRow
            key={row.id}
            data-topic-file={file.address}
            href={row.href}
            label={row.label}
            {...(line ? { description: line } : {})}
            icon={<KindIcon kind={isDocument(file) ? 'file' : thingKindOf(file.kind)} />}
            cells={[
              status && linked.status ? <LinkPickers status={linked.status} readOnly /> : NONE,
              person ? <Avatar name={person.name} src={person.picture} bot={person.bot} size={16} label={person.name} /> : NONE,
              linked.done ? <ProgressRing done={linked.done.done} total={linked.done.total} /> : NONE,
              when,
            ]}
          />
        )
      })}
    </ListTable>
  )
}
