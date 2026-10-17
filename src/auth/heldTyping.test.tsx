/**
 * What you were typing when your sign-in ended is still there after the passkey
 * tap, not yet saved (AUT-5, as Ship's AUT-4: "kept on the device through the
 * passkey trip and put back, unsaved, after the tap"). Before it, Leaf saved a
 * page on the way out, the save was refused, and "Your last changes … were not
 * saved" showed over the passkey screen.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SignRefused } from '@estiva-app/identity'
import type { FolderSummary } from '@estiva-app/interop'
import type { Editor } from '@tiptap/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config', () => ({
  ID_CONFIG: { base: 'https://id.estiva.app', clientId: 'estiva-leaf' },
  APP_TITLE: 'Leaf',
  RELAY_URL: 'https://estiva.estiva.app',
}))
vi.mock('../document/referencePicker', async (original) => ({ ...(await original()), subscribeReferences: () => () => {} }))

const KEY = 'leaf.estiva-id.token'
const PERSON = 'b3'.repeat(32)
const PAGE = 'document:30842:b3:plan'
const store = (pubkey = PERSON) =>
  localStorage.setItem(KEY, JSON.stringify({ accessToken: 'at', pubkey, expiresAt: Date.now() - 1_000, refreshToken: 'rt-1' }))
const refuse = () => vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) } as Response)

/* jsdom implements neither `getClientRects` nor `getBoundingClientRect` on text nodes, and ProseMirror calls them on every change. */
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects = rects
    proto.getBoundingClientRect = empty
  }
})

let stopFollowing = () => {}
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})
afterEach(() => {
  cleanup()
  stopFollowing()
  stopFollowing = () => {}
})

/** A fresh tab: every module evaluated anew, as a load after the passkey tap is. */
async function freshTab() {
  vi.resetModules()
  const id = await import('./estivaId')
  stopFollowing()
  stopFollowing = id.followOtherTabs()
  const { SessionGate } = await import('./SessionGate')
  const { LiveDocument } = await import('../document/LiveDocument')
  const { NewDocumentDialog } = await import('../folders/NewDocumentDialog')
  return { id, SessionGate, LiveDocument, NewDocumentDialog }
}

type EditorBox = HTMLElement & { editor: Editor }
const page = () => screen.getByRole('textbox', { name: 'Document' }) as EditorBox
const ready = async () => {
  await waitFor(() => expect(page().editor.isInitialized).toBe(true))
  return page()
}

describe("a page's text when the sign-in ends", () => {
  it('is not saved or reported lost, and is back after the tap, not yet saved', async () => {
    store()
    const tab = await freshTab()
    const onCommit = vi.fn(async () => false)
    const onLeftUnsaved = vi.fn()
    render(
      <tab.SessionGate>
        <tab.LiveDocument value="The plan" holdKey={PAGE} format="marker" changedBy={null} onCommit={onCommit} onLeftUnsaved={onLeftUnsaved} />
      </tab.SessionGate>,
    )
    const box = await ready()
    act(() => {
      box.editor.commands.focus('end')
      fireEvent.focus(box)
      box.editor.chain().insertContent(' is to ship on Friday').run()
    })
    refuse()
    await act(async () => void (await tab.id.renew()))
    expect(screen.getByRole('button', { name: 'Continue with passkey' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Document' })).toBeNull()
    await Promise.resolve()
    expect(onCommit).not.toHaveBeenCalled()
    expect(onLeftUnsaved).not.toHaveBeenCalled()

    // The tap: a new sign-in for the same person, and the page loads again.
    cleanup()
    store()
    const after = await freshTab()
    const saveAfter = vi.fn(async () => true)
    render(<after.LiveDocument value="The plan" holdKey={PAGE} format="marker" changedBy={null} onCommit={saveAfter} onLeftUnsaved={vi.fn()} />)
    expect((await ready()).editor.getText()).toBe('The plan is to ship on Friday')
    expect(saveAfter).not.toHaveBeenCalled()
  })

  it('is not given to somebody else who signs in next on this device', async () => {
    store()
    const tab = await freshTab()
    render(
      <tab.SessionGate>
        <tab.LiveDocument value="The plan" holdKey={PAGE} format="marker" changedBy={null} onCommit={vi.fn(async () => true)} onLeftUnsaved={vi.fn()} />
      </tab.SessionGate>,
    )
    const box = await ready()
    act(() => void box.editor.chain().focus('end').insertContent(' is secret').run())
    refuse()
    await act(async () => void (await tab.id.renew()))

    cleanup()
    store('c4'.repeat(32))
    const other = await freshTab()
    render(<other.LiveDocument value="The plan" holdKey={PAGE} format="marker" changedBy={null} onCommit={vi.fn(async () => true)} onLeftUnsaved={vi.fn()} />)
    expect((await ready()).editor.getText()).toBe('The plan')
  })
})

describe('New document when the sign-in ends', () => {
  const folders = [{ id: 'f1', name: 'Plans' }] as unknown as FolderSummary[]

  it('opens with its title and summary after the tap', async () => {
    store()
    const tab = await freshTab()
    render(
      <tab.SessionGate>
        <tab.NewDocumentDialog folders={folders} holdKey="new-document" onCreate={vi.fn(async () => true)} onClose={vi.fn()} />
      </tab.SessionGate>,
    )
    fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Launch notes' } })
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'What ships on Friday.' } })
    refuse()
    await act(async () => void (await tab.id.renew()))
    expect(screen.queryByLabelText('Document title')).toBeNull()

    cleanup()
    store()
    const after = await freshTab()
    render(<after.NewDocumentDialog folders={folders} holdKey="new-document" onCreate={vi.fn(async () => true)} onClose={vi.fn()} />)
    expect((screen.getByLabelText('Document title') as HTMLInputElement).value).toBe('Launch notes')
    expect((screen.getByLabelText('Summary') as HTMLTextAreaElement).value).toBe('What ships on Friday.')
  })
})

describe('a save Estiva ID will not sign', () => {
  it('says why, and not "Sign in again", while the sign-in lasts', async () => {
    store()
    const { signingFailure } = await import('../relay/bridge')
    expect(signingFailure(new SignRefused(422, 'Estiva ID refused to sign kind:7'))).toBe('Estiva ID would not sign this for Leaf.')
    expect(signingFailure(new TypeError('Failed to fetch'))).toBe('Leaf could not reach Estiva ID. Try again.')
  })

  it('says "Sign in again" once the sign-in has ended', async () => {
    store()
    const tab = await freshTab()
    refuse()
    await tab.id.renew()
    const { signingFailure } = await import('../relay/bridge')
    expect(signingFailure(new Error('no bearer'))).toBe('Your sign-in ended. Sign in again, then try again.')
  })
})
