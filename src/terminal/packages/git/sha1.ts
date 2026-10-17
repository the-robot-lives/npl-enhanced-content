/**
 * packages/git/sha1 — a compact, dependency-free SHA-1 (FIPS 180-4).
 *
 * The shell command path is synchronous, so `crypto.subtle.digest` (async)
 * cannot hash objects on it; git's object names ARE SHA-1, so a pure
 * implementation keeps blob/tree/commit hashing on the synchronous VFS
 * path. Verified in test/unit/shell-pkg-git.test.ts against the standard
 * vectors ("" → da39a3ee…, "abc" → a9993e36…, the 56/64-byte padding-edge
 * messages and a >1-block message).
 */

const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6] as const;

/** SHA-1 of `data` as 40 lowercase hex chars. */
export function sha1Hex(data: Uint8Array): string {
  const ml = data.length;
  const total = Math.ceil((ml + 1 + 8) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[ml] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = ml * 8;
  view.setUint32(total - 8, Math.floor(bits / 0x100000000));
  view.setUint32(total - 4, bits >>> 0);
  const w = new Int32Array(80);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (n << 1) | (n >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = K[0]!;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = K[1]!;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = K[2]!;
      } else {
        f = b ^ c ^ d;
        k = K[3]!;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

const encoder = new TextEncoder();

/** SHA-1 of a UTF-8 string, hex. */
export function sha1Text(text: string): string {
  return sha1Hex(encoder.encode(text));
}
