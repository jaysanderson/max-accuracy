/// <reference lib="webworker" />
/**
 * CV worker: owns OpenCV (loaded from /opencv/opencv.js via fetch + indirect
 * eval — it's a classic UMD script, and module workers can't importScripts).
 * Everything probabilistic-free: thresholds → contours → quads → decode →
 * subpixel refine → homography. Capability flags are detected at runtime
 * because the docs build's whitelist isn't guaranteed.
 */
import { decodeMarkerBits } from '../lib/aruco';
import { computeHomography, orderQuadCorners } from '../lib/geometry';
import { refineQuadCorners } from '../lib/quadRefine';
import type { CvCapabilities, DetectedMarker, Pt } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvMat = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cv: any = null;
let caps: CvCapabilities = {
  loaded: false,
  error: null,
  findHomography: false,
  undistort: false,
  houghLines: false,
  contours: false,
  chessboard: false,
  calibrate: false,
  cornerSubPix: false,
};

async function loadCv(): Promise<CvCapabilities> {
  if (caps.loaded || caps.error) return caps;
  try {
    const res = await fetch('/opencv/opencv.js');
    if (!res.ok) throw new Error(`fetch opencv.js: HTTP ${res.status}`);
    const src = await res.text();
    // Indirect eval → runs at global scope; the UMD assigns globalThis.cv.
    (0, eval)(src);
    let g = (globalThis as Record<string, unknown>).cv as any;
    if (!g) throw new Error('opencv.js did not define global cv');
    if (typeof g.then === 'function') {
      // Emscripten's Module.then resolves with the module ITSELF, which is
      // thenable — a bare `await g` recurses forever. Resolve manually and
      // strip `then` before handing it to the promise machinery.
      g = await new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('OpenCV runtime init timeout')), 30000);
        g.then((m: any) => {
          clearTimeout(t);
          try {
            delete m.then;
          } catch {
            /* sealed module */
          }
          resolve(m);
        });
      });
    } else if (!g.Mat) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('OpenCV runtime init timeout')), 30000);
        g.onRuntimeInitialized = () => {
          clearTimeout(t);
          resolve();
        };
      });
    }
    cv = g;
    caps = {
      loaded: true,
      error: null,
      findHomography: typeof cv.findHomography === 'function',
      undistort:
        typeof cv.initUndistortRectifyMap === 'function' && typeof cv.remap === 'function',
      houghLines: typeof cv.HoughLinesP === 'function' && typeof cv.Canny === 'function',
      contours:
        typeof cv.findContours === 'function' &&
        typeof cv.adaptiveThreshold === 'function' &&
        typeof cv.approxPolyDP === 'function' &&
        typeof cv.warpPerspective === 'function',
      chessboard: typeof cv.findChessboardCorners === 'function',
      calibrate:
        typeof cv.calibrateCameraExtended === 'function' ||
        typeof cv.calibrateCamera === 'function',
      cornerSubPix: typeof cv.cornerSubPix === 'function',
    };
  } catch (e) {
    caps = { ...caps, loaded: false, error: e instanceof Error ? e.message : String(e) };
  }
  return caps;
}

function matFromImageData(img: ImageData): CvMat {
  return cv.matFromImageData(img);
}

function toGray(rgba: CvMat): CvMat {
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  return gray;
}

function freeAll(...mats: CvMat[]): void {
  for (const m of mats) {
    try {
      m?.delete?.();
    } catch {
      /* already freed */
    }
  }
}

// ---------------------------------------------------------------------------
// Quad candidates (shared by ArUco + card detection)
// ---------------------------------------------------------------------------

interface QuadCandidate {
  corners: Pt[]; // ordered TL TR BR BL
  area: number;
}

function findQuadCandidates(gray: CvMat, minAreaFrac: number, maxAreaFrac: number): QuadCandidate[] {
  const out: QuadCandidate[] = [];
  const frameArea = gray.cols * gray.rows;
  const bin = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 23, 7);
    cv.findContours(bin, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const approx = new cv.Mat();
      try {
        const area = Math.abs(cv.contourArea(cnt));
        if (area < frameArea * minAreaFrac || area > frameArea * maxAreaFrac) continue;
        const peri = cv.arcLength(cnt, true);
        cv.approxPolyDP(cnt, approx, 0.03 * peri, true);
        if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
        const d = approx.data32S as Int32Array;
        const pts: Pt[] = [
          { x: d[0], y: d[1] },
          { x: d[2], y: d[3] },
          { x: d[4], y: d[5] },
          { x: d[6], y: d[7] },
        ];
        out.push({ corners: orderQuadCorners(pts), area });
      } finally {
        freeAll(approx, cnt);
      }
    }
  } finally {
    freeAll(bin, hierarchy, contours);
  }
  // Largest first; dedupe near-identical quads (nested contours of the same shape)
  out.sort((a, b) => b.area - a.area);
  const dedup: QuadCandidate[] = [];
  for (const q of out) {
    const cx = q.corners.reduce((s, p) => s + p.x, 0) / 4;
    const cy = q.corners.reduce((s, p) => s + p.y, 0) / 4;
    const dup = dedup.some((d2) => {
      const cx2 = d2.corners.reduce((s, p) => s + p.x, 0) / 4;
      const cy2 = d2.corners.reduce((s, p) => s + p.y, 0) / 4;
      return Math.hypot(cx - cx2, cy - cy2) < Math.sqrt(d2.area) * 0.2;
    });
    if (!dup) dedup.push(q);
  }
  return dedup.slice(0, 40);
}

// ---------------------------------------------------------------------------
// ArUco detection (original 5×5 dictionary) on OpenCV primitives
// ---------------------------------------------------------------------------

const WARP_SIZE = 70; // 7 cells × 10 px

function sampleCells(warpedGray: CvMat): number[][] {
  // Otsu threshold the rectified marker, then majority-vote each cell's inner 6×6 px.
  const bin = new cv.Mat();
  try {
    cv.threshold(warpedGray, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    const data = bin.data as Uint8Array;
    const cells: number[][] = [];
    for (let r = 0; r < 7; r++) {
      const row: number[] = [];
      for (let c = 0; c < 7; c++) {
        let white = 0;
        for (let y = r * 10 + 2; y < r * 10 + 8; y++)
          for (let x = c * 10 + 2; x < c * 10 + 8; x++) if (data[y * WARP_SIZE + x] > 127) white++;
        row.push(white >= 18 ? 1 : 0); // ≥ half of 36 sampled px
      }
      cells.push(row);
    }
    return cells;
  } finally {
    freeAll(bin);
  }
}

function refineCorners(gray: CvMat, corners: Pt[]): Pt[] {
  // AprilTag-style edge-line intersection — sub-pixel, deterministic, and
  // independent of cornerSubPix (absent from the vendored OpenCV build).
  return refineQuadCorners(gray.data as Uint8Array, gray.cols, gray.rows, corners);
}

function detectArucoMarkers(gray: CvMat, refine: boolean): DetectedMarker[] {
  const found: DetectedMarker[] = [];
  const candidates = findQuadCandidates(gray, 0.0002, 0.3);
  for (const cand of candidates) {
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, cand.corners.flatMap((p) => [p.x, p.y]));
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, WARP_SIZE, 0, WARP_SIZE, WARP_SIZE, 0, WARP_SIZE,
    ]);
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const warped = new cv.Mat();
    try {
      cv.warpPerspective(gray, warped, M, new cv.Size(WARP_SIZE, WARP_SIZE));
      const cells = sampleCells(warped);
      // Border must be black (all 24 border cells 0); tolerate 2 noisy cells.
      let borderWhite = 0;
      for (let i = 0; i < 7; i++) {
        borderWhite += cells[0][i] + cells[6][i];
        if (i > 0 && i < 6) borderWhite += cells[i][0] + cells[i][6];
      }
      if (borderWhite > 2) continue;
      const payload = cells.slice(1, 6).map((row) => row.slice(1, 6));
      const decoded = decodeMarkerBits(payload, 1);
      if (!decoded) continue;
      // Rotate corners so corner[0] is the marker's canonical top-left.
      const k = decoded.rotations;
      let corners = [0, 1, 2, 3].map((i) => cand.corners[(i + 4 - k) % 4]);
      if (refine) corners = refineCorners(gray, corners);
      const confidence = decoded.distance === 0 ? 1 : 0.7;
      if (!found.some((m) => m.id === decoded.id)) found.push({ id: decoded.id, corners, confidence });
    } finally {
      freeAll(srcTri, dstTri, M, warped);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Bank card quad detection (ISO ID-1, aspect 85.60 / 53.98 ≈ 1.586)
// ---------------------------------------------------------------------------

const CARD_ASPECT = 85.6 / 53.98;

function detectCard(gray: CvMat, refine: boolean): { quad: Pt[] | null; confidence: number } {
  // Cards are smooth rounded rects against the blind: edge-based candidates work
  // better than threshold here, so try Canny-derived contours as well.
  const candidates: QuadCandidate[] = findQuadCandidates(gray, 0.005, 0.6);

  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.Canny(gray, edges, 50, 150);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, kernel);
    kernel.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const frameArea = gray.cols * gray.rows;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const approx = new cv.Mat();
      try {
        const area = Math.abs(cv.contourArea(cnt));
        if (area < frameArea * 0.005 || area > frameArea * 0.6) continue;
        const peri = cv.arcLength(cnt, true);
        cv.approxPolyDP(cnt, approx, 0.03 * peri, true);
        if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
        const d = approx.data32S as Int32Array;
        const pts: Pt[] = [
          { x: d[0], y: d[1] },
          { x: d[2], y: d[3] },
          { x: d[4], y: d[5] },
          { x: d[6], y: d[7] },
        ];
        candidates.push({ corners: orderQuadCorners(pts), area });
      } finally {
        freeAll(approx, cnt);
      }
    }
  } catch {
    /* Canny path optional */
  } finally {
    freeAll(edges, hierarchy, contours);
  }

  let best: Pt[] | null = null;
  let bestScore = 0;
  for (const cand of candidates) {
    const [tl, tr, br, bl] = cand.corners;
    const top = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const bottom = Math.hypot(br.x - bl.x, br.y - bl.y);
    const left = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const right = Math.hypot(br.x - tr.x, br.y - tr.y);
    const w = (top + bottom) / 2;
    const h = (left + right) / 2;
    if (w < 4 || h < 4) continue;
    const aspect = w / h;
    // Accept landscape or portrait card
    const aspectErr = Math.min(
      Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT,
      Math.abs(1 / aspect - CARD_ASPECT) / CARD_ASPECT,
    );
    if (aspectErr > 0.2) continue;
    const sideConsistency =
      1 - (Math.abs(top - bottom) / Math.max(top, bottom) + Math.abs(left - right) / Math.max(left, right)) / 2;
    const score = (1 - aspectErr) * 0.6 + sideConsistency * 0.4;
    if (score > bestScore) {
      bestScore = score;
      // Normalise to landscape orientation: if portrait, rotate corner order
      best = aspect >= 1 ? cand.corners : [cand.corners[3], cand.corners[0], cand.corners[1], cand.corners[2]];
    }
  }
  if (best && refine) best = refineCorners(gray, best);
  return { quad: best, confidence: best ? bestScore : 0 };
}

// ---------------------------------------------------------------------------
// Live edge feedback (yaw): horizontal structure convergence
// ---------------------------------------------------------------------------

interface EdgeAnalysis {
  lines: { x1: number; y1: number; x2: number; y2: number }[];
  convergenceDeg: number | null;
}

function analyzeEdges(gray: CvMat): EdgeAnalysis {
  if (!caps.houghLines) return { lines: [], convergenceDeg: null };
  const edges = new cv.Mat();
  const lines = new cv.Mat();
  try {
    cv.Canny(gray, edges, 60, 160);
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 40, gray.cols * 0.25, 12);
    const segs: { x1: number; y1: number; x2: number; y2: number; angle: number; len: number; midY: number }[] = [];
    const d = lines.data32S as Int32Array;
    for (let i = 0; i < lines.rows; i++) {
      const x1 = d[i * 4];
      const y1 = d[i * 4 + 1];
      const x2 = d[i * 4 + 2];
      const y2 = d[i * 4 + 3];
      let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      if (Math.abs(angle) > 30) continue; // near-horizontal structure only
      segs.push({ x1, y1, x2, y2, angle, len: Math.hypot(x2 - x1, y2 - y1), midY: (y1 + y2) / 2 });
    }
    segs.sort((a, b) => b.len - a.len);
    const kept = segs.slice(0, 20);
    const h = gray.rows;
    const top = kept.filter((s) => s.midY < h * 0.45);
    const bottom = kept.filter((s) => s.midY > h * 0.55);
    let convergenceDeg: number | null = null;
    if (top.length && bottom.length) {
      const wmean = (arr: typeof kept) =>
        arr.reduce((s, l) => s + l.angle * l.len, 0) / arr.reduce((s, l) => s + l.len, 0);
      // y-down: camera left of square-on → right side farther → top slopes down-right
      // (positive), bottom slopes up-right (negative) → convergence > 0 → "step right".
      convergenceDeg = wmean(top) - wmean(bottom);
    }
    return {
      lines: kept.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
      convergenceDeg,
    };
  } finally {
    freeAll(edges, lines);
  }
}

// ---------------------------------------------------------------------------
// Undistort
// ---------------------------------------------------------------------------

function undistortImageData(
  img: ImageData,
  cameraMatrix: number[],
  distCoeffs: number[],
  calibratedWidth: number,
  calibratedHeight: number,
): ImageData {
  if (!caps.undistort) throw new Error('This OpenCV build lacks initUndistortRectifyMap/remap');
  // Intrinsics scale linearly with resolution (same sensor crop assumed).
  const sx = img.width / calibratedWidth;
  const sy = img.height / calibratedHeight;
  const K = [...cameraMatrix];
  K[0] *= sx; // fx
  K[2] *= sx; // cx
  K[4] *= sy; // fy
  K[5] *= sy; // cy

  const src = matFromImageData(img);
  const dst = new cv.Mat();
  const Kmat = cv.matFromArray(3, 3, cv.CV_64F, K);
  const D = cv.matFromArray(1, distCoeffs.length, cv.CV_64F, distCoeffs);
  const R = cv.Mat.eye(3, 3, cv.CV_64F);
  const map1 = new cv.Mat();
  const map2 = new cv.Mat();
  try {
    const size = new cv.Size(img.width, img.height);
    cv.initUndistortRectifyMap(Kmat, D, R, Kmat, size, cv.CV_16SC2, map1, map2);
    cv.remap(src, dst, map1, map2, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 255));
    return new ImageData(new Uint8ClampedArray(dst.data), dst.cols, dst.rows);
  } finally {
    freeAll(src, dst, Kmat, D, R, map1, map2);
  }
}

// ---------------------------------------------------------------------------
// Chessboard + calibration
// ---------------------------------------------------------------------------

function findChessboardInImage(img: ImageData, cols: number, rows: number): { found: boolean; corners: Pt[] } {
  if (!caps.chessboard) throw new Error('This OpenCV build lacks findChessboardCorners — use the Python utility');
  const rgba = matFromImageData(img);
  const gray = toGray(rgba);
  const corners = new cv.Mat();
  try {
    let flags = 0;
    if (typeof cv.CALIB_CB_ADAPTIVE_THRESH === 'number') flags += cv.CALIB_CB_ADAPTIVE_THRESH;
    if (typeof cv.CALIB_CB_NORMALIZE_IMAGE === 'number') flags += cv.CALIB_CB_NORMALIZE_IMAGE;
    const found: boolean = cv.findChessboardCorners(gray, new cv.Size(cols, rows), corners, flags);
    if (!found) return { found: false, corners: [] };
    if (caps.cornerSubPix) {
      try {
        const criteria = new cv.TermCriteria(cv.TermCriteria_EPS + cv.TermCriteria_COUNT, 30, 0.001);
        cv.cornerSubPix(gray, corners, new cv.Size(11, 11), new cv.Size(-1, -1), criteria);
      } catch {
        /* keep unrefined corners */
      }
    }
    const d = corners.data32F as Float32Array;
    const pts: Pt[] = [];
    for (let i = 0; i < corners.rows; i++) pts.push({ x: d[i * 2], y: d[i * 2 + 1] });
    return { found: true, corners: pts };
  } finally {
    freeAll(rgba, gray, corners);
  }
}

function calibrateFromCorners(
  imageWidth: number,
  imageHeight: number,
  cols: number,
  rows: number,
  squareSizeMm: number,
  cornerSets: Pt[][],
): { cameraMatrix: number[]; distCoeffs: number[]; rms: number } {
  if (!caps.calibrate) throw new Error('This OpenCV build lacks calibrateCamera — use the Python utility');
  const objectPoints = new cv.MatVector();
  const imagePoints = new cv.MatVector();
  const mats: CvMat[] = [];
  try {
    const objFlat: number[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) objFlat.push(c * squareSizeMm, r * squareSizeMm, 0);
    for (const set of cornerSets) {
      const obj = cv.matFromArray(cols * rows, 1, cv.CV_32FC3, objFlat);
      const imgM = cv.matFromArray(set.length, 1, cv.CV_32FC2, set.flatMap((p) => [p.x, p.y]));
      mats.push(obj, imgM);
      objectPoints.push_back(obj);
      imagePoints.push_back(imgM);
    }
    const K = new cv.Mat();
    const D = new cv.Mat();
    const rvecs = new cv.MatVector();
    const tvecs = new cv.MatVector();
    mats.push(K, D);
    const size = new cv.Size(imageWidth, imageHeight);
    let rms: number;
    if (typeof cv.calibrateCameraExtended === 'function') {
      const stdInt = new cv.Mat();
      const stdExt = new cv.Mat();
      const perView = new cv.Mat();
      mats.push(stdInt, stdExt, perView);
      rms = cv.calibrateCameraExtended(
        objectPoints, imagePoints, size, K, D, rvecs, tvecs, stdInt, stdExt, perView, 0,
      );
    } else {
      rms = cv.calibrateCamera(objectPoints, imagePoints, size, K, D, rvecs, tvecs, 0);
    }
    const Kout = Array.from(K.data64F as Float64Array);
    const Dall = Array.from(D.data64F as Float64Array);
    rvecs.delete();
    tvecs.delete();
    return { cameraMatrix: Kout, distCoeffs: Dall.slice(0, 5), rms };
  } finally {
    freeAll(...mats, objectPoints, imagePoints);
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

interface WorkerMsg {
  id: number;
  op: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

self.onmessage = async (e: MessageEvent<WorkerMsg>) => {
  const { id, op } = e.data;
  const post = (ok: boolean, result?: unknown, error?: string, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage({ id, ok, result, error }, transfer);
  try {
    if (op === 'init') {
      post(true, await loadCv());
      return;
    }
    await loadCv();

    if (op === 'homography') {
      // Prefer cv.findHomography (least squares); TS DLT is the always-available equivalent.
      const { src, dst } = e.data as unknown as { src: Pt[]; dst: Pt[] };
      if (caps.findHomography) {
        const srcM = cv.matFromArray(src.length, 1, cv.CV_32FC2, src.flatMap((p: Pt) => [p.x, p.y]));
        const dstM = cv.matFromArray(dst.length, 1, cv.CV_32FC2, dst.flatMap((p: Pt) => [p.x, p.y]));
        try {
          const H = cv.findHomography(srcM, dstM, 0);
          if (H && !H.empty()) {
            const arr = Array.from(H.data64F as Float64Array);
            H.delete();
            post(true, { H: arr });
            return;
          }
          H?.delete?.();
        } finally {
          freeAll(srcM, dstM);
        }
      }
      post(true, { H: computeHomography(src, dst) });
      return;
    }

    if (!caps.loaded) throw new Error(`OpenCV unavailable: ${caps.error ?? 'unknown'}`);

    switch (op) {
      case 'previewAnalyze': {
        const { img, opts } = e.data;
        const rgba = matFromImageData(img);
        const gray = toGray(rgba);
        try {
          const edgeRes = opts.wantEdges && caps.houghLines ? analyzeEdges(gray) : { lines: [], convergenceDeg: null };
          const markers = opts.wantMarkers && caps.contours ? detectArucoMarkers(gray, false) : [];
          const card = opts.wantCard && caps.contours ? detectCard(gray, false) : { quad: null, confidence: 0 };
          post(true, {
            lines: edgeRes.lines,
            convergenceDeg: edgeRes.convergenceDeg,
            markers,
            cardQuad: card.quad,
            cardConfidence: card.confidence,
            frameW: img.width,
            frameH: img.height,
          });
        } finally {
          freeAll(rgba, gray);
        }
        return;
      }
      case 'detectFullRes': {
        const { img, opts } = e.data;
        const rgba = matFromImageData(img);
        const gray = toGray(rgba);
        try {
          const markers = opts.wantMarkers ? detectArucoMarkers(gray, true) : [];
          const card = opts.wantCard ? detectCard(gray, true) : { quad: null, confidence: 0 };
          post(true, { markers, cardQuad: card.quad, cardConfidence: card.confidence });
        } finally {
          freeAll(rgba, gray);
        }
        return;
      }
      case 'undistort': {
        const { img, cameraMatrix, distCoeffs, calibratedWidth, calibratedHeight } = e.data;
        const out = undistortImageData(img, cameraMatrix, distCoeffs, calibratedWidth, calibratedHeight);
        post(true, out, undefined, [out.data.buffer]);
        return;
      }
      case 'findChessboard': {
        const { img, cols, rows } = e.data;
        post(true, findChessboardInImage(img, cols, rows));
        return;
      }
      case 'calibrate': {
        const { imageWidth, imageHeight, cols, rows, squareSizeMm, cornerSets } = e.data;
        post(true, calibrateFromCorners(imageWidth, imageHeight, cols, rows, squareSizeMm, cornerSets));
        return;
      }
      default:
        throw new Error(`Unknown op: ${op}`);
    }
  } catch (err) {
    post(false, undefined, err instanceof Error ? err.message : String(err));
  }
};
