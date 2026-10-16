import { signViaEstivaId } from '@estiva-app/identity'
import { KIND } from '@estiva-app/protocol'
import { browserOnlineSource, createLiveClientHolder, type LiveClient } from '@estiva-app/platform'
import { currentToken } from '../auth/estivaId'
import { ID_CONFIG, RELAY_URL } from '../config'

/**
 * The event kinds that are Leaf's own: documents (`kind:30842`, the file type
 * Leaf owns through its manifest — never a topic's `30840`), the Folder command
 * that lists one, a change to a document's title or text, a comment on it, a
 * deletion, and resolving a comment's thread (`9101`, as Peek does). Ship reads
 * seven of its own, Peek its own. Each one here is in Leaf's ceiling in the
 * Estiva ID seed too, or its first save is refused at /sign.
 */
export const KINDS: number[] = [KIND.DOCUMENT, 1852, 1851, 1111, 5, 9101]

/**
 * The tab's one relay client. `@estiva-app/platform` hands out a holder and
 * keeps nothing, so this line is where "one connection per tab" lives. The relay
 * signs a connection in once and caps subscriptions per connection, so a
 * connection per component is wrong, not only wasteful; React's StrictMode,
 * which mounts everything twice, is what would show it.
 *
 * Peek and Ship hold theirs the same way. Everything the client needs is handed
 * in and nothing here reads the app's own data, so it could move into
 * `@estiva-app/platform` as it is, if that is ever worth doing.
 */
const holder = createLiveClientHolder()

/**
 * The client, or `null` when this build cannot have one: no relay is set, or
 * there is no sign-in. The relay refuses anything before sign-in, so a socket
 * without it would only connect, be refused and retry.
 */
export function relayClient(): LiveClient | null {
  const base = ID_CONFIG?.base
  if (!RELAY_URL || !base) return null
  return holder.get({
    relayUrl: RELAY_URL,
    // Read on every connect, never kept: a token kept from the first connect
    // outlives a silent renewal as a dead one, and the next reconnect fails.
    getCredential: () => {
      const token = currentToken()
      return token ? { accessToken: token.accessToken, pubkey: token.pubkey } : null
    },
    // `expectedPubkey` is a check, not a request. Estiva ID signs as the token's
    // owner whatever it is handed, so a mismatch comes back as a valid event
    // signed by somebody else. Always pass it.
    sign: (unsigned, token, expectedPubkey) => signViaEstivaId(unsigned, { base, token, expectedPubkey }),
    online: typeof window === 'undefined' ? undefined : browserOnlineSource(window),
    // Names this app in the relay's own logs.
    subscriptionPrefix: 'leaf-',
    log: (message, detail) => console.debug('[relay]', message, detail ?? ''),
  })
}
