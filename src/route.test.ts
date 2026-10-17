/**
 * Where sign-in may send a tab back to: only Leaf's own paths. The stored
 * `returnTo` is the one thing between a sign-in and an open redirect.
 */
import { describe, expect, it } from 'vitest'
import { newDocumentFolderOf, newDocumentPath, ownPath } from './route'

describe('ownPath, the place sign-in returns to', () => {
  it('keeps a path of Leaf’s own, query and all', () => {
    expect(ownPath('/new?folder=a78e60b1')).toBe('/new?folder=a78e60b1')
    expect(ownPath('/f/naddr1xyz')).toBe('/f/naddr1xyz')
  })

  it.each([
    ['a protocol-relative URL', '//elsewhere.example/f/x'],
    ['a backslash the parser reads as a slash', '/\\elsewhere.example'],
    ['a tab the parser drops', '/\t/elsewhere.example'],
    ['a newline the parser drops', '/\n/elsewhere.example'],
    ['another origin', 'https://elsewhere.example/'],
    ['a script', 'javascript:alert(1)'],
    ['nothing', ''],
  ])('refuses %s', (_, returnTo) => {
    expect(ownPath(returnTo)).toBeNull()
  })
})

describe('the New document link', () => {
  it('names the Folder it was written for, whatever the id holds', () => {
    const url = new URL(newDocumentPath('a78e60b1 &x=1'), 'https://leaf.example')
    expect(newDocumentFolderOf(url.pathname, url.search)).toBe('a78e60b1 &x=1')
  })
})
