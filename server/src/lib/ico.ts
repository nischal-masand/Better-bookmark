const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47])

export interface RawImage {
  data: Buffer
  width: number
  height: number
  channels: 4
}

export interface IcoEntry {
  /** A PNG payload sharp can decode directly. */
  png?: Buffer
  /** A decoded bitmap sharp can take as raw input. */
  raw?: RawImage
}

export function isIco(buffer: Buffer): boolean {
  return buffer.length > 6 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1
}

/**
 * Extracts the largest image from an ICO container. Sharp cannot read ICO or
 * BMP, and plenty of sites still serve only /favicon.ico, so the two common
 * payloads are handled here: an embedded PNG, or an uncompressed 24/32-bit DIB.
 * Palette-indexed entries are rare enough to skip.
 */
export function decodeIco(buffer: Buffer): IcoEntry | null {
  if (!isIco(buffer)) return null
  const count = buffer.readUInt16LE(4)
  if (count === 0) return null

  let best: { size: number; offset: number; length: number } | null = null
  for (let i = 0; i < count; i++) {
    const dir = 6 + i * 16
    if (dir + 16 > buffer.length) break
    const width = buffer.readUInt8(dir) || 256
    const height = buffer.readUInt8(dir + 1) || 256
    const length = buffer.readUInt32LE(dir + 8)
    const offset = buffer.readUInt32LE(dir + 12)
    if (offset + length > buffer.length) continue
    const size = width * height
    if (!best || size > best.size) best = { size, offset, length }
  }
  if (!best) return null

  const payload = buffer.subarray(best.offset, best.offset + best.length)
  if (payload.subarray(0, 4).equals(PNG_SIGNATURE)) return { png: payload }

  const raw = decodeDib(payload)
  return raw ? { raw } : null
}

function decodeDib(payload: Buffer): RawImage | null {
  if (payload.length < 40) return null
  const headerSize = payload.readUInt32LE(0)
  if (headerSize !== 40) return null

  const width = payload.readInt32LE(4)
  // ICO stores the XOR bitmap and an AND mask stacked, so the header height is doubled.
  const height = Math.abs(payload.readInt32LE(8)) / 2
  const bitCount = payload.readUInt16LE(14)
  const compression = payload.readUInt32LE(16)
  if (compression !== 0 || width <= 0 || height <= 0 || width > 1024 || height > 1024) return null
  if (bitCount !== 32 && bitCount !== 24) return null

  const bytesPerPixel = bitCount / 8
  const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4
  const pixelStart = 40
  if (pixelStart + rowSize * height > payload.length) return null

  const out = Buffer.alloc(width * height * 4)
  const maskStart = pixelStart + rowSize * height
  const maskRowSize = Math.ceil(width / 32) * 4

  for (let y = 0; y < height; y++) {
    const srcRow = pixelStart + (height - 1 - y) * rowSize // DIB rows are bottom-up
    for (let x = 0; x < width; x++) {
      const src = srcRow + x * bytesPerPixel
      const dst = (y * width + x) * 4
      out[dst] = payload[src + 2]! // B G R A on disk
      out[dst + 1] = payload[src + 1]!
      out[dst + 2] = payload[src]!
      if (bitCount === 32) {
        out[dst + 3] = payload[src + 3]!
      } else {
        const maskByte = payload[maskStart + (height - 1 - y) * maskRowSize + (x >> 3)]
        const transparent = maskByte !== undefined && (maskByte >> (7 - (x & 7))) & 1
        out[dst + 3] = transparent ? 0 : 255
      }
    }
  }

  // A fully transparent alpha channel means we misread it; treat as opaque.
  if (bitCount === 32 && out.every((_, i) => i % 4 !== 3 || out[i] === 0)) {
    for (let i = 3; i < out.length; i += 4) out[i] = 255
  }

  return { data: out, width, height, channels: 4 }
}
