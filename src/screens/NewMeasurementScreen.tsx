import { useState } from 'react';
import { BigButton, Card, Field, inputCls, Screen } from '../components/ui';
import { getConfig } from '../config';
import { getTestMode } from '../db';
import { recallSetup, rememberSetup, useUiMode } from '../lib/uiMode';
import type { Datum, MeasureSetup, RefMode } from '../types';

/**
 * Pre-capture setup. Basic mode asks two picture-book questions with smart
 * defaults remembered from last time; Advanced exposes marker size and the
 * full terminology. The datum is chosen BEFORE marking so every measurement
 * records exactly what was measured.
 */

const MODES: { id: RefMode; basic: string; basicDesc: string; adv: string; advDesc: string; badge?: string }[] = [
  {
    id: 'two-marker',
    basic: 'Two stickers beside the window',
    basicDesc: 'One on the wall each side of the window, level with each other. Most accurate — best for wide windows.',
    adv: 'Two markers',
    advDesc: 'Markers on the wall plane each side of the opening at known separation. The scale baseline spans the opening — ≤1% target.',
    badge: 'Most accurate',
  },
  {
    id: 'single-marker',
    basic: 'One sticker beside the window',
    basicDesc: 'Quick. Fine for narrow windows.',
    adv: 'Single marker',
    advDesc: 'One printed marker of known size on the wall plane. Scale error amplifies on wide openings.',
  },
  {
    id: 'card',
    basic: 'A bank card held against the wall',
    basicDesc: 'No stickers needed. Hold any standard card flat on the wall beside the window.',
    adv: 'Bank card',
    advDesc: 'ISO ID-1 card (85.60 × 53.98 mm) held flat on the wall plane. Zero prep, largest amplification.',
  },
];

const DATUMS: { id: Datum; label: string; basicDesc: string }[] = [
  { id: 'recess', label: 'Recess fit', basicDesc: 'inside the opening, wall to wall' },
  { id: 'face', label: 'Face fit', basicDesc: 'outside width the blind will cover' },
];

export function NewMeasurementScreen(props: { onStart: (setup: MeasureSetup) => void; onBack: () => void }) {
  const cfg = getConfig().reference;
  const uiMode = useUiMode();
  const basic = uiMode === 'basic';
  const remembered = recallSetup();

  const [mode, setMode] = useState<RefMode>((remembered?.mode as RefMode) ?? 'two-marker');
  const [datum, setDatum] = useState<Datum>((remembered?.datum as Datum) ?? 'recess');
  const [markerSize, setMarkerSize] = useState(String(remembered?.markerSizeMm ?? cfg.defaultMarkerSizeMm));
  const [separation, setSeparation] = useState(String(remembered?.markerSeparationMm ?? cfg.defaultMarkerSeparationMm));
  const [windowLabel, setWindowLabel] = useState('');

  const sizeOk = Number(markerSize) > 0;
  const sepOk = mode !== 'two-marker' || Number(separation) > 0;

  function start() {
    rememberSetup({ mode, datum, markerSizeMm: Number(markerSize), markerSeparationMm: Number(separation) });
    props.onStart({
      mode,
      datum,
      markerSizeMm: Number(markerSize),
      markerSeparationMm: Number(separation),
      testMode: getTestMode(),
      windowLabel,
    });
  }

  return (
    <Screen
      title={basic ? 'Before you shoot' : 'New measurement'}
      subtitle={basic ? 'Step 1 of 3 — quick setup' : undefined}
      onBack={props.onBack}
    >
      <p className="mb-2 text-sm font-semibold text-zinc-400">
        {basic ? "WHAT'S IN YOUR PHOTO AS A SIZE REFERENCE?" : 'REFERENCE'}
      </p>
      <div className="mb-5 space-y-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            className={`relative w-full rounded-xl border p-4 text-left ${
              mode === m.id ? 'border-brand bg-brand/10' : 'border-zinc-700 bg-zinc-900'
            }`}
          >
            {basic && m.badge && (
              <span className="absolute right-3 top-3 rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-bold text-green-300">
                {m.badge}
              </span>
            )}
            <p className="pr-24 font-semibold text-white">{basic ? m.basic : m.adv}</p>
            <p className="mt-0.5 text-sm text-zinc-400">{basic ? m.basicDesc : m.advDesc}</p>
          </button>
        ))}
      </div>

      {mode === 'two-marker' && (
        <Card className="mb-5">
          <Field
            label={basic ? 'How far apart are the sticker centres? (mm)' : 'Separation (mm)'}
            hint={
              basic
                ? 'Measure once with your tape, centre of one sticker to centre of the other. Type it here.'
                : 'Centre-to-centre, tape-measured'
            }
          >
            <input
              type="number"
              inputMode="decimal"
              value={separation}
              onChange={(e) => setSeparation(e.target.value)}
              className={inputCls}
              placeholder="e.g. 1600"
            />
          </Field>
        </Card>
      )}
      {!basic && mode !== 'card' && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <Field label="Marker size (mm)" hint="As printed — verify with the sheet ruler">
            <input type="number" inputMode="decimal" value={markerSize} onChange={(e) => setMarkerSize(e.target.value)} className={inputCls} />
          </Field>
        </div>
      )}

      <p className="mb-2 text-sm font-semibold text-zinc-400">
        {basic ? 'HOW WILL THE BLIND BE FITTED?' : 'DATUM — what the width means'}
      </p>
      <div className="mb-5 flex gap-2">
        {DATUMS.map((d) => (
          <button
            key={d.id}
            onClick={() => setDatum(d.id)}
            aria-pressed={datum === d.id}
            className={`flex-1 rounded-xl border px-2 py-3 text-center ${
              datum === d.id ? 'border-brand bg-brand/10 text-white' : 'border-zinc-700 bg-zinc-900 text-zinc-300'
            }`}
          >
            <span className="block text-sm font-semibold">{d.label}</span>
            <span className="mt-0.5 block text-[11px] text-zinc-500">{d.basicDesc}</span>
          </button>
        ))}
      </div>

      <Card className="mb-5">
        <Field
          label={basic ? 'Name this window (optional)' : 'Window label (optional)'}
          hint={
            basic
              ? 'So you can find it later, e.g. "Kitchen" or "Bedroom 2"'
              : 'Measurements sharing a label are cross-checked against each other'
          }
        >
          <input value={windowLabel} onChange={(e) => setWindowLabel(e.target.value)} className={inputCls} placeholder={basic ? 'Kitchen' : 'e.g. kitchen-1'} />
        </Field>
      </Card>

      <BigButton className="w-full" disabled={!sizeOk || !sepOk} onClick={start}>
        {basic ? 'Open the camera →' : 'Open camera →'}
      </BigButton>
      {basic && mode === 'two-marker' && !sepOk && (
        <p className="mt-2 text-center text-sm text-brand-light">Type the sticker distance first — it's how we get the size right.</p>
      )}
    </Screen>
  );
}
