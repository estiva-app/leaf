/**
 * Where a card written as a URL opens (LTX-6): the address as written, on Leaf's
 * host, the host its file opens on, or one an app declares — never another site
 * (WBM-11 security review).
 */
import { describe, expect, it } from 'vitest'
import { writtenOpenerOf } from './links'

const LEAF = 'https://leaf.estiva.app'
const OPENS = 'https://ship.estiva.app/o/30851:ab:x'
const DECLARED = new Set(['https://ship.estiva.app', 'https://peek.estiva.app', LEAF])

describe('writtenOpenerOf', () => {
  it('an address on a declared host, Leaf’s own, or the one its file opens on, opens as written', () => {
    for (const url of ['https://peek.estiva.app/issue/plan-x', 'https://leaf.estiva.app/issue/plan-x#block-p1', 'https://ship.estiva.app/issue/plan-x']) {
      expect(writtenOpenerOf(url, OPENS, LEAF, DECLARED), url).toBe(url)
    }
    expect(writtenOpenerOf('https://ship.estiva.app/issue/plan-x', OPENS, LEAF, new Set())).toBe('https://ship.estiva.app/issue/plan-x')
  })

  it('a host no app declares, a lookalike of one, or plain http opens nothing as written', () => {
    for (const url of [
      'https://evil.example/issue/plan-x',
      'https://peek.estiva.app.evil.com/issue/plan-x',
      'https://peek.estiva.app@evil.com/issue/plan-x',
      'https://peek.estiva.app:8443/issue/plan-x',
      'http://peek.estiva.app/issue/plan-x',
      'javascript:alert(1)',
    ]) {
      expect(writtenOpenerOf(url, OPENS, LEAF, DECLARED), url).toBeUndefined()
    }
  })
})
