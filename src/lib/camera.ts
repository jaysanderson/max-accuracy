import { useCallback, useEffect, useRef, useState } from 'react';
import { getConfig } from '../config';

/** Minimal ImageCapture typing — not yet in lib.dom. */
declare global {
  interface Window {
    ImageCapture?: new (track: MediaStreamTrack) => {
      takePhoto: (settings?: Record<string, unknown>) => Promise<Blob>;
    };
  }
}

export interface FullResCapture {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  source: 'ImageCapture' | 'videoFrame';
}

export interface CameraState {
  videoRef: React.RefObject<HTMLVideoElement>;
  ready: boolean;
  error: string | null;
  /** Capture at the highest resolution available. */
  captureFullRes: () => Promise<FullResCapture>;
  /** Grab a downscaled frame for live analysis. Returns null until ready. */
  grabAnalysisFrame: (targetHeight: number) => ImageData | null;
}

export function useCamera(): CameraState {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cfg = getConfig();
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: cfg.capture.idealCaptureWidth },
            height: { ideal: cfg.capture.idealCaptureHeight },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          setReady(true);
        }
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error
              ? `Camera unavailable: ${e.message}. The app needs HTTPS (or localhost) and camera permission.`
              : 'Camera unavailable',
          );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const captureFullRes = useCallback(async (): Promise<FullResCapture> => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) throw new Error('Camera not running');
    const track = stream.getVideoTracks()[0];
    // Prefer ImageCapture.takePhoto — it can exceed the stream resolution.
    if (window.ImageCapture && track) {
      try {
        const ic = new window.ImageCapture(track);
        const blob = await ic.takePhoto();
        const bitmap = await createImageBitmap(blob);
        return { bitmap, width: bitmap.width, height: bitmap.height, source: 'ImageCapture' };
      } catch {
        // fall through to video frame
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.drawImage(video, 0, 0);
    const bitmap = await createImageBitmap(canvas);
    return { bitmap, width: bitmap.width, height: bitmap.height, source: 'videoFrame' };
  }, []);

  const grabAnalysisFrame = useCallback((targetHeight: number): ImageData | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const scale = targetHeight / video.videoHeight;
    const w = Math.round(video.videoWidth * scale);
    const h = targetHeight;
    let canvas = analysisCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      analysisCanvasRef.current = canvas;
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }, []);

  return { videoRef, ready, error, captureFullRes, grabAnalysisFrame };
}
