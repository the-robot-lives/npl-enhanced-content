/**
 * packages/archive/ustar — POSIX ustar tar archives (create/parse),
 * packages round, LANE=pkg-archive.
 *
 * create: 512-byte headers per entry, data padded to 512, the archive
 * closed with two zero blocks. Names over 100 chars split into the ustar
 * prefix field; un-splittable names are the caller's error (GNU's "name
 * too long to be stored in a ustar archive"). typeflag '5' for
 * directories (trailing '/'), '0' for files.
 *
 * parse: tolerant on the tail by design — GNU stops at the two zero
 * blocks and complains about trailing junk, but THIS shell's line sugar
 * appends one '\n' to every piped binary (execLine's out() wrapping), so
 * anything after the end-of-archive marker is ignored. GNU long-name
 * ('L') and pax ('x') pre-headers are honoured for their path records so
 * archives from GNU tar (gnu format) and macOS bsdtar (pax) both read.
 * Hard-link/symlink members parse but are not extracted (the VFS has no
 * links — reported by the tar command).
 */

export interface TarEntryIn {
  /** Archive name as stored (GNU strips leading '/' on create). */
  name: string;
  type: 'file' | 'dir';
  /** File bytes; dirs carry none. */
  data?: Uint8Array;
  mode: number;
  mtime: number;
}

export interface TarEntry {
  name: string;
  type: 'file' | 'dir' | 'link';
  mode: number;
  size: number;
  mtime: number;
  /** File bytes (files only; null for dirs/links). */
  data: Uint8Array | null;
}

const BLOCK = 512;

function octalField(value: number, width: number): number[] {
  // `width` bytes: width-1 octal digits + NUL (the ustar convention).
  const digits = Math.max(1, width - 1);
  if (value >= 8 ** digits) throw new Error('value too large for ustar field');
  return [...value.toString(8).padStart(digits, '0')].map((ch) => ch.charCodeAt(0)).concat(0);
}

function nameBytes(name: string, max: number): number[] | null {
  const bytes = [...name].map((ch) => ch.charCodeAt(0));
  if (bytes.length > max) return null;
  return bytes;
}

/** Split name into (prefix ≤ 155, name ≤ 100) at a '/', longest suffix first. */
function splitUstarName(name: string): { prefix: string; base: string } | null {
  if (name.length <= 100) return { prefix: '', base: name };
  if (name.length > 255) return null;
  let cut = name.length - 101;
  while (cut > 0 && name[cut] !== '/') cut--;
  if (cut <= 0) return null;
  const base = name.slice(cut + 1);
  if (base.length > 100 || cut > 155) return null;
  return { prefix: name.slice(0, cut), base };
}

export function tarCreate(entries: TarEntryIn[]): Uint8Array {
  const out: number[] = [];
  for (const entry of entries) {
    const stored = entry.type === 'dir' && !entry.name.endsWith('/') ? entry.name + '/' : entry.name;
    const clean = stored.replace(/^\/+/, '');
    if (clean === '' || clean === '.') throw new Error('cannot archive the root');
    const split = splitUstarName(clean);
    if (split === null) throw new Error(`${clean}: name too long to be stored in a ustar archive`);
    const header: number[] = new Array<number>(BLOCK).fill(0);
    const put = (field: number[], at: number): void => {
      for (const [i, b] of field.entries()) header[at + i] = b;
    };
    const nameB = nameBytes(split.base, 100);
    if (nameB === null) throw new Error(`${clean}: name too long to be stored in a ustar archive`);
    put(nameB, 0);
    put(octalField(entry.mode & 0o7777, 8), 100);
    put(octalField(0, 8), 108); // uid
    put(octalField(0, 8), 116); // gid
    put(octalField(entry.type === 'file' ? (entry.data?.length ?? 0) : 0, 12), 124);
    put(octalField(Math.floor(entry.mtime), 12), 136);
    header.fill(0x20, 148, 156); // checksum placeholder: spaces
    header[156] = entry.type === 'dir' ? 0x35 : 0x30; // '5' : '0'
    put([...('ustar\0' + '00')].map((ch) => ch.charCodeAt(0)), 257);
    put(nameBytes(split.prefix, 155) ?? [], 345);
    let sum = 0;
    for (const b of header) sum += b;
    put([...sum.toString(8).padStart(6, '0')].map((ch) => ch.charCodeAt(0)).concat(0, 0x20), 148);
    out.push(...header);

    if (entry.type === 'file' && entry.data !== undefined) {
      for (const b of entry.data) out.push(b);
      const pad = (BLOCK - (entry.data.length % BLOCK)) % BLOCK;
      for (let i = 0; i < pad; i++) out.push(0);
    }
  }
  for (let i = 0; i < BLOCK * 2; i++) out.push(0);
  return new Uint8Array(out);
}

/** All-zero 512-byte block (the end-of-archive marker). */
function isZeroBlock(data: Uint8Array, at: number): boolean {
  for (let i = at; i < at + BLOCK; i++) if (data[i] !== 0) return false;
  return true;
}

function latin1(at: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) {
    if (at[i] === 0) break;
    out += String.fromCharCode(at[i]!);
  }
  return out;
}

function octalFieldParse(data: Uint8Array, at: number, width: number): number {
  let value = 0;
  let seen = false;
  for (let i = 0; i < width; i++) {
    const b = data[at + i]!;
    if (b === 0 || b === 0x20) break;
    if (b < 0x30 || b > 0x37) throw new Error('invalid octal field in ustar header');
    value = value * 8 + (b - 0x30);
    seen = true;
  }
  return seen ? value : 0;
}

export function tarParse(data: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let pos = 0;
  // Carried state from pre-headers:
  let longName: string | null = null; // GNU 'L'
  let paxPath: string | null = null; // pax 'x' path= record

  while (pos + BLOCK <= data.length) {
    if (isZeroBlock(data, pos)) break; // end-of-archive marker (trailing bytes ignored)
    const headerStart = pos;
    const typeByte = String.fromCharCode(data[pos + 156]!);
    let name = latin1(data, pos, pos + 100);
    const prefix = latin1(data, pos + 345, pos + 500);
    if (prefix !== '') name = prefix + '/' + name;
    const size = octalFieldParse(data, pos + 124, 12);
    const checksum = octalFieldParse(data, pos + 148, 7);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : data[pos + i]!;
    if (sum !== checksum) throw new Error('header checksum error');

    const dataStart = pos + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > data.length) throw new Error('unexpected end of archive');
    const body = data.subarray(dataStart, dataEnd);
    pos = dataStart + size + ((BLOCK - (size % BLOCK)) % BLOCK);

    if (typeByte === 'L') {
      longName = latin1(body, 0, body.length);
      continue;
    }
    if (typeByte === 'x' || typeByte === 'X' || typeByte === 'g') {
      // pax extended header: records "<len> <key>=<value>\n"; keep `path`.
      const text = latin1(body, 0, body.length);
      for (const record of text.split('\n')) {
        const m = /^\d+ (?:[^=]+)=(.*)$/.exec(record);
        if (m !== null && record.slice(record.indexOf(' ') + 1).startsWith('path=')) {
          if (typeByte !== 'g') paxPath = m[1];
        }
      }
      continue;
    }

    const type: TarEntry['type'] = typeByte === '5' ? 'dir' : typeByte === '0' || typeByte === '\0' ? 'file' : 'link';
    name = paxPath ?? longName ?? name;
    if (type === 'dir' && !name.endsWith('/')) name += '/';
    paxPath = null;
    longName = null;
    entries.push({
      name,
      type,
      mode: octalFieldParse(data, headerStart + 100, 8),
      size,
      mtime: octalFieldParse(data, headerStart + 136, 12),
      data: type === 'file' ? new Uint8Array(body) : null,
    });
  }
  return entries;
}
