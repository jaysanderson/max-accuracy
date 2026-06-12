import { useCallback, useEffect, useRef, useState } from 'react';
import { Loupe } from '../components/Loupe';
import { BigButton, Chip, ConfidenceChip, Field, inputCls } from '../components/ui';
import { getConfig } from '../config';
import { db, getActiveProfile } from '../db';
import { computeHomography, reprojectionErrorRms, type Mat3 } from '../lib/geometry';
import { buildCorrespondences, solveReference, widthBetween } from '../lib/measure';
import { runQualityChecks } from '../lib/quality';
import { extractPatch, matchPatch, toLuma } from '../lib/patchMatch';
import { session, clearShot } from '../lib/session';
import { crossChecks, median } from '../lib/stats';
import { useUiMode } from '../lib/uiMode';
import { detectReference, undistortImage } from '../lib/workerClient';
import type { DetectedMarker, DeviceProfile, MeasureSetup, Pt, QualityCheck, RefMethod } from '../types';

interface Props {
  setup: MeasureSetup;
  onRetake: () => void;
  onSaved: () => void;
  onAbort: () => void;
}

type Stage = 'processing' | 'manual-ref' | 'measure' | 'failed';

interface Viewport {
  s: number;
  tx: number;
  ty: number;
}

export function MeasureScreen({ setup, onRetake, onSaved, onAbort }: Props) {
  const cfg = getConfig();
  const basic = useUiMode() === 'basic';
  const burst = session.burst;
  const shot = burst ? { meta: burst.meta } : null;
  const masterRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [stage, setStage] = useState<Stage>('processing');
  const [statusMsg, setStatusMsg] = useState('Preparing image…');
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [profileApplied, setProfileApplied] = useState(false);
  const [markers, setMarkers] = useState<DetectedMarker[]>([]);
  const [cardQuad, setCardQuad] = useState<Pt[] | null>(null);
  const [detConf, setDetConf] = useState<number | null>(null);
  const [refMethod, setRefMethod] = useState<RefMethod>('auto');
  const [H, setH] = useState<Mat3 | null>(null);
  const [reprojErrMm, setReprojErrMm] = useState<number | null>(null);
  const [handles, setHandles] = useState<{ left: Pt; right: Pt } | null>(null);
  const [corners, setCorners] = useState<Pt[]>([]); // manual card corners
  const [vp, setVp] = useState<Viewport>({ s: 0.2, tx: 0, ty: 0 });
  const [dragPoint, setDragPoint] = useState<Pt | null>(null); // loupe target
  const [saveOpen, setSaveOpen] = useState(false);
  const [trueWidthStr, setTrueWidthStr] = useState('');
  const [windowLabel, setWindowLabel] = useState(setup.windowLabel);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [failMsg, setFailMsg] = useState('');
  /** Burst: auxiliary frames' luma + homography, and the combined width stats. */
  const auxRef = useRef<{ luma: Uint8ClampedArray; H: Mat3 }[]>([]);
  const masterLumaRef = useRef<Uint8ClampedArray | null>(null);
  const procCtxRef = useRef<{ prof: DeviceProfile | null; applied: boolean }>({ prof: null, applied: false });
  const handlesRef = useRef<{ left: Pt; right: Pt } | null>(null);
  const HRef = useRef<Mat3 | null>(null);
  const [burstStats, setBurstStats] = useState<{ n: number; medianMm: number; spreadPct: number } | null>(null);

  const imgW = shot?.meta.width ?? 0;
  const imgH = shot?.meta.height ?? 0;

  useEffect(() => {
    handlesRef.current = handles;
  }, [handles]);
  useEffect(() => {
    HRef.current = H;
  }, [H]);

  // ---- pipeline: draw master → undistort → detect → solve (then aux frames) --
  useEffect(() => {
    if (!burst || !shot) {
      onAbort();
      return;
    }
    let cancelled = false;
    (async () => {
      const canvas = masterRef.current;
      if (!canvas) return;
      canvas.width = shot.meta.width;
      canvas.height = shot.meta.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(burst.frames[0], 0, 0);

      // Fit to viewport
      const vpEl = viewportRef.current;
      if (vpEl) {
        const r = vpEl.getBoundingClientRect();
        const s = Math.min(r.width / canvas.width, r.height / canvas.height);
        setVp({ s, tx: (r.width - canvas.width * s) / 2, ty: (r.height - canvas.height * s) / 2 });
      }

      // Undistort BEFORE any measurement, when a profile exists
      const prof = await getActiveProfile();
      if (cancelled) return;
      setProfile(prof);
      procCtxRef.current = { prof, applied: false };
      if (prof) {
        try {
          setStatusMsg(`Undistorting (profile: ${prof.name})…`);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const out = await undistortImage(
            img,
            prof.cameraMatrix,
            prof.distCoeffs,
            prof.calibratedWidth,
            prof.calibratedHeight,
          );
          if (cancelled) return;
          ctx.putImageData(out, 0, 0);
          setProfileApplied(true);
          procCtxRef.current.applied = true;
        } catch (e) {
          setStatusMsg(`Undistort unavailable (${e instanceof Error ? e.message : 'error'}) — measuring on raw image`);
        }
      }

      // Detect reference on the corrected image
      setStatusMsg('Detecting reference…');
      try {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const det = await detectReference(img, {
          wantMarkers: setup.mode !== 'card',
          wantCard: setup.mode === 'card',
        });
        if (cancelled) return;

        if (setup.mode === 'card') {
          if (det.cardQuad && det.cardConfidence >= cfg.reference.minDetectionConfidence) {
            setCardQuad(det.cardQuad);
            setDetConf(det.cardConfidence);
            await solveAndEnter(det.cardQuad, [], 'auto');
          } else {
            // Manual fallback: tap-the-four-corners with the loupe
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            const w = canvas.width * 0.15;
            const h = w / (cfg.reference.cardWidthMm / cfg.reference.cardHeightMm);
            setCorners([
              { x: cx - w, y: cy - h },
              { x: cx + w, y: cy - h },
              { x: cx + w, y: cy + h },
              { x: cx - w, y: cy + h },
            ]);
            setRefMethod('manual');
            setStage('manual-ref');
          }
        } else {
          const wanted =
            setup.mode === 'two-marker'
              ? [cfg.reference.markerIdA, cfg.reference.markerIdB]
              : [cfg.reference.markerIdSingle];
          let chosen = det.markers.filter((m) => wanted.includes(m.id));
          if (chosen.length < (setup.mode === 'two-marker' ? 2 : 1)) chosen = det.markers;
          const need = setup.mode === 'two-marker' ? 2 : 1;
          if (chosen.length < need) {
            setFailMsg(
              `Detected ${chosen.length}/${need} markers on the corrected image. Retake with the marker${need > 1 ? 's' : ''} clearly visible and well lit.`,
            );
            setStage('failed');
            return;
          }
          const use = chosen.slice(0, need);
          setMarkers(use);
          setDetConf(Math.min(...use.map((m) => m.confidence)));
          await solveAndEnter(null, use, 'auto');
        }
      } catch (e) {
        if (!cancelled) {
          setFailMsg(e instanceof Error ? e.message : 'Detection failed');
          setStage('failed');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function solveAndEnter(quad: Pt[] | null, mks: DetectedMarker[], method: RefMethod) {
    const { src, dst } = buildCorrespondences(setup.mode, {
      markers: mks,
      cardQuad: quad,
      markerSizeMm: setup.markerSizeMm,
      markerSeparationMm: setup.markerSeparationMm,
    });
    const sol = await solveReference(src, dst);
    setH(sol.H);
    setReprojErrMm(sol.reprojErrMm);
    setRefMethod(method);
    // Initial datum handles: span the reference horizontally at its vertical centre
    const ys = src.map((p) => p.y);
    const xs = src.map((p) => p.x);
    const cy = ys.reduce((a, v) => a + v, 0) / ys.length;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const pad = (maxX - minX) * 0.4 + 40;
    setHandles({
      left: { x: Math.max(8, minX - pad), y: cy },
      right: { x: Math.min(imgW - 8, maxX + pad), y: cy },
    });
    setStage('measure');
    void processAuxFrames();
  }

  /**
   * Burst: each extra frame gets the same undistort + detection + homography,
   * then the user's datum points are transferred into it by patch matching
   * (frames share a near-identical pose, so a small NCC search suffices).
   * The widths across frames are median-combined — corner-detection noise is
   * independent per frame, which is exactly what averaging kills.
   */
  async function processAuxFrames(): Promise<void> {
    const b = session.burst;
    if (!b || b.frames.length < 2) return;
    const master = masterRef.current;
    if (!master) return;
    const mctx = master.getContext('2d', { willReadFrequently: true })!;
    const mimg = mctx.getImageData(0, 0, imgW, imgH);
    masterLumaRef.current = toLuma(mimg.data, imgW, imgH);
    const { prof, applied } = procCtxRef.current;
    const work = document.createElement('canvas');
    work.width = imgW;
    work.height = imgH;
    const wctx = work.getContext('2d', { willReadFrequently: true })!;
    const aux: { luma: Uint8ClampedArray; H: Mat3 }[] = [];
    for (let i = 1; i < b.frames.length; i++) {
      try {
        wctx.drawImage(b.frames[i], 0, 0);
        let img = wctx.getImageData(0, 0, imgW, imgH);
        if (applied && prof) {
          img = await undistortImage(img, prof.cameraMatrix, prof.distCoeffs, prof.calibratedWidth, prof.calibratedHeight);
        }
        const luma = toLuma(img.data, imgW, imgH);
        const det = await detectReference(img, {
          wantMarkers: setup.mode !== 'card',
          wantCard: setup.mode === 'card',
        });
        let src: Pt[];
        let dst: Pt[];
        if (setup.mode === 'card') {
          if (!det.cardQuad || det.cardConfidence < cfg.reference.minDetectionConfidence) continue;
          ({ src, dst } = buildCorrespondences('card', { cardQuad: det.cardQuad }));
        } else {
          const need = setup.mode === 'two-marker' ? 2 : 1;
          const wanted =
            setup.mode === 'two-marker'
              ? [cfg.reference.markerIdA, cfg.reference.markerIdB]
              : [cfg.reference.markerIdSingle];
          let chosen = det.markers.filter((m) => wanted.includes(m.id));
          if (chosen.length < need) chosen = det.markers;
          if (chosen.length < need) continue;
          ({ src, dst } = buildCorrespondences(setup.mode, {
            markers: chosen.slice(0, need),
            markerSizeMm: setup.markerSizeMm,
            markerSeparationMm: setup.markerSeparationMm,
          }));
        }
        const sol = await solveReference(src, dst);
        if (sol.reprojErrMm > cfg.quality.reprojRedMm) continue; // bad frame — drop
        aux.push({ luma, H: sol.H });
      } catch {
        continue; // a dropped frame just reduces the burst
      }
    }
    auxRef.current = aux;
    recomputeBurst();
  }

  /** Combine widths across burst frames for the CURRENT handle positions. */
  function recomputeBurst(): void {
    const h = handlesRef.current;
    const Hm = HRef.current;
    const aux = auxRef.current;
    const mLuma = masterLumaRef.current;
    if (!h || !Hm || !aux.length || !mLuma) {
      setBurstStats(null);
      return;
    }
    const PATCH_R = 24;
    const SEARCH = 24;
    const MIN_NCC = 0.5;
    const widths = [widthBetween(Hm, h.left, h.right)];
    const patchL = extractPatch(mLuma, imgW, imgH, h.left.x, h.left.y, PATCH_R);
    const patchR = extractPatch(mLuma, imgW, imgH, h.right.x, h.right.y, PATCH_R);
    if (patchL && patchR) {
      for (const f of aux) {
        const mL = matchPatch(f.luma, imgW, imgH, patchL, PATCH_R, h.left.x, h.left.y, SEARCH);
        const mR = matchPatch(f.luma, imgW, imgH, patchR, PATCH_R, h.right.x, h.right.y, SEARCH);
        if (!mL || !mR || mL.score < MIN_NCC || mR.score < MIN_NCC) continue;
        widths.push(widthBetween(f.H, mL.point, mR.point));
      }
    }
    if (widths.length < 2) {
      setBurstStats(null);
      return;
    }
    const med = median(widths)!;
    setBurstStats({
      n: widths.length,
      medianMm: med,
      spreadPct: med > 0 ? ((Math.max(...widths) - Math.min(...widths)) / med) * 100 : 0,
    });
  }

  function confirmManualCorners() {
    // Manual card corners → TS DLT directly (deterministic, no worker needed)
    const cardCfg = getConfig().reference;
    const dst: Pt[] = [
      { x: 0, y: 0 },
      { x: cardCfg.cardWidthMm, y: 0 },
      { x: cardCfg.cardWidthMm, y: cardCfg.cardHeightMm },
      { x: 0, y: cardCfg.cardHeightMm },
    ];
    const Hm = computeHomography(corners, dst);
    setCardQuad(corners);
    setH(Hm);
    setReprojErrMm(reprojectionErrorRms(Hm, corners, dst));
    setRefMethod('manual');
    setDetConf(null);
    const cy = corners.reduce((s, p) => s + p.y, 0) / 4;
    setHandles({ left: { x: imgW * 0.2, y: cy }, right: { x: imgW * 0.8, y: cy } });
    setStage('measure');
    auxRef.current = [];
    setBurstStats(null);
    void processAuxFrames();
  }

  // ---- live width ------------------------------------------------------------
  // Live drag tracks the master frame; on release the burst median takes over.
  const masterWidthMm = H && handles ? widthBetween(H, handles.left, handles.right) : null;
  const widthMm = dragPoint === null && burstStats ? burstStats.medianMm : masterWidthMm;

  const quality =
    stage === 'measure' && shot
      ? runQualityChecks({
          mode: setup.mode,
          pitchDeg: shot.meta.pitchDeg,
          rollDeg: shot.meta.rollDeg,
          reprojErrMm,
          detectionConfidence: detConf,
          cardQuad,
          markers,
          markerSizeMm: setup.markerSizeMm,
          overridden: shot.meta.overridden,
          refMethod,
          burstSpreadPct: burstStats?.spreadPct ?? null,
          refSpanFrac: shot.meta.refSpanFrac,
          profileAgeDays:
            profileApplied && profile
              ? (Date.now() - new Date(profile.createdAt).getTime()) / 86400000
              : null,
        })
      : null;

  // ---- pan / zoom / drag -------------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragTarget = useRef<string | null>(null);
  const pinchStart = useRef<{ d: number; s: number; cx: number; cy: number; tx: number; ty: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const toImage = useCallback(
    (clientX: number, clientY: number): Pt => {
      const r = viewportRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left - vp.tx) / vp.s, y: (clientY - r.top - vp.ty) / vp.s };
    },
    [vp],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const handleId = (e.target as HTMLElement).dataset.handle;
    if (handleId && pointers.current.size === 1) {
      dragTarget.current = handleId;
      return;
    }
    if (pointers.current.size === 2) {
      dragTarget.current = null;
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        s: vp.s,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        tx: vp.tx,
        ty: vp.ty,
      };
      panStart.current = null;
    } else if (pointers.current.size === 1) {
      panStart.current = { x: e.clientX, y: e.clientY, tx: vp.tx, ty: vp.ty };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (dragTarget.current) {
      const p = toImage(e.clientX, e.clientY);
      const clamped = { x: Math.max(0, Math.min(imgW, p.x)), y: Math.max(0, Math.min(imgH, p.y)) };
      setDragPoint(clamped);
      const t = dragTarget.current;
      if (t === 'left' || t === 'right') setHandles((h) => (h ? { ...h, [t]: clamped } : h));
      else if (t.startsWith('corner')) {
        const idx = Number(t.slice(6));
        setCorners((cs) => cs.map((c, i) => (i === idx ? clamped : c)));
      }
      return;
    }
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ps = pinchStart.current;
      const newS = Math.max(0.02, Math.min(8, (ps.s * d) / ps.d));
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const r = viewportRef.current!.getBoundingClientRect();
      // keep the pinch centre fixed in image space
      const ix = (ps.cx - r.left - ps.tx) / ps.s;
      const iy = (ps.cy - r.top - ps.ty) / ps.s;
      setVp({ s: newS, tx: cx - r.left - ix * newS, ty: cy - r.top - iy * newS });
    } else if (pointers.current.size === 1 && panStart.current) {
      const p = panStart.current;
      setVp((v) => ({ ...v, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      const wasDatumHandle = dragTarget.current === 'left' || dragTarget.current === 'right';
      dragTarget.current = null;
      panStart.current = null;
      setDragPoint(null);
      // NCC across frames is too heavy per drag-move; do it once on release.
      if (wasDatumHandle) window.setTimeout(() => recomputeBurst(), 0);
    }
  };

  // ---- save --------------------------------------------------------------------
  async function save() {
    if (!shot || widthMm === null || !quality) return;
    const trueWidth = setup.testMode && trueWidthStr.trim() ? Number(trueWidthStr) : null;
    if (trueWidth !== null && (!Number.isFinite(trueWidth) || trueWidth <= 0)) return;
    // Advanced Test Mode demands ground truth; Basic treats the tape check as optional.
    if (setup.testMode && !basic && trueWidth === null) return;

    // thumbnail for the log
    let thumb: Blob | undefined;
    const master = masterRef.current;
    if (master) {
      const t = document.createElement('canvas');
      const scale = 600 / master.width;
      t.width = 600;
      t.height = Math.round(master.height * scale);
      t.getContext('2d')!.drawImage(master, 0, 0, t.width, t.height);
      thumb = await new Promise<Blob | undefined>((res) => t.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.8));
    }

    await db.measurements.add({
      createdAt: new Date().toISOString(),
      mode: setup.mode,
      refMethod,
      datum: setup.datum,
      widthMm,
      trueWidthMm: trueWidth,
      errorMm: trueWidth !== null ? widthMm - trueWidth : null,
      errorPct: trueWidth !== null ? ((widthMm - trueWidth) / trueWidth) * 100 : null,
      confidence: quality.confidence,
      reasons: quality.checks.filter((c) => c.level !== 'green').map((c) => c.detail),
      reprojErrMm,
      detectionConfidence: detConf,
      profileApplied,
      profileId: profile?.id ?? null,
      profileName: profileApplied ? (profile?.name ?? null) : null,
      pitchDeg: shot.meta.pitchDeg,
      rollDeg: shot.meta.rollDeg,
      convergenceDeg: shot.meta.convergenceDeg,
      overridden: shot.meta.overridden,
      deviceLabel: shot.meta.deviceLabel,
      windowLabel: windowLabel.trim(),
      markerSizeMm: setup.mode === 'card' ? null : setup.markerSizeMm,
      markerSeparationMm: setup.mode === 'two-marker' ? setup.markerSeparationMm : null,
      burstCount: burstStats?.n ?? 1,
      widthSpreadPct: burstStats?.spreadPct ?? null,
      focusLocked: shot.meta.focusLocked,
      refSpanFrac: shot.meta.refSpanFrac,
      thumb,
    });

    // Cross-check feedback against other measurements of the same window
    if (windowLabel.trim()) {
      const all = await db.measurements.toArray();
      const cc = crossChecks(all, cfg.quality.crossCheckTolerancePct).get(windowLabel.trim());
      if (cc) {
        setSavedNote(
          cc.agrees
            ? `Cross-check "${cc.windowLabel}": ${cc.measurements.length} measurements agree within ${cc.spreadPct.toFixed(2)}% ✓`
            : `Cross-check "${cc.windowLabel}": measurements DISAGREE by ${cc.spreadPct.toFixed(2)}% — flag these shots and re-measure`,
        );
        setTimeout(() => finish(), 2600);
        return;
      }
    }
    finish();
  }

  function finish() {
    clearShot();
    onSaved();
  }

  // ---- render --------------------------------------------------------------------
  const guideLineW = Math.max(1.5 / vp.s, 0.5);
  const handleScale = 1 / vp.s;
  const isRed = quality?.confidence === 'red';

  return (
    <div className="flex h-full flex-col bg-black">
      {/* top bar */}
      <div className="flex items-center justify-between gap-2 bg-zinc-950 px-3 py-2">
        <button onClick={() => { clearShot(); onRetake(); }} className="rounded-lg bg-zinc-800 px-4 py-2 text-white">
          ‹ Retake
        </button>
        {basic ? (
          <p className="text-sm font-semibold text-zinc-300">Step 3 of 3 — mark the edges</p>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto">
            <Chip level="neutral">{setup.mode}</Chip>
            <Chip level="neutral">datum: {setup.datum}</Chip>
            <Chip level={profileApplied ? 'green' : 'amber'}>
              {profileApplied ? `profile: ${profile?.name}` : 'no profile'}
            </Chip>
          </div>
        )}
      </div>

      {/* image viewport */}
      <div
        ref={viewportRef}
        className="relative flex-1 touch-none overflow-hidden bg-zinc-900"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={contentRef}
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.s})`, width: imgW, height: imgH }}
        >
          <canvas ref={masterRef} className="absolute left-0 top-0" />

          {/* detected reference outline */}
          <svg className="pointer-events-none absolute left-0 top-0" width={imgW} height={imgH}>
            {[...markers.map((m) => m.corners), ...(cardQuad && stage === 'measure' ? [cardQuad] : [])].map(
              (q, i) => (
                <polygon
                  key={i}
                  points={q.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="rgba(92,229,0,0.9)"
                  strokeWidth={2 / vp.s}
                />
              ),
            )}
          </svg>

          {/* manual card corners */}
          {stage === 'manual-ref' &&
            corners.map((c, i) => (
              <div
                key={i}
                data-handle={`corner${i}`}
                className="absolute z-10 flex items-center justify-center"
                style={{
                  left: c.x,
                  top: c.y,
                  transform: `translate(-50%, -50%) scale(${handleScale})`,
                  width: 56,
                  height: 56,
                }}
              >
                <div className="pointer-events-none size-10 rounded-full border-[3px] border-brand bg-brand/15" />
                <span className="pointer-events-none absolute -top-5 text-sm font-bold text-brand-light">
                  {['TL', 'TR', 'BR', 'BL'][i]}
                </span>
              </div>
            ))}

          {/* datum handles: full-height guide line + grab circle */}
          {stage === 'measure' &&
            handles &&
            (['left', 'right'] as const).map((side) => {
              const p = handles[side];
              return (
                <div key={side}>
                  <div
                    className="pointer-events-none absolute bg-brand/85"
                    style={{ left: p.x - guideLineW / 2, top: 0, width: guideLineW, height: imgH }}
                  />
                  <div
                    data-handle={side}
                    className="absolute z-10 flex items-center justify-center"
                    style={{
                      left: p.x,
                      top: p.y,
                      transform: `translate(-50%, -50%) scale(${handleScale})`,
                      width: 64,
                      height: 64,
                    }}
                  >
                    <div className="pointer-events-none size-12 rounded-full border-[3px] border-brand bg-black/30 shadow-lg" />
                  </div>
                </div>
              );
            })}
        </div>

        {stage === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="rounded-xl bg-zinc-900 px-6 py-4 text-center">
              <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <p className="text-zinc-200">{statusMsg}</p>
            </div>
          </div>
        )}

        {stage === 'failed' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6">
            <div className="rounded-xl bg-zinc-900 p-5 text-center">
              <p className="mb-4 text-red-300">{failMsg}</p>
              <BigButton onClick={() => { clearShot(); onRetake(); }}>Retake</BigButton>
            </div>
          </div>
        )}

        <Loupe sourceCanvas={masterRef.current} point={dragPoint} />
      </div>

      {/* bottom panel */}
      <div className={`border-t px-4 pb-5 pt-3 ${isRed ? 'border-red-700 bg-red-950/60' : 'border-zinc-800 bg-zinc-950'}`}>
        {stage === 'manual-ref' && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-300">
              Card not auto-detected. Drag the four corners onto the card edges (pinch to zoom, loupe shows detail).
            </p>
            <BigButton onClick={confirmManualCorners}>Confirm corners</BigButton>
          </div>
        )}

        {stage === 'measure' && quality && basic && (
          <>
            <p className="mb-1 text-sm text-zinc-400">
              Drag the two circles onto the {setup.datum === 'recess' ? 'inside edges of the window opening (wall to wall)' : 'outside edges the blind needs to cover'}. Pinch to zoom in close.
            </p>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className={`font-mono text-5xl font-bold tracking-tight ${isRed ? 'text-red-400 line-through' : 'text-white'}`}>
                  {widthMm !== null ? widthMm.toFixed(0) : '—'}
                  <span className="ml-1 text-xl text-zinc-400">mm</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {burstStats && (
                    <span className="text-xs text-zinc-400">
                      {burstStats.n} photos · spread {((burstStats.spreadPct / 100) * burstStats.medianMm).toFixed(1)} mm
                    </span>
                  )}
                  <Chip level={quality.confidence}>
                    {quality.confidence === 'green'
                      ? '✓ Good measurement'
                      : quality.confidence === 'amber'
                        ? '⚠ Usable — double-check it'
                        : '✗ Not reliable — take the photo again'}
                  </Chip>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {setup.mode === 'card' && (
                  <button
                    onClick={() => setStage('manual-ref')}
                    className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300"
                  >
                    Fix card outline
                  </button>
                )}
                {isRed ? (
                  <BigButton variant="danger" onClick={() => { clearShot(); onRetake(); }}>
                    Take it again
                  </BigButton>
                ) : (
                  <BigButton onClick={() => setSaveOpen(true)} disabled={widthMm === null}>
                    Save
                  </BigButton>
                )}
              </div>
            </div>
            {(() => {
              const worst =
                quality.checks.find((c) => c.level === 'red') ?? quality.checks.find((c) => c.level === 'amber');
              return worst ? (
                <p className={`mt-2 text-sm ${worst.level === 'red' ? 'text-red-300' : 'text-amber-300'}`}>{worst.detail}</p>
              ) : null;
            })()}
            {isRed && (
              <button onClick={() => setSaveOpen(true)} className="mt-1 text-sm text-zinc-500 underline">
                Save it anyway
              </button>
            )}
          </>
        )}

        {stage === 'measure' && quality && !basic && (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className={`font-mono text-5xl font-bold tracking-tight ${isRed ? 'text-red-400 line-through' : 'text-white'}`}>
                  {widthMm !== null ? widthMm.toFixed(1) : '—'}
                  <span className="ml-1 text-xl text-zinc-400">mm</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <ConfidenceChip confidence={quality.confidence} />
                  {reprojErrMm !== null && (
                    <Chip level="neutral">reproj {reprojErrMm.toFixed(2)} mm</Chip>
                  )}
                  {burstStats && (
                    <Chip level="neutral">
                      burst {burstStats.n} · spread {burstStats.spreadPct.toFixed(2)}%
                    </Chip>
                  )}
                  {shot?.meta.focusLocked && <Chip level="neutral">AF locked</Chip>}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {setup.mode === 'card' && (
                  <button
                    onClick={() => setStage('manual-ref')}
                    className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300"
                  >
                    Adjust corners
                  </button>
                )}
                <BigButton onClick={() => setSaveOpen(true)} disabled={widthMm === null}>
                  {isRed ? 'Save (unusable)' : 'Save'}
                </BigButton>
              </div>
            </div>
            {/* plain-English reasons */}
            <div className="mt-2 max-h-24 space-y-1 overflow-y-auto">
              {quality.checks
                .filter((c) => c.level !== 'green')
                .map((c) => (
                  <p key={c.id} className={`text-sm ${c.level === 'red' ? 'text-red-300' : 'text-amber-300'}`}>
                    ● {c.detail}
                  </p>
                ))}
              {quality.confidence === 'green' && (
                <p className="text-sm text-green-400">All quality checks passed.</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* save dialog */}
      {saveOpen && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/70" onClick={() => setSaveOpen(false)}>
          <div className="w-full max-w-md rounded-t-2xl bg-zinc-900 p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold text-white">
              {basic
                ? `Save — ${widthMm?.toFixed(0)} mm`
                : `Save measurement — ${widthMm?.toFixed(1)} mm (${setup.datum})`}
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              {setup.mode === 'two-marker'
                ? 'Typical accuracy for two stickers: ±10 mm (better with the photo burst). Below ~5 mm, check with a laser meter.'
                : 'Typical accuracy for this method: ±20–40 mm — fine for quoting; use two stickers for manufacture-grade numbers.'}
            </p>
            {setup.testMode && (
              <Field
                label={basic ? 'Tape measure says… (mm, optional)' : 'True width (tape-measured), mm'}
                hint={
                  basic
                    ? 'If you have a tape handy, type what it says — it helps check the camera is accurate.'
                    : 'Test Mode: ground truth for the accuracy harness'
                }
              >
                <input
                  type="number"
                  inputMode="decimal"
                  value={trueWidthStr}
                  onChange={(e) => setTrueWidthStr(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 1970"
                />
              </Field>
            )}
            <div className="mt-3">
              <Field
                label={basic ? 'Name this window (optional)' : 'Window label (optional)'}
                hint={
                  basic
                    ? 'So you can find it later, e.g. "Kitchen"'
                    : 'Measurements sharing a label are cross-checked against each other'
                }
              >
                <input
                  value={windowLabel}
                  onChange={(e) => setWindowLabel(e.target.value)}
                  className={inputCls}
                  placeholder={basic ? 'Kitchen' : 'e.g. kitchen-1'}
                />
              </Field>
            </div>
            {setup.testMode && trueWidthStr && Number(trueWidthStr) > 0 && widthMm !== null && (
              <p className="mt-3 font-mono text-sm text-zinc-300">
                error: {(widthMm - Number(trueWidthStr)).toFixed(1)} mm (
                {(((widthMm - Number(trueWidthStr)) / Number(trueWidthStr)) * 100).toFixed(2)}%)
              </p>
            )}
            <div className="mt-4 flex gap-3">
              <BigButton variant="secondary" onClick={() => setSaveOpen(false)} className="flex-1">
                Cancel
              </BigButton>
              <BigButton
                onClick={save}
                className="flex-1"
                disabled={setup.testMode && !basic && (!trueWidthStr || Number(trueWidthStr) <= 0)}
              >
                Save
              </BigButton>
            </div>
          </div>
        </div>
      )}

      {savedNote && (
        <div className="absolute inset-x-4 top-20 z-50 rounded-xl bg-zinc-800 p-4 text-center text-base text-white shadow-2xl">
          {savedNote}
        </div>
      )}
    </div>
  );
}
