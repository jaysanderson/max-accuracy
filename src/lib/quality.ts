import { getConfig } from '../config';
import type { Confidence, DetectedMarker, Pt, QualityCheck, RefMode } from '../types';
import { dist } from './geometry';

/**
 * The confidence engine: every check yields a plain-English reason, the chip
 * is the worst level present. Red measurements are unusable by definition.
 */

export interface QualityInputs {
  mode: RefMode;
  pitchDeg: number | null;
  rollDeg: number | null;
  reprojErrMm: number | null;
  detectionConfidence: number | null;
  cardQuad: Pt[] | null;
  markers: DetectedMarker[];
  markerSizeMm: number | null;
  overridden: boolean;
  refMethod: 'auto' | 'manual';
}

export function runQualityChecks(q: QualityInputs): { checks: QualityCheck[]; confidence: Confidence } {
  const cfg = getConfig().quality;
  const checks: QualityCheck[] = [];

  // 1. Capture tilt
  const tilt = Math.max(Math.abs(q.pitchDeg ?? 0), Math.abs(q.rollDeg ?? 0));
  if (q.pitchDeg === null && q.rollDeg === null) {
    checks.push({
      id: 'tilt',
      label: 'Capture tilt',
      level: 'amber',
      detail: 'No orientation data at capture — tilt unknown.',
    });
  } else if (tilt > cfg.tiltRedDeg) {
    checks.push({
      id: 'tilt',
      label: 'Capture tilt',
      level: 'red',
      detail: `Phone was tilted ${tilt.toFixed(1)}° at capture (limit ${cfg.tiltRedDeg}°). Retake square-on.`,
    });
  } else if (tilt > cfg.tiltAmberDeg) {
    checks.push({
      id: 'tilt',
      label: 'Capture tilt',
      level: 'amber',
      detail: `Phone was tilted ${tilt.toFixed(1)}° at capture (target ≤ ${cfg.tiltAmberDeg}°).`,
    });
  } else {
    checks.push({ id: 'tilt', label: 'Capture tilt', level: 'green', detail: `Tilt ${tilt.toFixed(1)}° — within target.` });
  }

  // 2. Reprojection error
  if (q.reprojErrMm !== null) {
    if (q.reprojErrMm > cfg.reprojRedMm) {
      checks.push({
        id: 'reproj',
        label: 'Reference fit',
        level: 'red',
        detail: `Reprojection error ${q.reprojErrMm.toFixed(2)} mm (limit ${cfg.reprojRedMm} mm) — the reference geometry doesn't fit a flat plane. Reposition the reference and retake.`,
      });
    } else if (q.reprojErrMm > cfg.reprojAmberMm) {
      checks.push({
        id: 'reproj',
        label: 'Reference fit',
        level: 'amber',
        detail: `Reprojection error ${q.reprojErrMm.toFixed(2)} mm (target ≤ ${cfg.reprojAmberMm} mm).`,
      });
    } else {
      checks.push({
        id: 'reproj',
        label: 'Reference fit',
        level: 'green',
        detail: `Reprojection error ${q.reprojErrMm.toFixed(2)} mm.`,
      });
    }
  }

  // 3. Card flatness (diagonals of a square-on flat card are equal)
  if (q.mode === 'card' && q.cardQuad && q.cardQuad.length === 4) {
    const d1 = dist(q.cardQuad[0], q.cardQuad[2]);
    const d2 = dist(q.cardQuad[1], q.cardQuad[3]);
    const ratio = Math.abs(d1 - d2) / Math.max(d1, d2);
    if (ratio > cfg.cardDiagonalRatioTolerance) {
      checks.push({
        id: 'flatness',
        label: 'Reference flatness',
        level: 'amber',
        detail: `Card diagonals differ by ${(ratio * 100).toFixed(1)}% — the reference doesn't look flat against the wall. Press it flush to the wall face.`,
      });
    } else {
      checks.push({ id: 'flatness', label: 'Reference flatness', level: 'green', detail: 'Card looks flat against the wall.' });
    }
  }

  // 4. Two-marker plane skew: each marker implies a local mm/px scale; a flat,
  // square-on pair gives matching scales.
  if (q.mode === 'two-marker' && q.markers.length >= 2 && q.markerSizeMm) {
    const scaleOf = (m: DetectedMarker) => {
      const side =
        (dist(m.corners[0], m.corners[1]) +
          dist(m.corners[1], m.corners[2]) +
          dist(m.corners[2], m.corners[3]) +
          dist(m.corners[3], m.corners[0])) / 4;
      return q.markerSizeMm! / side; // mm per px
    };
    const sA = scaleOf(q.markers[0]);
    const sB = scaleOf(q.markers[1]);
    const mismatch = Math.abs(sA - sB) / ((sA + sB) / 2);
    if (mismatch > cfg.markerScaleMismatchTolerance) {
      checks.push({
        id: 'skew',
        label: 'Plane skew',
        level: 'amber',
        detail: `Markers imply different scales (${(mismatch * 100).toFixed(1)}% apart) — one side of the window is closer to the camera than the other, or a marker isn't flat on the wall.`,
      });
    } else {
      checks.push({ id: 'skew', label: 'Plane skew', level: 'green', detail: 'Both markers agree on scale — wall plane looks square-on.' });
    }
  }

  // 5. Detection confidence
  if (q.refMethod === 'auto' && q.detectionConfidence !== null) {
    const minConf = getConfig().reference.minDetectionConfidence;
    if (q.detectionConfidence < minConf) {
      checks.push({
        id: 'detect',
        label: 'Reference detection',
        level: 'amber',
        detail: `Reference detected with low confidence (${(q.detectionConfidence * 100).toFixed(0)}%). Check the outline matches the reference exactly, or place corners manually.`,
      });
    } else {
      checks.push({ id: 'detect', label: 'Reference detection', level: 'green', detail: 'Reference detected cleanly.' });
    }
  }
  if (q.refMethod === 'manual') {
    checks.push({
      id: 'detect',
      label: 'Reference placement',
      level: 'amber',
      detail: 'Corners were placed by hand — accuracy depends on placement. Use the loupe and zoom in.',
    });
  }

  // 6. Gating override
  if (q.overridden) {
    checks.push({
      id: 'override',
      label: 'Capture gating',
      level: 'amber',
      detail: 'Shutter gating was overridden for this shot (long-press capture).',
    });
  }

  const worst: Confidence = checks.some((c) => c.level === 'red')
    ? 'red'
    : checks.some((c) => c.level === 'amber')
      ? 'amber'
      : 'green';
  return { checks, confidence: worst };
}
