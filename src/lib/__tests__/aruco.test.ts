import { describe, expect, it } from 'vitest';
import { decodeMarkerBits, markerMatrix, markerPayload } from '../aruco';

function payloadFromMatrix(m: number[][]): number[][] {
  // invert the drawing convention: matrix 0 = white cell = bit 1
  return m.slice(1, 6).map((row) => row.slice(1, 6).map((v) => (v === 0 ? 1 : 0)));
}

function rotateMatrix(m: number[][]): number[][] {
  const n = m.length;
  const out = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[c][n - 1 - r] = m[r][c];
  return out;
}

describe('aruco encode/decode roundtrip', () => {
  it('roundtrips every id used by the app and a spread of others', () => {
    for (const id of [0, 1, 2, 7, 42, 333, 512, 1023]) {
      const decoded = decodeMarkerBits(payloadFromMatrix(markerMatrix(id)));
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe(id);
      expect(decoded!.distance).toBe(0);
      expect(decoded!.rotations).toBe(0);
    }
  });

  it('decodes under all four physical rotations', () => {
    let m = markerMatrix(42);
    for (let rot = 0; rot < 4; rot++) {
      const decoded = decodeMarkerBits(payloadFromMatrix(m));
      expect(decoded?.id).toBe(42);
      m = rotateMatrix(m);
    }
  });

  it('corrects a single flipped bit', () => {
    const payload = payloadFromMatrix(markerMatrix(100));
    payload[2][3] = payload[2][3] ? 0 : 1;
    const decoded = decodeMarkerBits(payload, 1);
    expect(decoded?.id).toBe(100);
    expect(decoded?.distance).toBe(1);
  });

  it('marker border is fully black', () => {
    const m = markerMatrix(7);
    for (let i = 0; i < 7; i++) {
      expect(m[0][i]).toBe(1);
      expect(m[6][i]).toBe(1);
      expect(m[i][0]).toBe(1);
      expect(m[i][6]).toBe(1);
    }
  });

  it('payload row encoding matches the original ArUco codewords', () => {
    // id 0b1001100111 = 615 → rows: 10,01,10,01,11
    expect(markerPayload(615)).toEqual([
      [0, 1, 0, 0, 1],
      [1, 0, 1, 1, 1],
      [0, 1, 0, 0, 1],
      [1, 0, 1, 1, 1],
      [0, 1, 1, 1, 0],
    ]);
  });
});
