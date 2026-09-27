import { AppShell, IdentityMenu, NavItem, Sidebar, type Identity } from '@estiva-app/ui'
import { IconHome } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { beginSignOut, currentToken, whoAmI } from './auth/estivaId'
import { APP_TITLE, ID_CONFIG, RELAY_URL } from './config'
import { HomePage } from './pages/HomePage'
import { useRelayState } from './relay/useRelayState'

/** The frame: the package's AppShell with a sidebar, and the one page. */
export function App() {
  const signedIn = currentToken() !== null
  const [me, setMe] = useState<Identity>({})
  const relayState = useRelayState()

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

  return (
    <AppShell
      logo={APP_TITLE}
      identity={<IdentityMenu me={me} signedIn={signedIn} idBase={ID_CONFIG?.base} onSignOut={signedIn ? beginSignOut : undefined} />}
      nav={
        <Sidebar>
          <NavItem href="/" label="Home" icon={<IconHome size={16} stroke={1.5} />} active />
        </Sidebar>
      }
    >
      <HomePage relay={RELAY_URL} state={relayState} name={me.name} />
    </AppShell>
  )
}
