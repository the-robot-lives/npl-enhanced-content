/**
 * packages/git/gitdiff — a line diff (Myers' O(ND) algorithm) with a
 * unified-hunk formatter, used by `git diff` / `git show` / commit
 * summaries.
 *
 * This is the LOCAL FALLBACK the brief asks for while the diff package
 * (LANE=pkg-diff) is still in flight: when that package lands, `git diff`
 * can delegate to it and this module shrinks to glue. Until then it keeps
 * the git package self-contained. Trimmed common prefix/suffix + a size
 * cap (fall back to one whole-file replace block) keep it fast and bounded
 * on VFS-scale files.
 */

export type DiffOpType = 'eq' | 'del' | 'add';

export interface DiffOp {
  type: DiffOpType;
  /** Index into the a-side lines (del/eq only). */
  aLine?: number;
  /** Index into the b-side lines (add/eq only). */
  bLine?: number;
  text: string;
}

/** Above this many edited lines the algorithm swaps to a whole-block replace. */
const MAX_SEARCH = 4000;

/** Split file content into diffable lines, dropping the trailing newline's empty tail. */
export function splitLines(text: string): { lines: string[]; endsWithNewline: boolean } {
  if (text === '') return { lines: [], endsWithNewline: true };
  const endsWithNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (endsWithNewline) lines.pop();
  return { lines, endsWithNewline };
}

/** Myers shortest-edit-script diff of two line ranges. */
function myersRange(a: string[], b: string[], a0: number, a1: number, b0: number, b1: number): DiffOp[] {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.slice(b0, b1).map((text, i) => ({ type: 'add' as const, bLine: b0 + i, text }));
  if (m === 0) return a.slice(a0, a1).map((text, i) => ({ type: 'del' as const, aLine: a0 + i, text }));
  if (n + m > MAX_SEARCH) {
    return [
      ...a.slice(a0, a1).map((text, i) => ({ type: 'del' as const, aLine: a0 + i, text })),
      ...b.slice(b0, b1).map((text, i) => ({ type: 'add' as const, bLine: b0 + i, text })),
    ];
  }
  const max = n + m;
  const off = max;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let endD = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!)) {
        x = v[off + k + 1]!; // down (insert from b)
      } else {
        x = v[off + k - 1]! + 1; // right (delete from a)
      }
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        endD = d;
        break outer;
      }
    }
  }
  if (endD < 0) return []; // unreachable
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = endD; d > 0; d--) {
    const prev = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && prev[off + k - 1]! < prev[off + k + 1]!) ? k + 1 : k - 1;
    const prevX = prev[off + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: 'eq', aLine: a0 + x, bLine: b0 + y, text: a[a0 + x]! });
    }
    if (x === prevX) {
      y--;
      ops.push({ type: 'add', bLine: b0 + y, text: b[b0 + y]! });
    } else {
      x--;
      ops.push({ type: 'del', aLine: a0 + x, text: a[a0 + x]! });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ type: 'eq', aLine: a0 + x, bLine: b0 + y, text: a[a0 + x]! });
  }
  while (x > 0) {
    x--;
    ops.push({ type: 'del', aLine: a0 + x, text: a[a0 + x]! });
  }
  while (y > 0) {
    y--;
    ops.push({ type: 'add', bLine: b0 + y, text: b[b0 + y]! });
  }
  ops.reverse();
  return ops;
}

/** Diff two line arrays into an ordered op list. */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  let start = 0;
  const minLen = Math.min(a.length, b.length);
  while (start < minLen && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: 'eq', aLine: i, bLine: i, text: a[i]! });
  ops.push(...myersRange(a, b, start, endA, start, endB));
  for (let i = endA; i < a.length; i++) {
    ops.push({ type: 'eq', aLine: i, bLine: endB + (i - endA), text: a[i]! });
  }
  return ops;
}

export interface UnifiedHunk {
  aStart: number;
  aCount: number;
  bStart: number;
  bCount: number;
  /** Rows with their ' '/'-'/'+' marker already attached. */
  rows: string[];
}

/** Group an op list into unified hunks with `context` lines around each change. */
export function unifiedHunks(ops: DiffOp[], context = 3): UnifiedHunk[] {
  const changed: number[] = [];
  for (let i = 0; i < ops.length; i++) if (ops[i]!.type !== 'eq') changed.push(i);
  if (changed.length === 0) return [];
  const groups: Array<[number, number]> = [];
  let lo = changed[0]!;
  let hi = changed[0]!;
  for (const idx of changed.slice(1)) {
    if (idx - hi <= context * 2 + 1) {
      hi = idx;
    } else {
      groups.push([lo, hi]);
      lo = idx;
      hi = idx;
    }
  }
  groups.push([lo, hi]);
  return groups.map(([first, last]) => {
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length - 1, last + context);
    const rows: string[] = [];
    let aCount = 0;
    let bCount = 0;
    let aStart = -1;
    let bStart = -1;
    for (let i = from; i <= to; i++) {
      const op = ops[i]!;
      if (op.type === 'add') {
        rows.push('+' + op.text);
        bCount++;
        if (bStart === -1) bStart = op.bLine ?? 0;
      } else if (op.type === 'del') {
        rows.push('-' + op.text);
        aCount++;
        if (aStart === -1) aStart = op.aLine ?? 0;
      } else {
        rows.push(' ' + op.text);
        aCount++;
        bCount++;
        if (aStart === -1) aStart = op.aLine ?? 0;
        if (bStart === -1) bStart = op.bLine ?? 0;
      }
    }
    return {
      aStart: aCount === 0 ? 0 : aStart + 1,
      aCount,
      bStart: bCount === 0 ? 0 : bStart + 1,
      bCount,
      rows,
    };
  });
}

/** `adds` and `dels` across an op list (for diffstat and commit summaries). */
export function countChanges(ops: DiffOp[]): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const op of ops) {
    if (op.type === 'add') adds++;
    else if (op.type === 'del') dels++;
  }
  return { adds, dels };
}

const NO_NEWLINE = '\\ No newline at end of file';

/**
 * Unified-diff rows for a whole file: `@@` hunks plus git's
 * `\ No newline at end of file` after a trailing -/+ row whose op is that
 * side's final line and whose side lacks the closing newline. Rows are
 * built straight from the ops, so each row knows its op — no fuzzy
 * row-to-op mapping.
 */
export function unifiedDiffRows(
  ops: DiffOp[],
  context: number,
  shape: { aLen: number; aEndsNewline: boolean; bLen: number; bEndsNewline: boolean },
): string[] {
  const changed: number[] = [];
  for (let i = 0; i < ops.length; i++) if (ops[i]!.type !== 'eq') changed.push(i);
  if (changed.length === 0) return [];
  const groups: Array<[number, number]> = [];
  let lo = changed[0]!;
  let hi = changed[0]!;
  for (const idx of changed.slice(1)) {
    if (idx - hi <= context * 2 + 1) {
      hi = idx;
    } else {
      groups.push([lo, hi]);
      lo = idx;
      hi = idx;
    }
  }
  groups.push([lo, hi]);
  const rows: string[] = [];
  for (const [first, last] of groups) {
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length - 1, last + context);
    let aCount = 0;
    let bCount = 0;
    let aStart = -1;
    let bStart = -1;
    const body: Array<{ marker: string; op: DiffOp }> = [];
    for (let i = from; i <= to; i++) {
      const op = ops[i]!;
      if (op.type === 'add') {
        body.push({ marker: '+', op });
        bCount++;
        if (bStart === -1) bStart = op.bLine ?? 0;
      } else if (op.type === 'del') {
        body.push({ marker: '-', op });
        aCount++;
        if (aStart === -1) aStart = op.aLine ?? 0;
      } else {
        body.push({ marker: ' ', op });
        aCount++;
        bCount++;
        if (aStart === -1) aStart = op.aLine ?? 0;
        if (bStart === -1) bStart = op.bLine ?? 0;
      }
    }
    rows.push(
      `@@ -${aCount === 0 ? 0 : aStart + 1},${aCount} +${bCount === 0 ? 0 : bStart + 1},${bCount} @@`,
    );
    for (const { marker, op } of body) {
      rows.push(marker + op.text);
      if (marker === '-' && !shape.aEndsNewline && op.aLine === shape.aLen - 1) rows.push(NO_NEWLINE);
      else if (marker === '+' && !shape.bEndsNewline && op.bLine === shape.bLen - 1) rows.push(NO_NEWLINE);
    }
  }
  return rows;
}
