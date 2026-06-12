import { getConfig } from '../config';
import type { DetectedMarker, Pt, RefMode } from '../types';
import { applyH, computeHomography, dist, reprojectionErrorRms, type Mat3 } from './geometry';
import { findHomographyCv } from './workerClient';

/**
 * Builds image↔mm correspondences for each reference mode and solves the
 * homography. World frame: mm, x right, y down, in the blind plane.
 *
 * Two-marker assumption (stated on the marker sheet): markers are level and
 * their centres are horizontally aligned at the entered separation. Any
 * violation shows up directly in the reprojection error.
 */

export interface ReferenceSolution {
  H: Mat3; // image px → mm
  reprojErrMm: number;
  nPoints: number;
}

function markerWorldCorners(centreX: number, sizeMm: number): Pt[] {
  const h = sizeMm / 2;
  return [
    { x: centreX - h, y: -h },
    { x: centreX + h, y: -h },
    { x: centreX + h, y: h },
    { x: centreX - h, y: h },
  ];
}

export function buildCorrespondences(
  mode: RefMode,
  opts: {
    markers?: DetectedMarker[];
    cardQuad?: Pt[] | null;
    markerSizeMm?: number;
    markerSeparationMm?: number;
  },
): { src: Pt[]; dst: Pt[] } {
  const cfg = getConfig().reference;
  if (mode === 'card') {
    if (!opts.cardQuad || opts.cardQuad.length !== 4) throw new Error('No card corners');
    return {
      src: opts.cardQuad,
      dst: [
        { x: 0, y: 0 },
        { x: cfg.cardWidthMm, y: 0 },
        { x: cfg.cardWidthMm, y: cfg.cardHeightMm },
        { x: 0, y: cfg.cardHeightMm },
      ],
    };
  }
  // Printed markers inherit the printer's scale error (0.5–1% is common);
  // printScaleFactor is set from a tape measurement of the sheet's check ruler.
  const size = (opts.markerSizeMm ?? cfg.defaultMarkerSizeMm) * cfg.printScaleFactor;
  const markers = opts.markers ?? [];
  if (mode === 'single-marker') {
    if (markers.length < 1) throw new Error('No marker detected');
    return { src: markers[0].corners, dst: markerWorldCorners(0, size) };
  }
  // two-marker
  if (markers.length < 2) throw new Error('Need both markers detected');
  const sep = opts.markerSeparationMm ?? cfg.defaultMarkerSeparationMm;
  // Left-most marker in the image is marker A at world x = 0
  const sorted = [...markers]
    .sort((a, b) => a.corners.reduce((s, p) => s + p.x, 0) - b.corners.reduce((s, p) => s + p.x, 0))
    .slice(0, 2);
  return {
    src: [...sorted[0].corners, ...sorted[1].corners],
    dst: [...markerWorldCorners(0, size), ...markerWorldCorners(sep, size)],
  };
}

export async function solveReference(src: Pt[], dst: Pt[]): Promise<ReferenceSolution> {
  let H: Mat3;
  try {
    const res = await findHomographyCv(src, dst);
    H = res?.H ?? computeHomography(src, dst);
  } catch {
    // Worker/OpenCV down — the deterministic TS DLT keeps the path alive.
    H = computeHomography(src, dst);
  }
  return { H, reprojErrMm: reprojectionErrorRms(H, src, dst), nPoints: src.length };
}

/** Width between two image-space datum handles, measured in the window/wall plane. */
export function widthBetween(H: Mat3, left: Pt, right: Pt): number {
  return dist(applyH(H, left), applyH(H, right));
}
