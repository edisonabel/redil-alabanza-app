import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, ListMusic, Play } from 'lucide-react';
import ModoEnsayoCompacto from './ModoEnsayoCompacto.jsx';

const LATIN_TO_AMERICAN = {
  Do: 'C',
  'Do#': 'C#',
  Reb: 'C#',
  Re: 'D',
  'Re#': 'D#',
  Mib: 'D#',
  Mi: 'E',
  Fa: 'F',
  'Fa#': 'F#',
  Solb: 'F#',
  Sol: 'G',
  'Sol#': 'G#',
  Lab: 'G#',
  La: 'A',
  'La#': 'A#',
  Sib: 'A#',
  Si: 'B',
  Dob: 'B',
};

const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

const normalizeKeyToAmerican = (rawKey = '') => {
  const source = String(rawKey || '').trim();
  if (!source) return '-';

  const normalizedSource = source
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/\s+/g, '');

  if (LATIN_TO_AMERICAN[normalizedSource]) {
    return LATIN_TO_AMERICAN[normalizedSource];
  }

  const upperRoot = normalizedSource.charAt(0).toUpperCase() + normalizedSource.slice(1);
  const rootMatch = upperRoot.match(/^([A-G][#b]?)/);
  if (!rootMatch) return source;

  return FLAT_TO_SHARP[rootMatch[1]] || rootMatch[1];
};

const formatDateLabel = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-CO', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatHourLabel = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatServiceDuration = (startValue, endValue) => {
  if (!startValue || !endValue) return '';
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return '';

  const [endHour, endMinute] = String(endValue).split(':').map((part) => Number(part || 0));
  if (!Number.isFinite(endHour) || !Number.isFinite(endMinute)) return '';

  const end = new Date(start);
  end.setHours(endHour, endMinute, 0, 0);

  if (end <= start) return '';

  const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  if (hours <= 0) return `${minutes} min`;
  if (!minutes) return `${hours} h`;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
};

const dispatchProPlayerEvent = ({ url, title, artist, autoPlay = true }) => {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl || typeof window === 'undefined') return;

  if (window.__REDIL_PRO_PLAYER__?.open) {
    window.__REDIL_PRO_PLAYER__.open({
      url: cleanUrl,
      title,
      artist,
      autoPlay,
    });
    return;
  }

  window.dispatchEvent(new CustomEvent('play-pro-audio', {
    detail: {
      url: cleanUrl,
      title,
      artist,
      autoPlay,
    },
  }));
};

export default function EnsayoHub({
  playlist = [],
  contextTitle = 'Modo Ensayo',
  eventMeta = null,
  initialSongId = null,
}) {
  const songs = useMemo(() => (
    Array.isArray(playlist) ? playlist.filter(Boolean) : []
  ), [playlist]);

  const initialSong = useMemo(() => (
    initialSongId
      ? songs.find((song) => String(song?.id || '') === String(initialSongId)) || null
      : null
  ), [initialSongId, songs]);

  const [cancionActiva, setCancionActiva] = useState(initialSong);
  const [lastViewedSongId, setLastViewedSongId] = useState(initialSong ? String(initialSong.id || '') : null);
  const [activeMetronomeSongId, setActiveMetronomeSongId] = useState(null);
  const [queueState, setQueueState] = useState({ active: false, index: -1 });

  const metronomeIntervalRef = useRef(null);
  const metronomeAudioCtxRef = useRef(null);
  const queueSongsRef = useRef([]);
  const queueIndexRef = useRef(-1);
  const queueActiveRef = useRef(false);

  const playableSongs = useMemo(() => (
    songs.filter((song) => typeof song?.mp3 === 'string' && song.mp3.trim() !== '')
  ), [songs]);

  const stopMetronome = useCallback(() => {
    if (metronomeIntervalRef.current) {
      window.clearInterval(metronomeIntervalRef.current);
      metronomeIntervalRef.current = null;
    }
    setActiveMetronomeSongId(null);
  }, []);

  const playMetronomeClick = useCallback(() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!metronomeAudioCtxRef.current || metronomeAudioCtxRef.current.state === 'closed') {
      metronomeAudioCtxRef.current = new AudioContextClass();
    }

    const audioCtx = metronomeAudioCtxRef.current;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.1);
  }, []);

  const toggleSongMetronome = useCallback((songId, bpm) => {
    const safeBpm = Number.isFinite(Number(bpm)) ? Math.max(0, Math.round(Number(bpm))) : 0;
    if (!safeBpm) return;

    if (activeMetronomeSongId === songId) {
      stopMetronome();
      return;
    }

    stopMetronome();
    const beatDurationMs = (60 / safeBpm) * 1000;
    setActiveMetronomeSongId(songId);
    playMetronomeClick();
    metronomeIntervalRef.current = window.setInterval(playMetronomeClick, beatDurationMs);
  }, [activeMetronomeSongId, playMetronomeClick, stopMetronome]);

  const stopQueue = useCallback(() => {
    queueSongsRef.current = [];
    queueIndexRef.current = -1;
    queueActiveRef.current = false;
    setQueueState({ active: false, index: -1 });
  }, []);

  const openSongInPlayer = useCallback((song, autoPlay = true) => {
    if (!song?.mp3) return;
    dispatchProPlayerEvent({
      url: song.mp3,
      title: song.title,
      artist: song.artist,
      autoPlay,
    });
  }, []);

  const playQueueItem = useCallback((index) => {
    const queueSongs = queueSongsRef.current;
    const nextSong = queueSongs[index];

    if (!nextSong) {
      stopQueue();
      return;
    }

    queueIndexRef.current = index;
    queueActiveRef.current = true;
    setQueueState({ active: true, index });
    openSongInPlayer(nextSong, true);
  }, [openSongInPlayer, stopQueue]);

  const startQueue = useCallback((startIndex = 0) => {
    if (playableSongs.length === 0) return;
    stopMetronome();
    queueSongsRef.current = playableSongs;
    playQueueItem(Math.max(0, Math.min(startIndex, playableSongs.length - 1)));
  }, [playQueueItem, playableSongs, stopMetronome]);

  const openCompactSong = useCallback((song) => {
    if (!song) return;
    stopMetronome();
    stopQueue();
    setCancionActiva(song);
    setLastViewedSongId(String(song?.id || ''));
  }, [stopMetronome, stopQueue]);

  const handleCompactBack = useCallback(() => {
    stopMetronome();
    stopQueue();
    if (typeof window !== 'undefined') {
      window.__REDIL_PRO_PLAYER__?.close?.();
    }
    setCancionActiva(null);
  }, [stopMetronome, stopQueue]);

  const handleListBack = useCallback(() => {
    window.location.href = '/';
  }, []);

  useEffect(() => () => {
    stopMetronome();
    stopQueue();
    const audioCtx = metronomeAudioCtxRef.current;
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  }, [stopMetronome, stopQueue]);

  useEffect(() => {
    const audio = document.getElementById('mp3Audio');
    const closeButton = document.getElementById('btnMp3Close');
    const backdrop = document.getElementById('mp3PlayerBackdrop');

    if (!audio) return undefined;

    const handleEnded = () => {
      if (!queueActiveRef.current) return;
      playQueueItem(queueIndexRef.current + 1);
    };

    const handleQueueStop = () => {
      if (!queueActiveRef.current) return;
      stopQueue();
    };

    audio.addEventListener('ended', handleEnded);
    closeButton?.addEventListener('click', handleQueueStop);
    backdrop?.addEventListener('click', handleQueueStop);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      closeButton?.removeEventListener('click', handleQueueStop);
      backdrop?.removeEventListener('click', handleQueueStop);
    };
  }, [playQueueItem, stopQueue]);

  if (cancionActiva) {
    return (
      <ModoEnsayoCompacto
        song={cancionActiva}
        contextTitle={contextTitle}
        onGoBack={handleCompactBack}
      />
    );
  }

  const serviceDate = formatDateLabel(eventMeta?.fecha_hora);
  const serviceHour = formatHourLabel(eventMeta?.fecha_hora);
  const serviceDuration = formatServiceDuration(eventMeta?.fecha_hora, eventMeta?.hora_fin);

  return (
    <div className="flex h-screen w-full flex-col bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <header className="border-b border-zinc-200/80 bg-white/95 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.8rem)] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/96">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-[2rem] border border-zinc-200/80 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_38%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(244,244,245,0.96))] px-5 py-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_transparent_34%),linear-gradient(180deg,_rgba(9,9,11,0.98),_rgba(15,23,42,0.94))] dark:shadow-[0_28px_80px_rgba(2,6,23,0.5)]">
            <div className="grid grid-cols-[auto_1fr] items-start gap-4 md:grid-cols-[auto_1fr_auto] md:gap-5">
            <button
              type="button"
              onClick={handleListBack}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
              aria-label="Volver al inicio"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

              <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
                    Setlist de Ensayo
                  </p>
                  <h1 className="mt-2 text-2xl font-black tracking-tight text-zinc-950 dark:text-zinc-50 md:text-4xl">
                    {contextTitle}
                  </h1>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                    {serviceDate && (
                      <span className="inline-flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                        {serviceDate}{serviceHour ? ` · ${serviceHour}` : ''}
                      </span>
                    )}
                    {serviceDuration && (
                      <span className="inline-flex items-center gap-2">
                        <Clock3 className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                        {serviceDuration}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-2">
                      <ListMusic className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                      {songs.length} canciones
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => startQueue(0)}
                  disabled={playableSongs.length === 0}
                  className={`col-span-2 justify-self-start md:col-span-1 md:justify-self-end inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black shadow-sm transition-colors ${
                    playableSongs.length > 0
                      ? 'bg-action text-white hover:bg-action/90'
                      : 'cursor-not-allowed bg-zinc-300 text-zinc-500 shadow-none dark:bg-zinc-800 dark:text-zinc-500'
                  }`}
                >
                  <Play className="ml-0.5 h-4 w-4" />
                  Reproducir fila
                </button>
              </div>
            </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <div className="mx-auto max-w-5xl">
          <div className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-zinc-950/88 dark:shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
            {songs.map((song, index) => {
              const keyLabel = normalizeKeyToAmerican(song?.originalKey || song?.key || '-');
              const bpmValue = Number.isFinite(Number(song?.bpm)) ? Math.max(0, Math.round(Number(song.bpm))) : 0;
              const isMetronomeActive = activeMetronomeSongId === song?.id;
              const hasSongAudio = typeof song?.mp3 === 'string' && song.mp3.trim() !== '';
              const isLastViewed = String(song?.id || index) === String(lastViewedSongId || '');

              return (
                <article
                  key={song?.id || `${song?.title || 'song'}-${index}`}
                  onClick={() => openCompactSong(song)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openCompactSong(song);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={`group flex w-full items-center gap-3 border-b border-zinc-200/90 px-4 py-4 text-left transition-colors dark:border-white/10 last:border-b-0 ${
                    isLastViewed
                      ? 'bg-brand/6 hover:bg-brand/10 dark:bg-brand/10 dark:hover:bg-brand/12'
                      : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-zinc-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(244,244,245,0.96))] text-sm font-black text-zinc-600 shadow-sm dark:border-white/10 dark:bg-[linear-gradient(180deg,_rgba(39,39,42,0.92),_rgba(24,24,27,0.92))] dark:text-zinc-200">
                    {String(index + 1).padStart(2, '0')}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-black tracking-tight text-zinc-950 dark:text-zinc-50 md:text-lg">
                      {song?.title || `Canción ${index + 1}`}
                    </p>
                    <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                      {song?.artist || 'Redil Worship'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200">
                        {keyLabel}
                      </span>
                      {song?.category && (
                        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">
                          {song.category}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="ensayo-hub-row-actions flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleSongMetronome(song?.id || index, bpmValue);
                      }}
                      disabled={!bpmValue}
                      className={`ensayo-hub-bpm relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border bg-white text-zinc-900 shadow-sm transition-colors dark:bg-zinc-900 dark:text-zinc-50 ${
                        bpmValue
                          ? 'border-zinc-200 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-zinc-800'
                          : 'cursor-not-allowed border-zinc-200/70 text-zinc-400 dark:border-white/10 dark:text-zinc-500'
                      } ${isMetronomeActive ? 'beat-active' : ''}`}
                      style={isMetronomeActive && bpmValue ? { '--bpm-duration': `${60 / bpmValue}s` } : undefined}
                      aria-label={isMetronomeActive ? `Detener metrónomo ${bpmValue} BPM` : `Activar metrónomo ${bpmValue || 0} BPM`}
                      title={bpmValue ? `${bpmValue} BPM` : 'Sin BPM'}
                    >
                      <span className={`relative z-[1] font-black leading-none ${String(bpmValue || '--').length > 2 ? 'text-[11px]' : 'text-sm'}`}>
                        {bpmValue || '--'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        stopQueue();
                        openSongInPlayer(song, true);
                      }}
                      disabled={!hasSongAudio}
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                        hasSongAudio
                          ? 'border-zinc-200 bg-white text-zinc-900 shadow-sm hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800'
                          : 'cursor-not-allowed border-zinc-200/70 bg-zinc-100 text-zinc-400 shadow-none dark:border-white/10 dark:bg-zinc-900/60 dark:text-zinc-600'
                      }`}
                      aria-label={hasSongAudio ? `Reproducir ${song?.title || 'canción'}` : 'Sin MP3'}
                      title={hasSongAudio ? 'Escuchar canción' : 'Esta canción no tiene MP3'}
                    >
                      <Play className="ml-0.5 h-4.5 w-4.5" />
                    </button>

                    <div className="ensayo-hub-row-chevron hidden h-10 w-10 items-center justify-center rounded-full text-zinc-300 transition-colors group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-400 md:flex">
                      <ChevronRight className="h-5 w-5" />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </main>

      <div className="ensayo-hub-queuebar fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/96 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/96">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
              {queueState.active
                ? `Fila activa · ${queueState.index + 1}/${queueSongsRef.current.length}`
                : `${playableSongs.length} con MP3`}
            </p>
            <p className="truncate text-sm font-medium text-zinc-600 dark:text-zinc-300">
              {queueState.active
                ? `${queueSongsRef.current[queueState.index]?.title || 'Reproduciendo setlist'}`
                : 'Toca una canción para abrir el modo ensayo compacto o escucha la fila completa.'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {queueState.active && (
              <button
                type="button"
                onClick={stopQueue}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-black text-zinc-700 shadow-sm transition-colors hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Detener fila
              </button>
            )}
            <button
              type="button"
              onClick={() => startQueue(queueState.active ? queueState.index : 0)}
              disabled={playableSongs.length === 0}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black shadow-sm transition-colors ${
                playableSongs.length > 0
                  ? 'bg-action text-white hover:bg-action/90'
                  : 'cursor-not-allowed bg-zinc-300 text-zinc-500 shadow-none dark:bg-zinc-800 dark:text-zinc-500'
              }`}
            >
              <Play className="ml-0.5 h-4 w-4" />
              {queueState.active ? 'Reiniciar fila' : 'Reproducir fila'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ensayo-hub-bpm-pulse {
          0% {
            transform: scale(1);
            background-color: rgba(255, 255, 255, 0.98);
            box-shadow: 0 1px 2px rgba(24, 24, 27, 0.08);
          }
          45% {
            transform: scale(1.04);
            background-color: rgba(16, 185, 129, 0.16);
            border-color: rgba(16, 185, 129, 0.55);
            box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.12), 0 0 14px rgba(16, 185, 129, 0.14);
          }
          100% {
            transform: scale(1);
            background-color: rgba(255, 255, 255, 0.98);
            box-shadow: 0 1px 2px rgba(24, 24, 27, 0.08);
          }
        }

        .ensayo-hub-bpm.beat-active {
          animation: ensayo-hub-bpm-pulse var(--bpm-duration, 1s) infinite;
        }

        .dark .ensayo-hub-bpm.beat-active {
          background-color: rgba(24, 24, 27, 0.98);
        }

        body[data-pro-player-modal-open='true'] .ensayo-hub-row-actions,
        body[data-pro-player-modal-open='true'] .ensayo-hub-row-chevron,
        body[data-pro-player-modal-open='true'] .ensayo-hub-queuebar {
          opacity: 0;
          pointer-events: none;
        }

        body[data-pro-player-modal-open='true'] .ensayo-hub-queuebar {
          transform: translateY(calc(100% + env(safe-area-inset-bottom) + 1rem));
        }
      `}</style>
    </div>
  );
}
