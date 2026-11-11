import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { fileContext, parseReadStateBlob, threadContext } from '@estiva-app/conversation'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'

/*
  A topic's conversation in Leaf's comments column (the topic page's), as Ship's topic page has it: Ship's words, the
  same comment on the wire, and reading it marks it read in every app — its conversations while the column is shown, a
  thread's replies only once that thread is open (record a-reply-is-read-only-when-its-thread-is-opened).
*/

const ME = 'a'.repeat(64)
const MIKY = 'b'.repeat(64)
const TEAM = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const TOPIC = `30840:${MIKY}:11111111-1111-4111-8111-111111111111`

const relay = vi.hoisted(() => ({ events: [] as SignedEvent[], published: [] as UnsignedEvent[], signed: [] as UnsignedEvent[] }))
const matches = (e: SignedEvent, f: Record<string, unknown>) =>
  (!f.kinds || (f.kinds as number[]).includes(e.kind)) &&
  (!f.authors || (f.authors as string[]).includes(e.pubkey)) &&
  Object.entries(f).every(([k, v]) => !k.startsWith('#') || e.tags.some((t) => t[0] === k.slice(1) && (v as string[]).includes(t[1])))
vi.mock('../relay/client', () => ({ relayClient: () => null }))
vi.mock('../relay/bridge', () => ({
  query: async (filters: Record<string, unknown>[]) => relay.events.filter((e) => filters.some((f) => matches(e, f))),
  publish: async (event: UnsignedEvent) => {
    relay.published.push(event)
    return { ok: true }
  },
  // The read state's write: signed and published apart, as interop's writes are.
  changeWriter: {
    sign: async (event: UnsignedEvent) => {
      relay.signed.push(event)
      return { ...event, id: 'f'.repeat(64), sig: '' }
    },
    publish: async (event: SignedEvent) => ({ ok: true, eventId: event.id }),
  },
  viewerPubkey: () => ME,
  relaySigner: () => null,
}))
// Self-encryption, stood in for: Estiva ID's `/nip44/*` is `nip44.test.ts`'s contract. Here the blob is read back as written.
vi.mock('../auth/nip44', () => ({ nip44: { encrypt: async (text: string) => `enc:${text}`, decrypt: async (text: string) => text.slice(4) } }))

const { CommentsColumn } = await import('./CommentsColumn')
const { resetReadStateForTests, READ_DWELL_MS, PUBLISH_DEBOUNCE_MS } = await import('../relay/readState')

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects = rects
    proto.getBoundingClientRect = empty
  }
})
beforeEach(() => {
  relay.events = []
  relay.published = []
  relay.signed = []
  resetReadStateForTests()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

let n = 0
/** A comment in the topic's conversation (NIP-22, the topic as its root), in its team, `at` seconds. */
const said = (content: string, at: number, by = MIKY): SignedEvent => {
  n += 1
  return { id: n.toString(16).padStart(64, '0'), pubkey: by, created_at: at, kind: 1111, tags: [['A', TOPIC], ['K', '30840'], ['P', MIKY], ['a', TOPIC], ['k', '30840'], ['p', MIKY], ['h', TEAM]], content, sig: '' }
}
/** A reply under `root`, in its team. */
const reply = (root: SignedEvent, content: string, at: number): SignedEvent => {
  n += 1
  return { id: n.toString(16).padStart(64, '0'), pubkey: MIKY, created_at: at, kind: 1111, tags: [['A', TOPIC], ['K', '30840'], ['P', MIKY], ['e', root.id, '', MIKY], ['k', '1111'], ['p', MIKY], ['h', TEAM]], content, sig: '' }
}

function column(hidden = false) {
  return render(
    <ToastProvider>
      <CommentsColumn doc={{ address: TOPIC, folder: TEAM }} addressable={false} editor={null} docBody={{ current: null }} draft={null} onDraft={() => {}} hidden={hidden} topic />
    </ToastProvider>,
  )
}

type EditorBox = HTMLElement & { editor: Editor }
const box = (name: string) => screen.getByRole('textbox', { name }) as EditorBox
const item = (id: string) => document.querySelector<HTMLElement>(`[data-conversation-item="${id}"]`)

/** The contexts of the last read-state blob Leaf signed, as Peek and Ship read it back. */
function lastMarks(): Record<string, number> | undefined {
  const blob = relay.signed.filter((e) => e.kind === 30078).at(-1)
  return blob ? parseReadStateBlob(blob.content.slice(4))?.contexts : undefined
}
/** Let the dwell and the publish's debounce pass, and the publish settle. */
const pass = () => act(() => vi.advanceTimersByTimeAsync(READ_DWELL_MS + PUBLISH_DEBOUNCE_MS + 10))

describe("a topic's conversation in Leaf", () => {
  it("says it in Ship's words, not a document's", async () => {
    column()
    expect(await screen.findByText('No conversations yet.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Start a conversation…' })).toBeTruthy()
    expect(screen.queryByText(/Comment on this document/)).toBeNull()
  })

  it('starts a conversation as the comment Ship writes for a topic: about the topic, in its team, and nothing else', async () => {
    column()
    await screen.findByText('No conversations yet.')
    act(() => void box('Start a conversation…').editor.chain().focus().insertContent('Shall we ship Friday?').run())
    act(() => void fireEvent.keyDown(box('Start a conversation…'), { key: 'Enter' }))
    await waitFor(() => expect(relay.published).toHaveLength(1))
    const [sent] = relay.published
    expect(sent.kind).toBe(1111)
    expect(sent.content).toBe('Shall we ship Friday?')
    expect(sent.tags).toEqual(expect.arrayContaining([['A', TOPIC], ['K', '30840'], ['h', TEAM]]))
    // Writing in a topic never makes you a member of it, nor follows it (record writing-in-a-place-never-follows-it).
    expect(relay.published.some((e) => e.kind !== 1111)).toBe(false)
  })

  it("marks the topic's conversations read up to the newest one once it has been on screen, and a thread's replies only once that thread is open", async () => {
    const first = said('Kickoff notes', 1_790_000_000)
    const newest = said('Friday works', 1_790_000_100)
    relay.events = [first, newest, reply(first, 'Agreed', 1_790_000_200)]
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    column()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(item(first.id)).not.toBeNull()
    // Glanced past is not read.
    await act(() => vi.advanceTimersByTimeAsync(READ_DWELL_MS - 100))
    expect(lastMarks()).toBeUndefined()
    await pass()
    expect(lastMarks()).toEqual({ [fileContext(TOPIC)!]: 1_790_000_100 })
    // Its reply is read only by opening its thread, as in Peek and Ship.
    act(() => void fireEvent.click(within(item(first.id)!).getByRole('button', { name: /^1 reply, open the thread$/ })))
    await pass()
    expect(lastMarks()).toEqual({ [fileContext(TOPIC)!]: 1_790_000_100, [threadContext(first.id)!]: 1_790_000_200 })
  })

  it('marks nothing while the column is hidden: a conversation not shown is not read', async () => {
    const only = said('Kickoff notes', 1_790_000_000)
    relay.events = [only]
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    column(true)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(item(only.id)).not.toBeNull()
    await pass()
    expect(relay.signed.filter((e) => e.kind === 30078)).toEqual([])
  })
})
