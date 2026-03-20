import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronDown, ChevronRight, ChevronUp, Clock3, GripVertical, ListMusic, Mic2, Play, Plus, RadioReceiver, X, Zap } from 'lucide-react';
import ModoEnsayoCompacto from './ModoEnsayoCompacto.jsx';
import ModoLiveDirector from './ModoLiveDirector.jsx';
import { supabase } from '../../lib/supabase';

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

const serializeVoicePayload = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const normalizeVoiceExternalUrl = (rawUrl = '') => {
  let normalized = String(rawUrl || '').trim();
  if (!normalized) return '';

  if (normalized.startsWith('www.')) {
    normalized = `https://${normalized}`;
  } else if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`;
  } else if (/^\/(uc|open|file)\b/i.test(normalized)) {
    normalized = `https://drive.google.com${normalized}`;
  }

  if (!/^https?:\/\//i.test(normalized)) return '';

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase();

    if (hostname === 'drive.google.com') {
      const fullUrl = `${url.origin}${url.pathname}${url.search}`;
      const driveIdPatterns = [
        /\/file\/d\/([a-zA-Z0-9_-]+)/i,
        /[?&]id=([a-zA-Z0-9_-]+)/i,
        /\/uc\b.*[?&]id=([a-zA-Z0-9_-]+)/i,
      ];

      let fileId = '';
      for (const pattern of driveIdPatterns) {
        const match = fullUrl.match(pattern);
        if (match?.[1]) {
          fileId = match[1];
          break;
        }
      }

      if (fileId) {
        return `https://drive.google.com/uc?export=download&id=${fileId}`;
      }
    }

    return url.toString();
  } catch {
    return normalized;
  }
};

const parseVoiceResources = (value) => {
  const raw = serializeVoicePayload(value);
  const rawNormalized = raw
    ? raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    : '';
  const audioFilePattern = /\.(mp3|wav|m4a|aac|ogg)(\?.*)?$/i;
  const toVoiceEntry = (candidate, index = 0, forcedLabel = '') => {
    if (typeof candidate === 'string') {
      const url = normalizeVoiceExternalUrl(candidate);
      if (!url) return null;
      return {
        label: forcedLabel || `Voz ${index + 1}`,
        url,
      };
    }

    if (!candidate || typeof candidate !== 'object') return null;

    const url = normalizeVoiceExternalUrl(
      candidate.url ||
      candidate.link ||
      candidate.href ||
      candidate.src ||
      candidate.audio ||
      '',
    );

    if (!url) return null;

    const labelRaw =
      forcedLabel ||
      candidate.label ||
      candidate.nombre ||
      candidate.name ||
      candidate.title ||
      candidate.voice ||
      '';

    return {
      label: String(labelRaw || `Voz ${index + 1}`).trim() || `Voz ${index + 1}`,
      url,
    };
  };

  if (!raw || raw === '-' || rawNormalized === 'no esta') {
    return { hasResources: false, entries: [], legacyUrl: '' };
  }

  const normalizedDirectUrl = normalizeVoiceExternalUrl(raw);
  if (normalizedDirectUrl && !raw.trim().startsWith('[') && !raw.trim().startsWith('{')) {
    if (audioFilePattern.test(normalizedDirectUrl)) {
      return {
        hasResources: true,
        entries: [{ label: 'Voz guía', url: normalizedDirectUrl }],
        legacyUrl: '',
      };
    }
    return { hasResources: true, entries: [], legacyUrl: normalizedDirectUrl };
  }

  if (raw.includes('\n')) {
    const entries = raw
      .split('\n')
      .map((line, index) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return null;
        const [labelPart, urlPart] = trimmed.includes('|') ? trimmed.split('|') : [`Voz ${index + 1}`, trimmed];
        return toVoiceEntry(
          String(urlPart || '').trim(),
          index,
          String(labelPart || `Voz ${index + 1}`).trim() || `Voz ${index + 1}`,
        );
      })
      .filter(Boolean);

    if (entries.length > 0) {
      return { hasResources: true, entries, legacyUrl: '' };
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return parseVoiceResources(parsed);
    }
    if (Array.isArray(parsed)) {
      const entries = parsed
        .map((entry, index) => toVoiceEntry(entry, index, index === 0 ? 'Voz guía' : ''))
        .filter(Boolean);
      return { hasResources: entries.length > 0, entries, legacyUrl: '' };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
      const entries = parsed.entries
        .map((entry, index) => toVoiceEntry(entry, index, index === 0 ? 'Voz guía' : ''))
        .filter(Boolean);
      const legacyUrl = normalizeVoiceExternalUrl(String(parsed.legacyUrl || parsed.folder || parsed.drive || '').trim());
      return { hasResources: entries.length > 0 || Boolean(legacyUrl), entries, legacyUrl };
    }
    if (parsed && typeof parsed === 'object') {
      const directEntry = toVoiceEntry(
        parsed,
        0,
        parsed.label || parsed.nombre || parsed.name || parsed.title || 'Voz guía',
      );
      if (directEntry) {
        return { hasResources: true, entries: [directEntry], legacyUrl: '' };
      }

      const entries = Object.entries(parsed)
        .map(([key, candidate], index) => toVoiceEntry(candidate, index, String(key || `Voz ${index + 1}`)))
        .filter(Boolean);
      if (entries.length > 0) {
        return { hasResources: true, entries, legacyUrl: '' };
      }
    }
  } catch {
    const fallbackLegacyUrl = normalizeVoiceExternalUrl(raw);
    return {
      hasResources: Boolean(fallbackLegacyUrl),
      entries: [],
      legacyUrl: fallbackLegacyUrl,
    };
  }

  return { hasResources: false, entries: [], legacyUrl: '' };
};

const normalizeVoiceLabel = (rawVoice = '') => {
  const source = String(rawVoice || '').trim();
  if (!source) return '';

  const normalized = source
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const hasHombre = normalized.includes('hombre');
  const hasMujer = normalized.includes('mujer');

  if (hasHombre && hasMujer) return 'Hombre y Mujer';
  if (hasMujer) return 'Mujer';
  if (hasHombre) return 'Hombre';

  return source;
};

const hasValidVoicePayload = (value) => {
  const raw = serializeVoicePayload(value);
  const normalized = raw
    ? raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    : '';

  return Boolean(raw && raw !== '-' && normalized !== 'no esta');
};

const openVoicesModal = ({ title, artist, entries = [], legacyUrl = '' }) => {
  if (typeof window === 'undefined') return;

  if (window.__REDIL_VOCES_MODAL__?.open) {
    window.__REDIL_VOCES_MODAL__.open(title || 'Recursos de voz', artist || '', entries, legacyUrl || '');
    return;
  }

  window.dispatchEvent(new CustomEvent('open-voces-modal', {
    detail: {
      title,
      artist,
      entries,
      legacyUrl,
    },
  }));
};

export default function EnsayoHub({
  playlist = [],
  contextTitle = 'Modo Ensayo',
  eventMeta = null,
  initialSongId = null,
  playlistId = null,
  canEdit = false,
}) {
  const [localPlaylist, setLocalPlaylist] = useState(() =>
    Array.isArray(playlist) ? playlist.filter(Boolean) : []
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [showPrayerModal, setShowPrayerModal] = useState(false);
  const [prayerText, setPrayerText] = useState('');
  const [prayerTitle, setPrayerTitle] = useState('Oración de Confesión');

  const songs = localPlaylist;

  const initialSong = useMemo(() => (
    initialSongId
      ? songs.find((song) => String(song?.id || '') === String(initialSongId)) || null
      : null
  ), [initialSongId, songs]);

  const [cancionActiva, setCancionActiva] = useState(initialSong);
  const [lastViewedSongId, setLastViewedSongId] = useState(initialSong ? String(initialSong.id || '') : null);
  const [activeMetronomeSongId, setActiveMetronomeSongId] = useState(null);
  const [queueState, setQueueState] = useState({ active: false, index: -1 });
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isSyncReceiver, setIsSyncReceiver] = useState(false);
  const [syncCountdown, setSyncCountdown] = useState(null); // null | 3 | 2 | 1 | 0

  const metronomeIntervalRef = useRef(null);
  const metronomeAudioCtxRef = useRef(null);
  const queueSongsRef = useRef([]);
  const queueIndexRef = useRef(-1);
  const queueActiveRef = useRef(false);
  const [insertAfterIndex, setInsertAfterIndex] = useState(-1);

  const playableSongs = useMemo(() => (
    songs.filter((song) => typeof song?.mp3 === 'string' && song.mp3.trim() !== '')
  ), [songs]);

  // ── Reordenamiento de canciones ──
  const moveSong = useCallback(async (fromIndex, direction) => {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= localPlaylist.length) return;
    const newList = [...localPlaylist];
    const [moved] = newList.splice(fromIndex, 1);
    newList.splice(toIndex, 0, moved);
    setLocalPlaylist(newList);
    if (playlistId) {
      for (let i = 0; i < newList.length; i++) {
        const s = newList[i];
        if (s?.isPrayer) continue; // no persistir oraciones (son locales)
        await supabase
          .from('playlist_canciones')
          .update({ orden: i })
          .eq('playlist_id', playlistId)
          .eq('cancion_id', s.id);
      }
    }
  }, [localPlaylist, playlistId]);

  // ── Insertar sección de oración ──
  const insertPrayerSection = useCallback((afterIndex) => {
    const prayerSong = {
      id: `prayer-${Date.now()}`,
      title: prayerTitle || 'Oración de Confesión',
      artist: '',
      key: '-',
      originalKey: '-',
      bpm: 0,
      category: 'Oración',
      mp3: '',
      linkVoces: '',
      linkSecuencias: '',
      sectionMarkers: [],
      duration: 0,
      sections: [],
      isPrayer: true,
      prayerText: prayerText || '',
    };
    const newList = [...localPlaylist];
    newList.splice(afterIndex + 1, 0, prayerSong);
    setLocalPlaylist(newList);
    setShowPrayerModal(false);
    setPrayerText('');
    setPrayerTitle('Oración de Confesión');
  }, [localPlaylist, prayerText, prayerTitle]);

  const removePrayerSection = useCallback((index) => {
    const newList = [...localPlaylist];
    if (newList[index]?.isPrayer) {
      newList.splice(index, 1);
      setLocalPlaylist(newList);
    }
  }, [localPlaylist]);

  // ── Receptor Global: Escucha al Director y navega automáticamente ──
  useEffect(() => {
    if (!isSyncReceiver || playableSongs.length === 0) return;

    const channel = supabase.channel('ensayo-live-sync', {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'SECTION_CHANGE' }, (payload) => {
      if (!payload.payload?.songId) return;
      const incomingSongId = String(payload.payload.songId);

      setCancionActiva(current => {
        if (current && String(current.id) === incomingSongId) return current;
        const nextSong = playableSongs.find(s => String(s.id) === incomingSongId);
        if (nextSong) {
          console.log('📡 [Global Sync] Cambiando a:', nextSong.title);
          return nextSong;
        }
        return current;
      });
    }).subscribe();

    return () => { channel.unsubscribe(); supabase.removeChannel(channel); };
  }, [isSyncReceiver, playableSongs]);

  // ── Cuenta regresiva de conexión ──
  useEffect(() => {
    if (syncCountdown === null) return;

    if (syncCountdown > 0) {
      const timer = setTimeout(() => setSyncCountdown(syncCountdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (syncCountdown === 0) {
      setIsSyncReceiver(true);
      const timer = setTimeout(() => setSyncCountdown(null), 800);
      return () => clearTimeout(timer);
    }
  }, [syncCountdown]);

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
    const safeUrl = song.mp3.replace(/ /g, '%20');
    dispatchProPlayerEvent({
      url: safeUrl,
      title: song.title,
      artist: song.artist,
      autoPlay,
    });
  }, []);

  const openSongVoices = useCallback((song) => {
    if (typeof window === 'undefined') return;
    console.log('[EnsayoHub] 🎤 Iniciando openSongVoices para:', song?.title);

    const rawVoicePayload = serializeVoicePayload(song?.linkVoces);
    const parsed = parseVoiceResources(rawVoicePayload);
    console.log('[EnsayoHub] ⚙️ Payload procesado:', parsed);

    const fallbackLegacyUrl =
      parsed.legacyUrl ||
      normalizeVoiceExternalUrl(rawVoicePayload) ||
      normalizeVoiceExternalUrl(song?.linkVoces?.legacyUrl || song?.linkVoces?.folder || song?.linkVoces?.drive || '');

    if (!parsed.hasResources && !fallbackLegacyUrl) {
      console.warn('[EnsayoHub] ⚠️ No se encontraron recursos de voz válidos.');
      return;
    }

    stopMetronome();
    stopQueue();
    window.__REDIL_PRO_PLAYER__?.close?.();

    console.log('[EnsayoHub] 🚀 Disparando evento/modal de voces...');
    openVoicesModal({
      title: song?.title || 'Recursos de voz',
      artist: song?.artist || '',
      entries: parsed.entries || [],
      legacyUrl: fallbackLegacyUrl || '',
    });
  }, [stopMetronome, stopQueue]);

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
        globalSyncMode={isSyncReceiver}
      />
    );
  }

  if (isLiveMode) {
    return (
      <ModoLiveDirector
        playlist={songs}
        contextTitle={contextTitle}
        onExit={() => {
          stopMetronome();
          stopQueue();
          setIsLiveMode(false);
        }}
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
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setIsEditMode(!isEditMode)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider transition-all ${
                          isEditMode
                            ? 'bg-brand text-white'
                            : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                        }`}
                      >
                        <GripVertical className="h-3 w-3" />
                        {isEditMode ? 'Listo' : 'Editar'}
                      </button>
                    )}
                  </div>
                </div>

              </div>
            </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <div className="mx-auto max-w-5xl">
          <div className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-zinc-950/88 dark:shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
            {songs.map((song, index) => {
              // ── Card de Oración ──
              if (song?.isPrayer) {
                return (
                  <article
                    key={song.id}
                    className="group flex w-full items-center gap-3 border-b border-zinc-200/90 bg-amber-50/50 px-4 py-4 dark:border-white/10 dark:bg-amber-500/5"
                  >
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-300/50 bg-amber-100 text-lg dark:border-amber-500/20 dark:bg-amber-500/10">
                      🙏
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-black tracking-tight text-amber-800 dark:text-amber-300">
                        {song.title}
                      </p>
                      {song.prayerText && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-amber-600/80 dark:text-amber-400/60">
                          {song.prayerText}
                        </p>
                      )}
                      <span className="mt-1 inline-flex items-center rounded-full bg-amber-200/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        Sección de Oración
                      </span>
                    </div>
                    {isEditMode && (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => moveSong(index, -1)} disabled={index === 0}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:border-white/10 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => moveSong(index, 1)} disabled={index === songs.length - 1}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:border-white/10 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => removePrayerSection(index)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:hover:bg-red-500/20">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </article>
                );
              }

              // ── Card de Canción normal ──
              const keyLabel = normalizeKeyToAmerican(song?.originalKey || song?.key || '-');
              const bpmValue = Number.isFinite(Number(song?.bpm)) ? Math.max(0, Math.round(Number(song.bpm))) : 0;
              const isMetronomeActive = activeMetronomeSongId === song?.id;
              const hasSongAudio = typeof song?.mp3 === 'string' && song.mp3.trim() !== '';
              const parsedVoices = parseVoiceResources(song?.linkVoces);
              const safeVocesPayload = parsedVoices.entries.length > 0
                ? JSON.stringify(parsedVoices.entries)
                : (parsedVoices.legacyUrl || '');
              const hasVoiceResources = parsedVoices.hasResources || Boolean(parsedVoices.legacyUrl);
              const voiceLabel = normalizeVoiceLabel(song?.voz);
              const isLastViewed = String(song?.id || index) === String(lastViewedSongId || '');

              return (
                <React.Fragment key={song?.id || `${song?.title || 'song'}-${index}`}>
                <article
                  onClick={(event) => {
                    if (isEditMode || event.target.closest('button')) return;
                    openCompactSong(song);
                  }}
                  onKeyDown={(event) => {
                    if (isEditMode) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openCompactSong(song);
                    }
                  }}
                  role="button"
                  tabIndex={isEditMode ? -1 : 0}
                  className={`group grid w-full items-start gap-x-3 gap-y-2 border-b border-zinc-200/90 px-4 py-4 text-left transition-colors dark:border-white/10 last:border-b-0 ${
                    isEditMode
                      ? 'grid-cols-[auto_auto_minmax(0,1fr)_auto]'
                      : 'grid-cols-[auto_minmax(0,1fr)_auto]'
                  } ${
                    isLastViewed
                      ? 'bg-brand/6 hover:bg-brand/10 dark:bg-brand/10 dark:hover:bg-brand/12'
                      : isEditMode ? '' : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                  }`}
                >
                  {/* Flechas de reorden (solo en modo edición) */}
                  {isEditMode && (
                    <div className="flex flex-col items-center gap-0.5 self-center">
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveSong(index, -1); }} disabled={index === 0}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-20 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <GripVertical className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveSong(index, 1); }} disabled={index === songs.length - 1}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-20 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  <div className="grid h-12 w-12 shrink-0 place-items-center self-center rounded-2xl border border-zinc-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(244,244,245,0.96))] text-sm font-black text-zinc-600 shadow-sm dark:border-white/10 dark:bg-[linear-gradient(180deg,_rgba(39,39,42,0.92),_rgba(24,24,27,0.92))] dark:text-zinc-200">
                    {String(index + 1).padStart(2, '0')}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-black tracking-tight text-zinc-950 dark:text-zinc-50 md:text-lg">
                      {song?.title || `Canción ${index + 1}`}
                    </p>
                    <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                      {song?.artist || 'Redil Worship'}
                    </p>
                    <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1 pr-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {hasVoiceResources && (
                        <button
                          type="button"
                          className="btn-open-voces inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand transition-colors hover:bg-brand/15 dark:border-brand/25 dark:bg-brand/10 dark:text-brand dark:hover:bg-brand/16"
                          data-voces={safeVocesPayload}
                          data-title={song?.title || ''}
                          data-artist={song?.artist || ''}
                          aria-label={`Abrir voces de ${song?.title || 'cancion'}`}
                          title="Ensayar voces"
                        >
                          <Mic2 className="h-3.5 w-3.5" />
                          Voces
                        </button>
                      )}
                      <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200">
                        {keyLabel}
                      </span>
                      {song?.category && (
                        <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">
                          {song.category}
                        </span>
                      )}
                      {voiceLabel && (
                        <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-[11px] font-bold tracking-[0.04em] text-zinc-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">
                          {voiceLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="ensayo-hub-row-actions flex shrink-0 items-start gap-2 self-start pt-1">
                    {!isEditMode && (
                      <>
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
                      </>
                    )}
                  </div>
                </article>

                {/* Botón para insertar oración entre canciones (solo en modo edición) */}
                {isEditMode && (
                  <div className="flex items-center justify-center border-b border-zinc-200/90 py-1 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => { setInsertAfterIndex(index); setShowPrayerModal(true); }}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-500/10 dark:hover:text-amber-400"
                    >
                      <Plus className="h-3 w-3" />
                      Insertar oración
                    </button>
                  </div>
                )}
                </React.Fragment>
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
                : 'Reproduce toda la fila.'}
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
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-black text-zinc-700 shadow-sm transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Play className="ml-0.5 h-4 w-4" />
              {queueState.active ? 'Reiniciar' : 'Ensayo'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (isSyncReceiver) {
                  setIsSyncReceiver(false);
                  setSyncCountdown(null);
                } else {
                  setSyncCountdown(3);
                }
              }}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black transition-all ${
                isSyncReceiver || syncCountdown !== null
                  ? 'bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                  : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
              }`}
              title={isSyncReceiver ? 'Sincronización Activa (Escuchando al Director)' : 'Conectar al Director'}
            >
              <RadioReceiver className={`h-4 w-4 ${isSyncReceiver ? 'animate-pulse' : ''}`} />
              <span className="hidden sm:inline">RECIBIR LIVE</span>
            </button>
            <button
              type="button"
              onClick={() => { stopMetronome(); stopQueue(); setIsLiveMode(true); }}
              disabled={playableSongs.length === 0}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-sm font-black text-white shadow-lg shadow-brand/25 transition-all hover:bg-brand/90 hover:shadow-brand/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Zap className="h-4 w-4" />
              MODO LIVE
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
        body[data-voces-modal-open='true'] .ensayo-hub-row-actions,
        body[data-voces-modal-open='true'] .ensayo-hub-row-chevron,
        body[data-pro-player-modal-open='true'] .ensayo-hub-queuebar,
        body[data-voces-modal-open='true'] .ensayo-hub-queuebar {
          opacity: 0;
          pointer-events: none;
        }

        body[data-pro-player-modal-open='true'] .ensayo-hub-queuebar,
        body[data-voces-modal-open='true'] .ensayo-hub-queuebar {
          transform: translateY(calc(100% + env(safe-area-inset-bottom) + 1rem));
        }
      `}</style>

      {/* MODAL: Insertar sección de oración */}
      {showPrayerModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <div className="border-b border-zinc-200/80 bg-amber-50 px-5 py-4 dark:border-white/10 dark:bg-amber-500/10">
              <h3 className="text-lg font-black text-amber-800 dark:text-amber-300">🙏 Sección de Oración</h3>
              <p className="mt-0.5 text-sm text-amber-600/70 dark:text-amber-400/60">Se insertará después de la canción {insertAfterIndex + 1}</p>
            </div>
            <div className="flex flex-col gap-4 p-5">
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Título</label>
                <input
                  type="text"
                  value={prayerTitle}
                  onChange={(e) => setPrayerTitle(e.target.value)}
                  placeholder="Oración de Confesión"
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-bold text-zinc-900 placeholder-zinc-400 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Texto de la oración (opcional)</label>
                <textarea
                  value={prayerText}
                  onChange={(e) => setPrayerText(e.target.value)}
                  placeholder="Padre celestial, venimos ante tu presencia..."
                  rows={4}
                  className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-700 placeholder-zinc-400 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-300 dark:placeholder-zinc-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-zinc-200/80 px-5 py-3 dark:border-white/10">
              <button
                type="button"
                onClick={() => { setShowPrayerModal(false); setPrayerText(''); setPrayerTitle('Oración de Confesión'); }}
                className="rounded-xl px-4 py-2 text-sm font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => insertPrayerSection(insertAfterIndex)}
                className="rounded-xl bg-amber-500 px-5 py-2 text-sm font-black text-white shadow-lg shadow-amber-500/25 hover:bg-amber-600"
              >
                Insertar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY DE CONEXIÓN LIVE — Cuenta regresiva */}
      {syncCountdown !== null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/95 backdrop-blur-md transition-all duration-300">
          <div className="flex flex-col items-center gap-6 text-center">
            <RadioReceiver className={`h-16 w-16 text-emerald-500 ${syncCountdown > 0 ? 'animate-pulse' : 'animate-bounce'}`} />
            <h2 className="text-xl font-black uppercase tracking-[0.2em] text-white opacity-80">
              {syncCountdown > 0 ? 'Sincronizando con Director' : '¡Conexión Establecida!'}
            </h2>
            <div className="relative flex h-40 w-40 items-center justify-center rounded-full border-4 border-emerald-500/20 bg-emerald-500/10 shadow-[0_0_50px_rgba(16,185,129,0.2)]">
              <p className="absolute text-[6rem] font-black leading-none text-emerald-400">
                {syncCountdown > 0 ? syncCountdown : 'ON'}
              </p>
              {syncCountdown > 0 && (
                <svg className="absolute inset-0 h-full w-full animate-spin text-emerald-500" style={{ animationDuration: '1.5s' }} viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="150" strokeLinecap="round" />
                </svg>
              )}
            </div>
            <p className="mt-4 text-xs font-bold uppercase tracking-widest text-zinc-500">
              Por favor, no toque la pantalla
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
