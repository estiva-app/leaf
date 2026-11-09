/**
 * Where a sent comment's app URL draws (LTX-6): as its file's chip only once
 * that file has been read and can be, and as the URL it was written as until
 * then or for good, as Ship reads one (OPT-18).
 */
import { toRenderTree } from '@estiva-app/protocol'
import { describe, expect, it } from 'vitest'
import { placeComment, referenceOfValue } from './commentBody'

const ISSUE = `30851:${'e'.repeat(64)}:22222222-2222-4222-8222-222222222222`
const URL = 'https://leaf.example/issue/fix-it-22222222-2222-4222-8222-222222222222'
const resolveLink = (url: string) => (url === URL ? ISSUE : undefined)
const runs = (readable: boolean) =>
  placeComment(toRenderTree(`see ${URL} now`, 'marker'), { tags: [] }, { resolveLink, readable: () => readable }).blocks[0].inline!.map((r) => ({ text: r.text, reference: r.reference }))

describe('an app URL in a sent comment', () => {
  it('is its file’s reference once the file is read, the run keeping the URL as written', () => {
    expect(runs(true)).toContainEqual({ text: URL, reference: referenceOfValue(ISSUE) })
  })

  it('alone on its line is its file’s row, but the page the comment is on stays its chip, as Ship keeps it', () => {
    const lone = (here?: string) => placeComment(toRenderTree(`see\n${URL}`, 'marker'), { tags: [] }, { here, resolveLink, readable: () => true })
    const elsewhere = lone()
    expect(elsewhere.rowOf(elsewhere.blocks[1])).toMatchObject({ reference: referenceOfValue(ISSUE), url: URL })
    const onIt = lone(ISSUE)
    expect(onIt.blocks.some((b) => onIt.rowOf(b))).toBe(false)
    expect(onIt.blocks[0].inline!.some((r) => r.reference === referenceOfValue(ISSUE))).toBe(true)
  })

  it('stays the URL as written for an http link, which its chip could not open as written', () => {
    const http = URL.replace('https:', 'http:')
    const placed = placeComment(toRenderTree(`see ${http} now`, 'marker'), { tags: [] }, { resolveLink: (u) => (u === http ? ISSUE : undefined), readable: () => true })
    expect(placed.blocks[0].inline!.some((r) => r.reference)).toBe(false)
  })

  it('stays the URL as written while its file is unread or cannot be read', () => {
    expect(runs(false).some((r) => r.reference)).toBe(false)
    expect(runs(false).map((r) => r.text).join('')).toBe(`see ${URL} now`)
  })
})

// ONE-11 (Miky, 2026-11-09): Ship ended every issue comment with a line linking its own issue, which Leaf drew.
describe('a comment’s line that only links the file it is on', () => {
  const NADDR = referenceOfValue(ISSUE)!
  const onIssue = { tags: [['A', ISSUE], ['K', '30851']] }
  const text = (placed: ReturnType<typeof placeComment>) => placed.blocks.map((b) => (placed.rowOf(b) ? 'row' : b.inline?.map((r) => r.text).join('')))

  it('draws nothing, as a nostr: link or as an app URL', () => {
    expect(text(placeComment(toRenderTree(`Looks right.\n\n${NADDR}`, 'marker'), onIssue, { here: ISSUE, resolveLink, readable: () => true }))).toEqual(['Looks right.'])
    expect(text(placeComment(toRenderTree(`Looks right.\n${URL}`, 'marker'), onIssue, { here: ISSUE, resolveLink, readable: () => true }))).toEqual(['Looks right.'])
  })

  it('is still a row on a comment on another file', () => {
    const elsewhere = { tags: [['A', `30851:${'e'.repeat(64)}:another-issue`]] }
    expect(text(placeComment(toRenderTree(`Looks right.\n\n${NADDR}`, 'marker'), elsewhere, { resolveLink, readable: () => true }))).toEqual(['Looks right.', 'row'])
  })
})
