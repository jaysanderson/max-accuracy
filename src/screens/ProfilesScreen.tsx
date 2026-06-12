import { useEffect, useRef, useState } from 'react';
import { BigButton, Card, Chip, Screen } from '../components/ui';
import { db, getActiveProfileId, setActiveProfileId } from '../db';
import type { DeviceProfile } from '../types';

/**
 * Device profile management: import calibration JSON (paste or upload — the
 * Python utility's output drops straight in), choose the active profile,
 * inspect what's applied at capture time.
 */

interface ImportShape {
  deviceModel?: string;
  name?: string;
  calibratedWidth?: number;
  calibratedHeight?: number;
  imageWidth?: number;
  imageHeight?: number;
  cameraMatrix: number[] | number[][];
  distCoeffs: number[];
  rms?: number;
}

function parseProfileJson(text: string): Omit<DeviceProfile, 'id'> {
  const raw = JSON.parse(text) as ImportShape;
  const K = Array.isArray(raw.cameraMatrix[0])
    ? (raw.cameraMatrix as number[][]).flat()
    : (raw.cameraMatrix as number[]);
  if (K.length !== 9) throw new Error('cameraMatrix must be 3×3');
  const D = raw.distCoeffs.flat();
  if (D.length < 4) throw new Error('distCoeffs must have ≥4 coefficients (k1 k2 p1 p2 [k3])');
  const w = raw.calibratedWidth ?? raw.imageWidth;
  const h = raw.calibratedHeight ?? raw.imageHeight;
  if (!w || !h) throw new Error('Missing calibratedWidth/calibratedHeight (or imageWidth/imageHeight)');
  return {
    name: raw.name ?? raw.deviceModel ?? 'imported profile',
    deviceModel: raw.deviceModel ?? 'unknown',
    calibratedWidth: w,
    calibratedHeight: h,
    cameraMatrix: K,
    distCoeffs: D.slice(0, 5),
    rms: raw.rms ?? 0,
    createdAt: new Date().toISOString(),
    source: 'imported',
  };
}

export function ProfilesScreen({ onBack, onCalibrate }: { onBack: () => void; onCalibrate: () => void }) {
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [activeId, setActiveId] = useState<number | null>(getActiveProfileId());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => db.profiles.toArray().then(setProfiles);
  useEffect(() => {
    void refresh();
  }, []);

  async function importText(text: string) {
    try {
      const p = parseProfileJson(text);
      const id = await db.profiles.add(p);
      if (activeId === null) {
        setActiveProfileId(id);
        setActiveId(id);
      }
      setError(null);
      setPasteOpen(false);
      setPasteText('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid profile JSON');
    }
  }

  return (
    <Screen title="Device profiles" onBack={onBack}>
      <div className="mb-4 flex gap-3">
        <BigButton variant="secondary" onClick={() => fileRef.current?.click()} className="flex-1">
          Upload JSON
        </BigButton>
        <BigButton variant="secondary" onClick={() => setPasteOpen((v) => !v)} className="flex-1">
          Paste JSON
        </BigButton>
        <BigButton onClick={onCalibrate} className="flex-1">
          Calibrate here
        </BigButton>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await importText(await f.text());
          e.target.value = '';
        }}
      />
      {pasteOpen && (
        <Card className="mb-4">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            placeholder='{"deviceModel": "...", "cameraMatrix": [...9 numbers...], "distCoeffs": [k1,k2,p1,p2,k3], "imageWidth": 4032, "imageHeight": 3024, "rms": 0.4}'
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-200"
          />
          <BigButton onClick={() => importText(pasteText)} className="mt-2 w-full">
            Import
          </BigButton>
        </Card>
      )}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {profiles.length === 0 && (
        <Card>
          <p className="text-zinc-400">
            No profiles yet. Run the straight-edge diagnostic first — if it reports distortion, calibrate this
            device (in-browser, or <code className="text-brand-light">tools/calibrate</code> on a computer) and import the JSON here.
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {profiles.map((p) => (
          <Card key={p.id} className={activeId === p.id ? 'border-brand/70' : ''}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-white">{p.name}</p>
                <p className="text-xs text-zinc-400">
                  {p.deviceModel} · {p.calibratedWidth}×{p.calibratedHeight} · rms {p.rms.toFixed(3)} px · {p.source}
                </p>
                <p className="mt-1 font-mono text-[10px] text-zinc-500">
                  fx {p.cameraMatrix[0].toFixed(0)} fy {p.cameraMatrix[4].toFixed(0)} | k1 {p.distCoeffs[0]?.toFixed(4)} k2{' '}
                  {p.distCoeffs[1]?.toFixed(4)}
                </p>
              </div>
              {activeId === p.id ? (
                <Chip level="green">active</Chip>
              ) : (
                <button
                  onClick={() => {
                    setActiveProfileId(p.id!);
                    setActiveId(p.id!);
                  }}
                  className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-200"
                >
                  Set active
                </button>
              )}
            </div>
            <div className="mt-3 flex gap-4">
              {activeId === p.id && (
                <button
                  onClick={() => {
                    setActiveProfileId(null);
                    setActiveId(null);
                  }}
                  className="text-sm text-zinc-400 underline"
                >
                  Deactivate
                </button>
              )}
              <button
                onClick={async () => {
                  await db.profiles.delete(p.id!);
                  if (activeId === p.id) {
                    setActiveProfileId(null);
                    setActiveId(null);
                  }
                  await refresh();
                }}
                className="text-sm text-red-400 underline"
              >
                Delete
              </button>
            </div>
          </Card>
        ))}
      </div>
    </Screen>
  );
}
