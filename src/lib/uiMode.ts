import { useSyncExternalStore } from 'react';

/**
 * Two-tier UI: Basic (default — guided, plain language, smart defaults,
 * one instruction at a time) and Advanced (full instrumentation: gates,
 * reprojection numbers, harness stats, thresholds). Same pipeline underneath;
 * the mode only changes what's shown, never what's measured.
 */

export type UiMode = 'basic' | 'advanced';

const KEY = 'maxaccuracy.uiMode';
const listeners = new Set<() => void>();

export function getUiMode(): UiMode {
  return localStorage.getItem(KEY) === 'advanced' ? 'advanced' : 'basic';
}

export function setUiMode(mode: UiMode): void {
  localStorage.setItem(KEY, mode);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useUiMode(): UiMode {
  return useSyncExternalStore(subscribe, getUiMode);
}

/** Remember the last measurement setup so Basic users never re-enter it. */
const SETUP_KEY = 'maxaccuracy.lastSetup';

export interface RememberedSetup {
  mode: string;
  datum: string;
  markerSizeMm: number;
  markerSeparationMm: number;
}

export function rememberSetup(s: RememberedSetup): void {
  localStorage.setItem(SETUP_KEY, JSON.stringify(s));
}

export function recallSetup(): RememberedSetup | null {
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    return raw ? (JSON.parse(raw) as RememberedSetup) : null;
  } catch {
    return null;
  }
}

const INTRO_KEY = 'maxaccuracy.seenIntro';

export function hasSeenIntro(): boolean {
  return localStorage.getItem(INTRO_KEY) === 'yes';
}

export function markIntroSeen(): void {
  localStorage.setItem(INTRO_KEY, 'yes');
}
