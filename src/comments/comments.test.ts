import { describe, expect, it, vi } from 'vitest'
import { fileReference, messageReference } from '@estiva-app/conversation'
import { encodeNpub, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'

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

import { deleteComment, editComment, postComment, postReply, readThreads, setResolved, type CommentItem, type Thread } from './comments'

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
const reply = (to: SignedEvent, tags: string[][], content: string, pubkey = ME) =>
  event(1111, [['A', ADDRESS], ['K', '30842'], ['P', AUTHOR], ['e', to.id], ['k', '1111'], ['p', to.pubkey], ...tags, ['h', FOLDER]], content, pubkey)
const itemOf = (e: SignedEvent): CommentItem => ({ id: e.id, by: e.pubkey, at: e.created_at, body: e.content, edited: false, event: e, reactions: [] })

describe('a comment from the column', () => {
  it("on a block is a 1111 on the document, naming the block and carrying the document's Folder as h", async () => {
    await postComment(DOC, { text: 'Too long?' }, { blocks: ['8373a025427f'] })
    const e = sent()
    expect(e.kind).toBe(1111)
    expect(e.content).toBe('Too long?')
    expect(e.tags).toEqual(expect.arrayContaining([['A', ADDRESS], ['a', ADDRESS], ['block', '8373a025427f'], ['h', FOLDER]]))
  })

  it('on the whole document names no block', async () => {
    await postComment(DOC, { text: 'Looks good' })
    expect(sent().tags.some((t) => t[0] === 'block')).toBe(false)
  })

  it("is a reply naming the thread's comment, copying its block and quote, with no lowercase a (SPEC §13.6, §6.4)", async () => {
    const quote = ['quote', 'too long', 'by far']
    const root = comment([['block', '8373a025427f', '9a1b'], quote], 'Too long?')
    const thread: Thread = { id: root.id, blocks: ['8373a025427f', '9a1b'], root: itemOf(root), replies: [], resolved: false }
    await postReply(DOC, thread, { text: 'Cut it' })
    const e = sent()
    expect(e.kind).toBe(1111)
    expect(e.tags).toEqual(expect.arrayContaining([['A', ADDRESS], ['e', root.id], ['h', FOLDER], ['block', '8373a025427f', '9a1b'], quote]))
    expect(e.tags.some((t) => t[0] === 'a')).toBe(false)
    // The comment's author is the one told, not the replier.
    expect(e.tags).toContainEqual(['p', AUTHOR])
    expect(e.tags.some((t) => t[0] === 'p' && t[1] === ME)).toBe(false)
  })

  it('resolves a thread with the 9101 Peek writes, in the document\'s Folder', async () => {
    const root = comment([], 'x')
    await setResolved(DOC, { id: root.id, root: itemOf(root), replies: [], resolved: false }, true)
    const e = sent()
    expect(e.kind).toBe(9101)
    expect(e.tags).toEqual(expect.arrayContaining([['h', FOLDER], ['e', root.id], ['action', 'resolved']]))
  })

  it("edits your comment with the 40003 Peek writes, in the comment's own Folder, carrying no place of its own", async () => {
    const root = comment([['block', 'b1'], ['quote', 'words']], 'Too long?', 'another-folder')
    expect(await editComment(itemOf(root), { text: 'Far too long?' })).toEqual({ ok: true })
    const e = sent()
    expect(e.kind).toBe(40003)
    expect(e.content).toBe('Far too long?')
    expect(e.tags).toEqual(expect.arrayContaining([['h', 'another-folder'], ['e', root.id]]))
    expect(e.tags.some((t) => t[0] === 'block' || t[0] === 'quote')).toBe(false)
  })

  it('deletes your comment with a kind:5 naming it', async () => {
    const root = comment([], 'x')
    await deleteComment(itemOf(root))
    expect(sent().kind).toBe(5)
    expect(sent().tags).toContainEqual(['e', root.id])
  })

  it('gives plain words when the relay refuses, for the box to say after "Not sent:"', async () => {
    publish.mockResolvedValueOnce({ ok: false, reason: 'blocked: kind 1111 not allowed' })
    expect(await postComment(DOC, { text: 'x' }, { blocks: ['b1'] })).toEqual({ ok: false, reason: 'it did not go through' })
  })
})

describe('what a comment names', () => {
  const QA2 = 'c'.repeat(64)
  const ISSUE = `30851:${'d'.repeat(64)}:issue-1`
  const OTHER = 'e'.repeat(64)

  it('tags the person it mentions, the urgent one beside them, the issue it references and the message it quotes (SPEC §13.1)', async () => {
    const text = `Ask nostr:${encodeNpub(QA2)} about ${fileReference(ISSUE)}, as ${messageReference(OTHER, 1111)} said **today**`
    await postComment(DOC, { text, urgent: [QA2] }, { blocks: ['b1'] })
    const e = sent()
    expect(e.content).toBe(text)
    expect(e.tags).toEqual(expect.arrayContaining([['p', QA2], ['urgent', QA2], ['a', ISSUE], ['q', OTHER], ['block', 'b1']]))
  })

  it('makes nobody urgent the box did not pick urgently', async () => {
    await postComment(DOC, { text: `Hi nostr:${encodeNpub(QA2)}` })
    expect(sent().tags).toContainEqual(['p', QA2])
    expect(sent().tags.some((t) => t[0] === 'urgent')).toBe(false)
  })

  it('in a reply, names the person and the file, but quotes neither the comment it answers nor the page by a second a', async () => {
    const root = comment([], 'Too long?')
    const thread: Thread = { id: root.id, root: itemOf(root), replies: [], resolved: false }
    await postReply(DOC, thread, { text: `nostr:${encodeNpub(QA2)} see ${fileReference(ISSUE)}, ${messageReference(root.id, 1111)} and ${fileReference(ADDRESS)}` })
    const e = sent()
    expect(e.tags).toEqual(expect.arrayContaining([['p', QA2], ['a', ISSUE]]))
    expect(e.tags.some((t) => t[0] === 'q' && t[1] === root.id)).toBe(false)
    expect(e.tags.some((t) => t[0] === 'a' && t[1] === ADDRESS)).toBe(false)
  })
})

describe("a document's threads", () => {
  it('groups replies under their comment, keeps the block, reads the last resolution, and keeps a comment filed in another Folder', async () => {
    const onBlock = comment([['block', 'b1']], 'On the paragraph')
    const whole = comment([], 'On the page')
    // Reads go by anchor, never bounded by Folder (record a-thread-belongs-to-what-it-is-about).
    const elsewhere = comment([], 'Filed in another Folder', 'another-folder')
    const reply = event(1111, [['A', ADDRESS], ['K', '30842'], ['P', AUTHOR], ['e', onBlock.id], ['k', '1111'], ['h', FOLDER]], 'Cut it', ME)
    const resolvedThenReopened = [
      event(9101, [['h', FOLDER], ['e', whole.id], ['t', 'resolution'], ['action', 'resolved']]),
      event(9101, [['h', FOLDER], ['e', onBlock.id], ['t', 'resolution'], ['action', 'resolved']]),
      event(9101, [['h', FOLDER], ['e', onBlock.id], ['t', 'resolution'], ['action', 'reopened']]),
    ]
    relay.events = [onBlock, whole, elsewhere, reply, ...resolvedThenReopened]
    const { threads } = await readThreads(DOC)
    expect(threads.map((t) => [t.root?.body, t.blocks, t.replies.map((r) => r.body), t.resolved])).toEqual([
      ['On the paragraph', ['b1'], ['Cut it'], false],
      ['On the page', undefined, [], true],
      ['Filed in another Folder', undefined, [], false],
    ])
  })

  it('reads reactions on replies as on comments, and says how many of the oldest were past the horizon of 100', async () => {
    const root = comment([], 'Plan?')
    const replies = Array.from({ length: 100 }, (_, i) => event(1111, [['A', ADDRESS], ['K', '30842'], ['P', AUTHOR], ['e', root.id], ['k', '1111'], ['h', FOLDER]], `reply ${i}`))
    const onLast = event(7, [['e', replies[99].id]], '🎉', ME)
    relay.events = [root, ...replies, onLast]
    const { threads, reactionsOmitted } = await readThreads(DOC)
    expect(threads[0].replies[99].reactions.map((r) => [r.emoji, r.by])).toEqual([['🎉', ME]])
    // 101 comments: the oldest, the root, is the one not asked about.
    expect(reactionsOmitted).toBe(1)
  })

  it("shows a comment's latest edit, marked edited, and a reply's", async () => {
    const root = comment([['block', 'b1']], 'Too long?')
    const answer = reply(root, [], 'Cut it')
    relay.events = [
      root,
      answer,
      event(40003, [['h', FOLDER], ['e', root.id], ['ts', '1']], 'Far too long?'),
      event(40003, [['h', FOLDER], ['e', answer.id], ['ts', '2']], 'Cut it in half', ME),
    ]
    const { threads } = await readThreads(DOC)
    expect(threads.map((t) => [t.root?.body, t.root?.edited, t.blocks, t.replies.map((r) => [r.body, r.edited])])).toEqual([['Far too long?', true, ['b1'], [['Cut it in half', true]]]])
  })

  it("keeps a deleted comment's replies, without it, on the place they copied from it", async () => {
    const root = comment([['block', 'b1', 'b2'], ['quote', 'the plan']], 'Too long?')
    const first = reply(root, [['block', 'b1', 'b2'], ['quote', 'the plan']], 'Cut it')
    const second = reply(root, [], 'Agreed', 'c'.repeat(64))
    // The relay no longer returns the comment; its deletion by its author it does.
    relay.events = [first, second, event(5, [['e', root.id]], '', AUTHOR)]
    const { threads } = await readThreads(DOC)
    expect(threads.map((t) => [t.id, t.root, t.blocks, t.quote, t.replies.map((r) => r.body), t.resolved])).toEqual([
      [root.id, null, ['b1', 'b2'], { start: 'the plan' }, ['Cut it', 'Agreed'], false],
    ])
  })

  it('keeps a deleted comment whose replies copied no place, with no place', async () => {
    const root = comment([['block', 'b1']], 'Too long?')
    relay.events = [reply(root, [], 'Cut it'), event(5, [['e', root.id]], '', AUTHOR)]
    const { threads } = await readThreads(DOC)
    expect(threads.map((t) => [t.root, t.blocks, t.replies.map((r) => r.body)])).toEqual([[null, undefined, ['Cut it']]])
  })

  it('draws no card for replies whose comment is only out of the read, or "deleted" by someone else', async () => {
    const root = comment([['block', 'b1']], 'Too long?')
    relay.events = [reply(root, [['block', 'b1']], 'Cut it')]
    expect((await readThreads(DOC)).threads).toEqual([])
    relay.events = [reply(root, [['block', 'b1']], 'Cut it'), event(5, [['e', root.id]], '', 'c'.repeat(64))]
    expect((await readThreads(DOC)).threads).toEqual([])
  })

  it("resolves a thread filed in another Folder in that Folder, its comment's own", async () => {
    const elsewhere = comment([], 'x', 'another-folder')
    await setResolved(DOC, { id: elsewhere.id, root: itemOf(elsewhere), replies: [], resolved: false }, true)
    expect(sent().tags).toContainEqual(['h', 'another-folder'])
  })
})
