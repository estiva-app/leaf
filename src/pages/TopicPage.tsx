import type { FileLook, FolderSummary, ForeignObject } from '@estiva-app/interop'
import { Button, Card, EmptyState, KindIcon, Link, NoAccessNotice, PageHeader, Panel, SectionLabel, SkeletonList } from '@estiva-app/ui'
import { IconArchive, IconExternalLink } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { rowOf } from '../folders/tree'
import { replace } from '../route'
import { useTabTitle } from '../tabTitle'
import { isSiblingHost, topicPath } from '../topics/topicLinks'
import { lookOf, useTopicPage } from '../topics/useTopicPage'
import { CommentCard } from '../comments/CommentCard'

/**
 * A topic's page in Leaf (LTN-3), as the approved story draws it (estiva-ui `concept/cross-app-navigation`,
 * `LeafTopics.tsx`): its title with its team under it and "Conversation in Peek" on the right, its summary, what it
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
  const peek = page?.peekUrl && (
    <span className="flex shrink-0 text-body-2">
      <Link href={page.peekUrl} external variant="quiet" className="flex items-center gap-1">
        Conversation in Peek
        <IconExternalLink size={14} stroke={1.5} aria-hidden />
      </Link>
    </span>
  )
  const team = page ? folders?.find((folder) => folder.id === page.folder)?.name : undefined
  const files = page?.files
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel
          title={page?.title ?? 'Topic'}
          header={<PageHeader title={page?.title ?? ''} leading={<KindIcon kind="topic" />} actions={peek || undefined} />}
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
                      <Rows files={files.live} looks={files.looks} />
                    ) : (
                      <EmptyState scope="section" message={files.archived.length > 0 ? 'Everything it lists is archived.' : 'No pages, projects or issues.'} />
                    )}
                    {files.archived.length > 0 &&
                      (showArchived || files.live.length === 0 ? (
                        <section className="flex flex-col gap-2">
                          <SectionLabel tone="muted">Archived</SectionLabel>
                          <Rows files={files.archived} looks={files.looks} />
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
    </div>
  )
}

/** What a topic lists, in its order: a row as Leaf's sidebar draws one (its icon, its title and, for another app's file, its type), or its card. */
function Rows({ files, looks }: { files: readonly ForeignObject[]; looks: ReadonlyMap<string, FileLook> }) {
  return (
    <div className="flex flex-col gap-px">
      {files.map((file) => {
        const row = rowOf(file)
        // Its card where the topic shows it as one, or its own app draws it so (TOPI-5): the kit's card, as under a comment.
        if (file.naddr && lookOf(file, file.address ? looks.get(file.address) : undefined) === 'card')
          return (
            <div key={row.id} data-topic-file={file.address} className="py-1.5">
              <CommentCard uri={`nostr:${file.naddr}`} opensAt={row.href} />
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
