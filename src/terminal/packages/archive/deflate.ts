/**
 * packages/archive/deflate — raw DEFLATE (RFC 1951) + the gzip container
 * (RFC 1952), pure and synchronous (packages round, LANE=pkg-archive).
 *
 * Synchronous on purpose: the brief suggested CompressionStream, but the
 * stream API is Promise-based while CommandSpec.run is synchronous and
 * `execLine` copies each stage's stdout to the next stage's stdin in the
 * same tick — an async compressor would pipe EMPTY bytes into every
 * `cat f | gzip > f.gz`. So this module implements DEFLATE directly and
 * works everywhere (no feature detection, no worker):
 *
 *   - inflate: complete — stored, fixed-Huffman and dynamic-Huffman
 *     blocks, validated against Node's zlib in tests (both directions).
 *   - deflate: greedy LZ77 (32 KiB window, 3..258 matches, hash chains)
 *     emitted as fixed-Huffman blocks, with a stored-block fallback when
 *     the literal encoding would grow the data. Compression ratio is a
 *     few percent off zlib's level 6 — fine for shell-sized files, and
 *     the FORMAT is exactly standard, so real gzip/zlib reads it.
 */

import { crc32, readLe16, readLe32, writeLe16, writeLe32 } from './bytes.js';

/* ── length/distance code tables (RFC 1951 §3.2.5) ── */

const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const LENGTH_BASE: number[] = (() => {
  const base = [3];
  for (let i = 1; i < LENGTH_EXTRA.length; i++) base.push(base[i - 1]! + (1 << LENGTH_EXTRA[i - 1]!));
  return base;
})();
LENGTH_BASE[28] = 258; // code 285 is RFC's special "258, extra 0": code 284's
// 5-extra range also ends at 258, so the recurrence above gives 259. Pin it.
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const DIST_BASE: number[] = (() => {
  const base = [1];
  for (let i = 1; i < DIST_EXTRA.length; i++) base.push(base[i - 1]! + (1 << DIST_EXTRA[i - 1]!));
  return base;
})();

function codeForLength(len: number): { code: number; extra: number; value: number } {
  if (len === 258) return { code: 285, extra: 0, value: 0 };
  let i = LENGTH_BASE.length - 1;
  while (LENGTH_BASE[i]! > len) i--;
  return { code: 257 + i, extra: LENGTH_EXTRA[i]!, value: len - LENGTH_BASE[i]! };
}

function codeForDistance(dist: number): { code: number; extra: number; value: number } {
  let i = DIST_BASE.length - 1;
  while (DIST_BASE[i]! > dist) i--;
  return { code: i, extra: DIST_EXTRA[i]!, value: dist - DIST_BASE[i]! };
}

/* ── canonical Huffman trees (the puff.c decoder form) ── */

interface HuffTree {
  counts: Int32Array;
  symbols: Int32Array;
}

function buildTree(lengths: ArrayLike<number>): HuffTree {
  const counts = new Int32Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i] as number]++;
  counts[0] = 0;
  const offsets = new Int32Array(16);
  for (let i = 0, sum = 0; i < 15; i++) {
    offsets[i + 1] = sum + counts[i]!;
    sum += counts[i]!;
  }
  const symbols = new Int32Array(lengths.length);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym] as number;
    if (len !== 0) symbols[offsets[len]++] = sym;
  }
  return { counts, symbols };
}

/* ── bit I/O (DEFLATE packs LSB-first; Huffman codes are MSB-first) ── */

class BitReader {
  pos: number;
  bitBuf = 0;
  bitCnt = 0;

  constructor(
    private readonly data: Uint8Array,
    private readonly start = 0,
  ) {
    this.pos = start;
  }

  bits(n: number): number {
    while (this.bitCnt < n) {
      if (this.pos >= this.data.length) throw new Error('unexpected end of input');
      this.bitBuf |= this.data[this.pos++]! << this.bitCnt;
      this.bitCnt += 8;
    }
    const value = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCnt -= n;
    return value;
  }

  alignByte(): void {
    const drop = this.bitCnt & 7;
    if (drop !== 0) {
      this.bitBuf >>>= drop;
      this.bitCnt -= drop;
    }
  }

  /** Bytes consumed RELATIVE to `start` (the gzip trailer's offset). */
  get consumed(): number {
    return this.pos - this.start - (this.bitCnt >> 3);
  }
}

function decodeSym(br: BitReader, tree: HuffTree): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len < 16; len++) {
    code |= br.bits(1);
    const count = tree.counts[len]!;
    if (code - first < count) return tree.symbols[index + code - first]!;
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error('invalid Huffman code');
}

const FIXED_LIT_LENGTHS = (() => {
  const lengths = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return lengths;
})();
let fixedTrees: { lit: HuffTree; dist: HuffTree } | null = null;
function fixedTreesOf() {
  return (fixedTrees ??= { lit: buildTree(FIXED_LIT_LENGTHS), dist: buildTree(new Uint8Array(30).fill(5)) });
}

const CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function dynamicTrees(br: BitReader): { lit: HuffTree; dist: HuffTree } {
  const hlit = br.bits(5) + 257;
  const hdist = br.bits(5) + 1;
  const hclen = br.bits(4) + 4;
  const clLengths = new Uint8Array(19);
  for (let i = 0; i < hclen; i++) clLengths[CLC_ORDER[i]!] = br.bits(3);
  if (clLengths.every((l) => l === 0)) throw new Error('invalid code lengths');
  const clTree = buildTree(clLengths);
  const lengths = new Uint8Array(hlit + hdist);
  let i = 0;
  while (i < lengths.length) {
    const sym = decodeSym(br, clTree);
    if (sym < 16) {
      lengths[i++] = sym;
    } else if (sym === 16) {
      if (i === 0) throw new Error('invalid code length repeat');
      const prev = lengths[i - 1]!;
      let repeat = 3 + br.bits(2);
      while (repeat-- > 0 && i < lengths.length) lengths[i++] = prev;
    } else if (sym === 17) {
      i += 3 + br.bits(3);
    } else {
      i += 11 + br.bits(7);
    }
  }
  if (i > lengths.length) throw new Error('code length repeat overruns table');
  if (lengths[256] === 0) throw new Error('missing end-of-block code');
  return { lit: buildTree(lengths.subarray(0, hlit)), dist: buildTree(lengths.subarray(hlit)) };
}

/* ── inflate ── */

export interface Inflated {
  data: Uint8Array;
  /** Bytes of the input the final block ended on (trailing-garbage check). */
  consumed: number;
}

export function inflateRaw(data: Uint8Array, start = 0): Inflated {
  const br = new BitReader(data, start);
  const out: number[] = [];
  let bfinal = 0;
  do {
    bfinal = br.bits(1);
    const btype = br.bits(2);
    if (btype === 0) {
      br.alignByte();
      if (br.pos + 4 > data.length) throw new Error('unexpected end of input');
      const len = data[br.pos]! | (data[br.pos + 1]! << 8);
      const nlen = data[br.pos + 2]! | (data[br.pos + 3]! << 8);
      br.pos += 4;
      if ((len ^ 0xffff) !== nlen) throw new Error('invalid stored block length');
      if (br.pos + len > data.length) throw new Error('unexpected end of input');
      for (let i = 0; i < len; i++) out.push(data[br.pos++]!);
    } else {
      const trees = btype === 1 ? fixedTreesOf() : dynamicTrees(br);
      for (;;) {
        const sym = decodeSym(br, trees.lit);
        if (sym < 256) {
          out.push(sym);
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          if (li >= LENGTH_BASE.length) throw new Error('invalid length code');
          const len = LENGTH_BASE[li]! + br.bits(LENGTH_EXTRA[li]!);
          const ds = decodeSym(br, trees.dist);
          if (ds >= DIST_BASE.length) throw new Error('invalid distance code');
          const dist = DIST_BASE[ds]! + br.bits(DIST_EXTRA[ds]!);
          if (dist > out.length) throw new Error('invalid distance too far back');
          let from = out.length - dist;
          for (let k = 0; k < len; k++) out.push(out[from++]!);
        }
      }
    }
  } while (bfinal !== 1);
  br.alignByte();
  return { data: new Uint8Array(out), consumed: br.consumed };
}

/* ── deflate (greedy LZ77 + fixed Huffman, stored fallback) ── */

class BitWriter {
  private buf: number[] = [];
  private bitBuf = 0;
  private bitCnt = 0;

  /** Integer value, LSB-first (`extra` bits of length/distance codes). */
  put(value: number, n: number): void {
    this.bitBuf |= (value & ((1 << n) - 1)) << this.bitCnt;
    this.bitCnt += n;
    while (this.bitCnt >= 8) {
      this.buf.push(this.bitBuf & 0xff);
      this.bitBuf >>>= 8;
      this.bitCnt -= 8;
    }
  }

  /** Huffman code, MSB-first (RFC 1951 §3.1.1). */
  putCode(code: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.put((code >>> i) & 1, 1);
  }

  alignByte(): void {
    if (this.bitCnt !== 0) this.put(0, 8 - this.bitCnt);
  }

  bytes(): Uint8Array {
    this.alignByte();
    return new Uint8Array(this.buf);
  }
}

/** Canonical code assignment for a complete length table. */
function canonicalCodes(lengths: Uint8Array): Int32Array {
  const codes = new Int32Array(lengths.length);
  const counts = new Int32Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]!]++;
  counts[0] = 0;
  let next = 0;
  for (let len = 1; len <= 15; len++) {
    // `next` is the first free code at THIS length (it was advanced past
    // the previous length's codes by the assignment loop below).
    next <<= 1;
    for (let sym = 0; sym < lengths.length; sym++) {
      if (lengths[sym] === len) codes[sym] = next++;
    }
  }
  return codes;
}

const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MAX_CHAIN = 128;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;

const hashAt = (data: Uint8Array, i: number): number =>
  (((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & (HASH_SIZE - 1));

function emitFixed(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  const litCodes = canonicalCodes(FIXED_LIT_LENGTHS);
  const distCodes = canonicalCodes(new Uint8Array(30).fill(5));
  const litLenOf = (sym: number): number => (sym <= 143 ? 8 : sym <= 255 ? 9 : sym <= 279 ? 7 : 8);

  w.put(1, 1); // one final block
  w.put(1, 2); // fixed Huffman

  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(data.length);
  const matchLength = (pos: number, cand: number): number => {
    const max = Math.min(MAX_MATCH, data.length - pos);
    let k = 0;
    while (k < max && data[cand + k] === data[pos + k]) k++;
    return k;
  };

  let i = 0;
  while (i < data.length) {
    let bestLen = MIN_MATCH - 1;
    let bestDist = 0;
    if (i + MIN_MATCH <= data.length) {
      const h = hashAt(data, i);
      let cand = head[h]!;
      let chain = MAX_CHAIN;
      const maxDist = Math.min(WINDOW, i);
      while (cand >= 0 && i - cand <= maxDist && chain-- > 0) {
        const len = matchLength(i, cand);
        if (len > bestLen) {
          bestLen = len;
          bestDist = i - cand;
          if (len >= MAX_MATCH) break;
        }
        cand = prev[cand]!;
      }
    }
    if (bestLen >= MIN_MATCH) {
      const { code, extra, value } = codeForLength(bestLen);
      w.putCode(litCodes[code]!, litLenOf(code));
      if (extra !== 0) w.put(value, extra);
      const { code: dcode, extra: dextra, value: dvalue } = codeForDistance(bestDist);
      w.putCode(distCodes[dcode]!, 5);
      if (dextra !== 0) w.put(dvalue, dextra);
      // register the whole match in the hash chains
      for (let k = 0; k < bestLen; k++) {
        const p = i + k;
        if (p + MIN_MATCH <= data.length) {
          const h = hashAt(data, p);
          prev[p] = head[h]!;
          head[h] = p;
        }
      }
      i += bestLen;
    } else {
      w.putCode(litCodes[data[i]!]!, litLenOf(data[i]!));
      if (i + MIN_MATCH <= data.length) {
        const h = hashAt(data, i);
        prev[i] = head[h]!;
        head[h] = i;
      }
      i++;
    }
  }
  w.putCode(litCodes[256]!, 7); // end of block
  return w.bytes();
}

function emitStored(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  let offset = 0;
  do {
    const len = Math.min(0xffff, data.length - offset);
    w.put(offset + len >= data.length ? 1 : 0, 1);
    w.put(0, 2);
    w.alignByte();
    w.put(len & 0xff, 8);
    w.put((len >>> 8) & 0xff, 8);
    w.put((~len) & 0xff, 8);
    w.put(((~len) >>> 8) & 0xff, 8);
    for (let i = 0; i < len; i++) w.put(data[offset + i]!, 8);
    offset += len;
  } while (offset < data.length);
  return w.bytes();
}

/** Raw DEFLATE: the smaller of fixed-Huffman LZ77 and stored blocks. */
export function deflateRaw(data: Uint8Array): Uint8Array {
  if (data.length === 0) return emitStored(data);
  const fixed = emitFixed(data);
  // stored costs 5 bytes per 65535-block; only worth it when fixed grew
  const storedFloor = data.length + 5 * Math.ceil(data.length / 0xffff);
  return fixed.length <= storedFloor ? fixed : emitStored(data);
}

/* ── gzip container (RFC 1952) ── */

export function gzipWrap(data: Uint8Array): Uint8Array {
  const out: number[] = [0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3]; // magic, deflate, no flags, mtime 0, XFL 0, OS unix
  const body = deflateRaw(data);
  for (const b of body) out.push(b);
  writeLe32(out, crc32(data));
  writeLe32(out, data.length >>> 0);
  return new Uint8Array(out);
}

export class GzipError extends Error {}

/**
 * Parse + verify one gzip member. Returns the decompressed bytes and the
 * offset just past the member (trailing bytes are the caller's policy —
 * the shell's line sugar appends one '\n' to piped binary, which the
 * gzip command treats as shell artefact, everything else as GNU's
 * "trailing garbage ignored" warning).
 */
export function gzipUnwrap(data: Uint8Array): { raw: Uint8Array; end: number } {
  if (data.length < 18 || data[0] !== 0x1f || data[1] !== 0x8b) {
    throw new GzipError('not in gzip format');
  }
  if (data[2] !== 8) throw new GzipError('unknown compression method');
  const flg = data[3]!;
  if (flg & 0xe0) throw new GzipError('unsupported flags set');
  let p = 10;
  if (flg & 4) {
    if (p + 2 > data.length) throw new GzipError('truncated header');
    p += 2 + readLe16(data, p);
  }
  const skipZeroTerminated = (): void => {
    while (p < data.length && data[p] !== 0) p++;
    p++;
  };
  if (flg & 8) skipZeroTerminated(); // FNAME
  if (flg & 16) skipZeroTerminated(); // FCOMMENT
  if (flg & 2) {
    // FHCRC: CRC-32 of the header bytes so far, low 16 bits (RFC 1952 §2.3.1.2)
    if (p + 2 > data.length) throw new GzipError('truncated header');
    const want = readLe16(data, p);
    if ((crc32(data.subarray(0, p)) & 0xffff) !== want) throw new GzipError('header checksum error');
    p += 2;
  }
  if (p > data.length - 8) throw new GzipError('unexpected end of input');
  let inflated: Inflated;
  try {
    inflated = inflateRaw(data, p);
  } catch (cause) {
    throw new GzipError(cause instanceof Error ? cause.message : 'invalid compressed data');
  }
  const end = p + inflated.consumed + 8;
  const storedCrc = readLe32(data, p + inflated.consumed);
  const storedSize = readLe32(data, p + inflated.consumed + 4);
  if (crc32(inflated.data) !== storedCrc) throw new GzipError('invalid compressed data--crc error');
  if ((inflated.data.length >>> 0) !== storedSize) throw new GzipError('invalid compressed data--length error');
  return { raw: inflated.data, end };
}

/** Re-export for the zip writer's USE limits. */
export { writeLe16, writeLe32 };
