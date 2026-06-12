import { useState } from 'react';
import { BigButton, Card, Field, inputCls, Screen, Toggle } from '../components/ui';
import { getConfig, getOverridesRaw, resetConfig, saveOverrides, type AppConfig } from '../config';
import { deviceLabel, setDeviceLabel } from '../db';

/**
 * Every named threshold is editable here — common ones as fields, the whole
 * config as JSON for anything else. No rebuild needed for field tuning.
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [cfg, setCfg] = useState<AppConfig>(getConfig());
  const [json, setJson] = useState(getOverridesRaw());
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [device, setDevice] = useState(deviceLabel());

  function patch(p: (c: AppConfig) => void) {
    const next = structuredClone(cfg);
    p(next);
    setCfg(saveOverrides(next));
    setJson(getOverridesRaw());
  }

  return (
    <Screen title="Settings" onBack={onBack}>
      <Card className="mb-4">
        <Field label="Device label" hint="Stamped on every measurement and diagnostic">
          <input
            value={device}
            onChange={(e) => {
              setDevice(e.target.value);
              setDeviceLabel(e.target.value);
            }}
            className={inputCls}
          />
        </Field>
      </Card>

      <Card className="mb-4">
        <p className="mb-2 font-semibold text-white">Capture gates</p>
        <Toggle label={`Tilt gate (±${cfg.capture.pitchRollThresholdDeg}°)`} checked={cfg.gates.tilt} onChange={(v) => patch((c) => void (c.gates.tilt = v))} />
        <Toggle label={`Yaw / edge gate (±${cfg.capture.edgeConvergenceThresholdDeg}°)`} checked={cfg.gates.edges} onChange={(v) => patch((c) => void (c.gates.edges = v))} />
        <Toggle label="Reference lock gate" checked={cfg.gates.referenceLock} onChange={(v) => patch((c) => void (c.gates.referenceLock = v))} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Tilt threshold (°)">
            <input
              type="number" inputMode="decimal" step="0.5" value={cfg.capture.pitchRollThresholdDeg} className={inputCls}
              onChange={(e) => patch((c) => void (c.capture.pitchRollThresholdDeg = Number(e.target.value) || 3))}
            />
          </Field>
          <Field label="Convergence threshold (°)">
            <input
              type="number" inputMode="decimal" step="0.25" value={cfg.capture.edgeConvergenceThresholdDeg} className={inputCls}
              onChange={(e) => patch((c) => void (c.capture.edgeConvergenceThresholdDeg = Number(e.target.value) || 1.5))}
            />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <p className="mb-2 font-semibold text-white">Quality limits</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reproj amber (mm)">
            <input type="number" inputMode="decimal" step="0.1" value={cfg.quality.reprojAmberMm} className={inputCls}
              onChange={(e) => patch((c) => void (c.quality.reprojAmberMm = Number(e.target.value) || 1))} />
          </Field>
          <Field label="Reproj red (mm)">
            <input type="number" inputMode="decimal" step="0.1" value={cfg.quality.reprojRedMm} className={inputCls}
              onChange={(e) => patch((c) => void (c.quality.reprojRedMm = Number(e.target.value) || 3))} />
          </Field>
          <Field label="Cross-check tol (%)">
            <input type="number" inputMode="decimal" step="0.1" value={cfg.quality.crossCheckTolerancePct} className={inputCls}
              onChange={(e) => patch((c) => void (c.quality.crossCheckTolerancePct = Number(e.target.value) || 1))} />
          </Field>
          <Field label="Diagnostic bow verdict (% frame)">
            <input type="number" inputMode="decimal" step="0.01" value={cfg.diagnostic.bowVerdictPctOfFrame} className={inputCls}
              onChange={(e) => patch((c) => void (c.diagnostic.bowVerdictPctOfFrame = Number(e.target.value) || 0.1))} />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <p className="mb-2 font-semibold text-white">Full config (JSON overrides)</p>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={8}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-200"
        />
        {jsonErr && <p className="mt-1 text-sm text-red-400">{jsonErr}</p>}
        <div className="mt-2 flex gap-3">
          <BigButton
            variant="secondary"
            className="flex-1"
            onClick={() => {
              try {
                setCfg(saveOverrides(JSON.parse(json)));
                setJsonErr(null);
              } catch (e) {
                setJsonErr(e instanceof Error ? e.message : 'Invalid JSON');
              }
            }}
          >
            Apply JSON
          </BigButton>
          <BigButton
            variant="danger"
            className="flex-1"
            onClick={() => {
              setCfg(resetConfig());
              setJson(getOverridesRaw());
              setJsonErr(null);
            }}
          >
            Reset all
          </BigButton>
        </div>
      </Card>
    </Screen>
  );
}
