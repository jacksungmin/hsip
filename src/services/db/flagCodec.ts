// Bit-pack 0/1 flag columns into byte arrays and back.
// Layout: bit i -> byte floor(i/8), position i%8, LSB-first.

export function encodeFlags(keys: readonly string[], row: Record<string, 0 | 1>): Uint8Array {
  const buf = new Uint8Array(Math.ceil(keys.length / 8))
  for (let i = 0; i < keys.length; i++) {
    if (row[keys[i]] === 1) buf[i >> 3] |= 1 << (i & 7)
  }
  return buf
}

export function decodeFlags<K extends string>(keys: readonly K[], buf: Uint8Array): Record<K, 0 | 1> {
  const out = {} as Record<K, 0 | 1>
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = ((buf[i >> 3] >> (i & 7)) & 1) as 0 | 1
  }
  return out
}

export function countFromBytes(
  keys: readonly string[],
  buf: Uint8Array,
  counts: Record<string, number>,
): void {
  for (let i = 0; i < keys.length; i++) {
    if ((buf[i >> 3] >> (i & 7)) & 1) counts[keys[i]]++
  }
}
