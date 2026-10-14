/**
 * Publish Leaf's NIP-89 manifest (`src/manifest.ts`), then read it back the way
 * a consumer does — by `#k` — and check that this is the only one claiming a
 * document.
 *
 *   APP_URL=https://leaf.estiva.app/ RELAY_URL=https://estiva.estiva.app npx tsx scripts/publish-manifest.ts [--dry-run]
 *   npx tsx scripts/publish-manifest.ts --new-key     # once: make .manifest-key and print the address to commit
 *
 * Identity: signs with `.manifest-key` (or `MANIFEST_KEY_FILE`), 64 hex, and
 * refuses unless it is the key of the committed `src/manifest-address.ts`. Any
 * other key would publish a second manifest competing with the live one, and
 * NIP-33 has no way to rank two. The key is gitignored, made once, and is a
 * relay member (`kind:9030`) — it never signs through Estiva ID.
 *
 * `--dry-run` signs nothing it publishes: it reads the relay and prints what it
 * would send. `--allow-collision` publishes even when another key's manifest
 * claims `30842`, printing it.
 */
import { authorizationHeaderFor, buildUnsignedAuthEvent, publicKeyFromSecret, signEvent } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { buildManifest, DEFAULT_APP_URL, MANIFEST_D_TAG } from '../src/manifest'
import { MANIFEST_ADDRESS } from '../src/manifest-address'

const RELAY_URL = (process.env.RELAY_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const APP_URL = process.env.APP_URL ?? DEFAULT_APP_URL
const KEY_FILE = process.env.MANIFEST_KEY_FILE ?? new URL('../.manifest-key', import.meta.url).pathname
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

function refuse(why: string): never {
  console.error(`\n✋ ${why}\n   Nothing was published.`)
  process.exit(1)
}

if (args.includes('--new-key')) {
  if (existsSync(KEY_FILE)) refuse(`${KEY_FILE} exists already; a second key would publish a competing manifest.`)
  const secret = randomBytes(32).toString('hex')
  const pubkey = publicKeyFromSecret(secret)
  writeFileSync(KEY_FILE, `${secret}\n`, { mode: 0o600 })
  console.log(`Wrote ${KEY_FILE}. Commit this to src/manifest-address.ts, then admit the key to the relay (kind:9030):`)
  console.log(`  31990:${pubkey}:${MANIFEST_D_TAG}`)
  process.exit(0)
}

/** The key of the committed address, or exit. */
function manifestKey(): { secret: string; pubkey: string } {
  const [kind, pubkey, d] = MANIFEST_ADDRESS.split(':')
  if (kind !== '31990' || d !== MANIFEST_D_TAG || !/^[0-9a-f]{64}$/.test(pubkey ?? '')) {
    refuse(`src/manifest-address.ts holds ${MANIFEST_ADDRESS}, not 31990:<pubkey>:${MANIFEST_D_TAG}. Run --new-key first.`)
  }
  if (!existsSync(KEY_FILE)) refuse(`there is no ${KEY_FILE} for ${MANIFEST_ADDRESS}.`)
  const secret = readFileSync(KEY_FILE, 'utf8').trim()
  if (!/^[0-9a-f]{64}$/.test(secret) || publicKeyFromSecret(secret) !== pubkey) refuse(`${KEY_FILE} is not the key of ${MANIFEST_ADDRESS}.`)
  return { secret, pubkey }
}

/**
 * A remote relay with a local app URL would send every "Open in Leaf" to a
 * laptop — Ship did exactly that on 2026-08-25, with every check green.
 */
function assertUrlsAgree() {
  const local = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)/.test(u)
  if (!local(RELAY_URL) && local(APP_URL)) refuse(`relay is ${RELAY_URL} but the app URL is ${APP_URL}. Set APP_URL=https://leaf.estiva.app/.`)
}

async function bridge(path: string, payload: unknown, key: { secret: string; pubkey: string }) {
  const url = `${RELAY_URL}${path}`
  const body = JSON.stringify(payload)
  const auth = signEvent(buildUnsignedAuthEvent({ pubkey: key.pubkey, url, method: 'POST', body }) as UnsignedEvent, key.secret)
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) }, body })
  return { status: response.status, text: await response.text() }
}

async function query(filters: Record<string, unknown>[], key: { secret: string; pubkey: string }): Promise<SignedEvent[]> {
  const { status, text } = await bridge('/query', filters, key)
  if (status !== 200) refuse(`the relay refused a read (${status}): ${text.slice(0, 200)}`)
  return JSON.parse(text) as SignedEvent[]
}

async function main() {
  assertUrlsAgree()
  const key = manifestKey()
  const claims = await query([{ kinds: [31990], '#k': ['30842'], limit: 20 }], key)
  const others = claims.filter((e) => e.pubkey !== key.pubkey)
  if (others.length) {
    const named = others.map((e) => `31990:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')?.[1]}`).join(', ')
    if (!args.includes('--allow-collision')) refuse(`another manifest already claims 30842: ${named}.`)
    console.warn(`⚠ publishing beside ${named}`)
  }
  const signed = signEvent(buildManifest(key.pubkey, Date.now(), APP_URL), key.secret)
  console.log(`web: ${signed.tags.find((t) => t[0] === 'web')?.[1]}`)
  if (DRY_RUN) {
    console.log(`--dry-run: would publish ${MANIFEST_ADDRESS} (${signed.content.length} bytes of content) to ${RELAY_URL}`)
    return
  }
  const { status, text } = await bridge('/events', signed, key)
  let accepted = false
  try {
    accepted = (JSON.parse(text) as { accepted?: boolean }).accepted === true
  } catch {
    /* not JSON: refused before ingest */
  }
  if (!accepted) refuse(`the relay did not accept the manifest (${status}): ${text.slice(0, 300)}`)

  const back = (await query([{ kinds: [31990], '#k': ['30842'], limit: 20 }], key)).filter((e) => e.pubkey === key.pubkey)
  const live = back.find((e) => e.id === signed.id)
  if (!live) refuse(`published, but a #k read does not return it (${back.length} of Leaf's own found).`)
  console.log(`✅ ${MANIFEST_ADDRESS} is live; ${others.length + 1} manifest(s) claim 30842.`)
}

void main()
