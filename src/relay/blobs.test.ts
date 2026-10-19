import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const RELAY = 'https://relay.test'
const ME = 'a'.repeat(64)
const signed = vi.hoisted(() => ({ events: [] as UnsignedEvent[] }))
vi.mock('./bridge', () => ({
  relaySigner: () => ({
    relayUrl: 'https://relay.test',
    pubkey: 'a'.repeat(64),
    signer: {
      sign: async (unsigned: UnsignedEvent): Promise<SignedEvent> => {
        signed.events.push(unsigned)
        return { ...unsigned, id: '0'.repeat(64), sig: '0'.repeat(128) }
      },
    },
  }),
}))

import { blobObjectUrl, clearBlobCache, uploadFile } from './blobs'

/* A PNG as a capture tool writes it: its picture, and a `tEXt` and a `pHYs` the relay refuses. */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: number[]) => {
  const body = new Uint8Array([...new TextEncoder().encode(type), ...data])
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(body, 4)
  view.setUint32(8 + data.length, crc32(body))
  return [...out]
}
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
  ...chunk('tEXt', [...new TextEncoder().encode('Software\0Capture')]),
  ...chunk('pHYs', [0, 0, 14, 196, 0, 0, 14, 196, 1]),
  ...chunk('IDAT', [0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0, 0, 0, 4, 0, 1]),
  ...chunk('IEND', []),
])
const has = (bytes: Uint8Array, text: string) => new TextDecoder('latin1').decode(bytes).includes(text)

afterEach(() => {
  vi.unstubAllGlobals()
  clearBlobCache()
  signed.events = []
})

describe('uploading a file for a comment', () => {
  it('sends the picture without its metadata, signed for those bytes, and names it by what the relay stored', async () => {
    const put = vi.fn(async (_url: string, init: { body: ArrayBuffer; headers: Record<string, string> }) => ({
      status: 200,
      text: async () => JSON.stringify({ url: `${RELAY}/media/${init.headers['x-sha-256']}.png`, sha256: init.headers['x-sha-256'], size: init.body.byteLength, type: 'image/png' }),
    }))
    vi.stubGlobal('fetch', put)
    expect(has(PNG, 'tEXt')).toBe(true)
    const answer = await uploadFile(new File([PNG], 'shot.png', { type: 'image/png' }))
    const [url, init] = put.mock.calls[0]
    expect(url).toBe(`${RELAY}/upload`)
    const sent = new Uint8Array(init.body)
    expect(has(sent, 'tEXt') || has(sent, 'pHYs')).toBe(false)
    // The authorization names the bytes that went, and the file is named by the relay's answer.
    const sha = init.headers['x-sha-256']
    expect(signed.events[0]).toMatchObject({ kind: 24242, pubkey: ME })
    expect(signed.events[0].tags).toContainEqual(['x', sha])
    expect(answer).toEqual({ ok: true, file: expect.objectContaining({ url: `${RELAY}/media/${sha}.png`, x: sha, m: 'image/png', filename: 'shot.png' }) })
  })

  it('says a file is too large when the relay refuses its size, and other refusals in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 413, text: async () => 'file too large: 99999999 bytes (max 10485760)' })))
    expect(await uploadFile(new File(['x'], 'big.pdf', { type: 'application/pdf' }))).toEqual({ ok: false, reason: 'Too large' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 500, text: async () => 'storage: io error' })))
    expect(await uploadFile(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toEqual({ ok: false, reason: 'Could not upload' })
  })
})

describe("reading a comment's file", () => {
  it("fetches a file on this relay with a signed get, and never sends one to another host's URL", async () => {
    const sha = 'e'.repeat(64)
    const get = vi.fn(async () => ({ status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG.buffer, text: async () => '' }))
    vi.stubGlobal('fetch', get)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:leaf/1' }))
    expect(await blobObjectUrl(`${RELAY}/media/${sha}.png`)).toBe('blob:leaf/1')
    expect(get).toHaveBeenCalledTimes(1)
    expect(signed.events[0].tags).toContainEqual(['t', 'get'])
    await expect(blobObjectUrl(`https://elsewhere.test/media/${sha}.png`)).rejects.toThrow(/not this relay/)
    expect(get).toHaveBeenCalledTimes(1)
    expect(signed.events).toHaveLength(1)
  })
})
