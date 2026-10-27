import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import { deleteComment, editComment, postComment, postReply, readThreads, removeCard, setResolved, type CommentItem, type Thread } from './comments'

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
const itemOf = (e: SignedEvent): CommentItem => ({ id: e.id, by: e.pubkey, at: e.created_at, body: e.content, edited: false, files: [], cards: [], event: e, reactions: [] })

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

  it("is a reply in its comment's Folder when the comment was filed in another one than the document's", async () => {
    const elsewhere = '7c1f3e2a-9b4d-4e6f-8a2b-1c3d5e7f9a0b'
    const root = comment([], 'Filed elsewhere', elsewhere)
    await postReply(DOC, { id: root.id, root: itemOf(root), replies: [], resolved: false }, { text: 'Seen' })
    const e = sent()
    expect(e.tags.filter((t) => t[0] === 'h')).toEqual([['h', elsewhere]])
  })

  it("is a reply in the document's Folder when its comment carries no Folder", async () => {
    const root = event(1111, [['A', ADDRESS], ['K', '30842'], ['P', AUTHOR], ['a', ADDRESS], ['k', '30842'], ['p', AUTHOR]], 'No h')
    await postReply(DOC, { id: root.id, root: itemOf(root), replies: [], resolved: false }, { text: 'Seen' })
    expect(sent().tags.filter((t) => t[0] === 'h')).toEqual([['h', FOLDER]])
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
    // A comment with no files: an edit with no `imeta`.
    expect(e.tags.some((t) => t[0] === 'imeta')).toBe(false)
  })

  /* An edit is the whole new message (SPEC §6.8): one with no `imeta` takes every file off, so each edit lists what it keeps. */
  // With the fields another app writes (blurhash, fallback), which an edit must list back as they were read.
  const kept = { url: `/media/${'d'.repeat(64)}.png`, m: 'image/png', x: 'd'.repeat(64), size: 40, dim: '800x600', blurhash: 'LKO2?U%2Tw=w', fallback: ['https://a.example/shot.png'], filename: 'shot.png' }
  // Written out: a lossy encoder would pass a check built with `imetaTag`.
  const KEPT_TAG = ['imeta', `url /media/${'d'.repeat(64)}.png`, 'm image/png', `x ${'d'.repeat(64)}`, 'size 40', 'dim 800x600', 'blurhash LKO2?U%2Tw=w', 'fallback https://a.example/shot.png', 'filename shot.png']
  const imetaOfSent = () => sent().tags.filter((t) => t[0] === 'imeta')

  it('an edit of the words only still lists the files the comment has, every field as read', async () => {
    const root = comment([], 'Too long?')
    expect(await editComment({ ...itemOf(root), files: [kept] }, { text: 'Far too long?' })).toEqual({ ok: true })
    expect(sent().content).toBe('Far too long?')
    expect(imetaOfSent()).toEqual([KEPT_TAG])
  })

  it('an edit that takes every file off writes no imeta, not the files the comment had', async () => {
    const root = comment([], 'Too long?')
    expect(await editComment({ ...itemOf(root), files: [kept] }, { text: 'Too long?', files: [] })).toEqual({ ok: true })
    expect(imetaOfSent()).toEqual([])
  })

  it('✕ on a sent card still lists the files the comment has', async () => {
    const root = comment([], 'See it')
    expect(await removeCard({ ...itemOf(root), files: [kept], cards: [{ value: ADDRESS, layout: 'detailed' }] }, ADDRESS)).toEqual({ ok: true })
    expect(sent().tags).toContainEqual(['embed', ADDRESS, 'none'])
    expect(imetaOfSent()).toEqual([KEPT_TAG])
  })

  it('writes a file set an edit changed as the whole set, on the same kind:40003 (PEEKM-4)', async () => {
    const root = comment([['h', 'another-folder']], 'Too long?')
    const files = ['a', 'c'].map((c) => ({ url: `/media/${c.repeat(64)}.png`, m: 'image/png', x: c.repeat(64), size: 10 }))
    expect(await editComment(itemOf(root), { text: 'Too long?', files })).toEqual({ ok: true })
    const e = sent()
    expect(e.kind).toBe(40003)
    expect(e.tags.filter((t) => t[0] === 'imeta')).toEqual(
      ['a', 'c'].map((c) => ['imeta', `url /media/${c.repeat(64)}.png`, 'm image/png', `x ${c.repeat(64)}`, 'size 10']),
    )
  })

  it('deletes your comment with a kind:5 naming it', async () => {
    const root = comment([], 'x')
    await deleteComment(itemOf(root))
    expect(sent().kind).toBe(5)
    expect(sent().tags).toContainEqual(['e', root.id])
  })

  it('names each attached file by an imeta, on a comment and on a reply, as Ship and Peek write them (SPEC §6.8)', async () => {
    const png = { url: 'https://relay.test/abc.png', m: 'image/png', x: 'c'.repeat(64), size: 7909, filename: 'shot.png' }
    const pdf = { url: 'https://relay.test/def.pdf', m: 'application/pdf', x: 'd'.repeat(64), size: 193, filename: 'plan.pdf' }
    await postComment(DOC, { text: 'See these', files: [png, pdf] }, { blocks: ['b1'] })
    const imetas = sent().tags.filter((t) => t[0] === 'imeta')
    expect(imetas).toHaveLength(2)
    expect(imetas[0]).toEqual(expect.arrayContaining([`url ${png.url}`, 'm image/png', `x ${png.x}`, 'filename shot.png']))
    expect(imetas[1]).toEqual(expect.arrayContaining([`url ${pdf.url}`, 'm application/pdf', `x ${pdf.x}`]))
    const root = comment([], 'x')
    await postReply(DOC, { id: root.id, root: itemOf(root), replies: [], resolved: false }, { text: '', files: [pdf] })
    expect(sent().tags.filter((t) => t[0] === 'imeta')).toEqual([expect.arrayContaining([`url ${pdf.url}`])])
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

/* The tags a link earns, from the one link reader every app shares (PEEKM-7, record an-edit-says-what-the-message-links-now). */
describe('what a link in a comment tags', () => {
  const SHIP = 'f'.repeat(64)
  const D1 = '11111111-1111-4111-8111-111111111111'
  const D2 = '22222222-2222-4222-8222-222222222222'
  const D3 = '33333333-3333-4333-8333-333333333333'
  const ISSUE1 = `30851:${SHIP}:${D1}`
  const ISSUE2 = `30851:${SHIP}:${D2}`
  const ISSUE3 = `30851:${SHIP}:${D3}`
  const urlOf = (slug: string, d: string) => `https://ship.estiva.app/issue/${slug}-${d}`
  // Ship's manifest, as it publishes it: what makes its URL name an issue (§7.7).
  const manifest = event(31990, [['d', 'ship'], ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'], ['urls', 'https://ship.estiva.app/issue/<slug>-<d>', '30851'], ['urls', 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>', '30851']], '', SHIP)
  const issue = (d: string) => event(30851, [['d', d]], '', SHIP)
  const QA2 = 'c'.repeat(64)
  const named = (name: string) => sent().tags.filter((t) => t[0] === name)

  beforeEach(() => {
    vi.useFakeTimers()
    relay.events = [manifest, issue(D1), issue(D2), issue(D3)]
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // A top-level comment's first `a` is its page, NIP-22's scope; every other is a mention.
  const PAGE_A = ['a', ADDRESS]

  it('a Ship issue linked by its URL earns its a, so the comment lists under the issue’s Mentioned in', async () => {
    await postComment(DOC, { text: `see ${urlOf('fix-it', D1)}` })
    expect(named('a')).toEqual([PAGE_A, ['a', ISSUE1]])
  })

  it('a URL in a code span, and an http:// link, earn nothing', async () => {
    await postComment(DOC, { text: `run \`${urlOf('fix-it', D1)}\` and see http://ship.estiva.app/issue/fix-it-${D2}` })
    expect(named('a')).toEqual([PAGE_A])
  })

  it('[A](B) is one link to B: B earns its a, A nothing', async () => {
    await postComment(DOC, { text: `see [${urlOf('first', D1)}](${urlOf('second', D2)})` })
    expect(named('a')).toEqual([PAGE_A, ['a', ISSUE2]])
  })

  it('a reply linking a block of an issue earns its a and its part, beside the person it mentions', async () => {
    const root = comment([], 'Too long?')
    const thread: Thread = { id: root.id, root: itemOf(root), replies: [], resolved: false }
    await postReply(DOC, thread, { text: `nostr:${encodeNpub(QA2)} see ${urlOf('fix-it', D3)}#block-b7` })
    expect(sent().tags).toEqual(expect.arrayContaining([['p', QA2], ['a', ISSUE3], ['part', ISSUE3, 'b7']]))
  })

  it('an edit carries the a and q its new words earn, and no p, urgent or part', async () => {
    const root = comment([], 'Too long?')
    const other = 'e'.repeat(64)
    const text = `!nostr:${encodeNpub(QA2)} see ${urlOf('fix-it', D1)}, ${urlOf('block', D3)}#block-b7 and ${messageReference(other, 1111)}`
    expect(await editComment(itemOf(root), { text, urgent: [QA2] })).toEqual({ ok: true })
    const e = sent()
    expect(e.kind).toBe(40003)
    expect(named('a')).toEqual([['a', ISSUE1], ['a', ISSUE3]])
    expect(named('q')).toEqual([['q', other]])
    expect(e.tags.some((t) => ['p', 'urgent', 'part'].includes(t[0]))).toBe(false)
  })

  it('an edit of a reply never names the page it is on by a, nor the comment it answers by q', async () => {
    const root = comment([], 'Too long?')
    const answer = reply(root, [], 'Cut it')
    expect(await editComment(itemOf(answer), { text: `${fileReference(ADDRESS)} ${messageReference(root.id, 1111)} and ${fileReference(ISSUE2)}` })).toEqual({ ok: true })
    expect(named('a')).toEqual([['a', ISSUE2]])
    expect(named('q')).toEqual([])
  })

  it('✕ on a card keeps the a the words still earn', async () => {
    const root = comment([], `see ${urlOf('fix-it', D1)}`)
    expect(await removeCard({ ...itemOf(root), cards: [{ value: ISSUE1, layout: 'detailed' }] }, ISSUE1)).toEqual({ ok: true })
    expect(named('embed')).toEqual([['embed', ISSUE1, 'none']])
    expect(named('a')).toEqual([['a', ISSUE1]])
  })

  it('an edit that adds a card carries the whole card set it is given', async () => {
    const root = comment([['embed', ISSUE2, 'detailed']], `see ${fileReference(ISSUE2)}`)
    const cards = [{ value: ISSUE2, layout: 'detailed' as const }, { value: ISSUE1, layout: 'detailed' as const }]
    expect(await editComment({ ...itemOf(root), cards: [cards[0]] }, { text: `see ${urlOf('fix-it', D1)}`, cards })).toEqual({ ok: true })
    expect(named('embed')).toEqual([['embed', ISSUE2, 'detailed'], ['embed', ISSUE1, 'detailed']])
  })
})

describe("a document's threads", () => {
  it('groups replies under their comment, keeps the block, reads the last resolution, and keeps a comment filed in another Folder', async () => {
    const onBlock = comment([['block', 'b1']], 'On the paragraph')
    const whole = comment([], 'On the page')
    // Reads go by anchor, never bounded by Folder (record what-belongs-to-a-file-is-stored-with-it).
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

  it("reads a comment's files from its imeta, and an edit's set replaces them (SPEC §6.8)", async () => {
    const imeta = (name: string) => ['imeta', `url https://relay.test/${name}`, 'm image/png', `x ${name[0].repeat(64)}`, 'size 7909', `filename ${name}`]
    const root = comment([imeta('a.png'), imeta('b.png')], 'Two shots')
    const answer = reply(root, [imeta('c.png')], 'And one')
    relay.events = [root, answer, event(40003, [['h', FOLDER], ['e', answer.id], ['ts', '1'], imeta('d.png')], 'And one', ME)]
    const { threads } = await readThreads(DOC)
    expect(threads[0].root?.files?.map((f) => f.filename)).toEqual(['a.png', 'b.png'])
    expect(threads[0].replies[0].files?.map((f) => f.filename)).toEqual(['d.png'])
  })

  it('reads a comment whose edit lists no files as having none (SPEC §6.8)', async () => {
    const imeta = (name: string) => ['imeta', `url https://relay.test/${name}`, 'm image/png', `x ${name[0].repeat(64)}`, 'size 7909', `filename ${name}`]
    const root = comment([imeta('a.png')], 'One shot')
    relay.events = [root, event(40003, [['h', FOLDER], ['e', root.id], ['ts', '1']], 'One shot', ME)]
    const { threads } = await readThreads(DOC)
    expect(threads[0].root?.files).toEqual([])
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

  it('does not mark a comment edited when its edit saved the same words', async () => {
    const root = comment([['block', 'b1']], 'Too long?')
    relay.events = [root, event(40003, [['h', FOLDER], ['e', root.id], ['ts', '1']], 'Too long?')]
    const { threads } = await readThreads(DOC)
    expect(threads.map((t) => [t.root?.body, t.root?.edited])).toEqual([['Too long?', false]])
  })

  it('keeps a resolved thread resolved when its comment is deleted', async () => {
    const root = comment([['block', 'b1']], 'Too long?')
    relay.events = [
      reply(root, [['block', 'b1']], 'Cut it'),
      event(9101, [['h', FOLDER], ['e', root.id], ['t', 'resolution'], ['action', 'resolved']]),
      event(5, [['e', root.id]], '', AUTHOR),
    ]
    const { threads } = await readThreads(DOC)
    expect(threads.map((t) => [t.root, t.blocks, t.resolved])).toEqual([[null, ['b1'], true]])
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
