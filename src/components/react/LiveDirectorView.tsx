import {
  AlertTriangle,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  EyeOff,
  FolderOpen,
  ListMusic,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  SkipBack,
  SlidersVertical,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useMultitrackEngine } from '../../hooks/useMultitrackEngine';
import { useNativeIOSMultitrackEngine } from '../../hooks/useNativeIOSMultitrackEngine';
import type { SongStructure, TrackData } from '../../services/MultitrackEngine';
import {
  isNativeLiveDirectorEngineAvailable,
  NativeLiveDirectorEngine,
} from '../../services/NativeLiveDirectorEnginePlugin';
import {
  createSequenceSessionFromFile,
  createStemSessionFromFolder,
  inferStemTracksFromFiles,
  type LiveDirectorResolvedSession,
} from '../../utils/liveDirectorSessionLoader';
import type {
  LiveDirectorPersistedSession,
  LiveDirectorSectionVisual,
} from '../../utils/liveDirectorSongSession';
import { applyLiveDirectorSectionOffset } from '../../utils/liveDirectorSongSession';
import {
  sampleActivityEnvelope,
  type TrackActivityEnvelope,
} from '../../utils/audioActivityEnvelope';
import {
  deleteLiveDirectorSongSession,
  requestLiveDirectorUploadTarget,
  saveLiveDirectorSongSession,
  uploadFileToLiveDirectorTarget,
} from '../../utils/liveDirectorUploadClient';
import {
  isGuideRoutingTrack,
  resolveTrackOutputRoute,
  toggleGuideTrackOutputRoute,
  type TrackOutputRoute,
} from '../../utils/liveDirectorTrackRouting';
import { getPadUrlForSongKey } from '../../utils/padAudio';

type MixerTrackMeta = {
  id: string;
  label: string;
  shortLabel: string;
  accent: string;
  defaultVolume: number;
};

type SectionVisual = SongStructure & {
  id: string;
  shortLabel: string;
  accent: string;
  surface: string;
  border: string;
};

type SectionLaneSegment = {
  section: LiveDirectorSectionVisual;
  waveBars: number[];
  widthPx: number;
  leftPx: number;
  // Precomputed style variants so the render map doesn't rebuild these
  // objects on every visual-clock tick. `activeStyle` is used when the
  // segment is the currently-playing section; `inactiveStyle` otherwise.
  activeStyle: CSSProperties;
  inactiveStyle: CSSProperties;
};

type DragScrollState = {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startScrollLeft: number;
};

type FaderInteractionState = {
  active: boolean;
  pointerId: number | null;
  mode: 'pending' | 'volume' | 'scroll';
  startX: number;
  startY: number;
  startScrollLeft: number;
  scrollContainer: HTMLElement | null;
};

type SurfaceView = 'mix' | 'sections';
type LiveDirectorMode = 'director' | 'ensayo';
type LiveDirectorEngineSurface = 'web' | 'ios-native';

type LiveDirectorQueueSong = {
  id: string;
  title: string;
  subtitle?: string;
  mp3?: string;
};

type LiveDirectorOperationalChip = {
  id: string;
  label: string;
  value: string;
  tone?: 'neutral' | 'info' | 'success';
  active?: boolean;
};

type LiveDirectorPlaybackSnapshot = {
  songId: string;
  sectionIndex: number;
  currentTime: number;
  currentTimeRaw?: number;
  sectionOffsetSeconds?: number;
  isPlaying: boolean;
};

type CapacitorBridgeLike = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};

type WindowWithCapacitor = Window & typeof globalThis & {
  Capacitor?: CapacitorBridgeLike;
};

type LiveDirectorSessionSavePayload = Omit<
  LiveDirectorPersistedSession,
  'folder' | 'manifestUrl' | 'updatedAt' | 'songId' | 'songTitle' | 'version'
>;

type PendingLiveDirectorSessionSave = {
  songId: string;
  payload: LiveDirectorSessionSavePayload;
};

type LiveDirectorViewProps = {
  tracks?: TrackData[];
  sections?: Array<SectionVisual | LiveDirectorSectionVisual>;
  title?: string;
  subtitle?: string;
  bpm?: number;
  className?: string;
  songId?: string;
  songTitle?: string;
  songMp3?: string;
  songKey?: string;
  initialSession?: LiveDirectorPersistedSession | null;
  requiresSongContext?: boolean;
  mode?: LiveDirectorMode;
  engineSurface?: LiveDirectorEngineSurface;
  maxWebActiveTracks?: number;
  queueSongs?: LiveDirectorQueueSong[];
  activeQueueSongId?: string;
  onSelectQueueSong?: (songId: string) => void;
  operationalChips?: LiveDirectorOperationalChip[];
  internalPadVolume?: number;
  onInternalPadVolumeChange?: (volume: number) => void;
  onPlaybackSnapshot?: (snapshot: LiveDirectorPlaybackSnapshot) => void;
  onSessionPersisted?: (session: LiveDirectorPersistedSession) => void;
  onBack?: () => void;
};

// Per-platform active stem caps. Going past these on the target device
// causes audible slipping ("patinar") on the weaker hardware because the
// mixer can't meet the I/O deadline. Limits are empirically grounded:
//   - iOS native (AVAudioEngine):     14 stems with internal pad on real iPhone
//   - Android web (Capacitor browser): 10 stems before clocks drift
//   - Desktop web (Chrome/Edge/FF):    15 stems
// Changing these requires re-profiling on real devices.
const IOS_NATIVE_MAX_ACTIVE_TRACKS = 14;
const ANDROID_MAX_ACTIVE_TRACKS = 10;
const WEB_ENGINE_MAX_ACTIVE_TRACKS = 15;
const INTERNAL_PAD_TRACK_ID = '__internal-pad__';
// The internal pad masters are intentionally lush, but their raw gain is too hot
// for live control. Apply a fixed -8 dB trim before the pad reaches either engine.
const INTERNAL_PAD_GAIN_TRIM = Math.pow(10, -8 / 20);

// Priority buckets for auto-disabling extras when a session has more
// enabled stems than the platform can run. Lower number = more important
// (kept in the mix). Names are matched case-insensitively; anything not
// matched falls into the generic bucket and loses ties to recognized
// roles. The list mirrors the roles that are essential for live worship:
// click → guide → rhythm section → voices → harmonic → colour.
const STEM_PRIORITY_RULES: Array<{ rank: number; pattern: RegExp }> = [
  { rank: 0, pattern: /\b(click|metronom[oe]?)\b/i },
  { rank: 1, pattern: /\b(gu[ií]a|guide|cue|count[- ]?in|count)\b/i },
  { rank: 2, pattern: /\b(bater[ií]a|drum|kick|snare|toms?|overhead|cymbal|hi-?hat|hat|percu)/i },
  { rank: 3, pattern: /\b(bajo|bass)\b/i },
  { rank: 4, pattern: /\b(voz|lead|vocal|voice|singer)\b/i },
  { rank: 5, pattern: /\b(coros?|backing|bv|harmon[ií]a|harmony)\b/i },
  { rank: 6, pattern: /\b(piano|keys?|rhodes|organ[oa]?|synth|wurl)\b/i },
  { rank: 7, pattern: /\b(guit(arra)?|gtr|ac[uú]stica|el[eé]ctrica)\b/i },
  { rank: 8, pattern: /\b(pad|strings?|cuerda|orchestr|viol)/i },
  { rank: 9, pattern: /\b(fx|sfx|efecto|effect)/i },
];

function stemPriorityRank(track: { name?: string; label?: string; id?: string }): number {
  const haystack = `${track.label ?? ''} ${track.name ?? ''} ${track.id ?? ''}`.toLowerCase();
  for (const rule of STEM_PRIORITY_RULES) {
    if (rule.pattern.test(haystack)) return rule.rank;
  }
  return 10;
}
const FADER_AXIS_LOCK_THRESHOLD_PX = 7;

const getStableTrackPhaseMs = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 1200;
  }
  return hash;
};

type ChannelStripProps = {
  id: string;
  label: string;
  shortLabel: string;
  accent: string;
  volume: number;
  level: number;
  isPlaying: boolean;
  muted: boolean;
  soloed: boolean;
  dimmed: boolean;
  disabled: boolean;
  outputRoute?: TrackOutputRoute;
  showRouteFlip?: boolean;
  compact?: boolean;
  ultraCompact?: boolean;
  onVolumeChange: (volume: number) => void;
  onMute: () => void;
  onSolo: () => void;
  onToggleOutputRoute?: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
};

type MixerTrackView = MixerTrackMeta & {
  volume: number;
  level: number;
  muted: boolean;
  soloed: boolean;
  dimmed: boolean;
  disabled: boolean;
  outputRoute: TrackOutputRoute;
  showRouteFlip: boolean;
};

const MIXER_TRACKS: MixerTrackMeta[] = [
  { id: 'click', label: 'Click', shortLabel: 'CLK', accent: '#5ccfe6', defaultVolume: 0.34 },
  { id: 'guide', label: 'Guide', shortLabel: 'GDE', accent: '#73d1f8', defaultVolume: 0.72 },
  { id: 'cues', label: 'Cues', shortLabel: 'CUE', accent: '#95b7ff', defaultVolume: 0.62 },
  { id: 'drums', label: 'Drums', shortLabel: 'DRM', accent: '#66d4f0', defaultVolume: 0.83 },
  { id: 'percussion', label: 'Percussion', shortLabel: 'PRC', accent: '#80d7e6', defaultVolume: 0.72 },
  { id: 'bass', label: 'Bass', shortLabel: 'BSS', accent: '#7bd8ef', defaultVolume: 0.76 },
  { id: 'synth-bass', label: 'Synth Bass', shortLabel: 'SB', accent: '#73dfe9', defaultVolume: 0.7 },
  { id: 'acoustic-gtr', label: 'Acoustic Gtr', shortLabel: 'AG', accent: '#6ed0eb', defaultVolume: 0.69 },
  { id: 'electric-gtr', label: 'Electric Gtr', shortLabel: 'EG', accent: '#77d9f4', defaultVolume: 0.63 },
  { id: 'keys', label: 'Keys', shortLabel: 'KEY', accent: '#81ddf5', defaultVolume: 0.74 },
  { id: 'piano', label: 'Piano', shortLabel: 'PNO', accent: '#8be1fb', defaultVolume: 0.72 },
  { id: 'organ', label: 'Organ', shortLabel: 'ORG', accent: '#7ed8e7', defaultVolume: 0.68 },
  { id: 'pad', label: 'Pad', shortLabel: 'PAD', accent: '#99c6ff', defaultVolume: 0.66 },
  { id: 'strings', label: 'Strings', shortLabel: 'STR', accent: '#a992ff', defaultVolume: 0.66 },
  { id: 'synth', label: 'Synth', shortLabel: 'SYN', accent: '#8fe1ff', defaultVolume: 0.68 },
  { id: 'background-vocals', label: 'Background Vocals', shortLabel: 'BGV', accent: '#f29fd3', defaultVolume: 0.78 },
  { id: 'choir', label: 'Choir', shortLabel: 'CHR', accent: '#ffb2d0', defaultVolume: 0.76 },
];

const DEFAULT_SECTIONS: SectionVisual[] = [
  { id: 'intro', name: 'Intro', shortLabel: 'I', startTime: 0, endTime: 4, accent: '#7cc7ea', surface: 'rgba(33, 42, 48, 0.9)', border: 'rgba(124, 199, 234, 0.25)' },
  { id: 'verse-1', name: 'Verse 1', shortLabel: 'V1', startTime: 4, endTime: 8, accent: '#a768ea', surface: 'rgba(33, 27, 39, 0.92)', border: 'rgba(167, 104, 234, 0.26)' },
  { id: 'pre', name: 'Pre', shortLabel: 'P', startTime: 8, endTime: 11.5, accent: '#9b7cff', surface: 'rgba(32, 26, 40, 0.92)', border: 'rgba(155, 124, 255, 0.26)' },
  { id: 'chorus', name: 'Chorus', shortLabel: 'Co', startTime: 11.5, endTime: 15.5, accent: '#63d8e5', surface: 'rgba(28, 36, 40, 0.92)', border: 'rgba(99, 216, 229, 0.24)' },
  { id: 'bridge', name: 'Bridge', shortLabel: 'Br', startTime: 15.5, endTime: 20, accent: '#af71f3', surface: 'rgba(34, 26, 42, 0.92)', border: 'rgba(175, 113, 243, 0.28)' },
  { id: 'tag', name: 'Tag', shortLabel: 'T', startTime: 20, endTime: 24, accent: '#68d2f2', surface: 'rgba(30, 37, 43, 0.92)', border: 'rgba(104, 210, 242, 0.22)' },
];

const SECTION_LANE_PIXELS_PER_SECOND = 20;
const SECTION_LANE_MIN_WIDTH_PX = 118;
const SECTION_LANE_GAP_PX = 14;
const SECTION_LANE_PLAYHEAD_MIN_OFFSET_PX = 92;
const SECTION_LANE_PLAYHEAD_MAX_OFFSET_PX = 360;
const SECTION_WAVE_BAR_WIDTH_PX = 6;
const SECTION_WAVE_BAR_GAP_PX = 4;
const SECTION_WAVE_BAR_INSET_PX = 16;
const SECTION_WAVE_BAR_MIN_COUNT = 7;
const SECTION_TRANSITION_FADE_OUT_MS = 170;
const SECTION_TRANSITION_FADE_IN_MS = 180;
const SEQUENCE_FILE_ACCEPT = '.aac,.m4a,audio/aac,audio/mp4,audio/x-m4a,audio/*';

const CONTROL_CARD =
  'ui-pressable-soft flex items-center justify-center rounded-[1.55rem] border border-white/8 bg-[linear-gradient(180deg,rgba(26,27,29,0.96),rgba(17,18,20,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_24px_40px_rgba(0,0,0,0.25)] transition-all duration-200';

const GENERIC_TRACK_ACCENTS = ['#81ddf5', '#7ed8e7', '#9f7cff', '#43c477', '#c98bff', '#73d1f8'];
const TRACK_META_BY_ID = new Map(MIXER_TRACKS.map((track) => [track.id, track]));
const coverArtCache = new Map<string, string | null>();

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const formatClock = (timeInSeconds: number) => {
  const safeValue = Math.max(0, Math.floor(timeInSeconds));
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatCompact = (timeInSeconds: number) => {
  const safeValue = Math.max(0, Math.floor(timeInSeconds));
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatMemoryValue = (bytes: number | null) => {
  if (!Number.isFinite(bytes) || bytes === null || bytes <= 0) {
    return 'n/a';
  }

  const megaBytes = bytes / (1024 * 1024);

  if (megaBytes >= 100) {
    return `${Math.round(megaBytes)} MB`;
  }

  if (megaBytes >= 10) {
    return `${megaBytes.toFixed(1)} MB`;
  }

  return `${megaBytes.toFixed(2)} MB`;
};

const formatDeviceMemoryValue = (gigabytes: number | null) => {
  if (!Number.isFinite(gigabytes) || gigabytes === null || gigabytes <= 0) {
    return 'n/a';
  }

  return `${gigabytes} GB`;
};

const shouldIgnoreDragScrollTarget = (target: EventTarget | null) => {
  return target instanceof Element &&
    Boolean(
      target.closest(
        'button, input, a, label, textarea, select, [role="button"], [role="slider"], [data-no-drag-scroll="true"]',
      ),
    );
};

const shouldIgnoreKeyboardShortcutTarget = (target: EventTarget | null) => {
  return target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, button, a, [contenteditable="true"], [role="textbox"], [data-live-director-shortcuts="off"]',
      ),
    );
};

const extractCoverArtFromMp3 = async (mp3Url: string): Promise<string | null> => {
  if (!mp3Url) {
    return null;
  }

  if (coverArtCache.has(mp3Url)) {
    return coverArtCache.get(mp3Url) || null;
  }

  try {
    const response = await fetch(mp3Url, {
      headers: { Range: 'bytes=0-524287' },
      mode: 'cors',
    });

    if (!response.ok) {
      coverArtCache.set(mp3Url, null);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const view = new DataView(buffer);

    if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
      coverArtCache.set(mp3Url, null);
      return null;
    }

    const majorVersion = view.getUint8(3);
    const tagSize =
      ((view.getUint8(6) & 0x7f) << 21) |
      ((view.getUint8(7) & 0x7f) << 14) |
      ((view.getUint8(8) & 0x7f) << 7) |
      (view.getUint8(9) & 0x7f);

    const tagEnd = Math.min(10 + tagSize, buffer.byteLength);
    let offset = 10;
    const flags = view.getUint8(5);

    if (flags & 0x40 && offset + 4 < tagEnd) {
      offset += view.getUint32(offset);
    }

    while (offset + 10 < tagEnd) {
      const frameId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
      );

      const frameSize =
        majorVersion >= 4
          ? ((view.getUint8(offset + 4) & 0x7f) << 21) |
          ((view.getUint8(offset + 5) & 0x7f) << 14) |
          ((view.getUint8(offset + 6) & 0x7f) << 7) |
          (view.getUint8(offset + 7) & 0x7f)
          : view.getUint32(offset + 4);

      if (frameSize <= 0 || frameSize > tagEnd - offset) {
        break;
      }

      if (frameId === 'APIC') {
        const frameData = new Uint8Array(buffer, offset + 10, frameSize);
        const encoding = frameData[0];
        let position = 1;
        let mimeType = '';

        while (position < frameData.length && frameData[position] !== 0) {
          mimeType += String.fromCharCode(frameData[position]);
          position += 1;
        }

        position += 1;
        position += 1;

        if (encoding === 0 || encoding === 3) {
          while (position < frameData.length && frameData[position] !== 0) {
            position += 1;
          }
          position += 1;
        } else {
          while (
            position + 1 < frameData.length &&
            !(frameData[position] === 0 && frameData[position + 1] === 0)
          ) {
            position += 2;
          }
          position += 2;
        }

        const imageData = frameData.slice(position);
        if (imageData.length < 100) {
          break;
        }

        const blob = new Blob([imageData], { type: mimeType || 'image/jpeg' });
        const blobUrl = URL.createObjectURL(blob);
        coverArtCache.set(mp3Url, blobUrl);
        return blobUrl;
      }

      offset += 10 + frameSize;
    }

    coverArtCache.set(mp3Url, null);
    return null;
  } catch (error) {
    console.warn('[LiveDirectorView] Could not extract cover art.', error);
    coverArtCache.set(mp3Url, null);
    return null;
  }
};

const buildWaveBars = (seed: number, count = 24) =>
  Array.from({ length: count }, (_, index) => {
    const value = Math.abs(Math.sin((index + 1) * (seed + 1) * 0.58));
    return 18 + value * 72;
  });

const getTrackBaseId = (trackId: string) => trackId.replace(/-\d+$/, '');

const buildShortTrackLabel = (value: string) => {
  const words = String(value || '')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return 'TRK';
  }

  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }

  return words
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
};

const buildMixerTrackMeta = (
  track: Pick<TrackData, 'id' | 'name' | 'volume'>,
  index: number,
): MixerTrackMeta => {
  const baseId = getTrackBaseId(track.id);
  const knownMeta = TRACK_META_BY_ID.get(baseId);

  if (knownMeta) {
    return {
      ...knownMeta,
      id: track.id,
      label: track.name || knownMeta.label,
    };
  }

  return {
    id: track.id,
    label: track.name || `Track ${index + 1}`,
    shortLabel: buildShortTrackLabel(track.name || track.id),
    accent: GENERIC_TRACK_ACCENTS[index % GENERIC_TRACK_ACCENTS.length],
    defaultVolume: track.volume,
  };
};

const buildTrackOutputRouteMap = (
  tracks: Array<Pick<TrackData, 'id' | 'name' | 'outputRoute'>>,
): Record<string, TrackOutputRoute> => (
  tracks.reduce<Record<string, TrackOutputRoute>>((routes, track) => {
    routes[track.id] = resolveTrackOutputRoute(track);
    return routes;
  }, {})
);

const toResolvedSession = (
  session: LiveDirectorPersistedSession,
): LiveDirectorResolvedSession => ({
  mode: session.mode,
  sessionLabel: session.songTitle || 'Saved Session',
  tracks: session.tracks.map((track) => ({
    id: track.id,
    name: track.name,
    url: track.url,
    iosUrl: track.iosUrl,
    nativeUrl: track.nativeUrl,
    optimizedUrl: track.optimizedUrl,
    cafUrl: track.cafUrl,
    pcmUrl: track.pcmUrl,
    volume: track.volume,
    isMuted: track.isMuted,
    enabled: track.enabled !== false,
    sourceFileName: track.sourceFileName,
    outputRoute: resolveTrackOutputRoute(track),
    activityEnvelope: track.activityEnvelope,
  })),
  objectUrls: [],
  unmatchedFiles: session.unmatchedFiles || [],
  sectionOffsetSeconds: Number.isFinite(Number(session.sectionOffsetSeconds))
    ? Number(session.sectionOffsetSeconds)
    : 0,
});

function FaderThumb({
  accent,
  level = 0,
  muted = false,
  className = '',
  style,
}: {
  accent: string;
  level?: number;
  muted?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const highlightColor = muted ? 'rgba(161, 169, 181, 0.62)' : accent;
  const lineOpacity = muted ? 0.34 : 0.36 + level * 0.64;
  const lineScale = 0.78 + level * 0.34;
  const lineGlow = muted ? '0 0 0 transparent' : `0 0 ${12 + level * 14}px currentColor`;

  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 rounded-[1.05rem] border border-white/8 bg-[linear-gradient(180deg,rgba(24,25,27,0.99),rgba(16,17,19,0.99))] ${className}`}
      style={style}
    >
      <div className="absolute inset-x-2 top-1.5 h-2 rounded-full bg-white/[0.045]" />
      <div className="absolute bottom-1.5 left-3 right-3 h-[2px] rounded-full bg-black/35" />
      <div className="absolute left-3 top-3 bottom-3 w-px rounded-full bg-white/10" />
      <div className="absolute right-3 top-3 bottom-3 w-px rounded-full bg-white/10" />
      <div className="absolute inset-2 rounded-[0.82rem] border border-white/4 bg-[repeating-linear-gradient(180deg,rgba(255,255,255,0.045)_0px,rgba(255,255,255,0.045)_2px,transparent_2px,transparent_5px)]" />
      <div
        className="absolute inset-x-3 top-1/2 h-[2px] -translate-y-1/2 rounded-full transition-[opacity,transform,box-shadow] duration-100"
        style={{
          backgroundColor: highlightColor,
          color: highlightColor,
          opacity: lineOpacity,
          transform: `translateY(-50%) scaleX(${lineScale})`,
          boxShadow: lineGlow,
        }}
      />
    </div>
  );
}

const ChannelStrip = memo(function ChannelStrip({
  id,
  label,
  shortLabel,
  accent,
  volume,
  level,
  isPlaying,
  muted,
  soloed,
  dimmed,
  disabled,
  outputRoute = 'stereo',
  showRouteFlip = false,
  compact = false,
  ultraCompact = false,
  onVolumeChange,
  onMute,
  onSolo,
  onToggleOutputRoute,
  onInteractionStart,
  onInteractionEnd,
}: ChannelStripProps) {
  const [draftVolume, setDraftVolume] = useState<number | null>(null);
  const displayVolume = draftVolume ?? volume;
  const displayLevel = muted ? 0 : clamp(level);
  const hasLiveSignal = displayLevel > 0.002;
  const isAudiblyActive = isPlaying && !muted && !dimmed && !disabled && displayVolume > 0.015 && hasLiveSignal;
  const visualActivityLevel = displayLevel > 0.002
    ? displayLevel
    : 0;
  const levelBottom = `${10 + displayVolume * 78}%`;
  const knobGlow = muted ? 'rgba(120, 128, 140, 0.15)' : `${accent}30`;
  const meterHeightPercent = visualActivityLevel > 0.002 ? Math.max(5, visualActivityLevel * 86) : 0;
  const meterOpacity = muted
    ? 0.16
    : hasLiveSignal
      ? 0.28 + displayLevel * 0.54
      : 0.12;
  const meterGlow = muted
    ? '0 0 0 transparent'
    : isAudiblyActive
      ? `0 0 ${12 + visualActivityLevel * 20}px ${accent}4a`
      : `0 0 ${10 + displayLevel * 18}px ${accent}42`;
  const breathStrength = clamp(displayLevel, 0.22, 1);
  // Memoize the CSS-var bag so React doesn't reconcile a brand-new style
  // object on every visual-clock tick. The delay only depends on `id`, so
  // cache the per-track phase string separately and let `breathStrength`
  // drive intensity without trashing the rest of the object.
  const trackBreathDelay = useMemo(
    () => `${-(getStableTrackPhaseMs(id) / 1000).toFixed(2)}s`,
    [id],
  );
  const trackBreathStyle = useMemo<CSSProperties>(
    () => ({
      '--track-accent': accent,
      '--track-breath-strength': String(breathStrength),
      '--track-breath-delay': trackBreathDelay,
    } as CSSProperties),
    [accent, breathStrength, trackBreathDelay],
  );
  const shellRadiusClass = ultraCompact ? 'rounded-[0.75rem]' : compact ? 'rounded-[0.85rem]' : 'rounded-[1.2rem]';
  const shellPaddingClass = ultraCompact ? 'px-0.75 pb-0.75 pt-0.85' : compact ? 'px-1.25 pb-1.25 pt-0.95' : 'px-3.5 pb-4 pt-3';
  const topControlsClass = showRouteFlip
    ? ultraCompact
      ? 'mb-1 grid w-full max-w-[9.35rem] grid-cols-[minmax(0,1fr)_minmax(2.25rem,1fr)_minmax(0,1fr)] items-center gap-1.5 px-0.25'
      : compact
        ? 'mb-1.5 grid w-full max-w-[10.5rem] grid-cols-[minmax(0,1fr)_minmax(2.5rem,1fr)_minmax(0,1fr)] items-center gap-2 px-0.25'
        : 'mb-2 flex w-full max-w-[8.5rem] items-center justify-between gap-1.5'
    : ultraCompact
      ? 'mb-1 grid w-full max-w-[6.35rem] grid-cols-2 items-center gap-1.5 px-0.25'
      : compact
        ? 'mb-1.5 grid w-full max-w-[7.25rem] grid-cols-2 items-center gap-2 px-0.25'
        : 'mb-2 flex w-full max-w-[8.5rem] items-center justify-between gap-1.5';
  const topButtonRadiusClass = ultraCompact ? 'rounded-[0.95rem]' : compact ? 'rounded-[1.05rem]' : 'rounded-full';
  const sideButtonSizeClass = ultraCompact
    ? 'min-h-[1.75rem] min-w-[1.75rem] w-full text-[0.45rem] tracking-[0.14em]'
    : compact
      ? 'min-h-[2rem] min-w-[2rem] w-full text-[0.5rem] tracking-[0.15em]'
      : 'h-10 w-10 text-[0.76rem] tracking-[0.18em]';
  const routeButtonSizeClass = ultraCompact
    ? 'min-h-[1.75rem] min-w-[2.25rem] w-full px-0.5 text-[0.5rem] tracking-[0.12em]'
    : compact
      ? 'min-h-[2rem] min-w-[2.5rem] w-full px-1 text-[0.56rem] tracking-[0.13em]'
      : 'h-10 min-w-[3.5rem] px-3 text-[0.62rem] tracking-[0.16em]';
  const routeDividerSpacingClass = ultraCompact ? 'mx-0.5' : compact ? 'mx-0.75' : 'mx-1';
  const stripViewportWidthClass = ultraCompact ? 'max-w-[6.5rem]' : compact ? 'max-w-[7.2rem]' : 'max-w-[7.6rem]';
  const stripThumbWidthClass = ultraCompact ? 'max-w-[6.15rem]' : compact ? 'max-w-[7.05rem]' : 'max-w-[7.9rem]';
  const stripSliderWidthClass = ultraCompact ? 'top-[8%] bottom-[12%] w-[5.15rem]' : compact ? 'top-[7%] bottom-[11%] w-[5.95rem]' : 'top-[4.5%] bottom-[6.5%] w-[6rem]';
  const sliderSurfaceRef = useRef<HTMLDivElement | null>(null);
  const faderInteractionRef = useRef<FaderInteractionState>({
    active: false,
    pointerId: null,
    mode: 'pending',
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    scrollContainer: null,
  });

  useEffect(() => {
    if (
      draftVolume !== null &&
      !faderInteractionRef.current.active &&
      Math.abs(volume - draftVolume) < 0.001
    ) {
      setDraftVolume(null);
    }
  }, [draftVolume, volume]);

  const updateDraftVolumeFromClientY = useCallback((clientY: number) => {
    if (disabled) {
      return null;
    }

    const sliderSurface = sliderSurfaceRef.current;
    if (!sliderSurface) {
      return null;
    }

    const bounds = sliderSurface.getBoundingClientRect();
    if (bounds.height <= 0) {
      return null;
    }

    const nextVolume = clamp(1 - ((clientY - bounds.top) / bounds.height), 0, 1);
    const roundedVolume = Math.round(nextVolume * 100) / 100;
    setDraftVolume(roundedVolume);
    return roundedVolume;
  }, [disabled]);

  const finishSliderDrag = useCallback((pointerId?: number, target?: HTMLDivElement | null, keepDraft = false) => {
    const interaction = faderInteractionRef.current;
    if (
      typeof pointerId === 'number' &&
      interaction.pointerId !== null &&
      interaction.pointerId !== pointerId
    ) {
      return;
    }

    const sliderSurface = target || sliderSurfaceRef.current;
    const activePointerId = interaction.pointerId;
    faderInteractionRef.current = {
      active: false,
      pointerId: null,
      mode: 'pending',
      startX: 0,
      startY: 0,
      startScrollLeft: 0,
      scrollContainer: null,
    };

    if (!keepDraft) {
      setDraftVolume(null);
    }

    onInteractionEnd?.();

    if (sliderSurface && activePointerId !== null) {
      try {
        sliderSurface.releasePointerCapture(activePointerId);
      } catch {
        // no-op
      }
    }
  }, [onInteractionEnd]);

  const handleSliderPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const scrollContainer = event.currentTarget.closest('[data-live-director-mixer-scroll="true"]') as HTMLElement | null;
    faderInteractionRef.current = {
      active: true,
      pointerId: event.pointerId,
      mode: 'pending',
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scrollContainer?.scrollLeft ?? 0,
      scrollContainer,
    };
    setDraftVolume(volume);

    onInteractionStart?.();

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // no-op
    }

    event.preventDefault();
    event.stopPropagation();
  }, [disabled, onInteractionStart]);

  const handleSliderPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = faderInteractionRef.current;
    if (!interaction.active || interaction.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - interaction.startX;
    const deltaY = event.clientY - interaction.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (interaction.mode === 'pending') {
      if (absX < FADER_AXIS_LOCK_THRESHOLD_PX && absY < FADER_AXIS_LOCK_THRESHOLD_PX) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      interaction.mode = absY > absX * 1.5 || !interaction.scrollContainer ? 'volume' : 'scroll';
    }

    if (interaction.mode === 'scroll') {
      if (interaction.scrollContainer) {
        interaction.scrollContainer.scrollLeft = interaction.startScrollLeft - deltaX;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    updateDraftVolumeFromClientY(event.clientY);
    event.preventDefault();
    event.stopPropagation();
  }, [updateDraftVolumeFromClientY]);

  const handleSliderPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = faderInteractionRef.current;
    if (!interaction.active || interaction.pointerId !== event.pointerId) {
      return;
    }

    let committedVolume: number | null = null;
    if (interaction.mode === 'pending' || interaction.mode === 'volume') {
      committedVolume = updateDraftVolumeFromClientY(event.clientY);
    } else if (interaction.scrollContainer) {
      interaction.scrollContainer.scrollLeft = interaction.startScrollLeft - (event.clientX - interaction.startX);
    }

    finishSliderDrag(event.pointerId, event.currentTarget, committedVolume !== null);
    if (committedVolume !== null) {
      onVolumeChange(committedVolume);
    }
    event.preventDefault();
    event.stopPropagation();
  }, [finishSliderDrag, onVolumeChange, updateDraftVolumeFromClientY]);

  const handleSliderPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = faderInteractionRef.current;
    if (!interaction.active || interaction.pointerId !== event.pointerId) {
      return;
    }

    finishSliderDrag(event.pointerId, event.currentTarget);
    event.preventDefault();
    event.stopPropagation();
  }, [finishSliderDrag]);

  const handleSliderKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    let nextVolume: number | null = null;

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      nextVolume = clamp(displayVolume + 0.02, 0, 1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      nextVolume = clamp(displayVolume - 0.02, 0, 1);
    } else if (event.key === 'Home') {
      nextVolume = 0;
    } else if (event.key === 'End') {
      nextVolume = 1;
    }

    if (nextVolume === null) {
      return;
    }

    onVolumeChange(Math.round(nextVolume * 100) / 100);
    event.preventDefault();
    event.stopPropagation();
  }, [disabled, displayVolume, onVolumeChange]);

  return (
    <div
      className={`live-director-track-strip relative flex h-full min-w-0 flex-col items-center overflow-hidden border border-white/7 bg-[linear-gradient(180deg,rgba(34,35,37,0.92),rgba(26,27,29,0.94))] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-all duration-200 ${isAudiblyActive ? 'live-director-track-strip--breathing' : ''} ${shellRadiusClass} ${shellPaddingClass} ${dimmed ? 'opacity-45' : 'opacity-100'}`}
      style={trackBreathStyle}
    >
      <span
        aria-hidden="true"
        className={`live-director-track-breath-layer pointer-events-none absolute inset-0 ${shellRadiusClass}`}
      />
      <span
        aria-hidden="true"
        className="live-director-track-breath-edge pointer-events-none absolute inset-x-3 top-2 h-px rounded-full"
      />
      <div className={topControlsClass}>
        <button
          type="button"
          onClick={onSolo}
          disabled={disabled}
          aria-label={`Solo ${label}`}
          className={`ui-pressable-soft flex items-center justify-center border font-black transition-all duration-150 ${topButtonRadiusClass} ${sideButtonSizeClass} ${soloed
              ? 'border-cyan-300/60 bg-cyan-300/16 text-cyan-100 shadow-[0_0_18px_rgba(103,210,242,0.24)]'
              : 'border-white/8 bg-black/32 text-white/65 hover:border-white/14 hover:text-white'
            }`}
        >
          S
        </button>
        {showRouteFlip ? (
          <button
            type="button"
            onClick={onToggleOutputRoute}
            disabled={disabled}
            aria-pressed={outputRoute === 'right'}
            aria-label={`Cambiar salida de ${label} hacia ${outputRoute === 'right' ? 'izquierda' : 'derecha'}`}
            className={`ui-pressable-soft flex items-center justify-center border font-black transition-all duration-150 ${topButtonRadiusClass} ${routeButtonSizeClass} ${outputRoute === 'right'
                ? 'border-amber-300/55 bg-amber-300/14 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.18)]'
                : 'border-cyan-300/55 bg-cyan-300/14 text-cyan-100 shadow-[0_0_16px_rgba(103,210,242,0.18)]'
              }`}
            title={`Salida absoluta ${outputRoute === 'right' ? 'R' : 'L'}`}
          >
            <span className={outputRoute === 'left' ? 'text-white' : 'text-white/36'}>L</span>
            <span className={`${routeDividerSpacingClass} text-white/22`}>|</span>
            <span className={outputRoute === 'right' ? 'text-white' : 'text-white/36'}>R</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onMute}
          disabled={disabled}
          aria-label={`${muted ? 'Unmute' : 'Mute'} ${label}`}
          className={`ui-pressable-soft flex items-center justify-center border font-black transition-all duration-150 ${topButtonRadiusClass} ${sideButtonSizeClass} ${muted
              ? 'border-rose-300/55 bg-rose-400/16 text-rose-100 shadow-[0_0_18px_rgba(251,113,133,0.22)]'
              : 'border-white/8 bg-black/28 text-white/52 hover:border-white/14 hover:text-white'
            }`}
        >
          M
        </button>
      </div>

      <div className="relative flex w-full flex-1 items-center justify-center">
        <div className={`relative h-full w-full ${stripViewportWidthClass}`}>
          <div className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-[#040506] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] ${ultraCompact ? 'top-[8%] bottom-[12%] w-[0.5rem]' : compact ? 'top-[7%] bottom-[11%] w-[0.56rem]' : 'top-[4.5%] bottom-[6.5%] w-[0.72rem]'}`} />
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={`${id}-mark-${index}`}
              className="absolute left-1/2 h-[2px] w-[72%] -translate-x-1/2 rounded-full bg-white/18"
              style={{ bottom: `${12 + index * 10}%` }}
            />
          ))}
          <div
            className={`live-director-track-activity-meter pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full shadow-[0_0_14px_rgba(103,210,242,0.16)] transition-[height,opacity,box-shadow] duration-100 ${isAudiblyActive ? 'live-director-track-activity-meter--breathing' : ''} ${ultraCompact ? 'bottom-[11%] w-[0.26rem]' : 'bottom-[10%] w-[0.32rem]'}`}
            style={{
              height: `${meterHeightPercent}%`,
              // When muted we already switch to a neutral gray + low opacity,
              // so the old filter: grayscale(1) was redundant AND paid a
              // non-compositable paint on every visual-clock tick. Dropped.
              backgroundColor: muted ? 'rgba(136, 144, 158, 0.42)' : accent,
              opacity: meterOpacity,
              boxShadow: meterGlow,
            }}
          />
          <FaderThumb
            accent={accent}
            level={visualActivityLevel}
            muted={muted}
            className={`live-director-track-thumb ${isAudiblyActive ? 'live-director-track-thumb--breathing' : ''} ${ultraCompact ? 'h-[1.85rem]' : compact ? 'h-[2.2rem]' : 'h-[4.35rem]'} w-full ${stripThumbWidthClass} transition-[bottom,box-shadow,opacity,transform] duration-150`}
            style={{
              bottom: `calc(${levelBottom} - ${ultraCompact ? '0.92rem' : compact ? '1.1rem' : '1.75rem'})`,
              boxShadow: muted
                ? '0 12px 20px rgba(0,0,0,0.24)'
                : `0 14px 24px rgba(0,0,0,0.35), 0 0 20px ${knobGlow}`,
              opacity: dimmed ? 0.84 : 1,
            }}
          />

          <div
            ref={sliderSurfaceRef}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`Volume for ${label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayVolume * 100)}
            aria-valuetext={`${Math.round(displayVolume * 100)}%`}
            aria-orientation="vertical"
            data-no-drag-scroll="true"
            onPointerDown={handleSliderPointerDown}
            onPointerMove={handleSliderPointerMove}
            onPointerUp={handleSliderPointerUp}
            onPointerCancel={handleSliderPointerCancel}
            onLostPointerCapture={() => finishSliderDrag()}
            onKeyDown={handleSliderKeyDown}
            className={`absolute left-1/2 -translate-x-1/2 rounded-[1rem] ${disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${stripSliderWidthClass}`}
            style={{ touchAction: 'none' }}
          />
        </div>
      </div>

      <div className={`text-center ${ultraCompact ? 'mt-0' : compact ? 'mt-0.5' : 'mt-4'}`}>
        <div
          aria-hidden="true"
          className={`live-director-track-signal mx-auto mb-1 flex h-3 items-end justify-center gap-0.5 ${isAudiblyActive ? 'live-director-track-signal--active' : ''}`}
        >
          <span />
          <span />
          <span />
        </div>
        {!compact && <p className="text-[0.62rem] font-black uppercase tracking-[0.3em] text-white/28">{shortLabel}</p>}
        <p className={`leading-tight text-white/88 ${ultraCompact ? 'text-[10px] font-semibold' : compact ? 'text-[11px] font-semibold' : 'mt-1 text-[1.03rem] font-semibold'}`}>{label}</p>
      </div>
    </div>
  );
}, (previousProps, nextProps) => (
  previousProps.id === nextProps.id &&
  previousProps.label === nextProps.label &&
  previousProps.shortLabel === nextProps.shortLabel &&
  previousProps.accent === nextProps.accent &&
  previousProps.volume === nextProps.volume &&
  previousProps.level === nextProps.level &&
  previousProps.isPlaying === nextProps.isPlaying &&
  previousProps.muted === nextProps.muted &&
  previousProps.soloed === nextProps.soloed &&
  previousProps.dimmed === nextProps.dimmed &&
  previousProps.disabled === nextProps.disabled &&
  previousProps.outputRoute === nextProps.outputRoute &&
  previousProps.showRouteFlip === nextProps.showRouteFlip &&
  previousProps.compact === nextProps.compact &&
  previousProps.ultraCompact === nextProps.ultraCompact
));

const EnsayoQueueCard = memo(function EnsayoQueueCard({
  song,
  coverUrl,
  active = false,
  compact = false,
  ultraCompact = false,
  onClick,
}: {
  song: LiveDirectorQueueSong;
  coverUrl?: string | null;
  active?: boolean;
  compact?: boolean;
  ultraCompact?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ui-pressable-card group relative flex shrink-0 overflow-hidden rounded-[1.15rem] border text-left transition-all duration-200 ${ultraCompact
        ? 'h-[4.7rem] p-1.25'
        : compact
          ? 'h-[5.1rem] p-1.5'
          : 'h-[5.55rem] p-1.75'
        } ${active
          ? 'border-white/80'
          : 'border-white/8 hover:border-white/14'
        }`}
      style={{
        width: ultraCompact ? '9.15rem' : compact ? '10rem' : '10.95rem',
        background:
          'linear-gradient(180deg,rgba(22,24,26,0.98),rgba(15,17,18,0.98))',
      }}
      aria-label={`Abrir ${song.title}`}
    >
      <div className="absolute inset-0 overflow-hidden rounded-[1rem]">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_top,_rgba(129,221,245,0.14),_transparent_34%),linear-gradient(180deg,rgba(43,47,50,0.96),rgba(17,19,21,0.98))]" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.18)_42%,rgba(0,0,0,0.78)_100%)]" />
      </div>

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
  );
});

export function LiveDirectorView({
  tracks,
  sections = DEFAULT_SECTIONS,
  title = 'Sunday AM',
  subtitle = 'Battle Belongs',
  bpm = 81,
  className = '',
  songId = '',
  songTitle = '',
  songMp3 = '',
  songKey = '',
  initialSession = null,
  requiresSongContext = false,
  mode = 'director',
  engineSurface = 'web',
  maxWebActiveTracks = WEB_ENGINE_MAX_ACTIVE_TRACKS,
  queueSongs = [],
  activeQueueSongId = '',
  onSelectQueueSong,
  operationalChips = [],
  internalPadVolume,
  onInternalPadVolumeChange,
  onPlaybackSnapshot,
  onSessionPersisted,
  onBack,
}: LiveDirectorViewProps) {
  const hasProvidedTracks = Boolean(tracks && tracks.length > 0);
  const hasPersistedSongContext = Boolean(songId);
  const isSongBoundView = requiresSongContext || hasPersistedSongContext;
  const canLoadManualSession = !hasProvidedTracks && (!requiresSongContext || hasPersistedSongContext);
  const sequenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const sectionsLaneScrollRef = useRef<HTMLDivElement | null>(null);
  const sectionsDragStateRef = useRef<DragScrollState>({
    active: false,
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
  });
  const isUserScrollingSectionsRef = useRef(false);
  const resumeSectionsAutoScrollTimeoutRef = useRef<number | null>(null);
  // When true, the next auto-follow re-center should animate (smooth scroll).
  // We set it right when the user-scroll timeout expires so the playhead
  // slides back to where it should be instead of snapping.
  const sectionsAutoFollowShouldSmoothRef = useRef(false);
  const mixerScrollRef = useRef<HTMLDivElement | null>(null);
  const mixerDragStateRef = useRef<DragScrollState>({
    active: false,
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
  });
  const padAudioRefA = useRef<HTMLAudioElement | null>(null);
  const padAudioRefB = useRef<HTMLAudioElement | null>(null);
  const activePadChannelRef = useRef<'A' | 'B'>('A');
  const padFadeTargetRefA = useRef(0);
  const padFadeTargetRefB = useRef(0);
  const padFadeFrameRef = useRef<number | null>(null);
  const ownedObjectUrlsRef = useRef<string[]>([]);
  // Ref-based indirection so each ChannelStrip gets a STABLE callback
  // reference keyed by its trackId for the whole session. The callbacks read
  // from `channelStripHandlersRef.current` at dispatch time, so updates to
  // parent-side state/handlers don't require churning the callbacks
  // themselves. This is what actually lets `memo(ChannelStrip)` skip
  // re-rendering strips whose level/volume haven't changed.
  const channelStripHandlersRef = useRef<{
    handleInternalPadVolumeChange: (nextVolume: number) => void;
    setVolume: (trackId: string, volume: number) => void;
    handleMuteTrack: (trackId: string) => void;
    handleSoloTrack: (trackId: string) => void;
    handleToggleGuideTrackRoute: (trackId: string) => void;
    setIsPadActive: (value: boolean | ((previous: boolean) => boolean)) => void;
    isPadActive: boolean;
  } | null>(null);
  const channelStripCallbacksRef = useRef<Map<string, {
    onVolumeChange: (volume: number) => void;
    onMute: () => void;
    onSolo: () => void;
    onToggleOutputRoute: () => void;
  }>>(new Map());
  const masterVolumeRef = useRef(0.82);
  const appliedMasterVolumeRef = useRef(0.82);
  const masterVolumeFadeFrameRef = useRef<number | null>(null);
  const masterVolumeFadeResolveRef = useRef<(() => void) | null>(null);
  const resumeNativeMetersTimeoutRef = useRef<number | null>(null);
  const mixerInteractionActiveRef = useRef(false);
  const sectionTransitionTokenRef = useRef(0);
  const isSectionTransitioningRef = useRef(false);
  const sessionSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSilentSessionSaveRef = useRef<PendingLiveDirectorSessionSave | null>(null);
  const isFlushingSilentSessionSaveRef = useRef(false);
  const [useStreamingEngine, setUseStreamingEngine] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [hasResolvedEngineFlag, setHasResolvedEngineFlag] = useState(false);
  const isIOSNativeEngineSurface = engineSurface === 'ios-native' || isNativeLiveDirectorEngineAvailable();
  const webMultitrackEngine = useMultitrackEngine({
    useStreamingEngine,
  });
  const nativeIOSMultitrackEngine = useNativeIOSMultitrackEngine();
  const selectedMultitrackEngine = isIOSNativeEngineSurface
    ? nativeIOSMultitrackEngine
    : webMultitrackEngine;
  const {
    currentTime,
    duration: playbackDuration,
    diagnostics,
    initialize,
    isPlaying,
    isReady,
    play,
    pause,
    seekTo,
    setLoopPoints,
    setMasterVolume,
    setTrackOutputRoute,
    setVolume,
    soloTrack,
    stop,
    trackLevels,
    trackEnvelopes,
    toggleLoop,
    toggleMute,
    trackVolumes,
    loadProgress,
    loadWarnings,
  } = selectedMultitrackEngine;

  const suspendNativeMeters = useCallback(() => {
    if (resumeNativeMetersTimeoutRef.current !== null) {
      window.clearTimeout(resumeNativeMetersTimeoutRef.current);
      resumeNativeMetersTimeoutRef.current = null;
    }

    mixerInteractionActiveRef.current = true;
  }, []);

  const resumeNativeMetersSoon = useCallback(() => {
    if (resumeNativeMetersTimeoutRef.current !== null) {
      window.clearTimeout(resumeNativeMetersTimeoutRef.current);
    }

    resumeNativeMetersTimeoutRef.current = window.setTimeout(() => {
      resumeNativeMetersTimeoutRef.current = null;
      mixerInteractionActiveRef.current = false;
    }, 250);
  }, []);

  useEffect(() => () => {
    if (resumeNativeMetersTimeoutRef.current !== null) {
      window.clearTimeout(resumeNativeMetersTimeoutRef.current);
      resumeNativeMetersTimeoutRef.current = null;
    }
  }, []);
  const [isPortrait, setIsPortrait] = useState(false);
  const [isCompactLandscape, setIsCompactLandscape] = useState(false);
  const [isUltraCompactLandscape, setIsUltraCompactLandscape] = useState(false);
  const [isNativeIosShell, setIsNativeIosShell] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [sectionsLaneViewportWidth, setSectionsLaneViewportWidth] = useState(0);
  // Current horizontal scroll of the sections lane. Kept in state (not ref)
  // because the minimap viewport marker is rendered from this value — we want
  // React to re-render when the user scrolls. Throttled via rAF below.
  const [sectionsLaneScrollLeft, setSectionsLaneScrollLeft] = useState(0);
  // UI status for the auto-follow indicator chip. 'auto' = normal (indicator
  // hidden), 'held' = user is actively dragging/scrolling (indicator on,
  // static), 'resuming' = user released and the 5s timer is counting down
  // (indicator on, ring animating).
  const [sectionsAutoFollowStatus, setSectionsAutoFollowStatus] = useState<
    'auto' | 'held' | 'resuming'
  >('auto');
  const [manualSession, setManualSession] = useState<LiveDirectorResolvedSession | null>(
    initialSession ? toResolvedSession(initialSession) : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dismissedLoadWarningKey, setDismissedLoadWarningKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isInitializingSession, setIsInitializingSession] = useState(false);
  const [showLoadPanel, setShowLoadPanel] = useState(canLoadManualSession && !initialSession);
  // When the user taps Back while audio is playing, defer the navigation and
  // show a confirmation modal. Prevents disastrous accidental exits live.
  const [showBackConfirm, setShowBackConfirm] = useState(false);

  const exitLiveDirector = useCallback(async () => {
    setShowBackConfirm(false);

    try {
      if (isNativeLiveDirectorEngineAvailable()) {
        await NativeLiveDirectorEngine.stop();
        await NativeLiveDirectorEngine.clearNowPlayingMetadata().catch(() => undefined);
      } else {
        stop();
      }
    } catch {
      try {
        stop();
      } catch {
        // ignore: leaving the screen anyway
      }
    }

    if (onBack) {
      onBack();
    } else if (typeof window !== 'undefined') {
      window.history.back();
    }
  }, [onBack, stop]);

  // Show mode: hides the Motor / Diagnostics / Upload chips for a cleaner
  // performance-ready UI. Persists across reloads so the user doesn't have
  // to re-toggle every time they open the app live.
  const [isShowMode, setIsShowMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('ld:showMode') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('ld:showMode', isShowMode ? '1' : '0');
    } catch {
      // Ignore — privacy mode or storage quota.
    }
  }, [isShowMode]);
  const [loaderMode, setLoaderMode] = useState<'sequence' | 'folder'>('sequence');
  const [unmatchedFiles, setUnmatchedFiles] = useState<string[]>([]);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [mutedTrackIds, setMutedTrackIds] = useState<Set<string>>(new Set());
  const [trackOutputRoutes, setTrackOutputRoutes] = useState<Record<string, TrackOutputRoute>>({});
  const [soloTrackId, setSoloTrackId] = useState<string | null>(null);
  const [masterVolume, setMasterVolumeState] = useState(0.82);
  const [loopEnabled, setLoopEnabled] = useState(false);
  // Section-loop rehearsal mode: persistent toggle that keeps the current
  // section in a loop. When the playhead enters a new section (user clicks
  // another button, or we use prev/next-section), loop points retarget to
  // the new active section so the user can rehearse any part hands-free.
  const [sectionLoopMode, setSectionLoopMode] = useState(false);
  const [surfaceView, setSurfaceView] = useState<SurfaceView>('mix');
  const [showOffsetModal, setShowOffsetModal] = useState(false);
  const [showTrackLoadModal, setShowTrackLoadModal] = useState(false);
  const [pendingEnabledMap, setPendingEnabledMap] = useState<Record<string, boolean> | null>(null);
  const offsetModalInitialValueRef = useRef<number | null>(null);
  const [isPadActive, setIsPadActive] = useState(false);
  const [internalPadVolumeState, setInternalPadVolumeState] = useState(0.34);
  const [songCoverArtUrl, setSongCoverArtUrl] = useState<string | null>(null);
  const [queueSongCoverArtMap, setQueueSongCoverArtMap] = useState<Record<string, string | null>>({});
  const currentEngineLabel = isIOSNativeEngineSurface ? 'Apple' : useStreamingEngine ? 'Flujo' : 'Buffer';
  const isEnsayoMode = mode === 'ensayo';
  const resolvedInternalPadVolume = clamp(
    Number.isFinite(Number(internalPadVolume)) ? Number(internalPadVolume) : internalPadVolumeState,
    0,
    1,
  );
  const effectiveInternalPadVolume = clamp(resolvedInternalPadVolume * INTERNAL_PAD_GAIN_TRIM, 0, 1);
  const resolvedPadUrl = useMemo(() => getPadUrlForSongKey(songKey), [songKey]);
  const shouldUseNativeInternalPad = Boolean(isIOSNativeEngineSurface && isEnsayoMode && resolvedPadUrl);
  const nativeInternalPadTrack = useMemo<TrackData | null>(() => {
    if (!shouldUseNativeInternalPad || !resolvedPadUrl) {
      return null;
    }

    return {
      id: INTERNAL_PAD_TRACK_ID,
      name: 'Pad Int.',
      url: resolvedPadUrl,
      nativeUrl: resolvedPadUrl,
      volume: isPadActive ? effectiveInternalPadVolume : 0,
      isMuted: false,
      enabled: true,
      sourceFileName: 'Pad interno',
      outputRoute: 'stereo',
    };
  }, [effectiveInternalPadVolume, isPadActive, resolvedPadUrl, shouldUseNativeInternalPad]);
  const layoutScale = useMemo(() => {
    if (isPortrait || viewportHeight <= 0) {
      return 1;
    }

    return clamp(viewportHeight / 450, 0.58, 1);
  }, [isPortrait, viewportHeight]);
  const scaleRem = useCallback(
    (baseRem: number, minRem: number, maxRem = baseRem) =>
      `${clamp(baseRem * layoutScale, minRem, maxRem).toFixed(3)}rem`,
    [layoutScale],
  );
  const headerMinWidth = useMemo(() => scaleRem(58, 45), [scaleRem]);
  const mixerLayoutColumns = useMemo(
    () =>
      isUltraCompactLandscape
        ? `${scaleRem(5.15, 4.45)} ${scaleRem(5.45, 4.65)}`
        : isCompactLandscape
          ? `${scaleRem(6.25, 5.35)} ${scaleRem(6.95, 5.9)}`
          : '7.25rem 8rem',
    [isCompactLandscape, isUltraCompactLandscape, scaleRem],
  );

  const sessionTracks = useMemo(
    () => (hasProvidedTracks ? tracks || [] : manualSession?.tracks || []),
    [hasProvidedTracks, manualSession?.tracks, tracks],
  );

  const trackRouteSeedSignature = useMemo(
    () => sessionTracks
      .map((track) => `${track.id}:${track.name}:${resolveTrackOutputRoute(track)}`)
      .join('|'),
    [sessionTracks],
  );

  const seededTrackOutputRoutes = useMemo(
    () => buildTrackOutputRouteMap(sessionTracks),
    [trackRouteSeedSignature],
  );

  // Per-platform active-stem cap. See STEM_PRIORITY_RULES comment at top
  // of file for the empirical numbers. The `maxWebActiveTracks` prop still
  // wins when the parent supplies one, so unit tests and edge cases
  // (e.g. a deliberately constrained iPad profile) can override.
  const webActiveTrackLimit = useMemo(() => {
    const propLimit = Math.floor(Number(maxWebActiveTracks));
    if (Number.isFinite(propLimit) && propLimit > 0 && propLimit !== WEB_ENGINE_MAX_ACTIVE_TRACKS) {
      return propLimit;
    }
    if (isIOSNativeEngineSurface) {
      return IOS_NATIVE_MAX_ACTIVE_TRACKS;
    }
    try {
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        return ANDROID_MAX_ACTIVE_TRACKS;
      }
    } catch {
      // Capacitor unavailable (SSR / unit test) — fall through to web cap.
    }
    return WEB_ENGINE_MAX_ACTIVE_TRACKS;
  }, [isIOSNativeEngineSurface, maxWebActiveTracks]);
  const sessionActiveTrackLimit = useMemo(
    () => Math.max(1, webActiveTrackLimit - (shouldUseNativeInternalPad ? 1 : 0)),
    [shouldUseNativeInternalPad, webActiveTrackLimit],
  );

  const enabledSessionTracks = useMemo(
    () => sessionTracks.filter((track) => track.enabled !== false),
    [sessionTracks],
  );

  // Priority-aware active-track selection. When the session has more
  // enabled stems than the platform cap, we keep the stems with the
  // lowest priority rank (click/click-guide/drums/bass/vocals first) and
  // auto-disable the rest. Within a rank, original upload order is the
  // tiebreaker so the mix stays deterministic.
  const activeTracks = useMemo(() => {
    if (enabledSessionTracks.length <= sessionActiveTrackLimit) {
      return enabledSessionTracks;
    }
    const ranked = enabledSessionTracks.map((track, index) => ({
      track,
      index,
      rank: stemPriorityRank(track),
    }));
    ranked.sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
    const kept = ranked.slice(0, sessionActiveTrackLimit);
    kept.sort((a, b) => a.index - b.index);
    return kept.map((entry) => entry.track);
  }, [enabledSessionTracks, sessionActiveTrackLimit]);

  const isWebTrackLimitExceeded = enabledSessionTracks.length > activeTracks.length;

  // Which stems got auto-disabled by the limit. Surfaced in the load
  // banner so the operator knows what's off and can either pre-mix
  // them externally or re-enable after manually disabling something
  // less critical.
  const autoDisabledTrackNames = useMemo(() => {
    if (!isWebTrackLimitExceeded) return [];
    const activeIds = new Set(activeTracks.map((t) => t.id));
    return enabledSessionTracks
      .filter((track) => !activeIds.has(track.id))
      .map((track) => track.name || track.id);
  }, [activeTracks, enabledSessionTracks, isWebTrackLimitExceeded]);

  const activeEngineTracks = useMemo(() => {
    const engineTracks: TrackData[] = activeTracks.map((track) => ({
      ...track,
      outputRoute: trackOutputRoutes[track.id] ?? resolveTrackOutputRoute(track),
    }));

    if (nativeInternalPadTrack) {
      engineTracks.push(nativeInternalPadTrack);
    }

    return engineTracks;
  }, [activeTracks, nativeInternalPadTrack, trackOutputRoutes]);

  const hasSessionTracks = sessionTracks.length > 0;
  const hasTrackSession = activeTracks.length > 0;
  const currentSessionLabel = hasProvidedTracks
    ? subtitle
    : manualSession?.sessionLabel || songTitle || 'Sin sesion cargada';
  const inferredSessionMode = manualSession?.mode || (sessionTracks.length > 1 ? 'folder' : 'sequence');
  const sessionModeLabel = !hasSessionTracks
    ? 'Sin preparar'
    : inferredSessionMode === 'folder'
      ? `${activeTracks.length} stem${activeTracks.length === 1 ? '' : 's'} activo${activeTracks.length === 1 ? '' : 's'}`
      : 'Secuencia unica';
  const canToggleTrackLoad = !hasProvidedTracks && manualSession?.mode === 'folder' && sessionTracks.length > 1;
  const useWideTrackLoadModal = !isPortrait;
  const showSectionsPanel = surfaceView === 'sections';
  const displayBpm = Number.isFinite(Number(bpm)) ? Math.max(0, Math.round(Number(bpm))) : 0;
  const songCardTitle = songTitle || currentSessionLabel;
  const performerLabel = isEnsayoMode
    ? String(title || '').replace(/^Modo Ensayo\s*[-·]?\s*/i, '').trim()
    : title?.replace(/^Live Director\s*-\s*/i, '').trim() || '';
  const songCardMeta = isEnsayoMode
    ? [subtitle, songKey].filter(Boolean).join(' · ') || sessionModeLabel
    : [performerLabel, songKey].filter(Boolean).join(' · ') || sessionModeLabel;
  const songSupportMeta = hasSessionTracks
    ? isWebTrackLimitExceeded
      ? `${activeTracks.length} de ${enabledSessionTracks.length} pistas activas (tope ${sessionActiveTrackLimit}${shouldUseNativeInternalPad ? ' + pad' : ''})`
      : inferredSessionMode === 'folder' && activeTracks.length !== sessionTracks.length
      ? `${activeTracks.length} de ${sessionTracks.length} pistas activas`
      : sessionModeLabel
    : hasPersistedSongContext
      ? 'Carga una sesion real para esta cancion'
      : 'Abre esta superficie desde repertorio';
  const surfaceBadgeLabel = showSectionsPanel ? 'Secciones' : 'Mezcla';
  const ensayoQueueSongs = useMemo(
    () => (isEnsayoMode ? queueSongs.slice(0, 6) : []),
    [isEnsayoMode, queueSongs],
  );
  const ensayoSlotSongs = useMemo(() => {
    if (!isEnsayoMode) return [];
    if (queueSongs && queueSongs.length > 0) return queueSongs;
    return [
      {
        id: songId || '__current-song__',
        title: songCardTitle,
        subtitle: songCardMeta,
        mp3: songMp3,
      },
    ];
  }, [isEnsayoMode, queueSongs, songId, songCardTitle, songCardMeta, songMp3]);
  const headerOperationalChips = useMemo<LiveDirectorOperationalChip[]>(
    () =>
      isEnsayoMode
        ? operationalChips.filter((chip) => (
          (chip.id === 'sync' && chip.active) ||
          (chip.id === 'offline' && chip.value.includes('/'))
        ))
        : [],
    [isEnsayoMode, operationalChips],
  );
  const sectionOffsetSeconds = Number.isFinite(Number(manualSession?.sectionOffsetSeconds))
    ? Number(manualSession?.sectionOffsetSeconds)
    : 0;
  const resolvedSections = useMemo(
    () =>
      applyLiveDirectorSectionOffset(
        (sections || DEFAULT_SECTIONS) as LiveDirectorSectionVisual[],
        sectionOffsetSeconds,
      ) || ((sections || DEFAULT_SECTIONS) as LiveDirectorSectionVisual[]),
    [sectionOffsetSeconds, sections],
  );

  const sectionTimelineDuration = useMemo(
    () => resolvedSections.reduce((maxTime, section) => Math.max(maxTime, section.endTime), 0),
    [resolvedSections],
  );
  const playbackTimelineDuration = useMemo(
    () => Math.max(sectionTimelineDuration, hasTrackSession ? playbackDuration : 0, hasTrackSession ? currentTime : 0),
    [currentTime, hasTrackSession, playbackDuration, sectionTimelineDuration],
  );
  const sectionTimelineTailDuration = Math.max(0, playbackTimelineDuration - sectionTimelineDuration);
  const sectionLaneTailWidthPx = Math.max(
    0,
    Math.ceil(sectionTimelineTailDuration * SECTION_LANE_PIXELS_PER_SECOND),
  );
  const sectionLanePlayheadOffsetPx = useMemo(() => {
    if (sectionsLaneViewportWidth <= 0) {
      return SECTION_LANE_PLAYHEAD_MIN_OFFSET_PX;
    }

    const targetRatio = isUltraCompactLandscape ? 0.22 : isCompactLandscape ? 0.25 : 0.31;
    return Math.round(
      clamp(
        sectionsLaneViewportWidth * targetRatio,
        SECTION_LANE_PLAYHEAD_MIN_OFFSET_PX,
        Math.min(SECTION_LANE_PLAYHEAD_MAX_OFFSET_PX, sectionsLaneViewportWidth * 0.45),
      ),
    );
  }, [isCompactLandscape, isUltraCompactLandscape, sectionsLaneViewportWidth]);
  const sectionLaneTrailingPaddingPx = useMemo(() => {
    if (sectionsLaneViewportWidth <= 0) {
      return SECTION_LANE_PLAYHEAD_MIN_OFFSET_PX;
    }

    return Math.max(
      SECTION_LANE_PLAYHEAD_MIN_OFFSET_PX,
      Math.ceil(sectionsLaneViewportWidth - sectionLanePlayheadOffsetPx),
    );
  }, [sectionLanePlayheadOffsetPx, sectionsLaneViewportWidth]);
  const sectionLaneSegments = useMemo<SectionLaneSegment[]>(
    () => {
      let cursor = 0;

      return resolvedSections.map((section, index) => {
        const duration = Math.max(0.25, section.endTime - section.startTime);
        const widthPx = Math.max(
          SECTION_LANE_MIN_WIDTH_PX,
          Math.round(duration * SECTION_LANE_PIXELS_PER_SECOND),
        );
        const innerWaveWidth = Math.max(
          SECTION_WAVE_BAR_WIDTH_PX,
          widthPx - SECTION_WAVE_BAR_INSET_PX * 2,
        );
        const waveBarCount = Math.max(
          SECTION_WAVE_BAR_MIN_COUNT,
          Math.floor((innerWaveWidth + SECTION_WAVE_BAR_GAP_PX) / (SECTION_WAVE_BAR_WIDTH_PX + SECTION_WAVE_BAR_GAP_PX)),
        );
        const sharedStyle: CSSProperties = {
          width: `${widthPx}px`,
          background: `linear-gradient(180deg, ${section.surface}, rgba(20,20,22,0.96))`,
          contain: 'layout paint',
        };
        const inactiveStyle: CSSProperties = {
          ...sharedStyle,
          borderColor: section.border,
          boxShadow: 'none',
        };
        const activeStyle: CSSProperties = {
          ...sharedStyle,
          borderColor: section.accent,
          boxShadow: `0 0 22px ${section.accent}20`,
        };
        const segment: SectionLaneSegment = {
          section,
          waveBars: buildWaveBars(index + 1, waveBarCount),
          widthPx,
          leftPx: cursor,
          activeStyle,
          inactiveStyle,
        };

        cursor += widthPx + SECTION_LANE_GAP_PX;
        return segment;
      });
    },
    [resolvedSections],
  );
  const sectionLaneContentWidth = useMemo(() => {
    const contentTrackWidth =
      sectionLaneSegments.length > 0
        ? (() => {
          const lastSegment = sectionLaneSegments[sectionLaneSegments.length - 1];
          return lastSegment.leftPx + lastSegment.widthPx + sectionLaneTailWidthPx;
        })()
        : sectionLaneTailWidthPx;

    if (sectionLaneSegments.length === 0) {
      return sectionLanePlayheadOffsetPx + sectionLaneTrailingPaddingPx + contentTrackWidth;
    }

    return sectionLanePlayheadOffsetPx + sectionLaneTrailingPaddingPx + contentTrackWidth;
  }, [sectionLanePlayheadOffsetPx, sectionLaneSegments, sectionLaneTailWidthPx, sectionLaneTrailingPaddingPx]);

  const progressPercent = playbackTimelineDuration > 0 ? clamp(currentTime / playbackTimelineDuration, 0, 1) * 100 : 0;
  const diagnosticsCards = useMemo(
    () => [
      { label: 'Heap', value: formatMemoryValue(diagnostics?.browserHeapUsedBytes ?? null) },
      { label: 'Audio est.', value: formatMemoryValue(diagnostics?.estimatedAudioMemoryBytes ?? null) },
      { label: 'Pistas', value: diagnostics ? String(diagnostics.trackCount) : 'n/a' },
      { label: 'Equipo', value: formatDeviceMemoryValue(diagnostics?.deviceMemoryGb ?? null) },
    ],
    [diagnostics],
  );

  const activeSectionIndex = useMemo(() => {
    const nextIndex = resolvedSections.findIndex(
      (section) => currentTime >= section.startTime && currentTime < section.endTime,
    );

    if (nextIndex !== -1) {
      return nextIndex;
    }

    if (currentTime >= sectionTimelineDuration && resolvedSections.length > 0) {
      return resolvedSections.length - 1;
    }

    return 0;
  }, [currentTime, resolvedSections, sectionTimelineDuration]);
  const activeSection = resolvedSections[activeSectionIndex] || resolvedSections[0] || null;

  // Pre-announce the upcoming section while playing. Returns { name, seconds }
  // when the next section starts in <= 6 seconds, null otherwise. The 6s lead
  // is comfortable for musicians to see the heads-up and react before the
  // transition hits.
  const NEXT_SECTION_LOOKAHEAD_S = 6;
  const nextSectionPreview = useMemo<{ name: string; seconds: number } | null>(() => {
    if (!isPlaying || resolvedSections.length === 0) {
      return null;
    }
    const nextSection = resolvedSections[activeSectionIndex + 1];
    if (!nextSection) {
      return null;
    }
    const seconds = nextSection.startTime - currentTime;
    if (seconds <= 0 || seconds > NEXT_SECTION_LOOKAHEAD_S) {
      return null;
    }
    return {
      name: nextSection.name || `Seccion ${activeSectionIndex + 2}`,
      seconds: Math.max(1, Math.ceil(seconds)),
    };
  }, [activeSectionIndex, currentTime, isPlaying, resolvedSections]);

  const sectionLaneProgressPx = useMemo(() => {
    if (sectionLaneSegments.length === 0) {
      return Math.max(0, currentTime) * SECTION_LANE_PIXELS_PER_SECOND;
    }

    const activeSegment = sectionLaneSegments[activeSectionIndex] || sectionLaneSegments[0];

    if (currentTime <= activeSegment.section.startTime) {
      return activeSegment.leftPx;
    }

    if (currentTime >= sectionTimelineDuration) {
      const lastSegment = sectionLaneSegments[sectionLaneSegments.length - 1];
      const overflowDuration = Math.max(
        0,
        Math.min(currentTime, playbackTimelineDuration) - sectionTimelineDuration,
      );
      return lastSegment.leftPx + lastSegment.widthPx + overflowDuration * SECTION_LANE_PIXELS_PER_SECOND;
    }

    const sectionDuration = Math.max(
      0.001,
      activeSegment.section.endTime - activeSegment.section.startTime,
    );
    const progressWithinSection = clamp(
      (currentTime - activeSegment.section.startTime) / sectionDuration,
      0,
      1,
    );

    return activeSegment.leftPx + activeSegment.widthPx * progressWithinSection;
  }, [activeSectionIndex, currentTime, playbackTimelineDuration, sectionLaneSegments, sectionTimelineDuration]);

  // ─── Mini-map derived data ────────────────────────────────────────────────
  // Precompute section blocks as percentages of the full playback timeline.
  // This domain (time, not px) lets the minimap stay aligned with the real
  // playhead regardless of gaps in the big lane.
  const sectionLaneMinimapSegments = useMemo(() => {
    if (playbackTimelineDuration <= 0 || resolvedSections.length === 0) {
      return [] as Array<{
        id: string;
        leftPct: number;
        widthPct: number;
        accent: string;
      }>;
    }
    return resolvedSections.map((section) => {
      const startFrac = clamp(section.startTime / playbackTimelineDuration, 0, 1);
      const endFrac = clamp(section.endTime / playbackTimelineDuration, 0, 1);
      return {
        id: section.id,
        leftPct: startFrac * 100,
        widthPct: Math.max(0, (endFrac - startFrac) * 100),
        accent: section.accent,
      };
    });
  }, [playbackTimelineDuration, resolvedSections]);

  const sectionLaneMinimapPlayheadPct = useMemo(() => {
    if (playbackTimelineDuration <= 0) return 0;
    return clamp(currentTime / playbackTimelineDuration, 0, 1) * 100;
  }, [currentTime, playbackTimelineDuration]);

  // Project the big lane's scrolled viewport onto the timeline fraction.
  // Simplification: we treat the scrollable track as linear over
  // sectionLaneContentWidth, which is good enough visually even with gaps
  // between sections. The playhead line stays in true time domain above.
  const sectionLaneMinimapViewport = useMemo(() => {
    if (
      playbackTimelineDuration <= 0 ||
      sectionLaneContentWidth <= 0 ||
      sectionsLaneViewportWidth <= 0
    ) {
      return { leftPct: 0, widthPct: 100 };
    }
    const contentWithoutPads =
      sectionLaneContentWidth - sectionLanePlayheadOffsetPx - sectionLaneTrailingPaddingPx;
    if (contentWithoutPads <= 0) {
      return { leftPct: 0, widthPct: 100 };
    }
    const startPx = Math.max(0, sectionsLaneScrollLeft);
    const widthFrac = clamp(sectionsLaneViewportWidth / contentWithoutPads, 0.03, 1);
    const startFrac = clamp(startPx / contentWithoutPads, 0, 1 - widthFrac);
    return { leftPct: startFrac * 100, widthPct: widthFrac * 100 };
  }, [
    playbackTimelineDuration,
    sectionLaneContentWidth,
    sectionLanePlayheadOffsetPx,
    sectionLaneTrailingPaddingPx,
    sectionsLaneScrollLeft,
    sectionsLaneViewportWidth,
  ]);

  const mixerView = useMemo<MixerTrackView[]>(() => {
    const sourceTracks =
      activeTracks.length > 0
        ? activeTracks
        : MIXER_TRACKS.map((track) => ({
          id: track.id,
          name: track.label,
          url: '',
          volume: track.defaultVolume,
          isMuted: false,
        }));

    const resolvedMixerTracks = sourceTracks.map((track, index) => {
      const meta = buildMixerTrackMeta(track, index);
      const outputRoute = trackOutputRoutes[track.id] ?? resolveTrackOutputRoute(track);
      const showRouteFlip = isGuideRoutingTrack(track);
      const volume = trackVolumes[track.id] ?? track.volume ?? meta.defaultVolume;
      const muted = mutedTrackIds.has(track.id);
      const dimmed = Boolean(soloTrackId && soloTrackId !== track.id);
      // Activity derivation, in order of preference:
      //   1. Real-time meter level, if the engine is publishing one. On iOS
      //      we keep meters disabled for thermal/stability, so this stays 0
      //      and we fall through to the envelope.
      //   2. Precomputed activity envelope sampled at `currentTime` while the
      //      transport is playing. Paused tracks freeze at 0 so the UI does
      //      not keep breathing when nothing is audible.
      //   3. 0 — no envelope, no meters.
      const liveLevel = clamp(trackLevels[track.id] ?? 0);
      const envelope = trackEnvelopes[track.id];
      const envelopeLevel = isPlaying ? sampleActivityEnvelope(envelope, currentTime) : 0;
      const rawLevel = liveLevel > 0.002 ? liveLevel : envelopeLevel;

      return {
        ...meta,
        volume,
        level: muted || dimmed ? 0 : rawLevel,
        muted,
        soloed: soloTrackId === track.id,
        dimmed,
        disabled: activeTracks.length === 0,
        outputRoute,
        showRouteFlip,
      };
    });

    if (isEnsayoMode && resolvedPadUrl) {
      const padEnvelope = trackEnvelopes[INTERNAL_PAD_TRACK_ID];
      const padEnvelopeLevel = isPlaying && isPadActive
        ? sampleActivityEnvelope(padEnvelope, currentTime)
        : 0;
      const padTrack: MixerTrackView = {
        id: INTERNAL_PAD_TRACK_ID,
        label: 'Pad Int.',
        shortLabel: 'PAD',
        accent: '#43c477',
        defaultVolume: resolvedInternalPadVolume,
        volume: resolvedInternalPadVolume,
        level: padEnvelopeLevel,
        muted: !isPadActive || resolvedInternalPadVolume <= 0.001,
        soloed: false,
        dimmed: false,
        disabled: false,
        outputRoute: 'stereo' as TrackOutputRoute,
        showRouteFlip: false,
      };

      const clickIdx = resolvedMixerTracks.findIndex((t) => t.id.toLowerCase().includes('click') || t.id.toLowerCase().includes('metro'));
      const guiaIdx = resolvedMixerTracks.findIndex((t) => t.id.toLowerCase().includes('guia') || t.id.toLowerCase().includes('guide'));

      const insertIdx = Math.max(clickIdx, guiaIdx);
      if (insertIdx !== -1) {
        resolvedMixerTracks.splice(insertIdx + 1, 0, padTrack);
      } else {
        resolvedMixerTracks.push(padTrack);
      }
    }

    return resolvedMixerTracks;
  }, [activeTracks, currentTime, isEnsayoMode, isPadActive, isPlaying, mutedTrackIds, resolvedInternalPadVolume, resolvedPadUrl, soloTrackId, trackEnvelopes, trackLevels, trackOutputRoutes, trackVolumes]);

  // Precompute the mixer scroll container style so it isn't re-created on
  // every tick of the visual clock. The grid template only actually changes
  // when the track count or the landscape breakpoint changes.
  const mixerScrollStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${Math.max(1, mixerView.length)}, minmax(${isUltraCompactLandscape ? '6.7rem' : isCompactLandscape ? '7.45rem' : '8.5rem'}, 1fr))`,
      touchAction: 'pan-x pinch-zoom' as const,
      overscrollBehaviorX: 'contain' as const,
      WebkitOverflowScrolling: 'touch' as const,
    }),
    [mixerView.length, isUltraCompactLandscape, isCompactLandscape],
  );

  // Memoize the mixer scroll container's Tailwind className. The string only
  // changes with the compact-landscape breakpoint flags, but was being rebuilt
  // on every render (including every visual-clock tick) because of its
  // template-literal interpolation. Stabilizing it avoids any chance of
  // React re-evaluating className diffs and lets browsers reuse the style map.
  const mixerScrollClassName = useMemo(
    () =>
      `hide-scrollbar grid min-h-0 ${
        isUltraCompactLandscape ? 'gap-1' : isCompactLandscape ? 'gap-1.5' : 'gap-3'
      } overflow-x-auto overflow-y-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${
        isUltraCompactLandscape ? 'px-0.5 py-0.5' : isCompactLandscape ? 'px-1 py-0.5' : 'px-3 py-4'
      }`,
    [isUltraCompactLandscape, isCompactLandscape],
  );

  // Returns the stable callback tuple for a given trackId. Lazily creates it
  // on first request and memoizes forever for that trackId. Callbacks
  // dispatch through `channelStripHandlersRef.current` so they always see
  // the latest parent-side handlers without the callbacks themselves needing
  // to churn — this is what lets memo(ChannelStrip) actually work.
  const getChannelStripCallbacks = useCallback((trackId: string) => {
    const cache = channelStripCallbacksRef.current;
    const cached = cache.get(trackId);
    if (cached) {
      return cached;
    }
    const isInternalPadTrack = trackId === INTERNAL_PAD_TRACK_ID;
    const callbacks = {
      onVolumeChange: (nextVolume: number) => {
        const handlers = channelStripHandlersRef.current;
        if (!handlers) return;
        if (isInternalPadTrack) {
          handlers.handleInternalPadVolumeChange(nextVolume);
          if (!handlers.isPadActive && nextVolume > 0) {
            handlers.setIsPadActive(true);
          }
          return;
        }
        handlers.setVolume(trackId, nextVolume);
      },
      onMute: () => {
        const handlers = channelStripHandlersRef.current;
        if (!handlers) return;
        if (isInternalPadTrack) {
          handlers.setIsPadActive((previous) => !previous);
          return;
        }
        handlers.handleMuteTrack(trackId);
      },
      onSolo: () => {
        const handlers = channelStripHandlersRef.current;
        if (!handlers) return;
        if (isInternalPadTrack) {
          handlers.setIsPadActive(true);
          return;
        }
        handlers.handleSoloTrack(trackId);
      },
      onToggleOutputRoute: () => {
        const handlers = channelStripHandlersRef.current;
        if (!handlers || isInternalPadTrack) return;
        handlers.handleToggleGuideTrackRoute(trackId);
      },
    };
    cache.set(trackId, callbacks);
    return callbacks;
  }, []);

  const mappedTrackDetails = useMemo(
    () =>
      sessionTracks.map((track) => ({
        id: track.id,
        trackName: track.name,
        sourceFileName: track.sourceFileName || track.name,
        enabled: track.enabled !== false,
      })),
    [sessionTracks],
  );

  const replaceOwnedObjectUrls = useCallback((nextObjectUrls: string[]) => {
    ownedObjectUrlsRef.current.forEach((objectUrl) => {
      URL.revokeObjectURL(objectUrl);
    });
    ownedObjectUrlsRef.current = nextObjectUrls;
  }, []);

  useEffect(() => {
    setTrackOutputRoutes(seededTrackOutputRoutes);
  }, [seededTrackOutputRoutes]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const root = document.documentElement;
    const previousValue = root.getAttribute('data-live-director-active');
    root.setAttribute('data-live-director-active', 'true');

    return () => {
      if (previousValue === null) {
        root.removeAttribute('data-live-director-active');
      } else {
        root.setAttribute('data-live-director-active', previousValue);
      }
    };
  }, []);

  useEffect(() => {
    if (hasProvidedTracks) {
      return;
    }

    if (initialSession) {
      const resolvedSession = toResolvedSession(initialSession);
      replaceOwnedObjectUrls([]);
      setLoadError(null);
      setManualSession(resolvedSession);
      setUnmatchedFiles(initialSession.unmatchedFiles || []);
      setShowLoadPanel(false);
      return;
    }

    if (isSongBoundView || !requiresSongContext) {
      replaceOwnedObjectUrls([]);
      setManualSession(null);
      setUnmatchedFiles([]);
      setMutedTrackIds(new Set());
      setSoloTrackId(null);
      setShowLoadPanel(canLoadManualSession);
    }
  }, [canLoadManualSession, hasProvidedTracks, initialSession, isSongBoundView, replaceOwnedObjectUrls, requiresSongContext, songId]);

  useEffect(() => {
    if (!canToggleTrackLoad) {
      setShowTrackLoadModal(false);
    }
  }, [canToggleTrackLoad]);

  useEffect(() => {
    if (!showSectionsPanel) {
      setSectionsLaneViewportWidth(0);
      return;
    }

    const scrollContainer = sectionsLaneScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    const updateViewportWidth = () => {
      setSectionsLaneViewportWidth(scrollContainer.clientWidth || 0);
    };

    updateViewportWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportWidth, { passive: true });
      return () => {
        window.removeEventListener('resize', updateViewportWidth);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateViewportWidth();
    });

    resizeObserver.observe(scrollContainer);
    return () => {
      resizeObserver.disconnect();
    };
  }, [showSectionsPanel]);

  // Track the lane's scrollLeft so the minimap viewport marker follows the
  // big lane as the user pans. Throttled via rAF so intense drags don't spam
  // re-renders; state only commits once per frame.
  useEffect(() => {
    if (!showSectionsPanel) return;
    const scrollContainer = sectionsLaneScrollRef.current;
    if (!scrollContainer) return;

    let rafId: number | null = null;
    let latest = scrollContainer.scrollLeft;

    const commit = () => {
      rafId = null;
      setSectionsLaneScrollLeft(latest);
    };

    const onScroll = () => {
      latest = scrollContainer.scrollLeft;
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(commit);
    };

    // Prime the initial value once so the minimap viewport renders immediately.
    setSectionsLaneScrollLeft(scrollContainer.scrollLeft);
    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', onScroll);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [showSectionsPanel]);

  useEffect(() => {
    if (!showSectionsPanel) {
      setShowOffsetModal(false);
      return;
    }

    if (isUserScrollingSectionsRef.current) {
      return;
    }

    const scrollContainer = sectionsLaneScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    const maxScrollLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
    const targetScrollLeft = clamp(sectionLaneProgressPx, 0, maxScrollLeft);

    if (Math.abs(scrollContainer.scrollLeft - targetScrollLeft) <= 1) {
      return;
    }

    // If we're re-engaging auto-follow after a user-scroll timeout, slide the
    // viewport back to the playhead smoothly so it doesn't snap. Subsequent
    // ticks fall back to 'auto' (instant) so the playhead stays pinned.
    const shouldSmooth = sectionsAutoFollowShouldSmoothRef.current;
    if (shouldSmooth) {
      sectionsAutoFollowShouldSmoothRef.current = false;
    }

    scrollContainer.scrollTo({
      left: targetScrollLeft,
      behavior: shouldSmooth ? 'smooth' : 'auto',
    });
  }, [sectionLaneContentWidth, sectionLaneProgressPx, showSectionsPanel]);

  useEffect(() => {
    let cancelled = false;

    if (!songMp3) {
      setSongCoverArtUrl(null);
      return () => {
        cancelled = true;
      };
    }

    void extractCoverArtFromMp3(songMp3).then((coverUrl) => {
      if (!cancelled) {
        setSongCoverArtUrl(coverUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [songMp3]);

  useEffect(() => {
    let cancelled = false;

    if (ensayoQueueSongs.length === 0) {
      setQueueSongCoverArtMap({});
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      ensayoQueueSongs.map(async (song) => {
        const coverUrl = song.mp3 ? await extractCoverArtFromMp3(song.mp3) : null;
        return [song.id, coverUrl] as const;
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }

      setQueueSongCoverArtMap(
        entries.reduce<Record<string, string | null>>((accumulator, [songId, coverUrl]) => {
          accumulator[songId] = coverUrl;
          return accumulator;
        }, {}),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [ensayoQueueSongs]);

  useEffect(() => {
    if (!songId || !onPlaybackSnapshot) {
      return;
    }

    onPlaybackSnapshot({
      songId,
      sectionIndex: activeSectionIndex,
      currentTime: Math.max(0, currentTime - sectionOffsetSeconds),
      currentTimeRaw: currentTime,
      sectionOffsetSeconds,
      isPlaying,
    });
  }, [activeSectionIndex, currentTime, isPlaying, onPlaybackSnapshot, sectionOffsetSeconds, songId]);

  // Haptic feedback on section transitions — eyes-free awareness of where the
  // song is going. Uses navigator.vibrate as a best-effort (works on Android /
  // web; no-op on iOS WebView). To get real iOS haptics, install
  // @capacitor/haptics and swap this impl to Haptics.impact({ style: 'light' }).
  const lastHapticSectionIndexRef = useRef<number>(-1);
  useEffect(() => {
    // Skip initial mount / seeks while paused — only pulse on a *transition
    // during playback*, not on every mount or seek.
    if (!isPlaying) {
      lastHapticSectionIndexRef.current = activeSectionIndex;
      return;
    }
    if (lastHapticSectionIndexRef.current === activeSectionIndex) {
      return;
    }
    // Skip the very first update after mount where ref starts at -1 — we only
    // want real transitions.
    const wasInitial = lastHapticSectionIndexRef.current < 0;
    lastHapticSectionIndexRef.current = activeSectionIndex;
    if (wasInitial) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(10);
      }
    } catch {
      // Ignore — haptics are best-effort.
    }
  }, [activeSectionIndex, isPlaying]);

  // Section-loop rehearsal orchestration. When the mode is on and a section
  // is active, retarget engine loop points to that section's span and enable
  // loop. When the mode flips off, disable loop. Runs on every
  // activeSection.id / mode transition so section-to-section jumps retarget
  // the loop cleanly.
  useEffect(() => {
    if (!sectionLoopMode) {
      if (loopEnabled) {
        toggleLoop();
        setLoopEnabled(false);
      }
      return;
    }
    if (!activeSection) {
      return;
    }
    setLoopPoints(activeSection.startTime, activeSection.endTime);
    if (!loopEnabled) {
      toggleLoop();
      setLoopEnabled(true);
    }
  }, [
    sectionLoopMode,
    activeSection?.id,
    activeSection?.startTime,
    activeSection?.endTime,
  ]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally omit engine refs to avoid toggle thrash

  const syncManualSessionState = useCallback((session: LiveDirectorResolvedSession) => {
    setLoadError(null);
    setUnmatchedFiles(session.unmatchedFiles);
    setManualSession(session);
  }, []);

  const applyManualSession = useCallback((session: LiveDirectorResolvedSession) => {
    stop();
    setMutedTrackIds(new Set(session.tracks.filter((track) => track.isMuted).map((track) => track.id)));
    setSoloTrackId(null);
    setShowLoadPanel(false);
    replaceOwnedObjectUrls(session.objectUrls);
    syncManualSessionState(session);
    setReloadKey((previous) => previous + 1);
  }, [replaceOwnedObjectUrls, stop, syncManualSessionState]);

  const enqueueSessionSave = useCallback(<T,>(task: () => Promise<T>) => {
    const queuedTask = sessionSaveQueueRef.current
      .catch(() => undefined)
      .then(task);

    sessionSaveQueueRef.current = queuedTask.then(
      () => undefined,
      () => undefined,
    );

    return queuedTask;
  }, []);

  const buildSessionSavePayload = useCallback((params?: {
    mode?: 'sequence' | 'folder';
    tracks?: Array<TrackData & { sourceFileName?: string }>;
    unmatchedFiles?: string[];
    sectionOffsetSeconds?: number;
  }): LiveDirectorSessionSavePayload | null => {
    const mode = params?.mode ?? manualSession?.mode;
    const tracksToPersist = params?.tracks ?? manualSession?.tracks;

    if (!mode || !tracksToPersist) {
      return null;
    }

    return {
      mode,
      tracks: tracksToPersist.map((track) => {
        const envelope = trackEnvelopes[track.id] ?? track.activityEnvelope;
        return {
          id: track.id,
          name: track.name,
          url: track.url,
          iosUrl: track.iosUrl,
          nativeUrl: track.nativeUrl,
          optimizedUrl: track.optimizedUrl,
          cafUrl: track.cafUrl,
          pcmUrl: track.pcmUrl,
          volume: track.volume,
          isMuted: track.isMuted,
          enabled: track.enabled !== false,
          sourceFileName: track.sourceFileName,
          outputRoute: resolveTrackOutputRoute(track),
          ...(envelope ? { activityEnvelope: envelope } : {}),
        };
      }),
      unmatchedFiles: params?.unmatchedFiles ?? (manualSession?.unmatchedFiles || []),
      sectionOffsetSeconds: Number.isFinite(Number(params?.sectionOffsetSeconds))
        ? Number(params?.sectionOffsetSeconds)
        : Number(manualSession?.sectionOffsetSeconds) || 0,
    };
  }, [manualSession, trackEnvelopes]);

  const flushSilentSessionSaveQueue = useCallback(async () => {
    if (!hasPersistedSongContext || isFlushingSilentSessionSaveRef.current) {
      return;
    }

    isFlushingSilentSessionSaveRef.current = true;

    try {
      while (pendingSilentSessionSaveRef.current) {
        const nextPendingSave = pendingSilentSessionSaveRef.current;
        pendingSilentSessionSaveRef.current = null;

        try {
          const savedSession = await enqueueSessionSave(() => saveLiveDirectorSongSession({
            songId: nextPendingSave.songId,
            session: nextPendingSave.payload,
          }));
          onSessionPersisted?.(savedSession);
        } catch (error) {
          console.warn('[LiveDirectorView] Silent mixer autosave failed.', error);
        }
      }
    } finally {
      isFlushingSilentSessionSaveRef.current = false;
    }
  }, [enqueueSessionSave, hasPersistedSongContext, onSessionPersisted, songId]);

  const queueSilentSessionSave = useCallback((payload: LiveDirectorSessionSavePayload | null) => {
    if (!hasPersistedSongContext || !payload) {
      return;
    }

    pendingSilentSessionSaveRef.current = {
      songId,
      payload,
    };
    void flushSilentSessionSaveQueue();
  }, [flushSilentSessionSaveQueue, hasPersistedSongContext, songId]);

  const clearManualSession = useCallback(async () => {
    stop();
    setLoadError(null);
    setBusyMessage(hasPersistedSongContext ? 'Borrando sesion y archivos de R2...' : null);

    try {
      if (hasPersistedSongContext) {
        await deleteLiveDirectorSongSession(songId);
      }

      setUnmatchedFiles([]);
      setMutedTrackIds(new Set());
      setSoloTrackId(null);
      setManualSession(null);
      setShowLoadPanel(true);
      replaceOwnedObjectUrls([]);
      setReloadKey((previous) => previous + 1);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo limpiar la sesion.');
    } finally {
      setBusyMessage(null);
    }
  }, [hasPersistedSongContext, replaceOwnedObjectUrls, songId, stop]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const capacitorBridge = (window as WindowWithCapacitor).Capacitor;
    const platform = capacitorBridge?.getPlatform?.();
    const isNativeRuntime = Boolean(capacitorBridge?.isNativePlatform?.()) || platform === 'ios';
    const isIosDevice =
      /iP(hone|ad|od)/.test(window.navigator.userAgent) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

    setIsNativeIosShell(isNativeRuntime && isIosDevice);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateOrientationState = () => {
      const nextViewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const nextViewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const portrait = nextViewportHeight > nextViewportWidth;

      setViewportHeight(nextViewportHeight);
      setViewportWidth(nextViewportWidth);
      setIsPortrait(portrait);
      setIsCompactLandscape(!portrait && nextViewportHeight <= 560);
      setIsUltraCompactLandscape(!portrait && nextViewportHeight <= 450);
    };

    updateOrientationState();

    window.addEventListener('resize', updateOrientationState, { passive: true });
    window.visualViewport?.addEventListener('resize', updateOrientationState);
    window.screen?.orientation?.addEventListener?.('change', updateOrientationState);

    const orientation = window.screen?.orientation as (ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
    }) | undefined;

    void orientation?.lock?.('landscape').catch(() => {
      // Fallback is the portrait lock screen overlay below.
    });

    return () => {
      window.removeEventListener('resize', updateOrientationState);
      window.visualViewport?.removeEventListener('resize', updateOrientationState);
      window.screen?.orientation?.removeEventListener?.('change', updateOrientationState);
    };
  }, []);

  useEffect(() => {
    const folderInput = folderInputRef.current;

    if (!folderInput) {
      return;
    }

    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    setUseStreamingEngine(!isIOSNativeEngineSurface && searchParams.get('engine') === 'streaming');
    setShowDiagnostics(searchParams.get('debug') === '1');
    setHasResolvedEngineFlag(true);
  }, [isIOSNativeEngineSurface]);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasResolvedEngineFlag) {
      return;
    }

    if (isIOSNativeEngineSurface) {
      return;
    }

    const nextUrl = new URL(window.location.href);

    if (useStreamingEngine) {
      nextUrl.searchParams.set('engine', 'streaming');
    } else {
      nextUrl.searchParams.delete('engine');
    }

    if (showDiagnostics) {
      nextUrl.searchParams.set('debug', '1');
    } else {
      nextUrl.searchParams.delete('debug');
    }

    const nextHref = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    window.history.replaceState(window.history.state, '', nextHref);
  }, [hasResolvedEngineFlag, isIOSNativeEngineSurface, showDiagnostics, useStreamingEngine]);

  useEffect(() => {
    return () => {
      replaceOwnedObjectUrls([]);
    };
  }, [replaceOwnedObjectUrls]);

  useEffect(() => {
    return () => {
      if (resumeSectionsAutoScrollTimeoutRef.current !== null) {
        window.clearTimeout(resumeSectionsAutoScrollTimeoutRef.current);
        resumeSectionsAutoScrollTimeoutRef.current = null;
      }
    };
  }, []);

  const trackSignature = useMemo(() => (
    activeEngineTracks.map(track => `${track.id}:${track.url}`).join('|')
  ), [activeEngineTracks]);

  useEffect(() => {
    if (!isInitializingSession) {
      return;
    }
    if (loadProgress && loadProgress.total > 0) {
      const label = isIOSNativeEngineSurface ? 'Preparando motor Apple' : useStreamingEngine ? 'Preparando motor' : 'Cargando audio';
      setBusyMessage(`${label} ${loadProgress.loaded}/${loadProgress.total}...`);
    }
  }, [isIOSNativeEngineSurface, isInitializingSession, loadProgress, useStreamingEngine]);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      if (!hasResolvedEngineFlag) {
        return;
      }

      if (activeTracks.length === 0) {
        setIsInitializingSession(false);
        setBusyMessage(null);
        setLoadError(null);
        return;
      }

      setLoadError(null);
      setIsInitializingSession(true);
      setBusyMessage(isIOSNativeEngineSurface ? 'Iniciando motor Apple...' : useStreamingEngine ? 'Iniciando motor en flujo...' : 'Cargando buffers de audio...');
      setMutedTrackIds(new Set(activeTracks.filter((track) => track.isMuted).map((track) => track.id)));
      setSoloTrackId(null);

      const disabledCount = sessionTracks.length - activeTracks.length;
      console.info(
        `[LiveDirectorView] Loading ${activeTracks.length}/${sessionTracks.length} enabled tracks${nativeInternalPadTrack ? ' + internal pad' : ''}` +
          (disabledCount > 0 ? ` (skipping ${disabledCount} disabled/limited stem${disabledCount === 1 ? '' : 's'}).` : '.'),
      );

      try {
        await initialize(activeEngineTracks);
        if (cancelled) {
          return;
        }

        setIsInitializingSession(false);
        setBusyMessage(null);
        console.log(`[LiveDirectorView] Initialized ${activeEngineTracks.length} ${isIOSNativeEngineSurface ? 'native' : 'web'} track(s).`);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIsInitializingSession(false);
        setBusyMessage(null);
        console.error('[LiveDirectorView] Failed to initialize the multitrack engine.', error);
        setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los buffers de audio.');
      }
    };

    void setup();

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSignature, hasResolvedEngineFlag, initialize, isIOSNativeEngineSurface, reloadKey, stop, useStreamingEngine]);

  const loadWarningsKey = useMemo(() => {
    if (!loadWarnings || loadWarnings.length === 0) {
      return null;
    }

    return loadWarnings
      .map((warning) => `${warning.trackId}:${warning.reason}:${warning.fourCharCode || warning.osStatus || ''}`)
      .join('|');
  }, [loadWarnings]);

  useEffect(() => {
    if (!loadWarningsKey) {
      return;
    }
    // Reset dismissal whenever a fresh set of warnings arrives so the user sees the banner again.
    setDismissedLoadWarningKey((previous) => (previous === loadWarningsKey ? previous : null));
  }, [loadWarningsKey]);

  const showLoadWarningBanner = Boolean(
    loadWarnings && loadWarnings.length > 0 && dismissedLoadWarningKey !== loadWarningsKey
  );

  const stopMasterVolumeFade = useCallback(() => {
    if (masterVolumeFadeFrameRef.current !== null) {
      window.cancelAnimationFrame(masterVolumeFadeFrameRef.current);
      masterVolumeFadeFrameRef.current = null;
    }

    if (masterVolumeFadeResolveRef.current) {
      const resolveFade = masterVolumeFadeResolveRef.current;
      masterVolumeFadeResolveRef.current = null;
      resolveFade();
    }
  }, []);

  const applyMasterVolume = useCallback((nextVolume: number) => {
    const safeVolume = clamp(nextVolume, 0, 1);
    // Skip no-op calls: the native plugin already coalesces setMasterVolume
    // on rAF, but skipping redundant writes also avoids a `setMasterVolume`
    // React-state churn and a Capacitor bridge hop per frame when the fade
    // curve plateaus.
    if (Math.abs(appliedMasterVolumeRef.current - safeVolume) < 0.0005) {
      appliedMasterVolumeRef.current = safeVolume;
      return;
    }
    appliedMasterVolumeRef.current = safeVolume;
    setMasterVolume(safeVolume);
  }, [setMasterVolume]);

  const fadeMasterVolume = useCallback((targetVolume: number, durationMs: number, transitionToken: number) => (
    new Promise<void>((resolve) => {
      stopMasterVolumeFade();

      const safeTarget = clamp(targetVolume, 0, 1);
      const startVolume = appliedMasterVolumeRef.current;

      if (durationMs <= 0 || Math.abs(startVolume - safeTarget) < 0.001) {
        applyMasterVolume(safeTarget);
        resolve();
        return;
      }

      let startTime: number | null = null;

      const complete = () => {
        if (masterVolumeFadeResolveRef.current === complete) {
          masterVolumeFadeResolveRef.current = null;
        }
        masterVolumeFadeFrameRef.current = null;
        resolve();
      };

      const animate = (frameTime: number) => {
        if (sectionTransitionTokenRef.current !== transitionToken) {
          complete();
          return;
        }

        if (startTime === null) {
          startTime = frameTime;
        }

        const progress = clamp((frameTime - startTime) / durationMs, 0, 1);
        const easedProgress = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        applyMasterVolume(startVolume + (safeTarget - startVolume) * easedProgress);

        if (progress >= 1) {
          complete();
          return;
        }

        masterVolumeFadeFrameRef.current = window.requestAnimationFrame(animate);
      };

      masterVolumeFadeResolveRef.current = complete;
      masterVolumeFadeFrameRef.current = window.requestAnimationFrame(animate);
    })
  ), [applyMasterVolume, stopMasterVolumeFade]);

  useEffect(() => {
    masterVolumeRef.current = masterVolume;

    if (!isSectionTransitioningRef.current) {
      stopMasterVolumeFade();
      applyMasterVolume(masterVolume);
    }
  }, [applyMasterVolume, masterVolume, stopMasterVolumeFade]);

  useEffect(() => () => {
    sectionTransitionTokenRef.current += 1;
    isSectionTransitioningRef.current = false;
    stopMasterVolumeFade();
  }, [stopMasterVolumeFade]);

  const handleSectionSeek = useCallback(async (nextTime: number) => {
    if (!hasTrackSession) {
      return;
    }

    const safeTargetTime = Math.max(0, nextTime);
    if (!isReady || !isPlaying) {
      await seekTo(safeTargetTime);
      return;
    }

    if (Math.abs(currentTime - safeTargetTime) < 0.05) {
      return;
    }

    const transitionToken = sectionTransitionTokenRef.current + 1;
    sectionTransitionTokenRef.current = transitionToken;
    isSectionTransitioningRef.current = true;

    try {
      await fadeMasterVolume(0, SECTION_TRANSITION_FADE_OUT_MS, transitionToken);
      if (sectionTransitionTokenRef.current !== transitionToken) {
        return;
      }

      await seekTo(safeTargetTime);
      if (sectionTransitionTokenRef.current !== transitionToken) {
        return;
      }

      await fadeMasterVolume(masterVolumeRef.current, SECTION_TRANSITION_FADE_IN_MS, transitionToken);
    } finally {
      if (sectionTransitionTokenRef.current === transitionToken) {
        isSectionTransitioningRef.current = false;
        applyMasterVolume(masterVolumeRef.current);
      }
    }
  }, [applyMasterVolume, currentTime, fadeMasterVolume, hasTrackSession, isPlaying, isReady, seekTo]);

  useEffect(() => {
    if (isIOSNativeEngineSurface) {
      const padA = padAudioRefA.current;
      const padB = padAudioRefB.current;
      if (padFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(padFadeFrameRef.current);
        padFadeFrameRef.current = null;
      }
      if (padA) {
        padA.pause();
        padA.removeAttribute('src');
        padA.load();
      }
      if (padB) {
        padB.pause();
        padB.removeAttribute('src');
        padB.load();
      }
      padFadeTargetRefA.current = 0;
      padFadeTargetRefB.current = 0;
      return;
    }

    const padA = padAudioRefA.current;
    const padB = padAudioRefB.current;
    if (!padA || !padB) {
      return;
    }

    if (padFadeFrameRef.current !== null) {
      window.cancelAnimationFrame(padFadeFrameRef.current);
      padFadeFrameRef.current = null;
    }

    if (!resolvedPadUrl) {
      padFadeTargetRefA.current = 0;
      padFadeTargetRefB.current = 0;
      if (isPadActive) {
        setIsPadActive(false);
      }
    } else {
      const activePad = activePadChannelRef.current === 'A' ? padA : padB;

      if (!activePad.src || !activePad.src.includes(resolvedPadUrl)) {
        const previousChannel = activePadChannelRef.current;
        const nextChannel = previousChannel === 'A' ? 'B' : 'A';
        activePadChannelRef.current = nextChannel;

        const nextPad = nextChannel === 'A' ? padA : padB;
        const oldPad = previousChannel === 'A' ? padA : padB;

        nextPad.src = resolvedPadUrl;
        nextPad.loop = true;
        nextPad.volume = 0;

        if (isPadActive) {
          nextPad.play().catch((error) => {
            console.warn('[LiveDirectorView] Pad autoplay blocked.', error);
            setIsPadActive(false);
          });
        }

        if (oldPad === padA) {
          padFadeTargetRefA.current = 0;
          padFadeTargetRefB.current = isPadActive ? effectiveInternalPadVolume : 0;
        } else {
          padFadeTargetRefB.current = 0;
          padFadeTargetRefA.current = isPadActive ? effectiveInternalPadVolume : 0;
        }
      } else {
        if (activePadChannelRef.current === 'A') {
          padFadeTargetRefA.current = isPadActive ? effectiveInternalPadVolume : 0;
          padFadeTargetRefB.current = 0;
        } else {
          padFadeTargetRefB.current = isPadActive ? effectiveInternalPadVolume : 0;
          padFadeTargetRefA.current = 0;
        }

        if (isPadActive && activePad.paused) {
          activePad.play().catch((error) => {
            console.warn('[LiveDirectorView] Pad autoplay blocked.', error);
            setIsPadActive(false);
          });
        }
      }
    }

    let lastTime = performance.now();
    const FADE_DURATION_MS = 5000;

    const animateFade = (time: number) => {
      const deltaMs = time - lastTime;
      lastTime = time;

      let volA = clamp(padA.volume, 0, 1);
      let volB = clamp(padB.volume, 0, 1);
      const targetA = clamp(padFadeTargetRefA.current, 0, 1);
      const targetB = clamp(padFadeTargetRefB.current, 0, 1);

      const deltaVol = (1.0 / FADE_DURATION_MS) * deltaMs;

      if (Math.abs(volA - targetA) < 0.001) {
        padA.volume = clamp(targetA, 0, 1);
        if (targetA === 0 && !padA.paused) padA.pause();
      } else if (volA < targetA) {
        padA.volume = clamp(Math.min(targetA, volA + deltaVol), 0, 1);
      } else {
        padA.volume = clamp(Math.max(targetA, volA - deltaVol), 0, 1);
      }

      if (Math.abs(volB - targetB) < 0.001) {
        padB.volume = clamp(targetB, 0, 1);
        if (targetB === 0 && !padB.paused) padB.pause();
      } else if (volB < targetB) {
        padB.volume = clamp(Math.min(targetB, volB + deltaVol), 0, 1);
      } else {
        padB.volume = clamp(Math.max(targetB, volB - deltaVol), 0, 1);
      }

      if (Math.abs(padA.volume - targetA) >= 0.001 || Math.abs(padB.volume - targetB) >= 0.001) {
        padFadeFrameRef.current = window.requestAnimationFrame(animateFade);
      } else {
        padFadeFrameRef.current = null;
      }
    };

    padFadeFrameRef.current = window.requestAnimationFrame(animateFade);

    return () => {
      if (padFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(padFadeFrameRef.current);
        padFadeFrameRef.current = null;
      }
    };
  }, [effectiveInternalPadVolume, isIOSNativeEngineSurface, isPadActive, resolvedPadUrl]);

  const persistSongSession = useCallback(async (payload: {
    mode: 'sequence' | 'folder';
    tracks: Array<TrackData & { sourceFileName?: string }>;
    unmatchedFiles?: string[];
    sectionOffsetSeconds?: number;
  }) => {
    if (!hasPersistedSongContext) {
      throw new Error('No hay una cancion seleccionada para guardar esta sesion.');
    }

    setBusyMessage('Guardando sesion multitrack...');
    try {
      const sessionPayload = buildSessionSavePayload({
        mode: payload.mode,
        tracks: payload.tracks,
        unmatchedFiles: payload.unmatchedFiles || [],
        sectionOffsetSeconds: Number.isFinite(Number(payload.sectionOffsetSeconds))
          ? Number(payload.sectionOffsetSeconds)
          : sectionOffsetSeconds,
      });

      if (!sessionPayload) {
        throw new Error('No se pudo preparar la sesion para guardarla.');
      }

      const savedSession = await enqueueSessionSave(() => saveLiveDirectorSongSession({
        songId,
        session: sessionPayload,
      }));

      applyManualSession(toResolvedSession(savedSession));
      onSessionPersisted?.(savedSession);
      return savedSession;
    } finally {
      setBusyMessage(null);
    }
  }, [applyManualSession, buildSessionSavePayload, enqueueSessionSave, hasPersistedSongContext, onSessionPersisted, sectionOffsetSeconds, songId]);

  const updateSectionOffsetLocally = useCallback((nextOffset: number) => {
    const safeOffset = Math.round(nextOffset * 4) / 4;
    setManualSession((previous) => (
      previous
        ? {
          ...previous,
          sectionOffsetSeconds: safeOffset,
        }
        : previous
    ));
  }, []);

  const commitSectionOffset = useCallback(async () => {
    if (!hasPersistedSongContext || !manualSession) {
      return;
    }

    const safeOffset = Number(manualSession.sectionOffsetSeconds) || 0;
    const syncedTracks = manualSession.tracks.map((track) => ({
      ...track,
      volume: trackVolumes[track.id] ?? track.volume,
      isMuted: mutedTrackIds.has(track.id),
      outputRoute: trackOutputRoutes[track.id] ?? resolveTrackOutputRoute(track),
    }));
    const sessionPayload = buildSessionSavePayload({
      mode: manualSession.mode,
      tracks: syncedTracks,
      unmatchedFiles: manualSession.unmatchedFiles || [],
      sectionOffsetSeconds: safeOffset,
    });

    try {
      setBusyMessage('Guardando desplazamiento de secciones...');
      if (!sessionPayload) {
        throw new Error('No se pudo preparar el guardado del desfase.');
      }
      const savedSession = await enqueueSessionSave(() => saveLiveDirectorSongSession({
        songId,
        session: sessionPayload,
      }));
      syncManualSessionState(toResolvedSession(savedSession));
      onSessionPersisted?.(savedSession);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo guardar el offset de secciones.');
    } finally {
      setBusyMessage(null);
    }
  }, [buildSessionSavePayload, enqueueSessionSave, hasPersistedSongContext, manualSession, mutedTrackIds, onSessionPersisted, songId, syncManualSessionState, trackOutputRoutes, trackVolumes]);

  const commitMixerStateSilent = useCallback((tracksOverride?: TrackData[]) => {
    if (!hasPersistedSongContext || !manualSession) {
      return;
    }

    const currentVolumes = trackVolumes;
    const currentMutes = mutedTrackIds;

    const sourceTracks = tracksOverride || manualSession.tracks;
    const nextTracks = sourceTracks.map((track) => ({
      ...track,
      volume: currentVolumes[track.id] ?? track.volume,
      isMuted: currentMutes.has(track.id),
      outputRoute: trackOutputRoutes[track.id] ?? resolveTrackOutputRoute(track),
    }));

    setManualSession((previous) => (
      previous ? { ...previous, tracks: nextTracks } : previous
    ));

    queueSilentSessionSave(buildSessionSavePayload({
      mode: manualSession.mode,
      tracks: nextTracks,
      unmatchedFiles: manualSession.unmatchedFiles || [],
      sectionOffsetSeconds: Number(manualSession.sectionOffsetSeconds) || 0,
    }));
  }, [buildSessionSavePayload, hasPersistedSongContext, manualSession, mutedTrackIds, queueSilentSessionSave, trackOutputRoutes, trackVolumes]);

  const mixerAutosaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hasPersistedSongContext || !manualSession || isInitializingSession) return;

    const isDirty = manualSession.tracks.some(
      (t) => (trackVolumes[t.id] !== undefined && trackVolumes[t.id] !== t.volume) ||
        (mutedTrackIds.has(t.id) !== t.isMuted) ||
        ((trackOutputRoutes[t.id] ?? resolveTrackOutputRoute(t)) !== resolveTrackOutputRoute(t))
    );

    if (isDirty) {
      if (mixerAutosaveTimerRef.current !== null) {
        window.clearTimeout(mixerAutosaveTimerRef.current);
      }

      const runAutosaveWhenIdle = () => {
        if (mixerInteractionActiveRef.current) {
          mixerAutosaveTimerRef.current = window.setTimeout(runAutosaveWhenIdle, 500);
          return;
        }

        mixerAutosaveTimerRef.current = null;
        commitMixerStateSilent();
      };

      mixerAutosaveTimerRef.current = window.setTimeout(runAutosaveWhenIdle, 1000);
    }

    return () => {
      if (mixerAutosaveTimerRef.current !== null) {
        window.clearTimeout(mixerAutosaveTimerRef.current);
      }
    };
  }, [trackOutputRoutes, trackVolumes, mutedTrackIds, manualSession, commitMixerStateSilent, hasPersistedSongContext, isInitializingSession]);

  // Persist newly-computed activity envelopes exactly once. When either the
  // iOS native engine or the web engine finishes loading tracks it hands us a
  // fresh `trackEnvelopes` map. We push that snapshot back into R2 via the
  // silent save queue so subsequent reloads (including cold iPhone starts)
  // skip the per-track envelope computation entirely.
  const persistedEnvelopeSignatureRef = useRef<string>('');
  useEffect(() => {
    if (!hasPersistedSongContext || !manualSession || isInitializingSession) return;

    const entries = manualSession.tracks
      .map((track) => {
        const envelope = trackEnvelopes[track.id];
        if (!envelope) return null;
        if (track.activityEnvelope && track.activityEnvelope === envelope) return null;
        return `${track.id}:${envelope.bucketMs}:${envelope.values.length}`;
      })
      .filter((value): value is string => value !== null);

    if (entries.length === 0) {
      return;
    }

    const signature = entries.sort().join('|');
    if (signature === persistedEnvelopeSignatureRef.current) {
      return;
    }
    persistedEnvelopeSignatureRef.current = signature;

    console.info(
      `[LiveDirectorView] Persisting activity envelopes for ${entries.length} track(s).`,
    );
    commitMixerStateSilent();
  }, [commitMixerStateSilent, hasPersistedSongContext, isInitializingSession, manualSession, trackEnvelopes]);

  const handleToggleTrackEnabled = useCallback((trackId: string) => {
    if (!manualSession || manualSession.mode !== 'folder' || manualSession.tracks.length <= 1) {
      return;
    }

    const nextTracks = manualSession.tracks.map((track) => (
      track.id === trackId
        ? { ...track, enabled: track.enabled === false ? true : false }
        : track
    ));

    const hasAnyEnabledTrack = nextTracks.some((track) => track.enabled !== false);
    if (!hasAnyEnabledTrack) {
      return;
    }

    setManualSession((previous) => (
      previous ? { ...previous, tracks: nextTracks } : previous
    ));

    if (hasPersistedSongContext) {
      void commitMixerStateSilent(nextTracks);
    }
  }, [commitMixerStateSilent, hasPersistedSongContext, manualSession]);

  const handleCloseTrackLoadModal = useCallback(() => {
    if (pendingEnabledMap && manualSession) {
      let enabledCount = 0;
      const nextTracks = manualSession.tracks.map((track) => {
        const wantsEnabled = pendingEnabledMap[track.id] !== false;
        // All platforms now have a finite cap (iOS 15, Android 10, web 15).
        // Previous versions treated iOS native as unlimited — that was wrong:
        // AVAudioEngine also slips past 15 stems. The cap is enforced here
        // regardless of engine surface so the user gets consistent gating.
        const canEnable = !wantsEnabled || enabledCount < webActiveTrackLimit;
        const enabled = wantsEnabled && canEnable;
        if (enabled) {
          enabledCount += 1;
        }
        return {
          ...track,
          enabled,
        };
      });
      const hasAnyEnabled = nextTracks.some((t) => t.enabled !== false);
      if (hasAnyEnabled) {
        setManualSession((prev) => prev ? { ...prev, tracks: nextTracks } : prev);
        if (hasPersistedSongContext) {
          void commitMixerStateSilent(nextTracks);
        }
      }
    }
    setPendingEnabledMap(null);
    setShowTrackLoadModal(false);
  }, [pendingEnabledMap, manualSession, isIOSNativeEngineSurface, webActiveTrackLimit, hasPersistedSongContext, commitMixerStateSilent]);

  const handleOpenOffsetModal = useCallback(() => {
    offsetModalInitialValueRef.current = Number.isFinite(Number(manualSession?.sectionOffsetSeconds))
      ? Number(manualSession?.sectionOffsetSeconds)
      : 0;
    setShowOffsetModal(true);
  }, [manualSession?.sectionOffsetSeconds]);

  const handleCloseOffsetModal = useCallback(() => {
    setShowOffsetModal(false);
    const currentOffset = Number.isFinite(Number(manualSession?.sectionOffsetSeconds))
      ? Number(manualSession?.sectionOffsetSeconds)
      : 0;

    if (offsetModalInitialValueRef.current !== null && offsetModalInitialValueRef.current !== currentOffset) {
      void commitSectionOffset();
    }
    offsetModalInitialValueRef.current = null;
  }, [commitSectionOffset, manualSession?.sectionOffsetSeconds]);

  const handleSequenceFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      if (hasPersistedSongContext) {
        setBusyMessage(`Uploading ${file.name}...`);
        const uploadTarget = await requestLiveDirectorUploadTarget({
          songId,
          fileName: `sequence-${file.name}`,
          fileType: file.type,
          kind: 'playback',
        });

        await uploadFileToLiveDirectorTarget(file, uploadTarget);
        await persistSongSession({
          mode: 'sequence',
          tracks: [
            {
              id: 'sequence',
              name: 'Sequence',
              url: uploadTarget.publicUrl,
              volume: 0.84,
              isMuted: false,
              sourceFileName: file.name,
            },
          ],
        });
        return;
      }

      applyManualSession(createSequenceSessionFromFile(file));
    } catch (error) {
      setBusyMessage(null);
      setLoadError(error instanceof Error ? error.message : 'No se pudo cargar el archivo de secuencia.');
    }
  };

  const handleStemFolderSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';

    if (files.length === 0) {
      return;
    }

    try {
      console.info('[LiveDirectorView] Stem folder selected.', {
        songId,
        totalFiles: files.length,
      });

      if (hasPersistedSongContext) {
        setBusyMessage(`Inspeccionando ${files.length} archivos...`);
        const inference = inferStemTracksFromFiles(files);
        console.info('[LiveDirectorView] Stem inference completed.', {
          matchedFiles: inference.matchedFiles.length,
          unmatchedFiles: inference.unmatchedFiles.length,
        });

        const total = inference.matchedFiles.length;
        let completed = 0;
        setBusyMessage(`Subiendo 0/${total} stems...`);

        const UPLOAD_CONCURRENCY = 3;
        const uploadedTracks: Array<{
          id: string;
          name: string;
          url: string;
          volume: number;
          isMuted: boolean;
          sourceFileName: string;
        }> = new Array(total);

        let nextIndex = 0;
        let firstError: unknown = null;

        const runners = new Array(Math.min(UPLOAD_CONCURRENCY, Math.max(1, total)))
          .fill(null)
          .map(async () => {
            while (true) {
              if (firstError) {
                return;
              }
              const currentIndex = nextIndex++;
              if (currentIndex >= total) {
                return;
              }
              const matchedFile = inference.matchedFiles[currentIndex];
              try {
                const uploadTarget = await requestLiveDirectorUploadTarget({
                  songId,
                  fileName: `${matchedFile.trackId}-${matchedFile.file.name}`,
                  fileType: matchedFile.file.type,
                  kind: 'stems',
                });

                await uploadFileToLiveDirectorTarget(matchedFile.file, uploadTarget);

                uploadedTracks[currentIndex] = {
                  id: matchedFile.trackId,
                  name: matchedFile.trackName,
                  url: uploadTarget.publicUrl,
                  volume: matchedFile.defaultVolume,
                  isMuted: false,
                  sourceFileName: matchedFile.file.name,
                };

                completed += 1;
                setBusyMessage(`Subiendo ${completed}/${total} stems...`);
              } catch (error) {
                if (!firstError) {
                  firstError = error;
                }
                return;
              }
            }
          });

        await Promise.all(runners);

        if (firstError) {
          throw firstError;
        }

        console.info('[LiveDirectorView] Stem upload completed.', {
          uploadedTracks: uploadedTracks.length,
        });
        await persistSongSession({
          mode: 'folder',
          tracks: uploadedTracks,
          unmatchedFiles: inference.unmatchedFiles,
        });
        return;
      }

      applyManualSession(createStemSessionFromFolder(files));
    } catch (error) {
      console.error('[LiveDirectorView] Stem folder load failed.', error);
      setBusyMessage(null);
      setLoadError(error instanceof Error ? error.message : 'No se pudo cargar la carpeta de stems.');
    }
  };

  const handlePreviousSection = () => {
    if (!hasTrackSession) {
      return;
    }

    if (resolvedSections.length === 0) {
      void handleSectionSeek(0);
      return;
    }

    const currentSection = resolvedSections[activeSectionIndex];
    if (currentSection && (currentTime - currentSection.startTime > 2.5)) {
      void handleSectionSeek(currentSection.startTime);
      return;
    }

    const targetIndex = Math.max(0, activeSectionIndex - 1);
    const targetSection = resolvedSections[targetIndex];
    void handleSectionSeek(targetSection?.startTime ?? 0);
  };

  const handleNextSection = () => {
    if (!hasTrackSession) {
      return;
    }

    if (resolvedSections.length === 0) {
      return;
    }

    const lastIndex = resolvedSections.length - 1;
    const targetIndex = Math.min(lastIndex, activeSectionIndex + 1);
    const targetSection = resolvedSections[targetIndex];
    if (!targetSection) {
      return;
    }

    // If we're already on the last section, snap to its start (useful for
    // re-cueing the outro) instead of doing nothing.
    void handleSectionSeek(targetSection.startTime);
  };

  // Stable ref-based bridge for the native remoteCommand listener below —
  // the listener is registered once per mount but needs to dispatch to the
  // latest section handlers without re-registering on every render.
  const handlePreviousSectionRef = useRef(handlePreviousSection);
  const handleNextSectionRef = useRef(handleNextSection);
  useEffect(() => {
    handlePreviousSectionRef.current = handlePreviousSection;
    handleNextSectionRef.current = handleNextSection;
  });

  // Lock-screen / Control Center remote commands, iOS native only. The
  // Swift plugin forwards Next Track / Previous Track button presses to
  // us as 'remoteCommand' events so we can translate them into section
  // jumps in the current song. Play / pause / scrub are handled inside
  // the plugin itself — no JS wiring needed.
  useEffect(() => {
    if (!isIOSNativeEngineSurface) return;
    if (!isNativeLiveDirectorEngineAvailable()) return;
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    let disposed = false;
    void NativeLiveDirectorEngine.addListener('remoteCommand', (command) => {
      if (disposed) return;
      if (command?.action === 'previousSection') {
        handlePreviousSectionRef.current();
      } else if (command?.action === 'nextSection') {
        handleNextSectionRef.current();
      }
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
      } else {
        listenerHandle = handle;
      }
    });
    return () => {
      disposed = true;
      void listenerHandle?.remove();
    };
  }, [isIOSNativeEngineSurface]);

  // Push song metadata to the iOS lock-screen / Control Center Now Playing
  // card whenever the identifying fields change. Clears the card on unmount
  // so the lock screen doesn't keep advertising a song we're no longer
  // playing.
  useEffect(() => {
    if (!isIOSNativeEngineSurface) return;
    if (!isNativeLiveDirectorEngineAvailable()) return;
    const title = (songCardTitle || songTitle || 'Live Director').trim();
    const artist = performerLabel || undefined;
    const albumTitle = songKey ? `Tonalidad ${songKey}` : undefined;
    void NativeLiveDirectorEngine.setNowPlayingMetadata({
      title,
      artist,
      albumTitle,
    }).catch(() => undefined);
    return () => {
      void NativeLiveDirectorEngine.clearNowPlayingMetadata().catch(() => undefined);
    };
  }, [isIOSNativeEngineSurface, songCardTitle, songTitle, performerLabel, songKey]);

  const handleLoopIn = () => {
    if (activeSection) {
      setLoopPoints(activeSection.startTime, activeSection.endTime);
    } else {
      const safeStart = clamp(currentTime, 0, playbackTimelineDuration);
      setLoopPoints(safeStart, Math.min(playbackTimelineDuration, safeStart + 8));
    }
    if (!loopEnabled) {
      toggleLoop();
      setLoopEnabled(true);
    }
  };

  const handleLoopOut = () => {
    if (loopEnabled) {
      toggleLoop();
      setLoopEnabled(false);
    }
  };

  const handleMuteTrack = (trackId: string) => {
    if (!hasTrackSession) {
      return;
    }

    toggleMute(trackId);
    setMutedTrackIds((previous) => {
      const next = new Set(previous);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  };

  const handleSoloTrack = (trackId: string) => {
    if (!hasTrackSession) {
      return;
    }

    soloTrack(trackId);
    setSoloTrackId((previous) => (previous === trackId ? null : trackId));
  };

  const handleToggleGuideTrackRoute = useCallback((trackId: string) => {
    if (!hasTrackSession) {
      return;
    }

    const sourceTracks = hasProvidedTracks ? sessionTracks : manualSession?.tracks || [];
    const targetTrack = sourceTracks.find((track) => track.id === trackId);

    if (!targetTrack || !isGuideRoutingTrack(targetTrack)) {
      return;
    }

    const currentOutputRoute = trackOutputRoutes[trackId] ?? resolveTrackOutputRoute(targetTrack);
    const nextOutputRoute = toggleGuideTrackOutputRoute({
      ...targetTrack,
      outputRoute: currentOutputRoute,
    });

    setTrackOutputRoutes((previous) => ({
      ...previous,
      [trackId]: nextOutputRoute,
    }));
    setTrackOutputRoute(trackId, nextOutputRoute);

    if (!manualSession) {
      return;
    }

    const nextTracks = manualSession.tracks.map((track) => (
      track.id === trackId
        ? { ...track, outputRoute: nextOutputRoute }
        : track
    ));

    setManualSession((previous) => (
      previous ? { ...previous, tracks: nextTracks } : previous
    ));

    if (hasPersistedSongContext) {
      void commitMixerStateSilent(nextTracks);
    }
  }, [commitMixerStateSilent, hasPersistedSongContext, hasProvidedTracks, hasTrackSession, manualSession, sessionTracks, setTrackOutputRoute, trackOutputRoutes]);

  const handleEngineToggle = useCallback(() => {
    if (isIOSNativeEngineSurface) {
      return;
    }

    setLoadError(null);
    setBusyMessage(null);
    setIsInitializingSession(false);
    setUseStreamingEngine((previous) => !previous);
  }, [isIOSNativeEngineSurface]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (showLoadPanel || showTrackLoadModal || shouldIgnoreKeyboardShortcutTarget(event.target)) {
        return;
      }

      if (event.code !== 'Space' && event.key !== ' ') {
        return;
      }

      if (!isReady) {
        return;
      }

      event.preventDefault();

      if (isPlaying) {
        pause();
        return;
      }

      void play();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPlaying, isReady, pause, play, showLoadPanel, showTrackLoadModal]);

  const handleInternalPadVolumeChange = useCallback((nextVolume: number) => {
    const safeValue = clamp(nextVolume, 0, 1);

    setInternalPadVolumeState(safeValue);

    if (typeof onInternalPadVolumeChange === 'function') {
      onInternalPadVolumeChange(safeValue);
    }
  }, [onInternalPadVolumeChange]);

  useEffect(() => {
    if (!resolvedPadUrl && isPadActive) {
      setIsPadActive(false);
    }
  }, [isPadActive, resolvedPadUrl]);

  useEffect(() => {
    if (!shouldUseNativeInternalPad || !isReady) {
      return;
    }

    setVolume(INTERNAL_PAD_TRACK_ID, isPadActive ? effectiveInternalPadVolume : 0);
  }, [effectiveInternalPadVolume, isPadActive, isReady, setVolume, shouldUseNativeInternalPad]);

  // Keep the ref pointed at the latest parent-side handlers so the stable
  // per-track callbacks returned by getChannelStripCallbacks always see the
  // current closures without needing to recreate themselves.
  channelStripHandlersRef.current = {
    handleInternalPadVolumeChange,
    setVolume,
    handleMuteTrack,
    handleSoloTrack,
    handleToggleGuideTrackRoute,
    setIsPadActive,
    isPadActive,
  };

  const endMixerDrag = useCallback((pointerId?: number) => {
    const container = mixerScrollRef.current;
    const dragState = mixerDragStateRef.current;

    if (!dragState.active) {
      return;
    }

    if (typeof pointerId === 'number' && dragState.pointerId !== pointerId) {
      return;
    }

    if (container && dragState.pointerId !== null) {
      try {
        container.releasePointerCapture(dragState.pointerId);
      } catch {
        // no-op
      }
    }

    mixerDragStateRef.current = {
      active: false,
      pointerId: null,
      startX: 0,
      startScrollLeft: 0,
    };
    resumeNativeMetersSoon();
  }, [resumeNativeMetersSoon]);

  const handleMixerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = mixerScrollRef.current;

    if (!container) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (shouldIgnoreDragScrollTarget(event.target)) {
      return;
    }

    mixerDragStateRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
    };
    suspendNativeMeters();

    try {
      container.setPointerCapture(event.pointerId);
    } catch {
      // no-op
    }
  }, [suspendNativeMeters]);

  const handleMixerPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = mixerScrollRef.current;
    const dragState = mixerDragStateRef.current;

    if (!container || !dragState.active || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;

    if (Math.abs(deltaX) < 2) {
      return;
    }

    container.scrollLeft = dragState.startScrollLeft - deltaX;
    event.preventDefault();
  }, []);

  const handleMixerPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    endMixerDrag(event.pointerId);
  }, [endMixerDrag]);

  // How long after the last user interaction with the sections lane we wait
  // before auto-follow re-engages. 5s matches the user's request and is a
  // comfortable window to explore without the playhead pulling you back.
  const SECTIONS_AUTO_FOLLOW_RESUME_MS = 5000;

  // Internal: schedule (or cancel) the resume timer. When the timer fires,
  // the next auto-follow pass will smooth-scroll back to the playhead.
  const scheduleSectionsAutoFollowResume = useCallback(() => {
    if (resumeSectionsAutoScrollTimeoutRef.current !== null) {
      window.clearTimeout(resumeSectionsAutoScrollTimeoutRef.current);
    }
    setSectionsAutoFollowStatus('resuming');
    resumeSectionsAutoScrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingSectionsRef.current = false;
      sectionsAutoFollowShouldSmoothRef.current = true;
      resumeSectionsAutoScrollTimeoutRef.current = null;
      setSectionsAutoFollowStatus('auto');
    }, SECTIONS_AUTO_FOLLOW_RESUME_MS);
  }, []);

  // Used while the user is actively dragging / wheel-scrolling: blocks the
  // auto-follow and cancels any pending resume. The resume is programmed when
  // the interaction ends (pointerUp) or — for wheel — on each wheel event so
  // continuous scrolling keeps pushing the resume forward.
  const holdSectionsAutoFollow = useCallback(() => {
    isUserScrollingSectionsRef.current = true;
    if (resumeSectionsAutoScrollTimeoutRef.current !== null) {
      window.clearTimeout(resumeSectionsAutoScrollTimeoutRef.current);
      resumeSectionsAutoScrollTimeoutRef.current = null;
    }
    setSectionsAutoFollowStatus('held');
  }, []);

  // Back-compat name kept for the wheel handler: each wheel tick extends the
  // resume window by 5s from "now".
  const triggerUserScrollSections = useCallback(() => {
    isUserScrollingSectionsRef.current = true;
    scheduleSectionsAutoFollowResume();
  }, [scheduleSectionsAutoFollowResume]);

  const endSectionsDrag = useCallback((pointerId?: number) => {
    const container = sectionsLaneScrollRef.current;
    const dragState = sectionsDragStateRef.current;

    if (!dragState.active) {
      return;
    }

    if (typeof pointerId === 'number' && dragState.pointerId !== pointerId) {
      return;
    }

    if (container && dragState.pointerId !== null) {
      try {
        container.releasePointerCapture(dragState.pointerId);
      } catch {
        // no-op
      }
    }

    sectionsDragStateRef.current = {
      active: false,
      pointerId: null,
      startX: 0,
      startScrollLeft: 0,
    };
    // Drag finished: now start the 5s countdown to resume auto-follow.
    scheduleSectionsAutoFollowResume();
  }, [scheduleSectionsAutoFollowResume]);

  const handleSectionsPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = sectionsLaneScrollRef.current;
    if (!container) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (shouldIgnoreDragScrollTarget(event.target)) return;

    // Hold (no timeout) — resume will be armed on pointerUp / endSectionsDrag.
    holdSectionsAutoFollow();

    sectionsDragStateRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
    };

    try {
      container.setPointerCapture(event.pointerId);
    } catch {
      // no-op
    }
  }, [holdSectionsAutoFollow]);

  const handleSectionsPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = sectionsLaneScrollRef.current;
    const dragState = sectionsDragStateRef.current;

    if (!container || !dragState.active || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) < 2) return;

    container.scrollLeft = dragState.startScrollLeft - deltaX;
    event.preventDefault();
  }, []);

  const handleSectionsPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    endSectionsDrag(event.pointerId);
  }, [endSectionsDrag]);

  // ─── Minimap interaction ──────────────────────────────────────────────────
  // The minimap is a tap-and-drag scrub target. We convert clientX to a time
  // via the track's bounding rect and call the same seek used by the section
  // buttons. Drag is captured so finger-outside-rect keeps scrubbing.
  const minimapTrackRef = useRef<HTMLDivElement | null>(null);
  const minimapDragActiveRef = useRef(false);
  const minimapDragPointerIdRef = useRef<number | null>(null);
  // When set, render a tooltip above the minimap showing the section name and
  // timestamp at the hovered/dragged position. Cleared when the finger lifts.
  const [minimapHoverTime, setMinimapHoverTime] = useState<number | null>(null);

  const minimapXToTime = useCallback((clientX: number): number => {
    const node = minimapTrackRef.current;
    if (!node || playbackTimelineDuration <= 0) return 0;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const x = clamp(clientX - rect.left, 0, rect.width);
    return (x / rect.width) * playbackTimelineDuration;
  }, [playbackTimelineDuration]);

  const handleMinimapPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const node = minimapTrackRef.current;
    if (!node) return;

    minimapDragActiveRef.current = true;
    minimapDragPointerIdRef.current = event.pointerId;
    try { node.setPointerCapture(event.pointerId); } catch { /* no-op */ }

    // Hold auto-follow while scrubbing from the minimap, so the big lane
    // doesn't yank you back mid-drag.
    holdSectionsAutoFollow();

    const t = minimapXToTime(event.clientX);
    setMinimapHoverTime(t);
    void handleSectionSeek(t);
    event.preventDefault();
  }, [handleSectionSeek, holdSectionsAutoFollow, minimapXToTime]);

  const handleMinimapPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!minimapDragActiveRef.current) return;
    if (minimapDragPointerIdRef.current !== event.pointerId) return;
    const t = minimapXToTime(event.clientX);
    setMinimapHoverTime(t);
    void handleSectionSeek(t);
    event.preventDefault();
  }, [handleSectionSeek, minimapXToTime]);

  const endMinimapDrag = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    if (!minimapDragActiveRef.current) return;
    const node = minimapTrackRef.current;
    if (node && event && minimapDragPointerIdRef.current === event.pointerId) {
      try { node.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    }
    minimapDragActiveRef.current = false;
    minimapDragPointerIdRef.current = null;
    setMinimapHoverTime(null);
    // Arm the 5s resume so the big lane auto-follow eventually retakes.
    scheduleSectionsAutoFollowResume();
  }, [scheduleSectionsAutoFollowResume]);

  const handleMinimapPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    endMinimapDrag(event);
  }, [endMinimapDrag]);

  const pendingEnabledCount = pendingEnabledMap
    ? Object.values(pendingEnabledMap).filter(Boolean).length
    : activeTracks.length;
  const pendingEffectiveEnabledCount = isIOSNativeEngineSurface
    ? pendingEnabledCount
    : Math.min(pendingEnabledCount, webActiveTrackLimit);

  const readyStateLabel = !hasTrackSession
    ? 'Sin sesion'
    : busyMessage
      ? 'Preparando'
      : isInitializingSession
        ? 'Cargando'
        : loadError
          ? 'Error'
          : isReady
            ? (isPlaying ? 'En marcha' : 'Armado')
            : 'En espera';

  const shellClassName = ['fixed inset-0 z-[70] overflow-hidden bg-[#202223] text-white', className]
    .filter(Boolean)
    .join(' ');
  const shellContentStyle = useMemo(
    () => {
      const sideInset = isNativeIosShell && !isPortrait
        ? scaleRem(isUltraCompactLandscape ? 3.35 : isCompactLandscape ? 3.65 : 4, 2.85, 4.15)
        : scaleRem(isUltraCompactLandscape ? 0.3 : isCompactLandscape ? 0.75 : 1, 0.22);
      const topInset = isNativeIosShell
        ? scaleRem(isUltraCompactLandscape ? 0.45 : isCompactLandscape ? 0.75 : 1, 0.42)
        : scaleRem(isUltraCompactLandscape ? 0.22 : isCompactLandscape ? 0.6 : 0.8, 0.18);
      const bottomInset = isNativeIosShell
        ? scaleRem(isUltraCompactLandscape ? 0.85 : isCompactLandscape ? 1 : 1.15, 0.75)
        : scaleRem(isUltraCompactLandscape ? 0.25 : isCompactLandscape ? 0.75 : 1, 0.2);

      return ({
        height: '100dvh',
        minHeight: '100dvh',
        maxHeight: '100dvh',
        paddingTop: `max(env(safe-area-inset-top), ${topInset})`,
        paddingRight: `max(env(safe-area-inset-right), ${sideInset})`,
        paddingBottom: `max(env(safe-area-inset-bottom), ${bottomInset})`,
        paddingLeft: `max(env(safe-area-inset-left), ${sideInset})`,
        gap: scaleRem(isUltraCompactLandscape ? 0.12 : isCompactLandscape ? 0.6 : 1, 0.08),
        ['--ld-control-height' as string]: scaleRem(isUltraCompactLandscape ? 2.95 : isCompactLandscape ? 4.2 : 5.15, 2.35),
        ['--ld-summary-row-height' as string]: scaleRem(isUltraCompactLandscape ? 3.95 : isCompactLandscape ? 5.4 : 8.9, 3.2),
        ['--ld-sections-row-height' as string]: scaleRem(isUltraCompactLandscape ? 8.6 : isCompactLandscape ? 10.9 : 12.4, 6.4),
      }) as CSSProperties;
    },
    [isCompactLandscape, isNativeIosShell, isPortrait, isUltraCompactLandscape, scaleRem],
  );
  const overlayPaddingStyle = useMemo(
    () => {
      const defaultInset = scaleRem(isCompactLandscape ? 1 : 2, 1);
      const topInset = isNativeIosShell ? scaleRem(3.25, 2.75, 3.8) : defaultInset;
      const bottomInset = isNativeIosShell ? scaleRem(1.4, 1.1, 1.6) : defaultInset;

      return ({
        paddingTop: `max(env(safe-area-inset-top), ${topInset})`,
        paddingRight: `max(env(safe-area-inset-right), ${defaultInset})`,
        paddingBottom: `max(env(safe-area-inset-bottom), ${bottomInset})`,
        paddingLeft: `max(env(safe-area-inset-left), ${defaultInset})`,
      }) as CSSProperties;
    },
    [isCompactLandscape, isNativeIosShell, scaleRem],
  );

  if (isPortrait) {
    return (
      <div className={shellClassName}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(86,207,255,0.12),_transparent_34%),linear-gradient(180deg,#232628_0%,#17191b_100%)]" />
        <div className="relative flex h-full items-center justify-center" style={overlayPaddingStyle}>
          <div className="max-w-md rounded-[2rem] border border-white/10 bg-black/30 px-8 py-10 text-center shadow-[0_32px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-cyan-300/20 bg-cyan-300/8 text-cyan-100 shadow-[0_0_26px_rgba(92,207,230,0.18)]">
              <Smartphone className="h-10 w-10 rotate-90" />
            </div>
            <h2 className="mt-6 text-3xl font-semibold tracking-tight text-white">Modo horizontal obligatorio</h2>
            <p className="mt-3 text-lg leading-relaxed text-white/62">
              Esta superficie de direccion en vivo solo funciona en horizontal para uso en escenario.
              Gira el dispositivo para continuar.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (requiresSongContext && !hasPersistedSongContext) {
    return (
      <div className={shellClassName}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(93,214,240,0.08),_transparent_24%),linear-gradient(180deg,#232526_0%,#222425_46%,#202224_100%)]" />
        <div className="relative flex h-full items-center justify-center" style={overlayPaddingStyle}>
          <div className="max-w-2xl rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,19,21,0.94),rgba(13,15,16,0.94))] px-8 py-9 text-center shadow-[0_32px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
            <p className="text-[0.8rem] font-black uppercase tracking-[0.3em] text-cyan-100/62">Cancion requerida</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
              Live Director solo se abre desde una cancion real de la base de datos.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-white/62">
              Esta superficie no acepta cargas sueltas. Abrela desde <span className="font-semibold text-white/84">Repertorio</span> en la fila de la cancion que quieras preparar.
            </p>
            <div className="mt-6 rounded-[1.4rem] border border-white/8 bg-black/24 px-5 py-4 text-left">
              <p className="text-[0.74rem] font-black uppercase tracking-[0.24em] text-white/40">Flujo correcto</p>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                1. Ve a <span className="font-semibold text-white/80">Repertorio</span>.
                2. Busca la cancion.
                3. Pulsa <span className="font-semibold text-white/80">Multitrack</span>.
                4. Desde ahi sube la secuencia o los stems y quedaran guardados bajo esa cancion.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClassName}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(93,214,240,0.08),_transparent_24%),linear-gradient(180deg,#232526_0%,#222425_46%,#202224_100%)]" />
      <div className="relative flex h-[100dvh] flex-col overflow-hidden" style={shellContentStyle}>
        <div className={`hide-scrollbar -mx-1 shrink-0 overflow-x-auto ${isUltraCompactLandscape ? 'pb-0' : isCompactLandscape ? 'pb-0' : 'pb-1'}`}>
          <header
            className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center ${isUltraCompactLandscape ? 'gap-1 px-0' : isCompactLandscape ? 'gap-2 px-0.5' : 'gap-2.5 px-1'}`}
            style={{ minWidth: headerMinWidth }}
          >
            <div className={`flex items-stretch ${isUltraCompactLandscape ? 'gap-1' : isCompactLandscape ? 'gap-2' : 'gap-2.5'}`}>
              <button
                type="button"
                onClick={() => {
                  if (isPlaying) {
                    setShowBackConfirm(true);
                    return;
                  }
                  void exitLiveDirector();
                }}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] w-[2.4rem] px-1' : isCompactLandscape ? 'h-10 w-11 px-1.5' : 'h-[var(--ld-control-height)] w-[3.6rem] px-2'} shrink-0 items-center justify-center text-white/85 hover:text-white hover:bg-white/6`}
                aria-label="Volver al repertorio"
                title="Volver al repertorio"
              >
                <ChevronLeft className={`${isUltraCompactLandscape ? 'h-4 w-4' : isCompactLandscape ? 'h-5 w-5' : 'h-7 w-7'}`} strokeWidth={isCompactLandscape ? 2 : 2.4} />
              </button>
              <div
                className={`flex ${isUltraCompactLandscape ? 'rounded-[0.8rem] px-1 py-0.5' : isCompactLandscape ? 'rounded-[1rem] py-1' : 'rounded-[1.45rem] py-3'} shrink-0 flex-col items-center justify-center gap-0.5 border border-white/8 bg-black/16 ${isUltraCompactLandscape ? '' : 'px-2'} text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 2.95 : isCompactLandscape ? 4.15 : 4.6, 2.45) }}
              >
                <span className={`font-light leading-none tracking-tight text-white/92 ${isUltraCompactLandscape ? 'text-[1.12rem]' : isCompactLandscape ? 'text-[1.65rem]' : 'text-[2.05rem]'}`}>
                  {displayBpm || '--'}
                </span>
                <div className="h-px w-full bg-white/18" />
                <span className={`${isUltraCompactLandscape ? 'text-[0.42rem]' : 'text-[0.6rem]'} font-black uppercase tracking-[0.24em] text-white/56`}>
                  {displayBpm ? 'BPM' : 'SIN BPM'}
                </span>
              </div>

              <div
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-1.5 py-0.5' : isCompactLandscape ? 'h-10 px-2 py-1' : 'h-[var(--ld-control-height)] px-4 py-3'} flex-col`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 6.25 : isCompactLandscape ? 8.45 : 9.25, 5.1) }}
              >
                <span className={`font-light leading-none tracking-tight text-white ${isUltraCompactLandscape ? 'text-[1.45rem]' : isCompactLandscape ? 'text-[2.05rem]' : 'text-[2.65rem]'}`}>
                  {formatClock(currentTime)}
                </span>
                <span className={`font-medium tabular-nums text-white/58 ${isUltraCompactLandscape ? 'text-[0.58rem]' : isCompactLandscape ? 'text-[0.8rem]' : 'mt-1 text-[0.96rem]'}`}>
                  {formatCompact(currentTime)} / {formatCompact(playbackTimelineDuration)}
                </span>
              </div>

              {resolvedPadUrl && (
                <button
                  type="button"
                  onClick={() => setIsPadActive((previous) => !previous)}
                  className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-1 text-[0.62rem]' : isCompactLandscape ? 'h-10 px-2 text-[0.84rem]' : 'h-[var(--ld-control-height)] px-3 text-[0.84rem]'} flex-col font-semibold tracking-[0.18em] ${isPadActive
                    ? 'border-[#43c477]/40 bg-[#43c477]/10 text-[#8af7b1]'
                    : 'text-[#43c477]'
                    }`}
                  style={{ width: scaleRem(isUltraCompactLandscape ? 4.75 : isCompactLandscape ? 6.15 : 6.8, 4.1) }}
                  aria-label={isPadActive ? `Stop pad for ${songKey}` : `Play pad for ${songKey}`}
                >
                  <span>PAD</span>
                  <span className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.5rem]' : 'mt-1 text-[0.66rem]'} tracking-[0.22em] text-white/46`}>
                    {isPadActive ? 'ACT' : (songKey || 'LISTO')}
                  </span>
                </button>
              )}
              {canToggleTrackLoad && (
                <button
                  type="button"
                  onClick={() => {
                    const initial: Record<string, boolean> = {};
                    (manualSession?.tracks || []).forEach((t) => { initial[t.id] = t.enabled !== false; });
                    setPendingEnabledMap(initial);
                    setShowTrackLoadModal(true);
                  }}
                  className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-1.5 text-[0.58rem]' : isCompactLandscape ? 'h-10 px-2 text-[0.74rem]' : 'h-[var(--ld-control-height)] px-3 text-[0.76rem]'} flex-col font-semibold tracking-[0.16em] text-cyan-50`}
                  style={{ width: scaleRem(isUltraCompactLandscape ? 4.65 : isCompactLandscape ? 6.05 : 6.7, 4.1) }}
                  aria-label="Abrir carga selectiva de stems"
                  title="Elegir qué stems se cargan"
                >
                  <SlidersVertical className={`${isUltraCompactLandscape ? 'h-3 w-3' : isCompactLandscape ? 'h-4 w-4' : 'h-5 w-5'}`} />
                  <span className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.46rem]' : 'mt-1 text-[0.58rem]'} tracking-[0.18em] text-white/46`}>
                    STEMS
                  </span>
                </button>
              )}
              {isEnsayoMode && headerOperationalChips.length > 0 && (
                <div className={`flex items-center ${isUltraCompactLandscape ? 'gap-1' : 'gap-1.5'}`}>
                  {headerOperationalChips.map((chip) => (
                    <div
                      key={chip.id}
                      className={`rounded-full border ${isUltraCompactLandscape ? 'px-1.5 py-1' : isCompactLandscape ? 'px-2 py-1.5' : 'px-3 py-2'} ${chip.tone === 'info'
                        ? 'border-cyan-300/24 bg-cyan-300/8 text-cyan-50'
                        : 'border-white/10 bg-black/16 text-white/80'
                        }`}
                    >
                      <div className={`flex items-center ${isUltraCompactLandscape ? 'gap-1' : 'gap-1.5'}`}>
                        <span className={`${isUltraCompactLandscape ? 'text-[0.46rem]' : 'text-[0.56rem]'} font-black uppercase tracking-[0.18em] text-white/38`}>
                          {chip.label}
                        </span>
                        <span className={`${isUltraCompactLandscape ? 'text-[0.62rem]' : isCompactLandscape ? 'text-[0.72rem]' : 'text-[0.82rem]'} font-semibold text-inherit`}>
                          {chip.value}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`flex min-w-0 items-center justify-center ${isUltraCompactLandscape ? 'gap-1.5 px-0' : isCompactLandscape ? 'gap-2.5 px-0.5' : 'gap-3 px-1'}`}>
              <button
                type="button"
                onClick={() => {
                  void seekTo(Math.max(0, currentTime - 4));
                }}
                disabled={!hasTrackSession}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-3' : isCompactLandscape ? 'h-10 px-3.5' : 'h-[var(--ld-control-height)] px-4'} justify-center text-white/78 hover:text-white disabled:cursor-not-allowed disabled:text-white/24`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 4.3 : isCompactLandscape ? 5.25 : 5.65, 3.7) }}
                aria-label="Retroceder cuatro segundos"
                title="Retroceder cuatro segundos"
              >
                <RotateCcw className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : isCompactLandscape ? 'h-5 w-5' : 'h-6 w-6'}`} />
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isPlaying) {
                    pause();
                    return;
                  }

                  void play();
                }}
                disabled={!isReady}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-3.5' : isCompactLandscape ? 'h-10 px-4' : 'h-[var(--ld-control-height)] px-5'} justify-center ${isPlaying ? 'text-[#43c477] border-[#43c477]/35 bg-[#43c477]/10' : 'text-[#43c477] hover:text-[#4fe487]'} hover:bg-[#43c477]/12 disabled:cursor-not-allowed disabled:text-white/24 disabled:hover:bg-transparent`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 5.2 : isCompactLandscape ? 6.8 : 9, 4.5) }}
                aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                aria-keyshortcuts="Space"
                title={isPlaying ? 'Pausar · Espacio' : 'Reproducir · Espacio'}
              >
                {isPlaying ? (
                  <Pause className={`${isUltraCompactLandscape ? 'h-[1.125rem] w-[1.125rem]' : isCompactLandscape ? 'h-6 w-6' : 'h-9 w-9'}`} strokeWidth={2.2} fill="currentColor" />
                ) : (
                  <Play className={`ml-0.5 ${isUltraCompactLandscape ? 'h-[1.125rem] w-[1.125rem]' : isCompactLandscape ? 'h-6 w-6' : 'h-9 w-9'}`} strokeWidth={2.2} fill="currentColor" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  void seekTo(0);
                }}
                disabled={!hasTrackSession}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-3' : isCompactLandscape ? 'h-10 px-3.5' : 'h-[var(--ld-control-height)] px-4'} justify-center text-white/74 hover:text-white disabled:cursor-not-allowed disabled:text-white/24`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 4.45 : isCompactLandscape ? 5.45 : 5.85, 3.85) }}
                aria-label="Volver al inicio"
                title="Volver al inicio"
              >
                <SkipBack className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : isCompactLandscape ? 'h-5 w-5' : 'h-6 w-6'}`} />
              </button>
            </div>

            <div className={`flex items-stretch justify-end ${isUltraCompactLandscape ? 'gap-2' : isCompactLandscape ? 'gap-2.5' : 'gap-3'}`}>
              <button
                type="button"
                onClick={handlePreviousSection}
                disabled={!hasTrackSession}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-3.5' : isCompactLandscape ? 'h-10 px-4' : 'h-[var(--ld-control-height)] px-5'} justify-center text-white/82 hover:text-white hover:bg-white/6 disabled:cursor-not-allowed disabled:text-white/24`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 3.85 : isCompactLandscape ? 4.85 : 5.85, 3.25) }}
                aria-label="Ir a la seccion anterior"
                title="Ir a la seccion anterior"
              >
                <ChevronsLeft className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : isCompactLandscape ? 'h-5 w-5' : 'h-7 w-7'}`} strokeWidth={isCompactLandscape ? 2 : 2.4} />
              </button>

              <button
                type="button"
                onClick={handleNextSection}
                disabled={!hasTrackSession || resolvedSections.length === 0 || activeSectionIndex >= resolvedSections.length - 1}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-3.5' : isCompactLandscape ? 'h-10 px-4' : 'h-[var(--ld-control-height)] px-5'} justify-center text-white/82 hover:text-white hover:bg-white/6 disabled:cursor-not-allowed disabled:text-white/24`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 3.85 : isCompactLandscape ? 4.85 : 5.85, 3.25) }}
                aria-label="Ir a la siguiente seccion"
                title="Ir a la siguiente seccion"
              >
                <ChevronsRight className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : isCompactLandscape ? 'h-5 w-5' : 'h-7 w-7'}`} strokeWidth={isCompactLandscape ? 2 : 2.4} />
              </button>

              {/* Section-loop rehearsal toggle — single-touch way to loop the
                  current section hands-free. Retargets automatically when the
                  active section changes (user taps another, or next/prev). */}
              <button
                type="button"
                onClick={() => setSectionLoopMode((previous) => !previous)}
                disabled={!hasTrackSession || resolvedSections.length === 0}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-3' : isCompactLandscape ? 'h-10 px-3.5' : 'h-[var(--ld-control-height)] px-4'} justify-center ${sectionLoopMode ? 'text-emerald-200 border-emerald-300/40 bg-emerald-400/12' : 'text-white/70 hover:text-white'} disabled:cursor-not-allowed disabled:text-white/24`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 3.25 : isCompactLandscape ? 4.15 : 4.5, 2.8) }}
                aria-label={sectionLoopMode ? 'Desactivar bucle de sección' : 'Activar bucle de sección'}
                aria-pressed={sectionLoopMode}
                title={sectionLoopMode
                  ? `Bucle de sección ACTIVO${activeSection ? ` — ${activeSection.name}` : ''}`
                  : 'Bucle de sección — repite la sección actual hasta que la apagues'}
              >
                <Repeat className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
              </button>

              {!isShowMode && (
                <button
                  type="button"
                  onClick={() => setShowLoadPanel(true)}
                  className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-3' : isCompactLandscape ? 'h-10 px-3.5' : 'h-[var(--ld-control-height)] px-4'} justify-center text-white/70 hover:text-white`}
                  style={{ width: scaleRem(isUltraCompactLandscape ? 3.25 : isCompactLandscape ? 4.15 : 4.5, 2.8) }}
                  title="Cargar o reemplazar la sesión multitrack"
                  aria-label="Cargar o reemplazar la sesión multitrack"
                >
                  <Upload className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsShowMode((previous) => !previous)}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-3' : isCompactLandscape ? 'h-10 px-3.5' : 'h-[var(--ld-control-height)] px-4'} justify-center ${isShowMode ? 'text-cyan-200 border-cyan-300/34 bg-cyan-300/10' : 'text-white/70 hover:text-white'}`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 3.25 : isCompactLandscape ? 4.15 : 4.5, 2.8) }}
                title={isShowMode ? 'Modo show ACTIVO — toca para volver a ver motor y diagnóstico' : 'Modo show — oculta motor, diagnóstico y carga para un escenario limpio'}
                aria-label={isShowMode ? 'Desactivar modo show' : 'Activar modo show'}
                aria-pressed={isShowMode}
              >
                {isShowMode ? (
                  <EyeOff className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
                ) : (
                  <Eye className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
                )}
              </button>
            </div>
          </header>
        </div>

        <section className={`shrink-0 overflow-hidden ${isUltraCompactLandscape ? 'pr-0 pb-0' : isCompactLandscape ? 'pr-0.5' : ''}`}>
          <div className={`overflow-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.96),rgba(27,29,30,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isUltraCompactLandscape ? 'px-1.5 py-1' : isCompactLandscape ? 'px-2 py-1.5' : 'px-4 py-4'}`}>
            {isEnsayoMode ? (
              <div className="flex h-full items-center">
                <div className="hide-scrollbar -mx-0.5 -my-4 overflow-x-auto overflow-y-hidden">
                  <div className={`flex py-4 ${isUltraCompactLandscape ? 'gap-1 px-0.5' : 'gap-1.5 px-0.5'}`}>
                    {ensayoSlotSongs.map((queueSong, index) => (
                      <EnsayoQueueCard
                        key={queueSong.id}
                        song={queueSong}
                        coverUrl={queueSong.id === activeQueueSongId ? songCoverArtUrl : queueSongCoverArtMap[queueSong.id]}
                        active={queueSong.id === activeQueueSongId}
                        compact={isCompactLandscape}
                        ultraCompact={isUltraCompactLandscape}
                        onClick={() => {
                          if (queueSong.id === activeQueueSongId) {
                            void seekTo(0);
                            return;
                          }

                          onSelectQueueSong?.(queueSong.id);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className={`flex h-full items-stretch ${isUltraCompactLandscape ? 'gap-1.5' : isCompactLandscape ? 'gap-2' : 'gap-4'}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (hasTrackSession) {
                      void seekTo(0);
                      return;
                    }

                    setShowLoadPanel(true);
                  }}
                  className={`ui-pressable-card group relative flex shrink-0 overflow-hidden rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(35,37,39,0.98),rgba(24,26,28,0.98))] text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:border-white/20 ${isUltraCompactLandscape ? 'p-1' : isCompactLandscape ? 'p-1.5' : 'p-3'}`}
                  style={{ width: scaleRem(isUltraCompactLandscape ? 11.6 : isCompactLandscape ? 13.4 : 15, 9.8) }}
                  aria-label={hasTrackSession ? `Jump to start of ${currentSessionLabel}` : 'Open song loader'}
                >
                  <div className="absolute inset-0 overflow-hidden rounded-[1.05rem]">
                    {songCoverArtUrl ? (
                      <img
                        src={songCoverArtUrl}
                        alt={`Portada de ${songCardTitle}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(129,221,245,0.16),_transparent_34%),linear-gradient(180deg,rgba(52,57,60,0.94),rgba(20,22,24,0.98))] text-white/52">
                        <ListMusic className={isUltraCompactLandscape ? 'h-4 w-4' : isCompactLandscape ? 'h-5 w-5' : 'h-8 w-8'} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.08)_22%,rgba(0,0,0,0.18)_44%,rgba(0,0,0,0.7)_78%,rgba(0,0,0,0.92)_100%)]" />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_34%)]" />
                  </div>

                  <div className={`relative z-10 mt-auto flex items-end ${isUltraCompactLandscape ? 'min-h-[3.7rem] gap-1' : isCompactLandscape ? 'min-h-[4.85rem] gap-1.5' : 'min-h-[6.1rem] gap-3'}`}>
                    <div
                      className={`flex shrink-0 items-center justify-center rounded-full border transition-all ${isUltraCompactLandscape ? 'h-5 w-5' : isCompactLandscape ? 'h-6 w-6' : 'h-10 w-10'
                        } ${isPlaying
                          ? 'border-[#43c477]/65 bg-[#43c477]/12 text-[#63e88f] shadow-[0_0_18px_rgba(67,196,119,0.2)]'
                          : 'border-white/10 bg-black/28 text-white/72'
                        }`}
                    >
                      {isPlaying ? <Pause className={`${isUltraCompactLandscape ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} /> : <Play className={`ml-0.5 ${isUltraCompactLandscape ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />}
                    </div>
                    <div className="min-w-0 pb-0.5">
                      <h2 className={`truncate font-semibold tracking-tight text-white drop-shadow-[0_3px_12px_rgba(0,0,0,0.5)] ${isUltraCompactLandscape ? 'text-[0.82rem]' : isCompactLandscape ? 'text-sm' : 'text-[1.2rem]'}`}>
                        {songCardTitle}
                      </h2>
                      <p className={`truncate text-white/74 drop-shadow-[0_3px_12px_rgba(0,0,0,0.5)] ${isUltraCompactLandscape ? 'text-[0.56rem]' : isCompactLandscape ? 'text-[0.65rem]' : 'mt-0.5 text-[0.72rem]'}`}>{songCardMeta}</p>
                    </div>
                  </div>
                </button>

                <div className={`min-w-0 flex-1 rounded-[1.5rem] border border-white/8 bg-black/16 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isUltraCompactLandscape ? 'px-2 py-1.5' : isCompactLandscape ? 'px-3 py-2' : 'px-5 py-4'}`}>
                  <div className={`flex h-full flex-col justify-between ${isUltraCompactLandscape ? 'gap-1.5' : isCompactLandscape ? 'gap-2' : 'gap-4'}`}>
                    {isEnsayoMode ? null : (
                      <>
                        <div className={`flex ${isUltraCompactLandscape ? 'items-center gap-2' : isCompactLandscape ? 'items-center gap-3' : 'items-start justify-between gap-4'}`}>
                          <div className="min-w-0">
                            <p className={`${isUltraCompactLandscape ? 'text-[0.52rem]' : 'text-[0.7rem]'} font-black uppercase tracking-[0.24em] text-white/34`}>
                              {performerLabel ? `Live Director · ${performerLabel}` : 'Live Director'}
                            </p>
                            <h1 className={`truncate font-semibold tracking-tight text-white ${isUltraCompactLandscape ? 'mt-0.5 text-[0.92rem]' : isCompactLandscape ? 'mt-1 text-sm' : 'mt-2 text-[1.35rem]'}`}>
                              {currentSessionLabel}
                            </h1>
                            <p className={`text-white/54 ${isUltraCompactLandscape ? 'mt-0.5 text-[0.58rem]' : isCompactLandscape ? 'mt-0.5 text-[0.68rem]' : 'mt-1 text-[0.92rem]'}`}>{songSupportMeta}</p>
                            {autoDisabledTrackNames.length > 0 && !isShowMode && (
                              <p
                                className={`text-amber-200/86 ${isUltraCompactLandscape ? 'mt-0.5 text-[0.56rem]' : isCompactLandscape ? 'mt-0.5 text-[0.66rem]' : 'mt-1 text-[0.78rem]'}`}
                                title={`Pistas desactivadas automáticamente por el tope: ${autoDisabledTrackNames.join(', ')}`}
                              >
                                Auto-silenciadas: {autoDisabledTrackNames.slice(0, 3).join(', ')}
                                {autoDisabledTrackNames.length > 3 ? ` · +${autoDisabledTrackNames.length - 3} más` : ''}
                              </p>
                            )}
                          </div>

                          {!isShowMode && (
                          <div className={`flex shrink-0 ${isUltraCompactLandscape ? 'items-center gap-1' : isCompactLandscape ? 'items-center gap-1.5' : 'items-start gap-2'}`}>
                            <div className={`rounded-full border border-white/8 bg-black/18 ${isUltraCompactLandscape ? 'px-1.5 py-0.5' : isCompactLandscape ? 'px-2 py-1' : 'px-3 py-1.5'}`}>
                              <p className={`${isUltraCompactLandscape ? 'text-[0.5rem]' : 'text-[0.68rem]'} font-black uppercase tracking-[0.18em] text-white/46`}>
                                {surfaceBadgeLabel}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleEngineToggle}
                              disabled={isIOSNativeEngineSurface}
                              className={`ui-pressable-soft rounded-full border ${isUltraCompactLandscape ? 'px-1.5 py-0.5' : isCompactLandscape ? 'px-2 py-1' : 'px-3 py-1.5'} text-left transition-all ${useStreamingEngine
                                ? 'border-cyan-300/34 bg-cyan-300/10 text-cyan-50 shadow-[0_0_18px_rgba(129,221,245,0.14)]'
                                : isIOSNativeEngineSurface
                                  ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50 shadow-[0_0_18px_rgba(67,196,119,0.12)]'
                                  : 'border-white/8 bg-black/18 text-white/76 hover:text-white'
                                }`}
                              aria-label={`Cambiar motor. Motor actual: ${currentEngineLabel}`}
                              title={isIOSNativeEngineSurface ? 'Motor Apple nativo activo para app iOS.' : `Motor activo: ${currentEngineLabel}. Pulsa para cambiar.`}
                            >
                              <p className={`${isUltraCompactLandscape ? 'text-[0.46rem]' : 'text-[0.6rem]'} font-black uppercase tracking-[0.18em] text-white/38`}>
                                Motor
                              </p>
                              <p className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.62rem]' : isCompactLandscape ? 'mt-0.5 text-[0.74rem]' : 'mt-1 text-[0.92rem]'} font-semibold text-inherit`}>{currentEngineLabel}</p>
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowDiagnostics((previous) => !previous)}
                              className={`ui-pressable-soft rounded-full border ${isUltraCompactLandscape ? 'px-1.5 py-0.5' : isCompactLandscape ? 'px-2 py-1' : 'px-3 py-1.5'} text-left transition-all ${showDiagnostics
                                ? 'border-cyan-300/34 bg-cyan-300/10 text-cyan-50 shadow-[0_0_18px_rgba(129,221,245,0.14)]'
                                : 'border-white/8 bg-black/18 text-white/72 hover:text-white'
                                }`}
                              aria-label={`${showDiagnostics ? 'Ocultar' : 'Mostrar'} diagnostico de memoria`}
                              title="Mostrar u ocultar diagnostico de memoria y carga"
                            >
                              <p className={`${isUltraCompactLandscape ? 'text-[0.46rem]' : 'text-[0.6rem]'} font-black uppercase tracking-[0.18em] text-white/38`}>
                                RAM
                              </p>
                              <p className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.62rem]' : isCompactLandscape ? 'mt-0.5 text-[0.74rem]' : 'mt-1 text-[0.92rem]'} font-semibold text-inherit`}>
                                {showDiagnostics ? 'Activa' : 'Oculta'}
                              </p>
                            </button>
                            <div className={`rounded-[1.1rem] border border-white/8 bg-black/18 text-right ${isUltraCompactLandscape ? 'px-1.5 py-1' : isCompactLandscape ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
                              <p className={`${isUltraCompactLandscape ? 'text-[0.46rem]' : 'text-[0.62rem]'} font-black uppercase tracking-[0.2em] text-white/36`}>
                                Estado
                              </p>
                              <p className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.66rem]' : isCompactLandscape ? 'mt-0.5 text-[0.78rem]' : 'mt-1 text-[0.98rem]'} font-semibold ${isReady ? 'text-[#43c477]' : 'text-white/58'}`}>
                                {readyStateLabel}
                              </p>
                            </div>
                          </div>
                          )}
                        </div>

                        <div className={`flex ${isUltraCompactLandscape ? 'items-center gap-1.5' : isCompactLandscape ? 'items-center gap-2' : 'items-end gap-4'}`}>
                          <div className="min-w-0 flex-1">
                            <div className={`flex items-center justify-between font-semibold uppercase tracking-[0.18em] text-white/46 ${isUltraCompactLandscape ? 'mb-0.5 text-[0.56rem]' : isCompactLandscape ? 'mb-1 text-[0.72rem]' : 'mb-2 text-[0.72rem]'}`}>
                              <span>{hasTrackSession ? `${activeTracks.length} pistas` : 'Sin sesion'}</span>
                              <span>{formatCompact(currentTime)} / {formatCompact(playbackTimelineDuration)}</span>
                            </div>
                            <div className={`${isUltraCompactLandscape ? 'h-1' : isCompactLandscape ? 'h-1.5' : 'h-2.5'} rounded-full bg-black/30`}>
                              <div
                                className="h-full rounded-full bg-[linear-gradient(90deg,#43c477_0%,#81ddf5_100%)] shadow-[0_0_14px_rgba(67,196,119,0.16)] transition-[width] duration-200"
                                style={{ width: `${Math.max(hasTrackSession ? progressPercent : 0, hasTrackSession ? 4 : 0)}%` }}
                              />
                            </div>
                            {(resolvedSections.length > 0 || sectionTimelineTailDuration > 0) && (
                              <div className={`flex w-full overflow-hidden ${isUltraCompactLandscape ? 'h-[2px] mt-0.5 rounded-[1px]' : isCompactLandscape ? 'h-[3px] mt-1 rounded-[2px]' : 'h-1 mt-1.5 rounded-full'} opacity-[0.62]`}>
                                {resolvedSections.map((sec) => {
                                  const duration = sec.endTime - sec.startTime;
                                  const widthPercent = playbackTimelineDuration > 0 ? (duration / playbackTimelineDuration) * 100 : 0;
                                  return (
                                    <div
                                      key={`minimap-${sec.id}`}
                                      className="h-full border-r border-[#181a1c] last:border-0"
                                      style={{
                                        width: `${widthPercent}%`,
                                        backgroundColor: sec.accent,
                                      }}
                                      title={sec.name}
                                    />
                                  );
                                })}
                                {sectionTimelineTailDuration > 0 && (
                                  <div
                                    className="h-full bg-white/14"
                                    style={{
                                      width: `${playbackTimelineDuration > 0 ? (sectionTimelineTailDuration / playbackTimelineDuration) * 100 : 0}%`,
                                    }}
                                    title="Audio sin seccion marcada"
                                  />
                                )}
                              </div>
                            )}
                            {showDiagnostics && (
                              <div className={`grid grid-cols-4 gap-2 ${isCompactLandscape ? 'mt-2' : 'mt-3'}`}>
                                {diagnosticsCards.map((card) => (
                                  <div
                                    key={card.label}
                                    className="rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
                                  >
                                    <p className="text-[0.58rem] font-black uppercase tracking-[0.22em] text-white/34">
                                      {card.label}
                                    </p>
                                    <p className="mt-1 text-[0.88rem] font-semibold text-white/78">{card.value}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className={`grid grid-cols-2 ${isUltraCompactLandscape ? 'gap-1' : isCompactLandscape ? 'gap-1.5' : 'gap-2'}`}>
                            <button
                              type="button"
                              onClick={() => setSurfaceView('mix')}
                              className={`ui-pressable-soft min-w-[5.5rem] rounded-[1rem] border ${isUltraCompactLandscape ? 'px-1.5 py-1 text-[0.56rem]' : isCompactLandscape ? 'px-2 py-1.5 text-[0.64rem]' : 'px-3 py-2 text-[0.7rem]'} font-black uppercase tracking-[0.18em] transition-all ${surfaceView === 'mix'
                                ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50'
                                : 'border-white/8 bg-black/18 text-white/58'
                                }`}
                            >
                              Mezcla
                            </button>
                            <button
                              type="button"
                              onClick={() => setSurfaceView('sections')}
                              className={`ui-pressable-soft min-w-[5.5rem] rounded-[1rem] border ${isUltraCompactLandscape ? 'px-1.5 py-1 text-[0.56rem]' : isCompactLandscape ? 'px-2 py-1.5 text-[0.64rem]' : 'px-3 py-2 text-[0.7rem]'} font-black uppercase tracking-[0.18em] transition-all ${surfaceView === 'sections'
                                ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50'
                                : 'border-white/8 bg-black/18 text-white/58'
                                }`}
                            >
                              Secciones
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>)}
          </div>
        </section>
        <section
          className={`grid min-h-0 flex-1 ${isUltraCompactLandscape ? 'gap-0.5' : isCompactLandscape ? 'gap-1.5' : 'gap-4'}`}
          style={{ gridTemplateColumns: `minmax(0,1fr) ${mixerLayoutColumns}` }}
        >
          {showSectionsPanel ? (
            <div className="relative min-h-0 overflow-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(29,30,32,0.98),rgba(23,24,26,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="absolute left-4 top-4 z-40 flex items-center gap-3 rounded-full border border-white/10 bg-black/68 px-3 py-2">
                <span className="text-[0.68rem] font-black uppercase tracking-[0.28em] text-white/38">Secciones</span>
                <span className="text-[0.8rem] font-semibold text-white/78">
                  {activeSection?.name || 'Linea de tiempo'}
                </span>
              </div>
              {nextSectionPreview && (
                <div
                  key={`next-${nextSectionPreview.name}-${nextSectionPreview.seconds}`}
                  className="pointer-events-none anim-fade-in absolute left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-cyan-300/34 bg-[linear-gradient(180deg,rgba(16,30,40,0.92),rgba(10,20,28,0.92))] px-3.5 py-2 shadow-[0_14px_32px_rgba(0,0,0,0.32)]"
                  aria-live="polite"
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" aria-hidden="true" />
                  <span className="text-[0.6rem] font-black uppercase tracking-[0.22em] text-cyan-100/66">
                    Proxima
                  </span>
                  <span className="text-[0.88rem] font-semibold text-white">
                    {nextSectionPreview.name}
                  </span>
                  <span className="rounded-full border border-cyan-300/28 bg-cyan-300/10 px-2 py-0.5 text-[0.7rem] font-black tracking-[0.12em] text-cyan-100">
                    {nextSectionPreview.seconds}s
                  </span>
                </div>
              )}
              {sectionsAutoFollowStatus !== 'auto' && (
                <div className="pointer-events-none absolute left-4 top-[3.4rem] z-40 flex items-center gap-2 rounded-full border border-amber-300/28 bg-black/62 px-2.5 py-1 shadow-[0_6px_18px_rgba(0,0,0,0.28)]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full bg-amber-300 ${
                      sectionsAutoFollowStatus === 'held' ? 'animate-pulse' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-[0.58rem] font-black uppercase tracking-[0.22em] text-amber-100/86">
                    {sectionsAutoFollowStatus === 'held' ? 'Scroll libre' : 'Auto en 5s'}
                  </span>
                  {sectionsAutoFollowStatus === 'resuming' && (
                    <span className="relative ml-0.5 h-1 w-10 overflow-hidden rounded-full bg-white/10">
                      <span
                        key="resume-ring"
                        className="live-director-autofollow-ring absolute inset-y-0 left-0 block h-full w-full rounded-full bg-amber-300/82"
                      />
                    </span>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  if (showOffsetModal) {
                    handleCloseOffsetModal();
                  } else {
                    handleOpenOffsetModal();
                  }
                }}
                className="ui-pressable-soft absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-[1rem] border border-white/10 bg-black/66 text-white/68 transition-all hover:text-white"
                aria-label="Abrir ajuste de desfase"
                title="Ajustar desfase de secciones"
              >
                <span className="text-[0.92rem] font-black tracking-[0.1em]">±</span>
              </button>
              {showOffsetModal && (
                <div className="absolute right-4 top-16 z-40 w-[11.5rem] rounded-[1.25rem] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,22,0.98),rgba(13,15,17,0.98))] p-3 shadow-[0_24px_48px_rgba(0,0,0,0.34)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-white/42">Desfase</p>
                      <p className="mt-1 text-[1rem] font-semibold text-white/86">
                        {sectionOffsetSeconds >= 0 ? '+' : ''}
                        {sectionOffsetSeconds.toFixed(2)}s
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCloseOffsetModal}
                      className="ui-pressable-soft flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/26 text-white/58 hover:text-white"
                      aria-label="Cerrar ajuste de desfase"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        updateSectionOffsetLocally(sectionOffsetSeconds - 0.25);
                      }}
                      className="ui-pressable-soft flex h-10 items-center justify-center rounded-[0.95rem] border border-white/10 bg-black/28 text-[0.88rem] font-black text-white/76"
                      aria-label="Mover secciones antes"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateSectionOffsetLocally(0);
                      }}
                      className="ui-pressable-soft flex h-10 items-center justify-center rounded-[0.95rem] border border-white/10 bg-black/28 text-[0.66rem] font-black uppercase tracking-[0.14em] text-white/68"
                    >
                      Rein.
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateSectionOffsetLocally(sectionOffsetSeconds + 0.25);
                      }}
                      className="ui-pressable-soft flex h-10 items-center justify-center rounded-[0.95rem] border border-white/10 bg-black/28 text-[0.88rem] font-black text-white/76"
                      aria-label="Mover secciones despues"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
              <div className="relative h-full overflow-hidden bg-black/12">
                <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-16 bg-[linear-gradient(90deg,rgba(23,24,26,0.96),rgba(23,24,26,0))]" />
                <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-16 bg-[linear-gradient(270deg,rgba(23,24,26,0.96),rgba(23,24,26,0))]" />
                <div
                  className={`pointer-events-none absolute top-3 z-30 w-[4px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.68)] ${
                    isUltraCompactLandscape ? 'bottom-3' : isCompactLandscape ? 'bottom-[22px]' : 'bottom-[34px]'
                  }`}
                  style={{ left: `${sectionLanePlayheadOffsetPx}px` }}
                />
                <div
                  ref={sectionsLaneScrollRef}
                  onPointerDown={handleSectionsPointerDown}
                  onPointerMove={handleSectionsPointerMove}
                  onPointerUp={handleSectionsPointerUp}
                  onPointerCancel={handleSectionsPointerUp}
                  onWheel={triggerUserScrollSections}
                  className="hide-scrollbar relative h-full overflow-x-auto overflow-y-hidden"
                  style={{
                    touchAction: 'pan-x pinch-zoom',
                    overscrollBehaviorX: 'contain',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                    <div
                      className="relative flex h-full min-h-0 items-stretch gap-[14px] py-4"
                      style={{
                        width: `${sectionLaneContentWidth}px`,
                        paddingLeft: `${sectionLanePlayheadOffsetPx}px`,
                        paddingRight: `${sectionLaneTrailingPaddingPx}px`,
                      }}
                    >
                    {sectionLaneSegments.map(({ section, waveBars, widthPx, leftPx, activeStyle, inactiveStyle }, index) => {
                      const isActive = index === activeSectionIndex;

                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => {
                            void handleSectionSeek(section.startTime);
                          }}
                          className="relative h-full shrink-0 rounded-[1.55rem] border text-left transition-all duration-200"
                          style={isActive ? activeStyle : inactiveStyle}
                        >
                          <div className="absolute inset-0 rounded-[1.5rem] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_2px,transparent_2px,transparent_20px)]" />
                          <div className="absolute inset-0 rounded-[1.5rem] bg-black/10" />
                          <div
                            className="absolute inset-y-0 left-0 w-px bg-white/12"
                            style={{ opacity: isActive ? 0.52 : 0.2 }}
                          />
                          <div
                            className="absolute left-4 right-4 top-[58%] flex h-[36%] -translate-y-1/2 items-end justify-between"
                            style={{ gap: `${SECTION_WAVE_BAR_GAP_PX}px` }}
                          >
                            {waveBars.map((height, barIndex) => (
                              <span
                                key={`${section.id}-bar-${barIndex}`}
                                className="shrink-0 rounded-full bg-white/72"
                                style={{
                                  width: `${SECTION_WAVE_BAR_WIDTH_PX}px`,
                                  height: `${height}%`,
                                  opacity: isActive ? 0.96 : 0.7,
                                }}
                              />
                            ))}
                          </div>
                          <div className="absolute left-4 top-8 flex items-center gap-3 rounded-[1rem] border border-white/8 bg-black/56 px-3 py-2">
                            <span
                              className="flex h-10 min-w-10 items-center justify-center rounded-full border px-2 text-[0.88rem] font-black tracking-[0.16em]"
                              style={{
                                borderColor: `${section.accent}90`,
                                color: section.accent,
                                backgroundColor: `${section.accent}1c`,
                              }}
                            >
                              {section.shortLabel}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[1rem] font-semibold text-white/92">{section.name}</p>
                              <p className="mt-0.5 text-[0.72rem] uppercase tracking-[0.18em] text-white/50">
                                {formatCompact(section.startTime)} · {Math.max(0, Math.round(section.endTime - section.startTime))}s
                              </p>
                            </div>
                          </div>
                          <div
                            className="pointer-events-none absolute inset-y-4 left-0 rounded-[1.2rem] border border-white/0"
                            style={{
                              // transform is composited on the GPU; `left`
                              // was triggering layout on every visual-clock
                              // tick during playback. `will-change: transform`
                              // keeps the playhead on its own layer so the
                              // section card below doesn't repaint.
                              transform: `translate3d(${clamp(sectionLaneProgressPx - leftPx - 1, 0, Math.max(0, widthPx - 2))}px, 0, 0)`,
                              width: '2px',
                              backgroundColor: isActive ? `${section.accent}cc` : 'transparent',
                              boxShadow: isActive ? `0 0 14px ${section.accent}66` : 'none',
                              opacity: isActive ? 1 : 0,
                              willChange: isActive ? 'transform' : 'auto',
                              transition: 'background-color 150ms ease, box-shadow 150ms ease, opacity 150ms ease',
                            }}
                          />
                        </button>
                      );
                    })}
                    {sectionLaneTailWidthPx > 0 && (
                      <div
                        aria-hidden="true"
                        className="relative h-full shrink-0 rounded-[1.55rem] border border-dashed border-white/8 bg-[linear-gradient(180deg,rgba(29,31,33,0.92),rgba(19,20,22,0.96))]"
                        style={{ width: `${sectionLaneTailWidthPx}px` }}
                        title="Audio sin seccion marcada"
                      >
                        <div className="absolute inset-0 rounded-[1.5rem] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.025)_0px,rgba(255,255,255,0.025)_2px,transparent_2px,transparent_20px)]" />
                        <div className="absolute inset-0 rounded-[1.5rem] bg-black/12" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Mini-mapa: banda angosta con bloques de sección, playhead
                    global y viewport marker. Tap/drag = seek. Oculto en
                    ultra-compact landscape para no morder altura. */}
                {!isUltraCompactLandscape && sectionLaneMinimapSegments.length > 0 && (
                  <div
                    className={`pointer-events-none absolute left-4 right-4 z-40 ${
                      isCompactLandscape ? 'bottom-2 h-[14px]' : 'bottom-3 h-[18px]'
                    }`}
                  >
                    <div
                      ref={minimapTrackRef}
                      onPointerDown={handleMinimapPointerDown}
                      onPointerMove={handleMinimapPointerMove}
                      onPointerUp={handleMinimapPointerUp}
                      onPointerCancel={handleMinimapPointerUp}
                      className="pointer-events-auto relative h-full cursor-pointer overflow-hidden rounded-[10px] border border-white/10 bg-black/52 shadow-[0_6px_16px_rgba(0,0,0,0.38)]"
                      style={{ touchAction: 'none' }}
                      aria-label="Mini-mapa de la canción"
                      role="slider"
                      aria-valuemin={0}
                      aria-valuemax={playbackTimelineDuration}
                      aria-valuenow={clamp(currentTime, 0, playbackTimelineDuration)}
                    >
                      {sectionLaneMinimapSegments.map((seg, index) => {
                        const isActive = index === activeSectionIndex;
                        return (
                          <div
                            key={seg.id}
                            aria-hidden="true"
                            className="absolute inset-y-0"
                            style={{
                              left: `${seg.leftPct}%`,
                              width: `${seg.widthPct}%`,
                              backgroundColor: isActive
                                ? `${seg.accent}b3`
                                : `${seg.accent}4d`,
                              borderLeft:
                                index === 0 ? 'none' : '1px solid rgba(0,0,0,0.45)',
                              transition:
                                'background-color 160ms ease',
                            }}
                          />
                        );
                      })}
                      {/* Viewport marker: qué rango de la canción está visible
                          en la lane grande. */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute -top-[2px] -bottom-[2px] rounded-[6px] border border-white/60 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                        style={{
                          left: `${sectionLaneMinimapViewport.leftPct}%`,
                          width: `${sectionLaneMinimapViewport.widthPct}%`,
                          transition: 'left 120ms ease, width 120ms ease',
                        }}
                      />
                      {/* Playhead global */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute -top-[4px] -bottom-[4px] w-[2px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]"
                        style={{
                          left: `${sectionLaneMinimapPlayheadPct}%`,
                          willChange: 'left',
                        }}
                      />
                    </div>
                    {/* Tooltip que sigue al dedo mientras el usuario arrastra
                        en el mini-mapa: muestra nombre de sección + timestamp
                        para que el seek ciego se convierta en seek informado. */}
                    {minimapHoverTime !== null && playbackTimelineDuration > 0 && (() => {
                      const hoverPct = clamp(
                        (minimapHoverTime / playbackTimelineDuration) * 100,
                        0,
                        100,
                      );
                      const hoverSection = resolvedSections.find(
                        (s) =>
                          minimapHoverTime >= s.startTime &&
                          minimapHoverTime < s.endTime,
                      );
                      const hoverLabel = hoverSection?.name
                        ? hoverSection.name
                        : 'Sin sección';
                      const hoverAccent = hoverSection?.accent ?? '#f59e0b';
                      return (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute -top-[34px] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/18 bg-black/82 px-2.5 py-1 shadow-[0_10px_24px_rgba(0,0,0,0.55)] backdrop-blur-sm"
                          style={{
                            left: `${hoverPct}%`,
                            maxWidth: '70%',
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: hoverAccent }}
                          />
                          <span className="truncate text-[0.62rem] font-black uppercase tracking-[0.18em] text-white/92">
                            {hoverLabel}
                          </span>
                          <span className="text-[0.6rem] font-bold tabular-nums text-white/72">
                            {formatClock(minimapHoverTime)}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              ref={mixerScrollRef}
              data-live-director-mixer-scroll="true"
              onPointerDown={handleMixerPointerDown}
              onPointerMove={handleMixerPointerMove}
              onPointerUp={handleMixerPointerUp}
              onPointerCancel={handleMixerPointerUp}
              className={mixerScrollClassName}
              style={mixerScrollStyle}
            >
              {mixerView.map((track) => {
                const isInternalPadTrack = track.id === INTERNAL_PAD_TRACK_ID;
                const stableCallbacks = getChannelStripCallbacks(track.id);
                return (
                  <ChannelStrip
                    key={track.id}
                    id={track.id}
                    label={track.label}
                    shortLabel={track.shortLabel}
                    accent={track.accent}
                    volume={track.volume}
                    level={track.level}
                    isPlaying={isPlaying}
                    muted={track.muted}
                    soloed={track.soloed}
                    dimmed={track.dimmed}
                    disabled={track.disabled}
                    outputRoute={track.outputRoute}
                    showRouteFlip={track.showRouteFlip}
                    compact={isCompactLandscape}
                    ultraCompact={isUltraCompactLandscape}
                    onVolumeChange={stableCallbacks.onVolumeChange}
                    onInteractionStart={isInternalPadTrack ? undefined : suspendNativeMeters}
                    onInteractionEnd={isInternalPadTrack ? undefined : resumeNativeMetersSoon}
                    onMute={stableCallbacks.onMute}
                    onSolo={stableCallbacks.onSolo}
                    onToggleOutputRoute={stableCallbacks.onToggleOutputRoute}
                  />
                );
              })}
            </div>
          )}

          <div className={`rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isUltraCompactLandscape ? 'px-0.5 py-0.5' : isCompactLandscape ? 'px-1 py-0.5' : 'px-3 py-4'}`}>
            <div className={`flex h-full flex-col ${isUltraCompactLandscape ? 'gap-0.75' : isCompactLandscape ? 'gap-1' : 'gap-4'}`}>
              {!isCompactLandscape && (
                <div className="flex items-center justify-center gap-1 pt-1 text-white/42">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                </div>
              )}
              <div className={`grid ${isUltraCompactLandscape ? 'gap-0.75' : isCompactLandscape ? 'gap-1' : 'gap-3'}`}>
                <button
                  type="button"
                  onClick={() => setSurfaceView('mix')}
                  className={`ui-pressable-soft flex flex-col items-center justify-center gap-1 rounded-[1.2rem] border transition-all ${isUltraCompactLandscape ? 'h-[2.6rem] w-full rounded-[1rem] gap-0.5' : isCompactLandscape ? 'h-[3.15rem] w-full' : 'h-16'
                    } ${surfaceView === 'mix'
                      ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50 shadow-[0_0_20px_rgba(129,221,245,0.14)]'
                      : 'border-white/8 bg-black/24 text-white/62'
                    }`}
                >
                  <SlidersVertical className={isUltraCompactLandscape ? 'h-2.75 w-2.75' : isCompactLandscape ? 'h-3.25 w-3.25' : 'h-6 w-6'} />
                  {!isCompactLandscape && <span className="text-[0.66rem] font-black uppercase tracking-[0.18em]">Mezcla</span>}
                </button>
                <button
                  type="button"
                  onClick={() => setSurfaceView('sections')}
                  className={`ui-pressable-soft flex flex-col items-center justify-center gap-1 rounded-[1.2rem] border transition-all ${isUltraCompactLandscape ? 'h-[2.6rem] w-full rounded-[1rem] gap-0.5' : isCompactLandscape ? 'h-[3.15rem] w-full' : 'h-16'
                    } ${surfaceView === 'sections'
                      ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50 shadow-[0_0_20px_rgba(129,221,245,0.14)]'
                      : 'border-white/8 bg-black/24 text-white/62'
                    }`}
                >
                  <ListMusic className={isUltraCompactLandscape ? 'h-2.75 w-2.75' : isCompactLandscape ? 'h-3.25 w-3.25' : 'h-6 w-6'} />
                  {!isCompactLandscape && <span className="text-[0.6rem] font-black uppercase tracking-[0.16em]">Secciones</span>}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!hasTrackSession) {
                    return;
                  }

                  const nextMuteAll = mutedTrackIds.size !== activeTracks.length;
                  activeTracks.forEach((track) => {
                    const currentlyMuted = mutedTrackIds.has(track.id);
                    if (nextMuteAll !== currentlyMuted) {
                      toggleMute(track.id);
                    }
                  });
                  setMutedTrackIds(nextMuteAll ? new Set(activeTracks.map((track) => track.id)) : new Set());
                }}
                disabled={!hasTrackSession}
                className={`ui-pressable-soft rounded-[1.2rem] border border-white/8 bg-black/24 px-2 text-center ${isUltraCompactLandscape ? 'h-[3.25rem] w-full rounded-[1rem] text-[0.48rem]' : isCompactLandscape ? 'h-[4.2rem] w-full text-[0.54rem]' : 'text-[0.78rem] py-5'} font-semibold tracking-[0.18em] leading-[1.1] text-white/62`}
              >
                SILEN.
                <br />
                TODO
              </button>
              <button
                type="button"
                onClick={handleLoopIn}
                disabled={!hasTrackSession}
                className={`ui-pressable-soft rounded-[1.2rem] border px-2 text-center ${isUltraCompactLandscape ? 'h-[3.25rem] w-full rounded-[1rem] text-[0.48rem]' : isCompactLandscape ? 'h-[4.2rem] w-full text-[0.54rem]' : 'text-[0.78rem] py-5'} font-semibold tracking-[0.18em] leading-[1.1] ${loopEnabled
                  ? 'border-[#43c477]/50 bg-[#43c477]/14 text-[#9effc4]'
                  : 'border-white/8 bg-black/24 text-white/62'
                  }`}
              >
                BUCLE
                <br />
                ON
              </button>
              <button
                type="button"
                onClick={handleLoopOut}
                disabled={!hasTrackSession}
                className={`ui-pressable-soft rounded-[1.2rem] border border-white/8 bg-black/24 px-2 text-center ${isUltraCompactLandscape ? 'h-[3.25rem] w-full rounded-[1rem] text-[0.48rem]' : isCompactLandscape ? 'h-[4.2rem] w-full text-[0.54rem]' : 'text-[0.78rem] py-5'} font-semibold tracking-[0.18em] leading-[1.1] text-white/62`}
              >
                BUCLE
                <br />
                OFF
              </button>
            </div>
          </div>

          <div className={`rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isUltraCompactLandscape ? 'px-0.5 py-0.5' : isCompactLandscape ? 'px-1 py-0.5' : 'px-3 py-4'}`}>
            <div className={`relative flex h-full flex-col items-center border border-white/7 bg-[linear-gradient(180deg,rgba(34,35,37,0.92),rgba(26,27,29,0.94))] ${isUltraCompactLandscape ? 'rounded-[1.18rem] px-0.75 pb-0.75 pt-0.85' : isCompactLandscape ? 'rounded-[1.38rem] px-1.25 pb-1.25 pt-0.95' : 'rounded-[1.75rem] px-3 pb-4 pt-3'}`}>
              <div className={`flex items-center justify-center border border-white/8 bg-black/28 text-white/62 ${isUltraCompactLandscape ? 'mb-1 min-h-[2.5rem] min-w-[2.5rem] rounded-[0.95rem]' : isCompactLandscape ? 'mb-1.5 min-h-[2.75rem] min-w-[2.75rem] rounded-[1.05rem]' : 'mb-3 h-11 w-11 rounded-full'}`}>
                <span className={`font-black tracking-[0.18em] ${isUltraCompactLandscape ? 'text-[0.54rem]' : isCompactLandscape ? 'text-[0.65rem]' : 'text-[0.82rem]'}`}>M</span>
              </div>

              <div className="relative flex w-full flex-1 items-center justify-center">
                <div className={`relative h-full w-full ${isUltraCompactLandscape ? 'max-w-[5.2rem]' : isCompactLandscape ? 'max-w-[5.95rem]' : 'max-w-[5.8rem]'}`}>
                  <div className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-[#050607] ${isUltraCompactLandscape ? 'top-[8%] bottom-[12%] w-[0.5rem]' : isCompactLandscape ? 'top-[7%] bottom-[10%] w-[0.56rem]' : 'top-[5%] bottom-[7%] w-[0.72rem]'}`} />
                  {Array.from({ length: 7 }).map((_, index) => (
                    <div
                      key={`master-mark-${index}`}
                      className="absolute left-1/2 h-[2px] w-[76%] -translate-x-1/2 rounded-full bg-white/18"
                      style={{ bottom: `${14 + index * 11}%` }}
                    />
                  ))}
                  <FaderThumb
                    accent="#81ddf5"
                    className={`${isUltraCompactLandscape ? 'h-[1.85rem]' : isCompactLandscape ? 'h-[2.2rem]' : 'h-[4.35rem]'} w-full ${isUltraCompactLandscape ? 'max-w-[5.1rem]' : isCompactLandscape ? 'max-w-[5.85rem]' : 'max-w-[6.1rem]'} transition-[bottom,box-shadow] duration-150`}
                    style={{
                      bottom: `calc(${10 + masterVolume * 78}% - ${isUltraCompactLandscape ? '0.92rem' : isCompactLandscape ? '1.1rem' : '1.75rem'})`,
                      boxShadow: '0 14px 24px rgba(0,0,0,0.35), 0 0 20px rgba(115,209,248,0.18)',
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={masterVolume}
                    disabled={!hasTrackSession}
                    onPointerDown={suspendNativeMeters}
                    onPointerUp={resumeNativeMetersSoon}
                    onPointerCancel={resumeNativeMetersSoon}
                    onChange={(event) => setMasterVolumeState(Number(event.target.value))}
                    aria-label="Master volume"
                    className={`absolute left-1/2 top-1/2 h-10 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer opacity-0 ${isUltraCompactLandscape ? 'w-32' : isCompactLandscape ? 'w-40' : 'w-[18rem]'}`}
                  />
                </div>
              </div>

              <div className={`text-center ${isUltraCompactLandscape ? 'mt-0' : isCompactLandscape ? 'mt-1' : 'mt-4'}`}>
                {!isCompactLandscape && <p className="text-[0.62rem] font-black uppercase tracking-[0.3em] text-white/28">BUS</p>}
                <p className={`font-semibold text-white/90 ${isUltraCompactLandscape ? 'text-[0.78rem]' : isCompactLandscape ? 'text-[0.9rem]' : 'mt-1 text-[1.15rem]'}`}>Master</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {!hasProvidedTracks && showLoadPanel && (
        <div className={`absolute inset-0 z-[45] flex items-center justify-center bg-black/26 backdrop-blur-[8px] ${isCompactLandscape ? 'px-2 py-2' : 'px-6'}`}>
          <div className={`w-full overflow-y-auto rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,19,21,0.96),rgba(13,15,16,0.96))] shadow-[0_34px_70px_rgba(0,0,0,0.34)] ${isCompactLandscape ? 'max-h-[calc(100dvh-1rem)] max-w-[46rem] p-3' : 'max-w-[62rem] p-6'}`}>
            <div className={`flex items-start justify-between ${isCompactLandscape ? 'gap-3' : 'gap-6'}`}>
              <div>
                <p className="text-[0.78rem] font-black uppercase tracking-[0.28em] text-cyan-100/62">Cargador de sesion</p>
                <h2 className={`font-semibold tracking-tight text-white ${isCompactLandscape ? 'mt-1 text-[1.35rem]' : 'mt-2 text-[2rem]'}`}>
                  {hasPersistedSongContext ? `Carga ${songTitle || 'esta cancion'}.` : 'Carga una pista o multitrack.'}
                </h2>
                <p className={`max-w-3xl leading-relaxed text-white/62 ${isCompactLandscape ? 'mt-1 text-[0.84rem]' : 'mt-3 text-[1rem]'}`}>
                  Elige una pista unica o una carpeta multitrack.
                </p>
                <p className={`max-w-3xl text-amber-200/70 ${isCompactLandscape ? 'mt-1 text-[0.7rem]' : 'mt-2 text-[0.82rem]'}`}>
                  Formatos recomendados: <span className="font-semibold">AAC-LC (.m4a)</span> o <span className="font-semibold">FLAC</span>. Evita <span className="font-semibold">ALAC</span> (.m4a lossless de Apple) — no abre en Windows ni Android.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLoadPanel(false)}
                className="ui-pressable-soft flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/28 text-white/64 hover:text-white"
                aria-label="Cerrar cargador de sesion"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className={`mt-4 grid ${isCompactLandscape ? 'grid-cols-1 gap-3' : 'grid-cols-[15rem_minmax(0,1fr)] gap-6'}`}>
              <div className={`rounded-[1.5rem] border border-white/8 bg-black/22 ${isCompactLandscape ? 'grid grid-cols-2 gap-2 p-2' : 'p-3'}`}>
                <button
                  type="button"
                  onClick={() => setLoaderMode('sequence')}
                  className={`flex w-full items-center gap-3 rounded-[1.2rem] border text-left transition-all ${loaderMode === 'sequence'
                    ? 'border-cyan-300/38 bg-cyan-300/12 text-white'
                    : 'border-white/8 bg-white/[0.02] text-white/68'
                    } ${isCompactLandscape ? 'px-3 py-3' : 'mb-3 px-4 py-4'}`}
                >
                  <Upload className="h-5 w-5" />
                  <div>
                    <p className="text-sm font-semibold">Secuencia unica</p>
                    <p className="mt-1 text-xs text-white/52">Una pista.</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setLoaderMode('folder')}
                  className={`flex w-full items-center gap-3 rounded-[1.2rem] border text-left transition-all ${loaderMode === 'folder'
                    ? 'border-cyan-300/38 bg-cyan-300/12 text-white'
                    : 'border-white/8 bg-white/[0.02] text-white/68'
                    } ${isCompactLandscape ? 'px-3 py-3' : 'px-4 py-4'}`}
                >
                  <FolderOpen className="h-5 w-5" />
                  <div>
                    <p className="text-sm font-semibold">Multitrack</p>
                    <p className="mt-1 text-xs text-white/52">Carpeta de stems.</p>
                  </div>
                </button>
              </div>

              <div className={`rounded-[1.5rem] border border-white/8 bg-[linear-gradient(180deg,rgba(28,31,33,0.9),rgba(18,19,21,0.9))] ${isCompactLandscape ? 'p-3' : 'p-5'}`}>
                {loaderMode === 'sequence' ? (
                  <div>
                    <p className="text-[0.76rem] font-black uppercase tracking-[0.24em] text-white/40">Pista unica</p>
                    <p className={`text-white/56 ${isCompactLandscape ? 'mt-2 text-sm' : 'mt-3 text-sm'}`}>
                      Sube una sola pista de playback.
                    </p>
                    <button
                      type="button"
                      onClick={() => sequenceFileInputRef.current?.click()}
                      className={`ui-pressable-soft mt-3 flex items-center justify-center gap-2 rounded-[1rem] border border-white/10 bg-black/28 text-sm font-semibold tracking-[0.12em] text-white/84 ${isCompactLandscape ? 'h-12 px-4' : 'h-14 px-4'}`}
                    >
                      <Upload className="h-4 w-4" />
                      ELEGIR ARCHIVO
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-[0.76rem] font-black uppercase tracking-[0.24em] text-white/40">Multitrack</p>
                    <p className={`text-white/56 ${isCompactLandscape ? 'mt-2 text-sm' : 'mt-3 text-sm'}`}>
                      Sube una carpeta con stems.
                    </p>
                    <button
                      type="button"
                      onClick={() => folderInputRef.current?.click()}
                      className={`ui-pressable-soft mt-3 flex w-full items-center justify-center gap-3 rounded-[1.2rem] border border-dashed border-cyan-300/24 bg-cyan-300/7 text-cyan-50 ${isCompactLandscape ? 'h-20 px-4' : 'h-32 px-6'}`}
                    >
                      <FolderOpen className={isCompactLandscape ? 'h-6 w-6' : 'h-8 w-8'} />
                      <span className={`${isCompactLandscape ? 'text-base' : 'text-lg'} font-semibold`}>ELEGIR CARPETA</span>
                    </button>
                  </div>
                )}

                <div className={`mt-4 grid ${isCompactLandscape ? 'grid-cols-3 gap-2' : 'grid-cols-[minmax(0,0.95fr)_minmax(0,0.55fr)_minmax(0,0.55fr)] gap-4'}`}>
                  <div className={`rounded-[1.2rem] border border-white/8 bg-black/24 ${isCompactLandscape ? 'p-3' : 'p-4'}`}>
                    <p className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-white/38">Sesion</p>
                    <p className={`font-semibold text-white ${isCompactLandscape ? 'mt-2 text-sm' : 'mt-3 text-lg'}`}>
                      {hasSessionTracks ? currentSessionLabel : 'Sin sesion'}
                    </p>
                    <p className={`text-white/54 ${isCompactLandscape ? 'mt-1 text-[0.78rem]' : 'mt-2 text-sm'}`}>
                      {hasSessionTracks
                        ? canToggleTrackLoad && activeTracks.length !== sessionTracks.length
                          ? `${activeTracks.length} activas de ${sessionTracks.length}`
                          : `${activeTracks.length} pista(s)`
                        : 'Aun no hay audio cargado.'}
                    </p>
                  </div>
                  <div className={`rounded-[1.2rem] border border-white/8 bg-black/24 text-center ${isCompactLandscape ? 'p-3' : 'p-4'}`}>
                    <p className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-white/38">Cargadas</p>
                    <p className={`font-semibold text-white ${isCompactLandscape ? 'mt-2 text-xl' : 'mt-3 text-3xl'}`}>{activeTracks.length}</p>
                  </div>
                  <div className={`rounded-[1.2rem] border border-white/8 bg-black/24 text-center ${isCompactLandscape ? 'p-3' : 'p-4'}`}>
                    <p className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-white/38">Sin mapa</p>
                    <p className={`font-semibold text-white ${isCompactLandscape ? 'mt-2 text-xl' : 'mt-3 text-3xl'}`}>{unmatchedFiles.length}</p>
                  </div>
                </div>

                {!isCompactLandscape && (
                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,0.88fr)] gap-4">
                    <div className="rounded-[1rem] border border-white/8 bg-black/24 p-3">
                      <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-white/38">Pistas cargadas</p>
                      <div className="mt-3 max-h-32 space-y-2 overflow-y-auto pr-1">
                        {mappedTrackDetails.length > 0 ? (
                          mappedTrackDetails.map((track) => (
                            <div
                              key={`mapped-${track.id}-${track.sourceFileName}`}
                              className={`rounded-[0.9rem] border px-3 py-2 transition-all ${track.enabled
                                ? 'border-white/6 bg-white/[0.03]'
                                : 'border-white/5 bg-white/[0.018] opacity-65'
                                }`}
                            >
                              <p className="truncate text-sm font-semibold text-white/88">{track.sourceFileName}</p>
                              <div className="mt-1 flex items-center justify-between gap-3">
                                <p className={`min-w-0 truncate text-[0.72rem] uppercase tracking-[0.16em] ${track.enabled ? 'text-cyan-100/56' : 'text-white/34'}`}>
                                  {track.trackName}
                                </p>
                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.54rem] font-black uppercase tracking-[0.18em] ${track.enabled
                                  ? 'border-emerald-300/14 bg-emerald-300/[0.07] text-emerald-100/72'
                                  : 'border-white/8 bg-black/20 text-white/46'
                                  }`}>
                                  {track.enabled ? 'Activa' : 'Omitida'}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm leading-relaxed text-white/48">Todavia no hay archivos cargados.</p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[1rem] border border-white/8 bg-black/24 p-3">
                      <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-white/38">Archivos sin mapa</p>
                      <div className="mt-3 max-h-32 space-y-2 overflow-y-auto pr-1">
                        {unmatchedFiles.length > 0 ? (
                          unmatchedFiles.map((fileName) => (
                            <div
                              key={`unmatched-${fileName}`}
                              className="rounded-[0.9rem] border border-amber-200/10 bg-amber-200/[0.04] px-3 py-2"
                            >
                              <p className="truncate text-sm font-semibold text-white/82">{fileName}</p>
                              <p className="mt-1 text-[0.72rem] uppercase tracking-[0.16em] text-amber-100/44">
                                Sin regla
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm leading-relaxed text-white/48">Todo entro al mixer.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {hasSessionTracks && (
                  <div className={`mt-4 flex items-center justify-between rounded-[1.2rem] border border-white/8 bg-black/20 ${isCompactLandscape ? 'gap-2 px-3 py-2' : 'px-4 py-3'}`}>
                    <p className={`text-white/58 ${isCompactLandscape ? 'text-[0.76rem]' : 'text-sm'}`}>Borra la sesion y limpia sus archivos de R2.</p>
                    <button
                      type="button"
                      onClick={clearManualSession}
                      className={`ui-pressable-soft rounded-[0.9rem] border border-white/10 bg-white/6 font-semibold tracking-[0.16em] text-white/82 ${isCompactLandscape ? 'px-3 py-2 text-[0.68rem]' : 'px-4 py-2 text-xs'}`}
                    >
                      BORRAR SESION + R2
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!hasProvidedTracks && (
        <>
          <input
            ref={sequenceFileInputRef}
            type="file"
            accept={SEQUENCE_FILE_ACCEPT}
            onChange={handleSequenceFileSelection}
            className="hidden"
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            onChange={handleStemFolderSelection}
            className="hidden"
          />
        </>
      )}

      {showTrackLoadModal && canToggleTrackLoad && (
        <div className="absolute inset-0 z-[58] flex items-center justify-center bg-black/44 px-4 py-4 backdrop-blur-[10px]">
          <div className={`w-full rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,22,0.98),rgba(13,15,17,0.98))] shadow-[0_32px_64px_rgba(0,0,0,0.38)] ${useWideTrackLoadModal ? 'max-w-[44rem] p-4' : 'max-w-[34rem] p-5'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[0.7rem] font-black uppercase tracking-[0.22em] text-cyan-100/56">Carga selectiva</p>
                <h3 className={`font-semibold text-white ${useWideTrackLoadModal ? 'mt-1 text-[0.96rem] leading-tight' : 'mt-1.5 text-[1.2rem]'}`}>
                  {currentSessionLabel}
                </h3>
                <p className={`text-white/54 ${useWideTrackLoadModal ? 'mt-1 text-[0.74rem]' : 'mt-1.5 text-sm'}`}>
                  Desactiva stems que no vas a usar para que no se descarguen.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseTrackLoadModal}
                className="ui-pressable-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/26 text-white/58 hover:text-white"
                aria-label="Cerrar configuracion de carga"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className={`mt-4 flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/24 ${useWideTrackLoadModal ? 'px-3 py-2' : 'px-3 py-2.5'}`}>
              <div>
                <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-white/36">Resumen</p>
                <p className={`${useWideTrackLoadModal ? 'mt-0.5 text-[0.92rem]' : 'mt-1 text-sm'} font-semibold text-white/88`}>
                  {pendingEffectiveEnabledCount} de {sessionTracks.length} activos{isWebTrackLimitExceeded || pendingEnabledCount > pendingEffectiveEnabledCount ? ` (tope ${webActiveTrackLimit})` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!pendingEnabledMap) return;
                  const nextMap: Record<string, boolean> = {};
                  // Activate highest-priority stems first so the cap retains drums/bass/vocals
                  // over decorative pads or fx when the session exceeds the platform limit.
                  const rankedTracks = sessionTracks
                    .map((track, index) => ({ track, index, rank: stemPriorityRank(track) }))
                    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
                  let enabledCount = 0;
                  rankedTracks.forEach(({ track }) => {
                    const canEnable = enabledCount < webActiveTrackLimit;
                    nextMap[track.id] = canEnable;
                    if (canEnable) {
                      enabledCount += 1;
                    }
                  });
                  setPendingEnabledMap(nextMap);
                }}
                className={`ui-pressable-soft rounded-full border border-white/10 bg-white/[0.05] font-black uppercase tracking-[0.18em] text-white/76 ${useWideTrackLoadModal ? 'px-3 py-1.5 text-[0.58rem]' : 'px-3 py-2 text-[0.62rem]'}`}
              >
                Activar todo
              </button>
            </div>

            <div className={`mt-4 overflow-y-auto pr-1 ${useWideTrackLoadModal ? 'max-h-[56dvh]' : 'max-h-[52dvh]'}`}>
              <div className={`grid ${useWideTrackLoadModal ? 'grid-cols-2 gap-2' : 'grid-cols-1 gap-2'}`}>
              {mappedTrackDetails.map((track) => {
                const pendingEnabled = pendingEnabledMap ? (pendingEnabledMap[track.id] !== false) : track.enabled;
                return (
                  <button
                    key={`toggle-track-load-${track.id}`}
                    type="button"
                    onClick={() => {
                      if (!pendingEnabledMap) return;
                      const isEnabling = pendingEnabledMap[track.id] === false;
                      const enabledCount = Object.values(pendingEnabledMap).filter(Boolean).length;
                      if (isEnabling && enabledCount >= webActiveTrackLimit) return;
                      const next = { ...pendingEnabledMap, [track.id]: !pendingEnabledMap[track.id] };
                      const hasAny = Object.values(next).some(Boolean);
                      if (hasAny) setPendingEnabledMap(next);
                    }}
                    className={`w-full rounded-[1rem] border text-left transition-all ${useWideTrackLoadModal ? 'px-3 py-2.5' : 'px-3 py-3'} ${pendingEnabled
                      ? 'border-white/8 bg-white/[0.035]'
                      : 'border-white/6 bg-black/20 opacity-72'
                      }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`truncate font-semibold text-white/88 ${useWideTrackLoadModal ? 'text-[0.9rem]' : 'text-sm'}`}>{track.sourceFileName}</p>
                        <p className={`uppercase tracking-[0.16em] ${useWideTrackLoadModal ? 'mt-0.5 text-[0.62rem]' : 'mt-1 text-[0.7rem]'} ${pendingEnabled ? 'text-cyan-100/56' : 'text-white/34'}`}>
                          {track.trackName}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full border font-black uppercase tracking-[0.18em] ${useWideTrackLoadModal ? 'px-2.5 py-1 text-[0.52rem]' : 'px-3 py-1.5 text-[0.58rem]'} ${pendingEnabled
                        ? 'border-emerald-300/18 bg-emerald-300/[0.09] text-emerald-100/84'
                        : 'border-white/10 bg-black/26 text-white/54'
                        }`}>
                        {pendingEnabled ? 'Activa' : 'Omitida'}
                      </span>
                    </div>
                  </button>
                );
              })}
              </div>
            </div>
          </div>
        </div>
      )}

      {showBackConfirm && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/58 backdrop-blur-[6px] px-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="live-director-back-confirm-title"
        >
          <div className="w-full max-w-sm rounded-[1.6rem] border border-white/12 bg-[linear-gradient(180deg,rgba(22,24,26,0.98),rgba(16,18,20,0.98))] px-6 py-6 shadow-[0_32px_72px_rgba(0,0,0,0.42)]">
            <p className="text-[0.68rem] font-black uppercase tracking-[0.28em] text-amber-200/82">
              La cancion sigue sonando
            </p>
            <h3
              id="live-director-back-confirm-title"
              className="mt-2 text-[1.25rem] font-semibold tracking-tight text-white"
            >
              ¿Salir del Live Director?
            </h3>
            <p className="mt-2 text-[0.88rem] leading-relaxed text-white/60">
              Si sales ahora, la reproduccion se detiene. Toca Cancelar para seguir dirigiendo.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowBackConfirm(false)}
                className="ui-pressable-soft flex-1 rounded-[1rem] border border-white/12 bg-white/4 px-4 py-3 text-[0.92rem] font-semibold text-white/86 hover:bg-white/8"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  void exitLiveDirector();
                }}
                className="ui-pressable-soft flex-1 rounded-[1rem] border border-amber-300/38 bg-amber-300/12 px-4 py-3 text-[0.92rem] font-semibold text-amber-50 hover:bg-amber-300/18"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      )}

      {!isIOSNativeEngineSurface && (
        <>
          <audio ref={padAudioRefA} preload="none" className="hidden" />
          <audio ref={padAudioRefB} preload="none" className="hidden" />
        </>
      )}

      {showLoadWarningBanner && loadWarnings && loadWarnings.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[55] flex justify-center px-3">
          <div className="pointer-events-auto w-full max-w-xl rounded-[1.1rem] border border-amber-300/25 bg-[linear-gradient(180deg,rgba(34,26,12,0.96),rgba(24,18,8,0.96))] px-4 py-3 shadow-[0_18px_36px_rgba(0,0,0,0.3)]">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.75rem] border border-amber-300/25 bg-amber-300/10 text-amber-200">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-amber-200/80">
                  Stems omitidos ({loadWarnings.length})
                </p>
                <p className="mt-1 text-[0.88rem] leading-snug text-white/80">
                  La sesión cargó sin estos archivos porque el motor no pudo abrirlos:
                </p>
                <ul className="mt-2 space-y-1 text-[0.82rem] leading-snug text-white/72">
                  {loadWarnings.slice(0, 4).map((warning) => {
                    const ext = warning.playExtension ? `.${warning.playExtension}` : '';
                    const code = warning.fourCharCode
                      ? ` (${warning.fourCharCode})`
                      : warning.osStatus
                        ? ` (OSStatus ${warning.osStatus})`
                        : '';
                    return (
                      <li key={`${warning.trackId}:${warning.reason}`} className="truncate">
                        <span className="font-semibold text-white/90">{warning.trackName || warning.trackId}</span>
                        <span className="text-white/60">{ext}{code}</span>
                      </li>
                    );
                  })}
                  {loadWarnings.length > 4 && (
                    <li className="text-white/55">+ {loadWarnings.length - 4} más…</li>
                  )}
                </ul>
                <p className="mt-2 text-[0.76rem] leading-snug text-amber-100/70">
                  Consejo: re-exporta los stems problemáticos como <span className="font-semibold">AAC-LC (.m4a 256 kbps)</span> o <span className="font-semibold">FLAC</span>. Evita ALAC — no abre en Windows ni Android.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDismissedLoadWarningKey(loadWarningsKey)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.7rem] border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Cerrar aviso de stems omitidos"
                title="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {busyMessage && (() => {
        // When we have real load progress, compute fill + counts so the
        // overlay becomes a live progress indicator instead of an opaque
        // "please wait" spinner. Fall back to indeterminate style when we
        // don't know the denominator yet.
        const hasDeterminateProgress =
          !!loadProgress && loadProgress.total > 0 && loadProgress.loaded >= 0;
        const progressPct = hasDeterminateProgress
          ? clamp(loadProgress!.loaded / loadProgress!.total, 0, 1) * 100
          : 0;
        return (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/26 backdrop-blur-[8px]">
            <div className="w-[min(26rem,88vw)] rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(16,18,19,0.92),rgba(13,15,16,0.92))] px-6 py-5 shadow-[0_28px_48px_rgba(0,0,0,0.28)]">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-[1rem] border border-cyan-300/15 bg-cyan-300/8">
                  <div className="flex gap-1">
                    <span className="h-6 w-1.5 animate-pulse rounded-full bg-cyan-300/70 [animation-delay:-240ms]" />
                    <span className="h-8 w-1.5 animate-pulse rounded-full bg-cyan-300/90 [animation-delay:-120ms]" />
                    <span className="h-5 w-1.5 animate-pulse rounded-full bg-cyan-300/60" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.78rem] font-black uppercase tracking-[0.25em] text-cyan-100/72">En espera</p>
                  <p className="mt-1 truncate text-[1.18rem] font-semibold text-white">{busyMessage}</p>
                </div>
                {hasDeterminateProgress && (
                  <div className="shrink-0 rounded-full border border-cyan-300/22 bg-cyan-400/10 px-2.5 py-1 text-[0.62rem] font-black uppercase tracking-[0.2em] tabular-nums text-cyan-100/86">
                    {loadProgress!.loaded}/{loadProgress!.total}
                  </div>
                )}
              </div>
              {hasDeterminateProgress && (
                <div className="mt-4">
                  <div
                    className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/8"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={loadProgress!.total}
                    aria-valuenow={loadProgress!.loaded}
                    aria-label="Progreso de carga de stems"
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-cyan-200 to-teal-200 shadow-[0_0_14px_rgba(103,232,249,0.45)]"
                      style={{
                        width: `${Math.max(progressPct, 4)}%`,
                        transition: 'width 200ms ease',
                        willChange: 'width',
                      }}
                    />
                  </div>
                  <p className="mt-2 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-white/46">
                    {Math.round(progressPct)}% — {loadProgress!.total - loadProgress!.loaded} stem{loadProgress!.total - loadProgress!.loaded === 1 ? '' : 's'} restante{loadProgress!.total - loadProgress!.loaded === 1 ? '' : 's'}
                  </p>
                </div>
              )}
              {!hasDeterminateProgress && (
                <div className="mt-4">
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                    <div className="live-director-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-cyan-300/70 via-cyan-200/90 to-cyan-300/70 shadow-[0_0_12px_rgba(103,232,249,0.4)]" />
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {loadError && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/24 backdrop-blur-[8px]">
          <div className="max-w-lg rounded-[1.8rem] border border-rose-300/18 bg-[linear-gradient(180deg,rgba(23,15,17,0.96),rgba(16,12,13,0.96))] px-7 py-6 shadow-[0_30px_60px_rgba(0,0,0,0.32)]">
            <p className="text-[0.8rem] font-black uppercase tracking-[0.28em] text-rose-200/70">Error de audio</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">La sesion multitrack no pudo terminar de cargarse.</h2>
            <p className="mt-3 text-base leading-relaxed text-white/62">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                if (hasTrackSession) {
                  setReloadKey((previous) => previous + 1);
                  return;
                }

                setLoadError(null);
                setShowLoadPanel(true);
              }}
              className="ui-pressable mt-5 rounded-[1rem] border border-white/10 bg-white/8 px-5 py-3 text-sm tracking-[0.18em] text-white"
            >
              {hasTrackSession ? 'REINTENTAR CARGA' : 'VOLVER AL CARGADOR'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default LiveDirectorView;
