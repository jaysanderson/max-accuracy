import type { CapturedShot, MeasureSetup } from '../types';

/**
 * Transient in-memory state for the capture → measure flow. Full-resolution
 * bitmaps never go through IndexedDB or React state; they live here for the
 * duration of one measurement.
 */
interface Session {
  setup: MeasureSetup | null;
  shot: CapturedShot | null;
}

export const session: Session = {
  setup: null,
  shot: null,
};

export function clearShot(): void {
  session.shot?.bitmap.close();
  session.shot = null;
}
