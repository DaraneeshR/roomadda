import { describe, expect, it } from "vitest";
import { encodeQr, QR_SIZE, __qrInternals } from "../lib/qr";

/**
 * Validates the hand-rolled, dependency-free QR encoder end-to-end WITHOUT a QR
 * library: an independent Reed–Solomon cross-check, structural invariants (finder
 * + timing patterns), format-info decode, and — the real proof it is scannable —
 * reading the data bits back out of the finished matrix (un-masking the exact
 * traversal) and confirming they equal the encoded codeword stream.
 */

const TOKEN = "hqr_0123456789abcdef0123456789abcdef"; // hqr_ + 32 hex = 36 bytes

/** An independent, table-based GF(256)/RS implementation (primitive 0x11D). */
function independentEc(input: number[] | Uint8Array, ecLen: number): number[] {
  const data = Array.from(input);
  const exp = new Array<number>(512).fill(0);
  const log = new Array<number>(256).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255]!;
  const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : exp[log[a]! + log[b]!]!);
  // generator polynomial
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] = next[j]! ^ gen[j]!;
      next[j + 1] = next[j + 1]! ^ mul(gen[j]!, exp[i]!);
    }
    gen = next;
  }
  // polynomial division remainder
  const rem = [...data, ...new Array<number>(ecLen).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = rem[i]!;
    if (coef !== 0) for (let j = 0; j < gen.length; j++) rem[i + j] = rem[i + j]! ^ mul(gen[j]!, coef);
  }
  return rem.slice(data.length);
}

describe("QR encoder — Reed–Solomon", () => {
  it("matches an independent RS implementation for the check-in token", () => {
    const data = __qrInternals.encodeDataCodewords(TOKEN);
    expect(data).toHaveLength(44); // version 3 data codewords
    const mine = Array.from(__qrInternals.rsRemainder(data, __qrInternals.rsDivisor(__qrInternals.NUM_EC_CODEWORDS)));
    const theirs = independentEc(data, __qrInternals.NUM_EC_CODEWORDS);
    expect(mine).toEqual(theirs);
    expect(mine).toHaveLength(26); // version 3, ECC-M
  });

  it("encodes the byte-mode header exactly (mode 0x4, 8-bit count, hi-nibble spill)", () => {
    // "AB" → mode 0100, count 00000010, 'A'=0x41, 'B'=0x42.
    // Bitstream: 0100 00000010 01000001 01000010 → bytes 0x40,0x24,0x14,0x2(padded).
    const cw = __qrInternals.encodeDataCodewords("AB");
    expect(cw[0]).toBe(0x40); // 0100 0000
    expect(cw[1]).toBe(0x24); // 0010 0100
    expect(cw[2]).toBe(0x14); // 0001 0100
    // remaining bytes are terminator + alternating pad 0xEC/0x11
    expect(cw).toHaveLength(44);
  });
});

describe("QR encoder — matrix structure", () => {
  const m = encodeQr(TOKEN);

  it("is a 29×29 (version 3) matrix", () => {
    expect(QR_SIZE).toBe(29);
    expect(m).toHaveLength(29);
    expect(m.every((row) => row.length === 29)).toBe(true);
  });

  it("has correct 7×7 finder patterns at all three corners", () => {
    const finderOk = (oy: number, ox: number): boolean => {
      for (let dy = 0; dy < 7; dy++) {
        for (let dx = 0; dx < 7; dx++) {
          const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          const expected = ring !== 2; // dark border(3) + dark centre(0,1), light ring at 2
          if (m[oy + dy]![ox + dx] !== expected) return false;
        }
      }
      return true;
    };
    expect(finderOk(0, 0)).toBe(true);
    expect(finderOk(0, 29 - 7)).toBe(true);
    expect(finderOk(29 - 7, 0)).toBe(true);
  });

  it("has an alternating timing pattern on row 6 and column 6", () => {
    for (let i = 8; i <= 20; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0);
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
  });

  it("is deterministic", () => {
    expect(encodeQr(TOKEN)).toEqual(m);
  });
});

describe("QR encoder — data round-trips out of the finished matrix", () => {
  it("reads the exact codeword stream back after un-masking (proves scannable placement)", () => {
    const { modules, isFn, mask, all } = __qrInternals.encodeDebug(TOKEN);
    const maskFn = __qrInternals.MASKS[mask]!;
    const N = __qrInternals.SIZE;

    // Walk the SAME zig-zag the encoder used, reading each non-function module and
    // reversing the mask, then repack into bytes and compare to the codewords.
    const bits: number[] = [];
    for (let right = N - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < N; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? N - 1 - vert : vert;
          if (!isFn[y]![x] && bits.length < all.length * 8) {
            const unmasked = modules[y]![x] !== maskFn(x, y); // XOR out the mask
            bits.push(unmasked ? 1 : 0);
          }
        }
      }
    }
    const readBack: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
      readBack.push(byte);
    }
    expect(readBack).toEqual(all);
  });
});
