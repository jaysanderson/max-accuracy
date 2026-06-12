import type { CapturedBurst, MeasureSetup } from '../types';

/**
 * Transient in-memory state for the capture → measure flow. Full-resolution
 * bitmaps never go through IndexedDB or React state; they live here for the
 * duration of one measurement. Frame 0 of the burst is the master frame.
 */
interface Session {
  setup: MeasureSetup | null;
  burst: CapturedBurst | null;
}

export const session: Session = {
  setup: null,
  burst: null,
};

export function clearShot(): void {
  for (const f of session.burst?.frames ?? []) f.close();
  session.burst = null;
}
