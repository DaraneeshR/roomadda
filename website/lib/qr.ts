/**
 * Tiny, dependency-free QR encoder — enough to render a hotel check-in code as a
 * scannable QR with ZERO external requests (the strict CSP forbids CDN scripts and
 * remote images, and this repo deliberately hand-rolls CSP-safe primitives — see
 * the dependency-free pin map). It outputs a boolean module matrix; the caller
 * renders it as inline SVG (markup, so no script nonce is needed).
 *
 * Scope is intentionally fixed to **version 3, error-correction level M** (29×29,
 * 44 data + 26 EC codewords, single block). That comfortably fits the check-in
 * token (`hqr_` + 32 hex = 36 bytes ≤ the 42-byte byte-mode capacity) while
 * keeping the encoder small and auditable — no block interleaving, no version
 * info. Longer inputs throw (the caller falls back to plain text).
 *
 * The Galois-field + Reed–Solomon + matrix routines follow the well-known
 * public-domain reference (Project Nayuki's QR generator), using the (x=col, y=row)
 * convention throughout so the placement math matches the spec verbatim. Grids are
 * flat `Uint8Array`s (index access is exempt from `noUncheckedIndexedAccess`).
 */

const VERSION = 3;
const SIZE = VERSION * 4 + 17; // 29
const NUM_DATA_CODEWORDS = 44; // version 3, ECC level M
const NUM_EC_CODEWORDS = 26;
const MAX_BYTES = 42; // (44*8 − 4 mode − 8 count) / 8, byte mode, versions 1–9

const idx = (x: number, y: number): number => y * SIZE + x;
const getBit = (value: number, i: number): boolean => ((value >>> i) & 1) !== 0;

/** GF(2^8) multiply, primitive polynomial 0x11D (Russian-peasant, reduces inline). */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The Reed–Solomon divisor polynomial of the given degree (monic, low-to-high). */
function rsDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** RS remainder (the EC codewords) of `data` under `divisor`. */
function rsRemainder(data: Uint8Array, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0]!;
    result.copyWithin(0, 1); // shift left one place
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) result[i] = result[i]! ^ gfMul(divisor[i]!, factor);
  }
  return result;
}

/** Byte-mode data codewords (mode + count + bytes + terminator + pad), length 44. */
function encodeDataCodewords(text: string): Uint8Array {
  const bytes = Array.from(new TextEncoder().encode(text));
  if (bytes.length > MAX_BYTES) {
    throw new Error(`QR payload too long (${bytes.length} > ${MAX_BYTES} bytes)`);
  }
  const bits: number[] = [];
  const push = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // character count (byte mode, versions 1–9 → 8 bits)
  for (const b of bytes) push(b, 8);

  const capacityBits = NUM_DATA_CODEWORDS * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0); // terminator
  while (bits.length % 8 !== 0) bits.push(0); // pad to a byte boundary

  const codewords = new Uint8Array(NUM_DATA_CODEWORDS);
  const written = bits.length / 8;
  for (let i = 0; i < written; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i * 8 + j] ?? 0);
    codewords[i] = byte;
  }
  const pad = [0xec, 0x11];
  for (let i = written; i < NUM_DATA_CODEWORDS; i++) codewords[i] = pad[(i - written) % 2]!;
  return codewords;
}

interface Grid {
  modules: Uint8Array;
  isFn: Uint8Array;
}
const newGrid = (): Grid => ({ modules: new Uint8Array(SIZE * SIZE), isFn: new Uint8Array(SIZE * SIZE) });

function drawFunctionPatterns(g: Grid): void {
  const set = (x: number, y: number, dark: boolean): void => {
    g.modules[idx(x, y)] = dark ? 1 : 0;
    g.isFn[idx(x, y)] = 1;
  };

  // Timing patterns (row 6 and column 6).
  for (let i = 0; i < SIZE; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Finder patterns (+ their separators) at the three corners.
  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(SIZE - 4, 3);
  finder(3, SIZE - 4);

  // The single alignment pattern (version 3 → centre only, at (22,22)).
  const alignCenter = SIZE - 7; // 22
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      set(alignCenter + dx, alignCenter + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

/** Reserve + draw the 15-bit format info for ECC level M and the chosen mask. */
function drawFormatBits(g: Grid, mask: number): void {
  const set = (x: number, y: number, dark: boolean): void => {
    g.modules[idx(x, y)] = dark ? 1 : 0;
    g.isFn[idx(x, y)] = 1;
  };
  // ECC level M → format bits 0b00; append the 3-bit mask.
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412; // 15-bit BCH, XOR-masked

  // First copy (around the top-left finder).
  for (let i = 0; i <= 5; i++) set(8, i, getBit(bits, i));
  set(8, 7, getBit(bits, 6));
  set(8, 8, getBit(bits, 7));
  set(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(bits, i));

  // Second copy (split across the other two finders) + the always-dark module.
  for (let i = 0; i < 8; i++) set(SIZE - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) set(8, SIZE - 15 + i, getBit(bits, i));
  set(8, SIZE - 8, true);
}

/** Zig-zag the codeword bit-stream into the free modules (right-to-left columns). */
function drawCodewords(g: Grid, all: Uint8Array): void {
  let i = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < SIZE; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? SIZE - 1 - vert : vert;
        if (g.isFn[idx(x, y)] === 0 && i < all.length * 8) {
          g.modules[idx(x, y)] = getBit(all[i >>> 3]!, 7 - (i & 7)) ? 1 : 0;
          i++;
        }
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(g: Grid, mask: number): void {
  const fn = MASKS[mask]!;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (g.isFn[idx(x, y)] === 0 && fn(x, y)) g.modules[idx(x, y)] = g.modules[idx(x, y)] === 1 ? 0 : 1;
    }
  }
}

/** The standard finder-run pattern for penalty rule 3 (1:1:3:1:1). */
const FINDER_PATTERN = Uint8Array.of(1, 0, 1, 1, 1, 0, 1);

/** Penalty score of one line (a row or column), via a cell accessor. */
function lineScore(at: (i: number) => boolean, n: number): number {
  let s = 0;
  // Rule 1: runs of 5+ same-colour modules.
  let runColor = at(0);
  let runLen = 1;
  for (let i = 1; i < n; i++) {
    const c = at(i);
    if (c === runColor) {
      runLen++;
      if (runLen === 5) s += 3;
      else if (runLen > 5) s += 1;
    } else {
      runColor = c;
      runLen = 1;
    }
  }
  // Rule 3: finder-like 1:1:3:1:1 with 4 light modules on at least one side.
  for (let i = 0; i + 7 <= n; i++) {
    let match = true;
    for (let k = 0; k < 7; k++) {
      if (at(i + k) !== (FINDER_PATTERN[k] === 1)) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    let before = true;
    for (let k = 1; k <= 4; k++) if (i - k >= 0 && at(i - k)) { before = false; break; }
    let after = true;
    for (let k = 0; k < 4; k++) if (i + 7 + k < n && at(i + 7 + k)) { after = false; break; }
    if (before || after) s += 40;
  }
  return s;
}

/** The standard 4-rule penalty used to pick the least-noisy mask. */
function penalty(modules: Uint8Array): number {
  const N = SIZE;
  const at = (x: number, y: number): boolean => modules[idx(x, y)] === 1;
  let score = 0;

  for (let y = 0; y < N; y++) score += lineScore((x) => at(x, y), N); // rows
  for (let x = 0; x < N; x++) score += lineScore((y) => at(x, y), N); // columns

  // Rule 2: 2×2 blocks of one colour.
  for (let y = 0; y < N - 1; y++) {
    for (let x = 0; x < N - 1; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
    }
  }
  // Rule 4: overall dark/light balance.
  let dark = 0;
  for (let i = 0; i < N * N; i++) if (modules[i] === 1) dark++;
  const percent = (dark * 100) / (N * N);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** Build the codeword stream (data + EC) once — single block, no interleaving. */
function buildCodewords(text: string): Uint8Array {
  const data = encodeDataCodewords(text);
  const ec = rsRemainder(data, rsDivisor(NUM_EC_CODEWORDS));
  const all = new Uint8Array(data.length + ec.length);
  all.set(data);
  all.set(ec, data.length);
  return all;
}

/** Flatten a finished grid to the boolean matrix the SVG renderer draws. */
function toMatrix(modules: Uint8Array): boolean[][] {
  const rows: boolean[][] = [];
  for (let y = 0; y < SIZE; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < SIZE; x++) row.push(modules[idx(x, y)] === 1);
    rows.push(row);
  }
  return rows;
}

/** The best (lowest-penalty) masked grid for a codeword stream. */
function bestGrid(all: Uint8Array): { g: Grid; mask: number } {
  let best: { g: Grid; mask: number } | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = newGrid();
    drawFunctionPatterns(g);
    drawFormatBits(g, mask);
    drawCodewords(g, all);
    applyMask(g, mask);
    const score = penalty(g.modules);
    if (score < bestScore) {
      bestScore = score;
      best = { g, mask };
    }
  }
  return best!;
}

/**
 * Encode `text` as a version-3 / ECC-M QR and return the module matrix
 * (`true` = dark). The best of the 8 mask patterns is chosen by the standard
 * penalty. Throws only if `text` exceeds the fixed byte capacity.
 */
export function encodeQr(text: string): boolean[][] {
  return toMatrix(bestGrid(buildCodewords(text)).g.modules);
}

export const QR_SIZE = SIZE;

/**
 * Testing seam — exposes the intermediate encode state so a unit test can
 * round-trip the data out of the matrix and cross-check the Reed–Solomon EC
 * against an independent implementation. Not used by the app.
 */
export const __qrInternals = {
  SIZE,
  NUM_EC_CODEWORDS,
  MASKS,
  encodeDataCodewords,
  rsDivisor,
  rsRemainder,
  encodeDebug(text: string): { modules: boolean[][]; isFn: boolean[][]; mask: number; all: number[] } {
    const all = buildCodewords(text);
    const { g, mask } = bestGrid(all);
    return {
      modules: toMatrix(g.modules),
      isFn: toMatrix(g.isFn),
      mask,
      all: Array.from(all),
    };
  },
};
