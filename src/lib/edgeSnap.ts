import type { Pt } from '../types';

/**
 * Gradient-based edge localisation, shared by the straight-edge diagnostic,
 * the sub-pixel quad refiner, and anything else that needs to find where an
 * intensity edge really is. Pure TS, deterministic, works on any luma buffer
 * (Float32Array from the diagnostic, Uint8Array from an OpenCV gray Mat).
 */

export type Luma = ArrayLike<number>;

export function lumaAt(data: Luma, w: number, h: number, x: number, y: number): number {
  const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
  return data[yi * w + xi];
}

/**
 * Bilinear luma sample — nearest-pixel rounding biases sub-pixel gradient
 * localisation by up to half a pixel; interpolation removes that.
 */
export function lumaAtBilinear(data: Luma, w: number, h: number, x: number, y: number): number {
  const xc = Math.max(0, Math.min(w - 1.001, x));
  const yc = Math.max(0, Math.min(h - 1.001, y));
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const fx = xc - x0;
  const fy = yc - y0;
  const i = y0 * w + x0;
  return (
    data[i] * (1 - fx) * (1 - fy) +
    data[i + 1] * fx * (1 - fy) +
    data[i + w] * (1 - fx) * fy +
    data[i + w + 1] * fx * fy
  );
}

/**
 * Snap N points along the chord a→b to the strongest perpendicular gradient,
 * with sub-pixel localisation via a parabola through the gradient-magnitude
 * peak. `halfRange` bounds the perpendicular search so the snap can't jump
 * to a neighbouring edge (e.g. a marker's inner cells).
 */
export function snapPointsToEdge(
  data: Luma,
  w: number,
  h: number,
  a: Pt,
  b: Pt,
  n: number,
  halfRange: number,
): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return [];
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const nx = -uy;
  const ny = ux;
  const R = Math.max(1, Math.round(halfRange));
  const out: Pt[] = [];
  const mags = new Float32Array(2 * R + 1);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const cx = a.x + (b.x - a.x) * t;
    const cy = a.y + (b.y - a.y) * t;
    let bestOff = 0;
    let bestMag = -1;
    for (let o = -R; o <= R; o++) {
      const m = Math.abs(
        lumaAtBilinear(data, w, h, cx + nx * (o + 1), cy + ny * (o + 1)) -
          lumaAtBilinear(data, w, h, cx + nx * (o - 1), cy + ny * (o - 1)),
      );
      mags[o + R] = m;
      if (m > bestMag) {
        bestMag = m;
        bestOff = o;
      }
    }
    let off = bestOff;
    const k = bestOff + R;
    if (k > 0 && k < 2 * R) {
      const denom = mags[k - 1] - 2 * mags[k] + mags[k + 1];
      if (Math.abs(denom) > 1e-6) off = bestOff + (0.5 * (mags[k - 1] - mags[k + 1])) / denom;
    }
    out.push({ x: cx + nx * off, y: cy + ny * off });
  }
  return out;
}

/** Total-least-squares line through points (PCA): returns centroid + unit direction. */
export function fitLineTLS(pts: Pt[]): { cx: number; cy: number; dx: number; dy: number } | null {
  const n = pts.length;
  if (n < 2) return null;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  // dominant eigenvector of the 2x2 covariance
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const lambda = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let dx: number;
  let dy: number;
  if (Math.abs(sxy) > 1e-12) {
    dx = lambda - syy;
    dy = sxy;
  } else if (sxx >= syy) {
    dx = 1;
    dy = 0;
  } else {
    dx = 0;
    dy = 1;
  }
  const norm = Math.hypot(dx, dy);
  if (norm < 1e-12) return null;
  return { cx, cy, dx: dx / norm, dy: dy / norm };
}

/** Intersection of two centroid+direction lines; null if near-parallel. */
export function intersectLines(
  l1: { cx: number; cy: number; dx: number; dy: number },
  l2: { cx: number; cy: number; dx: number; dy: number },
): Pt | null {
  const denom = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((l2.cx - l1.cx) * l2.dy - (l2.cy - l1.cy) * l2.dx) / denom;
  return { x: l1.cx + t * l1.dx, y: l1.cy + t * l1.dy };
}
