import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'

/**
 * Draws a page once and takes it down again, before any test's clock starts. Call it at the top
 * level of a test file, after the mocks and the file's own imports, with what its first test draws.
 *
 * The first time a page is drawn in a test file, React, the editor and the kit's parts all run for
 * the first time: three to ten times slower than every later draw, and seconds on a busy machine.
 * That landed inside whichever test came first and ran it out of its 5 s, though nothing it checks
 * was slow.
 *
 * `load` imports the page and returns it drawn-ready. It is called after `vi.resetModules()`, so it
 * gets its own copy of the app's modules, and that copy is dropped again afterwards: nothing this
 * draw read or remembered (an address, a page's text, a key) is there for the tests, whose own
 * imports were loaded before and are never drawn here. The first test still opens everything cold.
 *
 * `drawn` throws until the page is there (`() => screen.getByText('…')`). A page that never draws is
 * given up on after a minute and nothing is reported here: the first test draws it itself and fails
 * with its own message.
 */
export async function drawOnce(load: () => Promise<ReactElement>, drawn: () => unknown): Promise<void> {
  const restoreLayout = stubLayout()
  vi.resetModules()
  try {
    render(await load())
    await waitFor(() => void drawn(), { timeout: 60_000 })
  } catch {
    // The first test says what is wrong.
  } finally {
    cleanup()
    vi.resetModules()
    restoreLayout()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  }
}

/** jsdom lays nothing out, and the editor asks where things are on every change: answer with nothing, for this draw only. */
function stubLayout(): () => void {
  const undo: Array<() => void> = []
  const set = (proto: object, key: string, value: unknown) => {
    const had = Object.getOwnPropertyDescriptor(proto, key)
    Object.defineProperty(proto, key, { value, configurable: true, writable: true })
    undo.push(() => {
      if (had) Object.defineProperty(proto, key, had)
      else delete (proto as Record<string, unknown>)[key]
    })
  }
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} })
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
  set(Element.prototype, 'scrollIntoView', () => {})
  for (const proto of [Element.prototype, Range.prototype]) {
    set(proto, 'getClientRects', rects)
    set(proto, 'getBoundingClientRect', empty)
  }
  return () => undo.reverse().forEach((restore) => restore())
}
