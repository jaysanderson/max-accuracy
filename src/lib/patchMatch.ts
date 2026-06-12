import type { Pt } from '../types';
import { type Luma } from './edgeSnap';

/**
 * Normalized cross-correlation patch matching, used to transfer the user's
 * datum-handle positions from the master burst frame to the other frames.
 * Frames are captured sub-second apart from a near-identical pose, so a
 * small search window around the same coordinates is enough.
 */

export interface MatchResult {
  point: Pt;
  /** NCC peak in [-1, 1]; below ~0.5 the match should be discarded. */
  score: number;
}

export function extractPatch(data: Luma, w: number, h: number, cx: number, cy: number, r: number): Float32Array | null {
  const size = 2 * r + 1;
  const x0 = Math.round(cx) - r;
  const y0 = Math.round(cy) - r;
  if (x0 < 0 || y0 < 0 || x0 + size > w || y0 + size > h) return null;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) out[y * size + x] = data[(y0 + y) * w + (x0 + x)];
  return out;
}

function nccAt(
  data: Luma,
  w: number,
  patch: Float32Array,
  size: number,
  patchMean: number,
  patchNorm: number,
  x0: number,
  y0: number,
): number {
  let sum = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) sum += data[(y0 + y) * w + (x0 + x)];
  const mean = sum / (size * size);
  let num = 0;
  let den = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dv = data[(y0 + y) * w + (x0 + x)] - mean;
      num += dv * (patch[y * size + x] - patchMean);
      den += dv * dv;
    }
  }
  const norm = Math.sqrt(den) * patchNorm;
  return norm > 1e-9 ? num / norm : 0;
}

/**
 * Find the patch (extracted around (cx,cy) in the source frame) in `data`,
 * searching ±`search` px around the same coordinates. Sub-pixel peak via
 * separable parabola fit on the NCC surface.
 */
export function matchPatch(
  data: Luma,
  w: number,
  h: number,
  patch: Float32Array,
  r: number,
  cx: number,
  cy: number,
  search: number,
): MatchResult | null {
  const size = 2 * r + 1;
  let patchSum = 0;
  for (let i = 0; i < patch.length; i++) patchSum += patch[i];
  const patchMean = patchSum / patch.length;
  let pn = 0;
  for (let i = 0; i < patch.length; i++) pn += (patch[i] - patchMean) ** 2;
  const patchNorm = Math.sqrt(pn);
  if (patchNorm < 1e-9) return null; // featureless patch

  const cxi = Math.round(cx);
  const cyi = Math.round(cy);
  const scores = new Map<string, number>();
  let best = -2;
  let bx = 0;
  let by = 0;
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      const x0 = cxi - r + dx;
      const y0 = cyi - r + dy;
      if (x0 < 0 || y0 < 0 || x0 + size > w || y0 + size > h) continue;
      const s = nccAt(data, w, patch, size, patchMean, patchNorm, x0, y0);
      scores.set(`${dx},${dy}`, s);
      if (s > best) {
        best = s;
        bx = dx;
        by = dy;
      }
    }
  }
  if (best < -1) return null;
  const at = (dx: number, dy: number) => scores.get(`${dx},${dy}`);
  let subX = 0;
  let subY = 0;
  const l = at(bx - 1, by);
  const c = at(bx, by);
  const rr = at(bx + 1, by);
  if (l !== undefined && c !== undefined && rr !== undefined) {
    const denom = l - 2 * c + rr;
    if (Math.abs(denom) > 1e-9) subX = Math.max(-0.5, Math.min(0.5, (0.5 * (l - rr)) / denom));
  }
  const u = at(bx, by - 1);
  const d = at(bx, by + 1);
  if (u !== undefined && c !== undefined && d !== undefined) {
    const denom = u - 2 * c + d;
    if (Math.abs(denom) > 1e-9) subY = Math.max(-0.5, Math.min(0.5, (0.5 * (u - d)) / denom));
  }
  return { point: { x: cxi + bx + subX, y: cyi + by + subY }, score: best };
}

/** Grayscale a frame's RGBA pixels into a compact luma buffer. */
export function toLuma(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return out;
}
