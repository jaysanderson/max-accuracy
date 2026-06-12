# Agentic RAG Vision (MaxAccuracy) — Phase 1: Measurement Core

Branded as **Agentic RAG Vision** (Progress Agentic RAG visual identity: green
`#5CE500`, slate `#4B4E52`, mark from The Vault `06_Media/Logos/arag-logo.svg`).
Brand colour tokens live in `src/index.css` (`@theme`); semantic colours
(amber = warning, red = error) are deliberately not branded.

Mobile-first PWA: photograph a roller blind with a reference object in frame,
get the blind **width in millimetres**. This phase builds one thing — accurate
width — and the built-in accuracy harness that proves it.

**Targets: median |error| ≤ 2% on real windows, ≤ 1% in two-marker mode.**
Baseline to beat: naive reference scaling under-read a 1970 mm blind by ~14%.

## Why the naive approach failed, and what counters each cause

| Cause | Counter in this app |
|---|---|
| Lens barrel distortion at frame edges (reference sat dead-centre where the lens is cleanest) | Straight-edge **diagnostic** per device → **calibration profile** → full-frame **undistort before any measurement** |
| Out-of-plane reference (sill, behind the blind face) | References mounted **on the blind face**; card-diagonal & two-marker scale-skew **flatness checks** |
| Scale amplification (355 mm reference × ~5.5 to span 1970 mm) | **Two-marker mode**: the known baseline spans the measurement itself |
| Undefined datum (fabric vs tube vs brackets) | Mandatory **datum selector**, stored on every measurement |
| Standing off-axis (yaw — invisible to gravity sensors) | **Live edge feedback**: detected window horizontals converge when off-axis → red lines + "step left/right" + shutter gate |
| Tilted phone | Sensor **horizon line on the scene**, ±3° shutter gate |

The pipeline is deterministic — **no LLM, nothing probabilistic touches the
number**: capture → undistort → detect reference → homography → mark datum
edges → mm.

## Run it

```bash
npm install
npm run dev        # https://<your-LAN-IP>:5173 — self-signed cert, accept the warning
npm run build      # type-check + production PWA build
npm run preview    # serve the built app (https, for phone testing)
npm test           # geometry + ArUco unit tests
```

Phones require HTTPS for camera and motion sensors — the dev/preview servers
ship with a self-signed certificate (`@vitejs/plugin-basic-ssl`). Open the
LAN URL on the phone, accept the certificate, optionally Add to Home Screen
(it's a full offline PWA; opencv.js ~10 MB is precached).

`public/opencv/opencv.js` is the official OpenCV.js 4.x single-file build,
vendored for offline use.

## The flow

1. **Home → Diagnostic** (run this first on every device): photograph a long
   straight edge spanning the frame, tap its ends; the app gradient-snaps the
   edge and reports bow in px / % of frame. Verdict stored per device:
   *pre-corrected* (profile optional) or *distortion present* (calibrate!).
2. **Profiles**: import the JSON from `tools/calibrate` (reference
   implementation, Python + OpenCV) or run the in-browser checkerboard
   calibration. Active profile is applied (undistort) before every
   measurement and shown on the measure screen.
3. **Measure**: pick reference mode + datum →
   gated capture (tilt + yaw-convergence + reference-lock; long-press
   overrides and stamps the shot amber) → auto-detect reference →
   drag the two datum-edge handles (pinch-zoom + loupe) → live width +
   green/amber/red confidence with plain-English reasons → save.
4. **Test results**: the harness. Per-mode median/p90/worst |error| against
   the targets, profile on/off A-B filter, cross-check agreement per window
   label, CSV export.

## Reference modes

- **Two ArUco markers** at known separation (default for wide blinds): print
  via **Marker sheet** (exact-mm vector PDF with a 100 mm print-scale check
  ruler), fix near each end of the blind flat on the blind face, level;
  tape-measure centre-to-centre separation and enter it. 8 correspondence
  points → homography + live reprojection error.
- **Single ArUco marker** of known size on the blind face.
- **Bank card** (ISO/IEC 7810 ID-1, 85.60 × 53.98 mm) held flat on the blind
  face; auto-detected, with tap-the-four-corners manual fallback (loupe).

ArUco detection uses the original 5×5 dictionary implemented in-house on
OpenCV primitives (adaptive threshold → quad candidates → perspective
rectify → bit decode with parity correction → sub-pixel corner refine). The
official opencv.js build doesn't bundle the ArUco module; this in-house
detector fills that gap deterministically (js-aruco2 was the alternative —
not needed). Marker rendering and decoding share `src/lib/aruco.ts` and are
round-trip unit-tested.

## Realistic accuracy ladder (phone-photogrammetry research, applied here)

| Setup | Expected | Good for |
|---|---|---|
| Single shot, bank card, calibrated | ~1–2% (20–40 mm) | quoting |
| Two markers spanning the window, calibrated, gated | ~0.5% (≈10 mm) | ordering most blinds |
| + 3-photo burst (default), focus locked, print-scale verified, frame filled | ~0.1–0.2% (2–4 mm) | manufacture-grade |
| Below ~5 mm | use a laser meter as the final check-measure | — |

The hardening that buys the bottom rows (all built in): **burst averaging**
(N frames, datum transferred by patch matching, median width + spread →
confidence), **AF/AE lock** for the burst (autofocus physically moves lens
elements and changes intrinsics), **edge-fitted sub-pixel marker corners**
(plain ArUco corner accuracy is poor; we intersect gradient-fitted edge
lines, AprilTag-style), **print-scale correction** (measure the sheet's
100 mm ruler, the app corrects marker sizes — printers run 0.5–1% off),
**frame-fill hints**, and **staleness nudges** (phone intrinsics drift;
profiles and diagnostics older than 30 days are flagged).

## Accuracy test protocol (run this before calling Phase 1 done)

1. Pick **≥ 3 windows of different widths**, including **one ≥ 1900 mm** (the
   known hard case). Tape-measure each to the millimetre — record which datum.
2. Enable **Test Mode** (Home). For each window × each mode
   (two-marker / single / card): **5 shots**, entering the tape truth on save.
   Use the same window label per window to get cross-checks.
3. Repeat the two-marker and card sets **with and without the device profile**
   (deactivate it in Profiles) on a device the diagnostic flagged as
   distorting — the harness's profile filter must show the improvement.
   Also repeat one window with `capture.burstCount` set to 1 vs 3 (Settings)
   to prove the burst-vs-single delta, and check the spread column stays
   under `quality.burstSpreadAmberPct`.
4. Open **Test results**: PASS requires median |error| ≤ 2% overall and
   ≤ 1% two-marker. Export the CSV and keep it with the device + profile.

## Acceptance criteria → where

1. Straight-edge diagnostic verdict stored per device — Diagnostic screen.
2. 1970 mm-class case within 2% (≤ ~40 mm), two-marker within 1% (≤ ~20 mm) — proven in Test results.
3. Measurable improvement with profile vs without — Test results profile filter.
4. Capture gating with plain-English reasons + long-press amber override — capture screen.
5. Red confidence iff a quality check fails, reason stated — measure screen / quality engine.
6. Marker PDF prints at true scale — on-page 100 mm check ruler.
7. Fully offline — PWA precache (including opencv.js), IndexedDB storage, no backend.

## Architecture

```
src/
  config.ts            every threshold, named, overridable at runtime (Settings)
  types.ts             shared domain types
  db.ts                Dexie: profiles / measurements / diagnostics
  lib/
    geometry.ts        homography (normalized DLT), reprojection, line fit  ← deterministic core
    aruco.ts           ArUco 5×5 dictionary encode/decode (render + detect)
    measure.ts         correspondences per mode → solve → width
    quality.ts         confidence engine (green/amber/red + reasons)
    stats.ts           median/p90, per-mode stats, cross-checks
    camera.ts          getUserMedia + ImageCapture full-res capture
    orientation.ts     gravity-derived pitch/roll (stable at upright pose)
    workerClient.ts    promise RPC to the CV worker
  workers/cv.worker.ts opencv.js (lazy, off-main-thread): detection, undistort,
                       Hough edge/yaw analysis, chessboard, calibrateCamera
  screens/             Capture · Measure · Diagnostic · Calibration · Profiles ·
                       TestLog · MarkerSheet · Settings · Home
tools/
  calibrate/           Python + OpenCV calibration (reference implementation)
  gen-icons.mjs        dependency-free PNG icon generator
```

OpenCV capability flags are detected at runtime and features degrade with a
clear message. The vendored official 4.x build was verified to provide:
`findHomography`, `initUndistortRectifyMap`/`remap` (undistort),
`Canny`/`HoughLinesP` (yaw feedback), `adaptiveThreshold`/`findContours`/
`approxPolyDP`/`warpPerspective` (detection), and `calibrateCameraExtended` —
but **not** `findChessboardCorners` or `cornerSubPix`. Consequences:

- **In-browser calibration** reports "use the Python utility" with this build —
  `tools/calibrate` is the reference implementation regardless. To enable it
  fully, replace `public/opencv/opencv.js` with a build that includes
  `findChessboardCorners` (e.g. `@techstark/opencv-js`'s `dist/opencv.js`)
  — the capability flags pick it up automatically, no code change.
- Corner refinement falls back to contour-corner precision (~1 px); on a
  4000 px frame with a two-marker baseline that's ~0.03% — well inside budget.

Homography falls back to the in-house DLT (same maths) if OpenCV is
unavailable, so card mode with manual corners works even with OpenCV down.

## Out of scope this phase

Quoting, pricing, jobs/customers, drop measurement, sync/backends, paid
services, any LLM in the measurement path.
