/**
 * The link the block menu's Copy link copies: it must read back, in any app,
 * as the same document and the same block (SPEC §7.7), and it is built from
 * Leaf's own shape at the tab's origin.
 */
import { matchObjectUrl, urlPatternsOf, type ForeignObject } from '@estiva-app/interop'
import { describe, expect, it } from 'vitest'
import { buildManifest } from '../manifest'
import { blockLinkOf } from './blockLink'

const D = 'a1b2c3d4-0000-4000-8000-00000000000a'
const page = (kind: number, title?: string) =>
  ({ kind, address: `${kind}:${'a'.repeat(64)}:${D}`, slots: title ? { title: { value: title } } : {} }) as unknown as ForeignObject
const published = urlPatternsOf(buildManifest('b'.repeat(64), 1_760_000_000_000, 'https://leaf.estiva.app/'))

describe('Copy link on a block of a document', () => {
  it('copies the document’s own link to that block, which every app reads back as the document and the block', () => {
    const link = blockLinkOf(page(30842, 'Plan for Friday'), '28bad0a555e9', 'https://leaf.estiva.app')
    expect(link).toBe(`https://leaf.estiva.app/document/plan-for-friday-${D}#block-28bad0a555e9`)
    expect(matchObjectUrl(link!, published)).toEqual({ identifier: D, by: 'd', kind: 30842, block: '28bad0a555e9' })
  })

  it('is a link at the origin the page is open on', () => {
    expect(blockLinkOf(page(30842), '28bad0a555e9', 'http://localhost:5173')).toBe(`http://localhost:5173/document/${D}#block-28bad0a555e9`)
  })

  it('offers no link for a file another app owns, which opens in that app', () => {
    expect(blockLinkOf(page(30851, 'A bug'), '28bad0a555e9', 'https://leaf.estiva.app')).toBeUndefined()
  })
})
