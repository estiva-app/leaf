import { BLOCK_DOCUMENT_FORMAT, BODY_SLOT, planListInTopic, type ForeignObject } from '@estiva-app/interop'
import { MUTED_D_TAG, serializeMutedBlob } from '@estiva-app/conversation'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

/*
  A relay for the topics tests (TOPI-4): what it holds, answered filter by filter as it matches, every read it was
  asked and every event this tab sent. Tests mock `../relay/bridge` with `bridge` and `../auth/nip44` with `nip44`.
*/

export const ME = 'a'.repeat(64)
export const MIKY = 'b'.repeat(64)
/** A team's id: a lowercase UUID v4, as a place's team must be. */
export const HQ = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'

type Filter = { ids?: string[]; kinds?: number[]; authors?: string[]; [key: string]: unknown }

export const relay = {
  held: [] as SignedEvent[],
  /** Every event this tab sent and the relay took, as it was handed to be signed. */
  sent: [] as UnsignedEvent[],
  /** Every event this tab tried to send, taken or refused. */
  attempted: [] as UnsignedEvent[],
  /** The filters of every read, in order. */
  reads: [] as Filter[][],
  /** The filters of every paged read (`queryAll`): a read that must be whole, as a read of every topic is (ALO-20). */
  pagedReads: [] as Filter[][],
  /** When set, the relay refuses every write with this reason. */
  refuse: undefined as string | undefined,
  /** When set, the relay refuses writes of these kinds only. */
  refuseKinds: [] as number[],
  reset() {
    this.held = []
    this.sent = []
    this.attempted = []
    this.reads = []
    this.pagedReads = []
    this.refuse = undefined
    this.refuseKinds = []
  },
}

function answer(filters: Filter[]): SignedEvent[] {
  const matches = (e: SignedEvent, f: Filter) =>
    (!f.ids || f.ids.includes(e.id)) &&
    (!f.kinds || f.kinds.includes(e.kind)) &&
    (!f.authors || f.authors.includes(e.pubkey)) &&
    Object.entries(f).every(([key, values]) => !key.startsWith('#') || e.tags.some((t) => t[0] === key.slice(1) && (values as string[]).includes(t[1])))
  return relay.held.filter((e) => filters.some((f) => matches(e, f)))
}

let n = 0
export const sign = (e: UnsignedEvent): SignedEvent => ({ ...e, id: `e${++n}`.padStart(64, '0'), sig: '' }) as SignedEvent
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

/** `../relay/bridge` as the topics read it. */
export const bridge = {
  viewerPubkey: () => ME,
  query: async (filters: Filter[]) => {
    relay.reads.push(filters)
    return answer(filters)
  },
  queryAll: async (filters: Filter[]) => {
    relay.reads.push(filters)
    relay.pagedReads.push(filters)
    return answer(filters)
  },
  publish: async (event: UnsignedEvent) => {
    relay.attempted.push(event)
    if (relay.refuse) return { ok: false, reason: relay.refuse }
    if (relay.refuseKinds.includes(event.kind)) return { ok: false, reason: 'blocked: refused here' }
    relay.sent.push(event)
    relay.held.push(sign(event))
    return { ok: true }
  },
}

/** Whether a read asked for every topic: interop's topics read. */
export const readsTopics = (filters: Filter[]) => filters.some((f) => f.kinds?.includes(30840) && !Object.keys(f).some((k) => k.startsWith('#')))
/** Whether a read asked for the mute list. */
export const readsMuted = (filters: Filter[]) => filters.some((f) => f.kinds?.includes(30078))

/**
 * `../auth/nip44`, stood in for: Estiva ID's encryption is a round trip this test cannot make, so a "ciphertext" is the
 * plaintext behind `enc:`, and a test reads what was encrypted by taking that off. `decrypting` holds a decrypt back.
 */
export const nip44 = {
  decrypting: undefined as Promise<void> | undefined,
  decrypts: 0,
  /** When set, Estiva ID refuses every decrypt (a 429, say). */
  refuseDecrypt: false,
  async decrypt(ciphertext: string): Promise<string> {
    this.decrypts += 1
    await this.decrypting
    if (this.refuseDecrypt) throw new Error('POST /nip44/decrypt failed: 429')
    return ciphertext.replace(/^enc:/, '')
  },
  async encrypt(plaintext: string): Promise<string> {
    return `enc:${plaintext}`
  },
}

/** A file Leaf opens, as the tree or its app's manifest draws it, on the relay. */
export function file(kind: 30842 | 30850 | 30851 | 30852, title: string, extra: Partial<ForeignObject> = {}): ForeignObject {
  const d = uuid()
  const address = `${kind}:${MIKY}:${d}`
  relay.held.push(sign({ kind, pubkey: MIKY, created_at: 1_700_000_000, tags: [['d', d], ['title', title], ['h', HQ]], content: '' }))
  // Ship's issue and project share their text with Leaf: a block-document description in the body slot.
  const shared = kind === 30850 || kind === 30851
  return {
    address,
    kind,
    ref: address,
    naddr: `naddr-${d}`,
    slots: { title: { value: title }, ...(shared ? { [BODY_SLOT]: { field: 'description' } } : {}) },
    actions: shared ? [{ control: 'text', field: 'description', format: BLOCK_DOCUMENT_FORMAT }] : [],
    ...extra,
  } as unknown as ForeignObject
}

/** A topic `author` made at `at` (seconds), listing `files`; its address. Made by you, it is yours. */
export function topic(author: string, title: string, files: ForeignObject[], at = 1_700_000_000): string {
  const d = uuid()
  const address = `30840:${author}:${d}`
  relay.held.push(sign({ kind: 30840, pubkey: author, created_at: at, tags: [['d', d], ['title', title], ['h', HQ]], content: '' }))
  for (const f of files) relay.held.push(sign(planListInTopic(author, at * 1000, { topic: { address, folder: HQ }, file: f.address!.split(':')[2] })[0]))
  return address
}

/** Miky says something in a topic at `at` (seconds): activity in it. */
export const said = (address: string, at: number) =>
  relay.held.push(sign({ kind: 1111, pubkey: MIKY, created_at: at, tags: [['A', address], ['K', '30840'], ['h', HQ]], content: 'On it.' }))

/** A team's list marks the topic one of its spaces. */
export const markSpace = (address: string) =>
  relay.held.push(sign({ kind: 30890, pubkey: MIKY, created_at: 1_700_000_000, tags: [['d', 'team'], ['a', address, '', 'space']], content: '' }))

/** The topic is archived. */
export const archive = (address: string) =>
  relay.held.push(sign({ kind: 1851, pubkey: MIKY, created_at: 1_700_000_100, tags: [['a', address], ['field', 'archived'], ['value', 'true'], ['h', HQ]], content: '' }))

/** Your mute list, holding `keys`, "encrypted" as {@link nip44} does. */
export const muteList = (keys: string[], at = 1_700_000_500) =>
  relay.held.push(
    sign({ kind: 30078, pubkey: ME, created_at: at, tags: [['d', MUTED_D_TAG], ['t', 'estiva']], content: `enc:${serializeMutedBlob(keys, at * 1000)}` }),
  )
