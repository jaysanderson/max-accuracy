#!/usr/bin/env python3
"""
MaxAccuracy device calibration — reference implementation.

Photograph a printed checkerboard (default 9x6 INNER corners, i.e. a 10x7
square board) 15-20 times at varied angles and distances, making sure shots
push the board into the CORNERS of the frame — that's where lens distortion
lives. Shoot with the SAME camera pipeline the app uses (rear camera, full
resolution, no zoom).

Usage:
    python calibrate.py --images "shots/*.jpg" --device "Pixel 8 Pro" -o profile.json
    python calibrate.py --images "shots/*.jpg" --cols 9 --rows 6 --square-mm 25

Output JSON imports directly into the app (Profiles → Upload/Paste JSON).
"""
import argparse
import glob
import json
import sys
from datetime import datetime, timezone

import cv2
import numpy as np


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--images", required=True, help="glob of calibration shots, e.g. 'shots/*.jpg'")
    ap.add_argument("--cols", type=int, default=9, help="inner corners per row (default 9)")
    ap.add_argument("--rows", type=int, default=6, help="inner corners per column (default 6)")
    ap.add_argument("--square-mm", type=float, default=25.0, help="checkerboard square size in mm")
    ap.add_argument("--device", default="unknown", help="device model label, e.g. 'iPhone 15 Pro'")
    ap.add_argument("-o", "--output", default="profile.json", help="output profile path")
    args = ap.parse_args()

    paths = sorted(glob.glob(args.images))
    if len(paths) < 10:
        print(f"Found {len(paths)} images — need at least 10 (15-20 recommended).", file=sys.stderr)
        return 1

    pattern = (args.cols, args.rows)
    objp = np.zeros((args.cols * args.rows, 3), np.float32)
    objp[:, :2] = np.mgrid[0 : args.cols, 0 : args.rows].T.reshape(-1, 2) * args.square_mm

    obj_points, img_points = [], []
    image_size = None
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)

    for p in paths:
        img = cv2.imread(p)
        if img is None:
            print(f"  skip (unreadable): {p}")
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if image_size is None:
            image_size = gray.shape[::-1]
        elif gray.shape[::-1] != image_size:
            print(f"  skip (resolution differs): {p}")
            continue
        found, corners = cv2.findChessboardCorners(
            gray, pattern, cv2.CALIB_CB_ADAPTIVE_THRESH + cv2.CALIB_CB_NORMALIZE_IMAGE
        )
        if not found:
            print(f"  no board: {p}")
            continue
        corners = cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)
        obj_points.append(objp)
        img_points.append(corners)
        print(f"  ok: {p}")

    if len(obj_points) < 10:
        print(f"Only {len(obj_points)} usable shots — need at least 10.", file=sys.stderr)
        return 1

    rms, K, dist, rvecs, tvecs = cv2.calibrateCamera(obj_points, img_points, image_size, None, None)

    per_view = []
    for i in range(len(obj_points)):
        proj, _ = cv2.projectPoints(obj_points[i], rvecs[i], tvecs[i], K, dist)
        per_view.append(float(cv2.norm(img_points[i], proj, cv2.NORM_L2) / np.sqrt(len(proj))))

    profile = {
        "deviceModel": args.device,
        "name": args.device,
        "calibratedWidth": int(image_size[0]),
        "calibratedHeight": int(image_size[1]),
        "cameraMatrix": [float(v) for v in K.flatten()],
        "distCoeffs": [float(v) for v in dist.flatten()[:5]],  # k1 k2 p1 p2 k3
        "rms": float(rms),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "shots": len(obj_points),
        "perViewErrorPx": per_view,
    }
    with open(args.output, "w") as f:
        json.dump(profile, f, indent=2)

    print(f"\nRMS reprojection error: {rms:.4f} px ({'good' if rms < 1.0 else 'HIGH - reshoot with better coverage'})")
    print(f"Worst single view: {max(per_view):.3f} px")
    print(f"Profile written to {args.output} — import it in the app under Profiles.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
