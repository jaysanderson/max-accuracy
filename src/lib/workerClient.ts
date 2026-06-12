import type { CvCapabilities, DetectedMarker, Pt } from '../types';

/**
 * Promise RPC to the CV worker. All OpenCV work happens off the main thread;
 * the UI only ever ships ImageData across and gets numbers/points back.
 */

interface PendingEntry {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingEntry>();
let capsPromise: Promise<CvCapabilities> | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/cv.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const { id, ok, result, error } = e.data as {
      id: number;
      ok: boolean;
      result?: unknown;
      error?: string;
    };
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) entry.resolve(result);
    else entry.reject(new Error(error ?? 'CV worker error'));
  };
  worker.onerror = (e) => {
    const err = new Error(`CV worker crashed: ${e.message}`);
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
    worker = null;
    capsPromise = null;
  };
  return worker;
}

function call<T>(op: string, payload: Record<string, unknown> = {}, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  const w = getWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, op, ...payload }, transfer);
  });
}

/** Initialise OpenCV in the worker (idempotent); resolves with capability flags. */
export function initCv(): Promise<CvCapabilities> {
  if (!capsPromise) {
    capsPromise = call<CvCapabilities>('init').catch((e) => {
      capsPromise = null;
      throw e;
    });
  }
  return capsPromise;
}

export interface PreviewAnalysis {
  lines: { x1: number; y1: number; x2: number; y2: number }[];
  convergenceDeg: number | null;
  markers: DetectedMarker[];
  cardQuad: Pt[] | null;
  cardConfidence: number;
}

export function analyzePreview(
  img: ImageData,
  opts: { wantEdges: boolean; wantMarkers: boolean; wantCard: boolean },
): Promise<PreviewAnalysis> {
  return call<PreviewAnalysis>('previewAnalyze', { img, opts }, [img.data.buffer]);
}

export interface FullDetection {
  markers: DetectedMarker[];
  cardQuad: Pt[] | null;
  cardConfidence: number;
}

export function detectReference(
  img: ImageData,
  opts: { wantMarkers: boolean; wantCard: boolean },
): Promise<FullDetection> {
  return call<FullDetection>('detectFullRes', { img, opts }, [img.data.buffer]);
}

export function undistortImage(
  img: ImageData,
  cameraMatrix: number[],
  distCoeffs: number[],
  calibratedWidth: number,
  calibratedHeight: number,
): Promise<ImageData> {
  return call<ImageData>(
    'undistort',
    { img, cameraMatrix, distCoeffs, calibratedWidth, calibratedHeight },
    [img.data.buffer],
  );
}

export function findHomographyCv(src: Pt[], dst: Pt[]): Promise<{ H: number[] } | null> {
  return call<{ H: number[] } | null>('homography', { src, dst });
}

export interface ChessboardResult {
  found: boolean;
  corners: Pt[];
}

export function findChessboard(img: ImageData, cols: number, rows: number): Promise<ChessboardResult> {
  return call<ChessboardResult>('findChessboard', { img, cols, rows }, [img.data.buffer]);
}

export interface CalibrationResult {
  cameraMatrix: number[];
  distCoeffs: number[];
  rms: number;
}

export function calibrateCamera(
  imageWidth: number,
  imageHeight: number,
  cols: number,
  rows: number,
  squareSizeMm: number,
  cornerSets: Pt[][],
): Promise<CalibrationResult> {
  return call<CalibrationResult>('calibrate', {
    imageWidth,
    imageHeight,
    cols,
    rows,
    squareSizeMm,
    cornerSets,
  });
}
