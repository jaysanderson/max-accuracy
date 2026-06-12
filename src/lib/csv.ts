import type { MeasurementRecord } from '../types';

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function measurementsToCsv(records: MeasurementRecord[]): string {
  const cols = [
    'createdAt',
    'mode',
    'refMethod',
    'datum',
    'windowLabel',
    'widthMm',
    'trueWidthMm',
    'errorMm',
    'errorPct',
    'confidence',
    'reasons',
    'reprojErrMm',
    'detectionConfidence',
    'profileApplied',
    'profileName',
    'pitchDeg',
    'rollDeg',
    'convergenceDeg',
    'overridden',
    'deviceLabel',
    'markerSizeMm',
    'markerSeparationMm',
  ] as const;
  const lines = [cols.join(',')];
  for (const r of records) {
    lines.push(
      cols
        .map((c) => {
          const v = r[c as keyof MeasurementRecord];
          if (c === 'reasons') return esc((r.reasons ?? []).join(' | '));
          if (typeof v === 'number') return esc(Math.round(v * 1000) / 1000);
          return esc(v);
        })
        .join(','),
    );
  }
  return lines.join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
