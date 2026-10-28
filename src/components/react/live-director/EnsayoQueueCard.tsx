import {queueNumberShortcut} from '../../../utils/liveDirectorEntryCount';
import { memo } from 'react';
import { AlertTriangle, CheckCircle2, Download, Plus, X } from 'lucide-react';
import type { RehearsalDownloadState } from '../../../hooks/useLiveDirectorRehearsalDownload';

type EnsayoQueueSong = {
  id: string;
  title: string;
  subtitle?: string;
  mp3?: string;
  kind?: string;
};

type EnsayoQueueCardProps = {
  song: EnsayoQueueSong;
  coverUrl?: string | null;
  active?: boolean;
  queueNumber?: number;
  queued?: 'preparing'|'ready';
  compact?: boolean;
  ultraCompact?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
};

export const EnsayoQueueCard = memo(function EnsayoQueueCard({
  song,
  coverUrl,
  active = false,
  queueNumber,
  queued,
  compact = false,
  ultraCompact = false,
  onClick,
  onRemove,
}: EnsayoQueueCardProps) {
  return (
    <div
      className="relative shrink-0"
      style={{
        width: ultraCompact ? '9.15rem' : compact ? '10rem' : '10.95rem',
      }}
    >
      <button
        type="button"
        onClick={onClick}
        className={`ui-pressable-card group relative flex w-full overflow-hidden rounded-[1.15rem] border text-left transition-all duration-200 ${ultraCompact
          ? 'h-[4.7rem] p-1.25'
          : compact
            ? 'h-[5.1rem] p-1.5'
            : 'h-[5.55rem] p-1.75'
          } ${queued ? queued==='ready'?'border-emerald-200/80':'border-amber-200/70' : active
            ? 'border-white/80'
            : 'border-white/8 hover:border-white/14'
          }`}
        style={{
          background:
            'linear-gradient(180deg,rgba(22,24,26,0.98),rgba(15,17,18,0.98))',
        }}
        aria-label={`Abrir ${song.title}`}
        aria-pressed={active}
        aria-keyshortcuts={queueNumber ? queueNumberShortcut(queueNumber) : undefined}
        title={queueNumber ? `${queueNumber}. ${song.title}${queueNumberShortcut(queueNumber) ? ` · Tecla ${queueNumberShortcut(queueNumber)}` : ''}` : song.title}
        data-live-queue-song={song.id}
        data-live-queue-preparation={queued}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[1rem]">
          {coverUrl ? (
            <img src={coverUrl} alt="" crossOrigin="anonymous" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-[radial-gradient(circle_at_top,_rgba(129,221,245,0.14),_transparent_34%),linear-gradient(180deg,rgba(43,47,50,0.96),rgba(17,19,21,0.98))]" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.18)_42%,rgba(0,0,0,0.78)_100%)]" />
        </div>

        {/* Sin número visible (las teclas 1-9 siguen eligiendo la canción); la esquina superior derecha
            queda para el círculo de transición, como en Playback. */}
        {queued && <span className={`absolute left-1.5 top-1.5 z-20 rounded-md bg-black/85 px-1.5 py-1 text-[9px] font-bold ${queued==='ready'?'text-emerald-100':'text-amber-100'}`}>{queued==='ready'?'LISTO':'PREPARANDO'}</span>}
        <div className="relative z-10 mt-auto min-w-0">
          <p className={`truncate font-semibold leading-tight text-white drop-shadow-[0_3px_10px_rgba(0,0,0,0.52)] ${ultraCompact ? 'text-[0.68rem]' : compact ? 'text-[0.76rem]' : 'text-[0.9rem]'
            }`}>
            {song.title}
          </p>
          {song.subtitle ? (
            <p className={`truncate text-white/70 ${ultraCompact ? 'mt-0.5 text-[0.5rem]' : compact ? 'mt-0.5 text-[0.56rem]' : 'mt-0.5 text-[0.64rem]'
              }`}>
              {song.subtitle}
            </p>
          ) : null}
        </div>
        {active && (
          <div className="pointer-events-none absolute inset-0 z-20 rounded-[1.15rem] shadow-[inset_0_0_24px_rgba(255,255,255,0.45)]" />
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className={`absolute right-1 top-1 z-30 flex items-center justify-center rounded-full border border-white/12 bg-black/64 text-white/64 backdrop-blur-sm transition hover:border-rose-200/35 hover:bg-rose-300/14 hover:text-rose-100 ${ultraCompact ? 'h-6 w-6' : 'h-7 w-7'}`}
          aria-label={`Quitar ${song.title}`}
          title={`Quitar ${song.title}`}
        >
          <X className={ultraCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </button>
      )}
    </div>
  );
});

type EnsayoQueueAddCardProps = {
  compact?: boolean;
  ultraCompact?: boolean;
  onClick?: () => void;
};

export const EnsayoQueueAddCard = memo(function EnsayoQueueAddCard({
  compact = false,
  ultraCompact = false,
  onClick,
}: EnsayoQueueAddCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex shrink-0 items-center justify-center overflow-hidden rounded-[1.15rem] border border-dashed border-white/14 bg-black/12 text-white/48 transition hover:border-cyan-300/34 hover:bg-cyan-300/6 hover:text-cyan-100 active:scale-[0.98] ${ultraCompact
        ? 'h-[4.7rem]'
        : compact
          ? 'h-[5.1rem]'
          : 'h-[5.55rem]'
      }`}
      // Mismo ancho que las portadas de las canciones, para que la tira quede pareja.
      style={{ width: ultraCompact ? '9.15rem' : compact ? '10rem' : '10.95rem' }}
      aria-label="Añadir canción con click y pad"
    >
      <span className="flex flex-col items-center gap-1">
        <span className={`flex items-center justify-center rounded-full bg-white/7 transition group-hover:bg-cyan-300/12 ${ultraCompact ? 'h-7 w-7' : 'h-8 w-8'}`}>
          <Plus className={ultraCompact ? 'h-4 w-4' : 'h-[1.1rem] w-[1.1rem]'} />
        </span>
        <span className={`${ultraCompact ? 'text-[0.48rem]' : compact ? 'text-[0.54rem]' : 'text-[0.6rem]'} font-medium uppercase tracking-[0.16em]`}>
          Click + Pad
        </span>
      </span>
    </button>
  );
});

type EnsayoQueueSaveCardProps = {
  state: RehearsalDownloadState;
  compact?: boolean;
  ultraCompact?: boolean;
  onSave: () => void;
  onCancel: () => void;
};

const formatMegabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;

/** Same footprint as the Click + Pad card; saves this rehearsal's stems on the device. */
export const EnsayoQueueSaveCard = memo(function EnsayoQueueSaveCard({
  state,
  compact = false,
  ultraCompact = false,
  onSave,
  onCancel,
}: EnsayoQueueSaveCardProps) {
  const busy = state.phase === 'resolving' || state.phase === 'downloading';
  const percent = state.phase === 'downloading' ? Math.floor(state.progress * 100) : 0;
  const label = state.phase === 'saved'
    ? 'Sesión cargada'
    : state.phase === 'downloading'
      ? state.held ? `En pausa · ${percent}%` : `Cargando ${percent}%`
      : state.phase === 'resolving'
        ? 'Preparando…'
        : state.phase === 'error' ? 'Reintentar' : 'Cargar sesión';
  const title = state.phase === 'saved'
    ? `Sesión cargada en este equipo (${formatMegabytes(state.totalBytes)}). Pulsa para volver a descargarla.`
    : state.phase === 'downloading'
      ? state.held ? 'Sigue al pausar la reproducción. Pulsa para cancelar.' : 'Pulsa para cancelar.'
      : state.phase === 'error'
        ? state.message
        : 'Guarda solo los stems de este ensayo en el equipo. Al guardar otro ensayo, este se reemplaza.';
  // La tarjeta se llena de arriba hacia abajo con el avance; cargada queda llena.
  const fill = state.phase === 'saved' ? 1 : state.phase === 'downloading' ? state.progress : 0;
  const Icon = state.phase === 'saved' ? CheckCircle2 : state.phase === 'error' ? AlertTriangle : Download;
  const tone = state.phase === 'saved'
    ? 'border-emerald-200/30 text-emerald-100/85 hover:border-emerald-200/45'
    : state.phase === 'error'
      ? 'border-amber-200/35 text-amber-100/85 hover:border-amber-200/50'
      : busy
        ? 'border-cyan-300/30 text-cyan-100/85'
        : 'border-white/14 text-white/48 hover:border-cyan-300/34 hover:bg-cyan-300/6 hover:text-cyan-100';
  return (
    <button
      type="button"
      onClick={busy ? onCancel : onSave}
      data-live-rehearsal-download={state.phase}
      className={`group relative flex shrink-0 items-center justify-center overflow-hidden rounded-[1.15rem] border border-dashed bg-black/12 transition active:scale-[0.98] ${tone} ${ultraCompact
        ? 'h-[4.7rem]'
        : compact
          ? 'h-[5.1rem]'
          : 'h-[5.55rem]'
      }`}
      // Mismo ancho que las portadas de las canciones, para que la tira quede pareja.
      style={{ width: ultraCompact ? '9.15rem' : compact ? '10rem' : '10.95rem' }}
      aria-label={busy ? `Cancelar la carga de la sesión (${label})` : state.phase === 'saved' ? 'Sesión cargada en este equipo. Volver a descargar' : 'Cargar la sesión en este equipo'}
      title={title}
    >
      <span aria-hidden="true" data-live-rehearsal-fill={Math.round(fill * 100)} className={`pointer-events-none absolute inset-x-0 top-0 transition-[height] duration-500 ease-out ${state.phase === 'saved' ? 'bg-emerald-300/12' : 'bg-cyan-300/14'}`} style={{ height: `${fill * 100}%` }} />
      <span className="relative flex flex-col items-center gap-1">
        <span className={`flex items-center justify-center rounded-full bg-white/7 transition group-hover:bg-cyan-300/12 ${ultraCompact ? 'h-7 w-7' : 'h-8 w-8'}`}>
          <Icon className={`${ultraCompact ? 'h-4 w-4' : 'h-[1.1rem] w-[1.1rem]'} ${state.phase === 'resolving' ? 'animate-pulse' : ''}`} />
        </span>
        <span role="status" className={`${ultraCompact ? 'text-[0.48rem]' : compact ? 'text-[0.54rem]' : 'text-[0.6rem]'} font-medium uppercase tracking-[0.16em] tabular-nums`}>
          {label}
        </span>
      </span>
    </button>
  );
});
