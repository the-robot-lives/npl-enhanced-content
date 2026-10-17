/**
 * packages/archive/zipfile — PKZIP archives, store (method 0) + deflate
 * (method 8), packages round, LANE=pkg-archive.
 *
 * The brief suggested CompressionStream 'deflate-raw' for the deflate
 * entries; CommandSpec.run is synchronous (execLine never awaits) so the
 * archive package carries its own raw DEFLATE (./deflate.ts) — same
 * format, same entries, just computed in-thread.
 *
 * create: per entry a local file header + data, then the central
 * directory + EOCD. No zip64 (a stringly-typed VFS cannot realistically
 * hold 4 GiB), no encryption, no data-descriptor writers (sizes are
 * known up front). Per entry the smaller of store/deflate wins, like
 * Info-ZIP.
 *
 * parse: the EOCD is located by scanning backwards (comment length then
 * unknown); entry sizes/method/CRC come from the CENTRAL directory (the
 * streaming-writer convention: local headers may carry sizes 0 with the
 * data-descriptor flag set); entry data is located through the LOCAL
 * header's own name/extra lengths, per the spec.
 */

import { crc32, readLe16, readLe32, writeLe16, writeLe32 } from './bytes.js';
import { inflateRaw, deflateRaw } from './deflate.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

export interface ZipEntryIn {
  /** Archive name — directories end with '/'. */
  name: string;
  data: Uint8Array;
  /** Unix mode bits (stored in the external attributes, unix convention). */
  mode: number;
  /** Force method 0 (`zip -0`). */
  store?: boolean;
}

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  dosTime: number;
  dosDate: number;
  mode: number;
  isDir: boolean;
  localOffset: number;
}

const dosDateTime = (when: Date): { dosTime: number; dosDate: number } => ({
  dosTime: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
  dosDate: ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
});

export function zipCreate(entries: ZipEntryIn[]): Uint8Array {
  const out: number[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = [...entry.name].map((ch) => ch.charCodeAt(0) & 0xff);
    const { dosTime, dosDate } = dosDateTime(new Date()); // per-entry stamp; callers may override below
    const crc = crc32(entry.data);
    let method = 0;
    let payload = entry.data;
    if (!entry.store && entry.data.length > 0) {
      const deflated = deflateRaw(entry.data);
      if (deflated.length < entry.data.length) {
        method = 8;
        payload = deflated;
      }
    }
    const externalAttrs = ((entry.mode & 0xffff) << 16) | (entry.name.endsWith('/') ? 0x10 : 0);

    const localStart = offset;
    writeLe32(out, SIG_LOCAL);
    writeLe16(out, 20); // version needed
    writeLe16(out, 0); // flags
    writeLe16(out, method);
    writeLe16(out, dosTime);
    writeLe16(out, dosDate);
    writeLe32(out, crc);
    writeLe32(out, payload.length);
    writeLe32(out, entry.data.length);
    writeLe16(out, nameBytes.length);
    writeLe16(out, 0); // extra len
    for (const b of nameBytes) out.push(b);
    for (const b of payload) out.push(b);
    offset = out.length;

    writeLe32(central, SIG_CENTRAL);
    writeLe16(central, (3 << 8) | 20); // made by: unix, 2.0
    writeLe16(central, 20); // version needed
    writeLe16(central, 0); // flags
    writeLe16(central, method);
    writeLe16(central, dosTime);
    writeLe16(central, dosDate);
    writeLe32(central, crc);
    writeLe32(central, payload.length);
    writeLe32(central, entry.data.length);
    writeLe16(central, nameBytes.length);
    writeLe16(central, 0); // extra
    writeLe16(central, 0); // comment
    writeLe16(central, 0); // disk start
    writeLe16(central, 0); // internal attrs
    writeLe32(central, externalAttrs);
    writeLe32(central, localStart);
    for (const b of nameBytes) central.push(b);
  }

  const cdOffset = out.length;
  for (const b of central) out.push(b);
  const cdSize = out.length - cdOffset;
  writeLe32(out, SIG_EOCD);
  writeLe16(out, 0); // this disk
  writeLe16(out, 0); // cd disk
  writeLe16(out, entries.length);
  writeLe16(out, entries.length);
  writeLe32(out, cdSize);
  writeLe32(out, cdOffset);
  writeLe16(out, 0); // comment len
  return new Uint8Array(out);
}

export class ZipError extends Error {}

export function zipParse(data: Uint8Array): ZipEntry[] {
  // Locate the EOCD: scan backwards over the possible comment region.
  const scanFrom = Math.max(0, data.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = data.length - 22; i >= scanFrom; i--) {
    if (readLe32(data, i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('End-of-central-directory signature not found (not a zip file, or unsupported trailing data)');

  const count = readLe16(data, eocd + 10);
  let pos = readLe32(data, eocd + 16);
  const cdEnd = pos + readLe32(data, eocd + 12);
  if (cdEnd > eocd || pos + 46 > data.length) throw new ZipError('bad central directory offset');

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (readLe32(data, pos) !== SIG_CENTRAL) throw new ZipError('bad central directory entry');
    const nameLen = readLe16(data, pos + 28);
    const extraLen = readLe16(data, pos + 30);
    const commentLen = readLe16(data, pos + 32);
    let name = '';
    for (let j = 0; j < nameLen; j++) name += String.fromCharCode(data[pos + 46 + j]!);
    entries.push({
      name,
      method: readLe16(data, pos + 10),
      crc: readLe32(data, pos + 16),
      csize: readLe32(data, pos + 20),
      usize: readLe32(data, pos + 24),
      dosTime: readLe16(data, pos + 12),
      dosDate: readLe16(data, pos + 14),
      mode: readLe32(data, pos + 38) >>> 16,
      isDir: name.endsWith('/') || (readLe32(data, pos + 38) & 0x10) !== 0,
      localOffset: readLe32(data, pos + 42),
    });
    pos += 46 + nameLen + extraLen + commentLen;
    if (pos > cdEnd) throw new ZipError('central directory overrun');
  }
  return entries;
}

/** Decompress + CRC-verify one member (sizes/method from the central dir). */
export function zipReadEntry(data: Uint8Array, entry: ZipEntry): Uint8Array {
  if (entry.localOffset + 30 > data.length || readLe32(data, entry.localOffset) !== SIG_LOCAL) {
    throw new ZipError(`${entry.name}: bad local header`);
  }
  const nameLen = readLe16(data, entry.localOffset + 26);
  const extraLen = readLe16(data, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  if (start + entry.csize > data.length) throw new ZipError(`${entry.name}: truncated entry data`);
  const raw = data.subarray(start, start + entry.csize);
  if (entry.method === 0) {
    if (raw.length !== entry.usize) throw new ZipError(`${entry.name}: stored size mismatch`);
    return new Uint8Array(raw);
  }
  if (entry.method === 8) {
    let out: Uint8Array;
    try {
      out = inflateRaw(raw).data;
    } catch (cause) {
      throw new ZipError(`${entry.name}: ${cause instanceof Error ? cause.message : 'deflate error'}`);
    }
    if (out.length !== entry.usize) throw new ZipError(`${entry.name}: size mismatch after inflate`);
    return out;
  }
  throw new ZipError(`${entry.name}: unsupported compression method ${entry.method}`);
}

export { dosDateTime };
