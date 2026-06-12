/**
 * Original ArUco 5×5 dictionary (ids 0–1023), generated algorithmically —
 * the same dictionary js-aruco detects. Each of the 5 rows encodes 2 data
 * bits as a 5-bit codeword with parity. Marker = 7×7 cells: 1-cell black
 * border around the 5×5 payload.
 *
 * Used both to RENDER markers (PDF sheet) and to DECODE candidate quads
 * (worker samples the 7×7 grid and calls decodeMarkerBits).
 */

const CODEWORDS = [
  [1, 0, 0, 0, 0], // data 00
  [1, 0, 1, 1, 1], // data 01
  [0, 1, 0, 0, 1], // data 10
  [0, 1, 1, 1, 0], // data 11
];

/** 5×5 payload bits (row-major) for an id in [0, 1023]. */
export function markerPayload(id: number): number[][] {
  if (id < 0 || id > 1023) throw new Error('ArUco id must be 0–1023');
  const rows: number[][] = [];
  for (let r = 0; r < 5; r++) {
    // row 0 holds the most significant 2 bits
    const data = (id >> (2 * (4 - r))) & 0b11;
    rows.push([...CODEWORDS[data]]);
  }
  return rows;
}

/** Full 7×7 cell matrix including black border. 1 = black, 0 = white. */
export function markerMatrix(id: number): number[][] {
  const payload = markerPayload(id);
  const m: number[][] = Array.from({ length: 7 }, () => new Array(7).fill(1));
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++) m[r + 1][c + 1] = payload[r][c] ? 0 : 1; // payload bit 1 = white cell
  return m;
}

function rotate5(bits: number[][]): number[][] {
  const out: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0));
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) out[c][4 - r] = bits[r][c];
  return out;
}

function hamming(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export interface DecodeResult {
  id: number;
  /** Number of 90° CW rotations applied to reach canonical orientation. */
  rotations: number;
  /** Total hamming distance to the nearest valid code (0 = exact). */
  distance: number;
}

/**
 * Decode a sampled 5×5 payload (1 = white cell as drawn, i.e. bit set).
 * Tries all 4 rotations; per-row nearest-codeword with total error budget.
 */
export function decodeMarkerBits(bits: number[][], maxTotalError = 1): DecodeResult | null {
  let best: DecodeResult | null = null;
  let current = bits;
  for (let rot = 0; rot < 4; rot++) {
    let total = 0;
    let id = 0;
    let valid = true;
    for (let r = 0; r < 5; r++) {
      let rowBest = Infinity;
      let rowData = 0;
      for (let d = 0; d < 4; d++) {
        const dist = hamming(current[r], CODEWORDS[d]);
        if (dist < rowBest) {
          rowBest = dist;
          rowData = d;
        }
      }
      total += rowBest;
      if (total > maxTotalError) {
        valid = false;
        break;
      }
      id = (id << 2) | rowData;
    }
    if (valid && (best === null || total < best.distance)) {
      best = { id, rotations: rot, distance: total };
      if (total === 0) return best;
    }
    current = rotate5(current);
  }
  return best;
}
