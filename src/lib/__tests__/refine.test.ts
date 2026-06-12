import { describe, expect, it } from 'vitest';
import { fitLineTLS, intersectLines, snapPointsToEdge } from '../edgeSnap';
import { extractPatch, matchPatch } from '../patchMatch';
import { refineQuadCorners } from '../quadRefine';
import type { Pt } from '../../types';

/**
 * Synthetic-image fixtures: anti-aliased shapes rendered by analytic
 * supersampling (4×4 subpixel coverage), so edges have realistic sub-pixel
 * gradient profiles without any randomness.
 */

function renderPolygon(w: number, h: number, poly: Pt[], fg = 0, bg = 255): Float32Array {
  const inside = (x: number, y: number): boolean => {
    let win = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) win = !win;
    }
    return win;
  };
  const img = new Float32Array(w * h);
  // Pixel index x is the sample AT x (centre convention) — pixel area [x-0.5, x+0.5].
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let cov = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++)
          if (inside(x - 0.5 + (sx + 0.5) / 4, y - 0.5 + (sy + 0.5) / 4)) cov++;
      img[y * w + x] = bg + (fg - bg) * (cov / 16);
    }
  }
  return img;
}

/** Deterministic pseudo-random texture (LCG) for patch matching. */
function renderTexture(w: number, h: number, seed = 12345): Float32Array {
  const img = new Float32Array(w * h);
  let s = seed >>> 0;
  for (let i = 0; i < w * h; i++) {
    s = (1664525 * s + 1013904223) >>> 0;
    img[i] = (s >>> 24) & 0xff;
  }
  // smooth slightly so sub-pixel interpolation is meaningful
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      out[y * w + x] =
        (img[y * w + x] * 4 +
          img[y * w + x - 1] +
          img[y * w + x + 1] +
          img[(y - 1) * w + x] +
          img[(y + 1) * w + x]) / 8;
    }
  return out;
}

describe('snapPointsToEdge', () => {
  it('localises a straight vertical edge to sub-pixel accuracy', () => {
    // black half-plane left of x = 100.4
    const w = 200;
    const h = 100;
    const img = renderPolygon(w, h, [
      { x: -10, y: -10 },
      { x: 100.4, y: -10 },
      { x: 100.4, y: 110 },
      { x: -10, y: 110 },
    ]);
    const pts = snapPointsToEdge(img, w, h, { x: 102, y: 10 }, { x: 99, y: 90 }, 20, 6);
    for (const p of pts) expect(Math.abs(p.x - 100.4)).toBeLessThan(0.35);
  });
});

describe('fitLineTLS + intersectLines', () => {
  it('fits vertical lines (where y=mx+c fails) and intersects correctly', () => {
    const vert = fitLineTLS([
      { x: 50, y: 0 },
      { x: 50, y: 10 },
      { x: 50, y: 20 },
    ])!;
    const horiz = fitLineTLS([
      { x: 0, y: 7 },
      { x: 30, y: 7 },
      { x: 60, y: 7 },
    ])!;
    const p = intersectLines(vert, horiz)!;
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(7, 6);
  });
});

describe('refineQuadCorners', () => {
  it('recovers sub-pixel corners of a slightly rotated square from integer detections', () => {
    const w = 300;
    const h = 300;
    // true square, rotated 3°, corners at non-integer positions
    const cx = 150;
    const cy = 150;
    const half = 70;
    const rot = (3 * Math.PI) / 180;
    const truth: Pt[] = [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half },
    ].map((p) => ({
      x: cx + p.x * Math.cos(rot) - p.y * Math.sin(rot) + 0.37,
      y: cy + p.x * Math.sin(rot) + p.y * Math.cos(rot) + 0.21,
    }));
    const img = renderPolygon(w, h, truth);
    // simulate contour detection: corners rounded to integers + 1px bias
    const detected = truth.map((p, i) => ({
      x: Math.round(p.x) + (i % 2 === 0 ? 1 : -1),
      y: Math.round(p.y) + (i % 2 === 0 ? -1 : 1),
    }));
    const refined = refineQuadCorners(img, w, h, detected);
    for (let i = 0; i < 4; i++) {
      const err = Math.hypot(refined[i].x - truth[i].x, refined[i].y - truth[i].y);
      expect(err).toBeLessThan(0.25); // sub-quarter-pixel
    }
    // and strictly better than the integer detections
    for (let i = 0; i < 4; i++) {
      const before = Math.hypot(detected[i].x - truth[i].x, detected[i].y - truth[i].y);
      const after = Math.hypot(refined[i].x - truth[i].x, refined[i].y - truth[i].y);
      expect(after).toBeLessThan(before);
    }
  });

  it('returns input corners unchanged when the quad is too small to refine', () => {
    const img = new Float32Array(100 * 100).fill(128);
    const tiny: Pt[] = [
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 14, y: 14 },
      { x: 10, y: 14 },
    ];
    expect(refineQuadCorners(img, 100, 100, tiny)).toEqual(tiny);
  });
});

describe('patch matching', () => {
  it('finds a known integer shift between two frames', () => {
    const w = 400;
    const h = 300;
    const frameA = renderTexture(w, h);
    // frame B = frame A shifted by (+7, -5)
    const frameB = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = x - 7;
        const sy = y + 5;
        frameB[y * w + x] = sx >= 0 && sx < w && sy >= 0 && sy < h ? frameA[sy * w + sx] : 128;
      }
    const patch = extractPatch(frameA, w, h, 200, 150, 24)!;
    const m = matchPatch(frameB, w, h, patch, 24, 200, 150, 24)!;
    expect(m.score).toBeGreaterThan(0.95);
    expect(Math.abs(m.point.x - 207)).toBeLessThan(0.5);
    expect(Math.abs(m.point.y - 145)).toBeLessThan(0.5);
  });

  it('reports low score for a featureless region', () => {
    const flat = new Float32Array(200 * 200).fill(100);
    const patch = extractPatch(flat, 200, 200, 100, 100, 16);
    expect(patch).not.toBeNull();
    expect(matchPatch(flat, 200, 200, patch!, 16, 100, 100, 10)).toBeNull();
  });
});
