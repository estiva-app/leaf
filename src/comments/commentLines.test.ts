/**
 * Where a sent comment's app URL draws (LTX-6): as its file's chip only once
 * that file has been read and can be, and as the URL it was written as until
 * then or for good, as Ship reads one (OPT-18).
 */
import { toRenderTree } from '@estiva-app/protocol'
import { describe, expect, it } from 'vitest'
import { placeComment, referenceOfValue } from './commentLines'

const ISSUE = `30851:${'e'.repeat(64)}:22222222-2222-4222-8222-222222222222`
const URL = 'https://leaf.example/issue/fix-it-22222222-2222-4222-8222-222222222222'
const resolveLink = (url: string) => (url === URL ? ISSUE : undefined)
const runs = (readable: boolean) =>
  placeComment(toRenderTree(`see ${URL} now`, 'marker'), { tags: [] }, { resolveLink, readable: () => readable }).blocks[0].inline!.map((r) => ({ text: r.text, reference: r.reference }))

describe('an app URL in a sent comment', () => {
  it('is its file’s reference once the file is read, the run keeping the URL as written', () => {
    expect(runs(true)).toContainEqual({ text: URL, reference: referenceOfValue(ISSUE) })
  })

  it('stays the URL as written while its file is unread or cannot be read', () => {
    expect(runs(false).some((r) => r.reference)).toBe(false)
    expect(runs(false).map((r) => r.text).join('')).toBe(`see ${URL} now`)
  })
})
