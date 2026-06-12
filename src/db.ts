import Dexie, { type Table } from 'dexie';
import type { DeviceProfile, DiagnosticRecord, MeasurementRecord } from './types';

class MaxAccuracyDB extends Dexie {
  profiles!: Table<DeviceProfile, number>;
  measurements!: Table<MeasurementRecord, number>;
  diagnostics!: Table<DiagnosticRecord, number>;

  constructor() {
    super('max-accuracy');
    this.version(1).stores({
      profiles: '++id, deviceModel, createdAt',
      measurements: '++id, createdAt, mode, windowLabel, confidence',
      diagnostics: '++id, createdAt, deviceLabel',
    });
  }
}

export const db = new MaxAccuracyDB();

const ACTIVE_PROFILE_KEY = 'maxaccuracy.activeProfileId';

export function getActiveProfileId(): number | null {
  const v = localStorage.getItem(ACTIVE_PROFILE_KEY);
  return v ? Number(v) : null;
}

export function setActiveProfileId(id: number | null): void {
  if (id === null) localStorage.removeItem(ACTIVE_PROFILE_KEY);
  else localStorage.setItem(ACTIVE_PROFILE_KEY, String(id));
}

export async function getActiveProfile(): Promise<DeviceProfile | null> {
  const id = getActiveProfileId();
  if (id === null) return null;
  const p = await db.profiles.get(id);
  return p ?? null;
}

const TEST_MODE_KEY = 'maxaccuracy.testMode';

export function getTestMode(): boolean {
  return localStorage.getItem(TEST_MODE_KEY) !== 'off';
}

export function setTestMode(on: boolean): void {
  localStorage.setItem(TEST_MODE_KEY, on ? 'on' : 'off');
}

export function deviceLabel(): string {
  const stored = localStorage.getItem('maxaccuracy.deviceLabel');
  if (stored) return stored;
  const ua = navigator.userAgent;
  const m = ua.match(/\(([^)]+)\)/);
  return m ? m[1].split(';').slice(0, 2).join(';').trim() : 'unknown-device';
}

export function setDeviceLabel(label: string): void {
  localStorage.setItem('maxaccuracy.deviceLabel', label);
}
