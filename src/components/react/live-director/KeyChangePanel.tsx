import { useEffect, useRef, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { KEY_NAMES, parseSongKey, semitonesBetween, type EventKey } from '../../../utils/liveDirectorEventKey';

// Cambiar tono en el evento: la misma cuadrícula del Pad Player. Solo llega aquí quien tiene permiso.
const TOP_ROW = ['Db', 'Eb', 'Gb', 'Ab', 'Bb', 'B'] as const;
const BOTTOM_ROW = ['C', 'D', 'E', 'F', 'G', 'A'] as const;
export type KeyChangeProgress = { index: number; total: number; name: string; progress: number };
export type KeyChangeControl = {
  originalKey: string; eventKey: EventKey | null; moved: string[]; kept: string[];
  onPrepare: (semitones: number, targetKey: string, onProgress: (progress: KeyChangeProgress) => void, signal: AbortSignal) => Promise<void>;
  onRestore: () => Promise<void>;
};
type Step = 'choose' | 'confirm' | 'working';

export function KeyChangePanel({ control, onClose }: { control: KeyChangeControl; onClose: () => void }) {
  const original = parseSongKey(control.originalKey);
  const currentName = control.eventKey?.targetKey || control.originalKey;
  const current = parseSongKey(currentName);
  const [picked, setPicked] = useState<number | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [progress, setProgress] = useState<KeyChangeProgress | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const working = step === 'working';
  useEffect(() => {
    if (!working) return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [working]);
  if (!original) return null;
  const suffix = original.minor ? 'm' : '';
  const pickedName = picked === null ? '' : `${KEY_NAMES[picked]}${suffix}`;
  const semitones = picked === null ? 0 : semitonesBetween(original.index, picked);
  const restoring = picked === original.index;
  const start = async () => {
    setError(''); setStep('working');
    const controller = new AbortController(); abort.current = controller;
    try {
      if (restoring) await control.onRestore();
      else await control.onPrepare(semitones, pickedName, setProgress, controller.signal);
      onClose();
    } catch (reason) {
      setStep('choose'); setProgress(null);
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo cambiar el tono.');
    }
  };
  const tile = (name: typeof KEY_NAMES[number]) => {
    const index = KEY_NAMES.indexOf(name), isCurrent = current?.index === index, isOriginal = original.index === index, chosen = picked === index;
    return <button key={name} type="button" data-key-tile={name} aria-pressed={chosen} disabled={isCurrent}
      onClick={() => { setPicked(index); setError(''); }}
      className={`ui-pressable-soft relative flex min-h-0 items-center justify-center overflow-hidden rounded-[0.9rem] border text-[clamp(1.05rem,3.2vh,1.7rem)] font-medium tracking-tight ${chosen
        ? 'border-cyan-200/55 bg-cyan-300/[0.16] text-white shadow-[0_0_32px_rgba(103,232,249,0.22)]'
        : isCurrent ? 'border-emerald-300/35 bg-emerald-300/[0.08] text-white' : 'border-white/8 bg-[#151718] text-white/62 hover:border-white/16 hover:bg-[#1a1d1f] hover:text-white/85'}`}>
      <span>{name}{suffix}</span>
      {(isCurrent || isOriginal) && <span className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[0.5rem] font-black uppercase tracking-[0.18em] ${isCurrent ? 'text-emerald-200/80' : 'text-white/45'}`}>{isCurrent ? 'Actual' : 'Original'}</span>}
    </button>;
  };
  const overall = progress ? (progress.index + progress.progress) / progress.total : 0;
  return <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/62 p-3 backdrop-blur-[8px]"
    onPointerDown={event => { if (event.target === event.currentTarget && !working) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label="Cambiar tono" data-key-change={step}
      onKeyDown={event => { if (event.key === 'Escape' && !working) { event.stopPropagation(); if (step === 'confirm') setStep('choose'); else onClose(); } }}
      className="relative flex h-full max-h-[34rem] w-full max-w-4xl flex-col overflow-hidden rounded-[1.6rem] border border-white/12 bg-[#111314] shadow-[0_32px_80px_rgba(0,0,0,0.5)]">
      <header className="flex shrink-0 items-center justify-between gap-3 p-3 pl-5">
        <h3 className="text-lg font-semibold text-white">Cambiar tono <span className="ml-1 font-normal text-white/50">· este evento</span></h3>
        {!working && <button type="button" onClick={onClose} aria-label="Cerrar cambiar tono" className="ui-pressable-soft flex h-11 w-12 items-center justify-center rounded-[1rem] border border-white/10 bg-black/30 text-white/70 hover:text-white"><X className="h-5 w-5" /></button>}
      </header>
      {step === 'choose' && <>
        <div className="grid min-h-0 flex-1 grid-cols-6 grid-rows-2 gap-2 px-3" role="group" aria-label="Tonos">{TOP_ROW.map(tile)}{BOTTOM_ROW.map(tile)}</div>
        <footer className="flex shrink-0 items-center gap-3 p-3 pl-5">
          <p role="status" className={`min-w-0 flex-1 truncate text-sm ${error ? 'text-rose-200' : 'text-white/55'}`}>{error || (picked === null ? `Elige el tono. No se tocan: ${control.kept.join(', ') || 'ninguna'}.` : restoring ? `Volver a ${pickedName}, el tono original.` : `${currentName} → ${pickedName} · ${semitones > 0 ? '+' : ''}${semitones} · ${control.moved.length} pistas`)}</p>
          <button type="button" disabled={picked === null} data-key-change-next="true" onClick={() => setStep('confirm')}
            className="ui-pressable-soft min-h-11 shrink-0 rounded-[1rem] border border-cyan-300/40 bg-cyan-300/[0.12] px-5 text-sm font-semibold text-cyan-50 disabled:opacity-40">{restoring ? 'Volver al original' : 'Continuar'}</button>
        </footer>
      </>}
      {step === 'confirm' && <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-y-auto px-6 pb-5">
        <p className="flex items-center gap-2 text-lg font-semibold text-amber-100"><TriangleAlert className="h-5 w-5 shrink-0" />{restoring ? `¿Volver al tono original (${pickedName})?` : `¿Cambiar esta canción a ${pickedName}?`}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-white/70">
          <li><strong className="text-white">Cambia para todo el equipo</strong> en este evento. No es una prueba personal.</li>
          <li>La canción original <strong className="text-white">no se borra ni se modifica</strong>.</li>
          {restoring ? <li>Se quita la copia transportada de este evento.</li> : <>
            <li>Se crea una copia solo para este evento. Si ya había otro tono, esta copia reemplaza a la anterior.</li>
            <li>Tarda varios minutos. No cierres esta pestaña; mejor en una computadora.</li>
            <li>Antes de ensayar o del servicio, nunca durante.</li>
          </>}
        </ul>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setStep('choose')} autoFocus className="ui-pressable-soft min-h-12 flex-1 rounded-[1rem] border border-white/12 bg-white/4 text-sm font-semibold text-white/85">No, volver</button>
          <button type="button" data-key-change-confirm="true" onClick={() => { void start(); }} className="ui-pressable-soft min-h-12 flex-1 rounded-[1rem] border border-amber-200/45 bg-amber-300/15 text-sm font-semibold text-amber-50">{restoring ? 'Sí, volver al original' : `Sí, cambiar a ${pickedName}`}</button>
        </div>
      </div>}
      {working && <div role="status" className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-6 pb-5">
        <p className="text-lg font-semibold text-white">{restoring ? 'Volviendo al original…' : `Preparando ${pickedName}…`}</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-cyan-200/80 transition-[width] duration-300" style={{ width: `${Math.round(overall * 100)}%` }} /></div>
        <p className="text-sm text-white/60">{progress ? `Pista ${progress.index + 1} de ${progress.total} · ${progress.name}` : 'Empezando…'} · No cierres esta pestaña</p>
        {!restoring && <button type="button" onClick={() => abort.current?.abort()} className="ui-pressable-soft mt-2 min-h-11 self-start rounded-[1rem] border border-white/12 bg-white/4 px-5 text-sm font-semibold text-white/85">Cancelar</button>}
      </div>}
    </div>
  </div>;
}
