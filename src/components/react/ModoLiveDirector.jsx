import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  Music2,
  Zap,
  ChevronRight,
  ChevronUp,
  Disc3,
  Repeat,
  Repeat2,
  Waves,
  ListMusic,
  CloudDownload,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

// ── ID3v2 APIC (Cover Art) Extractor ──────────────────────────
const coverArtCache = new Map();

const extractCoverArt = async (mp3Url) => {
  if (!mp3Url) return null;
  if (coverArtCache.has(mp3Url)) return coverArtCache.get(mp3Url);

  try {
    // Fetch solo los primeros 512KB (tags ID3 están al inicio)
    const res = await fetch(mp3Url, {
      headers: { Range: 'bytes=0-524287' },
      mode: 'cors',
    });
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const view = new DataView(buffer);

    // Verificar header ID3v2: "ID3"
    if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
      coverArtCache.set(mp3Url, null);
      return null;
    }

    const majorVersion = view.getUint8(3);
    // Tamaño del tag (syncsafe integer, 4 bytes)
    const tagSize =
      ((view.getUint8(6) & 0x7F) << 21) |
      ((view.getUint8(7) & 0x7F) << 14) |
      ((view.getUint8(8) & 0x7F) << 7) |
      (view.getUint8(9) & 0x7F);

    const tagEnd = Math.min(10 + tagSize, buffer.byteLength);
    let offset = 10;

    // Skip extended header si existe
    const flags = view.getUint8(5);
    if (flags & 0x40) {
      const extSize = view.getUint32(offset);
      offset += extSize;
    }

    // Buscar frame APIC
    while (offset + 10 < tagEnd) {
      const frameId = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3)
      );

      let frameSize;
      if (majorVersion >= 4) {
        // v2.4: syncsafe
        frameSize =
          ((view.getUint8(offset + 4) & 0x7F) << 21) |
          ((view.getUint8(offset + 5) & 0x7F) << 14) |
          ((view.getUint8(offset + 6) & 0x7F) << 7) |
          (view.getUint8(offset + 7) & 0x7F);
      } else {
        // v2.3: normal int
        frameSize = view.getUint32(offset + 4);
      }

      if (frameSize <= 0 || frameSize > tagEnd - offset) break;

      if (frameId === 'APIC') {
        const frameData = new Uint8Array(buffer, offset + 10, frameSize);
        const encoding = frameData[0];
        let pos = 1;

        // Leer MIME type (null-terminated)
        let mimeType = '';
        while (pos < frameData.length && frameData[pos] !== 0) {
          mimeType += String.fromCharCode(frameData[pos]);
          pos++;
        }
        pos++; // skip null

        // Picture type (1 byte) — 0x03 = front cover, pero aceptamos cualquiera
        pos++;

        // Description (null-terminated, encoding-dependent)
        if (encoding === 0 || encoding === 3) {
          // ISO-8859-1 o UTF-8
          while (pos < frameData.length && frameData[pos] !== 0) pos++;
          pos++;
        } else {
          // UTF-16 (encoding 1 o 2)
          while (pos + 1 < frameData.length && !(frameData[pos] === 0 && frameData[pos + 1] === 0)) pos += 2;
          pos += 2;
        }

        // Resto = datos de la imagen
        const imageData = frameData.slice(pos);
        if (imageData.length < 100) break; // Demasiado pequeño para ser una imagen

        if (!mimeType || mimeType === 'image/') mimeType = 'image/jpeg';
        const blob = new Blob([imageData], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        coverArtCache.set(mp3Url, blobUrl);
        return blobUrl;
      }

      offset += 10 + frameSize;
    }

    coverArtCache.set(mp3Url, null);
    return null;
  } catch (err) {
    console.warn('[CoverArt] Error extrayendo:', err);
    coverArtCache.set(mp3Url, null);
    return null;
  }
};

// ── Section visuals (shared with ModoEnsayoCompacto) ──
const normalizeSectionLabel = (value = '') => String(value || '').trim().toLowerCase();
const stripAccents = (value = '') => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const toRgba = (rgb = [161, 161, 170], alpha = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

const SECTION_VISUALS = {
  intro:      { short: 'I',  rgb: [34, 211, 238] },
  verse:      { short: 'V',  rgb: [99, 102, 241] },
  prechorus:  { short: 'Pr', rgb: [234, 179, 8] },
  chorus:     { short: 'C',  rgb: [249, 115, 22] },
  interlude:  { short: 'It', rgb: [239, 68, 68] },
  bridge:     { short: 'P',  rgb: [236, 72, 153] },
  refrain:    { short: 'Rf', rgb: [34, 197, 94] },
  outro:      { short: 'F',  rgb: [14, 165, 233] },
  vamp:       { short: 'Vp', rgb: [248, 113, 113] },
  default:    { short: 'S',  rgb: [148, 163, 184] },
};

const getSectionKind = (sectionName = '') => {
  const normalized = normalizeSectionLabel(stripAccents(sectionName));
  if (normalized.includes('pre coro') || normalized.includes('pre-coro') || normalized.includes('prechorus') || normalized.includes('pre chorus')) return 'prechorus';
  if (normalized.includes('verso') || normalized.includes('verse')) return 'verse';
  if (normalized.includes('coro') || normalized.includes('chorus')) return 'chorus';
  if (normalized.includes('interludio') || normalized.includes('interlude') || normalized.includes('instrumental')) return 'interlude';
  if (normalized.includes('puente') || normalized.includes('bridge')) return 'bridge';
  if (normalized.includes('refran') || normalized.includes('refrain') || normalized.includes('tag')) return 'refrain';
  if (normalized.includes('outro') || normalized.includes('final') || normalized.includes('ending') || normalized.includes('fin')) return 'outro';
  if (normalized.includes('vamp')) return 'vamp';
  if (normalized.includes('intro') || normalized.includes('entrada')) return 'intro';
  return 'default';
};

const buildSectionShortLabel = (sectionName = '', kind = 'default', occurrence = 1) => {
  const source = stripAccents(sectionName);
  const explicitNumber = source.match(/(\d+)/)?.[1];
  const fallbackNumber = explicitNumber || occurrence;
  if (kind === 'verse') return `V${fallbackNumber}`;
  if (kind === 'intro') return 'I';
  if (kind === 'prechorus') return 'Pr';
  if (kind === 'chorus') return 'C';
  if (kind === 'interlude') return 'It';
  if (kind === 'bridge') return 'P';
  if (kind === 'refrain') return 'Rf';
  if (kind === 'outro') return 'F';
  if (kind === 'vamp') return 'Vp';
  const compact = source.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  return compact || `S${fallbackNumber}`;
};

// Un patrón SVG de onda de audio genérico pero estilizado
const OndaAudioPattern = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='60' viewBox='0 0 100 60'%3E%3Cpath fill='%23ffffff' opacity='0.4' d='M0 30 C 5 10, 10 50, 15 30 S 25 10, 30 30 S 40 50, 45 30 S 55 10, 60 30 S 70 50, 75 30 S 85 10, 90 30 S 98 50, 100 30 V 60 H 0 Z'/%3E%3Cpath fill='%23ffffff' opacity='0.2' d='M0 30 C 5 20, 10 40, 15 30 S 25 20, 30 30 S 40 40, 45 30 S 55 20, 60 30 S 70 40, 75 30 S 85 20, 90 30 S 98 40, 100 30 V 60 H 0 Z'/%3E%3C/svg%3E")`;

// ── Pad Ambiental: normalización de tonalidad ──
const FLAT_TO_SHARP_PAD = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
const LATIN_TO_AMERICAN_PAD = {
  Do: 'C', 'Do#': 'C#', Reb: 'C#', Re: 'D', 'Re#': 'D#', Mib: 'D#',
  Mi: 'E', Fa: 'F', 'Fa#': 'F#', Solb: 'F#', Sol: 'G', 'Sol#': 'G#',
  Lab: 'G#', La: 'A', 'La#': 'A#', Sib: 'A#', Si: 'B',
};
const normalizeKeyForPad = (rawKey = '') => {
  const src = String(rawKey || '').trim().replace(/\u266F/g, '#').replace(/\u266D/g, 'b').replace(/\s+/g, '');
  if (!src || src === '-') return null;
  if (LATIN_TO_AMERICAN_PAD[src]) return LATIN_TO_AMERICAN_PAD[src];
  const upper = src.charAt(0).toUpperCase() + src.slice(1);
  const m = upper.match(/^([A-G][#b]?)/);
  if (!m) return null;
  return FLAT_TO_SHARP_PAD[m[1]] || m[1];
};
const PAD_BASE_URL = 'https://pub-4faa87e319a345c38e4f3be570797088.r2.dev/pads';

const formatTime = (secs) => {
  if (!Number.isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// ── Playback Sources: Extracción de secuencias ──
const AUDIO_SOURCE_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac)(\?.*)?$/i;
const isAudioSourceUrl = (v = '') => AUDIO_SOURCE_EXT_RE.test(String(v || '').trim());

const normalizePlaybackSourceEntry = (entry, index, fallbackKind = 'sequence') => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const t = entry.trim();
    if (!isAudioSourceUrl(t)) return null;
    return { id: `${fallbackKind}-${index}-${t}`, label: fallbackKind === 'original' ? 'Música original' : `Secuencia ${index + 1}`, url: t, kind: fallbackKind };
  }
  if (typeof entry === 'object') {
    const rawUrl = String(entry.url || entry.src || entry.href || entry.link || '').trim();
    if (!isAudioSourceUrl(rawUrl)) return null;
    const kind = String(entry.kind || entry.type || fallbackKind || 'sequence').trim().toLowerCase() === 'original' ? 'original' : 'sequence';
    const label = String(entry.label || entry.name || entry.title || (kind === 'original' ? 'Música original' : `Secuencia ${index + 1}`)).trim();
    return { id: String(entry.id || `${kind}-${index}-${rawUrl}`), label, url: rawUrl, kind };
  }
  return null;
};

const parseSequenceSourceEntries = (rawValue = '') => {
  const source = String(rawValue || '').trim();
  if (!source) return [];
  if (source.startsWith('[') || source.startsWith('{')) {
    try { const p = JSON.parse(source); return Array.isArray(p) ? p : (p && typeof p === 'object' ? [p] : []); } catch {}
  }
  if (isAudioSourceUrl(source)) return [source];
  return source.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map((line, i) => {
    const [maybeLabel, ...rest] = line.split('|');
    return rest.length === 0 ? line : { label: maybeLabel.trim(), url: rest.join('|').trim() };
  });
};

const buildPlaybackSources = (song) => {
  const sources = [];
  const seenUrls = new Set();
  const push = (entry, i, kind = 'sequence') => {
    const n = normalizePlaybackSourceEntry(entry, i, kind);
    if (!n || seenUrls.has(n.url)) return;
    seenUrls.add(n.url);
    sources.push(n);
  };
  push({ id: 'original', label: 'Música original', url: song?.mp3, kind: 'original' }, 0, 'original');
  const candidates = [
    ...(Array.isArray(song?.playbackSources) ? song.playbackSources : []),
    ...(Array.isArray(song?.sequenceSources) ? song.sequenceSources : []),
    ...(Array.isArray(song?.sequences) ? song.sequences : []),
  ];
  const raw = song?.linkSecuencias || song?.link_secuencias || '';
  if (raw) candidates.push(...parseSequenceSourceEntries(raw));
  candidates.forEach((e, i) => push(e, i));
  return sources;
};

// Extrae la primera línea cantable de la letra (sin acordes entre corchetes)
const getFirstLyricLine = (body = '') => {
  if (!body) return '';
  const cleanText = body.replace(/\[.*?\]/g, '');
  const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  return lines[0] || '...';
};

export default function ModoLiveDirector({ playlist = [], contextTitle = 'Setlist', onExit }) {
  const [activeSongIndex, setActiveSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [coverArts, setCoverArts] = useState({});
  const [loopedSectionIndex, setLoopedSectionIndex] = useState(null);
  const [isPadActive, setIsPadActive] = useState(false);
  const [padVolume, setPadVolume] = useState(0.5);
  const [activePadChannel, setActivePadChannel] = useState('A');
  const [showPadPanel, setShowPadPanel] = useState(false);
  const [padBridging, setPadBridging] = useState(false); // true durante gap entre pistas
  const padPanelRef = useRef(null);
  const [panValue, setPanValue] = useState(0); // -1 Izq, 0 Centro, 1 Der
  const [showRouteMenu, setShowRouteMenu] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState('original');
  const routeMenuRef = useRef(null);
  const audioRef = useRef(null);
  const padAudioRefA = useRef(null);
  const padAudioRefB = useRef(null);
  const audioCtxRef = useRef(null);
  const trackSourceRef = useRef(null);
  const trackGainRef = useRef(null);
  const trackPanRef = useRef(null);
  const analyserRef = useRef(null);
  const silenceStartRef = useRef(null); // timestamp cuando empezó el silencio
  const timelineRef = useRef(null);
  const syncChannelRef = useRef(null);
  const syncDataRef = useRef({ songId: null, sectionIndex: 0, time: 0 });
  const hasAutoDownloadedRef = useRef(false);
  const [downloadStatus, setDownloadStatus] = useState({ active: false, progress: 0, total: 0, done: false });
  const [resolvedAudioSrc, setResolvedAudioSrc] = useState(null);
  const [resolvedPadSrc, setResolvedPadSrc] = useState(null);

  const activeSong = playlist[activeSongIndex] || null;
  const sections = Array.isArray(activeSong?.sectionMarkers) ? activeSong.sectionMarkers : [];
  const hasSections = sections.length > 0;
  const activeCover = activeSong?.mp3 ? coverArts[activeSong.mp3] : null;

  // ── Playback Sources: fuentes de audio disponibles ──
  const playbackSources = useMemo(() => buildPlaybackSources(activeSong), [activeSong]);
  const activeSource = useMemo(
    () => playbackSources.find(s => s.id === selectedSourceId) || playbackSources[0] || null,
    [playbackSources, selectedSourceId]
  );
  const activeSourceUrl = activeSource?.url || activeSong?.mp3 || '';

  // Marcadores filtrados (solo válidos)
  const markers = useMemo(() => {
    if (!sections.length) return [];
    return sections.filter(m => Number.isFinite(Number(m.startSec ?? m.start_sec)));
  }, [sections]);

  // ── Visual Markers: cruce sectionMarkers × sections reales ──
  const timelineDuration = duration || 1;
  const visualMarkers = useMemo(() => {
    if (!activeSong?.sectionMarkers) return [];
    const rawMarkers = activeSong.sectionMarkers.filter(
      (m) => Number.isFinite(Number(m.startSec ?? m.start_sec))
    );
    if (!rawMarkers.length) return [];

    const realSections = activeSong.sections || [];

    // Pre-mapear secciones reales con kind y occurrence
    const kindOccurrences = new Map();
    const mappedSections = realSections.map((sec, i) => {
      const kind = getSectionKind(sec.name || '');
      const occ = (kindOccurrences.get(kind) || 0) + 1;
      kindOccurrences.set(kind, occ);
      return { ...sec, kind, occurrence: occ, realIndex: i };
    });

    let nextSectionSearchIndex = 0;

    return rawMarkers.map((marker, index) => {
      const startSec = Math.max(0, Number(marker.startSec ?? marker.start_sec ?? 0));
      const nextMarker = rawMarkers[index + 1];
      const endSec = nextMarker
        ? Math.max(0, Number(nextMarker.startSec ?? nextMarker.start_sec ?? timelineDuration))
        : timelineDuration;
      const sectionDur = Math.max(0, endSec - startSec);
      const widthPercent = Math.max(0.5, (sectionDur / timelineDuration) * 100);

      // ── Emparejar marcador → sección real de la letra ──
      const markerName = String(marker.sectionName || marker.name || '').trim();
      const normalizedMarkerName = normalizeSectionLabel(markerName);
      let realSection = null;

      // 1. Por índice explícito guardado en BD
      const rawIdx = Number(marker.sectionIndex ?? marker.rawSectionIndex ?? -1);
      if (Number.isInteger(rawIdx) && rawIdx >= 0 && rawIdx < mappedSections.length) {
        realSection = mappedSections[rawIdx];
      }

      // 2. Por sectionOccurrence + nombre
      if (!realSection && Number.isInteger(Number(marker.sectionOccurrence))) {
        let occCount = 0;
        const found = mappedSections.find((sec) => {
          if (normalizeSectionLabel(sec.name || '') !== normalizedMarkerName) return false;
          occCount += 1;
          return occCount === Number(marker.sectionOccurrence);
        });
        if (found) realSection = found;
      }

      // 3. Por nombre secuencial (avanzando el cursor)
      if (!realSection && normalizedMarkerName) {
        const seqIdx = mappedSections.findIndex((sec, ci) =>
          ci >= nextSectionSearchIndex &&
          normalizeSectionLabel(sec.name || '') === normalizedMarkerName
        );
        if (seqIdx !== -1) realSection = mappedSections[seqIdx];
      }

      // 4. Por nombre global
      if (!realSection && normalizedMarkerName) {
        realSection = mappedSections.find(
          (sec) => normalizeSectionLabel(sec.name || '') === normalizedMarkerName
        );
      }

      // 5. Fallback por orden
      if (!realSection && mappedSections[index]) {
        realSection = mappedSections[index];
      }

      if (realSection) {
        nextSectionSearchIndex = Math.max(nextSectionSearchIndex, (realSection.realIndex ?? 0) + 1);
      }

      const displayName = realSection?.name || markerName || `Sección ${index + 1}`;
      const kind = realSection ? realSection.kind : getSectionKind(displayName);
      const occurrence = realSection ? realSection.occurrence : 1;
      const visual = SECTION_VISUALS[kind] || SECTION_VISUALS.default;
      const shortLabel = buildSectionShortLabel(displayName, kind, occurrence);

      return {
        ...marker,
        startSec,
        endSec,
        sectionDuration: sectionDur,
        widthPercent,
        kind,
        visual,
        shortLabel,
        displayName,
        body: realSection?.body || '',
      };
    });
  }, [activeSong, timelineDuration]);

  const playheadPercent = timelineDuration > 0 ? (currentTime / timelineDuration) * 100 : 0;

  // ── Pad Ambiental: URL basada en tonalidad ──
  const currentPadUrl = useMemo(() => {
    const key = normalizeKeyForPad(activeSong?.originalKey || activeSong?.key);
    if (!key) return null;
    const safeKey = key.replace('#', 'Sharp').replace('b', 'Flat');
    return `${PAD_BASE_URL}/Pad_${safeKey}.mp3`;
  }, [activeSong?.originalKey, activeSong?.key]);

  // Extraer cover art de todos los MP3s al montar
  useEffect(() => {
    let cancelled = false;
    const extract = async () => {
      for (const song of playlist) {
        if (!song?.mp3 || coverArts[song.mp3]) continue;
        const url = await extractCoverArt(song.mp3);
        if (cancelled) return;
        if (url) {
          setCoverArts((prev) => ({ ...prev, [song.mp3]: url }));
        }
      }
    };
    extract();
    return () => { cancelled = true; };
  }, [playlist]);

  // ── Efecto: Descargador Silencioso (Background Auto-Cache) ──
  useEffect(() => {
    if (!playlist || playlist.length === 0 || hasAutoDownloadedRef.current) return;

    const autoCacheSetlist = async () => {
      hasAutoDownloadedRef.current = true;
      setDownloadStatus({ active: true, progress: 0, total: playlist.length * 2, done: false });

      try {
        const cache = await caches.open('repertorio-offline-cache-v1');
        let downloadedCount = 0;

        const cacheOne = async (url) => {
          const matched = await cache.match(url);
          if (!matched) {
            try {
              const response = await fetch(url);
              if (response.ok) await cache.put(url, response);
            } catch (err) {
              console.warn('[AutoCache] Error en background:', url, err);
            }
          }
          downloadedCount++;
          setDownloadStatus((prev) => ({ ...prev, progress: downloadedCount }));
        };

        await Promise.all(playlist.map(async (song) => {
          if (song?.isPrayer) { downloadedCount += 2; return; }
          const safeKey = song.key ? song.key.replace('#', 'Sharp').replace('b', 'Flat') : null;
          const padUrl = safeKey ? `${PAD_BASE_URL}/Pad_${safeKey}.mp3` : null;
          const urlsToCache = [song.mp3, padUrl].filter(Boolean);
          await Promise.all(urlsToCache.map(cacheOne));
        }));
        setDownloadStatus((prev) => ({ ...prev, active: false, done: true }));
      } catch (error) {
        console.error('[AutoCache] Error fatal:', error);
        setDownloadStatus({ active: false, progress: 0, total: 0, done: false });
      }
    };

    const timer = setTimeout(() => autoCacheSetlist(), 2000);
    return () => clearTimeout(timer);
  }, [playlist]);

  // ── Efecto: Interceptor de Audio (Blob Generator) ──
  useEffect(() => {
    const resolveLocalResource = async (cloudUrl) => {
      if (!cloudUrl) return null;
      try {
        const cache = await caches.open('repertorio-offline-cache-v1');
        const matchedResponse = await cache.match(cloudUrl);
        if (matchedResponse) {
          const blob = await matchedResponse.blob();
          return URL.createObjectURL(blob);
        }
      } catch (_) { /* fallback */ }
      return cloudUrl;
    };

    let cancelled = false;
    Promise.all([
      resolveLocalResource(activeSourceUrl),
      resolveLocalResource(currentPadUrl),
    ]).then(([audioSrc, padSrc]) => {
      if (cancelled) {
        // Revocar blob URLs si el efecto fue cancelado antes de aplicarlas
        if (audioSrc?.startsWith('blob:')) URL.revokeObjectURL(audioSrc);
        if (padSrc?.startsWith('blob:')) URL.revokeObjectURL(padSrc);
        return;
      }
      setResolvedAudioSrc((prev) => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return audioSrc; });
      setResolvedPadSrc((prev) => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return padSrc; });
    });

    return () => { cancelled = true; };
  }, [activeSourceUrl, currentPadUrl]);

  // Calcular sección activa basada en tiempo (usa visualMarkers)
  const activeSectionIdx = visualMarkers.length > 0
    ? visualMarkers.reduce((found, vm, i) => (currentTime >= vm.startSec ? i : found), 0)
    : -1;

  // ── Telemetría: Cronómetro regresivo + Teleprompter ──
  const currentMarkerHUD = visualMarkers[activeSectionIdx] ?? null;
  const timeLeft = currentMarkerHUD ? Math.max(0, currentMarkerHUD.endSec - currentTime) : 0;
  const formatCountDown = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `-${m}:${s.toString().padStart(2, '0')}`;
  };
  const nextMarkerHUD = activeSectionIdx >= 0 ? (visualMarkers[activeSectionIdx + 1] ?? null) : null;
  const nextLyric = getFirstLyricLine(nextMarkerHUD?.body);

  // ── Supabase Broadcast: Emisor Maestro ──
  useEffect(() => {
    const channel = supabase.channel('ensayo-live-sync', {
      config: { broadcast: { self: false } },
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[LiveSync Director] Conectado como SYNC MASTER');
      }
    });
    syncChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      syncChannelRef.current = null;
    };
  }, []);

  // ── Sync Ref: predicción anticipada (+500ms de compensación de red) ──
  useEffect(() => {
    if (!activeSong) return;

    const LATENCY_OFFSET = 0.5;
    const anticipatedTime = currentTime + LATENCY_OFFSET;

    // Calcular predictivamente qué sección estará activa en +500ms
    let anticipatedSectionIndex = -1;
    for (let i = visualMarkers.length - 1; i >= 0; i--) {
      if (anticipatedTime >= visualMarkers[i].startSec) {
        anticipatedSectionIndex = i;
        break;
      }
    }
    if (anticipatedSectionIndex === -1 && visualMarkers.length > 0) {
      anticipatedSectionIndex = 0;
    }

    syncDataRef.current = {
      songId: activeSong.id,
      sectionIndex: anticipatedSectionIndex,
      time: anticipatedTime,
    };
  }, [activeSong, currentTime, visualMarkers]);

  // ── Heartbeat: emite cada 1.5s leyendo de la ref (sin flooding) ──
  useEffect(() => {
    if (!syncChannelRef.current || !activeSong) return;

    // Emitir estado inmediato al montar/cambiar canción
    syncChannelRef.current.send({
      type: 'broadcast',
      event: 'SECTION_CHANGE',
      payload: {
        songId: String(activeSong.id || ''),
        sectionIndex: activeSectionIdx,
        currentTime,
      },
    }).catch(e => console.warn('[LiveSync] Error:', e));

    // Heartbeat seguro: lee de la ref, no re-monta al cambiar time/section
    const heartbeat = setInterval(() => {
      const data = syncDataRef.current;
      if (!data.songId) return;
      syncChannelRef.current?.send({
        type: 'broadcast',
        event: 'SECTION_CHANGE',
        payload: {
          songId: String(data.songId),
          sectionIndex: data.sectionIndex,
          currentTime: data.time,
        },
      }).catch(err => console.warn('[LiveSync] Error:', err));
    }, 1500);

    return () => clearInterval(heartbeat);
  }, [activeSong]); // SOLO depende de la canción

  // Cargar canción cuando cambia (no pausar si es auto-transición)
  useEffect(() => {
    silenceStartRef.current = null; // Reset detector de silencio
    const audio = audioRef.current;
    if (!audio) return;
    if (!autoTransitionRef.current) {
      audio.pause();
      audio.currentTime = 0;
      setCurrentTime(0);
      setIsPlaying(false);
    }
    setDuration(0);
  }, [activeSongIndex]);

  // Volumen pista principal
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // ── Auto-pausa cuando la canción activa es una oración ──
  useEffect(() => {
    if (activeSong?.isPrayer) {
      const audio = audioRef.current;
      if (audio && !audio.paused) audio.pause();
      setIsPlaying(false);
    }
  }, [activeSong?.isPrayer, activeSong?.id]);

  // ── Motor Dual de Pads: Crossfade A/B ──
  useEffect(() => {
    const padA = padAudioRefA.current;
    const padB = padAudioRefB.current;
    if (!padA || !padB) return;

    if (!isPadActive || !currentPadUrl) {
      // Fade-out ambos pads en 5s
      [padA, padB].forEach((pad) => {
        if (pad._fadeInterval) clearInterval(pad._fadeInterval);
        const startVol = pad.volume;
        if (startVol <= 0) { pad.pause(); return; }
        const step = startVol / 100;
        pad._fadeInterval = setInterval(() => {
          if (pad.volume - step > 0) { pad.volume -= step; }
          else { pad.volume = 0; pad.pause(); clearInterval(pad._fadeInterval); pad._fadeInterval = null; }
        }, 50);
      });
      return;
    }

    const fadeTime = 4000;
    const steps = 20;
    const stepTime = fadeTime / steps;
    const volStep = padVolume / steps;

    const crossfade = (fadeInPad, fadeOutPad, newUrl) => {
      if (fadeInPad._fadeInterval) clearInterval(fadeInPad._fadeInterval);
      if (fadeOutPad._fadeInterval) clearInterval(fadeOutPad._fadeInterval);
      if (fadeInPad.src !== newUrl) fadeInPad.src = newUrl;
      fadeInPad.volume = 0;
      fadeInPad.play().catch(e => console.warn('Pad autoplay bloqueado', e));

      let currentStep = 0;
      const interval = setInterval(() => {
        currentStep++;
        if (fadeInPad.volume + volStep <= padVolume) fadeInPad.volume += volStep;
        if (fadeOutPad.volume - volStep >= 0) fadeOutPad.volume -= volStep;
        if (currentStep >= steps) {
          fadeInPad.volume = padVolume;
          fadeOutPad.volume = 0;
          fadeOutPad.pause();
          clearInterval(interval);
          fadeInPad._fadeInterval = null;
          fadeOutPad._fadeInterval = null;
        }
      }, stepTime);
      fadeInPad._fadeInterval = interval;
      fadeOutPad._fadeInterval = interval;
    };

    const padSrc = resolvedPadSrc || currentPadUrl;
    if (activePadChannel === 'A') crossfade(padA, padB, padSrc);
    else crossfade(padB, padA, padSrc);
  }, [currentPadUrl, isPadActive, activePadChannel, resolvedPadSrc]);

  // Pad: slider de volumen directo
  useEffect(() => {
    const activePad = activePadChannel === 'A' ? padAudioRefA.current : padAudioRefB.current;
    if (!activePad || !isPadActive || activePad._fadeInterval) return;
    activePad.volume = padBridging ? Math.min(1, padVolume * 1.4) : padVolume;
  }, [padVolume, isPadActive, activePadChannel, padBridging]);

  // ── Web Audio API: Lazy init en primer play (para Split Track) ──
  const ensureWebAudioConnected = useCallback(async () => {
    const audioElement = audioRef.current;
    if (!audioElement || typeof window === 'undefined') return;
    if (audioElement.dataset.webaudioConnected === 'true') return;

    // Limpiar contexto anterior si existe
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      try { audioCtxRef.current.close(); } catch {}
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    audioCtxRef.current = ctx;

    const source = ctx.createMediaElementSource(audioElement);
    const gainNode = ctx.createGain();
    const panNode = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createPanner();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    // Cadena: Source → Panner → Gain → Analyser → Salida
    source.connect(panNode);
    panNode.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(ctx.destination);

    trackSourceRef.current = source;
    trackGainRef.current = gainNode;
    trackPanRef.current = panNode;
    analyserRef.current = analyser;

    audioElement.dataset.webaudioConnected = 'true';

    // Aplicar paneo actual
    if (panNode.pan) {
      panNode.pan.setTargetAtTime(panValue, ctx.currentTime, 0.05);
    }
  }, [panValue]);

  // ── Efecto de Paneo: actualiza panner sin reconectar ──
  useEffect(() => {
    const panner = trackPanRef.current;
    if (!panner) return;
    if (panner.pan) {
      panner.pan.setTargetAtTime(panValue, audioCtxRef.current?.currentTime || 0, 0.05);
    } else if (panner.setPosition) {
      panner.setPosition(panValue, 0, 1 - Math.abs(panValue));
    }
  }, [panValue]);

  const handleTogglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !activeSourceUrl) return;
    if (audio.paused) {
      try {
        await ensureWebAudioConnected();
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          await audioCtxRef.current.resume();
        }
        await audio.play();
      } catch {}
    } else {
      audio.pause();
    }
  }, [activeSong, ensureWebAudioConnected]);

  // ── Auto-Transición Continua: avance ininterrumpido de setlist ──
  const autoTransitionRef = useRef(false);

  const handleNext = useCallback(() => {
    if (activeSongIndex >= playlist.length - 1) return;
    autoTransitionRef.current = true;
    setActiveSongIndex((i) => i + 1);
    setCurrentTime(0);
    // Delay corto para que el DOM cargue el nuevo src
    setTimeout(async () => {
      const audio = audioRef.current;
      if (!audio) return;
      try {
        await ensureWebAudioConnected();
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          await audioCtxRef.current.resume();
        }
        await audio.play();
      } catch {}
      autoTransitionRef.current = false;
    }, 150);
  }, [activeSongIndex, playlist.length, ensureWebAudioConnected]);

  const handlePrev = useCallback(() => {
    if (currentTime > 3 && audioRef.current) {
      audioRef.current.currentTime = 0;
    } else if (activeSongIndex > 0) {
      setActiveSongIndex((i) => i - 1);
    }
  }, [activeSongIndex, currentTime]);

  const handleSeekSection = useCallback((sec, index) => {
    const audio = audioRef.current;
    if (!audio) return;
    const startSec = Number(sec.startSec ?? sec.start_sec ?? 0);
    audio.currentTime = startSec;
    setCurrentTime(startSec);
    // Auto-play al saltar a una sección
    if (audio.paused) {
      audio.play().catch(() => {});
    }
  }, []);

  const handleTimelineClick = useCallback((e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  }, [duration]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Click-outside para cerrar menú de ruteo
  useEffect(() => {
    if (!showRouteMenu) return;
    const handler = (e) => {
      if (routeMenuRef.current && !routeMenuRef.current.contains(e.target)) {
        setShowRouteMenu(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showRouteMenu]);

  // Click-outside para cerrar panel del pad
  useEffect(() => {
    if (!showPadPanel) return;
    const handler = (e) => {
      if (padPanelRef.current && !padPanelRef.current.contains(e.target)) {
        setShowPadPanel(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showPadPanel]);

  // Etiqueta actual del ruteo
  const panLabel = panValue === -1 ? 'Click (L)' : panValue === 1 ? 'Pistas (R)' : 'Estéreo';

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-zinc-950 text-white">
      {/* Audio elements */}
      {activeSourceUrl && (
        <audio
          key={`live-${activeSong?.id || activeSongIndex}-${selectedSourceId}`}
          ref={audioRef}
          src={resolvedAudioSrc || activeSourceUrl}
          crossOrigin="anonymous"
          preload="auto"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => {
            const audio = e.currentTarget;
            const time = audio.currentTime;
            const dur = audio.duration || 0;
            setCurrentTime(time);

            // ── Detección de silencio (último 30% de la pista) ──
            if (analyserRef.current && dur > 0 && time > dur * 0.7 && !audio.paused) {
              const analyser = analyserRef.current;
              const data = new Uint8Array(analyser.fftSize);
              analyser.getByteTimeDomainData(data);
              // Calcular RMS (nivel de volumen real)
              let sum = 0;
              for (let i = 0; i < data.length; i++) {
                const sample = (data[i] - 128) / 128;
                sum += sample * sample;
              }
              const rms = Math.sqrt(sum / data.length);

              // Umbral: ~0.005 es prácticamente silencio
              if (rms < 0.005) {
                if (!silenceStartRef.current) {
                  silenceStartRef.current = Date.now();
                } else if (Date.now() - silenceStartRef.current > 3000) {
                  // 3 segundos de silencio → forzar transición
                  silenceStartRef.current = null;
                  audio.pause();
                  audio.dispatchEvent(new Event('ended'));
                  return;
                }
              } else {
                silenceStartRef.current = null;
              }
            }

            const markers = visualMarkers;
            if (markers.length === 0) return;

            let currentMarkerIndex = markers.reduce(
              (found, vm, i) => (time >= vm.startSec ? i : found), -1
            );

            // FIX Intro: si el tiempo es < al primer marcador, forzar índice 0
            if (currentMarkerIndex === -1 && markers.length > 0) {
              currentMarkerIndex = 0;
            }

            if (currentMarkerIndex !== -1) {
              const currentMarker = markers[currentMarkerIndex];

              // Lógica de Bucle Individual
              if (loopedSectionIndex === currentMarkerIndex && time >= currentMarker.endSec - 0.1) {
                audioRef.current.currentTime = currentMarker.startSec;
                return;
              }
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            if (activeSongIndex < playlist.length - 1) {
              autoTransitionRef.current = true;
              setCurrentTime(0);
              setLoopedSectionIndex(null);

              // ── Pad Bridge: subir volumen del pad durante la transición ──
              if (isPadActive) {
                setPadBridging(true);
              }

              // Verificar si la siguiente canción tiene otra tonalidad
              const nextSong = playlist[activeSongIndex + 1];
              const currentKey = normalizeKeyForPad(activeSong?.originalKey || activeSong?.key);
              const nextKey = normalizeKeyForPad(nextSong?.originalKey || nextSong?.key);
              const keyChanges = currentKey !== nextKey && nextKey;

              // Cambiar canción
              setActiveSongIndex(prev => prev + 1);

              // Solo cambiar canal de pad si la tonalidad cambia (crossfade A/B)
              if (keyChanges) {
                setActivePadChannel(prev => prev === 'A' ? 'B' : 'A');
              }

              // Gap de 5 segundos — el pad llena el silencio
              setTimeout(async () => {
                const audio = audioRef.current;
                if (!audio) return;
                try {
                  await ensureWebAudioConnected();
                  if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
                    await audioCtxRef.current.resume();
                  }
                  await audio.play();
                } catch {}
                autoTransitionRef.current = false;
                // Bajar el pad bridge después de 1s (suaviza la vuelta)
                setTimeout(() => setPadBridging(false), 1000);
              }, 5000);
            }
          }}
        />
      )}
      {/* Pad Ambiental: Dual A/B para crossfade */}
      <audio ref={padAudioRefA} loop preload="auto" />
      <audio ref={padAudioRefB} loop preload="auto" />

      {/* HEADER */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/8 bg-black/60 px-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/6 text-zinc-400 transition-colors hover:bg-white/12 hover:text-white"
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </button>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-brand">Modo Live · Director</p>
            <h1 className="text-sm font-black leading-tight tracking-tight">{contextTitle}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Indicador Offline Automático */}
          {downloadStatus.active ? (
            <div className="flex items-center gap-2 rounded-full border border-zinc-500/30 bg-zinc-900 px-3 py-1" title="Descargando audios en segundo plano...">
              <CloudDownload className="h-3 w-3 animate-pulse text-zinc-400" />
              <span className="text-[10px] font-bold text-zinc-400">{downloadStatus.progress}/{downloadStatus.total}</span>
            </div>
          ) : downloadStatus.done ? (
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400" title="Setlist completo guardado en tu dispositivo">
              <CheckCircle2 className="h-3 w-3" /> OFFLINE
            </div>
          ) : null}
          {/* Indicador Sync */}
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">SYNC MASTER</span>
          </div>
        </div>
      </header>

      {/* BODY */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">

        {/* ── PANTALLA DE ORACIÓN ── */}
        {activeSong?.isPrayer && (
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl border border-amber-500/20 bg-[radial-gradient(ellipse_at_center,_rgba(245,158,11,0.12),_rgba(0,0,0,0))] shadow-2xl">
            {/* Fondo decorativo */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-5">
              <span className="text-[20rem] leading-none">🙏</span>
            </div>
            <div className="relative flex flex-col items-center gap-6 px-8 text-center">
              <span className="text-7xl">🙏</span>
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.3em] text-amber-500">Sección de Oración</p>
                <h2 className="text-3xl font-black text-white md:text-4xl">{activeSong.title}</h2>
              </div>
              {activeSong.prayerText && (
                <p className="max-w-lg text-lg font-medium leading-relaxed text-zinc-300/80 italic">
                  &ldquo;{activeSong.prayerText}&rdquo;
                </p>
              )}
              <p className="text-sm font-bold text-amber-500/60">
                {isPadActive ? '🎵 Pad ambiental activo' : 'Silencio'}
              </p>
            </div>

            {/* Botón Continuar */}
            <button
              type="button"
              onClick={handleNext}
              disabled={activeSongIndex >= playlist.length - 1}
              className="absolute bottom-6 right-6 flex items-center gap-2 rounded-2xl bg-amber-500 px-6 py-3 text-sm font-black text-zinc-950 shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 disabled:opacity-30"
            >
              Continuar
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* CANCIÓN ACTIVA — STAGE CARD */}
        <div className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/6 bg-zinc-900/60 shadow-2xl ${activeSong?.isPrayer ? 'hidden' : ''}`}>
          {/* Cover art blur background */}
          {activeCover && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <img src={activeCover} alt="" className="h-full w-full object-cover opacity-15 blur-3xl scale-110" />
              <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/40 via-zinc-900/80 to-zinc-900" />
            </div>
          )}
          {!activeCover && (
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-brand/8 to-transparent" />
          )}

          {/* Info canción */}
          <div className="relative flex items-start justify-between gap-4 p-5 pb-3">
            <div className="flex items-start gap-4 min-w-0">
              {/* Album art thumbnail */}
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-800 shadow-lg md:h-20 md:w-20">
                {activeCover ? (
                  <img src={activeCover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Disc3 className="h-8 w-8 text-zinc-600" />
                  </div>
                )}
                {isPlaying && activeCover && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <div className="h-3 w-3 animate-pulse rounded-full bg-brand shadow-[0_0_12px_rgba(59,130,246,0.6)]" />
                  </div>
                )}
              </div>
              <div className="min-w-0 pt-0.5">
                <div className="mb-1 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-brand/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-brand">
                    <Zap className="h-3 w-3" />
                    En Vivo
                  </span>
                  {activeSong?.bpm && (
                    <span className="rounded-md bg-white/6 px-2 py-0.5 text-[10px] font-bold tracking-widest text-zinc-400">
                      {activeSong.bpm} BPM
                    </span>
                  )}
                </div>
                <h2 className="truncate text-2xl font-black tracking-tight text-white md:text-3xl">
                  {activeSong?.title || 'Sin pistas'}
                </h2>
                <p className="mt-0.5 flex items-center gap-2 text-base font-medium text-zinc-400">
                  <span>{activeSong?.artist || 'Redil Worship'}</span>
                  {(activeSong?.originalKey || activeSong?.key) && (
                    <>
                      <span className="h-1 w-1 rounded-full bg-zinc-600" />
                      <span className="font-black text-white/70">{activeSong.originalKey || activeSong.key}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/6 text-sm font-black text-zinc-400">
              {String(activeSongIndex + 1).padStart(2, '0')}
            </div>
          </div>

          {/* TIMELINE VISUAL PROPORCIONAL — Ancho fiel a duración real */}
          {visualMarkers.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4">
              {/* Sección activa info banner */}
              {activeSectionIdx >= 0 && activeSectionIdx < visualMarkers.length && (() => {
                const activeVm = visualMarkers[activeSectionIdx];
                const rgbStr = activeVm.visual.rgb.join(', ');
                return (
                  <div
                    className="flex items-center gap-3 rounded-xl px-4 py-2.5 border shrink-0"
                    style={{
                      backgroundColor: `rgba(${rgbStr}, 0.12)`,
                      borderColor: `rgba(${rgbStr}, 0.25)`,
                    }}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-black"
                      style={{ backgroundColor: `rgba(${rgbStr}, 0.2)`, color: `rgb(${rgbStr})` }}
                    >
                      {activeVm.shortLabel}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black uppercase tracking-wider" style={{ color: `rgb(${rgbStr})` }}>
                        {activeVm.displayName}
                      </p>
                      <p className="text-[10px] font-bold tabular-nums text-zinc-500">
                        {formatTime(activeVm.startSec)} — {formatTime(activeVm.endSec)}
                      </p>
                    </div>
                    {loopedSectionIndex === activeSectionIdx && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-400">
                        <Repeat className="h-3 w-3 animate-pulse" /> Loop
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* HUD: Telemetría — Teleprompter + Cronómetro */}
              <div className="flex shrink-0 items-end justify-between gap-4 rounded-2xl border border-white/5 bg-zinc-900/30 p-4">
                {/* Teleprompter (Próxima Sección) */}
                <div className="min-w-0 flex-1">
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500">Próxima Sección</p>
                  {nextMarkerHUD ? (
                    <div className="flex items-center gap-3">
                      <span
                        className="shrink-0 rounded-md px-2 py-1 text-xs font-black uppercase shadow-sm"
                        style={{
                          backgroundColor: `rgba(${nextMarkerHUD.visual.rgb.join(',')}, 0.2)`,
                          color: `rgb(${nextMarkerHUD.visual.rgb.join(',')})`,
                        }}
                      >
                        {nextMarkerHUD.displayName}
                      </span>
                      {nextLyric && (
                        <p className="truncate text-base font-bold italic text-zinc-300">
                          &ldquo;{nextLyric}&rdquo;
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm font-bold text-zinc-600">Fin de la pista</p>
                  )}
                </div>

                {/* Cronómetro regresivo de la sección actual */}
                <div className="flex shrink-0 flex-col items-end">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Tiempo en {currentMarkerHUD?.displayName || 'Sección'}
                  </p>
                  <p className={`font-mono text-4xl font-black tracking-tighter ${
                    timeLeft > 0 && timeLeft <= 5 ? 'animate-pulse text-red-500' : 'text-white'
                  }`}>
                    {formatCountDown(timeLeft)}
                  </p>
                </div>
              </div>

              {/* Timeline horizontal proporcional con scroll */}
              <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div
                  className="relative flex h-full min-h-[7rem] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/50 shadow-inner"
                  style={{ width: `${Math.max(800, timelineDuration * 15)}px` }}
                >
                  <div className="absolute inset-0 flex">
                    {visualMarkers.map((vm, idx) => {
                      const isActive = activeSectionIdx === idx;
                      const isLooped = loopedSectionIndex === idx;
                      const rgbStr = vm.visual.rgb.join(', ');

                      return (
                        <div
                          key={`tl-${idx}`}
                          onClick={() => handleSeekSection(vm, idx)}
                          className="group relative h-full cursor-pointer border-r border-white/5 transition-all hover:brightness-125 overflow-hidden"
                          style={{
                            width: `${vm.widthPercent}%`,
                            minWidth: '75px',
                            backgroundColor: isActive ? `rgba(${rgbStr}, 0.25)` : `rgba(${rgbStr}, 0.04)`,
                            backgroundImage: OndaAudioPattern,
                            backgroundSize: '300px 100%',
                            backgroundPosition: `${-currentTime * 15}px 0`,
                            backgroundRepeat: 'repeat-x',
                            ...(isLooped ? { boxShadow: `inset 0 0 20px rgba(16,185,129,0.25), 0 0 12px rgba(16,185,129,0.15)` } : {}),
                          }}
                        >
                          {/* Borde superior grueso coloreado */}
                          <div
                            className="absolute inset-x-0 top-0 h-1.5 transition-all"
                            style={{ backgroundColor: `rgba(${rgbStr}, ${isActive ? '1' : '0.3'})` }}
                          />

                          {/* Botón de Loop Individual */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setLoopedSectionIndex(prev => prev === idx ? null : idx);
                            }}
                            className={`absolute right-2 top-3 p-1.5 rounded-lg transition-all z-20 ${
                              isLooped
                                ? 'bg-emerald-500 text-zinc-950 shadow-[0_0_15px_rgba(16,185,129,0.5)]'
                                : 'bg-black/20 text-white/40 opacity-0 group-hover:opacity-100 hover:bg-black/40 hover:text-white/80'
                            }`}
                            title={isLooped ? 'Desactivar Bucle' : 'Repetir Sección'}
                          >
                            <Repeat className="h-3.5 w-3.5" />
                          </button>

                          {/* Etiquetas */}
                          <div className="absolute left-2 top-3 flex flex-col items-start gap-1.5 z-10">
                            <span
                              className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[9px] font-black shadow-sm"
                              style={{
                                backgroundColor: `rgba(${rgbStr}, 0.15)`,
                                color: `rgb(${rgbStr})`,
                                border: `1px solid rgba(${rgbStr}, 0.4)`,
                              }}
                            >
                              {vm.shortLabel}
                            </span>
                            {vm.widthPercent > 3 && (
                              <span
                                className="truncate text-[10px] font-bold uppercase tracking-wider"
                                style={{ color: `rgb(${rgbStr})`, opacity: isActive ? 1 : 0.6 }}
                              >
                                {vm.displayName}
                              </span>
                            )}
                          </div>

                          {/* Timestamp al fondo */}
                          <span className="absolute bottom-1.5 left-2 text-[8px] font-bold tabular-nums text-zinc-600">
                            {formatTime(vm.startSec)}
                          </span>

                          {/* Active glow bottom */}
                          {isActive && (
                            <span
                              className="absolute inset-x-0 bottom-0 h-1"
                              style={{ backgroundColor: `rgba(${rgbStr}, 0.8)` }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Playhead */}
                  {duration > 0 && (
                    <div
                      className="absolute bottom-0 top-0 z-30 w-[2px] bg-white shadow-[0_0_15px_rgba(255,255,255,0.8)] pointer-events-none"
                      style={{ left: `${playheadPercent}%` }}
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center pb-8">
              <div className="text-center">
                <Music2 className="mx-auto mb-3 h-10 w-10 text-zinc-700" />
                <p className="text-sm font-bold text-zinc-500">Sin marcadores de sección</p>
              </div>
            </div>
          )}
        </div>

        {/* SETLIST HORIZONTAL */}
        <div className="flex h-[5.5rem] shrink-0 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {playlist.length === 0 ? (
            <div className="flex w-full items-center justify-center rounded-2xl border border-white/6 bg-zinc-900/40">
              <p className="text-xs font-bold text-zinc-600">No hay pistas con MP3</p>
            </div>
          ) : playlist.map((song, idx) => {
            const isActive = idx === activeSongIndex;
            const isPrev = idx < activeSongIndex;

            // Prayer section card
            if (song?.isPrayer) {
              return (
                <button
                  key={song.id || `prayer-${idx}`}
                  type="button"
                  onClick={() => setActiveSongIndex(idx)}
                  className={`relative flex w-44 shrink-0 items-center gap-3 overflow-hidden rounded-2xl border px-3 text-left transition-all ${
                    isActive
                      ? 'border-amber-500/40 bg-amber-500/12 shadow-[0_0_24px_rgba(251,191,36,0.15)]'
                      : isPrev
                      ? 'border-amber-900/20 bg-amber-900/5 opacity-40'
                      : 'border-amber-900/20 bg-amber-900/10 hover:bg-amber-900/20 hover:border-amber-500/20'
                  }`}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-2xl">
                    🙏
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className={`block text-[9px] font-black uppercase tracking-[0.24em] ${isActive ? 'text-amber-400' : 'text-amber-700'}`}>
                      {isActive ? '▶ Oración' : 'Oración'}
                    </span>
                    <span className={`block truncate text-sm font-black ${isActive ? 'text-amber-200' : 'text-amber-400/70'}`}>
                      {song.title || 'Momento de Oración'}
                    </span>
                  </div>
                </button>
              );
            }

            const songCover = song?.mp3 ? coverArts[song.mp3] : null;
            return (
              <button
                key={song.id || idx}
                type="button"
                onClick={() => setActiveSongIndex(idx)}
                className={`relative flex w-56 shrink-0 items-center gap-3 overflow-hidden rounded-2xl border px-3 text-left transition-all ${
                  isActive
                    ? 'border-brand/40 bg-brand/12 shadow-[0_0_24px_rgba(59,130,246,0.18)]'
                    : isPrev
                    ? 'border-white/4 bg-white/2 opacity-40'
                    : 'border-white/5 bg-zinc-900/50 hover:bg-zinc-900/80 hover:border-white/10'
                }`}
              >
                {/* Mini album art */}
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-white/8 bg-zinc-800">
                  {songCover ? (
                    <img src={songCover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-zinc-600">
                      <Disc3 className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className={`block text-[9px] font-black uppercase tracking-[0.24em] ${isActive ? 'text-brand' : 'text-zinc-600'}`}>
                    {isActive ? '▶ Reproduciendo' : idx === activeSongIndex + 1 ? 'Siguiente' : `Pista ${idx + 1}`}
                  </span>
                  <span className={`block truncate text-sm font-black ${isActive ? 'text-white' : 'text-zinc-300'}`}>
                    {song.title}
                  </span>
                  {(song.originalKey || song.key) && (
                    <span className={`block text-[10px] font-bold ${isActive ? 'text-zinc-400' : 'text-zinc-600'}`}>
                      {song.originalKey || song.key}
                      {song.bpm ? ` · ${song.bpm} BPM` : ''}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* FOOTER — TRANSPORTE + TIMELINE */}
      <footer className="shrink-0 border-t border-white/8 bg-black/70 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl">
        {/* Timeline / seek bar con secciones coloreadas */}
        <div className="mb-3 flex items-center gap-3">
          <span className="w-10 text-right text-[11px] font-bold tabular-nums text-zinc-500">{formatTime(currentTime)}</span>
          <div
            ref={timelineRef}
            role="slider"
            aria-label="Progreso de la canción"
            aria-valuenow={Math.round(progressPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            tabIndex={0}
            onClick={handleTimelineClick}
            className="relative h-2 flex-1 cursor-pointer overflow-hidden rounded-full bg-white/8"
          >
            {/* Bloques de sección coloreados en el footer timeline */}
            {visualMarkers.length > 0 && duration > 0 && visualMarkers.map((vm, i) => (
              <span
                key={`ft-${i}`}
                className="absolute top-0 h-full"
                style={{
                  left: `${(vm.startSec / duration) * 100}%`,
                  width: `${vm.widthPercent}%`,
                  backgroundColor: toRgba(vm.visual.rgb, i === activeSectionIdx ? 0.35 : 0.15),
                  borderRight: i < visualMarkers.length - 1 ? '1px solid rgba(0,0,0,0.3)' : 'none',
                }}
              />
            ))}
            {/* Progress */}
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-brand/80 transition-none"
              style={{ width: `${progressPercent}%` }}
            />
            {/* Thumb */}
            <span
              className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow-lg transition-none"
              style={{ left: `calc(${progressPercent}% - 7px)` }}
            />
          </div>
          <span className="w-10 text-[11px] font-bold tabular-nums text-zinc-500">{formatTime(duration)}</span>
        </div>

        {/* Controles */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {/* Mezcladora izquierda: Pista + Pad (dos filas etiquetadas) */}
          <div className="flex flex-col gap-1.5 w-36">
            {/* Fila 1: Volumen pista */}
            <div className="flex items-center gap-1.5">
              <Volume2 className="h-3 w-3 shrink-0 text-zinc-500" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-brand"
                aria-label="Volumen pista"
              />
              <span className="w-7 text-right text-[8px] font-bold tabular-nums text-zinc-600">{Math.round(volume * 100)}</span>
            </div>
            {/* Fila 2: Pad ON/OFF + volumen inline */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsPadActive(!isPadActive)}
                className={`flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[8px] font-black uppercase tracking-wider transition-all ${
                  isPadActive
                    ? 'bg-emerald-500 text-zinc-950 shadow-[0_0_10px_rgba(16,185,129,0.35)]'
                    : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
                }`}
              >
                <Waves className="h-2.5 w-2.5" />
                {isPadActive ? (activeSong?.originalKey || activeSong?.key || 'ON') : 'Pad'}
              </button>
              {isPadActive ? (
                <>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={padVolume}
                    onChange={(e) => setPadVolume(Number(e.target.value))}
                    className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-500"
                    aria-label="Volumen pad"
                  />
                  <span className="w-7 text-right text-[8px] font-bold tabular-nums text-emerald-500">{Math.round(padVolume * 100)}</span>
                </>
              ) : (
                <span className="text-[8px] text-zinc-600">OFF</span>
              )}
            </div>
          </div>

          {/* Controles centrales */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={activeSongIndex === 0 && currentTime <= 3}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/6 text-zinc-300 transition-colors hover:bg-white/12 hover:text-white disabled:opacity-30"
              aria-label="Anterior"
            >
              <SkipBack className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={handleTogglePlay}
              disabled={!activeSourceUrl}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-[0_0_32px_rgba(59,130,246,0.5)] transition-all hover:scale-105 hover:bg-brand/90 disabled:opacity-30 disabled:shadow-none"
              aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
            >
              {isPlaying
                ? <Pause className="h-7 w-7" />
                : <Play className="ml-1 h-7 w-7" />
              }
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={activeSongIndex >= playlist.length - 1}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/6 text-zinc-300 transition-colors hover:bg-white/12 hover:text-white disabled:opacity-30"
              aria-label="Siguiente"
            >
              <SkipForward className="h-5 w-5" />
            </button>
          </div>

          {/* Pista + Ruteo (Menú desplegable) + Siguiente */}
          <div className="relative flex flex-col items-end gap-1.5" ref={routeMenuRef}>
            {/* Botón que abre el menú */}
            <button
              type="button"
              onClick={() => setShowRouteMenu(prev => !prev)}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-800/80 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-300 transition-all hover:bg-zinc-700 hover:text-white"
            >
              <ListMusic className="h-3.5 w-3.5" />
              <span className="max-w-[80px] truncate">{activeSource?.label || 'Original'}</span>
              <ChevronUp className={`h-3 w-3 transition-transform ${showRouteMenu ? '' : 'rotate-180'}`} />
            </button>

            {/* Menú desplegable unificado */}
            {showRouteMenu && (
              <div className="absolute bottom-full right-0 z-50 mb-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-2xl shadow-black/60">
                {/* Sección: Fuente de audio */}
                <p className="border-b border-white/5 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  Fuente de Audio
                </p>
                {playbackSources.map((source) => {
                  const isSel = selectedSourceId === source.id;
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => { setSelectedSourceId(source.id); }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        isSel ? 'bg-brand/15 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                      }`}
                    >
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-black ${
                        isSel ? 'bg-brand text-white' : 'bg-white/8 text-zinc-500'
                      }`}>
                        {source.kind === 'original' ? '♪' : 'S'}
                      </span>
                      <span className="truncate text-xs font-bold">{source.label}</span>
                      {isSel && <span className="ml-auto text-[10px] text-brand">●</span>}
                    </button>
                  );
                })}

                {/* Sección: Ruteo L/C/R */}
                <p className="border-y border-white/5 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  Ruteo de Salida
                </p>
                {[
                  { val: -1, label: 'Click (Izquierda)', badge: 'L' },
                  { val: 0,  label: 'Estéreo (Centro)', badge: 'C' },
                  { val: 1,  label: 'Pistas (Derecha)', badge: 'R' },
                ].map(({ val, label, badge }) => {
                  const isActive = panValue === val;
                  return (
                    <button
                      key={`pan-${val}`}
                      type="button"
                      onClick={() => { setPanValue(val); setShowRouteMenu(false); }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        isActive ? 'bg-brand/15 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                      }`}
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-black ${
                        isActive ? 'bg-brand text-white' : 'bg-white/8 text-zinc-500'
                      }`}>
                        {badge}
                      </span>
                      <span className="text-xs font-bold">{label}</span>
                      {isActive && <span className="ml-auto text-[10px] text-brand">●</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Info siguiente */}
            {playlist[activeSongIndex + 1] && (
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 text-right">
                  <p className="text-[8px] font-bold uppercase tracking-widest text-zinc-600">Siguiente</p>
                  <p className="truncate text-[10px] font-black text-zinc-500 max-w-[100px]">{playlist[activeSongIndex + 1].title}</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              </div>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
