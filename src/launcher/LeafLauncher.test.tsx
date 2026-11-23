/**
 * KIN-5 — Leaf's ⌘K on an open page, as the frame mounts it: Ctrl+K opens the box, a sentence asks the browser's
 * model about the page (its text and every comment, resolved ones marked), and the answer becomes a comment draft
 * or a block in the page (Miky, KIN-5 kickoff). The box's own behaviour is `@estiva-app/launcher`'s and tested there.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { blockIds, descriptionTextToBlockDocument, serializeBlockDocument, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { AppShell, ToastProvider } from '@estiva-app/ui'
import { useKeptLauncher } from '@estiva-app/launcher'

const ME = 'a'.repeat(64)
const publish = vi.hoisted(() => vi.fn<(event: UnsignedEvent) => Promise<{ ok: boolean }>>(async () => ({ ok: true })))
const relay = vi.hoisted(() => ({ events: [] as SignedEvent[] }))
const matches = (e: SignedEvent, f: Record<string, unknown>) =>
  (!f.kinds || (f.kinds as number[]).includes(e.kind)) &&
  Object.entries(f).every(([k, v]) => !k.startsWith('#') || e.tags.some((t) => t[0] === k.slice(1) && (v as string[]).includes(t[1])))
vi.mock('../relay/client', () => ({ relayClient: () => ({ watchFolders: () => ({ stop: () => {} }) }) }))
vi.mock('../relay/bridge', () => ({
  query: vi.fn(async (filters: Record<string, unknown>[]) => relay.events.filter((e) => filters.some((f) => matches(e, f)))),
  queryWithMatches: vi.fn(async () => ({ events: [], matches: {} })),
  publish,
  viewerPubkey: () => ME,
}))

import { FilePage } from '../pages/FilePage'
import { LeafLauncher } from './LeafLauncher'
import { captureOpenPage } from './openPage'

/*
  The browser's on-device model (Chrome's Prompt API), as `onDeviceModel` finds it: ready, and answering with what
  the test says. The instruction it was given is kept, so a test reads what the model was told about the page.
*/
const model = vi.hoisted(() => ({ answer: '', told: [] as string[] }))
beforeAll(() => {
  const session = {
    prompt: async (instruction: string) => {
      model.told.push(instruction)
      return model.answer
    },
    destroy: () => {},
  }
  Object.defineProperty(globalThis, 'LanguageModel', {
    configurable: true,
    value: { availability: async () => 'available', create: async () => session, params: async () => ({}) },
  })
  /* jsdom implements neither `getClientRects` nor `getBoundingClientRect` on text nodes, and ProseMirror calls them on every change. */
  Element.prototype.scrollIntoView = () => {}
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects = rects
    proto.getBoundingClientRect = empty
  }
})
afterEach(() => {
  cleanup()
  publish.mockClear()
  model.told = []
  localStorage.clear()
})

const FOLDER = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const RAVI = 'b'.repeat(64)
const KATERINA = 'c'.repeat(64)
const ADDRESS = `30842:${ME}:11111111-1111-4111-8111-111111111111`
const BODY = descriptionTextToBlockDocument('# Launch plan\n\nLaunch date: to be confirmed.\n\nThe FAQ ships with the launch.')
const [, DATE, FAQ] = blockIds(BODY)

let n = 0
const comment = (by: string, tags: string[][], content: string): SignedEvent => {
  n += 1
  const tagged = [['A', ADDRESS], ['K', '30842'], ['P', ME], ['a', ADDRESS], ['k', '30842'], ['p', ME], ...tags, ['h', FOLDER]]
  return { id: n.toString(16).padStart(64, '0'), pubkey: by, created_at: 1_760_000_000 + n, kind: 1111, tags: tagged, content, sig: '' }
}
const profile = (pubkey: string, name: string): SignedEvent => ({ id: `${pubkey.slice(0, 63)}1`, pubkey, created_at: 1_760_000_000, kind: 0, tags: [], content: JSON.stringify({ name }), sig: '' })
const resolution = (target: SignedEvent): SignedEvent => ({ id: 'e'.repeat(64), pubkey: KATERINA, created_at: 1_760_000_200, kind: 9101, tags: [['h', FOLDER], ['e', target.id], ['t', 'resolution'], ['action', 'resolved']], content: '', sig: '' })

const ON_FAQ = comment(RAVI, [['block', FAQ]], 'Who writes the FAQ?')
const MOVED = comment(KATERINA, [], 'The launch date moved to Friday.')
const page = { kind: 30842, eventId: 'e', widget: 'card', meta: [], actions: [], address: ADDRESS, folder: FOLDER, slots: { title: { value: 'Launch plan' }, [BODY_SLOT]: { value: serializeBlockDocument(BODY), format: 'blocks' } } } as unknown as ForeignObject

/** The page in Leaf's frame, whose search and Ctrl+K open the box, as App holds them. */
function Frame() {
  const kept = useKeptLauncher(captureOpenPage, (box) => <LeafLauncher {...box} />)
  return (
    <ToastProvider>
      <AppShell nav={null} onSearch={kept.toggle} searchPlaceholder="Search Leaf...">
        <FilePage file={page} loading={false} />
      </AppShell>
      {kept.launcher}
    </ToastProvider>
  )
}

type EditorBox = HTMLElement & { editor: Editor }
const editor = () => (screen.getByRole('textbox', { name: 'Document' }) as EditorBox).editor
const field = () => document.querySelector<HTMLTextAreaElement | HTMLInputElement>('[data-command-palette-field]')
const option = (title: string) => screen.queryAllByRole('option').find((o) => o.textContent?.includes(title))

/** Open the page with its two comments read, press Ctrl+K, and ask; resolves once the answer's actions show. */
async function ask(sentence: string, answer: string) {
  relay.events = [profile(RAVI, 'Ravi Mehta'), profile(KATERINA, 'Katerina Novak'), ON_FAQ, MOVED, resolution(MOVED)]
  model.answer = answer
  render(<Frame />)
  await waitFor(() => expect(editor()?.isInitialized).toBe(true))
  await screen.findByText('Who writes the FAQ?')
  await waitFor(() => expect(document.body.textContent).toContain('Katerina Novak'))
  act(() => void fireEvent.keyDown(document, { key: 'k', ctrlKey: true }))
  await waitFor(() => expect(field()).toBeTruthy())
  fireEvent.change(field()!, { target: { value: sentence } })
  fireEvent.keyDown(field()!, { key: 'Enter' })
  await waitFor(() => expect(option('Insert into the page')).toBeTruthy())
}

describe("Leaf's ⌘K about the open page (KIN-5)", () => {
  it('tells the model the page by its title, its text, and every comment on it with who wrote it, the resolved one marked', async () => {
    await ask('what is still open on this page', 'The launch date is not confirmed [1].')

    expect(model.told).toHaveLength(1)
    const told = model.told[0]
    expect(told).toContain('page called "Launch plan"')
    expect(told).toContain('Launch date: to be confirmed.')
    expect(told).toContain('The FAQ ships with the launch.')
    expect(told).toContain('Comment by Ravi Mehta: Who writes the FAQ?')
    expect(told).toContain('Comment by Katerina Novak (resolved): The launch date moved to Friday.')
  })

  it('Insert into the page puts the answer under the passage it cites first, as a block the page saves', async () => {
    await ask('what is still open on this page', 'The launch date is not confirmed [2].')

    fireEvent.click(option('Insert into the page')!)

    await waitFor(() => expect(field()).toBeNull())
    const texts: string[] = []
    editor().state.doc.forEach((node) => void texts.push(node.textContent))
    expect(texts).toEqual(['Launch plan', 'Launch date: to be confirmed.', 'The launch date is not confirmed.', 'The FAQ ships with the launch.'])
    expect(texts.indexOf('The launch date is not confirmed.')).toBe(blockIds(BODY).indexOf(DATE) + 1)
  })

  it('Draft a comment puts the answer in a new comment on the block it cites, unsent', async () => {
    // [1]–[3] are the page's passages, [4] Ravi's comment on the FAQ paragraph: the draft goes on that paragraph.
    await ask('who asked about the FAQ', 'Ravi asked who writes it [4].')
    expect(model.told[0]).toContain('[4] Comment by Ravi Mehta: Who writes the FAQ?')

    fireEvent.click(option('Draft a comment')!)

    await waitFor(() => expect(screen.getByRole('textbox', { name: /comment/i }).textContent).toContain('Ravi asked who writes it.'))
    // The page marks the paragraph the draft is on, as it does for a comment you start from a block's handle.
    expect(editor().view.dom.querySelector('[data-comment-id="draft"]')?.textContent).toBe('The FAQ ships with the launch.')
    expect(publish.mock.calls.filter(([event]) => event.kind === 1111)).toHaveLength(0)
  })
})
