/**
 * Where sign-in may send a tab back to: only Leaf's own paths. The stored
 * `returnTo` is the one thing between a sign-in and an open redirect.
 */
import { describe, expect, it } from 'vitest'
import { documentPath, newDocumentFolderOf, newDocumentPath, ownPath, pagePath, routeOf } from './route'

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

describe("another app's path on Leaf's host", () => {
  const D = 'a1b2c3d4-0000-4000-8000-00000000000a'

  it('is a file page for the word the manifests will name, not Home', () => {
    expect(routeOf(`/issue/plan-the-launch-${D}`)).toEqual({ page: 'path', word: 'issue', ref: `plan-the-launch-${D}` })
    expect(routeOf(`/project/${D}/`)).toEqual({ page: 'path', word: 'project', ref: D })
  })

  it("is Leaf's own topic page for a topic's path, read by its d whatever the slug (LTN-3)", () => {
    expect(routeOf(`/topic/launch-chat-${D}`)).toEqual({ page: 'topic', d: D })
    expect(routeOf(`/topic/${D}/`)).toEqual({ page: 'topic', d: D })
  })

  it("never takes Leaf's own pages for another app's word", () => {
    expect(routeOf('/document/no-identity')).toEqual({ page: 'home' })
    expect(routeOf(`/app/${D}`)).toEqual({ page: 'home' })
    expect(routeOf('/new')).toEqual({ page: 'home' })
  })
})

describe("a document's link", () => {
  const D = 'a1b2c3d4-0000-4000-8000-00000000000a'

  it('opens the document its d names, whatever the slug says after a rename', () => {
    expect(routeOf(documentPath(D, 'Plan for Friday'))).toEqual({ page: 'document', d: D })
    expect(documentPath(D, 'Plan for Friday')).toBe(`/document/plan-for-friday-${D}`)
    expect(routeOf(`/document/an-old-title-${D}`)).toEqual({ page: 'document', d: D })
    expect(routeOf(`/document/${D}`)).toEqual({ page: 'document', d: D })
  })

  it('still opens a file by its old /f/ link, and a path with no d is Home', () => {
    expect(routeOf('/f/naddr1xyz')).toEqual({ page: 'file', naddr: 'naddr1xyz' })
    expect(routeOf('/document/plan')).toEqual({ page: 'home' })
    expect(routeOf('/document/%E0%A4%A')).toEqual({ page: 'home' })
  })

  it("opens a document at its own link and another app's file at its naddr", () => {
    expect(pagePath({ kind: 30842, address: `30842:${'a'.repeat(64)}:${D}`, naddr: 'naddr1d', title: 'Plan' })).toBe(`/document/plan-${D}`)
    expect(pagePath({ kind: 30851, address: `30851:${'a'.repeat(64)}:${D}`, naddr: 'naddr1i', title: 'Bug' })).toBe('/f/naddr1i')
  })
})

describe('the New document link', () => {
  it('is the link the app tests open, and names the Folder it was written for, whatever the id holds', () => {
    expect(newDocumentPath('a78e60b1')).toBe('/new?folder=a78e60b1')
    const url = new URL(newDocumentPath('a78e60b1 &x=1'), 'https://leaf.example')
    expect(newDocumentFolderOf(url.pathname, url.search)).toBe('a78e60b1 &x=1')
  })
})
