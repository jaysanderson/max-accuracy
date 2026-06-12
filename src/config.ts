/**
 * Every threshold in the measurement pipeline is a named value here.
 * Overrides are persisted to localStorage and deep-merged over the defaults,
 * so field tuning never requires a rebuild.
 */

export interface AppConfig {
  capture: {
    /** Pitch/roll gate: shutter arms only within this tilt (degrees). */
    pitchRollThresholdDeg: number;
    /** Yaw gate: max convergence angle between detected top/bottom window edges (degrees). */
    edgeConvergenceThresholdDeg: number;
    /** Preview frames are downscaled to this height before worker analysis. */
    previewAnalysisHeight: number;
    /** Preview analysis rate (frames per second, throttled). */
    previewAnalysisFps: number;
    /** Long-press duration that fires the amber override capture (ms). */
    overrideLongPressMs: number;
    /** Ideal capture resolution requested from the camera. */
    idealCaptureWidth: number;
    idealCaptureHeight: number;
  };
  gates: {
    /** Each gate individually toggleable. */
    tilt: boolean;
    edges: boolean;
    referenceLock: boolean;
  };
  reference: {
    /** ISO/IEC 7810 ID-1 card, mm. */
    cardWidthMm: number;
    cardHeightMm: number;
    /** Default printed ArUco marker side length, mm. Markers mount on the wall plane beside the window. */
    defaultMarkerSizeMm: number;
    /** Default centre-to-centre separation for two-marker mode, mm. */
    defaultMarkerSeparationMm: number;
    /** Below this detection score the reference is treated as not locked / low confidence. */
    minDetectionConfidence: number;
    /** Marker ids printed on the sheet and expected in the field. */
    markerIdA: number;
    markerIdB: number;
    markerIdSingle: number;
  };
  quality: {
    /** Reprojection error (mm RMS in the blind plane): above amber → amber, above red → red. */
    reprojAmberMm: number;
    reprojRedMm: number;
    /** Capture tilt: above amber → amber, above red → red (degrees). */
    tiltAmberDeg: number;
    tiltRedDeg: number;
    /** Card diagonals differing more than this fraction → "reference doesn't look flat". */
    cardDiagonalRatioTolerance: number;
    /** Two-marker implied local scale mismatch beyond this fraction → plane skew warning. */
    markerScaleMismatchTolerance: number;
    /** Cross-check agreement tolerance, percent of width. */
    crossCheckTolerancePct: number;
  };
  diagnostic: {
    /** Edge bow above this % of frame width → verdict "distortion present". */
    bowVerdictPctOfFrame: number;
    /** Number of sample points along the tapped edge. */
    samplePoints: number;
    /** Perpendicular search half-range for the strongest gradient (px). */
    gradientSearchHalfRangePx: number;
  };
  calibration: {
    boardCols: number; // inner corners
    boardRows: number; // inner corners
    squareSizeMm: number;
    minShots: number;
    targetShots: number;
  };
  targets: {
    /** Accuracy targets the harness reports against (median |error| %). */
    overallMedianErrPct: number;
    twoMarkerMedianErrPct: number;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  capture: {
    pitchRollThresholdDeg: 3,
    edgeConvergenceThresholdDeg: 1.5,
    previewAnalysisHeight: 480,
    previewAnalysisFps: 4,
    overrideLongPressMs: 800,
    idealCaptureWidth: 4096,
    idealCaptureHeight: 3072,
  },
  gates: { tilt: true, edges: true, referenceLock: true },
  reference: {
    cardWidthMm: 85.6,
    cardHeightMm: 53.98,
    defaultMarkerSizeMm: 60,
    defaultMarkerSeparationMm: 1600,
    minDetectionConfidence: 0.5,
    markerIdA: 0,
    markerIdB: 1,
    markerIdSingle: 2,
  },
  quality: {
    reprojAmberMm: 1.0,
    reprojRedMm: 3.0,
    tiltAmberDeg: 3,
    tiltRedDeg: 6,
    cardDiagonalRatioTolerance: 0.05,
    markerScaleMismatchTolerance: 0.06,
    crossCheckTolerancePct: 1.0,
  },
  diagnostic: {
    bowVerdictPctOfFrame: 0.1,
    samplePoints: 60,
    gradientSearchHalfRangePx: 25,
  },
  calibration: {
    boardCols: 9,
    boardRows: 6,
    squareSizeMm: 25,
    minShots: 15,
    targetShots: 20,
  },
  targets: {
    overallMedianErrPct: 2.0,
    twoMarkerMedianErrPct: 1.0,
  },
};

const STORAGE_KEY = 'maxaccuracy.config.overrides.v1';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base as unknown) || !isObj(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of Object.keys(over)) {
    const bv = (base as Record<string, unknown>)[k];
    out[k] = deepMerge(bv as unknown, (over as Record<string, unknown>)[k]) as unknown;
  }
  return out as T;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  let overrides: unknown = {};
  try {
    overrides = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    overrides = {};
  }
  cached = deepMerge(structuredClone(DEFAULT_CONFIG), overrides);
  return cached;
}

/** Replace overrides wholesale (Settings screen) and refresh the cache. */
export function saveOverrides(overrides: Partial<AppConfig>): AppConfig {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  cached = null;
  return getConfig();
}

export function resetConfig(): AppConfig {
  localStorage.removeItem(STORAGE_KEY);
  cached = null;
  return getConfig();
}

export function getOverridesRaw(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '{}';
}
