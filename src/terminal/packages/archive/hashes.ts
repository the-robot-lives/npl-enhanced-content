/**
 * packages/archive/hashes — the *sum family's message digests, pure and
 * synchronous (packages round, LANE=pkg-archive).
 *
 * The brief's "SubtleCrypto" is a Promise API; CommandSpec.run is
 * synchronous (execLine never awaits), so a digest had to arrive in the
 * same tick — these are compact pure implementations instead. They are
 * NOT trusted on faith: test/unit/terminal-pkg-archive.test.ts
 * cross-checks every one against crypto.subtle on random inputs and
 * against the published vectors.
 *
 * The SHA-2 constant tables are not transcribed: they are COMPUTED from
 * the spec's definition (fractional bits of the square/cube roots of the
 * first primes) with exact BigInt integer roots, so transcription errors
 * are structurally impossible. MD5's T table is the spec's own
 * floor(|sin(i)| * 2^32). SHA-1's five constants are four well-known
 * magic words plus C3D2E1F0.
 */

/* ── exact integer roots (spec-exact SHA-2 constant generation) ── */

function iroot(n: bigint, k: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / Number(k)) + 1);
  for (;;) {
    const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
    if (y >= x) return x;
    x = y;
  }
}

const M32 = 0xffffffffn;
const M64 = (1n << 64n) - 1n;

/** frac bits of the k-th root of the i-th prime, scaled to `bits`.
 *  p^(1/k) · 2^bits == (p · 2^(bits·k))^(1/k), so the integer shift is
 *  bits·k — bits·2 is only right for the square roots. */
function rootBits(primes: number[], i: number, k: number, bits: number): bigint {
  const scale = BigInt(bits * k);
  const root = iroot(BigInt(primes[i]!) << scale, BigInt(k));
  return root & ((1n << BigInt(bits)) - 1n);
}

const firstPrimes = (count: number): number[] => {
  const out: number[] = [];
  for (let n = 2; out.length < count; n++) {
    if (!out.some((p) => n % p === 0)) out.push(n);
  }
  return out;
};

/* ── md5 ── */

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_T = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

export function md5(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // little-endian 64-bit length; JS shifts are mod 32, so the high four
  // bytes must be written as explicit zeros, never `bitLen >>> 32+`.
  for (let i = 0; i < 4; i++) padded[padded.length - 8 + i] = (bitLen >>> (8 * i)) & 0xff;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const w = new Int32Array(16);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (padded[chunk + i * 4]! |
          (padded[chunk + i * 4 + 1]! << 8) |
          (padded[chunk + i * 4 + 2]! << 16) |
          (padded[chunk + i * 4 + 3]! << 24)) |
        0;
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_T[i]! + w[g]!) | 0;
      b = (b + rotl(sum, MD5_S[(i >> 4) * 4 + (i % 4)]!)) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const out = new Uint8Array(16);
  for (const [i, word] of [a0, b0, c0, d0].entries()) {
    for (let j = 0; j < 4; j++) out[i * 4 + j] = (word >>> (8 * j)) & 0xff;
  }
  return out;
}

/* ── sha1 ── */

export function sha1(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // big-endian 64-bit length; shifts ≥ 32 wrap (mod 32), so write the
  // high half as explicit zeros and only shift 0..24.
  for (let i = 0; i < 4; i++) padded[padded.length - 8 + i] = 0;
  for (let i = 4; i < 8; i++) padded[padded.length - 8 + i] = (bitLen >>> (8 * (7 - i))) & 0xff;

  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Int32Array(80);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (padded[chunk + i * 4]! << 24) | (padded[chunk + i * 4 + 1]! << 16) | (padded[chunk + i * 4 + 2]! << 8) | padded[chunk + i * 4 + 3]!;
    }
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let [a, b, c, d, e] = h;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rotl(a, 5) + f + e + k + w[t]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = tmp;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
  }

  const out = new Uint8Array(20);
  for (const [i, word] of h.entries()) {
    for (let j = 0; j < 4; j++) out[i * 4 + j] = (word >>> (8 * (3 - j))) & 0xff;
  }
  return out;
}

/* ── sha256 (constants computed, see the header note) ── */

const P64 = firstPrimes(64);
const SHA256_K = P64.map((_, i) => Number(rootBits(P64, i, 3, 32)));
const SHA256_H0 = P64.slice(0, 8).map((_, i) => Number(rootBits(P64, i, 2, 32)));
const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

export function sha256(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // big-endian 64-bit length; shifts ≥ 32 wrap (mod 32), so write the
  // high half as explicit zeros and only shift 0..24.
  for (let i = 0; i < 4; i++) padded[padded.length - 8 + i] = 0;
  for (let i = 4; i < 8; i++) padded[padded.length - 8 + i] = (bitLen >>> (8 * (7 - i))) & 0xff;

  const h = [...SHA256_H0];
  const w = new Int32Array(64);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (padded[chunk + i * 4]! << 24) | (padded[chunk + i * 4 + 1]! << 16) | (padded[chunk + i * 4 + 2]! << 8) | padded[chunk + i * 4 + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i]! + w[i]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + next[i]!) | 0;
  }

  const out = new Uint8Array(32);
  for (const [i, word] of h.entries()) {
    for (let j = 0; j < 4; j++) out[i * 4 + j] = (word >>> (8 * (3 - j))) & 0xff;
  }
  return out;
}

/* ── sha512 (BigInt words, constants computed) ── */

const P80 = firstPrimes(80);
const SHA512_K = P80.map((_, i) => rootBits(P80, i, 3, 64));
const SHA512_H0 = P80.slice(0, 8).map((_, i) => rootBits(P80, i, 2, 64));
const rotr64 = (x: bigint, n: number): bigint => ((x << BigInt(64 - n)) | (x >> BigInt(n))) & M64;

export function sha512(bytes: Uint8Array): Uint8Array {
  const bitLen = BigInt(bytes.length) * 8n;
  const padded = new Uint8Array((((bytes.length + 16) >> 7) + 1) << 7);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  for (let i = 0; i < 16; i++) padded[padded.length - 16 + i] = Number((bitLen >> BigInt(8 * (15 - i))) & 0xffn);

  const h = [...SHA512_H0];
  const w = new Array<bigint>(80);
  for (let chunk = 0; chunk < padded.length; chunk += 128) {
    for (let i = 0; i < 16; i++) {
      let word = 0n;
      for (let j = 0; j < 8; j++) word = (word << 8n) | BigInt(padded[chunk + i * 8 + j]!);
      w[i] = word;
    }
    for (let i = 16; i < 80; i++) {
      const s0 = rotr64(w[i - 15]!, 1) ^ rotr64(w[i - 15]!, 8) ^ (w[i - 15]! >> 7n);
      const s1 = rotr64(w[i - 2]!, 19) ^ rotr64(w[i - 2]!, 61) ^ (w[i - 2]! >> 6n);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) & M64;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 80; i++) {
      const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA512_K[i]! + w[i]!) & M64;
      const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & M64;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) & M64;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) & M64;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + next[i]!) & M64;
  }

  const out = new Uint8Array(64);
  for (const [i, word] of h.entries()) {
    for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((word >> BigInt(8 * (7 - j))) & 0xffn);
  }
  return out;
}

export type SumAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';

const DIGESTS: Record<SumAlgorithm, (bytes: Uint8Array) => Uint8Array> = {
  md5,
  sha1,
  sha256,
  sha512,
};

export function digest(algo: SumAlgorithm, bytes: Uint8Array): Uint8Array {
  return DIGESTS[algo](bytes);
}

/** Hex digest length per algorithm — `sum -c` validates its input lines. */
export const digestHexLength: Record<SumAlgorithm, number> = { md5: 32, sha1: 40, sha256: 64, sha512: 128 };
