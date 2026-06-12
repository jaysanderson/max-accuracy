# Device calibration utility (reference implementation)

Computes a per-device lens profile (camera matrix + distortion coefficients)
that the app applies to undistort every photo **before** any measurement.
The app also has an in-browser calibration mode; this Python utility is the
reference — use it when you want maximum-quality profiles or to sanity-check
an in-browser result.

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Procedure

1. Print a checkerboard with **9×6 inner corners** (10×7 squares), e.g. from
   [calib.io](https://calib.io/pages/camera-calibration-pattern-generator) or any
   OpenCV chessboard PDF. Note the printed square size in mm (tape-measure it —
   printers lie). Tape it to something dead flat.
2. With the **same phone camera pipeline the app uses** (rear camera, full
   resolution, no zoom), take **15–20 photos** of the board:
   - varied angles (±30° tilt in all directions) and distances,
   - the board **pushed into every corner and edge of the frame** — corner
     coverage is what constrains the distortion coefficients,
   - sharp, well lit, no motion blur.
3. Transfer the photos to a computer and run:

```bash
python calibrate.py --images "shots/*.jpg" --cols 9 --rows 6 \
  --square-mm 25 --device "Pixel 8 Pro" -o pixel8pro.json
```

4. Check the RMS: **< 1.0 px is good**. If higher, reshoot with better corner
   coverage and sharper images.
5. Import the JSON in the app: **Profiles → Upload JSON** (or paste it), and
   set it active. Re-run the straight-edge diagnostic with "apply profile" to
   verify lines now come out straight.

## Notes

- The profile stores the calibration resolution; the app rescales intrinsics
  if the capture resolution differs (same aspect/crop assumed — calibrate at
  the same resolution the app captures if possible).
- One profile per device **and per camera pipeline**: if the browser switches
  lenses (ultra-wide vs main), that's a different profile.
