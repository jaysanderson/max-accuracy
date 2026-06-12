import { useRef, useState } from 'react';
import { BigButton, Card, Chip, Field, inputCls, Screen } from '../components/ui';
import { getConfig } from '../config';
import { db, deviceLabel, setActiveProfileId } from '../db';
import { useCamera } from '../lib/camera';
import { calibrateCamera, findChessboard, initCv } from '../lib/workerClient';
import type { Pt } from '../types';

/**
 * In-browser calibration: same checkerboard flow as the Python utility
 * (which remains the reference implementation). 15–20 shots, varied angles
 * and distances, corners pushed into the frame edges — the coverage map
 * shows where you've been.
 */

interface Shot {
  corners: Pt[];
}

export function CalibrationScreen({ onBack }: { onBack: () => void }) {
  const cfg = getConfig().calibration;
  const cam = useCamera();
  const [shots, setShots] = useState<Shot[]>([]);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastMsg, setLastMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ cameraMatrix: number[]; distCoeffs: number[]; rms: number } | null>(null);
  const [name, setName] = useState('');
  const coverageRef = useRef<HTMLCanvasElement>(null);

  function drawCoverage(all: Shot[], size: { w: number; h: number }) {
    const c = coverageRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#3f3f46';
    ctx.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
    ctx.fillStyle = 'rgba(92,229,0,0.5)';
    for (const s of all)
      for (const p of s.corners)
        ctx.fillRect((p.x / size.w) * c.width - 1, (p.y / size.h) * c.height - 1, 2.5, 2.5);
  }

  async function captureShot() {
    setBusy('Finding checkerboard…');
    setLastMsg(null);
    try {
      await initCv();
      const shot = await cam.captureFullRes();
      const canvas = document.createElement('canvas');
      canvas.width = shot.width;
      canvas.height = shot.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(shot.bitmap, 0, 0);
      shot.bitmap.close();
      if (imgSize && (imgSize.w !== canvas.width || imgSize.h !== canvas.height)) {
        setLastMsg(`Resolution changed (${canvas.width}×${canvas.height} vs ${imgSize.w}×${imgSize.h}) — shot rejected.`);
        return;
      }
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const res = await findChessboard(img, cfg.boardCols, cfg.boardRows);
      if (!res.found) {
        setLastMsg('Checkerboard not found — fill more of the frame, avoid glare, hold steady.');
        return;
      }
      const size = imgSize ?? { w: canvas.width, h: canvas.height };
      setImgSize(size);
      const next = [...shots, { corners: res.corners }];
      setShots(next);
      drawCoverage(next, size);
      setLastMsg(`Shot ${next.length} accepted (${res.corners.length} corners).`);
    } catch (e) {
      setLastMsg(e instanceof Error ? e.message : 'Detection failed');
    } finally {
      setBusy(null);
    }
  }

  async function compute() {
    if (!imgSize) return;
    setBusy('Calibrating…');
    try {
      const res = await calibrateCamera(
        imgSize.w,
        imgSize.h,
        cfg.boardCols,
        cfg.boardRows,
        cfg.squareSizeMm,
        shots.map((s) => s.corners),
      );
      setResult(res);
      setName(deviceLabel());
    } catch (e) {
      setLastMsg(e instanceof Error ? e.message : 'Calibration failed');
    } finally {
      setBusy(null);
    }
  }

  async function saveProfile() {
    if (!result || !imgSize) return;
    const id = await db.profiles.add({
      name: name.trim() || deviceLabel(),
      deviceModel: deviceLabel(),
      calibratedWidth: imgSize.w,
      calibratedHeight: imgSize.h,
      cameraMatrix: result.cameraMatrix,
      distCoeffs: result.distCoeffs,
      rms: result.rms,
      createdAt: new Date().toISOString(),
      source: 'in-browser',
    });
    setActiveProfileId(id);
    onBack();
  }

  const enough = shots.length >= cfg.minShots;

  return (
    <Screen title="In-browser calibration" onBack={onBack}>
      <Card className="mb-4">
        <p className="text-sm leading-relaxed text-zinc-300">
          Print a <strong className="text-white">{cfg.boardCols + 1}×{cfg.boardRows + 1} checkerboard</strong> ({cfg.boardCols}×{cfg.boardRows} inner
          corners, {cfg.squareSizeMm} mm squares) and take {cfg.minShots}–{cfg.targetShots} shots at varied angles and
          distances, <strong className="text-white">pushing the board into the corners of the frame</strong> — that's where distortion
          lives. The Python utility in <code className="text-brand-light">tools/calibrate</code> is the reference implementation.
        </p>
      </Card>

      <div className="relative mb-4 overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '3/4' }}>
        <video ref={cam.videoRef} playsInline muted className="absolute inset-0 h-full w-full object-contain" />
        {cam.error && <p className="absolute inset-x-4 top-1/3 text-center text-red-300">{cam.error}</p>}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="rounded-lg bg-zinc-900 px-4 py-2 text-brand-light">{busy}</p>
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center gap-4">
        <div>
          <Chip level={enough ? 'green' : 'neutral'}>
            {shots.length}/{cfg.targetShots} shots
          </Chip>
          {lastMsg && <p className="mt-2 max-w-56 text-xs text-zinc-400">{lastMsg}</p>}
        </div>
        <div className="ml-auto text-right">
          <p className="mb-1 text-xs text-zinc-500">corner coverage</p>
          <canvas ref={coverageRef} width={120} height={90} className="rounded border border-zinc-700" />
        </div>
      </div>

      <div className="flex gap-3">
        <BigButton onClick={captureShot} disabled={!cam.ready || busy !== null} className="flex-1">
          Capture shot
        </BigButton>
        <BigButton onClick={compute} disabled={!enough || busy !== null} variant="secondary" className="flex-1">
          Compute ({cfg.minShots}+ needed)
        </BigButton>
      </div>

      {result && (
        <Card className="mt-4">
          <p className="font-mono text-lg text-white">RMS {result.rms.toFixed(3)} px</p>
          <p className="mb-3 text-sm text-zinc-400">
            {result.rms < 1 ? 'Good calibration.' : 'High RMS — redo with sharper shots and better corner coverage.'}
          </p>
          <Field label="Profile name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <BigButton onClick={saveProfile} className="mt-3 w-full">
            Save & set active
          </BigButton>
        </Card>
      )}
    </Screen>
  );
}
