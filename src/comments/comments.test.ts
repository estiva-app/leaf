import { describe, expect, it, vi } from 'vitest'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ME = 'a'.repeat(64)
const publish = vi.hoisted(() => vi.fn<(event: UnsignedEvent) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true })))
const relay = vi.hoisted(() => ({ events: [] as SignedEvent[] }))
/* The relay, by filter: kinds, `#A` and `#e`, which is all these reads ask. */
const matches = (e: SignedEvent, f: Record<string, unknown>) =>
  (!f.kinds || (f.kinds as number[]).includes(e.kind)) &&
  Object.entries(f).every(([k, v]) => !k.startsWith('#') || e.tags.some((t) => t[0] === k.slice(1) && (v as string[]).includes(t[1])))
vi.mock('../relay/bridge', () => ({
  query: vi.fn(async (filters: Record<string, unknown>[]) => relay.events.filter((e) => filters.some((f) => matches(e, f)))),
  publish,
  viewerPubkey: () => ME,
}))

import { postComment, postReply, readThreads, setResolved, type Thread } from './comments'

const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const AUTHOR = 'b'.repeat(64)
const ADDRESS = `30842:${AUTHOR}:d1`
const DOC = { address: ADDRESS, folder: FOLDER }
const sent = () => publish.mock.calls.at(-1)![0]

let n = 0
const event = (kind: number, tags: string[][], content = '', pubkey = AUTHOR): SignedEvent => {
  n += 1
  return { id: n.toString(16).padStart(64, '0'), pubkey, created_at: 1_760_000_000 + n, kind, tags, content, sig: '' }
}
const comment = (tags: string[][], content: string, h = FOLDER) =>
  event(1111, [['A', ADDRESS], ['K', '30842'], ['P', AUTHOR], ['a', ADDRESS], ['k', '30842'], ['p', AUTHOR], ...tags, ['h', h]], content)

describe('a comment from the column', () => {
  it("on a block is a 1111 on the document, naming the block and carrying the document's Folder as h", async () => {
    await postComment(DOC, 'Too long?', '8373a025427f')
    const e = sent()
    expect(e.kind).toBe(1111)
    expect(e.content).toBe('Too long?')
    expect(e.tags).toEqual(expect.arrayContaining([['A', ADDRESS], ['a', ADDRESS], ['block', '8373a025427f'], ['h', FOLDER]]))
  })

  it('on the whole document names no block', async () => {
    await postComment(DOC, 'Looks good')
    expect(sent().tags.some((t) => t[0] === 'block')).toBe(false)
  })

  it("is a reply naming the thread's comment, with no block of its own and no lowercase a (SPEC §13.6, §6.4)", async () => {
    const root = comment([['block', '8373a025427f']], 'Too long?')
    const thread: Thread = { id: root.id, blocks: ['8373a025427f'], root: { id: root.id, by: AUTHOR, at: root.created_at, body: root.content, event: root }, replies: [], resolved: false }
    await postReply(DOC, thread, 'Cut it')
    const e = sent()
    expect(e.kind).toBe(1111)
    expect(e.tags).toEqual(expect.arrayContaining([['A', ADDRESS], ['e', root.id], ['h', FOLDER]]))
    expect(e.tags.some((t) => t[0] === 'block' || t[0] === 'a')).toBe(false)
    // The comment's author is the one told, not the replier.
    expect(e.tags).toContainEqual(['p', AUTHOR])
    expect(e.tags.some((t) => t[0] === 'p' && t[1] === ME)).toBe(false)
  })

  it('resolves a thread with the 9101 Peek writes, in the document\'s Folder', async () => {
    const root = comment([], 'x')
    await setResolved(DOC, { id: root.id, root: { id: root.id, by: AUTHOR, at: 0, body: 'x', event: root }, replies: [], resolved: false }, true)
    const e = sent()
    expect(e.kind).toBe(9101)
    expect(e.tags).toEqual(expect.arrayContaining([['h', FOLDER], ['e', root.id], ['action', 'resolved']]))
  })

  it('gives plain words when the relay refuses, for the box to say beside your text', async () => {
    publish.mockResolvedValueOnce({ ok: false, reason: 'blocked: kind 1111 not allowed' })
    expect(await postComment(DOC, 'x', 'b1')).toEqual({ ok: false, reason: 'Could not send your comment. Your text is still here.' })
  })
})

describe("a document's threads", () => {
  it('groups replies under their comment, keeps the block, reads the last resolution, and ignores a comment from another Folder', async () => {
    const onBlock = comment([['block', 'b1']], 'On the paragraph')
    const whole = comment([], 'On the page')
    const stray = comment([['block', 'b1']], 'Signed into another Folder', 'another-folder')
    const reply = event(1111, [['A', ADDRESS], ['K', '30842'], ['P', AUTHOR], ['e', onBlock.id], ['k', '1111'], ['h', FOLDER]], 'Cut it', ME)
    const resolvedThenReopened = [
      event(9101, [['h', FOLDER], ['e', whole.id], ['t', 'resolution'], ['action', 'resolved']]),
      event(9101, [['h', FOLDER], ['e', onBlock.id], ['t', 'resolution'], ['action', 'resolved']]),
      event(9101, [['h', FOLDER], ['e', onBlock.id], ['t', 'resolution'], ['action', 'reopened']]),
    ]
    relay.events = [onBlock, whole, stray, reply, ...resolvedThenReopened]
    const threads = await readThreads(DOC)
    expect(threads.map((t) => [t.root.body, t.blocks, t.replies.map((r) => r.body), t.resolved])).toEqual([
      ['On the paragraph', ['b1'], ['Cut it'], false],
      ['On the page', undefined, [], true],
    ])
  })
})
