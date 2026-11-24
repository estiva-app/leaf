// @vitest-environment-options {"url": "https://leaf.estiva.app/document/launch-plan"}
/**
 * KIN-5 — where a file chosen in Leaf's ⌘K opens. A Ship file opens in Ship, at the address its app's manifest gives;
 * until WOR-2 any key can publish a manifest, so an address that is not Estiva's own Ship or Peek never takes the tab
 * away: the file opens in Leaf instead (security review). `readDocument` is the relay read of the file, tested with
 * `document/save`; here it hands back the file as the relay would, its manifest's address on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const read = vi.hoisted(() => ({ openUrl: '' }))
vi.mock('../document/save', async (original) => ({
  ...(await original<typeof import('../document/save')>()),
  readDocument: async () => ({ kind: 30851, address: `30851:${'b'.repeat(64)}:issue-1`, slots: {}, openUrl: read.openUrl }),
}))

const { openFile } = await import('./LeafLauncher')
const ISSUE = `30851:${'b'.repeat(64)}:issue-1`

const assign = vi.fn()
Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, origin: 'https://leaf.estiva.app', assign, pathname: '/document/launch-plan', search: '' } })
const pushState = vi.spyOn(window.history, 'pushState')
afterEach(() => {
  assign.mockClear()
  pushState.mockClear()
})

describe('a Ship file chosen in Leaf’s ⌘K', () => {
  it('opens in Estiva’s Ship, at the address its manifest gives', async () => {
    read.openUrl = 'https://ship.estiva.app/issue/abc'
    openFile(ISSUE, 'Billing entry')
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://ship.estiva.app/issue/abc'))
  })

  it('opens in Leaf, never at an address on another site that a planted manifest names', async () => {
    read.openUrl = 'https://evil.example/issue/abc'
    openFile(ISSUE, 'Billing entry')
    await vi.waitFor(() => expect(pushState).toHaveBeenCalled())
    expect(assign).not.toHaveBeenCalled()
  })
})
