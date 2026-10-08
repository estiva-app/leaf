import { useState } from 'react'
import { IconFilePlus, IconHome } from '@tabler/icons-react'
import {
  AppProvider,
  AppShell,
  Card,
  Chip,
  EmptyState,
  IdentityMenu,
  KindIcon,
  NavItem,
  NavTree,
  Panel,
  SectionHeader,
  Sidebar,
  SkeletonList,
  type NavTreeGroup,
  type NavTreeNode,
} from '@estiva-app/ui'
import { DocumentPage, type CommentsIn } from './DocumentPage'
import { DOCS, FOLDERS, PEOPLE, RECENT, THREADS, type Doc, type TreeDoc, type TreeFolder } from './fixtures'

const nodeOf = (d: TreeDoc): NavTreeNode => ({
  id: d.id,
  label: d.label,
  href: `/d/${d.id}`,
  icon: <KindIcon kind={d.kind} />,
  // Another app's file, named by its app on hover (Katerina, 2 October: 3F).
  hint: d.app ? <Chip type="neutral" label={d.app} /> : undefined,
  children: d.children?.map(nodeOf),
})

const groupsOf = (folders: TreeFolder[] | null): NavTreeGroup[] | null =>
  folders?.map((f) => ({
    id: f.id,
    title: f.title,
    nodes: f.docs.map(nodeOf),
    message: f.docs.length === 0 ? 'Nothing in this yet.' : undefined,
  })) ?? null

const findDoc = (folders: TreeFolder[], id: string): TreeDoc | undefined => {
  const walk = (docs: TreeDoc[]): TreeDoc | undefined => {
    for (const d of docs) {
      if (d.id === id) return d
      const inner = d.children && walk(d.children)
      if (inner) return inner
    }
  }
  for (const f of folders) {
    const found = walk(f.docs)
    if (found) return found
  }
}

/** A document the prototype has text for, or an empty one under the row's name. */
const docFor = (id: string, label: string): Doc =>
  DOCS.find((d) => d.id === id) ?? {
    id,
    title: label,
    folder: FOLDERS.find((f) => findDoc([f], id))?.title ?? '',
    editedBy: 'mia',
    edited: 'last week',
    content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: `${id}-1` } }] },
  }

/** Home: the documents you touched last, newest first. */
function HomePage({ empty, loading, onOpen, onNew }: { empty?: boolean; loading?: boolean; onOpen: (id: string) => void; onNew: () => void }) {
  if (empty) {
    return (
      <div className="flex min-h-0 flex-1">
        <EmptyState scope="page" icon={<IconFilePlus size={24} stroke={1.5} />} message="No documents yet." action={{ label: 'New document', onClick: onNew }} />
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
      <Panel title="Home" bodyClassName="px-12 pt-10 pb-24">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          <SectionHeader title="Recent" hover="none" />
          {loading ? (
            <SkeletonList rows={4} />
          ) : (
            RECENT.map((r) => (
              <Card
                key={r.id}
                href={`/d/${r.id}`}
                hover="fill"
                quietUntilHover
                onClick={(e) => {
                  e.preventDefault()
                  onOpen(r.id)
                }}
                className="flex items-center gap-3 px-3 py-2"
              >
                <KindIcon kind="file" />
                <span className="min-w-0 flex-1 truncate text-body-2-strong text-text-primary">{r.title}</span>
                <span className="shrink-0 text-caption text-text-muted">{`${r.folder} · ${PEOPLE[r.by].name}, ${r.when}`}</span>
              </Card>
            ))
          )}
        </div>
      </Panel>
      </div>
    </div>
  )
}

/** Another app's file, picked in Leaf's tree: Leaf says whose it is and leads there. */
function ElsewherePage({ doc }: { doc: TreeDoc }) {
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
      <Panel
        title={
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-body-2-strong text-text-primary">{doc.label}</p>
            <Chip type="neutral" label={doc.app ?? ''} className="shrink-0" />
          </div>
        }
        bodyClassName="flex flex-1 flex-col"
      >
        <EmptyState scope="page" icon={<KindIcon kind={doc.kind} />} message={`${doc.label} lives in ${doc.app}.`} action={{ label: `Open in ${doc.app}`, onClick: () => {} }} />
      </Panel>
      </div>
    </div>
  )
}

export interface LeafPrototypeProps {
  /** Which page opens first: `home`, or a document's id. */
  start?: string
  /** The comments column shown on the first document. Absent: shown when it has threads. */
  sidePanel?: boolean
  /** Words being commented on when the page opens: their block and the words. */
  draft?: { block: string; quote: string }
  /** A thread open when the page opens. */
  active?: string
  /** Where a comment on words is read: the column (A) or a bubble on the words (B). */
  commentsIn?: CommentsIn
  /** Reads still on their way. */
  loading?: boolean
  /** A workspace with nothing in it yet. */
  empty?: boolean
}

/**
 * Leaf, drawn whole from estiva-ui parts: the inset frame Leaf already has,
 * the Folders tree, Home, and a document with its comments.
 */
export function LeafPrototype({ start = 'home', sidePanel, draft, active, commentsIn = 'column', loading, empty }: LeafPrototypeProps) {
  const [page, setPage] = useState(start)
  const [titles, setTitles] = useState<Record<string, string>>({})
  // Peek's rule (Katerina, 7 October): shown when there is something to show, hidden when nothing; a close is remembered per file.
  const [hidden, setHidden] = useState<Record<string, boolean>>(sidePanel === undefined ? {} : { [start]: !sidePanel })

  const folders = empty ? [] : loading ? null : FOLDERS
  const open = (id: string) => setPage(id)
  const navigate = (href: string) => setPage(href === '/' ? 'home' : href.replace('/d/', ''))

  const tree = empty || loading ? undefined : findDoc(FOLDERS, page)
  const doc = page === 'home' ? null : docFor(page, tree?.label ?? '')
  const threads = THREADS.filter((t) => t.doc === page)
  // In bubbles (B) the column starts hidden: the words are where comments are read.
  const shown = doc ? !(hidden[page] ?? (commentsIn === 'bubble' || threads.length === 0)) : false

  return (
    <AppProvider navigate={navigate}>
      <AppShell
        variant="inset"
        logo="Leaf"
        identity={<IdentityMenu me={PEOPLE.me} signedIn />}
        nav={
          <Sidebar>
            <NavItem href="/" label="Home" icon={<IconHome size={16} stroke={1.5} />} active={page === 'home'} />
            <NavTree
              title="Folders"
              titleActions={[{ icon: <IconFilePlus size={16} stroke={1.5} />, tooltip: 'New document', onClick: () => open('blank') }]}
              groups={groupsOf(folders)}
              selected={page === 'home' ? undefined : page}
              onSelect={(node, event) => {
                event.preventDefault()
                open(node.id)
              }}
              emptyMessage="No Folders yet."
            />
          </Sidebar>
        }
      >
        {page === 'home' || !doc ? (
          <HomePage empty={empty} loading={loading} onOpen={open} onNew={() => open('blank')} />
        ) : tree?.app ? (
          <ElsewherePage doc={tree} />
        ) : (
          <DocumentPage
            key={page}
            doc={{ ...doc, title: titles[page] ?? doc.title }}
            threads={threads}
            sidePanel={shown}
            onToggleSidePanel={() => setHidden((h) => ({ ...h, [page]: shown }))}
            onRename={(title) => setTitles((t) => ({ ...t, [page]: title }))}
            commentsIn={commentsIn}
            initialDraft={page === start ? draft : null}
            initialActive={page === start ? active : null}
            loading={loading}
          />
        )}
      </AppShell>
    </AppProvider>
  )
}
