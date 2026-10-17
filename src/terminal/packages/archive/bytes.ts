/**
 * packages/archive/bytes — binary-string plumbing for the archive package
 * (packages round, LANE=pkg-archive).
 *
 * The VFS stores file content as a JS string (vfs.write convention; see
 * the wasm package's `.wasm` binary-string note). Binary formats (gzip,
 * tar, zip) therefore travel through the shell as BINARY STRINGS: every
 * char code ≤ 0xff is one byte. `bytesOf`/`strOfBytes` are the two
 * directions, chosen so that both worlds stay byte-exact:
 *
 *   - a string any of whose char codes is > 0xff (real text) encodes as
 *     UTF-8 — hashes and base64 of text files match GNU coreutils;
 *   - an all-latin-1 string encodes 1:1 — archives written by this
 *     package round-trip bit for bit;
 *   - `strOfBytes` prefers a strict UTF-8 decode (so decoded text reads
 *     back as text) and falls back to latin-1 (so decoded archives stay
 *     binary strings the next command can re-encode unchanged).
 *
 * Known, documented divergence: latin-1-range TEXT ("café" as single
 * chars) encodes as latin-1 where GNU would use the file's UTF-8 bytes —
 * the stringly-typed VFS cannot tell the two apart, and round-trips win.
 */

/** String content → bytes (binary-string or UTF-8, see the header note). */
export function bytesOf(text: string): Uint8Array {
  let latin = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0xff) {
      latin = false;
      break;
    }
  }
  if (latin) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(text);
}

/** Bytes → string (strict UTF-8 when valid, latin-1 binary string else). */
export function strOfBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return out;
  }
}

const HEX = '0123456789abcdef';

/** Bytes → lowercase hex (the *sum family's output alphabet). */
export function hexOf(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += HEX[bytes[i]! >> 4]! + HEX[bytes[i]! & 15]!;
  }
  return out;
}

/* ── base64 (own implementation: wrapping control + honest errors) ── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes → base64, lines wrapped at `wrap` columns (0 = no wrapping). */
export function base64Encode(bytes: Uint8Array, wrap: number): string[] {
  const lines: string[] = [];
  let line = '';
  let i = 0;
  while (i + 3 <= bytes.length) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    line += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
    i += 3;
    if (wrap > 0 && line.length + 4 > wrap) {
      lines.push(line);
      line = '';
    }
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    line += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    line += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  if (line !== '') lines.push(line);
  return lines;
}

const B64_REV = new Map<string, number>([...B64].map((ch, i) => [ch, i]));

/**
 * base64 text → bytes. Newlines (and \r) are structure, not data — the
 * shell's line sugar and GNU's 76-column wrapping both produce them, and
 * GNU base64 -d accepts them. Anything else non-alphabet is an error
 * naming the offending character unless `ignoreGarbage`.
 */
export function base64Decode(text: string, ignoreGarbage: boolean): Uint8Array | string {
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    if (ch === '\n' || ch === ' ' || ch === '\t') continue;
    const v = B64_REV.get(ch);
    if (v === undefined) {
      if (ch === '=') continue; // padding: lengths checked below
      if (ignoreGarbage) continue;
      return `invalid input: '${ch}'`;
    }
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/* ── crc32 (gzip trailer + zip) ── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Little-endian u16/u32 readers/writers over byte arrays. */
export const readLe16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
export const readLe32 = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

export function writeLe16(out: number[], v: number): void {
  out.push(v & 0xff, (v >>> 8) & 0xff);
}

export function writeLe32(out: number[], v: number): void {
  out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}
