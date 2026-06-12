import type { MeasurementRecord, RefMode } from '../types';

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export interface ModeStats {
  mode: RefMode | 'all';
  n: number;
  medianAbsErrPct: number | null;
  p90AbsErrPct: number | null;
  worstAbsErrPct: number | null;
  worstAbsErrMm: number | null;
}

export function computeModeStats(
  records: MeasurementRecord[],
  mode: RefMode | 'all',
): ModeStats {
  const test = records.filter(
    (r) => r.trueWidthMm !== null && r.errorPct !== null && (mode === 'all' || r.mode === mode),
  );
  const absPct = test.map((r) => Math.abs(r.errorPct!));
  const absMm = test.map((r) => Math.abs(r.errorMm!));
  return {
    mode,
    n: test.length,
    medianAbsErrPct: median(absPct),
    p90AbsErrPct: percentile(absPct, 90),
    worstAbsErrPct: absPct.length ? Math.max(...absPct) : null,
    worstAbsErrMm: absMm.length ? Math.max(...absMm) : null,
  };
}

export interface CrossCheckResult {
  windowLabel: string;
  measurements: MeasurementRecord[];
  spreadPct: number;
  agrees: boolean;
}

/**
 * Cross-check mode: independent measurements of the same window (same
 * windowLabel) must agree within tolerance. Disagreement flags the shots.
 */
export function crossChecks(
  records: MeasurementRecord[],
  tolerancePct: number,
): Map<string, CrossCheckResult> {
  const byLabel = new Map<string, MeasurementRecord[]>();
  for (const r of records) {
    const label = r.windowLabel.trim();
    if (!label) continue;
    const arr = byLabel.get(label) ?? [];
    arr.push(r);
    byLabel.set(label, arr);
  }
  const out = new Map<string, CrossCheckResult>();
  for (const [label, ms] of byLabel) {
    if (ms.length < 2) continue;
    const widths = ms.map((m) => m.widthMm);
    const mean = widths.reduce((a, v) => a + v, 0) / widths.length;
    const spreadPct = mean > 0 ? ((Math.max(...widths) - Math.min(...widths)) / mean) * 100 : 0;
    out.set(label, { windowLabel: label, measurements: ms, spreadPct, agrees: spreadPct <= tolerancePct });
  }
  return out;
}
