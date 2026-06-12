import { useState } from 'react';
import { BigButton, Card, Field, inputCls, Screen } from '../components/ui';
import { getConfig } from '../config';
import { markerMatrix } from '../lib/aruco';
import { generateMarkerSheet } from '../lib/markerPdf';
import { getOverridesRaw, saveOverrides } from '../config';
import { useUiMode } from '../lib/uiMode';

/** Marker sheet generator: exact-mm vector PDF with a print-scale check ruler. */

function MarkerPreview({ id, size = 84 }: { id: number; size?: number }) {
  const m = markerMatrix(id);
  const cell = size / 7;
  return (
    <svg width={size} height={size} className="rounded bg-white p-0" style={{ padding: cell / 2 }}>
      {m.flatMap((row, r) =>
        row.map((v, c) =>
          v ? <rect key={`${r}-${c}`} x={c * cell * (6 / 7) + cell / 2} y={r * cell * (6 / 7) + cell / 2} width={cell * (6 / 7) + 0.5} height={cell * (6 / 7) + 0.5} fill="#000" /> : null,
        ),
      )}
    </svg>
  );
}

export function MarkerSheetScreen({ onBack }: { onBack: () => void }) {
  const cfg = getConfig().reference;
  const basic = useUiMode() === 'basic';
  const [sizeMm, setSizeMm] = useState(String(cfg.defaultMarkerSizeMm));
  const [rulerMm, setRulerMm] = useState(
    cfg.printScaleFactor !== 1 ? (cfg.printScaleFactor * 100).toFixed(1) : '',
  );
  const [scaleSaved, setScaleSaved] = useState(false);

  const s = Number(sizeMm);
  const valid = Number.isFinite(s) && s >= 30 && s <= 150;

  /** Printers run 0.5–1% off; the measured ruler corrects every marker size. */
  function saveRulerMeasurement(v: string) {
    setRulerMm(v);
    setScaleSaved(false);
    const measured = Number(v);
    if (!Number.isFinite(measured) || measured < 90 || measured > 110) return;
    try {
      const overrides = JSON.parse(getOverridesRaw());
      overrides.reference = { ...(overrides.reference ?? {}), printScaleFactor: measured / 100 };
      saveOverrides(overrides);
      setScaleSaved(true);
    } catch {
      /* ignore malformed overrides */
    }
  }

  return (
    <Screen title={basic ? 'Measuring stickers' : 'Marker sheet'} onBack={onBack}>
      <Card className="mb-4">
        {basic ? (
          <p className="text-sm leading-relaxed text-zinc-300">
            Print this PDF, cut out the stickers, and keep them in your kit. Before first use,{' '}
            <strong className="text-amber-300">check the ruler on the page with a tape measure — it must read exactly 100 mm</strong>.
            If it doesn't, print again at 100% size (never "fit to page").
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-zinc-300">
            Generates a printable PDF: page 1 has the <strong className="text-white">two-marker pair</strong> (ids {cfg.markerIdA} & {cfg.markerIdB}),
            page 2 a <strong className="text-white">single marker</strong> (id {cfg.markerIdSingle}). Every page carries a 100 mm check
            ruler — <strong className="text-amber-300">tape-measure it after printing</strong>; if it isn't exactly 100 mm the print is scaled and unusable.
            Print at 100% / "Actual size".
          </p>
        )}
      </Card>

      <div className="mb-4 flex items-center justify-center gap-6">
        {[cfg.markerIdA, cfg.markerIdB, cfg.markerIdSingle].map((id) => (
          <div key={id} className="text-center">
            <MarkerPreview id={id} />
            <p className="mt-1 text-xs text-zinc-400">id {id}</p>
          </div>
        ))}
      </div>

      {!basic && (
        <>
          <Field label="Marker size (mm)" hint="Bigger is better — more pixels on the reference. 60 mm fits two per A4 with cut margins.">
            <input type="number" inputMode="numeric" value={sizeMm} onChange={(e) => setSizeMm(e.target.value)} className={inputCls} />
          </Field>
          {!valid && <p className="mt-1 text-sm text-red-400">Enter 30–150 mm.</p>}
        </>
      )}

      <BigButton
        className="mt-4 w-full"
        disabled={!valid}
        onClick={() =>
          generateMarkerSheet({ markerSizeMm: s, idA: cfg.markerIdA, idB: cfg.markerIdB, idSingle: cfg.markerIdSingle })
        }
      >
        {basic ? 'Get the PDF' : 'Generate PDF'}
      </BigButton>

      <Card className="mt-4">
        <Field
          label={basic ? 'After printing: what does the ruler measure? (mm)' : 'Measured check-ruler length (mm)'}
          hint={
            basic
              ? "Printers cheat the size a little. Measure the ruler on the printed page with your tape and type it here — we'll correct for it."
              : 'Sets printScaleFactor = measured/100; applied to every marker size at measurement time. Printers commonly run 0.5–1% off — 10–20 mm across a 2 m window.'
          }
        >
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={rulerMm}
            onChange={(e) => saveRulerMeasurement(e.target.value)}
            className={inputCls}
            placeholder="100"
          />
        </Field>
        {scaleSaved && (
          <p className="mt-2 text-sm text-green-400">
            Saved — marker sizes are now corrected by ×{(Number(rulerMm) / 100).toFixed(4)}.
          </p>
        )}
      </Card>

      <Card className="mt-4">
        {basic ? (
          <p className="text-xs leading-relaxed text-zinc-400">
            On the job: stick one sticker on the wall each side of the window, level with each other (same
            wall surface the opening sits in). Measure the distance between the sticker centres once with your
            tape — the app asks for that number before the photo.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-zinc-400">
            Field setup for two-marker mode: fix the cut-out markers on the WALL each side of the window opening,
            level with each other (a pre-marked bar or string at fixed spacing is ideal). They must sit in the same
            plane as the edges you'll mark — the wall face, not the glass. Tape-measure the centre-to-centre
            separation and enter it when measuring. The scale baseline then spans the measurement, in-plane,
            exactly where lens distortion bites hardest.
          </p>
        )}
      </Card>
    </Screen>
  );
}
