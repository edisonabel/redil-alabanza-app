import {
  FolderOpen,
  Link2,
  ListMusic,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  SlidersVertical,
  Smartphone,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
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
  muted: boolean;
  soloed: boolean;
  dimmed: boolean;
  disabled: boolean;
  onVolumeChange: (volume: number) => void;
  onMute: () => void;
  onSolo: () => void;
};

type MixerTrackView = MixerTrackMeta & {
  volume: number;
  muted: boolean;
  soloed: boolean;
  dimmed: boolean;
  disabled: boolean;
};

const MIXER_TRACKS: MixerTrackMeta[] = [
  { id: 'click', label: 'Click', shortLabel: 'CLK', accent: '#5ccfe6', defaultVolume: 0.34 },
  { id: 'guide', label: 'Guide', shortLabel: 'GDE', accent: '#73d1f8', defaultVolume: 0.72 },
  { id: 'drums', label: 'Drums', shortLabel: 'DRM', accent: '#66d4f0', defaultVolume: 0.83 },
  { id: 'bass', label: 'Bass', shortLabel: 'BSS', accent: '#7bd8ef', defaultVolume: 0.76 },
  { id: 'acoustic-gtr', label: 'Acoustic Gtr', shortLabel: 'AG', accent: '#6ed0eb', defaultVolume: 0.69 },
  { id: 'electric-gtr-1', label: 'Electric Gtr 1', shortLabel: 'EG 1', accent: '#77d9f4', defaultVolume: 0.63 },
  { id: 'electric-gtr-2', label: 'Electric Gtr 2', shortLabel: 'EG 2', accent: '#70d1f0', defaultVolume: 0.6 },
  { id: 'keys', label: 'Keys', shortLabel: 'KEY', accent: '#81ddf5', defaultVolume: 0.74 },
];

const DEFAULT_SECTIONS: SectionVisual[] = [
  { id: 'intro', name: 'Intro', shortLabel: 'I', startTime: 0, endTime: 4, accent: '#7cc7ea', surface: 'rgba(33, 42, 48, 0.9)', border: 'rgba(124, 199, 234, 0.25)' },
  { id: 'verse-1', name: 'Verse 1', shortLabel: 'V1', startTime: 4, endTime: 8, accent: '#a768ea', surface: 'rgba(33, 27, 39, 0.92)', border: 'rgba(167, 104, 234, 0.26)' },
  { id: 'pre', name: 'Pre', shortLabel: 'P', startTime: 8, endTime: 11.5, accent: '#9b7cff', surface: 'rgba(32, 26, 40, 0.92)', border: 'rgba(155, 124, 255, 0.26)' },
  { id: 'chorus', name: 'Chorus', shortLabel: 'Co', startTime: 11.5, endTime: 15.5, accent: '#63d8e5', surface: 'rgba(28, 36, 40, 0.92)', border: 'rgba(99, 216, 229, 0.24)' },
  { id: 'bridge', name: 'Bridge', shortLabel: 'Br', startTime: 15.5, endTime: 20, accent: '#af71f3', surface: 'rgba(34, 26, 42, 0.92)', border: 'rgba(175, 113, 243, 0.28)' },
  { id: 'tag', name: 'Tag', shortLabel: 'T', startTime: 20, endTime: 24, accent: '#68d2f2', surface: 'rgba(30, 37, 43, 0.92)', border: 'rgba(104, 210, 242, 0.22)' },
];

const CONTROL_CARD =
  'ui-pressable-soft flex items-center justify-center rounded-[1.55rem] border border-white/8 bg-[linear-gradient(180deg,rgba(26,27,29,0.96),rgba(17,18,20,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_24px_40px_rgba(0,0,0,0.25)] transition-all duration-200';

const GENERIC_TRACK_ACCENTS = ['#81ddf5', '#7ed8e7', '#9f7cff', '#43c477', '#c98bff', '#73d1f8'];
const TRACK_META_BY_ID = new Map(MIXER_TRACKS.map((track) => [track.id, track]));
const CURRENT_SONG_BACKGROUND =
  'radial-gradient(circle at 16% 18%, rgba(255,255,255,0.16), transparent 30%), linear-gradient(126deg, #3b463f 0%, #202526 38%, #14181a 100%)';
const NEXT_SLOT_BACKGROUND =
  'linear-gradient(140deg, rgba(93,214,240,0.12), transparent 38%), linear-gradient(180deg, rgba(33,35,37,0.96), rgba(21,22,24,0.98))';
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
  muted = false,
  className = '',
  style,
}: {
  accent: string;
  muted?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const highlightColor = muted ? 'rgba(161, 169, 181, 0.62)' : accent;

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
        className="absolute inset-x-3 top-1/2 h-[2px] -translate-y-1/2 rounded-full shadow-[0_0_14px_currentColor]"
        style={{
          backgroundColor: highlightColor,
          color: highlightColor,
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
  muted,
  soloed,
  dimmed,
  disabled,
  onVolumeChange,
  onMute,
  onSolo,
}: ChannelStripProps) {
  const levelBottom = `${10 + volume * 78}%`;
  const knobGlow = muted ? 'rgba(120, 128, 140, 0.15)' : `${accent}30`;

  return (
    <div
      className={`relative flex h-full min-w-0 flex-col items-center rounded-[1.75rem] border border-white/7 bg-[linear-gradient(180deg,rgba(34,35,37,0.92),rgba(26,27,29,0.94))] px-2.5 pb-4 pt-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-all duration-200 ${
        dimmed ? 'opacity-45' : 'opacity-100'
      }`}
    >
      <div className="mb-2 flex w-full items-center justify-between gap-1">
        <button
          type="button"
          onClick={onSolo}
          disabled={disabled}
          aria-label={`Solo ${label}`}
          className={`ui-pressable-soft flex h-10 w-10 items-center justify-center rounded-full border text-[0.76rem] font-black tracking-[0.18em] transition-all duration-150 ${
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
          className={`ui-pressable-soft flex h-10 min-w-10 items-center justify-center rounded-full border px-3 text-[0.72rem] font-black tracking-[0.18em] transition-all duration-150 ${
            muted
              ? 'border-rose-300/55 bg-rose-400/16 text-rose-100 shadow-[0_0_18px_rgba(251,113,133,0.22)]'
              : 'border-white/8 bg-black/28 text-white/52 hover:border-white/14 hover:text-white'
          }`}
        >
          M
        </button>
      </div>

      <div className="relative flex w-full flex-1 items-center justify-center">
        <div className="relative h-full w-full max-w-[5.6rem]">
          <div className="absolute left-1/2 top-[4.5%] bottom-[6.5%] w-[0.72rem] -translate-x-1/2 rounded-full bg-[#040506] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]" />
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={`${id}-mark-${index}`}
              className="absolute left-1/2 h-[2px] w-[72%] -translate-x-1/2 rounded-full bg-white/18"
              style={{ bottom: `${12 + index * 10}%` }}
            />
          ))}
          <div
            className="absolute left-1/2 bottom-[10%] w-[0.32rem] -translate-x-1/2 rounded-full shadow-[0_0_14px_rgba(103,210,242,0.16)] transition-[height,opacity] duration-150"
            style={{
              height: `${Math.max(8, volume * 78)}%`,
              backgroundColor: muted ? 'rgba(136, 144, 158, 0.42)' : accent,
              opacity: muted ? 0.22 : 0.92,
            }}
          />
          <FaderThumb
            accent={accent}
            muted={muted}
            className="h-[4.35rem] w-full max-w-[5.95rem] transition-[bottom,box-shadow,opacity,transform] duration-150"
            style={{
              bottom: `calc(${levelBottom} - 1.75rem)`,
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
            className="absolute left-1/2 top-1/2 h-12 w-[18rem] -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer opacity-0"
          />
        </div>
      </div>

      <div className="mt-4 text-center">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.3em] text-white/28">{shortLabel}</p>
        <p className="mt-1 text-[1.03rem] font-semibold leading-tight text-white/88">{label}</p>
      </div>
    </div>
  );
}, (previousProps, nextProps) => (
  previousProps.id === nextProps.id &&
  previousProps.label === nextProps.label &&
  previousProps.shortLabel === nextProps.shortLabel &&
  previousProps.accent === nextProps.accent &&
  previousProps.volume === nextProps.volume &&
  previousProps.muted === nextProps.muted &&
  previousProps.soloed === nextProps.soloed &&
  previousProps.dimmed === nextProps.dimmed &&
  previousProps.disabled === nextProps.disabled
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
  const {
    currentTime,
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
    toggleLoop,
    toggleMute,
    trackVolumes,
  } = useMultitrackEngine();

  const hasProvidedTracks = Boolean(tracks && tracks.length > 0);
  const hasPersistedSongContext = Boolean(songId);
  const isSongBoundView = requiresSongContext || hasPersistedSongContext;
  const sequenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const padAudioRef = useRef<HTMLAudioElement | null>(null);
  const ownedObjectUrlsRef = useRef<string[]>([]);
  const [isPortrait, setIsPortrait] = useState(false);
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
  const songCardMeta = songKey
    ? `${songKey} · ${sessionModeLabel}`
    : sessionModeLabel;
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
  const sectionsWithWaveBars = useMemo(
    () => resolvedSections.map((section, index) => ({ section, waveBars: buildWaveBars(index + 1) })),
    [resolvedSections],
  );

  const progressPercent = totalDuration > 0 ? clamp(currentTime / totalDuration, 0, 1) * 100 : 0;

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
        muted: mutedTrackIds.has(track.id),
        soloed: soloTrackId === track.id,
        dimmed: Boolean(soloTrackId && soloTrackId !== track.id),
        disabled: activeTracks.length === 0,
      };
    });
  }, [activeTracks, mutedTrackIds, soloTrackId, trackVolumes]);

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
    setBusyMessage(hasPersistedSongContext ? 'Removing saved session...' : null);

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
      setIsPortrait(window.innerHeight > window.innerWidth);
    };

    updateOrientationState();

    window.addEventListener('resize', updateOrientationState, { passive: true });
    window.screen?.orientation?.addEventListener?.('change', updateOrientationState);

    const orientation = window.screen?.orientation as (ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
    }) | undefined;

    void orientation?.lock?.('landscape').catch(() => {
      // Fallback is the portrait lock screen overlay below.
    });

    return () => {
      window.removeEventListener('resize', updateOrientationState);
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
    return () => {
      replaceOwnedObjectUrls([]);
    };
  }, [replaceOwnedObjectUrls]);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      if (activeTracks.length === 0) {
        setIsInitializingSession(false);
        setBusyMessage(null);
        setLoadError(null);
        return;
      }

      setLoadError(null);
      setIsInitializingSession(true);
      setBusyMessage('Loading Audio Buffers...');
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
  }, [activeTracks, initialize, reloadKey, stop]);

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

  if (isPortrait) {
    return (
      <div className={shellClassName}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(86,207,255,0.12),_transparent_34%),linear-gradient(180deg,#232628_0%,#17191b_100%)]" />
        <div className="relative flex h-full items-center justify-center p-8">
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
        <div className="relative flex h-full items-center justify-center p-8">
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
      <div className="relative flex h-full flex-col gap-4 px-4 pb-4 pt-[max(env(safe-area-inset-top),0.7rem)]">
        <div className="hide-scrollbar -mx-1 shrink-0 overflow-x-auto pb-1">
        <header className="grid min-w-[66rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1">
          <div className="flex items-stretch gap-3">
            <div className="flex w-[4.85rem] shrink-0 flex-col items-center justify-center gap-1 rounded-[1.65rem] border border-white/8 bg-black/16 px-2 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <span className="text-[2.1rem] font-light leading-none tracking-tight text-white/92">
                {displayBpm || '--'}
              </span>
              <div className="h-px w-full bg-white/18" />
              <span className="text-[0.72rem] font-black uppercase tracking-[0.28em] text-white/56">
                {displayBpm ? 'BPM' : 'No BPM'}
              </span>
            </div>

            <div className={`${CONTROL_CARD} h-[5.55rem] w-[10.4rem] flex-col px-4 py-3`}>
              <span className="text-[3rem] font-light leading-none tracking-tight text-white">{formatClock(currentTime)}</span>
              <span className="mt-1 text-[1rem] font-medium tabular-nums text-white/58">
                {formatCompact(currentTime)} / {formatCompact(totalDuration)}
              </span>
            </div>

            {resolvedPadUrl && (
              <button
                type="button"
                onClick={() => setIsPadActive((previous) => !previous)}
                className={`${CONTROL_CARD} h-[5.55rem] w-[6.2rem] flex-col px-3 text-[0.88rem] font-semibold tracking-[0.18em] ${
                  isPadActive
                    ? 'border-[#43c477]/40 bg-[#43c477]/10 text-[#8af7b1]'
                    : 'text-[#43c477]'
                }`}
                aria-label={isPadActive ? `Stop pad for ${songKey}` : `Play pad for ${songKey}`}
              >
                <span>PAD</span>
                <span className="mt-1 text-[0.66rem] tracking-[0.22em] text-white/46">
                  {isPadActive ? 'ON' : (songKey || 'ARM')}
                </span>
              </button>
            )}
          </div>

          <div className="flex min-w-0 items-center justify-center gap-3 px-1">
            <button
              type="button"
              onClick={() => {
                void seekTo(Math.max(0, currentTime - 4));
              }}
              className={`${CONTROL_CARD} h-[5.55rem] w-[7.1rem] gap-2 text-white/78 hover:text-white`}
              aria-label="Rewind four seconds"
            >
              <RotateCcw className="h-6 w-6" />
              <span className="text-[1.15rem] font-semibold">-4s</span>
            </button>

            <button
              type="button"
              onClick={() => {
                void play();
              }}
              disabled={!isReady}
              className={`${CONTROL_CARD} h-[5.55rem] w-[9rem] gap-3 text-[#43c477] hover:text-[#4fe487] disabled:cursor-not-allowed disabled:text-white/24`}
              aria-label="Play"
            >
              <Play className="ml-1 h-9 w-9" />
              <span className="text-[1.25rem] font-semibold tracking-[0.18em]">PLAY</span>
            </button>

            <div className="grid h-[5.55rem] w-[9.5rem] grid-cols-2 gap-3">
              <button
                type="button"
                onClick={pause}
                disabled={!isReady}
                className={`${CONTROL_CARD} h-full gap-2 text-white/74 hover:text-white disabled:cursor-not-allowed disabled:text-white/24`}
                aria-label="Pause"
              >
                <Pause className="h-8 w-8" />
              </button>
              <button
                type="button"
                onClick={stop}
                disabled={!isReady}
                className={`${CONTROL_CARD} h-full gap-2 text-white/74 hover:text-white disabled:cursor-not-allowed disabled:text-white/24`}
                aria-label="Stop"
              >
                <Square className="h-7 w-7" />
              </button>
            </div>
          </div>

          <div className="flex items-stretch justify-end gap-3">
            <div className="flex h-[5.55rem] w-[17.1rem] items-center rounded-[1.55rem] border border-white/8 bg-[linear-gradient(180deg,rgba(26,27,29,0.96),rgba(17,18,20,0.96))] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_24px_40px_rgba(0,0,0,0.25)]">
              <div className="grid h-full w-full grid-cols-[3.3rem_3.3rem_1fr_1fr] gap-2">
                <button
                  type="button"
                  onClick={() => handleLoopMarker('a')}
                className={`ui-pressable-soft rounded-[1.15rem] border px-2 text-left transition-all ${
                  loopEnabled
                    ? 'border-cyan-300/40 bg-cyan-300/12 text-cyan-50'
                    : 'border-white/8 bg-black/20 text-white/72'
                }`}
                  title="Punto A: marca el inicio del loop"
                  aria-label="Punto A, inicio del loop"
                >
                  <span className="block text-[0.64rem] font-black tracking-[0.22em]">A</span>
                  <span className="mt-1 block text-[0.95rem] font-semibold tabular-nums">{formatCompact(loopPointA)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleLoopMarker('b')}
                className={`ui-pressable-soft rounded-[1.15rem] border px-2 text-left transition-all ${
                  loopEnabled
                    ? 'border-fuchsia-300/40 bg-fuchsia-300/12 text-fuchsia-50'
                    : 'border-white/8 bg-black/20 text-white/72'
                }`}
                  title="Punto B: marca el final del loop"
                  aria-label="Punto B, final del loop"
                >
                  <span className="block text-[0.64rem] font-black tracking-[0.22em]">B</span>
                  <span className="mt-1 block text-[0.95rem] font-semibold tabular-nums">{formatCompact(loopPointB)}</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoopIn}
                  className={`ui-pressable-soft flex items-center justify-center gap-2 rounded-[1.15rem] border transition-all ${
                    loopEnabled
                      ? 'border-[#43c477]/55 bg-[#43c477]/14 text-[#8af7b1] shadow-[0_0_20px_rgba(67,196,119,0.18)]'
                      : 'border-white/8 bg-black/20 text-white/76'
                  }`}
                  title="Activa el loop entre A y B"
                  aria-label="Activar loop entre A y B"
                >
                  <Repeat className="h-5 w-5" />
                  <span className="text-[0.88rem] font-semibold tracking-[0.18em]">IN</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoopOut}
                  className="ui-pressable-soft flex items-center justify-center gap-2 rounded-[1.15rem] border border-white/8 bg-black/20 text-white/72 transition-all hover:text-white"
                  title="Salir del loop A-B"
                  aria-label="Salir del loop A-B"
                >
                  <span className="text-[0.88rem] font-semibold tracking-[0.18em]">OUT</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowLoadPanel(true)}
              className={`${CONTROL_CARD} h-[5.55rem] w-[5.8rem] text-[1.1rem] font-semibold tracking-[0.18em] text-white/70 hover:text-white`}
              title="Cargar o reemplazar la sesión multitrack"
              aria-label="Cargar o reemplazar la sesión multitrack"
            >
              <div className="flex flex-col items-center gap-1">
                <Upload className="h-5 w-5" />
                <span className="text-[0.92rem]">CARGAR</span>
              </div>
            </button>
          </div>
        </header>
        </div>

        <section
          className={`grid min-h-0 shrink-0 gap-4 ${
            showSectionsPanel ? 'grid-rows-[10.5rem_12.4rem]' : 'grid-rows-[10.5rem]'
          }`}
        >
          <div className="overflow-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.96),rgba(27,29,30,0.96))] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="mb-2 flex items-center justify-between px-1">
              <div>
                <p className="text-[0.72rem] font-black uppercase tracking-[0.28em] text-white/36">{title}</p>
                <h1 className="mt-1 text-[1.35rem] font-semibold tracking-tight text-white">{currentSessionLabel}</h1>
              </div>
              <div className="flex items-center gap-2 text-right">
                <div className="rounded-full border border-white/8 bg-black/18 px-3 py-1">
                  <p className="text-[0.7rem] font-black uppercase tracking-[0.24em] text-white/44">
                    {showSectionsPanel ? 'Sections' : 'Mix'}
                  </p>
                </div>
                <div>
                  <p className="text-[0.72rem] font-black uppercase tracking-[0.28em] text-white/36">Ready State</p>
                  <p className={`mt-1 text-[1rem] font-semibold ${isReady ? 'text-[#43c477]' : 'text-white/58'}`}>
                    {readyStateLabel}
                  </p>
                </div>
              </div>
            </div>
            <div className="hide-scrollbar flex h-[calc(100%-2.5rem)] gap-4 overflow-x-auto">
              <button
                type="button"
                onClick={() => {
                  if (hasTrackSession) {
                    void seekTo(0);
                    return;
                  }

                  setShowLoadPanel(true);
                }}
                className="ui-pressable-card group relative flex min-w-[16rem] w-[16.75rem] shrink-0 flex-col overflow-hidden rounded-[1.7rem] border border-white/12 bg-[linear-gradient(180deg,rgba(37,39,41,0.98),rgba(26,28,30,0.98))] px-4 py-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:border-white/20"
                aria-label={hasTrackSession ? `Jump to start of ${currentSessionLabel}` : 'Open song loader'}
              >
                <div className="relative h-full">
                  <div className="absolute inset-0 rounded-[1.45rem] opacity-50" style={{ backgroundImage: CURRENT_SONG_BACKGROUND }} />
                  <div className="relative flex h-full flex-col">
                    <div className="relative h-[5.7rem] overflow-hidden rounded-[1.25rem] border border-white/10 bg-black/28">
                      {songCoverArtUrl ? (
                        <img
                          src={songCoverArtUrl}
                          alt={`Portada de ${songCardTitle}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(129,221,245,0.18),_transparent_34%),linear-gradient(180deg,rgba(56,62,65,0.92),rgba(21,24,26,0.96))] text-white/52">
                          <ListMusic className="h-9 w-9" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.18)_100%)]" />
                      <div
                        className={`absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border text-white shadow-[0_12px_20px_rgba(0,0,0,0.24)] transition-all duration-200 ${
                          isPlaying
                            ? 'border-[#43c477] bg-[#232a24] text-[#43c477] shadow-[0_0_18px_rgba(67,196,119,0.25)]'
                            : 'border-white/12 bg-black/38 text-white/80'
                        }`}
                      >
                        <Play className="ml-1 h-5 w-5" />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-1 flex-col justify-between">
                      <div>
                        <p className="text-[0.68rem] font-black uppercase tracking-[0.28em] text-white/42">Current Song</p>
                        <h2 className="mt-1 truncate text-[1.28rem] font-semibold tracking-tight text-white">{songCardTitle}</h2>
                        <p className="mt-1 text-[0.85rem] text-white/56">{songCardMeta}</p>
                      </div>

                      <div className="mt-3">
                        <div className="mb-2 flex items-center justify-between text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-white/48">
                          <span>{readyStateLabel}</span>
                          <span>{formatCompact(currentTime)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-black/28">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,#43c477_0%,#81ddf5_100%)] shadow-[0_0_16px_rgba(67,196,119,0.18)] transition-[width] duration-200"
                            style={{ width: `${Math.max(hasTrackSession ? progressPercent : 0, hasTrackSession ? 5 : 0)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </button>

              <div
                className="relative flex min-w-[18rem] w-[22rem] shrink-0 flex-col overflow-hidden rounded-[1.7rem] border border-dashed border-white/10 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                style={{ backgroundImage: NEXT_SLOT_BACKGROUND }}
              >
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_35%,rgba(0,0,0,0.18)_100%)]" />
                <div className="relative flex h-full flex-col justify-between">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.72rem] font-black uppercase tracking-[0.28em] text-white/36">Next Slot</p>
                      <h3 className="mt-3 text-[1.45rem] font-semibold tracking-tight text-white/86">Add next song</h3>
                      <p className="mt-2 max-w-[15rem] text-[0.95rem] text-white/50">
                        Dejamos la cola lista para cuando conectemos el cambio de cancion real.
                      </p>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/22 text-white/52">
                      <Plus className="h-5 w-5" />
                    </div>
                  </div>

                  <div className="rounded-[1.1rem] border border-white/8 bg-black/16 px-4 py-3">
                    <p className="text-[0.72rem] font-black uppercase tracking-[0.24em] text-white/34">Queue</p>
                    <p className="mt-2 text-sm leading-relaxed text-white/54">
                      No llenamos esta franja con canciones ficticias; aqui vivira solo la siguiente cancion cuando activemos la cola.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {showSectionsPanel && (
            <div className="relative overflow-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(29,30,32,0.98),rgba(23,24,26,0.98))] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="mb-3 flex items-center justify-between px-1">
                <div>
                  <p className="text-[0.72rem] font-black uppercase tracking-[0.28em] text-white/36">Sections Lane</p>
                  <p className="mt-1 text-sm text-white/54">Waveform blocks stay hidden until you ask for them.</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/18 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        void saveSectionOffset(sectionOffsetSeconds - 0.25);
                      }}
                      className="ui-pressable-soft h-8 min-w-8 rounded-full border border-white/10 bg-black/22 px-2 text-sm font-black text-white/72"
                      aria-label="Shift sections earlier"
                    >
                      -
                    </button>
                    <div className="min-w-[5.2rem] px-2 text-center text-[0.68rem] font-black uppercase tracking-[0.18em] text-white/54">
                      {sectionOffsetSeconds >= 0 ? '+' : ''}
                      {sectionOffsetSeconds.toFixed(2)}s
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void saveSectionOffset(sectionOffsetSeconds + 0.25);
                      }}
                      className="ui-pressable-soft h-8 min-w-8 rounded-full border border-white/10 bg-black/22 px-2 text-sm font-black text-white/72"
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
                    className="ui-pressable-soft rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[0.72rem] font-black uppercase tracking-[0.22em] text-white/60"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setSurfaceView('mix')}
                    className="ui-pressable-soft rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[0.72rem] font-black uppercase tracking-[0.22em] text-white/60"
                  >
                    Hide
                  </button>
                </div>
              </div>
              <div
                className="absolute bottom-4 top-4 z-30 w-[4px] -translate-x-1/2 bg-white shadow-[0_0_18px_rgba(255,255,255,0.68)]"
                style={{ left: `calc(1rem + ${progressPercent}% * ((100% - 2rem) / 100))` }}
              />
              <div className="relative flex h-full gap-3">
                {sectionsWithWaveBars.map(({ section, waveBars }, index) => {
                  const sectionWidth = totalDuration > 0 ? ((section.endTime - section.startTime) / totalDuration) * 100 : 0;
                  const isActive = index === activeSectionIndex;

                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => {
                        void seekTo(section.startTime);
                      }}
                      className="relative h-full rounded-[1.55rem] border text-left transition-all duration-200"
                      style={{
                        width: `${sectionWidth}%`,
                        background: `linear-gradient(180deg, ${section.surface}, rgba(20,20,22,0.96))`,
                        borderColor: isActive ? section.accent : section.border,
                        boxShadow: isActive ? `0 0 22px ${section.accent}20` : 'none',
                      }}
                    >
                      <div className="absolute inset-0 rounded-[1.5rem] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_2px,transparent_2px,transparent_26px)]" />
                      <div className="absolute left-5 right-5 top-1/2 flex h-[42%] -translate-y-1/2 items-end gap-[3px]">
                        {waveBars.map((height, barIndex) => (
                          <span
                            key={`${section.id}-bar-${barIndex}`}
                            className="flex-1 rounded-full bg-white/70"
                            style={{
                              height: `${height}%`,
                              opacity: isActive ? 0.94 : 0.68,
                            }}
                          />
                        ))}
                      </div>
                      <div className="absolute left-5 top-4 flex items-center gap-3">
                        <span
                          className="flex h-10 min-w-10 items-center justify-center rounded-full border px-2 text-[0.9rem] font-black tracking-[0.16em]"
                          style={{
                            borderColor: `${section.accent}90`,
                            color: section.accent,
                            backgroundColor: `${section.accent}1c`,
                          }}
                        >
                          {section.shortLabel}
                        </span>
                        <span className="text-[0.95rem] font-semibold text-white/88">{section.name}</span>
                      </div>
                      <span className="absolute bottom-4 left-5 text-[0.78rem] font-medium tabular-nums text-white/46">
                        {formatCompact(section.startTime)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_7.25rem_8rem] gap-4">
          <div
            className="hide-scrollbar grid min-h-0 gap-3 overflow-x-auto overflow-y-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] px-3 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, mixerView.length)}, minmax(4.5rem, 1fr))` }}
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
                  muted={track.muted}
                  soloed={track.soloed}
                  dimmed={track.dimmed}
                  disabled={track.disabled}
                  onVolumeChange={(nextVolume) => setVolume(track.id, nextVolume)}
                  onMute={() => handleMuteTrack(track.id)}
                  onSolo={() => handleSoloTrack(track.id)}
                />
              );
            })}
          </div>

          <div className="rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] px-3 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex h-full flex-col gap-4">
              <div className="flex items-center justify-center gap-1 pt-1 text-white/42">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              </div>
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setSurfaceView('mix')}
                  className={`ui-pressable-soft flex h-16 flex-col items-center justify-center gap-1 rounded-[1.2rem] border transition-all ${
                    surfaceView === 'mix'
                      ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50 shadow-[0_0_20px_rgba(129,221,245,0.14)]'
                      : 'border-white/8 bg-black/24 text-white/62'
                  }`}
                >
                  <SlidersVertical className="h-6 w-6" />
                  <span className="text-[0.66rem] font-black uppercase tracking-[0.18em]">Mix</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSurfaceView('sections')}
                  className={`ui-pressable-soft flex h-16 flex-col items-center justify-center gap-1 rounded-[1.2rem] border transition-all ${
                    surfaceView === 'sections'
                      ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50 shadow-[0_0_20px_rgba(129,221,245,0.14)]'
                      : 'border-white/8 bg-black/24 text-white/62'
                  }`}
                >
                  <ListMusic className="h-6 w-6" />
                  <span className="text-[0.6rem] font-black uppercase tracking-[0.16em]">Sections</span>
                </button>
                <button
                  type="button"
                  disabled
                  className="rounded-[1.2rem] border border-white/8 bg-black/18 px-3 py-4 text-center text-white/28"
                >
                  <span className="block text-[0.76rem] font-black uppercase tracking-[0.2em]">Pad</span>
                  <span className="mt-1 block text-[0.6rem] font-semibold uppercase tracking-[0.16em]">Soon</span>
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
                className="ui-pressable-soft rounded-[1.35rem] border border-white/8 bg-black/24 px-3 py-5 text-center text-[0.78rem] font-semibold tracking-[0.2em] text-white/62"
              >
                MUTE
                <br />
                ALL
              </button>
              <button
                type="button"
                onClick={handleLoopIn}
                disabled={!hasTrackSession}
                className={`ui-pressable-soft rounded-[1.35rem] border px-3 py-5 text-center text-[0.78rem] font-semibold tracking-[0.2em] ${
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
                className="ui-pressable-soft rounded-[1.35rem] border border-white/8 bg-black/24 px-3 py-5 text-center text-[0.78rem] font-semibold tracking-[0.2em] text-white/62"
              >
                LOOP
                <br />
                OFF
              </button>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] px-3 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="relative flex h-full flex-col items-center rounded-[1.75rem] border border-white/7 bg-[linear-gradient(180deg,rgba(34,35,37,0.92),rgba(26,27,29,0.94))] px-3 pb-4 pt-3">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-black/28 text-white/62">
                <span className="text-[0.82rem] font-black tracking-[0.18em]">M</span>
              </div>

              <div className="relative flex w-full flex-1 items-center justify-center">
                <div className="relative h-full w-full max-w-[5.8rem]">
                  <div className="absolute left-1/2 top-[5%] bottom-[7%] w-[0.72rem] -translate-x-1/2 rounded-full bg-[#050607]" />
                  {Array.from({ length: 7 }).map((_, index) => (
                    <div
                      key={`master-mark-${index}`}
                      className="absolute left-1/2 h-[2px] w-[76%] -translate-x-1/2 rounded-full bg-white/18"
                      style={{ bottom: `${14 + index * 11}%` }}
                    />
                  ))}
                  <FaderThumb
                    accent="#81ddf5"
                    className="h-[4.35rem] w-full max-w-[6.1rem] transition-[bottom,box-shadow] duration-150"
                    style={{
                      bottom: `calc(${10 + masterVolume * 78}% - 1.75rem)`,
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
                    className="absolute left-1/2 top-1/2 h-12 w-[18rem] -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer opacity-0"
                  />
                </div>
              </div>

              <div className="mt-4 text-center">
                <p className="text-[0.62rem] font-black uppercase tracking-[0.3em] text-white/28">BUS</p>
                <p className="mt-1 text-[1.15rem] font-semibold text-white/90">Master</p>
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

                <div className="mt-6 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
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
                  </div>
                  <div className="rounded-[1.3rem] border border-white/8 bg-black/24 p-4">
                    <p className="text-[0.74rem] font-black uppercase tracking-[0.22em] text-white/38">Inference Notes</p>
                    <p className="mt-3 text-sm leading-relaxed text-white/54">
                      {unmatchedFiles.length > 0
                        ? `Quedaron ${unmatchedFiles.length} archivo(s) sin mapear: ${unmatchedFiles.slice(0, 4).join(', ')}${unmatchedFiles.length > 4 ? '...' : ''}`
                        : 'Cuando un nombre no coincide con un stem conocido, el archivo no se carga hasta que definamos una regla o un manifest.'}
                    </p>
                  </div>
                </div>

                {hasTrackSession && (
                  <div className="mt-6 flex items-center justify-between rounded-[1.2rem] border border-white/8 bg-black/20 px-4 py-3">
                    <p className="text-sm text-white/58">La sesion actual ya esta preparada. Puedes cerrar este panel o reemplazarla.</p>
                    <button
                      type="button"
                      onClick={clearManualSession}
                      className="ui-pressable-soft rounded-[0.9rem] border border-white/10 bg-white/6 px-4 py-2 text-xs font-semibold tracking-[0.16em] text-white/82"
                    >
                      CLEAR SESSION
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

