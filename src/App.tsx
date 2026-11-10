import {
  AppProvider,
  AppShell,
  EmptyState,
  IdentityMenu,
  NavItem,
  NavTree,
  Sidebar,
  ToastProvider,
  TooltipProvider,
  useToast,
  type Identity,
} from '@estiva-app/ui'
import { IconFilePlus, IconHome } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { beginSignOut, heldToken, whoAmI } from './auth/estivaId'
import { useReopenHeld } from './auth/heldTyping'
import { APP_TITLE, ID_CONFIG, RELAY_URL } from './config'
import { heldUnder, NewDocumentDialog, type NewDocumentUnder } from './folders/NewDocumentDialog'
import { naddrOf } from './fileAddress'
import { fileKey, findArchivedAt, findDocument, findFile, findFileAt, groupsOf, isDocument, titleOf } from './folders/tree'
import { useWorkspace } from './folders/useWorkspace'
import { createDocument, listDocument, takesNewDocuments } from './folders/workspace'
import { useReferencePage } from './document/referencePicker'
import { profileOf } from './document/save'
import { useRecent } from './home/useRecent'
import { FilePage } from './pages/FilePage'
import { useSidebarFold } from './frame/folds'
import { useFileByAddress } from './pages/useFileByAddress'
import { rememberPath, useOwnerPath, usePathAddress } from './pages/usePathAddress'
import { ExploreTopicsPage } from './pages/ExploreTopicsPage'
import { HomePage } from './pages/HomePage'
import { TopicPage } from './pages/TopicPage'
import { viewerPubkey } from './relay/bridge'
import { declaredManifests } from './relay/manifests'
import { useRelayState } from './relay/useRelayState'
import { documentPath, dOf, navigate, newDocumentFolderOf, pagePath, replace, routeOf, usePathname } from './route'
import { useTabTitle } from './tabTitle'
import { TopicsSection } from './topics/TopicsSection'
import { useSidebarTopics } from './topics/useSidebarTopics'

/** A document that was made but its Folder does not list yet: shown in its place until the listing is retried. */
type Unlisted = { address: string; folder: string; folderName: string }

/** The app, with what the package's parts need around them: tooltips and toasts. */
export function App() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <Frame />
      </ToastProvider>
    </TooltipProvider>
  )
}

/** Where New document holds its fields through a passkey trip (AUT-5). */
const NEW_DOCUMENT_HOLD = 'new-document'

/** The frame: the package's AppShell in its inset manner, the Folders tree in the sidebar, and the page open. */
function Frame() {
  const signedIn = heldToken() !== null
  const [me, setMe] = useState<Identity>({})
  const relayState = useRelayState()
  const route = routeOf(usePathname())
  const workspace = useWorkspace()
  const recent = useRecent(workspace.folders, route.page === 'home')
  const { showToast } = useToast()
  // New document open: `true` from the sidebar or Home; a page's "New document inside", under it (LFB-8).
  const [making, setMaking] = useState<boolean | NewDocumentUnder>(false)
  const inside = typeof making === 'object' ? making : undefined
  const [sidebarOpen, setSidebarOpen] = useSidebarFold()
  const [unlisted, setUnlisted] = useState<Unlisted | null>(null)
  /*
    New document on one Folder, from a link another app offered it by
    (`newDocumentPath`): Leaf writes the document, the app that linked here
    signs nothing (Miky, 2026-10-16). Read once, as the tab opens on it.
  */
  const [handoff, setHandoff] = useState(() => newDocumentFolderOf(window.location.pathname, window.location.search))

  useEffect(() => {
    if (!signedIn) return
    let live = true
    // The tab's manifests, read beside the tree's listing: an opened page's resolve is answered from them (APP-3).
    void declaredManifests().catch(() => null)
    void whoAmI().then((who) => {
      if (live && who) setMe((was) => ({ ...was, ...who }))
    })
    // The face is the profile's, as Peek's and Ship's menus draw it: Estiva ID's directory answers no picture.
    const viewer = viewerPubkey()
    if (viewer)
      void profileOf(viewer)
        .catch(() => null)
        .then((profile) => {
          const picture = profile?.picture
          if (live && picture) setMe((was) => ({ ...was, picture }))
        })
    return () => {
      live = false
    }
  }, [signedIn])

  const { folders, children, opened, setOpen, setFolderOpen } = workspace
  const groups = useMemo(
    () => groupsOf(folders, { children, opened, setOpen, setFolderOpen }),
    [folders, children, opened, setOpen, setFolderOpen],
  )
  const reading = workspace.folders === null || workspace.folders.some((f) => f.contents === null && !f.failed)
  // Your topics, read once the Folders are, so the page's text is not behind them (LTN-2).
  const inTree = (address: string) => findFileAt(folders, children, address)?.file ?? null
  // Topics also takes the files the tree read archived, so it does not read them again only to leave them out.
  const readByTree = (address: string) => inTree(address) ?? findArchivedAt(folders, address)
  // Explore topics and a topic's page read every topic themselves; every other page, only yours (ALO-20).
  const topics = useSidebarTopics(signedIn && (!reading || workspace.failed), readByTree, route.page === 'topics' || route.page === 'topic')
  const listedDocument = route.page === 'document' ? findDocument(folders, children, route.d) : null
  // Another app's address for a file, with Leaf's host (`/issue/<slug>-<d>`): the manifests say which file it names.
  // A document's own link is read by its `d` at once, beside the tree, so its text shows before the tree is read
  // (APP-3) — and an archived page, which every listing drops, still opens by its link (LED-4).
  const named = usePathAddress(
    route.page === 'path' ? route : route.page === 'document' && !listedDocument ? { word: 'document', ref: route.d } : null,
  )
  const open =
    route.page === 'file'
      ? findFile(folders, children, route.naddr)
      : route.page === 'document'
        ? listedDocument
        : route.page === 'path' && named.address
          ? findFileAt(folders, children, named.address)
          : null
  // `[` on the open page offers its Folder's files, as the tree read them.
  useReferencePage({ address: open?.file.address, folder: open?.folder.contents?.files })
  // The file opened by its address, read on its own while the tree is still read and until the tree lists it (APP-3):
  // the tree's copy takes over then, keyed the same, so the open editor stays.
  const naddr = route.page === 'file' ? route.naddr : named.address ? naddrOf(named.address) : null
  const byAddress = useFileByAddress(naddr && !open ? naddr : null)
  /*
    The address bar holds the link every app reads (SPEC §7.7). A document opened by its old `/f/<naddr>` link gets
    its own link, block included; another app's file gets its own app's path on Leaf's host, slug refreshed, so
    swapping the host opens it there (RFC 0.5 §7.7 rule 4).
  */
  const shown = route.page === 'file' || route.page === 'path' ? (open?.file ?? byAddress.file) : null
  const readable = shown && !shown.unreachable ? shown : null
  const elsewhere = readable && !isDocument(readable) ? readable : null
  const ownerPath = useOwnerPath(elsewhere)
  const relink = readable && isDocument(readable) ? pagePath({ ...readable, title: readable.slots.title?.value }) : elsewhere ? ownerPath : null
  useEffect(() => {
    if (!relink || relink === window.location.pathname) return
    if (shown?.address) rememberPath(relink, shown.address)
    replace(`${relink}${window.location.hash}`)
  }, [relink, shown])
  const onPage = open?.file ?? byAddress.file
  /*
    The sidebar shows where the open file lives (LFB-9): the package's tree opens its Folder and every row above it,
    once per file, and scrolls to it (ui 0.94). A file the tree does not draw yet opens onto the row it is under, which
    then reads it: a Ship issue, or a page filed under a Ship project, both drawn only once the project has read its
    issues. The tree goes by the row it is under only while it cannot find the file's own.
  */
  const current = open ? fileKey(open.file) : onPage ? fileKey(onPage) : route.page === 'file' ? route.naddr : undefined
  const under = onPage?.parentRef ? findFileAt(folders, children, onPage.parentRef) : null
  useTabTitle(route.page === 'home' ? 'Home' : route.page === 'topics' ? 'Explore topics' : route.page === 'topic' ? null : onPage && !onPage.unreachable ? titleOf(onPage) : undefined)
  const summaries = (workspace.folders ?? []).map((f) => f.folder)
  const takers = summaries.filter(takesNewDocuments)
  // New document open with text in it when the sign-in ended: open again after the tap, once its Folders are read.
  // Under the page it was opened under, when it was, as the dialog held it.
  useReopenHeld(takers.length ? NEW_DOCUMENT_HOLD : undefined, () => setMaking(heldUnder(NEW_DOCUMENT_HOLD) ?? true))
  /*
    Once the Folders are read: the linked one, if a document can go in it here. A read that failed refuses
    nothing: Home says the Folders could not be read, and the link stays in the address bar for the reload.
  */
  const settled = workspace.folders !== null && !workspace.failed
  const handoffFolder = handoff && settled ? takers.find((f) => f.id === handoff) : undefined
  const refused = !!handoff && settled && !handoffFolder

  const toldRefused = useRef(false)
  useEffect(() => {
    if (!refused || toldRefused.current) return
    toldRefused.current = true
    // A Folder this person cannot read, or one that takes no document: nothing is written.
    showToast({ label: 'You can’t add a document to that team.', type: 'error' })
    replace('/')
  }, [refused, showToast])

  function closeNew() {
    setMaking(false)
    if (!handoff) return
    setHandoff(null)
    // Still on the link: it has done its job. A document made from it has already opened its page.
    if (newDocumentFolderOf(window.location.pathname, window.location.search)) replace('/')
  }

  async function make(title: string, folder: string, summary: string): Promise<boolean> {
    // Made from a link: the document's page takes the link's place, so Back does not offer New document again.
    const go = handoff ? replace : navigate
    const result = await createDocument({ folder, title, summary, parent: inside && { address: inside.address, folder: inside.folder } })
    if (!result.ok && !result.made) {
      showToast({ label: result.reason, type: 'error' })
      return false
    }
    if (!result.ok) {
      const folderName = takers.find((f) => f.id === folder)?.name ?? 'its team'
      setUnlisted({ address: result.address, folder, folderName })
      go(documentPath(dOf(result.address), title))
      return true
    }
    // Read the Folder first, so the document is in hand when it opens rather than "not found" for a moment,
    // and open its group, so the new row is there to see.
    await workspace.reloadFolder(folder)
    setFolderOpen(folder, true)
    // Made under a page: that page's row opens on it too.
    if (inside) setFolderOpen(inside.ref, true)
    go(documentPath(dOf(result.address), title))
    return true
  }

  async function relist(made: Unlisted) {
    const result = await listDocument({ folder: made.folder, address: made.address })
    if (!result.ok) {
      showToast({ label: result.reason, type: 'error' })
      return
    }
    await workspace.reloadFolder(made.folder)
    setUnlisted(null)
  }

  const main =
    route.page === 'home' ? (
      <HomePage
        relay={RELAY_URL}
        state={relayState}
        name={me.name}
        recent={workspace.failed ? 'failed' : recent}
        onNew={takers.length ? () => setMaking(true) : undefined}
      />
    ) : route.page === 'topics' ? (
      <ExploreTopicsPage folders={workspace.folders || workspace.failed ? summaries : undefined} />
    ) : route.page === 'topic' ? (
      <TopicPage
        key={route.d}
        d={route.d}
        folders={workspace.folders || workspace.failed ? summaries : undefined}
        inTree={readByTree}
        treeRead={!reading || workspace.failed}
      />
    ) : unlisted && route.page === 'document' && dOf(unlisted.address) === route.d && !open ? (
      <EmptyState
        scope="page"
        message={`This document was made, but ${unlisted.folderName} does not list it yet.`}
        action={{ label: 'Try again', onClick: () => void relist(unlisted) }}
      />
    ) : (
      <FilePage
        file={open?.file ?? byAddress.file}
        loading={reading || named.loading || byAddress.loading}
        folders={workspace.folders || workspace.failed ? summaries : undefined}
        onChanged={workspace.reloadFolder}
        onNewInside={(page, listedIn) =>
          page.address && page.folder && setMaking({ address: page.address, ref: page.ref, folder: page.folder, title: titleOf(page), listedIn })
        }
      />
    )

  return (
    <AppProvider navigate={navigate}>
      <AppShell
        variant="inset"
        logo={APP_TITLE}
        navOpen={sidebarOpen}
        onNavOpenChange={setSidebarOpen}
        identity={<IdentityMenu me={me} signedIn={signedIn} idBase={ID_CONFIG?.base} onSignOut={signedIn ? beginSignOut : undefined} />}
        nav={
          <Sidebar>
            <NavItem href="/" label="Home" icon={<IconHome size={16} stroke={1.5} />} active={route.page === 'home'} />
            {signedIn && (
              <TopicsSection
                topics={topics}
                current={current}
                topicNow={route.page === 'topic' ? route.d : undefined}
                exploreNow={route.page === 'topics'}
                fileNow={(file) => (file.address && inTree(file.address)) || file}
              />
            )}
            <NavTree
              title="Teams"
              titleActions={
                takers.length ? [{ icon: <IconFilePlus size={16} stroke={1.5} />, tooltip: 'New document', onClick: () => setMaking(true) }] : undefined
              }
              groups={workspace.failed ? [] : groups}
              selected={current}
              selectedParent={under ? fileKey(under.file) : undefined}
              emptyMessage={workspace.failed ? 'Your teams could not be read. Reload to try again.' : 'No teams yet.'}
            />
          </Sidebar>
        }
      >
        {main}
      </AppShell>
      {(making || handoffFolder) && (
        <NewDocumentDialog
          folders={takers}
          defaultFolder={inside?.listedIn ?? handoffFolder?.id ?? open?.folder.folder.id}
          under={inside}
          onCreate={make}
          onClose={closeNew}
          holdKey={NEW_DOCUMENT_HOLD}
        />
      )}
    </AppProvider>
  )
}
