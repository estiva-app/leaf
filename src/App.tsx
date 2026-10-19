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
import { NewDocumentDialog } from './folders/NewDocumentDialog'
import { fileKey, findDocument, findFile, groupsOf, isDocument } from './folders/tree'
import { useWorkspace } from './folders/useWorkspace'
import { createDocument, listDocument, takesNewDocuments } from './folders/workspace'
import { useReferencePage } from './document/referencePicker'
import { useRecent } from './home/useRecent'
import { FilePage } from './pages/FilePage'
import { HomePage } from './pages/HomePage'
import { useRelayState } from './relay/useRelayState'
import { documentPath, dOf, navigate, newDocumentFolderOf, pagePath, replace, routeOf, usePathname } from './route'

/** A document that was made but its Folder does not list yet: shown in its place until the listing is retried. */
type Unlisted = { naddr: string; address: string; folder: string; folderName: string }

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
  const [making, setMaking] = useState(false)
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
    void whoAmI().then((who) => {
      if (live && who) setMe(who)
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
  const open =
    route.page === 'file' ? findFile(folders, children, route.naddr) : route.page === 'document' ? findDocument(folders, children, route.d) : null
  /*
    A document opened by its old `/f/<naddr>` link: its own link takes the old one's place, block included, so the
    address bar holds the link every app reads (SPEC §7.7).
  */
  const relink = route.page === 'file' && open && isDocument(open.file) ? pagePath({ ...open.file, title: open.file.slots.title?.value }) : null
  useEffect(() => {
    if (relink) replace(`${relink}${window.location.hash}`)
  }, [relink])
  // `[` on the open page offers its Folder's files, as the tree read them.
  useReferencePage({ address: open?.file.address, folder: open?.folder.contents?.files })
  const reading = workspace.folders === null || workspace.folders.some((f) => f.contents === null && !f.failed)
  const takers = (workspace.folders ?? []).map((f) => f.folder).filter(takesNewDocuments)
  // New document open with text in it when the sign-in ended: open again after the tap, once its Folders are read.
  useReopenHeld(takers.length ? NEW_DOCUMENT_HOLD : undefined, () => setMaking(true))
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
    showToast({ label: 'You can’t add a document to that Folder.', type: 'error' })
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
    const result = await createDocument({ folder, title, summary })
    if (!result.ok && !result.made) {
      showToast({ label: result.reason, type: 'error' })
      return false
    }
    if (!result.ok) {
      const folderName = takers.find((f) => f.id === folder)?.name ?? 'its Folder'
      setUnlisted({ naddr: result.naddr, address: result.address, folder, folderName })
      go(documentPath(dOf(result.address), title))
      return true
    }
    // Read the Folder first, so the document is in hand when it opens rather than "not found" for a moment,
    // and open its group, so the new row is there to see.
    await workspace.reloadFolder(folder)
    setFolderOpen(folder, true)
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
    ) : unlisted && route.page === 'document' && dOf(unlisted.address) === route.d && !open ? (
      <EmptyState
        scope="page"
        message={`This document was made, but ${unlisted.folderName} does not list it yet.`}
        action={{ label: 'Try again', onClick: () => void relist(unlisted) }}
      />
    ) : (
      <FilePage file={open?.file ?? null} loading={reading} />
    )

  return (
    <AppProvider navigate={navigate}>
      <AppShell
        variant="inset"
        logo={APP_TITLE}
        identity={<IdentityMenu me={me} signedIn={signedIn} idBase={ID_CONFIG?.base} onSignOut={signedIn ? beginSignOut : undefined} />}
        nav={
          <Sidebar>
            <NavItem href="/" label="Home" icon={<IconHome size={16} stroke={1.5} />} active={route.page === 'home'} />
            <NavTree
              title="Folders"
              titleActions={
                takers.length ? [{ icon: <IconFilePlus size={16} stroke={1.5} />, tooltip: 'New document', onClick: () => setMaking(true) }] : undefined
              }
              groups={workspace.failed ? [] : groups}
              selected={open ? fileKey(open.file) : route.page === 'file' ? route.naddr : undefined}
              emptyMessage={workspace.failed ? 'Your Folders could not be read. Reload to try again.' : 'No Folders yet.'}
            />
          </Sidebar>
        }
      >
        {main}
      </AppShell>
      {(making || handoffFolder) && (
        <NewDocumentDialog folders={takers} defaultFolder={handoffFolder?.id ?? open?.folder.folder.id} onCreate={make} onClose={closeNew} holdKey={NEW_DOCUMENT_HOLD} />
      )}
    </AppProvider>
  )
}
