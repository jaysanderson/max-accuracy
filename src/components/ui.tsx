import type { ReactNode } from 'react';
import type { Confidence } from '../types';

/** Field-tough primitives: big targets, high contrast, readable in sunlight. */

export function BigButton(props: {
  onClick?: () => void;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  className?: string;
}) {
  const { variant = 'primary' } = props;
  const styles: Record<string, string> = {
    primary: 'bg-brand text-brand-ink active:bg-brand-light disabled:bg-zinc-700 disabled:text-zinc-400',
    secondary: 'bg-zinc-700 text-white active:bg-zinc-600 disabled:opacity-40',
    danger: 'bg-red-600 text-white active:bg-red-500 disabled:opacity-40',
    ghost: 'bg-transparent text-brand-light border border-zinc-600 active:bg-zinc-800 disabled:opacity-40',
  };
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={`min-h-14 rounded-xl px-5 text-lg font-semibold tracking-wide select-none touch-manipulation ${styles[variant]} ${props.className ?? ''}`}
    >
      {props.children}
    </button>
  );
}

export function Chip(props: { level: Confidence | 'neutral'; children: ReactNode; className?: string }) {
  const styles: Record<string, string> = {
    green: 'bg-green-500/20 text-green-300 border-green-500/60',
    amber: 'bg-amber-500/20 text-amber-300 border-amber-500/60',
    red: 'bg-red-500/25 text-red-300 border-red-500/70',
    neutral: 'bg-zinc-700/50 text-zinc-300 border-zinc-600',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${styles[props.level]} ${props.className ?? ''}`}
    >
      {props.children}
    </span>
  );
}

export function ConfidenceChip(props: { confidence: Confidence; large?: boolean }) {
  const label = { green: 'GREEN — usable', amber: 'AMBER — check reasons', red: 'RED — unusable' }[
    props.confidence
  ];
  const dot = { green: 'bg-green-400', amber: 'bg-amber-400', red: 'bg-red-500' }[props.confidence];
  return (
    <Chip level={props.confidence} className={props.large ? 'px-4 py-2 text-base' : ''}>
      <span className={`inline-block size-2.5 rounded-full ${dot} ${props.confidence === 'red' ? 'animate-pulse' : ''}`} />
      {label}
    </Chip>
  );
}

export function Field(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-zinc-300">{props.label}</span>
      {props.children}
      {props.hint && <span className="mt-1 block text-xs text-zinc-500">{props.hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-3 text-lg text-white placeholder-zinc-500 focus:border-brand focus:outline-none';

export function Screen(props: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3">
        {props.onBack && (
          <button
            onClick={props.onBack}
            className="-ml-1 flex size-10 items-center justify-center rounded-lg text-2xl text-brand-light active:bg-zinc-800"
            aria-label="Back"
          >
            ‹
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-white">{props.title}</h1>
          {props.subtitle && <p className="truncate text-xs text-zinc-400">{props.subtitle}</p>}
        </div>
        {props.actions}
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-24">{props.children}</div>
    </div>
  );
}

export function ModeToggle(props: { mode: 'basic' | 'advanced'; onChange: (m: 'basic' | 'advanced') => void }) {
  return (
    <div className="inline-flex rounded-full border border-zinc-700 bg-zinc-900 p-1" role="group" aria-label="View mode">
      {(['basic', 'advanced'] as const).map((m) => (
        <button
          key={m}
          onClick={() => props.onChange(m)}
          aria-pressed={props.mode === m}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${
            props.mode === m ? 'bg-brand text-brand-ink' : 'text-zinc-400'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900 p-4 ${props.className ?? ''}`}>
      {props.children}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      onClick={() => props.onChange(!props.checked)}
      className="flex w-full items-center justify-between gap-3 py-2 text-left"
    >
      <span className="text-base text-zinc-200">{props.label}</span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${props.checked ? 'bg-brand' : 'bg-zinc-700'}`}
      >
        <span
          className={`absolute top-0.5 size-6 rounded-full bg-white transition-transform ${props.checked ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  );
}
