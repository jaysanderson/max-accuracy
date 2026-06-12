import type { Pt } from '../types';

/**
 * Deterministic geometry core. No probabilistic step touches the number:
 * capture → undistort → homography → mm. The homography here is a normalized
 * DLT solved by least squares — identical in result to cv.findHomography
 * (method 0) for the 4–8 point exact/overdetermined cases this app uses,
 * and it keeps the measurement path alive even if OpenCV fails to load.
 */

export type Mat3 = number[]; // 9, row-major

export function applyH(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

export function invert3x3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Singular matrix');
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const Hh = -(a * f - c * d);
  const I = a * e - b * d;
  return [A / det, D / det, G / det, B / det, E / det, Hh / det, C / det, F / det, I / det];
}

export function mul3x3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

/** Solve A x = b (n x n) by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error('Degenerate point configuration');
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

function normalizeTransform(pts: Pt[]): { T: Mat3; pts: Pt[] } {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const cy = pts.reduce((s, p) => s + p.y, 0) / n;
  const meanDist = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n;
  const s = meanDist > 1e-9 ? Math.SQRT2 / meanDist : 1;
  const T: Mat3 = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  return { T, pts: pts.map((p) => ({ x: s * (p.x - cx), y: s * (p.y - cy) })) };
}

/**
 * Homography mapping src → dst from N ≥ 4 correspondences.
 * Exact for 4 points; least squares (normal equations on the DLT system,
 * h33 = 1 gauge) for more. Hartley-normalized for conditioning.
 */
export function computeHomography(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length !== dst.length || src.length < 4)
    throw new Error('Need ≥4 point correspondences');
  const { T: Ts, pts: s } = normalizeTransform(src);
  const { T: Td, pts: d } = normalizeTransform(dst);

  const n = s.length;
  // Rows of the DLT system A h = b with h = [h11..h32], h33 = 1.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < n; i++) {
    const { x, y } = s[i];
    const { x: u, y: v } = d[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Normal equations: (AᵀA) h = Aᵀb
  const AtA: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb: number[] = new Array(8).fill(0);
  for (let r = 0; r < A.length; r++) {
    for (let i = 0; i < 8; i++) {
      Atb[i] += A[r][i] * b[r];
      for (let j = i; j < 8; j++) AtA[i][j] += A[r][i] * A[r][j];
    }
  }
  for (let i = 0; i < 8; i++) for (let j = 0; j < i; j++) AtA[i][j] = AtA[j][i];
  const h = solveLinear(AtA, Atb);
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // Denormalize: H = Td⁻¹ · Hn · Ts
  return mul3x3(invert3x3(Td), mul3x3(Hn, Ts));
}

/** RMS distance between H(src) and dst, in dst units. */
export function reprojectionErrorRms(H: Mat3, src: Pt[], dst: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const p = applyH(H, src[i]);
    sum += (p.x - dst[i].x) ** 2 + (p.y - dst[i].y) ** 2;
  }
  return Math.sqrt(sum / src.length);
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Least-squares line fit y = mx + c (or x = my + c for steep sets). Returns max |residual|. */
export function fitLineMaxDeviation(pts: Pt[]): { maxDev: number; meanDev: number } {
  const n = pts.length;
  if (n < 3) return { maxDev: 0, meanDev: 0 };
  const dx = Math.abs(pts[n - 1].x - pts[0].x);
  const dy = Math.abs(pts[n - 1].y - pts[0].y);
  const xs = dx >= dy ? pts.map((p) => p.x) : pts.map((p) => p.y);
  const ys = dx >= dy ? pts.map((p) => p.y) : pts.map((p) => p.x);
  const sx = xs.reduce((a, v) => a + v, 0);
  const sy = ys.reduce((a, v) => a + v, 0);
  const sxx = xs.reduce((a, v) => a + v * v, 0);
  const sxy = xs.reduce((a, v, i) => a + v * ys[i], 0);
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return { maxDev: 0, meanDev: 0 };
  const m = (n * sxy - sx * sy) / denom;
  const c = (sy - m * sx) / n;
  const norm = Math.sqrt(1 + m * m);
  let maxDev = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(ys[i] - (m * xs[i] + c)) / norm;
    sum += d;
    if (d > maxDev) maxDev = d;
  }
  return { maxDev, meanDev: sum / n };
}

/** Order 4 arbitrary quad corners as TL, TR, BR, BL (image coords, y down). */
export function orderQuadCorners(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const withAngle = pts.map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }));
  withAngle.sort((m, n) => m.a - n.a); // CCW from positive x-axis in y-down = clockwise visually
  // Rotate so the first corner is the top-left-most (min x+y)
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const s = withAngle[i].p.x + withAngle[i].p.y;
    if (s < best) {
      best = s;
      start = i;
    }
  }
  return [0, 1, 2, 3].map((i) => withAngle[(start + i) % 4].p);
}
