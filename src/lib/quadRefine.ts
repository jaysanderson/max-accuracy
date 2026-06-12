import type { Pt } from '../types';
import { fitLineTLS, intersectLines, snapPointsToEdge, type Luma } from './edgeSnap';

/**
 * AprilTag-style sub-pixel quad refinement: instead of trusting polygon
 * corners (OpenCV's docs warn plain ArUco corner accuracy "is not too high"),
 * fit a line to each edge's gradient profile and intersect adjacent lines.
 * Edge support points are far more numerous than corners, so the intersection
 * localises to a fraction of a pixel. Pure TS — also covers for the vendored
 * OpenCV build lacking cornerSubPix.
 */

const SAMPLES_PER_EDGE = 12;
/** Inset sampling away from corners, where the edge profile is rounded. */
const CORNER_INSET_FRAC = 0.18;
/** Reject a refined corner that moved implausibly far from the detection. */
const MAX_CORNER_SHIFT_PX = 3;

function inset(a: Pt, b: Pt, frac: number): { a: Pt; b: Pt } {
  return {
    a: { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac },
    b: { x: b.x + (a.x - b.x) * frac, y: b.y + (a.y - b.y) * frac },
  };
}

/**
 * Refine 4 ordered quad corners against the luma buffer. Returns the input
 * corners unchanged wherever refinement fails its sanity checks, so this is
 * always safe to apply.
 *
 * `halfRange` is clamped to stay inside an ArUco border cell (side/7) so the
 * snap cannot lock onto the marker's inner payload cells.
 */
export function refineQuadCorners(data: Luma, w: number, h: number, corners: Pt[]): Pt[] {
  if (corners.length !== 4) return corners;
  const lines: ({ cx: number; cy: number; dx: number; dy: number } | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const c0 = corners[i];
    const c1 = corners[(i + 1) % 4];
    const edgeLen = Math.hypot(c1.x - c0.x, c1.y - c0.y);
    if (edgeLen < 8) return corners; // too small to refine
    const halfRange = Math.max(2, Math.min(6, edgeLen / 7 / 3));
    const { a, b } = inset(c0, c1, CORNER_INSET_FRAC);
    const snapped = snapPointsToEdge(data, w, h, a, b, SAMPLES_PER_EDGE, halfRange);
    lines.push(snapped.length >= 4 ? fitLineTLS(snapped) : null);
  }
  const refined: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    // corner i is the intersection of edge (i-1) and edge i
    const lPrev = lines[(i + 3) % 4];
    const lCur = lines[i];
    let p: Pt | null = null;
    if (lPrev && lCur) p = intersectLines(lPrev, lCur);
    if (!p || Math.hypot(p.x - corners[i].x, p.y - corners[i].y) > MAX_CORNER_SHIFT_PX) {
      refined.push(corners[i]);
    } else {
      refined.push(p);
    }
  }
  return refined;
}
