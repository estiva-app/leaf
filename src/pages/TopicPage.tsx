import type { FileLook, FolderSummary, ForeignObject } from '@estiva-app/interop'
import { archivedLine } from '@estiva-app/conversation'
import { Button, Card, Divider, EmptyState, KindIcon, NoAccessNotice, PageHeader, Panel, SectionLabel, SkeletonList, Toolbar, ToolbarButton } from '@estiva-app/ui'
import { IconArchive, IconMessage, IconMessageOff } from '@tabler/icons-react'
import { useEffect, useState, type RefObject } from 'react'
import { CommentsColumn } from '../comments/CommentsColumn'
import { useSideColumn } from './sideColumn'
import { rowOf } from '../folders/tree'
import { replace } from '../route'
import { useTabTitle } from '../tabTitle'
import { isSiblingHost, topicPath } from '../topics/topicLinks'
import { lookOf, useTopicPage } from '../topics/useTopicPage'
import { CommentCard } from '../comments/CommentCard'
import { CardActsProvider } from '../document/linked'
import { ReferencesProvider } from '../document/references'

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
  const [showArchived, setShowArchived] = useState(false)
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

  if (state === 'unavailable') return <NoAccessNotice what="topic" />
  // The topic's conversation is in the column beside the page, as on Ship's topic page, in place of the link to Peek;
  // the header's button shows or hides it, as on a document.
  const toggle = (
    <Toolbar aria-label="Topic actions" surface={false}>
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
  const team = page ? folders?.find((folder) => folder.id === page.folder)?.name : undefined
  const files = page?.files
  // Drawn once the topic is known and stays here: a space goes on to Peek, and a topic that did not load has none.
  const conversation = page && !sendsOn && (
    <div className={comments.open ? 'contents' : 'hidden'} hidden={!comments.open}>
      <Divider orientation="vertical" />
      {/* The kit's one column, 384px, the page's full height, as a document's and as Ship's topic page places it. */}
      <div className="flex flex-none flex-col" data-comments-column>
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
      </div>
    </div>
  )
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel
          title={page?.title ?? 'Topic'}
          header={<PageHeader title={page?.title ?? ''} leading={<KindIcon kind="topic" />} actions={page && !sendsOn ? toggle : undefined} />}
          bodyClassName="px-12 pt-10 pb-24"
        >
          <div data-topic-page className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {state === 'failed' ? (
              <EmptyState scope="page" message="This topic didn’t load." action={{ label: 'Try again', onClick: retry }} />
            ) : !page || sendsOn ? (
              <SkeletonList rows={6} />
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <h1 className="text-h1 text-text-primary">{page.title}</h1>
                  {(team || page.archived) && <span className="text-caption text-text-muted">{[team, page.archived ? 'Archived' : undefined].filter(Boolean).join(' · ')}</span>}
                </div>
                {page.summary && <p className="text-body-2 text-text-secondary">{page.summary}</p>}
                {files === 'loading' || files === undefined ? (
                  <SkeletonList rows={3} />
                ) : files === 'failed' ? (
                  <EmptyState scope="section" message="What it lists didn’t load." action={{ label: 'Try again', onClick: retry }} />
                ) : (
                  <>
                    {files.live.length > 0 ? (
                      <Rows files={files.live} looks={files.looks} readOnly={!!page.archived} />
                    ) : (
                      <EmptyState scope="section" message={files.archived.length > 0 ? 'Everything it lists is archived.' : 'No pages, projects or issues.'} />
                    )}
                    {files.archived.length > 0 &&
                      (showArchived || files.live.length === 0 ? (
                        <section className="flex flex-col gap-2">
                          <SectionLabel tone="muted">Archived</SectionLabel>
                          <Rows files={files.archived} looks={files.looks} readOnly={!!page.archived} />
                        </section>
                      ) : (
                        // A button, not the story's link: it opens nothing, it shows the rows below (as Ship's topic page).
                        <Button size="small" variant="muted" leadingIcon={<IconArchive size={14} stroke={1.5} />} className="self-start" onClick={() => setShowArchived(true)}>
                          Archived · {files.archived.length}
                        </Button>
                      ))}
                  </>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>
      {conversation}
    </div>
  )
}

/** A topic has no text: nothing for a comment to point at, nor to scroll to. */
const noBody: RefObject<HTMLDivElement | null> = { current: null }
const noDraft = () => {}

/** What a topic lists, in its order: a row as Leaf's sidebar draws one (its icon, its title and, for another app's file, its type), or its card. */
function Rows({ files, looks, readOnly }: { files: readonly ForeignObject[]; looks: ReadonlyMap<string, FileLook>; readOnly: boolean }) {
  // The cards take the files as the page read them, not one read each; on an archived topic their status and owner only show.
  const read = Object.fromEntries(files.flatMap((file) => (file.naddr ? [[`nostr:${file.naddr}`, file]] : [])))
  return (
    <ReferencesProvider value={read}>
      <CardActsProvider value={!readOnly}>
        <RowList files={files} looks={looks} />
      </CardActsProvider>
    </ReferencesProvider>
  )
}

/** The rows and cards themselves. */
function RowList({ files, looks }: { files: readonly ForeignObject[]; looks: ReadonlyMap<string, FileLook> }) {
  return (
    <div className="flex flex-col gap-px">
      {files.map((file) => {
        const row = rowOf(file)
        // Its card where the topic shows it as one, or its own app draws it so (TOPI-5): the kit's card, as under a comment.
        // It opens where the row did. A written link counts only as a whole https URL on an app's host, so the row's
        // path goes in absolute; else the card would open at the address a manifest gives, which anyone may publish.
        if (file.naddr && lookOf(file, file.address ? looks.get(file.address) : undefined) === 'card')
          return (
            <div key={row.id} data-topic-file={file.address} className="py-1.5">
              <CommentCard uri={`nostr:${file.naddr}`} opensAt={new URL(row.href, window.location.origin).href} />
            </div>
          )
        return (
          <Card key={row.id} href={row.href} hover="fill" quietUntilHover className="flex items-center gap-3 px-3 py-2">
            <span className="flex shrink-0">{row.icon}</span>
            <span className="min-w-0 flex-1 truncate text-body-2 text-text-primary">{row.label}</span>
            {row.hint && <span className="shrink-0">{row.hint}</span>}
          </Card>
        )
      })}
    </div>
  )
}
