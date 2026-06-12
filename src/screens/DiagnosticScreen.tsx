import { useRef, useState } from 'react';
import { BigButton, Card, Chip, Screen } from '../components/ui';
import { getConfig } from '../config';
import { db, deviceLabel, getActiveProfile } from '../db';
import { useCamera } from '../lib/camera';
import { fitLineMaxDeviation } from '../lib/geometry';
import { undistortImage } from '../lib/workerClient';
import type { Pt } from '../types';

/**
 * Straight-edge diagnostic: photograph a long straight edge spanning the full
 * frame width, tap its two ends, and the app snaps sample points to the
 * strongest local gradient, fits a line, and reports bow. Verdict per device:
 * "pre-corrected" (profile optional) or "distortion present" (calibration
 * required). This screen gates everything — run it before trusting any phone.
 */

type Stage = 'camera' | 'tap' | 'result';

export function DiagnosticScreen({ onBack }: { onBack: () => void }) {
  const cfg = getConfig().diagnostic;
  const cam = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const grayRef = useRef<{ data: Float32Array; w: number; h: number } | null>(null);
  const [stage, setStage] = useState<Stage>('camera');
  const [taps, setTaps] = useState<Pt[]>([]);
  const [applyProfile, setApplyProfile] = useState(false);
  const [profileUsed, setProfileUsed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    bowPx: number;
    bowPct: number;
    verdict: 'pre-corrected' | 'distortion-present';
    samples: Pt[];
  } | null>(null);

  async function capture() {
    setBusy(true);
    try {
      const shot = await cam.captureFullRes();
      const canvas = canvasRef.current!;
      canvas.width = shot.width;
      canvas.height = shot.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(shot.bitmap, 0, 0);
      shot.bitmap.close();

      let usedProfile: string | null = null;
      if (applyProfile) {
        const prof = await getActiveProfile();
        if (prof) {
          try {
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const out = await undistortImage(img, prof.cameraMatrix, prof.distCoeffs, prof.calibratedWidth, prof.calibratedHeight);
            ctx.putImageData(out, 0, 0);
            usedProfile = prof.name;
          } catch {
            usedProfile = null;
          }
        }
      }
      setProfileUsed(usedProfile);

      // Grayscale cache for gradient snapping
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const g = new Float32Array(canvas.width * canvas.height);
      const d = img.data;
      for (let i = 0; i < g.length; i++) {
        g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      }
      grayRef.current = { data: g, w: canvas.width, h: canvas.height };
      setTaps([]);
      setResult(null);
      setStage('tap');
    } finally {
      setBusy(false);
    }
  }

  function onCanvasTap(e: React.PointerEvent<HTMLCanvasElement>) {
    if (stage !== 'tap' || taps.length >= 2) return;
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    const p = {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
    const next = [...taps, p];
    setTaps(next);
    if (next.length === 2) analyze(next[0], next[1]);
  }

  /** Snap N points along the tapped chord to the strongest perpendicular gradient (sub-pixel via parabola). */
  function analyze(a: Pt, b: Pt) {
    const gray = grayRef.current!;
    const { data, w, h } = gray;
    const px = (x: number, y: number) => {
      const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
      const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
      return data[yi * w + xi];
    };
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy; // perpendicular
    const ny = ux;
    const R = cfg.gradientSearchHalfRangePx;
    const N = cfg.samplePoints;
    const samples: Pt[] = [];
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.y + (b.y - a.y) * t;
      let bestOff = 0;
      let bestMag = -1;
      const mags = new Float32Array(2 * R + 1);
      for (let o = -R; o <= R; o++) {
        const m = Math.abs(
          px(cx + nx * (o + 1), cy + ny * (o + 1)) - px(cx + nx * (o - 1), cy + ny * (o - 1)),
        );
        mags[o + R] = m;
        if (m > bestMag) {
          bestMag = m;
          bestOff = o;
        }
      }
      // Sub-pixel: parabola through the peak and its neighbours
      let off = bestOff;
      const k = bestOff + R;
      if (k > 0 && k < 2 * R) {
        const denom = mags[k - 1] - 2 * mags[k] + mags[k + 1];
        if (Math.abs(denom) > 1e-6) off = bestOff + (0.5 * (mags[k - 1] - mags[k + 1])) / denom;
      }
      samples.push({ x: cx + nx * off, y: cy + ny * off });
    }
    const { maxDev } = fitLineMaxDeviation(samples);
    const bowPct = (maxDev / w) * 100;
    const verdict = bowPct > cfg.bowVerdictPctOfFrame ? 'distortion-present' : 'pre-corrected';
    setResult({ bowPx: maxDev, bowPct, verdict, samples });
    setStage('result');

    // Draw the detected edge + fit for the human eye
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.strokeStyle = 'rgba(92,229,0,0.95)';
    ctx.lineWidth = Math.max(2, w / 800);
    ctx.beginPath();
    samples.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(74,222,128,0.9)';
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(samples[0].x, samples[0].y);
    ctx.lineTo(samples[samples.length - 1].x, samples[samples.length - 1].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  async function saveVerdict() {
    if (!result) return;
    await db.diagnostics.add({
      createdAt: new Date().toISOString(),
      deviceLabel: deviceLabel(),
      bowPx: result.bowPx,
      bowPctOfFrame: result.bowPct,
      frameWidth: canvasRef.current?.width ?? 0,
      verdict: result.verdict,
      profileWasApplied: profileUsed !== null,
    });
    onBack();
  }

  return (
    <Screen title="Straight-edge diagnostic" onBack={onBack}>
      <Card className="mb-4">
        <p className="text-sm leading-relaxed text-zinc-300">
          Photograph a long, truly straight edge (door frame, taped string) spanning the{' '}
          <strong className="text-white">full frame width</strong>, near the top or bottom of frame where lenses
          distort most. Then tap each end of the edge. The app measures how much the detected edge bows.
        </p>
      </Card>

      {stage === 'camera' && (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '3/4' }}>
            <video ref={cam.videoRef} playsInline muted className="absolute inset-0 h-full w-full object-contain" />
            {cam.error && <p className="absolute inset-x-4 top-1/3 text-center text-red-300">{cam.error}</p>}
          </div>
          <label className="flex items-center gap-3 text-zinc-300">
            <input type="checkbox" checked={applyProfile} onChange={(e) => setApplyProfile(e.target.checked)} className="size-5 accent-amber-400" />
            Apply active device profile first (verifies a calibration)
          </label>
          <BigButton onClick={capture} disabled={!cam.ready || busy} className="w-full">
            {busy ? 'Capturing…' : 'Capture straight edge'}
          </BigButton>
        </div>
      )}

      <div className={stage === 'camera' ? 'hidden' : 'space-y-4'}>
        <canvas
          ref={canvasRef}
          onPointerDown={onCanvasTap}
          className="w-full touch-manipulation rounded-xl"
        />
        {stage === 'tap' && (
          <p className="text-center text-brand-light">
            Tap the <strong>{taps.length === 0 ? 'first' : 'second'} end</strong> of the straight edge ({taps.length}/2)
          </p>
        )}
        {stage === 'result' && result && (
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-lg text-white">
                bow {result.bowPx.toFixed(1)} px · {result.bowPct.toFixed(3)}% of frame
              </span>
              <Chip level={result.verdict === 'pre-corrected' ? 'green' : 'amber'}>
                {result.verdict === 'pre-corrected' ? 'pre-corrected' : 'distortion present'}
              </Chip>
            </div>
            <p className="text-sm text-zinc-300">
              {result.verdict === 'pre-corrected'
                ? 'This pipeline delivers straight lines — a device profile is optional.'
                : 'This camera path distorts. Calibrate this device and apply the profile before measuring.'}
              {profileUsed && <span className="block text-zinc-400">Profile applied during this test: {profileUsed}</span>}
            </p>
            <div className="mt-4 flex gap-3">
              <BigButton variant="secondary" onClick={() => setStage('camera')} className="flex-1">
                Retest
              </BigButton>
              <BigButton onClick={saveVerdict} className="flex-1">
                Save verdict
              </BigButton>
            </div>
          </Card>
        )}
      </div>
    </Screen>
  );
}
