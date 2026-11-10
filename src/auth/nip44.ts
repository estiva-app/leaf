/**
 * NIP-44 self-encryption through Estiva ID, as Ship's `api/nip44.ts` (CRO-8): Leaf holds no key, so encryption is a
 * round trip exactly as signing is. The endpoints encrypt to yourself only (CRO-1).
 *
 * The mute list is the only caller (TOPI-4): Leaf's topics leave out the ones you muted, as Peek's and Ship's do, and
 * Join takes a topic off it. A 401 renews the session once and asks again, as `/sign` does (AUT-5).
 */
import { ID_CONFIG } from '../config'
import { heldToken, renew } from './estivaId'

/** `/nip44/*` answered, and not with 200. */
export class Nip44Error extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call(op: 'encrypt' | 'decrypt', body: object): Promise<unknown> {
  const ask = (accessToken: string) =>
    fetch(`${ID_CONFIG!.base.replace(/\/+$/, '')}/nip44/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    })
  const token = heldToken()
  if (!ID_CONFIG || !token) throw new Nip44Error(`/nip44/${op}: no Estiva ID session`, 401)
  let response = await ask(token.accessToken)
  if (response.status === 401) {
    const renewed = await renew()
    if (renewed) response = await ask(renewed)
  }
  // 429 is real: 120 operations a minute per app per person, encrypt and decrypt together.
  if (!response.ok) throw new Nip44Error(`POST /nip44/${op} failed: ${response.status} ${await response.text()}`, response.status)
  return response.json()
}

export const nip44 = {
  async encrypt(plaintext: string): Promise<string> {
    const { ciphertext } = (await call('encrypt', { plaintext })) as { ciphertext: string }
    return ciphertext
  },
  /** Throws when Estiva ID did not answer; the caller tells "could not read" from "nothing muted". */
  async decrypt(ciphertext: string): Promise<string> {
    const { plaintext } = (await call('decrypt', { ciphertext })) as { plaintext: string }
    return plaintext
  },
}
