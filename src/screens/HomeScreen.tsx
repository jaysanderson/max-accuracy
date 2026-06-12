import { useEffect, useState } from 'react';
import { BigButton, Card, Chip, ModeToggle, Toggle } from '../components/ui';
import { getConfig } from '../config';
import { db, deviceLabel, getActiveProfile, getTestMode, setTestMode } from '../db';
import { hasSeenIntro, markIntroSeen, setUiMode, useUiMode } from '../lib/uiMode';
import { initCv } from '../lib/workerClient';
import type { CvCapabilities, DiagnosticRecord } from '../types';

type NavTarget = 'new' | 'testlog' | 'diagnostic' | 'profiles' | 'markers' | 'settings';

const INTRO_STEPS = [
  {
    icon: '🏷️',
    title: 'Put the stickers up',
    text: 'Stick the two printed markers on the wall, one each side of the window, level with each other. No stickers? A bank card held flat on the wall works too.',
  },
  {
    icon: '📷',
    title: 'Take the photo',
    text: 'Stand square-on to the window. Follow the on-screen tips — the button turns green when the shot is good.',
  },
  {
    icon: '📏',
    title: 'Mark the edges',
    text: 'Drag the two circles onto the edges of the window opening. The width appears instantly, in millimetres.',
  },
];

export function HomeScreen(props: { onNav: (r: NavTarget) => void }) {
  const uiMode = useUiMode();
  const [caps, setCaps] = useState<CvCapabilities | null>(null);
  const [profileInfo, setProfileInfo] = useState<{ name: string; ageDays: number } | null>(null);
  const [diag, setDiag] = useState<DiagnosticRecord | null>(null);
  const [testMode, setTm] = useState(getTestMode());
  const [showIntro, setShowIntro] = useState(!hasSeenIntro());
  const [lastWidth, setLastWidth] = useState<{ widthMm: number; label: string } | null>(null);

  useEffect(() => {
    initCv().then(setCaps).catch((e) => setCaps({ loaded: false, error: String(e) } as CvCapabilities));
    getActiveProfile().then((p) =>
      setProfileInfo(
        p ? { name: p.name, ageDays: (Date.now() - new Date(p.createdAt).getTime()) / 86400000 } : null,
      ),
    );
    db.diagnostics
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .then((all) => setDiag(all.find((d) => d.deviceLabel === deviceLabel()) ?? all[0] ?? null));
    db.measurements
      .orderBy('createdAt')
      .reverse()
      .first()
      .then((m) => m && setLastWidth({ widthMm: m.widthMm, label: m.windowLabel }));
  }, []);

  // ---------- BASIC: one job, one button ----------
  if (uiMode === 'basic') {
    return (
      <div className="flex h-full flex-col overflow-y-auto p-5 pb-10">
        <header className="mb-1 mt-3 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <img src="/brand-mark.svg" alt="" className="h-10 w-auto" />
              <h1 className="text-3xl font-extrabold tracking-tight text-white">
                Agentic RAG <span className="text-brand">Vision</span>
              </h1>
            </div>
            <p className="mt-1 text-base text-zinc-400">Measure windows for blinds with your camera</p>
          </div>
        </header>

        {showIntro ? (
          <div className="mt-4 flex-1">
            <h2 className="mb-3 text-lg font-bold text-white">How it works</h2>
            <div className="space-y-3">
              {INTRO_STEPS.map((s, i) => (
                <Card key={i} className="flex items-start gap-4">
                  <span className="text-3xl" aria-hidden>
                    {s.icon}
                  </span>
                  <div>
                    <p className="font-semibold text-white">
                      {i + 1}. {s.title}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-300">{s.text}</p>
                  </div>
                </Card>
              ))}
            </div>
            <BigButton
              className="mt-5 w-full"
              onClick={() => {
                markIntroSeen();
                setShowIntro(false);
              }}
            >
              Got it — let's go
            </BigButton>
          </div>
        ) : (
          <div className="mt-6 flex flex-1 flex-col gap-3">
            <button
              onClick={() => props.onNav('new')}
              className="rounded-3xl bg-gradient-to-br from-brand to-brand-dark p-7 text-left shadow-lg active:scale-[0.99]"
            >
              <span className="block text-3xl font-extrabold text-brand-ink">Measure a window</span>
              <span className="mt-1 block text-base text-brand-ink/80">Takes about a minute</span>
            </button>

            <button
              onClick={() => props.onNav('testlog')}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left active:bg-zinc-800"
            >
              <span className="block text-lg font-bold text-white">My measurements</span>
              <span className="mt-0.5 block text-sm text-zinc-400">
                {lastWidth
                  ? `Last: ${lastWidth.widthMm.toFixed(0)} mm${lastWidth.label ? ` — ${lastWidth.label}` : ''}`
                  : 'Nothing saved yet'}
              </span>
            </button>

            <button
              onClick={() => props.onNav('markers')}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-left active:bg-zinc-800"
            >
              <span className="block text-lg font-bold text-white">Print measuring stickers</span>
              <span className="mt-0.5 block text-sm text-zinc-400">For the most accurate results</span>
            </button>

            <button onClick={() => setShowIntro(true)} className="mt-1 self-start px-1 text-sm text-zinc-500 underline">
              Show me how it works again
            </button>
          </div>
        )}

        <footer className="mt-6 flex items-center justify-between">
          <span className="text-xs text-zinc-600">Powered by Progress Agentic RAG · For installers & technicians:</span>
          <ModeToggle mode={uiMode} onChange={setUiMode} />
        </footer>
      </div>
    );
  }

  // ---------- ADVANCED: full instrumentation ----------
  const tiles: { key: NavTarget; title: string; sub: string; big?: boolean }[] = [
    { key: 'new', title: 'Measure', sub: 'capture → reference → width', big: true },
    { key: 'testlog', title: 'Test results', sub: 'accuracy harness · CSV' },
    { key: 'diagnostic', title: 'Diagnostic', sub: 'straight-edge bow test' },
    { key: 'profiles', title: 'Profiles', sub: 'calibration · undistort' },
    { key: 'markers', title: 'Marker sheet', sub: 'printable PDF' },
    { key: 'settings', title: 'Settings', sub: 'gates · thresholds' },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 pb-10">
      <header className="mb-4 mt-2 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <img src="/brand-mark.svg" alt="" className="h-8 w-auto" />
            <h1 className="text-2xl font-extrabold tracking-tight text-white">
              Agentic RAG <span className="text-brand">Vision</span>
            </h1>
          </div>
          <p className="text-sm text-zinc-400">Window width from a photo — measurement core</p>
        </div>
        <ModeToggle mode={uiMode} onChange={setUiMode} />
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip level={caps === null ? 'neutral' : caps.loaded ? 'green' : 'red'}>
          {caps === null ? 'OpenCV loading…' : caps.loaded ? 'OpenCV ready' : 'OpenCV failed'}
        </Chip>
        {(() => {
          const cfgQ = getConfig().quality;
          const profileStale = profileInfo !== null && profileInfo.ageDays > cfgQ.profileStaleDays;
          const diagAgeDays = diag ? (Date.now() - new Date(diag.createdAt).getTime()) / 86400000 : null;
          const diagStale = diagAgeDays !== null && diagAgeDays > cfgQ.diagnosticStaleDays;
          return (
            <>
              <Chip level={profileInfo ? (profileStale ? 'amber' : 'green') : 'amber'}>
                {profileInfo
                  ? `profile: ${profileInfo.name}${profileStale ? ` (${Math.round(profileInfo.ageDays)}d old — re-verify)` : ''}`
                  : 'no device profile'}
              </Chip>
              {diag ? (
                <Chip level={diagStale ? 'amber' : diag.verdict === 'pre-corrected' ? 'green' : 'amber'}>
                  {diag.verdict === 'pre-corrected' ? 'lens: pre-corrected' : 'lens: distortion present'}
                  {diagStale ? ` (${Math.round(diagAgeDays!)}d old — re-run)` : ''}
                </Chip>
              ) : (
                <Chip level="neutral">diagnostic not run</Chip>
              )}
            </>
          );
        })()}
      </div>

      {caps && !caps.loaded && (
        <Card className="mb-4 border-red-800">
          <p className="text-sm text-red-300">
            OpenCV failed to load ({caps.error}). Auto-detection, undistortion and calibration are offline —
            card mode with manual corners still works.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={() => props.onNav(t.key)}
            className={`rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-left active:bg-zinc-800 ${
              t.big ? 'col-span-2 bg-gradient-to-br from-brand to-brand-dark !border-brand' : ''
            }`}
          >
            <p className={`text-lg font-bold ${t.big ? 'text-brand-ink' : 'text-white'}`}>{t.title}</p>
            <p className={`text-sm ${t.big ? 'text-brand-ink/80' : 'text-zinc-400'}`}>{t.sub}</p>
          </button>
        ))}
      </div>

      <Card className="mt-4">
        <Toggle
          label="Test Mode — ask for tape-measured truth on every save"
          checked={testMode}
          onChange={(v) => {
            setTestMode(v);
            setTm(v);
          }}
        />
        <p className="text-xs text-zinc-500">
          Phase-1 exit: median |error| ≤ 2% overall, ≤ 1% two-marker, proven in Test results.
        </p>
      </Card>
    </div>
  );
}
