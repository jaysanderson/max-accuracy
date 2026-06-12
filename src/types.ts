export type RefMode = 'two-marker' | 'single-marker' | 'card';
export type RefMethod = 'auto' | 'manual';
/** Blinds-fitting convention: recess = inside the opening, face = outside coverage. */
export type Datum = 'recess' | 'face';
export type Confidence = 'green' | 'amber' | 'red';

export interface Pt {
  x: number;
  y: number;
}

export interface DeviceProfile {
  id?: number;
  name: string;
  deviceModel: string;
  calibratedWidth: number;
  calibratedHeight: number;
  /** 3x3 row-major */
  cameraMatrix: number[];
  /** k1 k2 p1 p2 k3 */
  distCoeffs: number[];
  rms: number;
  createdAt: string;
  source: 'python' | 'in-browser' | 'imported';
}

export interface GateState {
  enabled: boolean;
  /** null = no signal yet (e.g. no edges detected) */
  passed: boolean | null;
  value: number | null;
  hint: string;
}

export interface CaptureMeta {
  timestamp: string;
  pitchDeg: number | null;
  rollDeg: number | null;
  convergenceDeg: number | null;
  gates: Record<'tilt' | 'edges' | 'referenceLock', GateState>;
  overridden: boolean;
  width: number;
  height: number;
  deviceLabel: string;
  captureSource: 'ImageCapture' | 'videoFrame';
  /** AF/AE/AWB were locked for the (burst) capture. */
  focusLocked: boolean;
  /** Reference span as a fraction of frame width at capture (frame-fill discipline). */
  refSpanFrac: number | null;
}

export interface QualityCheck {
  id: string;
  label: string;
  level: Confidence;
  detail: string;
}

export interface DetectedMarker {
  id: number;
  /** corners in image px, canonical order: TL TR BR BL of the marker's own frame */
  corners: Pt[];
  confidence: number;
}

export interface MeasurementRecord {
  id?: number;
  createdAt: string;
  mode: RefMode;
  refMethod: RefMethod;
  datum: Datum;
  widthMm: number;
  /** Test Mode ground truth; null outside test mode */
  trueWidthMm: number | null;
  errorMm: number | null;
  errorPct: number | null;
  confidence: Confidence;
  reasons: string[];
  reprojErrMm: number | null;
  detectionConfidence: number | null;
  profileApplied: boolean;
  profileId: number | null;
  profileName: string | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  convergenceDeg: number | null;
  overridden: boolean;
  deviceLabel: string;
  /** Free label identifying the physical window — used for cross-check grouping */
  windowLabel: string;
  markerSizeMm: number | null;
  markerSeparationMm: number | null;
  /** Burst stats: frames used and width spread across them (% of width). */
  burstCount: number;
  widthSpreadPct: number | null;
  focusLocked: boolean | null;
  refSpanFrac: number | null;
  thumb?: Blob;
}

export interface DiagnosticRecord {
  id?: number;
  createdAt: string;
  deviceLabel: string;
  bowPx: number;
  bowPctOfFrame: number;
  frameWidth: number;
  verdict: 'pre-corrected' | 'distortion-present';
  profileWasApplied: boolean;
}

export interface MeasureSetup {
  mode: RefMode;
  datum: Datum;
  markerSizeMm: number;
  markerSeparationMm: number;
  /** Test mode: harness entry with ground truth on save */
  testMode: boolean;
  windowLabel: string;
}

export interface CapturedShot {
  bitmap: ImageBitmap;
  meta: CaptureMeta;
}

/** A full burst: frame 0 is the master (displayed, marked); the rest refine the width. */
export interface CapturedBurst {
  frames: ImageBitmap[];
  meta: CaptureMeta;
}

export interface CvCapabilities {
  loaded: boolean;
  error: string | null;
  findHomography: boolean;
  undistort: boolean;
  houghLines: boolean;
  contours: boolean;
  chessboard: boolean;
  calibrate: boolean;
  cornerSubPix: boolean;
}
