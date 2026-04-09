import {
  FolderOpen,
  Link2,
  ListMusic,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  SlidersVertical,
  Smartphone,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useMultitrackEngine } from '../../hooks/useMultitrackEngine';
import type { SongStructure, TrackData } from '../../services/MultitrackEngine';
import {
  createSequenceSessionFromFile,
  createSequenceSessionFromUrl,
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
  deleteLiveDirectorSongSession,
  requestLiveDirectorUploadTarget,
  saveLiveDirectorSongSession,
  uploadFileToLiveDirectorTarget,
} from '../../utils/liveDirectorUploadClient';
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
};

type DragScrollState = {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startScrollLeft: number;
};

type SurfaceView = 'mix' | 'sections';

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
};

type ChannelStripProps = {
  id: string;
  label: string;
  shortLabel: string;
  accent: string;
  volume: number;
  level: number;
  muted: boolean;
  soloed: boolean;
  dimmed: boolean;
  disabled: boolean;
  compact?: boolean;
  onVolumeChange: (volume: number) => void;
  onMute: () => void;
  onSolo: () => void;
};

type MixerTrackView = MixerTrackMeta & {
  volume: number;
  level: number;
  muted: boolean;
  soloed: boolean;
  dimmed: boolean;
  disabled: boolean;
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
const SECTION_LANE_PLAYHEAD_OFFSET_PX = 92;
const SECTION_WAVE_BAR_WIDTH_PX = 6;
const SECTION_WAVE_BAR_GAP_PX = 4;
const SECTION_WAVE_BAR_INSET_PX = 16;
const SECTION_WAVE_BAR_MIN_COUNT = 7;

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

const toResolvedSession = (
  session: LiveDirectorPersistedSession,
): LiveDirectorResolvedSession => ({
  mode: session.mode,
  sessionLabel: session.songTitle || 'Saved Session',
  tracks: session.tracks.map((track) => ({
    id: track.id,
    name: track.name,
    url: track.url,
    volume: track.volume,
    isMuted: track.isMuted,
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
  muted,
  soloed,
  dimmed,
  disabled,
  compact = false,
  onVolumeChange,
  onMute,
  onSolo,
}: ChannelStripProps) {
  const levelBottom = `${10 + volume * 78}%`;
  const knobGlow = muted ? 'rgba(120, 128, 140, 0.15)' : `${accent}30`;
  const meterHeightPercent = Math.max(0, level * 82);
  const meterOpacity = muted ? 0.18 : 0.24 + level * 0.76;

  return (
    <div
      className={`relative flex h-full min-w-0 flex-col items-center rounded-[1.75rem] border border-white/7 bg-[linear-gradient(180deg,rgba(34,35,37,0.92),rgba(26,27,29,0.94))] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-all duration-200 ${
        compact ? 'px-1 pb-1 pt-0.5' : 'px-3.5 pb-4 pt-3'
      } ${dimmed ? 'opacity-45' : 'opacity-100'}`}
    >
      <div className={`flex w-full items-center justify-between gap-1.5 ${compact ? 'mb-0.5' : 'mb-2'}`}>
        <button
          type="button"
          onClick={onSolo}
          disabled={disabled}
          aria-label={`Solo ${label}`}
          className={`ui-pressable-soft flex items-center justify-center rounded-full border font-black tracking-[0.18em] transition-all duration-150 ${
            compact ? 'h-6 w-6 text-[0.58rem]' : 'h-10 w-10 text-[0.76rem]'
          } ${
            soloed
              ? 'border-cyan-300/60 bg-cyan-300/16 text-cyan-100 shadow-[0_0_18px_rgba(103,210,242,0.24)]'
              : 'border-white/8 bg-black/32 text-white/65 hover:border-white/14 hover:text-white'
          }`}
        >
          S
        </button>
        <button
          type="button"
          onClick={onMute}
          disabled={disabled}
          aria-label={`${muted ? 'Unmute' : 'Mute'} ${label}`}
          className={`ui-pressable-soft flex items-center justify-center rounded-full border font-black tracking-[0.18em] transition-all duration-150 ${
            compact ? 'h-6 min-w-6 px-1.5 text-[0.58rem]' : 'h-10 min-w-10 px-3 text-[0.72rem]'
          } ${
            muted
              ? 'border-rose-300/55 bg-rose-400/16 text-rose-100 shadow-[0_0_18px_rgba(251,113,133,0.22)]'
              : 'border-white/8 bg-black/28 text-white/52 hover:border-white/14 hover:text-white'
          }`}
        >
          M
        </button>
      </div>

      <div className="relative flex w-full flex-1 items-center justify-center">
        <div className="relative h-full w-full max-w-[7.6rem]">
          <div className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-[#040506] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] ${compact ? 'top-[7%] bottom-[11%] w-[0.56rem]' : 'top-[4.5%] bottom-[6.5%] w-[0.72rem]'}`} />
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={`${id}-mark-${index}`}
              className="absolute left-1/2 h-[2px] w-[72%] -translate-x-1/2 rounded-full bg-white/18"
              style={{ bottom: `${12 + index * 10}%` }}
            />
          ))}
          <div
            className="absolute left-1/2 bottom-[10%] w-[0.32rem] -translate-x-1/2 rounded-full shadow-[0_0_14px_rgba(103,210,242,0.16)] transition-[height,opacity,box-shadow] duration-100"
            style={{
              height: `${meterHeightPercent}%`,
              backgroundColor: muted ? 'rgba(136, 144, 158, 0.42)' : accent,
              opacity: meterOpacity,
              boxShadow: muted ? '0 0 0 transparent' : `0 0 ${10 + level * 18}px ${accent}38`,
            }}
          />
          <FaderThumb
            accent={accent}
            level={level}
            muted={muted}
            className={`${compact ? 'h-[2.2rem]' : 'h-[4.35rem]'} w-full ${compact ? 'max-w-[5.6rem]' : 'max-w-[7.9rem]'} transition-[bottom,box-shadow,opacity,transform] duration-150`}
            style={{
              bottom: `calc(${levelBottom} - ${compact ? '1.1rem' : '1.75rem'})`,
              boxShadow: muted
                ? '0 12px 20px rgba(0,0,0,0.24)'
                : `0 14px 24px rgba(0,0,0,0.35), 0 0 20px ${knobGlow}`,
              opacity: dimmed ? 0.84 : 1,
            }}
          />

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            disabled={disabled}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            aria-label={`Volume for ${label}`}
            className={`absolute left-1/2 top-1/2 h-10 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer opacity-0 ${compact ? 'w-40' : 'w-[18rem]'}`}
          />
        </div>
      </div>

      <div className={`text-center ${compact ? 'mt-0.5' : 'mt-4'}`}>
        {!compact && <p className="text-[0.62rem] font-black uppercase tracking-[0.3em] text-white/28">{shortLabel}</p>}
        <p className={`leading-tight text-white/88 ${compact ? 'text-[9px] font-semibold' : 'mt-1 text-[1.03rem] font-semibold'}`}>{label}</p>
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
  previousProps.muted === nextProps.muted &&
  previousProps.soloed === nextProps.soloed &&
  previousProps.dimmed === nextProps.dimmed &&
  previousProps.disabled === nextProps.disabled &&
  previousProps.compact === nextProps.compact
));

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
}: LiveDirectorViewProps) {
  const hasProvidedTracks = Boolean(tracks && tracks.length > 0);
  const hasPersistedSongContext = Boolean(songId);
  const isSongBoundView = requiresSongContext || hasPersistedSongContext;
  const sequenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const sectionsLaneScrollRef = useRef<HTMLDivElement | null>(null);
  const mixerScrollRef = useRef<HTMLDivElement | null>(null);
  const mixerDragStateRef = useRef<DragScrollState>({
    active: false,
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
  });
  const padAudioRef = useRef<HTMLAudioElement | null>(null);
  const ownedObjectUrlsRef = useRef<string[]>([]);
  const [useStreamingEngine, setUseStreamingEngine] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [hasResolvedEngineFlag, setHasResolvedEngineFlag] = useState(false);
  const {
    currentTime,
    diagnostics,
    initialize,
    isPlaying,
    isReady,
    play,
    pause,
    seekTo,
    setLoopPoints,
    setMasterVolume,
    setVolume,
    soloTrack,
    stop,
    trackLevels,
    toggleLoop,
    toggleMute,
    trackVolumes,
  } = useMultitrackEngine({
    useStreamingEngine,
  });
  const [isPortrait, setIsPortrait] = useState(false);
  const [isCompactLandscape, setIsCompactLandscape] = useState(false);
  const [isUltraCompactLandscape, setIsUltraCompactLandscape] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [manualSession, setManualSession] = useState<LiveDirectorResolvedSession | null>(
    initialSession ? toResolvedSession(initialSession) : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isInitializingSession, setIsInitializingSession] = useState(false);
  const [showLoadPanel, setShowLoadPanel] = useState(
    !hasProvidedTracks && !initialSession && (!requiresSongContext || hasPersistedSongContext),
  );
  const [loaderMode, setLoaderMode] = useState<'sequence' | 'folder'>('sequence');
  const [sequenceUrlInput, setSequenceUrlInput] = useState('');
  const [unmatchedFiles, setUnmatchedFiles] = useState<string[]>([]);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [mutedTrackIds, setMutedTrackIds] = useState<Set<string>>(new Set());
  const [soloTrackId, setSoloTrackId] = useState<string | null>(null);
  const [masterVolume, setMasterVolumeState] = useState(0.82);
  const [loopPointA, setLoopPointA] = useState(4);
  const [loopPointB, setLoopPointB] = useState(12);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [surfaceView, setSurfaceView] = useState<SurfaceView>('mix');
  const [isPadActive, setIsPadActive] = useState(false);
  const [songCoverArtUrl, setSongCoverArtUrl] = useState<string | null>(null);
  const currentEngineLabel = useStreamingEngine ? 'Stream' : 'Buffer';
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

  const activeTracks = useMemo(
    () => (hasProvidedTracks ? tracks || [] : manualSession?.tracks || []),
    [hasProvidedTracks, manualSession?.tracks, tracks],
  );

  const hasTrackSession = activeTracks.length > 0;
  const currentSessionLabel = hasProvidedTracks
    ? subtitle
    : manualSession?.sessionLabel || songTitle || 'No Session Loaded';
  const inferredSessionMode = manualSession?.mode || (activeTracks.length > 1 ? 'folder' : 'sequence');
  const sessionModeLabel = !hasTrackSession
    ? 'Not armed'
    : inferredSessionMode === 'folder'
      ? `${activeTracks.length} stem${activeTracks.length === 1 ? '' : 's'}`
      : 'Single sequence';
  const showSectionsPanel = surfaceView === 'sections';
  const displayBpm = Number.isFinite(Number(bpm)) ? Math.max(0, Math.round(Number(bpm))) : 0;
  const resolvedPadUrl = useMemo(() => getPadUrlForSongKey(songKey), [songKey]);
  const songCardTitle = songTitle || currentSessionLabel;
  const performerLabel = title?.replace(/^Live Director\s*-\s*/i, '').trim() || '';
  const songCardMeta = [performerLabel, songKey].filter(Boolean).join(' · ') || sessionModeLabel;
  const songSupportMeta = hasTrackSession
    ? sessionModeLabel
    : hasPersistedSongContext
      ? 'Carga una sesion real para esta cancion'
      : 'Abre esta superficie desde repertorio';
  const surfaceBadgeLabel = showSectionsPanel ? 'Sections' : 'Mix';
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

  const totalDuration = useMemo(
    () => resolvedSections.reduce((maxTime, section) => Math.max(maxTime, section.endTime), 0),
    [resolvedSections],
  );
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
        const segment = {
          section,
          waveBars: buildWaveBars(index + 1, waveBarCount),
          widthPx,
          leftPx: cursor,
        };

        cursor += widthPx + SECTION_LANE_GAP_PX;
        return segment;
      });
    },
    [resolvedSections],
  );
  const sectionLaneContentWidth = useMemo(() => {
    if (sectionLaneSegments.length === 0) {
      return SECTION_LANE_PLAYHEAD_OFFSET_PX * 2;
    }

    const lastSegment = sectionLaneSegments[sectionLaneSegments.length - 1];
    return lastSegment.leftPx + lastSegment.widthPx + SECTION_LANE_PLAYHEAD_OFFSET_PX * 2;
  }, [sectionLaneSegments]);

  const progressPercent = totalDuration > 0 ? clamp(currentTime / totalDuration, 0, 1) * 100 : 0;
  const diagnosticsCards = useMemo(
    () => [
      { label: 'Heap', value: formatMemoryValue(diagnostics?.browserHeapUsedBytes ?? null) },
      { label: 'Audio Est.', value: formatMemoryValue(diagnostics?.estimatedAudioMemoryBytes ?? null) },
      { label: 'Tracks', value: diagnostics ? String(diagnostics.trackCount) : 'n/a' },
      { label: 'Device', value: formatDeviceMemoryValue(diagnostics?.deviceMemoryGb ?? null) },
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

    if (currentTime >= totalDuration && resolvedSections.length > 0) {
      return resolvedSections.length - 1;
    }

    return 0;
  }, [currentTime, resolvedSections, totalDuration]);
  const activeSection = resolvedSections[activeSectionIndex] || resolvedSections[0] || null;

  const sectionLaneProgressPx = useMemo(() => {
    if (sectionLaneSegments.length === 0) {
      return 0;
    }

    const activeSegment = sectionLaneSegments[activeSectionIndex] || sectionLaneSegments[0];

    if (currentTime <= activeSegment.section.startTime) {
      return activeSegment.leftPx;
    }

    if (currentTime >= totalDuration) {
      const lastSegment = sectionLaneSegments[sectionLaneSegments.length - 1];
      return lastSegment.leftPx + lastSegment.widthPx;
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
  }, [activeSectionIndex, currentTime, sectionLaneSegments, totalDuration]);

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

    return sourceTracks.map((track, index) => {
      const meta = buildMixerTrackMeta(track, index);

      return {
        ...meta,
        volume: trackVolumes[track.id] ?? track.volume ?? meta.defaultVolume,
        level: trackLevels[track.id] ?? 0,
        muted: mutedTrackIds.has(track.id),
        soloed: soloTrackId === track.id,
        dimmed: Boolean(soloTrackId && soloTrackId !== track.id),
        disabled: activeTracks.length === 0,
      };
    });
  }, [activeTracks, mutedTrackIds, soloTrackId, trackLevels, trackVolumes]);

  const mappedTrackDetails = useMemo(
    () =>
      activeTracks.map((track) => ({
        id: track.id,
        trackName: track.name,
        sourceFileName: track.sourceFileName || track.name,
      })),
    [activeTracks],
  );

  const replaceOwnedObjectUrls = useCallback((nextObjectUrls: string[]) => {
    ownedObjectUrlsRef.current.forEach((objectUrl) => {
      URL.revokeObjectURL(objectUrl);
    });
    ownedObjectUrlsRef.current = nextObjectUrls;
  }, []);

  useEffect(() => {
    if (!initialSession || hasProvidedTracks) {
      return;
    }

    setManualSession(toResolvedSession(initialSession));
    setUnmatchedFiles(initialSession.unmatchedFiles || []);
    setShowLoadPanel(false);
  }, [hasProvidedTracks, initialSession]);

  useEffect(() => {
    if (!showSectionsPanel) {
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

    scrollContainer.scrollTo({
      left: targetScrollLeft,
      behavior: 'auto',
    });
  }, [sectionLaneProgressPx, showSectionsPanel]);

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

  const applyManualSession = useCallback((session: LiveDirectorResolvedSession) => {
    stop();
    setLoadError(null);
    setUnmatchedFiles(session.unmatchedFiles);
    setMutedTrackIds(new Set(session.tracks.filter((track) => track.isMuted).map((track) => track.id)));
    setSoloTrackId(null);
    setShowLoadPanel(false);
    replaceOwnedObjectUrls(session.objectUrls);
    setManualSession(session);
  }, [replaceOwnedObjectUrls, stop]);

  const clearManualSession = useCallback(async () => {
    stop();
    setLoadError(null);
    setBusyMessage(hasPersistedSongContext ? 'Removing session and deleting R2 files...' : null);

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
    setUseStreamingEngine(searchParams.get('engine') === 'streaming');
    setShowDiagnostics(searchParams.get('debug') === '1');
    setHasResolvedEngineFlag(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasResolvedEngineFlag) {
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
  }, [hasResolvedEngineFlag, showDiagnostics, useStreamingEngine]);

  useEffect(() => {
    return () => {
      replaceOwnedObjectUrls([]);
    };
  }, [replaceOwnedObjectUrls]);

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
      setBusyMessage(useStreamingEngine ? 'Starting streaming engine...' : 'Loading audio buffers...');
      setMutedTrackIds(new Set(activeTracks.filter((track) => track.isMuted).map((track) => track.id)));
      setSoloTrackId(null);

      try {
        await initialize(activeTracks);
        if (cancelled) {
          return;
        }

        setIsInitializingSession(false);
        setBusyMessage(null);
        console.log(`[LiveDirectorView] Initialized ${activeTracks.length} track(s).`);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIsInitializingSession(false);
        setBusyMessage(null);
        console.error('[LiveDirectorView] Failed to initialize the multitrack engine.', error);
        setLoadError(error instanceof Error ? error.message : 'Could not load the audio buffers.');
      }
    };

    void setup();

    return () => {
      cancelled = true;
      stop();
    };
  }, [activeTracks, hasResolvedEngineFlag, initialize, reloadKey, stop, useStreamingEngine]);

  useEffect(() => {
    setLoopPoints(loopPointA, loopPointB);
  }, [loopPointA, loopPointB, setLoopPoints]);

  useEffect(() => {
    setMasterVolume(masterVolume);
  }, [masterVolume, setMasterVolume]);

  useEffect(() => {
    const padElement = padAudioRef.current;
    if (!padElement) {
      return;
    }

    if (!resolvedPadUrl) {
      padElement.pause();
      padElement.removeAttribute('src');
      padElement.load();
      setIsPadActive(false);
      return;
    }

    padElement.src = resolvedPadUrl;
    padElement.loop = true;
    padElement.volume = 0.34;

    if (!isPadActive) {
      padElement.pause();
      padElement.currentTime = 0;
      return;
    }

    void padElement.play().catch((error) => {
      console.warn('[LiveDirectorView] Pad autoplay blocked.', error);
      setIsPadActive(false);
    });
  }, [isPadActive, resolvedPadUrl]);

  const persistSongSession = useCallback(async (payload: {
    mode: 'sequence' | 'folder';
    tracks: Array<TrackData & { sourceFileName?: string }>;
    unmatchedFiles?: string[];
    sectionOffsetSeconds?: number;
  }) => {
    if (!hasPersistedSongContext) {
      throw new Error('No hay una cancion seleccionada para guardar esta sesion.');
    }

    setBusyMessage('Saving multitrack session...');

    const savedSession = await saveLiveDirectorSongSession({
      songId,
      session: {
        mode: payload.mode,
        tracks: payload.tracks.map((track) => ({
          id: track.id,
          name: track.name,
          url: track.url,
          volume: track.volume,
          isMuted: track.isMuted,
          sourceFileName: track.sourceFileName,
        })),
        unmatchedFiles: payload.unmatchedFiles || [],
        sectionOffsetSeconds: Number.isFinite(Number(payload.sectionOffsetSeconds))
          ? Number(payload.sectionOffsetSeconds)
          : sectionOffsetSeconds,
      },
    });

    applyManualSession(toResolvedSession(savedSession));
    setBusyMessage(null);
    return savedSession;
  }, [applyManualSession, hasPersistedSongContext, sectionOffsetSeconds, songId]);

  const saveSectionOffset = useCallback(async (nextOffset: number) => {
    const safeOffset = Math.round(nextOffset * 4) / 4;

    setManualSession((previous) => (
      previous
        ? {
            ...previous,
            sectionOffsetSeconds: safeOffset,
          }
        : previous
    ));

    if (!hasPersistedSongContext || !manualSession) {
      return;
    }

    try {
      setBusyMessage('Saving section offset...');
      await saveLiveDirectorSongSession({
        songId,
        session: {
          mode: manualSession.mode,
          tracks: manualSession.tracks.map((track) => ({
            id: track.id,
            name: track.name,
            url: track.url,
            volume: track.volume,
            isMuted: track.isMuted,
            sourceFileName: track.sourceFileName,
          })),
          unmatchedFiles: manualSession.unmatchedFiles || [],
          sectionOffsetSeconds: safeOffset,
        },
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo guardar el offset de secciones.');
    } finally {
      setBusyMessage(null);
    }
  }, [hasPersistedSongContext, manualSession, songId]);

  const handleLoadSequenceFromUrl = async () => {
    try {
      const safeSequenceUrl = String(sequenceUrlInput || '').trim();

      if (hasPersistedSongContext) {
        if (!safeSequenceUrl) {
          throw new Error('Ingresa una URL de audio para cargar la secuencia.');
        }

        await persistSongSession({
          mode: 'sequence',
          tracks: [
            {
              id: 'sequence',
              name: 'Sequence',
              url: safeSequenceUrl,
              volume: 0.84,
              isMuted: false,
            },
          ],
        });
        return;
      }

      applyManualSession(createSequenceSessionFromUrl(safeSequenceUrl));
    } catch (error) {
      setBusyMessage(null);
      setLoadError(error instanceof Error ? error.message : 'No se pudo cargar la secuencia.');
    }
  };

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
        setBusyMessage(`Inspecting ${files.length} files...`);
        const inference = inferStemTracksFromFiles(files);
        console.info('[LiveDirectorView] Stem inference completed.', {
          matchedFiles: inference.matchedFiles.length,
          unmatchedFiles: inference.unmatchedFiles.length,
        });
        setBusyMessage(`Uploading ${inference.matchedFiles.length} stems...`);

        const uploadedTracks = await Promise.all(
          inference.matchedFiles.map(async (matchedFile) => {
            const uploadTarget = await requestLiveDirectorUploadTarget({
              songId,
              fileName: `${matchedFile.trackId}-${matchedFile.file.name}`,
              fileType: matchedFile.file.type,
              kind: 'stems',
            });

            await uploadFileToLiveDirectorTarget(matchedFile.file, uploadTarget);

            return {
              id: matchedFile.trackId,
              name: matchedFile.trackName,
              url: uploadTarget.publicUrl,
              volume: matchedFile.defaultVolume,
              isMuted: false,
              sourceFileName: matchedFile.file.name,
            };
          }),
        );

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

  const handleLoopMarker = (marker: 'a' | 'b') => {
    const safeTime = clamp(currentTime, 0, totalDuration);

    if (marker === 'a') {
      const nextStart = Math.min(safeTime, Math.max(0, loopPointB - 0.25));
      setLoopPointA(nextStart);
      if (loopPointB <= nextStart) {
        setLoopPointB(Math.min(totalDuration, nextStart + 2));
      }
      return;
    }

    const nextEnd = Math.max(safeTime, loopPointA + 0.25);
    setLoopPointB(Math.min(totalDuration, nextEnd));
  };

  const handleLoopIn = () => {
    setLoopPoints(loopPointA, loopPointB);
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

  const handleEngineToggle = useCallback(() => {
    setLoadError(null);
    setBusyMessage(null);
    setIsInitializingSession(false);
    setUseStreamingEngine((previous) => !previous);
  }, []);

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
  }, []);

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

    try {
      container.setPointerCapture(event.pointerId);
    } catch {
      // no-op
    }
  }, []);

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

  const readyStateLabel = !hasTrackSession
    ? 'No Session'
    : busyMessage
      ? 'Preparing'
    : isInitializingSession
      ? 'Buffering'
      : loadError
        ? 'Load Error'
        : isReady
          ? (isPlaying ? 'Running' : 'Armed')
          : 'Standby';

  const shellClassName = ['fixed inset-0 overflow-hidden bg-[#202223] text-white', className]
    .filter(Boolean)
    .join(' ');
  const shellContentStyle = useMemo(
    () =>
      ({
        height: '100dvh',
        minHeight: '100dvh',
        maxHeight: '100dvh',
        paddingTop: `max(env(safe-area-inset-top), ${scaleRem(isUltraCompactLandscape ? 0.22 : isCompactLandscape ? 0.6 : 0.8, 0.18)})`,
        paddingRight: `max(env(safe-area-inset-right), ${scaleRem(isUltraCompactLandscape ? 0.3 : isCompactLandscape ? 0.75 : 1, 0.22)})`,
        paddingBottom: `max(env(safe-area-inset-bottom), ${scaleRem(isUltraCompactLandscape ? 0.25 : isCompactLandscape ? 0.75 : 1, 0.2)})`,
        paddingLeft: `max(env(safe-area-inset-left), ${scaleRem(isUltraCompactLandscape ? 0.3 : isCompactLandscape ? 0.75 : 1, 0.22)})`,
        gap: scaleRem(isUltraCompactLandscape ? 0.12 : isCompactLandscape ? 0.6 : 1, 0.08),
        ['--ld-control-height' as string]: scaleRem(isUltraCompactLandscape ? 2.95 : isCompactLandscape ? 4.2 : 5.15, 2.35),
        ['--ld-summary-row-height' as string]: scaleRem(isUltraCompactLandscape ? 3.95 : isCompactLandscape ? 5.4 : 8.9, 3.2),
        ['--ld-sections-row-height' as string]: scaleRem(isUltraCompactLandscape ? 8.6 : isCompactLandscape ? 10.9 : 12.4, 6.4),
      }) as CSSProperties,
    [isCompactLandscape, isUltraCompactLandscape, scaleRem],
  );
  const overlayPaddingStyle = useMemo(
    () =>
      ({
        paddingTop: `max(env(safe-area-inset-top), ${scaleRem(isCompactLandscape ? 1 : 2, 1)})`,
        paddingRight: `max(env(safe-area-inset-right), ${scaleRem(isCompactLandscape ? 1 : 2, 1)})`,
        paddingBottom: `max(env(safe-area-inset-bottom), ${scaleRem(isCompactLandscape ? 1 : 2, 1)})`,
        paddingLeft: `max(env(safe-area-inset-left), ${scaleRem(isCompactLandscape ? 1 : 2, 1)})`,
      }) as CSSProperties,
    [isCompactLandscape, scaleRem],
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
            <h2 className="mt-6 text-3xl font-semibold tracking-tight text-white">Landscape Required</h2>
            <p className="mt-3 text-lg leading-relaxed text-white/62">
              This director surface is locked to horizontal orientation for live stage operation.
              Rotate the device to continue.
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
            <p className="text-[0.8rem] font-black uppercase tracking-[0.3em] text-cyan-100/62">Song Required</p>
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
              <div
                className={`flex ${isUltraCompactLandscape ? 'rounded-[0.8rem] px-1 py-0.5' : isCompactLandscape ? 'rounded-[1rem] py-1' : 'rounded-[1.45rem] py-3'} shrink-0 flex-col items-center justify-center gap-0.5 border border-white/8 bg-black/16 ${isUltraCompactLandscape ? '' : 'px-2'} text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 2.95 : isCompactLandscape ? 4.15 : 4.6, 2.45) }}
              >
                <span className={`font-light leading-none tracking-tight text-white/92 ${isUltraCompactLandscape ? 'text-[1.12rem]' : isCompactLandscape ? 'text-[1.65rem]' : 'text-[2.05rem]'}`}>
                  {displayBpm || '--'}
                </span>
                <div className="h-px w-full bg-white/18" />
                <span className={`${isUltraCompactLandscape ? 'text-[0.42rem]' : 'text-[0.6rem]'} font-black uppercase tracking-[0.24em] text-white/56`}>
                  {displayBpm ? 'BPM' : 'NO BPM'}
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
                  {formatCompact(currentTime)} / {formatCompact(totalDuration)}
                </span>
              </div>

              {resolvedPadUrl && (
                <button
                  type="button"
                  onClick={() => setIsPadActive((previous) => !previous)}
                  className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] px-1 text-[0.62rem]' : isCompactLandscape ? 'h-10 px-2 text-[0.84rem]' : 'h-[var(--ld-control-height)] px-3 text-[0.84rem]'} flex-col font-semibold tracking-[0.18em] ${
                    isPadActive
                      ? 'border-[#43c477]/40 bg-[#43c477]/10 text-[#8af7b1]'
                      : 'text-[#43c477]'
                  }`}
                  style={{ width: scaleRem(isUltraCompactLandscape ? 3.75 : isCompactLandscape ? 5.15 : 5.8, 3.1) }}
                  aria-label={isPadActive ? `Stop pad for ${songKey}` : `Play pad for ${songKey}`}
                >
                  <span>PAD</span>
                  <span className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.5rem]' : 'mt-1 text-[0.66rem]'} tracking-[0.22em] text-white/46`}>
                    {isPadActive ? 'ON' : (songKey || 'ARM')}
                  </span>
                </button>
              )}
            </div>

            <div className={`flex min-w-0 items-center justify-center ${isUltraCompactLandscape ? 'gap-1 px-0' : isCompactLandscape ? 'gap-2 px-0.5' : 'gap-2.5 px-1'}`}>
              <button
                type="button"
                onClick={() => {
                  void seekTo(Math.max(0, currentTime - 4));
                }}
                disabled={!hasTrackSession}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] gap-1' : isCompactLandscape ? 'h-10 gap-1' : 'h-[var(--ld-control-height)] gap-2'} text-white/78 hover:text-white disabled:cursor-not-allowed disabled:text-white/24`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 4.15 : isCompactLandscape ? 5.55 : 6.1, 3.45) }}
                aria-label="Rewind four seconds"
              >
                <RotateCcw className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : isCompactLandscape ? 'h-5 w-5' : 'h-6 w-6'}`} />
                <span className={`${isUltraCompactLandscape ? 'text-[0.72rem]' : isCompactLandscape ? 'text-[0.92rem]' : 'text-[1.05rem]'} font-semibold`}>-4s</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  void play();
                }}
                disabled={!isReady}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem] gap-1' : isCompactLandscape ? 'h-10 gap-1.5' : 'h-[var(--ld-control-height)] gap-3'} text-[#43c477] hover:text-[#4fe487] disabled:cursor-not-allowed disabled:text-white/24`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 5.2 : isCompactLandscape ? 7.15 : 8, 4.25) }}
                aria-label="Play"
              >
                <Play className={`ml-0.5 ${isUltraCompactLandscape ? 'h-[1.125rem] w-[1.125rem]' : isCompactLandscape ? 'h-6 w-6' : 'h-8 w-8'}`} />
                <span className={`${isUltraCompactLandscape ? 'text-[0.74rem]' : isCompactLandscape ? 'text-[0.95rem]' : 'text-[1.1rem]'} font-semibold tracking-[0.15em]`}>PLAY</span>
              </button>

              <div
                className={`grid ${isUltraCompactLandscape ? 'h-[2.95rem] gap-1' : isCompactLandscape ? 'h-10 gap-1' : 'h-[var(--ld-control-height)] gap-2.5'} grid-cols-2`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 4.4 : isCompactLandscape ? 6.9 : 7.6, 3.65) }}
              >
                <button
                  type="button"
                  onClick={pause}
                  disabled={!isReady}
                  className={`${CONTROL_CARD} h-full gap-2 text-white/74 hover:text-white disabled:cursor-not-allowed disabled:text-white/24`}
                  aria-label="Pause"
                >
                    <Pause className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : isCompactLandscape ? 'h-5 w-5' : 'h-7 w-7'}`} />
                </button>
                <button
                  type="button"
                  onClick={stop}
                  disabled={!isReady}
                  className={`${CONTROL_CARD} h-full gap-2 text-white/74 hover:text-white disabled:cursor-not-allowed disabled:text-white/24`}
                  aria-label="Stop"
                >
                    <Square className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : isCompactLandscape ? 'h-5 w-5' : 'h-6 w-6'}`} />
                </button>
              </div>
            </div>

            <div className={`flex items-stretch justify-end ${isUltraCompactLandscape ? 'gap-1' : isCompactLandscape ? 'gap-2' : 'gap-2.5'}`}>
              <div
                className={`flex ${isUltraCompactLandscape ? 'h-[2.95rem] rounded-[0.85rem] px-1 py-0.5' : isCompactLandscape ? 'h-10 rounded-[1rem] px-1 py-1' : 'h-[var(--ld-control-height)] rounded-[1.45rem] px-2 py-2'} items-center border border-white/8 bg-[linear-gradient(180deg,rgba(26,27,29,0.96),rgba(17,18,20,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_24px_40px_rgba(0,0,0,0.25)]`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 9.4 : isCompactLandscape ? 13.4 : 14.75, 7.7) }}
              >
                <div className={`grid h-full w-full ${isUltraCompactLandscape ? 'grid-cols-[2rem_2rem_1fr_1fr] gap-1' : 'grid-cols-[3.1rem_3.1rem_1fr_1fr] gap-2'}`}>
                  <button
                    type="button"
                    onClick={() => handleLoopMarker('a')}
                    disabled={!hasTrackSession}
                    className={`ui-pressable-soft rounded-[1.05rem] border px-2 text-left transition-all disabled:cursor-not-allowed disabled:text-white/28 ${
                      loopEnabled
                        ? 'border-cyan-300/40 bg-cyan-300/12 text-cyan-50'
                        : 'border-white/8 bg-black/20 text-white/72'
                    }`}
                    aria-label="Punto A, inicio del loop"
                  >
                    <span className={`${isUltraCompactLandscape ? 'text-[0.42rem]' : 'text-[0.62rem]'} block font-black tracking-[0.2em]`}>A</span>
                    <span className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.62rem]' : 'mt-1 text-[0.92rem]'} block font-semibold tabular-nums`}>{formatCompact(loopPointA)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoopMarker('b')}
                    disabled={!hasTrackSession}
                    className={`ui-pressable-soft rounded-[1.05rem] border px-2 text-left transition-all disabled:cursor-not-allowed disabled:text-white/28 ${
                      loopEnabled
                        ? 'border-fuchsia-300/40 bg-fuchsia-300/12 text-fuchsia-50'
                        : 'border-white/8 bg-black/20 text-white/72'
                    }`}
                    aria-label="Punto B, final del loop"
                  >
                    <span className={`${isUltraCompactLandscape ? 'text-[0.42rem]' : 'text-[0.62rem]'} block font-black tracking-[0.2em]`}>B</span>
                    <span className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.62rem]' : 'mt-1 text-[0.92rem]'} block font-semibold tabular-nums`}>{formatCompact(loopPointB)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleLoopIn}
                    disabled={!hasTrackSession}
                    className={`ui-pressable-soft flex items-center justify-center gap-2 rounded-[1.05rem] border transition-all disabled:cursor-not-allowed disabled:text-white/28 ${
                      loopEnabled
                        ? 'border-[#43c477]/55 bg-[#43c477]/14 text-[#8af7b1] shadow-[0_0_20px_rgba(67,196,119,0.18)]'
                        : 'border-white/8 bg-black/20 text-white/76'
                    }`}
                    aria-label="Activar loop entre A y B"
                  >
                    <Repeat className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
                    <span className={`${isUltraCompactLandscape ? 'text-[0.62rem]' : 'text-[0.84rem]'} font-semibold tracking-[0.14em]`}>IN</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleLoopOut}
                    disabled={!hasTrackSession}
                    className="ui-pressable-soft flex items-center justify-center gap-2 rounded-[1.05rem] border border-white/8 bg-black/20 text-white/72 transition-all hover:text-white disabled:cursor-not-allowed disabled:text-white/28"
                    aria-label="Salir del loop A-B"
                  >
                    <span className={`${isUltraCompactLandscape ? 'text-[0.62rem]' : 'text-[0.84rem]'} font-semibold tracking-[0.14em]`}>OUT</span>
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowLoadPanel(true)}
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-[2.95rem]' : isCompactLandscape ? 'h-10' : 'h-[var(--ld-control-height)]'} text-[1.02rem] font-semibold tracking-[0.18em] text-white/70 hover:text-white`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 3.55 : isCompactLandscape ? 4.95 : 5.35, 2.95) }}
                title="Cargar o reemplazar la sesión multitrack"
                aria-label="Cargar o reemplazar la sesión multitrack"
              >
                <div className="flex flex-col items-center gap-1">
                  <Upload className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
                  <span className={`${isUltraCompactLandscape ? 'text-[0.62rem]' : 'text-[0.88rem]'}`}>LOAD</span>
                </div>
              </button>
            </div>
          </header>
        </div>

        <section className={`shrink-0 overflow-hidden ${isUltraCompactLandscape ? 'pr-0 pb-0' : isCompactLandscape ? 'pr-0.5' : ''}`}>
          <div className={`overflow-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.96),rgba(27,29,30,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isUltraCompactLandscape ? 'px-1.5 py-1' : isCompactLandscape ? 'px-2 py-1.5' : 'px-4 py-4'}`}>
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
                className={`ui-pressable-card group flex shrink-0 flex-col overflow-hidden rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(35,37,39,0.98),rgba(24,26,28,0.98))] text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:border-white/20 ${isUltraCompactLandscape ? 'p-1' : isCompactLandscape ? 'p-1.5' : 'p-3'}`}
                style={{ width: scaleRem(isUltraCompactLandscape ? 11.6 : isCompactLandscape ? 13.4 : 15, 9.8) }}
                aria-label={hasTrackSession ? `Jump to start of ${currentSessionLabel}` : 'Open song loader'}
              >
                <div className={`relative overflow-hidden rounded-[1rem] border border-white/10 bg-black/30 ${isUltraCompactLandscape ? 'h-8' : isCompactLandscape ? 'h-10' : 'h-[5.35rem]'}`}>
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
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,rgba(0,0,0,0.22)_100%)]" />
                </div>

                <div className={`flex items-center ${isUltraCompactLandscape ? 'mt-1 gap-1' : isCompactLandscape ? 'mt-1 gap-1.5' : 'mt-3 gap-3'}`}>
                  <div
                    className={`flex shrink-0 items-center justify-center rounded-full border transition-all ${
                      isUltraCompactLandscape ? 'h-5 w-5' : isCompactLandscape ? 'h-6 w-6' : 'h-10 w-10'
                    } ${
                      isPlaying
                        ? 'border-[#43c477]/65 bg-[#43c477]/12 text-[#63e88f] shadow-[0_0_18px_rgba(67,196,119,0.2)]'
                        : 'border-white/10 bg-black/28 text-white/72'
                    }`}
                  >
                    {isPlaying ? <Pause className={`${isUltraCompactLandscape ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} /> : <Play className={`ml-0.5 ${isUltraCompactLandscape ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />}
                  </div>
                  <div className="min-w-0">
                    <h2 className={`truncate font-semibold tracking-tight text-white ${isUltraCompactLandscape ? 'text-[0.82rem]' : isCompactLandscape ? 'text-sm' : 'text-[1.2rem]'}`}>
                      {songCardTitle}
                    </h2>
                    <p className={`truncate text-white/56 ${isUltraCompactLandscape ? 'text-[0.56rem]' : isCompactLandscape ? 'text-[0.65rem]' : 'mt-0.5 text-[0.72rem]'}`}>{songCardMeta}</p>
                  </div>
                </div>
              </button>

              <div className={`min-w-0 flex-1 rounded-[1.5rem] border border-white/8 bg-black/16 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isUltraCompactLandscape ? 'px-2 py-1.5' : isCompactLandscape ? 'px-3 py-2' : 'px-5 py-4'}`}>
                <div className={`flex h-full flex-col justify-between ${isUltraCompactLandscape ? 'gap-1.5' : isCompactLandscape ? 'gap-2' : 'gap-4'}`}>
                  <div className={`flex ${isUltraCompactLandscape ? 'items-center gap-2' : isCompactLandscape ? 'items-center gap-3' : 'items-start justify-between gap-4'}`}>
                    <div className="min-w-0">
                      <p className={`${isUltraCompactLandscape ? 'text-[0.52rem]' : 'text-[0.7rem]'} font-black uppercase tracking-[0.24em] text-white/34`}>
                        {performerLabel ? `Live Director · ${performerLabel}` : 'Live Director'}
                      </p>
                      <h1 className={`truncate font-semibold tracking-tight text-white ${isUltraCompactLandscape ? 'mt-0.5 text-[0.92rem]' : isCompactLandscape ? 'mt-1 text-sm' : 'mt-2 text-[1.35rem]'}`}>
                        {currentSessionLabel}
                      </h1>
                      <p className={`text-white/54 ${isUltraCompactLandscape ? 'mt-0.5 text-[0.58rem]' : isCompactLandscape ? 'mt-0.5 text-[0.68rem]' : 'mt-1 text-[0.92rem]'}`}>{songSupportMeta}</p>
                    </div>

                    <div className={`flex shrink-0 ${isUltraCompactLandscape ? 'items-center gap-1' : isCompactLandscape ? 'items-center gap-1.5' : 'items-start gap-2'}`}>
                      <div className={`rounded-full border border-white/8 bg-black/18 ${isUltraCompactLandscape ? 'px-1.5 py-0.5' : isCompactLandscape ? 'px-2 py-1' : 'px-3 py-1.5'}`}>
                        <p className={`${isUltraCompactLandscape ? 'text-[0.5rem]' : 'text-[0.68rem]'} font-black uppercase tracking-[0.18em] text-white/46`}>
                          {surfaceBadgeLabel}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleEngineToggle}
                        className={`ui-pressable-soft rounded-full border ${isUltraCompactLandscape ? 'px-1.5 py-0.5' : isCompactLandscape ? 'px-2 py-1' : 'px-3 py-1.5'} text-left transition-all ${
                          useStreamingEngine
                            ? 'border-cyan-300/34 bg-cyan-300/10 text-cyan-50 shadow-[0_0_18px_rgba(129,221,245,0.14)]'
                            : 'border-white/8 bg-black/18 text-white/76 hover:text-white'
                        }`}
                        aria-label={`Switch engine. Current engine: ${currentEngineLabel}`}
                        title={`Motor activo: ${currentEngineLabel}. Pulsa para cambiar.`}
                      >
                        <p className={`${isUltraCompactLandscape ? 'text-[0.46rem]' : 'text-[0.6rem]'} font-black uppercase tracking-[0.18em] text-white/38`}>
                          Engine
                        </p>
                        <p className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.62rem]' : isCompactLandscape ? 'mt-0.5 text-[0.74rem]' : 'mt-1 text-[0.92rem]'} font-semibold text-inherit`}>{currentEngineLabel}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDiagnostics((previous) => !previous)}
                        className={`ui-pressable-soft rounded-full border ${isUltraCompactLandscape ? 'px-1.5 py-0.5' : isCompactLandscape ? 'px-2 py-1' : 'px-3 py-1.5'} text-left transition-all ${
                          showDiagnostics
                            ? 'border-cyan-300/34 bg-cyan-300/10 text-cyan-50 shadow-[0_0_18px_rgba(129,221,245,0.14)]'
                            : 'border-white/8 bg-black/18 text-white/72 hover:text-white'
                        }`}
                        aria-label={`${showDiagnostics ? 'Hide' : 'Show'} memory diagnostics`}
                        title="Mostrar u ocultar diagnostico de memoria y carga"
                      >
                        <p className={`${isUltraCompactLandscape ? 'text-[0.46rem]' : 'text-[0.6rem]'} font-black uppercase tracking-[0.18em] text-white/38`}>
                          RAM
                        </p>
                        <p className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.62rem]' : isCompactLandscape ? 'mt-0.5 text-[0.74rem]' : 'mt-1 text-[0.92rem]'} font-semibold text-inherit`}>
                          {showDiagnostics ? 'On' : 'Off'}
                        </p>
                      </button>
                      <div className={`rounded-[1.1rem] border border-white/8 bg-black/18 text-right ${isUltraCompactLandscape ? 'px-1.5 py-1' : isCompactLandscape ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
                        <p className={`${isUltraCompactLandscape ? 'text-[0.46rem]' : 'text-[0.62rem]'} font-black uppercase tracking-[0.2em] text-white/36`}>
                          Ready
                        </p>
                        <p className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.66rem]' : isCompactLandscape ? 'mt-0.5 text-[0.78rem]' : 'mt-1 text-[0.98rem]'} font-semibold ${isReady ? 'text-[#43c477]' : 'text-white/58'}`}>
                          {readyStateLabel}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className={`flex ${isUltraCompactLandscape ? 'items-center gap-1.5' : isCompactLandscape ? 'items-center gap-2' : 'items-end gap-4'}`}>
                    <div className="min-w-0 flex-1">
                      <div className={`flex items-center justify-between font-semibold uppercase tracking-[0.18em] text-white/46 ${isUltraCompactLandscape ? 'mb-0.5 text-[0.56rem]' : isCompactLandscape ? 'mb-1 text-[0.72rem]' : 'mb-2 text-[0.72rem]'}`}>
                        <span>{hasTrackSession ? `${activeTracks.length} tracks` : 'No session'}</span>
                        <span>{formatCompact(currentTime)} / {formatCompact(totalDuration)}</span>
                      </div>
                      <div className={`${isUltraCompactLandscape ? 'h-1' : isCompactLandscape ? 'h-1.5' : 'h-2.5'} rounded-full bg-black/30`}>
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,#43c477_0%,#81ddf5_100%)] shadow-[0_0_14px_rgba(67,196,119,0.16)] transition-[width] duration-200"
                          style={{ width: `${Math.max(hasTrackSession ? progressPercent : 0, hasTrackSession ? 4 : 0)}%` }}
                        />
                      </div>
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
                        className={`ui-pressable-soft min-w-[5.5rem] rounded-[1rem] border ${isUltraCompactLandscape ? 'px-1.5 py-1 text-[0.56rem]' : isCompactLandscape ? 'px-2 py-1.5 text-[0.64rem]' : 'px-3 py-2 text-[0.7rem]'} font-black uppercase tracking-[0.18em] transition-all ${
                          surfaceView === 'mix'
                            ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50'
                            : 'border-white/8 bg-black/18 text-white/58'
                        }`}
                      >
                        Mix
                      </button>
                      <button
                        type="button"
                        onClick={() => setSurfaceView('sections')}
                        className={`ui-pressable-soft min-w-[5.5rem] rounded-[1rem] border ${isUltraCompactLandscape ? 'px-1.5 py-1 text-[0.56rem]' : isCompactLandscape ? 'px-2 py-1.5 text-[0.64rem]' : 'px-3 py-2 text-[0.7rem]'} font-black uppercase tracking-[0.18em] transition-all ${
                          surfaceView === 'sections'
                            ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50'
                            : 'border-white/8 bg-black/18 text-white/58'
                        }`}
                      >
                        Sections
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section
          className={`grid min-h-0 flex-1 ${isUltraCompactLandscape ? 'gap-0.5' : isCompactLandscape ? 'gap-1.5' : 'gap-4'}`}
          style={{ gridTemplateColumns: `minmax(0,1fr) ${mixerLayoutColumns}` }}
        >
          {showSectionsPanel ? (
            <div className="relative min-h-0 overflow-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(29,30,32,0.98),rgba(23,24,26,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="absolute left-4 top-4 z-30 flex items-center gap-3 rounded-full border border-white/10 bg-black/34 px-3 py-2 backdrop-blur-xl">
                <span className="text-[0.68rem] font-black uppercase tracking-[0.28em] text-white/38">Sections</span>
                <span className="text-[0.8rem] font-semibold text-white/78">
                  {activeSection?.name || 'Timeline'}
                </span>
              </div>
              <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/30 p-1 backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => {
                      void saveSectionOffset(sectionOffsetSeconds - 0.25);
                    }}
                    className="ui-pressable-soft h-8 min-w-8 rounded-full border border-white/10 bg-black/20 px-2 text-sm font-black text-white/72"
                    aria-label="Shift sections earlier"
                  >
                    -
                  </button>
                  <div className="min-w-[5.2rem] px-2 text-center text-[0.68rem] font-black uppercase tracking-[0.18em] text-white/58">
                    {sectionOffsetSeconds >= 0 ? '+' : ''}
                    {sectionOffsetSeconds.toFixed(2)}s
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void saveSectionOffset(sectionOffsetSeconds + 0.25);
                    }}
                    className="ui-pressable-soft h-8 min-w-8 rounded-full border border-white/10 bg-black/20 px-2 text-sm font-black text-white/72"
                    aria-label="Shift sections later"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void saveSectionOffset(0);
                  }}
                  className="ui-pressable-soft rounded-full border border-white/10 bg-black/28 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.22em] text-white/60 backdrop-blur-xl"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setSurfaceView('mix')}
                  className="ui-pressable-soft rounded-full border border-white/10 bg-black/28 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.22em] text-white/60 backdrop-blur-xl"
                >
                  Mix
                </button>
              </div>
              <div className="relative h-full overflow-hidden bg-black/12">
                <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-16 bg-[linear-gradient(90deg,rgba(23,24,26,0.96),rgba(23,24,26,0))]" />
                <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-16 bg-[linear-gradient(270deg,rgba(23,24,26,0.96),rgba(23,24,26,0))]" />
                <div
                  className="pointer-events-none absolute bottom-3 top-3 z-30 w-[4px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.68)]"
                  style={{ left: `${SECTION_LANE_PLAYHEAD_OFFSET_PX}px` }}
                />
                <div
                  ref={sectionsLaneScrollRef}
                  className="hide-scrollbar relative h-full overflow-x-auto overflow-y-hidden"
                >
                  <div
                    className="relative flex h-full min-h-0 items-stretch gap-[14px] py-4"
                    style={{
                      width: `${sectionLaneContentWidth}px`,
                      paddingLeft: `${SECTION_LANE_PLAYHEAD_OFFSET_PX}px`,
                      paddingRight: `${SECTION_LANE_PLAYHEAD_OFFSET_PX}px`,
                    }}
                  >
                    {sectionLaneSegments.map(({ section, waveBars, widthPx, leftPx }, index) => {
                      const isActive = index === activeSectionIndex;

                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => {
                            void seekTo(section.startTime);
                          }}
                          className="relative h-full shrink-0 rounded-[1.55rem] border text-left transition-all duration-200"
                          style={{
                            width: `${widthPx}px`,
                            background: `linear-gradient(180deg, ${section.surface}, rgba(20,20,22,0.96))`,
                            borderColor: isActive ? section.accent : section.border,
                            boxShadow: isActive ? `0 0 22px ${section.accent}20` : 'none',
                          }}
                        >
                          <div className="absolute inset-0 rounded-[1.5rem] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_2px,transparent_2px,transparent_20px)]" />
                          <div
                            className="absolute inset-y-0 left-0 w-px bg-white/12"
                            style={{ opacity: isActive ? 0.52 : 0.2 }}
                          />
                          <div
                            className="absolute left-4 right-4 top-1/2 flex h-[44%] -translate-y-1/2 items-end justify-between"
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
                          <div className="absolute left-4 top-20 flex items-center gap-3">
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
                              <p className="truncate text-[1rem] font-semibold text-white/88">{section.name}</p>
                              <p className="mt-0.5 text-[0.72rem] uppercase tracking-[0.18em] text-white/42">
                                {formatCompact(section.startTime)} · {Math.max(0, Math.round(section.endTime - section.startTime))}s
                              </p>
                            </div>
                          </div>
                          <div
                            className="pointer-events-none absolute inset-y-4 rounded-[1.2rem] border border-white/0 transition-all duration-150"
                            style={{
                              left: `${Math.max(0, sectionLaneProgressPx - leftPx - 1)}px`,
                              width: '2px',
                              backgroundColor: isActive ? `${section.accent}cc` : 'transparent',
                              boxShadow: isActive ? `0 0 14px ${section.accent}66` : 'none',
                              opacity: isActive ? 1 : 0,
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              ref={mixerScrollRef}
              onPointerDown={handleMixerPointerDown}
              onPointerMove={handleMixerPointerMove}
              onPointerUp={handleMixerPointerUp}
              onPointerCancel={handleMixerPointerUp}
              className={`hide-scrollbar grid min-h-0 ${isCompactLandscape ? 'gap-1.5' : 'gap-3'} overflow-x-auto overflow-y-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isCompactLandscape ? 'px-1 py-0.5' : 'px-3 py-4'}`}
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, mixerView.length)}, minmax(${isCompactLandscape ? '4.75rem' : '8.5rem'}, 1fr))`,
                touchAction: 'pan-x pinch-zoom',
                overscrollBehaviorX: 'contain',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {mixerView.map((track) => {
                return (
                  <ChannelStrip
                    key={track.id}
                    id={track.id}
                    label={track.label}
                    shortLabel={track.shortLabel}
                    accent={track.accent}
                    volume={track.volume}
                    level={track.level}
                    muted={track.muted}
                    soloed={track.soloed}
                    dimmed={track.dimmed}
                    disabled={track.disabled}
                    compact={isCompactLandscape}
                    onVolumeChange={(nextVolume) => setVolume(track.id, nextVolume)}
                    onMute={() => handleMuteTrack(track.id)}
                    onSolo={() => handleSoloTrack(track.id)}
                  />
                );
              })}
            </div>
          )}

          <div className={`rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isCompactLandscape ? 'px-1 py-0.5' : 'px-3 py-4'}`}>
            <div className={`flex h-full flex-col ${isCompactLandscape ? 'gap-1.5' : 'gap-4'}`}>
              {!isCompactLandscape && (
                <div className="flex items-center justify-center gap-1 pt-1 text-white/42">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                </div>
              )}
              <div className={`grid ${isCompactLandscape ? 'gap-1.5' : 'gap-3'}`}>
                <button
                  type="button"
                  onClick={() => setSurfaceView('mix')}
                  className={`ui-pressable-soft flex flex-col items-center justify-center gap-1 rounded-[1.2rem] border transition-all ${
                    isCompactLandscape ? 'h-8' : 'h-16'
                  } ${
                    surfaceView === 'mix'
                      ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50 shadow-[0_0_20px_rgba(129,221,245,0.14)]'
                      : 'border-white/8 bg-black/24 text-white/62'
                  }`}
                >
                  <SlidersVertical className={isCompactLandscape ? 'h-3.5 w-3.5' : 'h-6 w-6'} />
                  {!isCompactLandscape && <span className="text-[0.66rem] font-black uppercase tracking-[0.18em]">Mix</span>}
                </button>
                <button
                  type="button"
                  onClick={() => setSurfaceView('sections')}
                  className={`ui-pressable-soft flex flex-col items-center justify-center gap-1 rounded-[1.2rem] border transition-all ${
                    isCompactLandscape ? 'h-8' : 'h-16'
                  } ${
                    surfaceView === 'sections'
                      ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50 shadow-[0_0_20px_rgba(129,221,245,0.14)]'
                      : 'border-white/8 bg-black/24 text-white/62'
                  }`}
                >
                  <ListMusic className={isCompactLandscape ? 'h-3.5 w-3.5' : 'h-6 w-6'} />
                  {!isCompactLandscape && <span className="text-[0.6rem] font-black uppercase tracking-[0.16em]">Sections</span>}
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
                className={`ui-pressable-soft rounded-[1.2rem] border border-white/8 bg-black/24 px-2 text-center ${isCompactLandscape ? 'text-[0.62rem] py-1.5' : 'text-[0.78rem] py-5'} font-semibold tracking-[0.2em] text-white/62`}
              >
                MUTE
                <br />
                ALL
              </button>
              <button
                type="button"
                onClick={handleLoopIn}
                disabled={!hasTrackSession}
                className={`ui-pressable-soft rounded-[1.2rem] border px-2 text-center ${isCompactLandscape ? 'text-[0.62rem] py-1.5' : 'text-[0.78rem] py-5'} font-semibold tracking-[0.2em] ${
                  loopEnabled
                    ? 'border-[#43c477]/50 bg-[#43c477]/14 text-[#9effc4]'
                    : 'border-white/8 bg-black/24 text-white/62'
                }`}
              >
                LOOP
                <br />
                ON
              </button>
              <button
                type="button"
                onClick={handleLoopOut}
                disabled={!hasTrackSession}
                className={`ui-pressable-soft rounded-[1.2rem] border border-white/8 bg-black/24 px-2 text-center ${isCompactLandscape ? 'text-[0.62rem] py-1.5' : 'text-[0.78rem] py-5'} font-semibold tracking-[0.2em] text-white/62`}
              >
                LOOP
                <br />
                OFF
              </button>
            </div>
          </div>

          <div className={`rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isCompactLandscape ? 'px-1 py-0.5' : 'px-3 py-4'}`}>
            <div className={`relative flex h-full flex-col items-center rounded-[1.75rem] border border-white/7 bg-[linear-gradient(180deg,rgba(34,35,37,0.92),rgba(26,27,29,0.94))] ${isCompactLandscape ? 'px-1 pb-1 pt-0.5' : 'px-3 pb-4 pt-3'}`}>
              <div className={`flex items-center justify-center rounded-full border border-white/8 bg-black/28 text-white/62 ${isCompactLandscape ? 'mb-1 h-6 w-6' : 'mb-3 h-11 w-11'}`}>
                <span className={`font-black tracking-[0.18em] ${isCompactLandscape ? 'text-[0.65rem]' : 'text-[0.82rem]'}`}>M</span>
              </div>

              <div className="relative flex w-full flex-1 items-center justify-center">
                <div className={`relative h-full w-full ${isCompactLandscape ? 'max-w-[4.75rem]' : 'max-w-[5.8rem]'}`}>
                  <div className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-[#050607] ${isCompactLandscape ? 'top-[7%] bottom-[10%] w-[0.56rem]' : 'top-[5%] bottom-[7%] w-[0.72rem]'}`} />
                  {Array.from({ length: 7 }).map((_, index) => (
                    <div
                      key={`master-mark-${index}`}
                      className="absolute left-1/2 h-[2px] w-[76%] -translate-x-1/2 rounded-full bg-white/18"
                      style={{ bottom: `${14 + index * 11}%` }}
                    />
                  ))}
                  <FaderThumb
                    accent="#81ddf5"
                    className={`${isCompactLandscape ? 'h-[2.2rem]' : 'h-[4.35rem]'} w-full ${isCompactLandscape ? 'max-w-[4.95rem]' : 'max-w-[6.1rem]'} transition-[bottom,box-shadow] duration-150`}
                    style={{
                      bottom: `calc(${10 + masterVolume * 78}% - ${isCompactLandscape ? '1.1rem' : '1.75rem'})`,
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
                    onChange={(event) => setMasterVolumeState(Number(event.target.value))}
                    aria-label="Master volume"
                    className={`absolute left-1/2 top-1/2 h-10 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer opacity-0 ${isCompactLandscape ? 'w-40' : 'w-[18rem]'}`}
                  />
                </div>
              </div>

              <div className={`text-center ${isCompactLandscape ? 'mt-1' : 'mt-4'}`}>
                {!isCompactLandscape && <p className="text-[0.62rem] font-black uppercase tracking-[0.3em] text-white/28">BUS</p>}
                <p className={`font-semibold text-white/90 ${isCompactLandscape ? 'text-[0.9rem]' : 'mt-1 text-[1.15rem]'}`}>Master</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {!hasProvidedTracks && showLoadPanel && (
        <div className="absolute inset-0 z-[45] flex items-center justify-center bg-black/26 px-6 backdrop-blur-[8px]">
          <div className="w-full max-w-[62rem] rounded-[2.1rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,19,21,0.96),rgba(13,15,16,0.96))] p-6 shadow-[0_34px_70px_rgba(0,0,0,0.34)]">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[0.78rem] font-black uppercase tracking-[0.28em] text-cyan-100/62">Session Loader</p>
                <h2 className="mt-2 text-[2rem] font-semibold tracking-tight text-white">
                  {hasPersistedSongContext
                    ? `Carga stems para ${songTitle || 'esta cancion'}.`
                    : 'Carga una secuencia completa o una carpeta de stems.'}
                </h2>
                <p className="mt-3 max-w-3xl text-[1rem] leading-relaxed text-white/62">
                  {hasPersistedSongContext
                    ? 'Las subidas quedaran encapsuladas dentro de la carpeta propia de esta cancion en R2 y la sesion se guardara en la base de datos.'
                    : 'Este flujo no reemplaza el modo actual. Solo prepara esta superficie para trabajar con una pista estereo unica o con stems separados detectados por nombre.'}
                </p>
              </div>
              {hasTrackSession && (
                <button
                  type="button"
                  onClick={() => setShowLoadPanel(false)}
                  className="ui-pressable-soft flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/28 text-white/64 hover:text-white"
                  aria-label="Close session loader"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            <div className="mt-6 grid grid-cols-[15rem_minmax(0,1fr)] gap-6">
              <div className="rounded-[1.7rem] border border-white/8 bg-black/22 p-3">
                <button
                  type="button"
                  onClick={() => setLoaderMode('sequence')}
                  className={`mb-3 flex w-full items-center gap-3 rounded-[1.2rem] border px-4 py-4 text-left transition-all ${
                    loaderMode === 'sequence'
                      ? 'border-cyan-300/38 bg-cyan-300/12 text-white'
                      : 'border-white/8 bg-white/[0.02] text-white/68'
                  }`}
                >
                  <Link2 className="h-5 w-5" />
                  <div>
                    <p className="text-sm font-semibold">Secuencia unica</p>
                    <p className="mt-1 text-xs text-white/52">Una sola pista estereo.</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setLoaderMode('folder')}
                  className={`flex w-full items-center gap-3 rounded-[1.2rem] border px-4 py-4 text-left transition-all ${
                    loaderMode === 'folder'
                      ? 'border-cyan-300/38 bg-cyan-300/12 text-white'
                      : 'border-white/8 bg-white/[0.02] text-white/68'
                  }`}
                >
                  <FolderOpen className="h-5 w-5" />
                  <div>
                    <p className="text-sm font-semibold">Carpeta de stems</p>
                    <p className="mt-1 text-xs text-white/52">Detecta Click, Guide, Drums, Bass, Keys y mas.</p>
                  </div>
                </button>
              </div>

              <div className="rounded-[1.7rem] border border-white/8 bg-[linear-gradient(180deg,rgba(28,31,33,0.9),rgba(18,19,21,0.9))] p-5">
                {loaderMode === 'sequence' ? (
                  <div>
                    <p className="text-[0.76rem] font-black uppercase tracking-[0.24em] text-white/40">Single Track</p>
                    <div className="mt-4 grid grid-cols-[minmax(0,1fr)_10rem_10rem] gap-3">
                      <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-white/82">URL de audio</span>
                        <input
                          type="url"
                          value={sequenceUrlInput}
                          onChange={(event) => setSequenceUrlInput(event.target.value)}
                          placeholder="https://.../mi-secuencia.mp3"
                          className="h-14 w-full rounded-[1rem] border border-white/10 bg-black/24 px-4 text-white outline-none transition-all placeholder:text-white/28 focus:border-cyan-300/40"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleLoadSequenceFromUrl}
                        className="ui-pressable-soft mt-7 flex h-14 items-center justify-center rounded-[1rem] border border-cyan-300/24 bg-cyan-300/10 px-4 text-sm font-semibold tracking-[0.12em] text-cyan-50"
                      >
                        CARGAR URL
                      </button>
                      <button
                        type="button"
                        onClick={() => sequenceFileInputRef.current?.click()}
                        className="ui-pressable-soft mt-7 flex h-14 items-center justify-center gap-2 rounded-[1rem] border border-white/10 bg-black/28 px-4 text-sm font-semibold tracking-[0.12em] text-white/84"
                      >
                        <Upload className="h-4 w-4" />
                        ARCHIVO
                      </button>
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-white/54">
                      Usalo cuando tengas una secuencia completa en una sola pista. Esto preserva el flujo actual de playback.
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-[0.76rem] font-black uppercase tracking-[0.24em] text-white/40">Stem Folder</p>
                    <button
                      type="button"
                      onClick={() => folderInputRef.current?.click()}
                      className="ui-pressable-soft mt-4 flex h-32 w-full items-center justify-center gap-4 rounded-[1.4rem] border border-dashed border-cyan-300/24 bg-cyan-300/7 px-6 text-left text-cyan-50"
                    >
                      <FolderOpen className="h-8 w-8" />
                      <div>
                        <p className="text-lg font-semibold">Seleccionar carpeta de stems</p>
                        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/58">
                          El loader intentara mapear nombres como `Click`, `Guide`, `Drums`, `Bass`, `Acoustic`, `Electric 1`, `Electric 2`, `Keys` o `Playback`.
                        </p>
                      </div>
                    </button>
                    <p className="mt-4 text-sm leading-relaxed text-white/54">
                      Ideal para exportaciones por canal. Si encuentra duplicados como dos guitarras electricas, los mantiene como pistas separadas.
                    </p>
                  </div>
                )}

                <div className="mt-6 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4">
                  <div className="rounded-[1.3rem] border border-white/8 bg-black/24 p-4">
                    <p className="text-[0.74rem] font-black uppercase tracking-[0.22em] text-white/38">Session State</p>
                    <p className="mt-3 text-lg font-semibold text-white">{hasTrackSession ? currentSessionLabel : 'No session loaded yet'}</p>
                    <p className="mt-2 text-sm text-white/54">
                      {hasTrackSession
                        ? `${activeTracks.length} pista(s) preparadas para el engine.`
                        : hasPersistedSongContext
                          ? 'Esta sesion quedara guardada bajo la cancion seleccionada, no como un upload global.'
                          : 'Carga una pista estereo o una carpeta para inicializar el mezclador.'}
                    </p>
                    {hasTrackSession && (
                      <div className="mt-4 rounded-[1rem] border border-emerald-300/14 bg-emerald-300/6 px-3 py-3">
                        <p className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-emerald-100/64">
                          Clear Session
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-white/58">
                          Al limpiar esta sesion se borra el registro en Supabase y tambien los archivos asociados en R2.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="rounded-[1.3rem] border border-white/8 bg-black/24 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[0.74rem] font-black uppercase tracking-[0.22em] text-white/38">Detection Report</p>
                        <p className="mt-2 text-sm text-white/52">
                          Lista exacta de lo que entro al mixer y de lo que quedo fuera.
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-white/34">Mapped</p>
                        <p className="mt-1 text-lg font-semibold text-white">{mappedTrackDetails.length}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,0.88fr)] gap-4">
                      <div className="rounded-[1rem] border border-white/8 bg-black/24 p-3">
                        <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-white/38">Mapped Tracks</p>
                        <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                          {mappedTrackDetails.length > 0 ? (
                            mappedTrackDetails.map((track) => (
                              <div
                                key={`mapped-${track.id}-${track.sourceFileName}`}
                                className="rounded-[0.9rem] border border-white/6 bg-white/[0.03] px-3 py-2"
                              >
                                <p className="truncate text-sm font-semibold text-white/88">{track.sourceFileName}</p>
                                <p className="mt-1 text-[0.72rem] uppercase tracking-[0.16em] text-cyan-100/56">
                                  {track.trackName}
                                </p>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm leading-relaxed text-white/48">
                              Todavia no hay archivos mapeados en esta sesion.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-[1rem] border border-white/8 bg-black/24 p-3">
                        <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-white/38">Unmatched Files</p>
                        <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                          {unmatchedFiles.length > 0 ? (
                            unmatchedFiles.map((fileName) => (
                              <div
                                key={`unmatched-${fileName}`}
                                className="rounded-[0.9rem] border border-amber-200/10 bg-amber-200/[0.04] px-3 py-2"
                              >
                                <p className="truncate text-sm font-semibold text-white/82">{fileName}</p>
                                <p className="mt-1 text-[0.72rem] uppercase tracking-[0.16em] text-amber-100/44">
                                  No mapped rule yet
                                </p>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm leading-relaxed text-white/48">
                              Todo lo detectado entro al mixer.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {hasTrackSession && (
                  <div className="mt-6 flex items-center justify-between rounded-[1.2rem] border border-white/8 bg-black/20 px-4 py-3">
                    <p className="text-sm text-white/58">La sesion actual ya esta preparada. Puedes cerrarla, reemplazarla o limpiarla junto con sus archivos en R2.</p>
                    <button
                      type="button"
                      onClick={clearManualSession}
                      className="ui-pressable-soft rounded-[0.9rem] border border-white/10 bg-white/6 px-4 py-2 text-xs font-semibold tracking-[0.16em] text-white/82"
                    >
                      CLEAR SESSION + R2
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
            accept="audio/*"
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

      <audio ref={padAudioRef} preload="none" className="hidden" />

      {busyMessage && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/26 backdrop-blur-[8px]">
          <div className="rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(16,18,19,0.92),rgba(13,15,16,0.92))] px-6 py-5 shadow-[0_28px_48px_rgba(0,0,0,0.28)]">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-[1rem] border border-cyan-300/15 bg-cyan-300/8">
                <div className="flex gap-1">
                  <span className="h-6 w-1.5 animate-pulse rounded-full bg-cyan-300/70 [animation-delay:-240ms]" />
                  <span className="h-8 w-1.5 animate-pulse rounded-full bg-cyan-300/90 [animation-delay:-120ms]" />
                  <span className="h-5 w-1.5 animate-pulse rounded-full bg-cyan-300/60" />
                </div>
              </div>
              <div>
                <p className="text-[0.78rem] font-black uppercase tracking-[0.25em] text-cyan-100/72">Standby</p>
                <p className="mt-1 text-[1.18rem] font-semibold text-white">{busyMessage}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {loadError && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/24 backdrop-blur-[8px]">
          <div className="max-w-lg rounded-[1.8rem] border border-rose-300/18 bg-[linear-gradient(180deg,rgba(23,15,17,0.96),rgba(16,12,13,0.96))] px-7 py-6 shadow-[0_30px_60px_rgba(0,0,0,0.32)]">
            <p className="text-[0.8rem] font-black uppercase tracking-[0.28em] text-rose-200/70">Audio Error</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">The multitrack session could not finish loading.</h2>
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
              {hasTrackSession ? 'RETRY LOAD' : 'BACK TO LOADER'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default LiveDirectorView;
