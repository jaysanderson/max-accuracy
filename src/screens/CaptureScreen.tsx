import { useCallback, useEffect, useRef, useState } from 'react';
import { getConfig } from '../config';
import { deviceLabel } from '../db';
import { useCamera } from '../lib/camera';
import { requestOrientationPermission, tiltFromOrientation } from '../lib/orientation';
import { analyzePreview, initCv, type PreviewAnalysis } from '../lib/workerClient';
import { session } from '../lib/session';
import { useUiMode } from '../lib/uiMode';
import type { CaptureMeta, GateState, MeasureSetup } from '../types';

/**
 * The camera screen is a guidance instrument, not just a viewfinder:
 *  a. static grid + horizontal guide lines (align sill / bottom bar)
 *  b. sensor horizon drawn ON the scene — snaps green within threshold
 *  c. live edge feedback for yaw: detected horizontals tinted by convergence
 *  d. live reference lock (markers / card outlined when detected)
 * The shutter arms only when every enabled gate passes; long-press overrides
 * and stamps the shot amber.
 */

interface Props {
  setup: MeasureSetup;
  onCaptured: () => void;
  onBack: () => void;
}

export function CaptureScreen({ setup, onCaptured, onBack }: Props) {
  const cfg = getConfig();
  const basic = useUiMode() === 'basic';
  const cam = useCamera();
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [tilt, setTilt] = useState<{ pitchDeg: number; rollDeg: number } | null>(null);
  const [needOrientPerm, setNeedOrientPerm] = useState(false);
  const [analysis, setAnalysis] = useState<PreviewAnalysis | null>(null);
  const [gridOn, setGridOn] = useState(true);
  const [gates, setGates] = useState(cfg.gates);
  const [busy, setBusy] = useState(false);
  const [burstProgress, setBurstProgress] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const analysisRef = useRef<PreviewAnalysis | null>(null);
  const tiltRef = useRef<{ pitchDeg: number; rollDeg: number } | null>(null);
  const inFlight = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // --- sensor horizon -------------------------------------------------------
  useEffect(() => {
    let lastUpdate = 0;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      const now = performance.now();
      if (now - lastUpdate < 66) return; // ~15 Hz is plenty for a level
      lastUpdate = now;
      const angle =
        (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
      const t = tiltFromOrientation(e.beta, e.gamma, angle);
      tiltRef.current = t;
      setTilt(t);
    };
    const anyEvt = DeviceOrientationEvent as unknown as { requestPermission?: unknown };
    if (typeof anyEvt.requestPermission === 'function') setNeedOrientPerm(true);
    window.addEventListener('deviceorientation', onOrient);
    return () => window.removeEventListener('deviceorientation', onOrient);
  }, []);

  const grantOrientation = async () => {
    const res = await requestOrientationPermission();
    if (res !== 'denied') setNeedOrientPerm(false);
  };

  // --- live preview analysis (worker, throttled) ----------------------------
  useEffect(() => {
    initCv().catch(() => undefined);
    const interval = window.setInterval(async () => {
      if (inFlight.current || !cam.ready) return;
      const frame = cam.grabAnalysisFrame(cfg.capture.previewAnalysisHeight);
      if (!frame) return;
      inFlight.current = true;
      try {
        const res = await analyzePreview(frame, {
          wantEdges: true,
          wantMarkers: setup.mode !== 'card',
          wantCard: setup.mode === 'card',
        });
        analysisRef.current = res;
        setAnalysis(res);
      } catch {
        /* worker not ready yet */
      } finally {
        inFlight.current = false;
      }
    }, 1000 / cfg.capture.previewAnalysisFps);
    return () => window.clearInterval(interval);
  }, [cam.ready, cam.grabAnalysisFrame, setup.mode, cfg.capture.previewAnalysisFps, cfg.capture.previewAnalysisHeight]);

  // --- draw edge/marker overlay scaled onto the displayed video -------------
  useEffect(() => {
    const canvas = overlayRef.current;
    const video = cam.videoRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !video || !wrap || !analysis) return;
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.videoWidth === 0) return;
    // object-contain content rect
    const va = video.videoWidth / video.videoHeight;
    const wa = rect.width / rect.height;
    const cw = va > wa ? rect.width : rect.height * va;
    const ch = va > wa ? rect.width / va : rect.height;
    const ox = (rect.width - cw) / 2;
    const oy = (rect.height - ch) / 2;
    const analysisH = cfg.capture.previewAnalysisHeight;
    const analysisW = (video.videoWidth / video.videoHeight) * analysisH;
    const sx = cw / analysisW;
    const sy = ch / analysisH;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const conv = analysis.convergenceDeg;
    const convOk = conv === null || Math.abs(conv) <= cfg.capture.edgeConvergenceThresholdDeg;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = convOk ? 'rgba(92,229,0,0.9)' : 'rgba(248,113,113,0.9)';
    for (const l of analysis.lines) {
      ctx.beginPath();
      ctx.moveTo(ox + l.x1 * sx, oy + l.y1 * sy);
      ctx.lineTo(ox + l.x2 * sx, oy + l.y2 * sy);
      ctx.stroke();
    }
    // Reference lock outlines
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(92,229,0,0.95)';
    const quads = [
      ...analysis.markers.map((m) => m.corners),
      ...(analysis.cardQuad ? [analysis.cardQuad] : []),
    ];
    for (const q of quads) {
      ctx.beginPath();
      q.forEach((p, i) => {
        const X = ox + p.x * sx;
        const Y = oy + p.y * sy;
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }, [analysis, cam.videoRef, cfg.capture.previewAnalysisHeight, cfg.capture.edgeConvergenceThresholdDeg]);

  // --- gate evaluation -------------------------------------------------------
  function evalGates(): Record<'tilt' | 'edges' | 'referenceLock', GateState> {
    const t = tiltRef.current;
    const a = analysisRef.current;
    const thr = cfg.capture.pitchRollThresholdDeg;

    const tiltVal = t ? Math.max(Math.abs(t.pitchDeg), Math.abs(t.rollDeg)) : null;
    let tiltHint = '';
    if (t) {
      if (Math.abs(t.pitchDeg) > thr) tiltHint = t.pitchDeg > 0 ? `tilt down ${Math.abs(t.pitchDeg).toFixed(0)}°` : `tilt up ${Math.abs(t.pitchDeg).toFixed(0)}°`;
      else if (Math.abs(t.rollDeg) > thr) tiltHint = t.rollDeg > 0 ? `level — rotate anticlockwise ${Math.abs(t.rollDeg).toFixed(0)}°` : `level — rotate clockwise ${Math.abs(t.rollDeg).toFixed(0)}°`;
    } else tiltHint = 'waiting for motion sensors';

    const conv = a?.convergenceDeg ?? null;
    const convThr = cfg.capture.edgeConvergenceThresholdDeg;
    // Convergence sign: + → far side is the right → step right (see worker).
    const edgeHint =
      conv === null ? 'no window edges detected yet' : conv > convThr ? 'step right' : conv < -convThr ? 'step left' : '';

    const markersNeeded = setup.mode === 'two-marker' ? 2 : setup.mode === 'single-marker' ? 1 : 0;
    const locked =
      setup.mode === 'card'
        ? (a?.cardQuad ?? null) !== null && (a?.cardConfidence ?? 0) >= cfg.reference.minDetectionConfidence
        : (a?.markers.length ?? 0) >= markersNeeded;
    const lockHint = locked
      ? ''
      : setup.mode === 'card'
        ? 'card not detected — hold it flat on the wall, in view'
        : `marker${markersNeeded > 1 ? 's' : ''} not detected (${a?.markers.length ?? 0}/${markersNeeded})`;

    return {
      tilt: {
        enabled: gates.tilt,
        passed: tiltVal === null ? null : tiltVal <= thr,
        value: tiltVal,
        hint: tiltHint,
      },
      edges: {
        enabled: gates.edges,
        passed: conv === null ? null : Math.abs(conv) <= convThr,
        value: conv,
        hint: edgeHint,
      },
      referenceLock: {
        enabled: gates.referenceLock,
        passed: locked,
        value: a ? (setup.mode === 'card' ? a.cardConfidence : a.markers.length) : null,
        hint: lockHint,
      },
    };
  }

  const gateStates = evalGates();

  /** Reference span as a fraction of frame width — frame-fill discipline.
   * Only meaningful in two-marker mode, where the markers bracket the window. */
  function currentRefSpanFrac(): number | null {
    const a = analysisRef.current;
    if (!a || !a.frameW || setup.mode !== 'two-marker' || a.markers.length < 2) return null;
    const xs = a.markers.flatMap((m) => m.corners.map((c) => c.x));
    return (Math.max(...xs) - Math.min(...xs)) / a.frameW;
  }

  /** Basic mode shows ONE plain instruction at a time, in fix-it order. */
  function basicInstruction(): string | null {
    if (!cam.ready) return 'Starting the camera…';
    const t = tiltRef.current;
    const thr2 = cfg.capture.pitchRollThresholdDeg;
    if (gateStates.tilt.enabled && gateStates.tilt.passed === false && t) {
      if (Math.abs(t.pitchDeg) > thr2) return t.pitchDeg > 0 ? 'Tip the phone down a little' : 'Tip the phone up a little';
      return 'Straighten the phone — it’s leaning sideways';
    }
    if (gateStates.edges.enabled && gateStates.edges.passed === false) {
      return (gateStates.edges.value ?? 0) > 0 ? 'Take a small step to your right' : 'Take a small step to your left';
    }
    if (gateStates.referenceLock.enabled && gateStates.referenceLock.passed !== true) {
      if (setup.mode === 'card') return 'Hold the card flat on the wall beside the window';
      if (setup.mode === 'two-marker') return 'Get both stickers in the picture';
      return 'Get the sticker in the picture';
    }
    const span = currentRefSpanFrac();
    if (span !== null && span < cfg.capture.minReferenceSpanFrac) {
      return 'Step closer — fill the screen with the window'; // soft hint, doesn't block
    }
    return null;
  }

  const blocking = (Object.keys(gateStates) as Array<keyof typeof gateStates>).filter((k) => {
    const g = gateStates[k];
    // A gate blocks only when enabled and actively failing. "No signal yet"
    // blocks for referenceLock (it must positively lock) but not for edges.
    if (!g.enabled) return false;
    if (k === 'referenceLock') return g.passed !== true;
    return g.passed === false;
  });
  const armed = cam.ready && blocking.length === 0;

  // --- capture ---------------------------------------------------------------
  const doCapture = useCallback(
    async (overridden: boolean) => {
      if (busy) return;
      setBusy(true);
      const n = Math.max(1, cfg.capture.burstCount);
      let focusLocked = false;
      try {
        // Lock AF/AE for the whole burst so every frame shares intrinsics.
        if (cfg.capture.lockFocusOnArm) focusLocked = await cam.lockCapture();
        const t = tiltRef.current;
        const a = analysisRef.current;
        const gatesAtCapture = evalGates();
        const spanAtCapture = currentRefSpanFrac();
        const frames: ImageBitmap[] = [];
        let first: { width: number; height: number; source: 'ImageCapture' | 'videoFrame' } | null = null;
        for (let i = 0; i < n; i++) {
          if (n > 1) setBurstProgress(`Hold still — photo ${i + 1} of ${n}`);
          const shot = await cam.captureFullRes();
          // Frames must share resolution for cross-frame matching; drop odd ones.
          if (first && (shot.width !== first.width || shot.height !== first.height)) {
            shot.bitmap.close();
            continue;
          }
          if (!first) first = { width: shot.width, height: shot.height, source: shot.source };
          frames.push(shot.bitmap);
        }
        if (!first) throw new Error('Capture failed');
        const meta: CaptureMeta = {
          timestamp: new Date().toISOString(),
          pitchDeg: t?.pitchDeg ?? null,
          rollDeg: t?.rollDeg ?? null,
          convergenceDeg: a?.convergenceDeg ?? null,
          gates: gatesAtCapture,
          overridden,
          width: first.width,
          height: first.height,
          deviceLabel: deviceLabel(),
          captureSource: first.source,
          focusLocked,
          refSpanFrac: spanAtCapture,
        };
        for (const f of session.burst?.frames ?? []) f.close();
        session.burst = { frames, meta };
        onCaptured();
      } catch (e) {
        setFlash(e instanceof Error ? e.message : 'Capture failed');
        setTimeout(() => setFlash(null), 2500);
      } finally {
        setBurstProgress(null);
        if (focusLocked) void cam.unlockCapture();
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, cam.captureFullRes, onCaptured],
  );

  const onShutterDown = () => {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      void doCapture(true); // deliberate override → amber stamp
    }, cfg.capture.overrideLongPressMs);
  };
  const onShutterUp = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    if (longPressFired.current) return;
    if (armed) void doCapture(false);
    else {
      const reasons = basic
        ? (basicInstruction() ?? 'Not ready yet — hold on')
        : blocking
            .map((k) => gateStates[k].hint || k)
            .filter(Boolean)
            .join(' · ');
      setFlash(reasons || 'not ready');
      setTimeout(() => setFlash(null), 2000);
    }
  };

  // --- render -----------------------------------------------------------------
  const roll = tilt?.rollDeg ?? 0;
  const pitch = tilt?.pitchDeg ?? 0;
  const thr = cfg.capture.pitchRollThresholdDeg;
  const horizonOk = tilt !== null && Math.abs(roll) <= thr && Math.abs(pitch) <= thr;

  return (
    <div className="relative h-full bg-black" ref={wrapRef}>
      <video
        ref={cam.videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-contain"
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* a. static alignment overlay */}
      {gridOn && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          {[33.3, 66.6].map((p) => (
            <line key={`v${p}`} x1={p} y1="0" x2={p} y2="100" stroke="rgba(255,255,255,0.25)" strokeWidth="0.2" />
          ))}
          {[33.3, 66.6].map((p) => (
            <line key={`h${p}`} x1="0" y1={p} x2="100" y2={p} stroke="rgba(255,255,255,0.25)" strokeWidth="0.2" />
          ))}
          {/* guide pair: align the sill / window head */}
          <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(92,229,0,0.55)" strokeWidth="0.35" strokeDasharray="2 1.2" />
          <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(92,229,0,0.55)" strokeWidth="0.35" strokeDasharray="2 1.2" />
        </svg>
      )}

      {/* b. sensor horizon ON the scene */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="h-0 w-[78%] border-t-[3px] transition-colors"
          style={{
            transform: `rotate(${roll}deg) translateY(${Math.max(-80, Math.min(80, pitch * 6))}px)`,
            borderColor: horizonOk ? 'rgba(92,229,0,0.95)' : 'rgba(251,191,36,0.95)',
          }}
        />
        {/* fixed centre reference ticks */}
        <div className="absolute h-0 w-[88%] border-t border-dashed border-white/30" />
      </div>

      {/* tilt arc readout (numbers are Advanced-only; Basic gets the coach line) */}
      {!basic && (
        <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-lg bg-black/60 px-3 py-1 text-center font-mono text-sm">
          <span className={Math.abs(pitch) <= thr ? 'text-green-400' : 'text-amber-400'}>
            pitch {pitch >= 0 ? '+' : ''}{pitch.toFixed(1)}°
          </span>
          <span className="mx-2 text-zinc-500">|</span>
          <span className={Math.abs(roll) <= thr ? 'text-green-400' : 'text-amber-400'}>
            roll {roll >= 0 ? '+' : ''}{roll.toFixed(1)}°
          </span>
        </div>
      )}
      {basic && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-sm font-semibold text-zinc-200">
          Step 2 of 3 — take the photo
        </div>
      )}

      {/* header */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <button onClick={onBack} className="rounded-lg bg-black/60 px-4 py-2 text-lg text-white">‹ Back</button>
        {!basic && (
          <div className="flex gap-2">
            <button
              onClick={() => setGridOn((v) => !v)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${gridOn ? 'bg-brand text-brand-ink' : 'bg-black/60 text-white'}`}
            >
              Grid
            </button>
            {(['tilt', 'edges', 'referenceLock'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGates((s) => ({ ...s, [g]: !s[g] }))}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${gates[g] ? 'bg-zinc-200 text-black' : 'bg-black/60 text-zinc-400 line-through'}`}
              >
                {g === 'referenceLock' ? 'Ref' : g === 'edges' ? 'Yaw' : 'Tilt'}
              </button>
            ))}
          </div>
        )}
      </div>

      {needOrientPerm && (
        <button
          onClick={grantOrientation}
          className="absolute left-1/2 top-28 -translate-x-1/2 rounded-xl bg-brand px-4 py-3 font-semibold text-brand-ink shadow-xl"
        >
          Enable tilt sensors
        </button>
      )}

      {cam.error && (
        <div className="absolute inset-x-4 top-1/3 rounded-xl bg-red-900/90 p-4 text-center text-red-100">{cam.error}</div>
      )}

      {/* coaching — Basic: one instruction at a time; Advanced: every gate */}
      <div className="absolute inset-x-0 bottom-32 flex flex-col items-center gap-1 px-4">
        {basic ? (
          (() => {
            const msg = basicInstruction();
            return (
              <div
                className={`rounded-2xl px-5 py-2.5 text-center text-lg font-bold shadow-lg ${
                  msg ? 'bg-black/75 text-white' : 'bg-green-500/90 text-black'
                }`}
                role="status"
                aria-live="polite"
              >
                {msg ?? 'Looking good — tap the green button'}
              </div>
            );
          })()
        ) : (
          (Object.keys(gateStates) as Array<keyof typeof gateStates>).map((k) => {
            const g = gateStates[k];
            if (!g.enabled) return null;
            const failing = blocking.includes(k);
            if (!failing && g.passed !== null) return null;
            return (
              <div
                key={k}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${failing ? 'bg-red-500/90 text-white' : 'bg-black/60 text-zinc-300'}`}
              >
                {g.hint || (g.passed === null ? `${k}: waiting…` : k)}
              </div>
            );
          })
        )}
        {flash && (
          <div className="rounded-full bg-amber-400 px-4 py-1.5 text-sm font-bold text-black">{flash}</div>
        )}
      </div>

      {burstProgress && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
          <p className="rounded-2xl bg-black/80 px-6 py-3 text-xl font-bold text-white">{burstProgress}</p>
        </div>
      )}

      {/* shutter */}
      <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-2">
        <button
          onPointerDown={onShutterDown}
          onPointerUp={onShutterUp}
          onPointerLeave={() => longPressTimer.current && window.clearTimeout(longPressTimer.current)}
          disabled={busy || !cam.ready}
          className={`size-20 rounded-full border-4 transition-all select-none touch-manipulation ${
            armed
              ? 'border-brand bg-brand/90 shadow-[0_0_30px_rgba(92,229,0,0.5)]'
              : 'border-zinc-500 bg-zinc-700/80'
          } ${busy ? 'animate-pulse' : ''}`}
          aria-label={armed ? 'Capture' : 'Capture blocked — long-press to override'}
        />
        <span className="text-xs text-zinc-400">
          {armed
            ? basic
              ? 'Ready — tap to take the photo'
              : 'Ready — tap to capture'
            : basic
              ? 'Follow the tip above — the button turns green when the shot is good'
              : 'Blocked — long-press to override (stamps amber)'}
        </span>
      </div>
    </div>
  );
}
