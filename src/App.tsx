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
import { useEffect, useMemo, useState } from 'react'
import { beginSignOut, currentToken, whoAmI } from './auth/estivaId'
import { APP_TITLE, ID_CONFIG, RELAY_URL } from './config'
import { NewDocumentDialog } from './folders/NewDocumentDialog'
import { findFile, groupsOf } from './folders/tree'
import { useWorkspace } from './folders/useWorkspace'
import { createDocument, listDocument, takesNewDocuments } from './folders/workspace'
import { useRecent } from './home/useRecent'
import { FilePage } from './pages/FilePage'
import { HomePage } from './pages/HomePage'
import { useRelayState } from './relay/useRelayState'
import { filePath, navigate, routeOf, usePathname } from './route'

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

/** The frame: the package's AppShell in its inset manner, the Folders tree in the sidebar, and the page open. */
function Frame() {
  const signedIn = currentToken() !== null
  const [me, setMe] = useState<Identity>({})
  const relayState = useRelayState()
  const route = routeOf(usePathname())
  const workspace = useWorkspace()
  const recent = useRecent(workspace.folders, route.page === 'home')
  const { showToast } = useToast()
  const [making, setMaking] = useState(false)
  const [unlisted, setUnlisted] = useState<Unlisted | null>(null)

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
  const open = route.page === 'file' ? findFile(folders, children, route.naddr) : null
  const reading = workspace.folders === null || workspace.folders.some((f) => f.contents === null && !f.failed)
  const takers = (workspace.folders ?? []).map((f) => f.folder).filter(takesNewDocuments)

  async function make(title: string, folder: string): Promise<boolean> {
    const result = await createDocument({ folder, title })
    if (!result.ok && !result.made) {
      showToast({ label: result.reason, type: 'error' })
      return false
    }
    if (!result.ok) {
      const folderName = takers.find((f) => f.id === folder)?.name ?? 'its Folder'
      setUnlisted({ naddr: result.naddr, address: result.address, folder, folderName })
      navigate(filePath(result.naddr))
      return true
    }
    // Read the Folder first, so the document is in hand when it opens rather than "not found" for a moment,
    // and open its group, so the new row is there to see.
    await workspace.reloadFolder(folder)
    setFolderOpen(folder, true)
    navigate(filePath(result.naddr))
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
    ) : unlisted?.naddr === route.naddr && !open ? (
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
              selected={route.page === 'file' ? route.naddr : undefined}
              emptyMessage={workspace.failed ? 'Your Folders could not be read. Reload to try again.' : 'No Folders yet.'}
            />
          </Sidebar>
        }
      >
        {main}
      </AppShell>
      {making && <NewDocumentDialog folders={takers} defaultFolder={open?.folder.folder.id} onCreate={make} onClose={() => setMaking(false)} />}
    </AppProvider>
  )
}
