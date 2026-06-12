import { describe, expect, it } from 'vitest';
import { applyH, computeHomography, fitLineMaxDeviation, invert3x3, orderQuadCorners, reprojectionErrorRms } from '../geometry';
import type { Pt } from '../../types';

describe('computeHomography', () => {
  it('recovers an exact 4-point mapping', () => {
    // Simulated card: perspective-skewed quad in image px → 85.6×53.98 mm
    const src: Pt[] = [
      { x: 1003, y: 1497 },
      { x: 1391, y: 1488 },
      { x: 1398, y: 1743 },
      { x: 1011, y: 1749 },
    ];
    const dst: Pt[] = [
      { x: 0, y: 0 },
      { x: 85.6, y: 0 },
      { x: 85.6, y: 53.98 },
      { x: 0, y: 53.98 },
    ];
    const H = computeHomography(src, dst);
    expect(reprojectionErrorRms(H, src, dst)).toBeLessThan(1e-6);
    // Lines map to lines: any point on the image top edge lands on world y = 0.
    // (Midpoints are NOT preserved under perspective — only collinearity is.)
    const mid = applyH(H, { x: (1003 + 1391) / 2, y: (1497 + 1488) / 2 });
    expect(mid.y).toBeCloseTo(0, 4);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(85.6);
    // Forward∘inverse is identity
    const inv = invert3x3(H);
    const round = applyH(H, applyH(inv, { x: 42.8, y: 27 }));
    expect(round.x).toBeCloseTo(42.8, 6);
    expect(round.y).toBeCloseTo(27, 6);
  });

  it('solves 8-point least squares (two-marker) and measures a known width', () => {
    // Ground-truth homography: pure scale 0.5 mm/px + offset, mild projective term
    const Htrue = [0.5, 0, -100, 0, 0.5, -50, 0.00001, 0, 1];
    const project = (p: Pt) => applyH(Htrue, p);
    const markerA: Pt[] = [
      { x: 220, y: 480 },
      { x: 340, y: 480 },
      { x: 340, y: 600 },
      { x: 220, y: 600 },
    ];
    const markerB: Pt[] = [
      { x: 3420, y: 480 },
      { x: 3540, y: 480 },
      { x: 3540, y: 600 },
      { x: 3420, y: 600 },
    ];
    const src = [...markerA, ...markerB];
    const dst = src.map(project);
    const H = computeHomography(src, dst);
    expect(reprojectionErrorRms(H, src, dst)).toBeLessThan(1e-4);
    const L = applyH(H, { x: 100, y: 540 });
    const R = applyH(H, { x: 3900, y: 540 });
    const Lt = project({ x: 100, y: 540 });
    const Rt = project({ x: 3900, y: 540 });
    const width = Math.hypot(R.x - L.x, R.y - L.y);
    const truth = Math.hypot(Rt.x - Lt.x, Rt.y - Lt.y);
    expect(Math.abs(width - truth) / truth).toBeLessThan(1e-6);
  });

  it('is noise-stable at sub-pixel corner error', () => {
    const dst: Pt[] = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 60 },
      { x: 0, y: 60 },
      { x: 1600, y: 0 },
      { x: 1660, y: 0 },
      { x: 1660, y: 60 },
      { x: 1600, y: 60 },
    ];
    // 0.4 mm/px scene; deterministic pseudo-noise ±0.3 px
    const noise = [0.21, -0.13, 0.28, 0.04, -0.25, 0.3, -0.07, 0.17, 0.11, -0.29, 0.02, 0.19, -0.21, 0.08, 0.26, -0.16];
    const src = dst.map((p, i) => ({ x: p.x / 0.4 + 100 + noise[i * 2], y: p.y / 0.4 + 800 + noise[i * 2 + 1] }));
    const H = computeHomography(src, dst);
    const L = applyH(H, { x: 50 / 0.4 + 100, y: 30 / 0.4 + 800 });
    const R = applyH(H, { x: 1610 / 0.4 + 100, y: 30 / 0.4 + 800 });
    const width = Math.hypot(R.x - L.x, R.y - L.y);
    // 1560 mm true span; sub-pixel noise must stay well inside the 1% budget
    expect(Math.abs(width - 1560) / 1560).toBeLessThan(0.002);
  });
});

describe('orderQuadCorners', () => {
  it('orders shuffled corners TL TR BR BL', () => {
    const ordered = orderQuadCorners([
      { x: 500, y: 100 },
      { x: 100, y: 110 },
      { x: 110, y: 400 },
      { x: 505, y: 395 },
    ]);
    expect(ordered[0].x).toBeLessThan(ordered[1].x); // TL left of TR
    expect(ordered[0].y).toBeLessThan(ordered[3].y); // TL above BL
    expect(ordered[2].x).toBeGreaterThan(ordered[3].x); // BR right of BL
  });
});

describe('fitLineMaxDeviation', () => {
  it('reports near-zero bow for a straight edge', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i * 80, y: 500 + i * 0.5 }));
    expect(fitLineMaxDeviation(pts).maxDev).toBeLessThan(1e-9);
  });
  it('detects barrel bow', () => {
    // parabolic bow peaking at 12 px mid-frame
    const pts = Array.from({ length: 50 }, (_, i) => {
      const t = i / 49;
      return { x: t * 4000, y: 500 + 12 * 4 * t * (1 - t) };
    });
    const { maxDev } = fitLineMaxDeviation(pts);
    expect(maxDev).toBeGreaterThan(6);
    expect(maxDev).toBeLessThan(13);
  });
});
