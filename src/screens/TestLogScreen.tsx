import { useEffect, useState } from 'react';
import { BigButton, Card, Chip, Screen } from '../components/ui';
import { getConfig } from '../config';
import { db } from '../db';
import { downloadText, measurementsToCsv } from '../lib/csv';
import { computeModeStats, crossChecks, type ModeStats } from '../lib/stats';
import { useUiMode } from '../lib/uiMode';
import type { MeasurementRecord, RefMode } from '../types';

/**
 * The accuracy harness. Success for this whole phase is defined HERE:
 * median |error| ≤ 2% overall and ≤ 1% in two-marker mode, on real windows
 * with tape-measured ground truth. Everything else is plumbing.
 */

const MODES: (RefMode | 'all')[] = ['all', 'two-marker', 'single-marker', 'card'];

function StatBlock({ s, targetPct }: { s: ModeStats; targetPct: number | null }) {
  const pass = targetPct !== null && s.medianAbsErrPct !== null ? s.medianAbsErrPct <= targetPct : null;
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white">{s.mode}</span>
        {targetPct !== null &&
          (s.n === 0 ? (
            <Chip level="neutral">target ≤ {targetPct}%</Chip>
          ) : (
            <Chip level={pass ? 'green' : 'red'}>
              {pass ? 'PASS' : 'FAIL'} target ≤ {targetPct}%
            </Chip>
          ))}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center">
        {[
          ['n', s.n === 0 ? '—' : String(s.n)],
          ['median |err|', s.medianAbsErrPct === null ? '—' : `${s.medianAbsErrPct.toFixed(2)}%`],
          ['p90', s.p90AbsErrPct === null ? '—' : `${s.p90AbsErrPct.toFixed(2)}%`],
          ['worst', s.worstAbsErrPct === null ? '—' : `${s.worstAbsErrPct.toFixed(2)}% (${s.worstAbsErrMm?.toFixed(0)} mm)`],
        ].map(([k, v]) => (
          <div key={k}>
            <p className="text-[11px] text-zinc-500">{k}</p>
            <p className="font-mono text-sm text-zinc-100">{v}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TestLogScreen({ onBack }: { onBack: () => void }) {
  const cfg = getConfig();
  const basic = useUiMode() === 'basic';
  const [records, setRecords] = useState<MeasurementRecord[]>([]);
  const [profileFilter, setProfileFilter] = useState<'all' | 'with' | 'without'>('all');

  const refresh = () =>
    db.measurements.orderBy('createdAt').reverse().toArray().then(setRecords);
  useEffect(() => {
    void refresh();
  }, []);

  // ---------- BASIC: a simple, readable history ----------
  if (basic) {
    return (
      <Screen title="My measurements" onBack={onBack}>
        {records.length === 0 && (
          <Card>
            <p className="text-zinc-400">Nothing saved yet. Measure your first window and it'll show up here.</p>
          </Card>
        )}
        <div className="space-y-3">
          {records.map((r) => (
            <Card key={r.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-bold text-white">
                  {r.windowLabel || 'Unnamed window'}
                </p>
                <p className="text-xs text-zinc-500">
                  {new Date(r.createdAt).toLocaleString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {r.datum === 'recess' ? 'recess fit' : r.datum === 'face' ? 'face fit' : r.datum}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className={`font-mono text-2xl font-bold ${r.confidence === 'red' ? 'text-red-400 line-through' : 'text-white'}`}>
                    {r.widthMm.toFixed(0)}
                    <span className="ml-0.5 text-sm text-zinc-400">mm</span>
                  </p>
                  <span
                    className={`text-xs font-semibold ${
                      { green: 'text-green-400', amber: 'text-amber-400', red: 'text-red-400' }[r.confidence]
                    }`}
                  >
                    {r.confidence === 'green' ? '✓ good' : r.confidence === 'amber' ? '⚠ double-check' : '✗ not reliable'}
                  </span>
                </div>
                <button
                  onClick={async () => {
                    await db.measurements.delete(r.id!);
                    await refresh();
                  }}
                  className="flex size-10 items-center justify-center rounded-lg text-zinc-500 active:bg-zinc-800"
                  aria-label={`Delete ${r.windowLabel || 'measurement'}`}
                >
                  ✕
                </button>
              </div>
            </Card>
          ))}
        </div>
        {records.length > 0 && (
          <p className="mt-4 text-center text-xs text-zinc-600">
            Accuracy stats and CSV export live in Advanced view (switch on the home screen).
          </p>
        )}
      </Screen>
    );
  }

  const filtered = records.filter((r) =>
    profileFilter === 'all' ? true : profileFilter === 'with' ? r.profileApplied : !r.profileApplied,
  );
  const cc = crossChecks(records, cfg.quality.crossCheckTolerancePct);

  return (
    <Screen
      title="Test results"
      onBack={onBack}
      actions={
        <BigButton
          variant="ghost"
          className="min-h-10 px-3 text-sm"
          onClick={() => downloadText(`maxaccuracy-testlog-${new Date().toISOString().slice(0, 10)}.csv`, measurementsToCsv(records))}
          disabled={records.length === 0}
        >
          Export CSV
        </BigButton>
      }
    >
      {/* profile A/B filter: proves calibration before/after */}
      <div className="mb-4 flex gap-2">
        {(['all', 'with', 'without'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setProfileFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              profileFilter === f ? 'bg-brand text-brand-ink' : 'bg-zinc-800 text-zinc-300'
            }`}
          >
            {f === 'all' ? 'All shots' : f === 'with' ? 'Profile applied' : 'No profile'}
          </button>
        ))}
      </div>

      <div className="mb-4 space-y-3">
        {MODES.map((m) => (
          <StatBlock
            key={m}
            s={computeModeStats(filtered, m)}
            targetPct={
              m === 'all'
                ? cfg.targets.overallMedianErrPct
                : m === 'two-marker'
                  ? cfg.targets.twoMarkerMedianErrPct
                  : null
            }
          />
        ))}
      </div>

      {cc.size > 0 && (
        <Card className="mb-4">
          <p className="mb-2 font-semibold text-white">Cross-checks</p>
          {[...cc.values()].map((c) => (
            <div key={c.windowLabel} className="flex items-center justify-between border-b border-zinc-800 py-1.5 last:border-0">
              <span className="text-sm text-zinc-300">
                {c.windowLabel} ({c.measurements.length}×)
              </span>
              <Chip level={c.agrees ? 'green' : 'red'}>
                {c.agrees ? `agrees ${c.spreadPct.toFixed(2)}%` : `disagrees ${c.spreadPct.toFixed(2)}% — re-shoot`}
              </Chip>
            </div>
          ))}
        </Card>
      )}

      {/* full table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              {['when', 'mode', 'datum', 'window', 'measured', 'true', 'err mm', 'err %', 'conf', 'reproj', 'tilt°', 'profile', 'ovr', ''].map((h) => (
                <th key={h} className="px-2 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 text-zinc-200">
                <td className="px-2 py-1.5 whitespace-nowrap">{new Date(r.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-2 py-1.5">{r.mode}{r.refMethod === 'manual' ? ' (manual)' : ''}</td>
                <td className="px-2 py-1.5">{r.datum}</td>
                <td className="px-2 py-1.5">{r.windowLabel || '—'}</td>
                <td className="px-2 py-1.5 font-mono">{r.widthMm.toFixed(1)}</td>
                <td className="px-2 py-1.5 font-mono">{r.trueWidthMm?.toFixed(0) ?? '—'}</td>
                <td className="px-2 py-1.5 font-mono">{r.errorMm?.toFixed(1) ?? '—'}</td>
                <td className={`px-2 py-1.5 font-mono ${r.errorPct !== null && Math.abs(r.errorPct) > cfg.targets.overallMedianErrPct ? 'text-red-400' : ''}`}>
                  {r.errorPct?.toFixed(2) ?? '—'}
                </td>
                <td className="px-2 py-1.5">
                  <span className={{ green: 'text-green-400', amber: 'text-amber-400', red: 'font-bold text-red-400' }[r.confidence]}>
                    {r.confidence}
                  </span>
                </td>
                <td className="px-2 py-1.5 font-mono">{r.reprojErrMm?.toFixed(2) ?? '—'}</td>
                <td className="px-2 py-1.5 font-mono">
                  {r.pitchDeg !== null ? Math.max(Math.abs(r.pitchDeg), Math.abs(r.rollDeg ?? 0)).toFixed(1) : '—'}
                </td>
                <td className="px-2 py-1.5">{r.profileApplied ? '✓' : '✗'}</td>
                <td className="px-2 py-1.5">{r.overridden ? '⚠' : ''}</td>
                <td className="px-2 py-1.5">
                  <button
                    onClick={async () => {
                      await db.measurements.delete(r.id!);
                      await refresh();
                    }}
                    className="text-red-400"
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-6 text-center text-zinc-500">
                  No measurements yet. Enable Test Mode, measure a window, enter the tape-measured truth.
                  Protocol: same window 5× per mode, ≥3 windows including one ≥1900 mm, with and without the profile.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Screen>
  );
}
