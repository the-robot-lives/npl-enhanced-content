/**
 * packages/diff/myers — the sequence-diff engine behind the diff package
 * (packages round, LANE=pkg-diff).
 *
 * Myers' O((N+M)D) algorithm with linear-space divide & conquer (middle
 * snake): minimal edit scripts without the O(D^2) trace memory, the same
 * family GNU diff uses. Common prefix/suffix trimming keeps the common
 * case cheap; a depth cap splits pathological inputs at their midpoint so
 * worst cases degrade to a valid (non-minimal) script instead of exploding
 * — the same escape hatch real diff tools take.
 *
 * The frontier bookkeeping is box-clamped: only states with x ∈ [0, n],
 * y ∈ [0, m] are stored, every move is feasibility-checked, and the
 * middle-snake split is verified to shrink its window (midpoint fallback
 * otherwise). Random sweeps over tiny alphabets in the test suite assert
 * every emitted script is valid AND minimal, including LCS-0 pairs where
 * the "middle snake" degenerates to a single vertex — the classic
 * unclamped formulation silently produces out-of-box states there and
 * recurses into negative windows.
 *
 * Ops are emitted as a forward walk over both sequences; maximal runs of
 * delete/insert are normalised to delete-then-insert order, which is what
 * every diff printer here (normal, unified, context) and the patch
 * applier expect (`<` lines before `>` lines inside one change).
 */

/** One edit step: equal, delete a[ai], or insert b[bi] (0-based indexes). */
export type EditOp =
  | { t: 'eq'; ai: number; bi: number }
  | { t: 'del'; ai: number }
  | { t: 'ins'; bi: number };

/** Work cap per diffSeq call: windows bigger than this stop being minimal. */
const WORK_CAP = 4096;

/**
 * Minimal diff of a[0..na) vs b[0..nb). `eq` decides element equality
 * (diff -i/-w pass a normalising comparator; the printers still show the
 * original lines). Guaranteed to terminate on any input; minimal below
 * the work cap, valid-but-split above it.
 */
export function diffSeq<T>(
  a: readonly T[],
  na: number,
  b: readonly T[],
  nb: number,
  eq: (x: T, y: T) => boolean,
): EditOp[] {
  const out: EditOp[] = [];
  walk(0, na, 0, nb);
  return normalizeRuns(out);

  function walk(alo: number, ahi: number, blo: number, bhi: number): void {
    // Common prefix — emitted immediately (cheap, keeps recursion small).
    while (alo < ahi && blo < bhi && eq(a[alo]!, b[blo]!)) {
      out.push({ t: 'eq', ai: alo, bi: blo });
      alo++;
      blo++;
    }
    // Common suffix — peeled now, emitted after the middle (walkRight).
    let suffix: EditOp[] = [];
    while (ahi > alo && bhi > blo && eq(a[ahi - 1]!, b[bhi - 1]!)) {
      suffix.push({ t: 'eq', ai: ahi - 1, bi: bhi - 1 });
      ahi--;
      bhi--;
    }
    suffix.reverse();
    if (alo === ahi) {
      for (let bi = blo; bi < bhi; bi++) out.push({ t: 'ins', bi });
    } else if (blo === bhi) {
      for (let ai = alo; ai < ahi; ai++) out.push({ t: 'del', ai });
    } else if (ahi - alo + (bhi - blo) > WORK_CAP) {
      // Pathologically large + still different: split at the midpoints and
      // keep walking (valid script, not guaranteed minimal).
      midpointSplit(alo, ahi, blo, bhi);
    } else {
      const snake = middleSnake(a, alo, ahi, b, blo, bhi, eq);
      // A middle snake must shrink its window: the left child ends past the
      // window start AND the right child starts before the window end. A
      // degenerate vertex split at a corner cannot make progress — fall
      // back to the midpoint (valid script, once non-minimal).
      if (
        snake !== null &&
        (snake.u > alo || snake.v > blo) &&
        (snake.x < ahi || snake.y < bhi)
      ) {
        walk(alo, snake.x, blo, snake.y);
        // The middle snake itself is common: a[x..u) == b[y..v) — neither
        // child's window covers it, so emit it here (empty for a pure
        // vertex overlap).
        for (let i = snake.x, j = snake.y; i < snake.u; i++, j++) out.push({ t: 'eq', ai: i, bi: j });
        walk(snake.u, ahi, snake.v, bhi);
      } else {
        midpointSplit(alo, ahi, blo, bhi);
      }
    }
    for (const op of suffix) out.push(op);
  }

  function midpointSplit(alo: number, ahi: number, blo: number, bhi: number): void {
    const amid = (alo + ahi) >> 1;
    const bmid = blo + Math.round(((bhi - blo) * (amid - alo)) / (ahi - alo));
    walk(alo, amid, blo, Math.max(blo, Math.min(bhi, bmid)));
    walk(amid, ahi, Math.max(blo, Math.min(bhi, bmid)), bhi);
  }
}

/** Split maximal non-eq runs so deletes all precede inserts (printer/APL shape). */
function normalizeRuns(ops: EditOp[]): EditOp[] {
  const out: EditOp[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.t === 'eq') {
      out.push(ops[i++]!);
      continue;
    }
    const dels: EditOp[] = [];
    const inss: EditOp[] = [];
    while (i < ops.length && ops[i]!.t !== 'eq') {
      (ops[i]!.t === 'del' ? dels : inss).push(ops[i++]!);
    }
    for (const op of dels) out.push(op);
    for (const op of inss) out.push(op);
  }
  return out;
}

/**
 * The linear-space core: find the middle snake of the optimal path
 * between the (already prefix/suffix-trimmed) windows and split on it.
 * Returns absolute indexes (x,u over `a`; y,v over `b`), or null when the
 * search exhausts (callers fall back to a midpoint split — kept as a
 * total-function guard).
 *
 * Frontiers are Int32Arrays indexed by ABSOLUTE diagonal (k = x − y
 * forward; kr = k + delta backward), clamped to the state box
 * x ∈ [0, n], y ∈ [0, m]: a diagonal is only iterated when some in-box
 * state can exist on it, each move is feasibility-checked before it is
 * taken, and a dead diagonal stores a sentinel that can never win a
 * comparison. Unclamped formulations let infeasible states leak into the
 * split and recurse into negative windows (LCS-0 pairs hit this).
 */
function middleSnake<T>(
  a: readonly T[],
  alo: number,
  ahi: number,
  b: readonly T[],
  blo: number,
  bhi: number,
  eq: (x: T, y: T) => boolean,
): { x: number; y: number; u: number; v: number } | null {
  const n = ahi - alo;
  const m = bhi - blo;
  const delta = n - m;
  const odd = (delta & 1) !== 0;
  const maxD = (n + m + 1) >> 1; // ceil((n+m)/2) — enough by the parity lemma
  const off = maxD + 2;
  // Frontier reaches PLUS the depth they were set at: a slot is a legal
  // move source only when its depth is exactly d−1 (the d=0 base cases
  // aside), so stale sentinel values can never leak into a move decision.
  const vfX = new Int32Array(2 * off + 1); // forward reach per absolute diagonal k: max x
  const vfD = new Int32Array(2 * off + 1).fill(-1);
  const vbX = new Int32Array(2 * off + 1); // backward reach per absolute diagonal kr: min x
  const vbD = new Int32Array(2 * off + 1).fill(-1);

  for (let d = 0; d <= maxD; d++) {
    // Forward pass: furthest-reaching d-path per diagonal k = x − y.
    // Parity-consistent range only — the state box (x ∈ [0,n], y ∈ [0,m])
    // is enforced by move feasibility, never by clamping these endpoints
    // (a clamp whose parity differs from d skips half the diagonals).
    const kMin = -d;
    const kMax = d;
    for (let k = kMin; k <= kMax; k += 2) {
      // Moves: right (x+1, from k−1) or down (y+1, from k+1). The d=0 base
      // state is the window origin itself (x=0, y=0) — no move produces it.
      let x: number;
      if (d === 0 && k === 0) {
        x = 0;
      } else {
        const fromR = k > kMin && vfD[off + k - 1]! === d - 1;
        const fromD = k < kMax && vfD[off + k + 1]! === d - 1;
        const xR = fromR ? vfX[off + k - 1]! + 1 : Number.MAX_SAFE_INTEGER; // y unchanged
        const xD = fromD ? vfX[off + k + 1]! : Number.MAX_SAFE_INTEGER; // y' + 1, needs ≤ m
        const okR = fromR && xR <= n;
        const okD = fromD && xD <= n && xD - k <= m;
        if (!okR && !okD) continue; // no in-box d-path on this diagonal yet
        x = okR && okD ? Math.max(xR, xD) : okR ? xR : xD;
      }
      let y = x - k;
      const sx = x;
      const sy = y;
      while (x < n && y < m && eq(a[alo + x]!, b[blo + y]!)) {
        x++;
        y++;
      }
      vfX[off + k] = x;
      vfD[off + k] = d;
      // Odd total length: overlap with a reverse (d−1)-path on the SAME
      // diagonal k (vb stores the reverse endpoint's x; overlap ⇔ x ≥ it).
      if (odd && vbD[off + k]! !== -1 && vbX[off + k]! <= x) {
        return { x: alo + sx, y: blo + sy, u: alo + x, v: blo + y };
      }
    }
    // Backward pass: furthest-reaching reverse d-path per absolute diagonal
    // kr = k + delta. Moves: left (x−1, from kr+1) or up (y−1, from kr−1);
    // "furthest backward" = minimal x. Same parity rule as the forward pass.
    const krMin = delta - d;
    const krMax = delta + d;
    for (let kr = krMin; kr <= krMax; kr += 2) {
      let x: number;
      if (d === 0 && kr === delta) {
        x = n; // the d=0 base state is the window corner (x=n, y=m)
      } else {
        const fromL = kr < krMax && vbD[off + kr + 1]! === d - 1;
        const fromU = kr > krMin && vbD[off + kr - 1]! === d - 1;
        const xL = fromL ? vbX[off + kr + 1]! - 1 : -1; // x−1, needs ≥ 0
        const xU = fromU ? vbX[off + kr - 1]! : -1; // y−1, needs y' ≥ 1
        const okL = fromL && xL >= 0;
        const okU = fromU && vbX[off + kr - 1]! - kr >= 0;
        if (!okL && !okU) continue;
        x = okL && okU ? Math.min(xL, xU) : okL ? xL : xU;
      }
      let y = x - kr;
      const ex = x;
      const ey = y;
      while (x > 0 && y > 0 && eq(a[alo + x - 1]!, b[blo + y - 1]!)) {
        x--;
        y--;
      }
      vbX[off + kr] = x;
      vbD[off + kr] = d;
      // Even total length: overlap with the forward d-path on the same
      // diagonal (vf stores the forward reach; overlap ⇔ x ≤ it). The
      // snake runs from the walked-back point to the pre-walk point.
      if (!odd && vfD[off + kr]! !== -1 && x <= vfX[off + kr]!) {
        return { x: alo + x, y: blo + y, u: alo + ex, v: blo + ey };
      }
    }
  }
  return null; // callers split at the midpoint (total-function guard)
}

/**
 * Split text into diff lines: `["a","b"]` for `"a\nb"` (last line keeps
 * its content; the trailing-newline state is the `eol` flag — exactly how
 * GNU models it, so `\ No newline at end of file` round-trips through
 * diff → patch). The empty string is zero lines, never a no-EOL line.
 */
export function splitLines(text: string): { lines: string[]; eol: boolean } {
  if (text === '') return { lines: [], eol: true };
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
    return { lines, eol: true };
  }
  return { lines, eol: false };
}
