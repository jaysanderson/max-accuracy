import { useEffect, useRef } from 'react';
import type { Pt } from '../types';

/**
 * Magnifier loupe for sub-pixel handle placement: shows a zoomed crop of the
 * source canvas around the point being dragged, with a crosshair, positioned
 * clear of the finger.
 */
export function Loupe(props: {
  sourceCanvas: HTMLCanvasElement | null;
  /** Point in source-canvas pixel coordinates. */
  point: Pt | null;
  zoom?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const SIZE = 140;
  const zoom = props.zoom ?? 4;

  useEffect(() => {
    const canvas = ref.current;
    const src = props.sourceCanvas;
    const p = props.point;
    if (!canvas || !src || !p) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const crop = SIZE / zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(src, p.x - crop / 2, p.y - crop / 2, crop, crop, 0, 0, SIZE, SIZE);
    // Crosshair
    ctx.strokeStyle = 'rgba(92,229,0,0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, 0);
    ctx.lineTo(SIZE / 2, SIZE / 2 - 8);
    ctx.moveTo(SIZE / 2, SIZE / 2 + 8);
    ctx.lineTo(SIZE / 2, SIZE);
    ctx.moveTo(0, SIZE / 2);
    ctx.lineTo(SIZE / 2 - 8, SIZE / 2);
    ctx.moveTo(SIZE / 2 + 8, SIZE / 2);
    ctx.lineTo(SIZE, SIZE / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 2, 0, Math.PI * 2);
    ctx.stroke();
  }, [props.sourceCanvas, props.point, zoom]);

  if (!props.point) return null;
  return (
    <canvas
      ref={ref}
      width={SIZE}
      height={SIZE}
      className="pointer-events-none fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full border-2 border-brand shadow-2xl"
    />
  );
}
