import {
  Activity,
  AlertTriangle,
  AudioWaveform,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Infinity,
  ListMusic,
  Pause,
  Play,
  SkipBack,
  SlidersVertical,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { canUseAdvancedStreamingEngine, useLoopLabMultitrackEngine } from '../../hooks/useLoopLabMultitrackEngine';
import { useNativeIOSMultitrackEngine } from '../../hooks/useNativeIOSMultitrackEngine';
import type { MultitrackEngineLoadWarning, SongStructure, TrackData } from '../../services/MultitrackEngine';
import type { SharedStreamingTelemetry } from '../../services/LoopLabStreamingMultitrackEngine';
import { ChannelStrip, FaderThumb } from './live-director/ChannelStrip';
import { EnsayoQueueCard } from './live-director/EnsayoQueueCard';
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
  saveLiveDirectorSectionOffset,
  saveLiveDirectorSongSession,
  uploadFileToLiveDirectorTarget,
} from '../../utils/liveDirectorUploadClient';
import { resolveFetchableAudioUrl } from '../../lib/audio-playback.js';
import { audioSessionService } from '../../services/AudioSessionService';
import {
  isGuideRoutingTrack,
  resolveTrackOutputRoute,
  toggleGuideTrackOutputRoute,
  type TrackOutputRoute,
} from '../../utils/liveDirectorTrackRouting';
import { getPadUrlForSongKey } from '../../utils/padAudio';
import { extractCoverArtFromMp3 } from '../../utils/mp3CoverArt';
import { readLiveBrowserCapabilities } from '../../utils/liveDiagnostics';

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
  captured: boolean;
  pointerId: number | null;
  startX: number;
  startScrollLeft: number;
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

const EMPTY_QUEUE_SONGS: LiveDirectorQueueSong[] = [];

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

// Per-platform active stem limits for reliable live playback.
//   - iOS native (AVAudioEngine):     13 song stems, with internal pad extra
//   - Android web (Capacitor browser): 10 stems before clocks drift
//   - iOS Safari web:                  4 stems before WebAudio memory pressure becomes unreliable
//   - Safari desktop web:              9 stems before WebAudio/DecoderCocoa rejects some AAC sessions
//   - Desktop web (Chrome/Edge/FF):    11 stems before Chrome decode windows stall
const IOS_NATIVE_MAX_ACTIVE_TRACKS = 13;
const ANDROID_MAX_ACTIVE_TRACKS = 10;
const IOS_SAFARI_WEB_MAX_ACTIVE_TRACKS = 4;
const SAFARI_WEB_MAX_ACTIVE_TRACKS = 9;
const WEB_ENGINE_MAX_ACTIVE_TRACKS = 11;
const INTERNAL_PAD_TRACK_ID = '__internal-pad__';
const DISABLE_BACKWARD_SEEK_WHILE_PLAYING = true;
// The internal pad masters are intentionally lush, but their raw gain is too hot
// for live control. Apply a fixed -8 dB trim before the pad reaches either engine.
const INTERNAL_PAD_GAIN_TRIM = Math.pow(10, -8 / 20);
const INTERNAL_PAD_CROSSFADE_SECONDS = 7;
const INTERNAL_PAD_CROSSFADE_MS = INTERNAL_PAD_CROSSFADE_SECONDS * 1000;

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

type MixerTrackView = MixerTrackMeta & {
  volume: number;
  level: number;
  muted: boolean;
  soloed: boolean;
  dimmed: boolean;
  disabled: boolean;
  disabledReason?: string;
  disabledTitle?: string;
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
const CONGREGATION_FADE_MS = 5000;
const SECTIONS_AUTO_FOLLOW_RESUME_MS = 5000;
const SECTION_DRAG_CLICK_SUPPRESS_THRESHOLD_PX = 8;
const SEQUENCE_FILE_ACCEPT = '.aac,.m4a,audio/aac,audio/mp4,audio/x-m4a,audio/*';

const CONTROL_CARD =
  'ui-pressable-soft flex items-center justify-center rounded-[1.55rem] border border-white/8 bg-[linear-gradient(180deg,rgba(26,27,29,0.96),rgba(17,18,20,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_24px_40px_rgba(0,0,0,0.25)] transition-all duration-200';

function KeyboardHint({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute right-1.5 top-1.5 z-10 rounded-md border border-white/12 bg-black/58 px-1.5 py-0.5 text-[0.5rem] font-black leading-none text-white/76 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
      {children}
    </span>
  );
}

function CongregationFadeIcon({ muted, fading }: { muted: boolean; fading: boolean }) {
  const fillClip = muted ? 'inset(0 100% 0 0)' : 'inset(0 0% 0 0)';

  return (
    <span className="relative block h-7 w-9" aria-hidden="true">
      <svg viewBox="0 0 36 28" className="absolute inset-0 h-full w-full text-white/28">
        <path
          d="M4 4 C10 4 12 8 17 13 C22 18 26 21 32 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path d="M4 4 C10 4 12 8 17 13 C22 18 26 21 32 22 L32 24 L4 24 Z" fill="currentColor" opacity="0.2" />
        <path d="M4 24 H32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <svg
        viewBox="0 0 36 28"
        className={`absolute inset-0 h-full w-full text-cyan-200 ${fading ? 'drop-shadow-[0_0_7px_rgba(129,221,245,0.62)]' : ''}`}
        style={{
          clipPath: fillClip,
          transitionProperty: 'clip-path',
          transitionDuration: `${CONGREGATION_FADE_MS}ms`,
          transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <path
          d="M4 4 C10 4 12 8 17 13 C22 18 26 21 32 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path d="M4 4 C10 4 12 8 17 13 C22 18 26 21 32 22 L32 24 L4 24 Z" fill="currentColor" opacity="0.34" />
        <path d="M4 24 H32" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

const GENERIC_TRACK_ACCENTS = ['#81ddf5', '#7ed8e7', '#9f7cff', '#43c477', '#c98bff', '#73d1f8'];
const TRACK_META_BY_ID = new Map(MIXER_TRACKS.map((track) => [track.id, track]));

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

const readStableStreamingTelemetryTime = (telemetry: SharedStreamingTelemetry) => {
  let before = 0;
  let after = 0;
  let currentTime = 0;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    before = Atomics.load(telemetry.sequence, 0);
    currentTime = telemetry.currentTime[0] || 0;
    after = Atomics.load(telemetry.sequence, 0);

    if (before === after && before % 2 === 0) {
      break;
    }
  }

  return currentTime;
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

const shouldIgnoreSectionKeyboardTarget = (target: EventTarget | null) => {
  return target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="slider"], [data-live-director-shortcuts="off"]',
      ),
    );
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

export function LiveDirectorLoopLabView({
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
  queueSongs = EMPTY_QUEUE_SONGS,
  activeQueueSongId = '',
  onSelectQueueSong,
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
    captured: false,
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
  const sectionsGestureExceededDragThresholdRef = useRef(false);
  const keyboardSectionIndexRef = useRef<number | null>(null);
  const mixerScrollRef = useRef<HTMLDivElement | null>(null);
  const mixerDragStateRef = useRef<DragScrollState>({
    active: false,
    captured: false,
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
  const congregationMutedRef = useRef(false);
  const resumeNativeMetersTimeoutRef = useRef<number | null>(null);
  const passiveTelemetryFrameRef = useRef<number | null>(null);
  const passiveCurrentTimeRef = useRef(0);
  const visualSectionTimeRef = useRef<number | null>(null);
  const passiveClockTextRef = useRef<HTMLSpanElement | null>(null);
  const passiveCompactClockTextRef = useRef<HTMLSpanElement | null>(null);
  const passiveProgressTextRef = useRef<HTMLSpanElement | null>(null);
  const passiveProgressBarRef = useRef<HTMLDivElement | null>(null);
  const passiveMixerLevelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const passiveSectionPlayheadRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const passiveMinimapPlayheadRef = useRef<HTMLDivElement | null>(null);
  const passiveFpsMonitorRef = useRef({
    lastSampleAt: 0,
    frames: 0,
    lowSamples: 0,
    lastAlertAt: 0,
  });
  const mixerInteractionActiveRef = useRef(false);
  const sectionTransitionTokenRef = useRef(0);
  const isSectionTransitioningRef = useRef(false);
  const sectionSeekInFlightRef = useRef(false);
  const pendingSectionSeekTargetRef = useRef<number | null>(null);
  const pendingSectionSeekWasPlayingRef = useRef<boolean | null>(null);
  const sessionSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSilentSessionSaveRef = useRef<PendingLiveDirectorSessionSave | null>(null);
  const isFlushingSilentSessionSaveRef = useRef(false);
  const liveDirectorRootRef = useRef<HTMLDivElement | null>(null);
  const chordClockFrameRef = useRef<number | null>(null);
  const activeChordLineRef = useRef<HTMLElement | null>(null);
  const activeChordSectionRef = useRef<HTMLElement | null>(null);
  const lastChordScrollKeyRef = useRef('');
  const visualClockReaderRef = useRef<() => number>(() => 0);
  const [nativeEngineAvailable, setNativeEngineAvailable] = useState(() => (
    engineSurface === 'ios-native'
  ));
  const isIOSNativeEngineSurface = engineSurface === 'ios-native' || nativeEngineAvailable;
  const [useStreamingEngine, setUseStreamingEngine] = useState(false);
  const [hasResolvedEngineCapability, setHasResolvedEngineCapability] = useState(false);
  const passiveStreamingTelemetryEnabled = !isIOSNativeEngineSurface && useStreamingEngine;
  const webMultitrackEngine = useLoopLabMultitrackEngine({
    useStreamingEngine,
    passiveTelemetry: passiveStreamingTelemetryEnabled,
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
    setMasterVolume,
    setTrackOutputRoute,
    setVolume,
    soloTrack,
    stop,
    trackLevels,
    trackEnvelopes,
    toggleMute,
    trackVolumes,
    loadProgress,
    loadWarnings,
  } = selectedMultitrackEngine;
  const nullSharedTelemetry = useCallback(() => null, []);
  const getSharedTelemetry = 'getSharedTelemetry' in selectedMultitrackEngine
    ? selectedMultitrackEngine.getSharedTelemetry
    : nullSharedTelemetry;
  const engineSuspensionNotice = 'suspensionNotice' in selectedMultitrackEngine
    ? selectedMultitrackEngine.suspensionNotice
    : null;
  const reviveAfterSuspension = 'reviveAfterSuspension' in selectedMultitrackEngine
    ? selectedMultitrackEngine.reviveAfterSuspension
    : async () => {};
  const clearSuspensionNotice = 'clearSuspensionNotice' in selectedMultitrackEngine
    ? selectedMultitrackEngine.clearSuspensionNotice
    : () => {};
  const unlockAudioForUserGesture = 'unlockAudioForUserGesture' in selectedMultitrackEngine
    ? selectedMultitrackEngine.unlockAudioForUserGesture
    : async () => {};
  const loopLabState = 'loopState' in selectedMultitrackEngine
    ? selectedMultitrackEngine.loopState
    : { status: 'off' as const, region: null, error: null };
  const configureLoopRegion = 'configureLoopRegion' in selectedMultitrackEngine
    ? selectedMultitrackEngine.configureLoopRegion
    : async () => {
      throw new Error('El motor seleccionado no admite el laboratorio de bucle.');
    };
  const isTransportCueBusyRef = useRef(false);
  const getVisualClockTime = useCallback(() => {
    if ('getCurrentTimeSnapshot' in selectedMultitrackEngine) {
      return selectedMultitrackEngine.getCurrentTimeSnapshot();
    }

    return selectedMultitrackEngine.currentTime;
  }, [selectedMultitrackEngine]);

  const handleTogglePlaybackFromGesture = useCallback(() => {
    if (isTransportCueBusyRef.current) {
      return;
    }

    if (isPlaying) {
      pause();
      return;
    }

    const contextUnlockPromise = unlockAudioForUserGesture();
    const sessionUnlockPromise = audioSessionService.unlockFromUserGesture();

    // Start playback while the browser still considers this a user gesture.
    // Waiting for the silent-session unlock first can consume Safari/WebKit's
    // transient activation and leave otherwise valid media tracks silent.
    void play().catch((error) => {
      console.warn('[LiveDirectorView] No se pudo iniciar reproducción tras el gesto.', error);
    });
    void Promise.allSettled([contextUnlockPromise, sessionUnlockPromise]);
  }, [isPlaying, pause, play, unlockAudioForUserGesture]);

  useEffect(() => {
    visualClockReaderRef.current = getVisualClockTime;
  }, [getVisualClockTime]);
  const initializeEngineRef = useRef(initialize);
  const stopEngineRef = useRef(stop);

  useEffect(() => {
    initializeEngineRef.current = initialize;
    stopEngineRef.current = stop;
  }, [initialize, stop]);

  useEffect(() => {
    if (engineSurface === 'ios-native') {
      setNativeEngineAvailable(true);
      return;
    }

    const refreshNativeEngineAvailability = () => {
      setNativeEngineAvailable(isNativeLiveDirectorEngineAvailable());
    };

    refreshNativeEngineAvailability();
    const timeoutId = window.setTimeout(refreshNativeEngineAvailability, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [engineSurface]);

  useEffect(() => {
    setUseStreamingEngine(!isIOSNativeEngineSurface && canUseAdvancedStreamingEngine());
    setHasResolvedEngineCapability(true);
  }, [isIOSNativeEngineSurface]);

  const canRunAdvancedStreamingEngine =
    hasResolvedEngineCapability && !isIOSNativeEngineSurface && canUseAdvancedStreamingEngine();

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
  const [keyboardSectionIndex, setKeyboardSectionIndex] = useState<number | null>(null);
  const [visualSectionTime, setVisualSectionTimeState] = useState<number | null>(null);
  const [manualSession, setManualSession] = useState<LiveDirectorResolvedSession | null>(
    initialSession ? toResolvedSession(initialSession) : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sectionOffsetSaveError, setSectionOffsetSaveError] = useState<string | null>(null);
  const [dismissedLoadWarningKey, setDismissedLoadWarningKey] = useState<string | null>(null);
  const [trackLimitNotice, setTrackLimitNotice] = useState<{
    key: string;
    names: string[];
    limit: number;
    total: number;
  } | null>(null);
  const [dismissedTrackLimitNoticeKey, setDismissedTrackLimitNoticeKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isInitializingSession, setIsInitializingSession] = useState(false);
  const [isSectionSeekBusy, setIsSectionSeekBusy] = useState(false);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem('ld:showMode');
    } catch {
      // Ignore — privacy mode or storage quota.
    }
  }, []);
  const [loaderMode, setLoaderMode] = useState<'sequence' | 'folder'>('sequence');
  const [unmatchedFiles, setUnmatchedFiles] = useState<string[]>([]);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [mutedTrackIds, setMutedTrackIds] = useState<Set<string>>(new Set());
  const [trackOutputRoutes, setTrackOutputRoutes] = useState<Record<string, TrackOutputRoute>>({});
  const [soloTrackId, setSoloTrackId] = useState<string | null>(null);
  const [masterVolume, setMasterVolumeState] = useState(0.82);
  const [congregationFadeState, setCongregationFadeState] = useState<
    'normal' | 'fading-out' | 'muted' | 'fading-in'
  >('normal');
  const isCongregationFading =
    congregationFadeState === 'fading-out' || congregationFadeState === 'fading-in';
  const congregationFadeTargetMuted =
    congregationFadeState === 'fading-out' || congregationFadeState === 'muted';
  const loopEnabled = loopLabState.status === 'active';
  const loopPreparing = loopLabState.status === 'preparing';
  const loopFailed = loopLabState.status === 'error';
  const [surfaceView, setSurfaceView] = useState<SurfaceView>('mix');
  const [showOffsetModal, setShowOffsetModal] = useState(false);
  const [showStemsActionModal, setShowStemsActionModal] = useState(false);
  const [showTrackLoadModal, setShowTrackLoadModal] = useState(false);
  const [pendingEnabledMap, setPendingEnabledMap] = useState<Record<string, boolean> | null>(null);
  const [isReturnToStartBusy, setIsReturnToStartBusy] = useState(false);
  const isTransportCueBusy = isReturnToStartBusy || isSectionSeekBusy;
  isTransportCueBusyRef.current = isTransportCueBusy;
  const offsetModalInitialValueRef = useRef<number | null>(null);
  const [isPadActive, setIsPadActive] = useState(false);
  const [internalPadVolumeState, setInternalPadVolumeState] = useState(0.34);
  const [songCoverArtUrl, setSongCoverArtUrl] = useState<string | null>(null);
  const [queueSongCoverArtMap, setQueueSongCoverArtMap] = useState<Record<string, string | null>>({});
  const getLivePlaybackTime = useCallback(() => {
    if (visualSectionTimeRef.current !== null) {
      return visualSectionTimeRef.current;
    }

    return passiveStreamingTelemetryEnabled ? passiveCurrentTimeRef.current : currentTime;
  }, [currentTime, passiveStreamingTelemetryEnabled]);
  const setVisualSectionTime = useCallback((nextTime: number | null) => {
    visualSectionTimeRef.current = nextTime;
    setVisualSectionTimeState(nextTime);
  }, []);
  const isEnsayoMode = mode === 'ensayo';
  const resolvedInternalPadVolume = clamp(
    Number.isFinite(Number(internalPadVolume)) ? Number(internalPadVolume) : internalPadVolumeState,
    0,
    1,
  );
  const effectiveInternalPadVolume = clamp(resolvedInternalPadVolume * INTERNAL_PAD_GAIN_TRIM, 0, 1);
  const resolvedPadUrl = useMemo(() => getPadUrlForSongKey(songKey), [songKey]);
  const shouldUseNativePadBridge = Boolean(isIOSNativeEngineSurface && isEnsayoMode && resolvedPadUrl);
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
  const isToolbarCompactLandscape = viewportWidth > 0 && viewportWidth < 760;
  const headerMinWidth = useMemo(
    () => (
      isUltraCompactLandscape
        ? '30rem'
        : isToolbarCompactLandscape
          ? '34rem'
          : scaleRem(58, 46)
    ),
    [isToolbarCompactLandscape, isUltraCompactLandscape, scaleRem],
  );
  const toolbarHeaderStyle = useMemo<CSSProperties>(
    () => (
      isToolbarCompactLandscape
        ? { minWidth: headerMinWidth }
        : {
          minWidth: headerMinWidth,
          gridTemplateColumns: '35% 3% 49% 5% 8%',
        }
    ),
    [headerMinWidth, isToolbarCompactLandscape],
  );
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

  const activeTrackWarningThreshold = useMemo(() => {
    if (useStreamingEngine || canRunAdvancedStreamingEngine) {
      return Number.MAX_SAFE_INTEGER;
    }

    if (!hasResolvedEngineCapability) {
      return WEB_ENGINE_MAX_ACTIVE_TRACKS;
    }

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
    const capabilities = readLiveBrowserCapabilities();
    if (capabilities.isIOS && capabilities.isSafari) {
      return IOS_SAFARI_WEB_MAX_ACTIVE_TRACKS;
    }
    if (capabilities.isSafari) {
      return SAFARI_WEB_MAX_ACTIVE_TRACKS;
    }
    return WEB_ENGINE_MAX_ACTIVE_TRACKS;
  }, [canRunAdvancedStreamingEngine, hasResolvedEngineCapability, isIOSNativeEngineSurface, maxWebActiveTracks, useStreamingEngine]);
  const sessionActiveTrackLimit = Math.max(1, activeTrackWarningThreshold);
  const trackLoadGuidanceText = useStreamingEngine || canRunAdvancedStreamingEngine
    ? 'Motor avanzado activo: puedes cargar todos los stems.'
    : `Desactiva stems que no vas a usar. Más de ${sessionActiveTrackLimit} puede ser inestable según el equipo.`;

  const enabledSessionTracks = useMemo(
    () => sessionTracks.filter((track) => track.enabled !== false),
    [sessionTracks],
  );

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

  const autoDisabledTrackNames = useMemo(() => {
    if (!isWebTrackLimitExceeded) return [];
    const activeIds = new Set(activeTracks.map((track) => track.id));
    return enabledSessionTracks
      .filter((track) => !activeIds.has(track.id))
      .map((track) => track.name || track.id);
  }, [activeTracks, enabledSessionTracks, isWebTrackLimitExceeded]);

  const activeEngineTracks = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    return activeTracks.map((track) => ({
      ...track,
      // Keep the canonical source URL for the native engine. The Swift plugin
      // receives nativeUrl/iosUrl/optimizedUrl too and chooses the best asset.
      url: isIOSNativeEngineSurface
        ? track.url || track.nativeUrl || track.iosUrl || track.optimizedUrl
        : resolveFetchableAudioUrl(track.optimizedUrl || track.url, { origin }) || track.url,
      outputRoute: trackOutputRoutes[track.id] ?? resolveTrackOutputRoute(track),
    }));
  }, [activeTracks, isIOSNativeEngineSurface, trackOutputRoutes]);

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
  const canUseStemsToolbar = sessionTracks.length > 1 && activeTracks.length > 0;
  const areAllActiveTracksMuted =
    hasTrackSession && activeTracks.length > 0 && activeTracks.every((track) => mutedTrackIds.has(track.id));
  const isStemsToolbarActive = canToggleTrackLoad
    ? enabledSessionTracks.length !== sessionTracks.length
    : areAllActiveTracksMuted;
  const useWideTrackLoadModal = !isPortrait;
  const showSectionsPanel = surfaceView === 'sections';
  const displayBpm = Number.isFinite(Number(bpm)) ? Math.max(0, Math.round(Number(bpm))) : 0;
  const songCardTitle = songTitle || currentSessionLabel;
  const performerLabel = isEnsayoMode
    ? String(title || '').replace(/^Modo Ensayo\s*[-·]?\s*/i, '').trim()
    : title
      ?.replace(/^Live Director\s*-\s*/i, '')
      .replace(/^Audio Lab\s*[-·]\s*/i, '')
      .trim() || '';
  const songCardMeta = isEnsayoMode
    ? [subtitle, songKey].filter(Boolean).join(' · ') || sessionModeLabel
    : [performerLabel, songKey].filter(Boolean).join(' · ') || sessionModeLabel;
  const songSupportMeta = hasSessionTracks
    ? isWebTrackLimitExceeded
      ? `${activeTracks.length} de ${enabledSessionTracks.length} pistas activas (seguro ${sessionActiveTrackLimit}${shouldUseNativePadBridge ? ' + pad' : ''})`
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

  const getSectionIndexAtTime = useCallback((timeInSeconds: number) => {
    const safeTime = Math.max(0, Number(timeInSeconds) || 0);
    const nextIndex = resolvedSections.findIndex(
      (section) => safeTime >= section.startTime && safeTime < section.endTime,
    );

    if (nextIndex !== -1) {
      return nextIndex;
    }

    if (safeTime >= sectionTimelineDuration && resolvedSections.length > 0) {
      return resolvedSections.length - 1;
    }

    return 0;
  }, [resolvedSections, sectionTimelineDuration]);

  const getSectionLaneProgressPxAtTime = useCallback((timeInSeconds: number) => {
    const safeTime = Math.max(0, Number(timeInSeconds) || 0);

    if (sectionLaneSegments.length === 0) {
      return safeTime * SECTION_LANE_PIXELS_PER_SECOND;
    }

    const timeSectionIndex = getSectionIndexAtTime(safeTime);
    const activeSegment = sectionLaneSegments[timeSectionIndex] || sectionLaneSegments[0];

    if (safeTime <= activeSegment.section.startTime) {
      return activeSegment.leftPx;
    }

    if (safeTime >= sectionTimelineDuration) {
      const lastSegment = sectionLaneSegments[sectionLaneSegments.length - 1];
      const overflowDuration = Math.max(
        0,
        Math.min(safeTime, playbackTimelineDuration) - sectionTimelineDuration,
      );
      return lastSegment.leftPx + lastSegment.widthPx + overflowDuration * SECTION_LANE_PIXELS_PER_SECOND;
    }

    const sectionDuration = Math.max(
      0.001,
      activeSegment.section.endTime - activeSegment.section.startTime,
    );
    const progressWithinSection = clamp(
      (safeTime - activeSegment.section.startTime) / sectionDuration,
      0,
      1,
    );

    return activeSegment.leftPx + activeSegment.widthPx * progressWithinSection;
  }, [getSectionIndexAtTime, playbackTimelineDuration, sectionLaneSegments, sectionTimelineDuration]);

  const progressPercent = playbackTimelineDuration > 0 ? clamp(currentTime / playbackTimelineDuration, 0, 1) * 100 : 0;

  const stopPassiveTelemetryLoop = useCallback(() => {
    if (passiveTelemetryFrameRef.current !== null) {
      window.cancelAnimationFrame(passiveTelemetryFrameRef.current);
      passiveTelemetryFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!passiveStreamingTelemetryEnabled || !isPlaying) {
      stopPassiveTelemetryLoop();
      return undefined;
    }

    passiveFpsMonitorRef.current = {
      lastSampleAt: 0,
      frames: 0,
      lowSamples: 0,
      lastAlertAt: 0,
    };

    const drawPassiveTelemetry = (frameTime: number) => {
      const fpsMonitor = passiveFpsMonitorRef.current;
      if (fpsMonitor.lastSampleAt <= 0) {
        fpsMonitor.lastSampleAt = frameTime;
        fpsMonitor.frames = 0;
      } else {
        fpsMonitor.frames += 1;
        const elapsedMs = frameTime - fpsMonitor.lastSampleAt;

        if (elapsedMs >= 1000) {
          const fps = (fpsMonitor.frames * 1000) / elapsedMs;
          fpsMonitor.frames = 0;
          fpsMonitor.lastSampleAt = frameTime;
          fpsMonitor.lowSamples = fps < 30 ? fpsMonitor.lowSamples + 1 : 0;

          if (
            fpsMonitor.lowSamples >= 2 &&
            frameTime - fpsMonitor.lastAlertAt >= 5000
          ) {
            fpsMonitor.lastAlertAt = frameTime;
            console.warn('[LiveDirector][streaming:ui-throttling]', {
              reason: 'UI Throttling',
              fps: Math.round(fps * 10) / 10,
              lowSamples: fpsMonitor.lowSamples,
              activeTrackCount: activeTracks.length,
            });
          }
        }
      }

      const telemetry = getSharedTelemetry();

      if (telemetry) {
        const nextTime = readStableStreamingTelemetryTime(telemetry);
        const duration = Math.max(playbackTimelineDuration, nextTime, 0.001);
        const progress = hasTrackSession ? clamp(nextTime / duration, 0, 1) * 100 : 0;

        passiveCurrentTimeRef.current = nextTime;
        if (
          visualSectionTimeRef.current !== null &&
          Math.abs(nextTime - visualSectionTimeRef.current) < 0.25
        ) {
          visualSectionTimeRef.current = null;
          setVisualSectionTimeState(null);
        }

        if (passiveClockTextRef.current) {
          passiveClockTextRef.current.textContent = formatClock(nextTime);
        }
        if (passiveCompactClockTextRef.current) {
          passiveCompactClockTextRef.current.textContent = `${formatCompact(nextTime)} / ${formatCompact(duration)}`;
        }
        if (passiveProgressTextRef.current) {
          passiveProgressTextRef.current.textContent = `${formatCompact(nextTime)} / ${formatCompact(duration)}`;
        }
        if (passiveProgressBarRef.current) {
          passiveProgressBarRef.current.style.transform = `scaleX(${Math.max(hasTrackSession ? progress / 100 : 0, hasTrackSession ? 0.04 : 0)})`;
        }

        if (passiveMinimapPlayheadRef.current) {
          const minimapWidth = passiveMinimapPlayheadRef.current.parentElement?.clientWidth || 0;
          passiveMinimapPlayheadRef.current.style.left = '0px';
          passiveMinimapPlayheadRef.current.style.transform = `translate3d(${minimapWidth * (progress / 100)}px, 0, 0)`;
        }

        if (showSectionsPanel) {
          const progressPx = getSectionLaneProgressPxAtTime(nextTime);
          const activeSectionIndex = getSectionIndexAtTime(nextTime);
          const scrollContainer = sectionsLaneScrollRef.current;

          if (scrollContainer && !isUserScrollingSectionsRef.current) {
            const maxScrollLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
            const targetScrollLeft = clamp(progressPx, 0, maxScrollLeft);

            if (Math.abs(scrollContainer.scrollLeft - targetScrollLeft) > 0.5) {
              scrollContainer.scrollLeft = targetScrollLeft;
            }
          }

          for (let index = 0; index < sectionLaneSegments.length; index += 1) {
            const segment = sectionLaneSegments[index];
            const element = passiveSectionPlayheadRefs.current.get(segment.section.id);

            if (!element) {
              continue;
            }

            if (index === activeSectionIndex) {
              const x = clamp(progressPx - segment.leftPx - 1, 0, Math.max(0, segment.widthPx - 2));
              element.style.transform = `translate3d(${x}px, 0, 0)`;
              element.style.opacity = '1';
              element.style.backgroundColor = `${segment.section.accent}cc`;
              element.style.boxShadow = `0 0 14px ${segment.section.accent}66`;
              element.style.willChange = 'transform';
            } else if (element.style.opacity !== '0') {
              element.style.opacity = '0';
              element.style.backgroundColor = 'transparent';
              element.style.boxShadow = 'none';
              element.style.willChange = 'auto';
            }
          }
        }

        for (let index = 0; index < telemetry.trackIds.length; index += 1) {
          const trackId = telemetry.trackIds[index];
          const element = passiveMixerLevelRefs.current.get(trackId);
          if (!element) continue;

          const level = clamp(telemetry.levels[index] || 0);
          const levelScale = level > 0.002 ? Math.min(1, 0.08 + Math.pow(level, 0.72) * 0.92) : 0;
          element.style.setProperty('--ld-vu-level', levelScale.toFixed(4));
        }
      }

      passiveTelemetryFrameRef.current = window.requestAnimationFrame(drawPassiveTelemetry);
    };

    stopPassiveTelemetryLoop();
    passiveTelemetryFrameRef.current = window.requestAnimationFrame(drawPassiveTelemetry);

    return stopPassiveTelemetryLoop;
  }, [
    getSharedTelemetry,
    hasTrackSession,
    isPlaying,
    activeTracks.length,
    getSectionIndexAtTime,
    getSectionLaneProgressPxAtTime,
    passiveStreamingTelemetryEnabled,
    playbackTimelineDuration,
    sectionLaneSegments,
    showSectionsPanel,
    stopPassiveTelemetryLoop,
  ]);

  useEffect(() => () => {
    stopPassiveTelemetryLoop();
  }, [stopPassiveTelemetryLoop]);

  const stopChordDomClock = useCallback(() => {
    if (chordClockFrameRef.current !== null) {
      window.cancelAnimationFrame(chordClockFrameRef.current);
      chordClockFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!hasTrackSession || !isPlaying) {
      stopChordDomClock();
      activeChordLineRef.current?.classList.remove('active-chord-line', 'is-active-line');
      activeChordSectionRef.current?.classList.remove('active-chord-section', 'is-active-section');
      activeChordLineRef.current = null;
      activeChordSectionRef.current = null;
      lastChordScrollKeyRef.current = '';
      return undefined;
    }

    const findActiveTimedElement = (
      nodes: NodeListOf<HTMLElement>,
      nowSeconds: number,
      startAttribute: string,
      endAttribute: string,
    ) => {
      let fallback: HTMLElement | null = null;
      let fallbackStart = Number.NEGATIVE_INFINITY;

      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const start = Number(node.dataset[startAttribute] || node.getAttribute(`data-${startAttribute}`));
        const end = Number(node.dataset[endAttribute] || node.getAttribute(`data-${endAttribute}`));

        if (!Number.isFinite(start)) {
          continue;
        }

        if (nowSeconds >= start && (!Number.isFinite(end) || nowSeconds < end)) {
          return node;
        }

        if (start <= nowSeconds && start > fallbackStart) {
          fallback = node;
          fallbackStart = start;
        }
      }

      return fallback;
    };

    const applyActiveClass = (
      previous: HTMLElement | null,
      next: HTMLElement | null,
      activeClass: string,
      aliasClass: string,
    ) => {
      if (previous === next) {
        return previous;
      }

      previous?.classList.remove(activeClass, aliasClass);
      next?.classList.add(activeClass, aliasClass);
      return next;
    };

    const tickChordClock = () => {
      const root = liveDirectorRootRef.current;

      if (root) {
        const nowSeconds = visualClockReaderRef.current();
        const lineNodes = root.querySelectorAll<HTMLElement>('[data-live-chord-line="true"]');
        const sectionNodes = root.querySelectorAll<HTMLElement>('[data-live-chord-section="true"]');
        const nextLine = findActiveTimedElement(lineNodes, nowSeconds, 'liveLineStart', 'liveLineEnd');
        const nextSection = findActiveTimedElement(sectionNodes, nowSeconds, 'liveSectionStart', 'liveSectionEnd');

        activeChordLineRef.current = applyActiveClass(
          activeChordLineRef.current,
          nextLine,
          'active-chord-line',
          'is-active-line',
        );
        activeChordSectionRef.current = applyActiveClass(
          activeChordSectionRef.current,
          nextSection,
          'active-chord-section',
          'is-active-section',
        );

        const scrollTarget = nextLine;
        const scrollKey =
          scrollTarget?.dataset.liveCueId ||
          scrollTarget?.dataset.liveSectionIndex ||
          '';

        if (scrollTarget && scrollKey && scrollKey !== lastChordScrollKeyRef.current) {
          lastChordScrollKeyRef.current = scrollKey;
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }
      }

      chordClockFrameRef.current = window.requestAnimationFrame(tickChordClock);
    };

    stopChordDomClock();
    chordClockFrameRef.current = window.requestAnimationFrame(tickChordClock);

    return stopChordDomClock;
  }, [hasTrackSession, isPlaying, stopChordDomClock]);

  useEffect(() => () => {
    stopChordDomClock();
  }, [stopChordDomClock]);

  const sectionVisualTime = visualSectionTime ?? currentTime;
  const activeSectionIndex = useMemo(
    () => getSectionIndexAtTime(sectionVisualTime),
    [getSectionIndexAtTime, sectionVisualTime],
  );
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
    const seconds = nextSection.startTime - sectionVisualTime;
    if (seconds <= 0 || seconds > NEXT_SECTION_LOOKAHEAD_S) {
      return null;
    }
    return {
      name: nextSection.name || `Seccion ${activeSectionIndex + 2}`,
      seconds: Math.max(1, Math.ceil(seconds)),
    };
  }, [activeSectionIndex, isPlaying, resolvedSections, sectionVisualTime]);

  const sectionLaneProgressPx = useMemo(
    () => getSectionLaneProgressPxAtTime(sectionVisualTime),
    [getSectionLaneProgressPxAtTime, sectionVisualTime],
  );

  const releaseSectionsAutoFollowNow = useCallback(() => {
    isUserScrollingSectionsRef.current = false;
    sectionsAutoFollowShouldSmoothRef.current = false;
    if (resumeSectionsAutoScrollTimeoutRef.current !== null) {
      window.clearTimeout(resumeSectionsAutoScrollTimeoutRef.current);
      resumeSectionsAutoScrollTimeoutRef.current = null;
    }
    keyboardSectionIndexRef.current = null;
    setKeyboardSectionIndex(null);
    setSectionsAutoFollowStatus('auto');
  }, []);

  const snapSectionsLaneToTime = useCallback((nextTime: number) => {
    const scrollContainer = sectionsLaneScrollRef.current;
    if (!scrollContainer) {
      return;
    }

    const maxScrollLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
    const targetScrollLeft = clamp(getSectionLaneProgressPxAtTime(nextTime), 0, maxScrollLeft);
    scrollContainer.scrollLeft = targetScrollLeft;
    setSectionsLaneScrollLeft(targetScrollLeft);
  }, [getSectionLaneProgressPxAtTime]);

  const primeSectionVisuals = useCallback((targetTime: number) => {
    const safeTargetTime = Math.max(0, Number(targetTime) || 0);
    setVisualSectionTime(safeTargetTime);
    passiveCurrentTimeRef.current = safeTargetTime;
    releaseSectionsAutoFollowNow();
    snapSectionsLaneToTime(safeTargetTime);
  }, [releaseSectionsAutoFollowNow, setVisualSectionTime, snapSectionsLaneToTime]);

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

  const omittedWarningByTrackId = useMemo(() => {
    const warningMap = new Map<string, MultitrackEngineLoadWarning>();
    (loadWarnings || []).forEach((warning) => {
      if (warning.trackId && warning.reason !== 'synthetic-click') {
        warningMap.set(warning.trackId, warning);
      }
    });
    return warningMap;
  }, [loadWarnings]);

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
      const omittedWarning = omittedWarningByTrackId.get(track.id);
      const outputRoute = trackOutputRoutes[track.id] ?? resolveTrackOutputRoute(track);
      const showRouteFlip = isGuideRoutingTrack(track);
      const volume = trackVolumes[track.id] ?? track.volume ?? meta.defaultVolume;
      const muted = omittedWarning ? false : mutedTrackIds.has(track.id);
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
        level: omittedWarning || muted || dimmed ? 0 : rawLevel,
        muted,
        soloed: omittedWarning ? false : soloTrackId === track.id,
        dimmed,
        disabled: activeTracks.length === 0 || Boolean(omittedWarning),
        disabledReason: omittedWarning
          ? omittedWarning.reason === 'unsupported-format'
            ? 'Formato incompatible'
            : 'Pista omitida'
          : undefined,
        disabledTitle: omittedWarning?.message,
        outputRoute,
        showRouteFlip,
      };
    });

    if (resolvedPadUrl || isPadActive) {
      const padEnvelope = trackEnvelopes[INTERNAL_PAD_TRACK_ID];
      const padEnvelopeLevel = isPlaying && isPadActive
        ? sampleActivityEnvelope(padEnvelope, currentTime)
        : 0;
      const padTrack: MixerTrackView = {
        id: INTERNAL_PAD_TRACK_ID,
        label: 'Pad tonal',
        shortLabel: 'PAD',
        accent: '#43c477',
        defaultVolume: resolvedInternalPadVolume,
        volume: resolvedInternalPadVolume,
        level: padEnvelopeLevel,
        muted: !isPadActive || resolvedInternalPadVolume <= 0.001,
        soloed: false,
        dimmed: false,
        disabled: false,
        disabledReason: undefined,
        disabledTitle: undefined,
        outputRoute: 'stereo' as TrackOutputRoute,
        showRouteFlip: false,
      };

      let insertIdx = -1;
      resolvedMixerTracks.forEach((track, index) => {
        const haystack = `${track.id} ${track.label} ${track.shortLabel}`.toLowerCase();
        if (/(click|metro|metronom|cue|cues|gu[ií]a|guide|count)/i.test(haystack)) {
          insertIdx = index;
        }
      });
      if (insertIdx !== -1) {
        resolvedMixerTracks.splice(insertIdx + 1, 0, padTrack);
      } else {
        resolvedMixerTracks.push(padTrack);
      }
    }

    return resolvedMixerTracks;
  }, [activeTracks, currentTime, isPadActive, isPlaying, mutedTrackIds, omittedWarningByTrackId, resolvedInternalPadVolume, resolvedPadUrl, soloTrackId, trackEnvelopes, trackLevels, trackOutputRoutes, trackVolumes]);

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
      setShowStemsActionModal(false);
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
    if (!showSectionsPanel) {
      releaseSectionsAutoFollowNow();
      return;
    }
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
  }, [releaseSectionsAutoFollowNow, showSectionsPanel]);

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
      setQueueSongCoverArtMap((previous) => (
        Object.keys(previous).length === 0 ? previous : {}
      ));
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
    if (!isIOSNativeEngineSurface || !isNativeLiveDirectorEngineAvailable()) {
      return undefined;
    }

    void NativeLiveDirectorEngine.lockLandscape().catch(() => undefined);

    return () => {
      void NativeLiveDirectorEngine.unlockOrientation().catch(() => undefined);
    };
  }, [isIOSNativeEngineSurface]);

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
      if (!hasResolvedEngineCapability) {
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

      const disabledCount = Math.max(0, sessionTracks.length - enabledSessionTracks.length);
      console.info(
        `[LiveDirectorView] Loading ${activeTracks.length}/${enabledSessionTracks.length} enabled tracks${shouldUseNativePadBridge ? ' + pad bridge' : ''}` +
          (isWebTrackLimitExceeded ? ` (above recommended ${sessionActiveTrackLimit}-stem threshold).` : '') +
          (disabledCount > 0 ? ` (${disabledCount} already disabled).` : '.'),
      );

      try {
        await initializeEngineRef.current(activeEngineTracks);
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
      stopEngineRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSignature, hasResolvedEngineCapability, isIOSNativeEngineSurface, isWebTrackLimitExceeded, reloadKey, sessionActiveTrackLimit, useStreamingEngine]);

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
  const hasRecoveredSyntheticClick = Boolean(
    loadWarnings?.some((warning) => warning.reason === 'synthetic-click')
  );
  const unsupportedFormatWarnings = useMemo(
    () => loadWarnings?.filter((warning) => warning.reason === 'unsupported-format') || [],
    [loadWarnings],
  );
  const hasUnsupportedStemFormat = unsupportedFormatWarnings.length > 0;
  const showTrackLimitNotice = Boolean(
    trackLimitNotice && dismissedTrackLimitNoticeKey !== trackLimitNotice.key
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

  const handleToggleCongregationFade = useCallback(() => {
    if (
      !hasTrackSession ||
      !isReady ||
      isTransportCueBusyRef.current ||
      sectionSeekInFlightRef.current
    ) {
      return;
    }

    const nextMuted = !congregationMutedRef.current;
    const transitionToken = sectionTransitionTokenRef.current + 1;
    congregationMutedRef.current = nextMuted;
    sectionTransitionTokenRef.current = transitionToken;
    isSectionTransitioningRef.current = true;
    setCongregationFadeState(nextMuted ? 'fading-out' : 'fading-in');

    void (async () => {
      await fadeMasterVolume(
        nextMuted ? 0 : masterVolumeRef.current,
        CONGREGATION_FADE_MS,
        transitionToken,
      );

      if (sectionTransitionTokenRef.current !== transitionToken) {
        return;
      }

      const finalVolume = nextMuted ? 0 : masterVolumeRef.current;
      isSectionTransitioningRef.current = false;
      applyMasterVolume(finalVolume);
      setCongregationFadeState(nextMuted ? 'muted' : 'normal');
    })();
  }, [applyMasterVolume, fadeMasterVolume, hasTrackSession, isReady]);

  useEffect(() => {
    masterVolumeRef.current = masterVolume;

    if (!isSectionTransitioningRef.current) {
      stopMasterVolumeFade();
      applyMasterVolume(congregationMutedRef.current ? 0 : masterVolume);
    }
  }, [applyMasterVolume, masterVolume, stopMasterVolumeFade]);

  useEffect(() => {
    sectionTransitionTokenRef.current += 1;
    congregationMutedRef.current = false;
    isSectionTransitioningRef.current = false;
    setCongregationFadeState('normal');
    stopMasterVolumeFade();
    applyMasterVolume(masterVolumeRef.current);
  }, [applyMasterVolume, stopMasterVolumeFade, trackSignature]);

  useEffect(() => () => {
    sectionTransitionTokenRef.current += 1;
    isSectionTransitioningRef.current = false;
    stopMasterVolumeFade();
  }, [stopMasterVolumeFade]);

  const handleSectionSeek = useCallback(async (nextTime: number) => {
    if (!hasTrackSession || isCongregationFading) {
      return;
    }

    if (loopEnabled) {
      await configureLoopRegion(0, 0, false).catch(() => undefined);
    }

    releaseSectionsAutoFollowNow();
    const firstTargetTime = Math.max(0, nextTime);
    const wasPlayingBeforeSectionSeek = isPlaying;
    const playbackTimeBeforeFirstPrime = getLivePlaybackTime();
    if (wasPlayingBeforeSectionSeek) {
      setVisualSectionTime(null);
    } else {
      primeSectionVisuals(firstTargetTime);
    }

    if (sectionSeekInFlightRef.current) {
      pendingSectionSeekTargetRef.current = firstTargetTime;
      pendingSectionSeekWasPlayingRef.current = wasPlayingBeforeSectionSeek;
      setIsSectionSeekBusy(true);
      return;
    }

    sectionSeekInFlightRef.current = true;
    setIsSectionSeekBusy(true);

    try {
      let targetTime: number | null = firstTargetTime;
      let targetWasPlaying = wasPlayingBeforeSectionSeek;
      let comparisonPlaybackTime = playbackTimeBeforeFirstPrime;

      while (targetTime !== null) {
        const activeTargetTime = targetTime;
        const activeWasPlaying = targetWasPlaying;
        const activeComparisonPlaybackTime = comparisonPlaybackTime;
        pendingSectionSeekTargetRef.current = null;
        pendingSectionSeekWasPlayingRef.current = null;
        if (!activeWasPlaying) {
          primeSectionVisuals(activeTargetTime);
        }

        if (!isReady || !isPlaying) {
          await seekTo(activeTargetTime, { wasPlayingBeforeUiSeek: activeWasPlaying });
        } else if (Math.abs(activeComparisonPlaybackTime - activeTargetTime) >= 0.05) {
          const transitionToken = sectionTransitionTokenRef.current + 1;
          sectionTransitionTokenRef.current = transitionToken;
          isSectionTransitioningRef.current = true;

          try {
            await fadeMasterVolume(0, SECTION_TRANSITION_FADE_OUT_MS, transitionToken);
            if (sectionTransitionTokenRef.current !== transitionToken) {
              return;
            }

            await seekTo(activeTargetTime, { wasPlayingBeforeUiSeek: activeWasPlaying });
            if (sectionTransitionTokenRef.current !== transitionToken) {
              return;
            }

            const restoredVolume = congregationMutedRef.current ? 0 : masterVolumeRef.current;
            await fadeMasterVolume(restoredVolume, SECTION_TRANSITION_FADE_IN_MS, transitionToken);
          } finally {
            if (sectionTransitionTokenRef.current === transitionToken) {
              isSectionTransitioningRef.current = false;
              applyMasterVolume(congregationMutedRef.current ? 0 : masterVolumeRef.current);
            }
          }
        }

        const queuedTarget = pendingSectionSeekTargetRef.current;
        if (queuedTarget !== null && Math.abs(queuedTarget - activeTargetTime) >= 0.02) {
          targetWasPlaying = pendingSectionSeekWasPlayingRef.current ?? isPlaying;
          comparisonPlaybackTime = activeTargetTime;
          targetTime = queuedTarget;
        } else {
          targetTime = null;
        }
      }
    } catch (error) {
      console.warn('[LiveDirectorView] Section seek failed.', error);
    } finally {
      pendingSectionSeekTargetRef.current = null;
      pendingSectionSeekWasPlayingRef.current = null;
      sectionSeekInFlightRef.current = false;
      setIsSectionSeekBusy(false);
    }
  }, [
    applyMasterVolume,
    configureLoopRegion,
    fadeMasterVolume,
    getLivePlaybackTime,
    hasTrackSession,
    isCongregationFading,
    isPlaying,
    isReady,
    loopEnabled,
    primeSectionVisuals,
    releaseSectionsAutoFollowNow,
    seekTo,
    setVisualSectionTime,
  ]);

  const handleReturnToStart = useCallback(async () => {
    if (
      !hasTrackSession ||
      isTransportCueBusyRef.current ||
      isCongregationFading ||
      (DISABLE_BACKWARD_SEEK_WHILE_PLAYING && isPlaying)
    ) {
      return;
    }

    isTransportCueBusyRef.current = true;
    setIsReturnToStartBusy(true);
    if (!isPlaying) {
      primeSectionVisuals(0);
    }

    try {
      if (loopEnabled) {
        await configureLoopRegion(0, 0, false).catch(() => undefined);
      }
      await seekTo(0, { forceFreshStart: true });
    } catch (error) {
      console.warn('[LiveDirectorView] Return to start failed.', error);
    } finally {
      isTransportCueBusyRef.current = false;
      setIsReturnToStartBusy(false);
    }
  }, [configureLoopRegion, hasTrackSession, isCongregationFading, isPlaying, loopEnabled, primeSectionVisuals, seekTo]);

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
      if (isPadActive) {
        if (activePadChannelRef.current === 'A') {
          padFadeTargetRefA.current = effectiveInternalPadVolume;
          padFadeTargetRefB.current = 0;
        } else {
          padFadeTargetRefB.current = effectiveInternalPadVolume;
          padFadeTargetRefA.current = 0;
        }
      } else {
        padFadeTargetRefA.current = 0;
        padFadeTargetRefB.current = 0;
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
    const FADE_DURATION_MS = INTERNAL_PAD_CROSSFADE_MS;

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

  const commitSectionOffset = useCallback(async (): Promise<boolean> => {
    if (!hasPersistedSongContext || !manualSession) {
      return true;
    }

    const safeOffset = Number(manualSession.sectionOffsetSeconds) || 0;

    try {
      setSectionOffsetSaveError(null);
      setBusyMessage('Guardando desplazamiento de secciones...');
      const savedSession = await enqueueSessionSave(() => saveLiveDirectorSectionOffset({
        songId,
        sectionOffsetSeconds: safeOffset,
      }));
      const savedOffset = Number.isFinite(Number(savedSession.sectionOffsetSeconds))
        ? Number(savedSession.sectionOffsetSeconds)
        : safeOffset;
      setManualSession((previous) => (
        previous ? { ...previous, sectionOffsetSeconds: savedOffset } : previous
      ));
      onSessionPersisted?.(savedSession);
      return true;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'No se pudo guardar el offset de secciones.';
      console.warn('[LiveDirectorView] Section offset save failed.', error);
      setSectionOffsetSaveError(message);
      return false;
    } finally {
      setBusyMessage(null);
    }
  }, [enqueueSessionSave, hasPersistedSongContext, manualSession, onSessionPersisted, songId]);

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

  useEffect(() => {
    if (!hasSessionTracks || !isWebTrackLimitExceeded || autoDisabledTrackNames.length === 0) {
      setTrackLimitNotice(null);
      return;
    }

    const key = `${sessionActiveTrackLimit}:${autoDisabledTrackNames.join('|')}`;
    setTrackLimitNotice({
      key,
      names: autoDisabledTrackNames,
      limit: sessionActiveTrackLimit,
      total: enabledSessionTracks.length,
    });
    setDismissedTrackLimitNoticeKey((previous) => (previous === key ? previous : null));
  }, [autoDisabledTrackNames, enabledSessionTracks.length, hasSessionTracks, isWebTrackLimitExceeded, sessionActiveTrackLimit]);

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

  const capEnabledMapToTrackLimit = useCallback((enabledMap: Record<string, boolean>) => {
    const nextMap: Record<string, boolean> = {};
    const rankedTracks = sessionTracks
      .filter((track) => enabledMap[track.id] !== false)
      .map((track, index) => ({ track, index, rank: stemPriorityRank(track) }))
      .sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
    const allowedIds = new Set(rankedTracks.slice(0, sessionActiveTrackLimit).map(({ track }) => track.id));

    sessionTracks.forEach((track) => {
      nextMap[track.id] = enabledMap[track.id] !== false && allowedIds.has(track.id);
    });

    return nextMap;
  }, [sessionActiveTrackLimit, sessionTracks]);

  const handleCancelTrackLoadModal = useCallback(() => {
    setPendingEnabledMap(null);
    setShowTrackLoadModal(false);
  }, []);

  const handleApplyTrackLoadModal = useCallback(() => {
    if (pendingEnabledMap && manualSession) {
      const cappedEnabledMap = capEnabledMapToTrackLimit(pendingEnabledMap);
      const nextTracks = manualSession.tracks.map((track) => {
        const wantsEnabled = cappedEnabledMap[track.id] !== false;
        return {
          ...track,
          enabled: wantsEnabled,
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
  }, [capEnabledMapToTrackLimit, pendingEnabledMap, manualSession, hasPersistedSongContext, commitMixerStateSilent]);

  const handleOpenTrackLoadModal = useCallback(() => {
    const initial: Record<string, boolean> = {};
    (manualSession?.tracks || []).forEach((track) => { initial[track.id] = track.enabled !== false; });
    setPendingEnabledMap(capEnabledMapToTrackLimit(initial));
    setShowStemsActionModal(false);
    setShowTrackLoadModal(true);
  }, [capEnabledMapToTrackLimit, manualSession?.tracks]);

  const handleOpenStemsLoader = useCallback(() => {
    setShowStemsActionModal(false);
    setShowTrackLoadModal(false);
    setLoaderMode('folder');
    setShowLoadPanel(true);
  }, []);

  const handleOpenOffsetModal = useCallback(() => {
    setSectionOffsetSaveError(null);
    offsetModalInitialValueRef.current = Number.isFinite(Number(manualSession?.sectionOffsetSeconds))
      ? Number(manualSession?.sectionOffsetSeconds)
      : 0;
    setShowOffsetModal(true);
  }, [manualSession?.sectionOffsetSeconds]);

  const handleCloseOffsetModal = useCallback(async () => {
    const currentOffset = Number.isFinite(Number(manualSession?.sectionOffsetSeconds))
      ? Number(manualSession?.sectionOffsetSeconds)
      : 0;

    if (offsetModalInitialValueRef.current !== null && offsetModalInitialValueRef.current !== currentOffset) {
      const saved = await commitSectionOffset();
      if (!saved) {
        return;
      }
    }
    setShowOffsetModal(false);
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
    if (
      !hasTrackSession ||
      isTransportCueBusy ||
      isCongregationFading
    ) {
      return;
    }

    if (resolvedSections.length === 0) {
      void handleSectionSeek(0);
      return;
    }

    const currentSection = resolvedSections[activeSectionIndex];
    if (currentSection && (getLivePlaybackTime() - currentSection.startTime > 2.5)) {
      void handleSectionSeek(currentSection.startTime);
      return;
    }

    const targetIndex = Math.max(0, activeSectionIndex - 1);
    const targetSection = resolvedSections[targetIndex];
    void handleSectionSeek(targetSection?.startTime ?? 0);
  };

  const handleNextSection = () => {
    if (!hasTrackSession || isTransportCueBusy || isCongregationFading) {
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

  const handleToggleLoop = async () => {
    if (loopPreparing) {
      return;
    }

    if (loopEnabled) {
      await configureLoopRegion(0, 0, false).catch(() => undefined);
      return;
    }

    const start = activeSection
      ? activeSection.startTime
      : clamp(currentTime, 0, playbackTimelineDuration);
    const end = activeSection
      ? activeSection.endTime
      : Math.min(playbackTimelineDuration, start + 8);
    await configureLoopRegion(start, end, true).catch(() => undefined);
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

  const handleToggleAllActiveStems = () => {
    if (!hasTrackSession) {
      return;
    }

    const nextMuteAll = !areAllActiveTracksMuted;
    activeTracks.forEach((track) => {
      const currentlyMuted = mutedTrackIds.has(track.id);
      if (nextMuteAll !== currentlyMuted) {
        toggleMute(track.id);
      }
    });
    setMutedTrackIds(nextMuteAll ? new Set(activeTracks.map((track) => track.id)) : new Set());
  };

  const handleStemsToolbarAction = () => {
    if (!canUseStemsToolbar) {
      return;
    }

    if (canToggleTrackLoad) {
      setShowStemsActionModal(true);
      return;
    }

    handleToggleAllActiveStems();
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

  const handleInternalPadVolumeChange = useCallback((nextVolume: number) => {
    const safeValue = clamp(nextVolume, 0, 1);

    setInternalPadVolumeState(safeValue);

    if (typeof onInternalPadVolumeChange === 'function') {
      onInternalPadVolumeChange(safeValue);
    }
  }, [onInternalPadVolumeChange]);

  useEffect(() => {
    if (!resolvedPadUrl && isPadActive && !isIOSNativeEngineSurface) {
      setIsPadActive(false);
    }
  }, [isIOSNativeEngineSurface, isPadActive, resolvedPadUrl]);

  useEffect(() => {
    if (!isIOSNativeEngineSurface || !isNativeLiveDirectorEngineAvailable()) {
      return;
    }

    if (!shouldUseNativePadBridge || !resolvedPadUrl) {
      if (!isPadActive) {
        void NativeLiveDirectorEngine.stopPad({ fadeSeconds: INTERNAL_PAD_CROSSFADE_SECONDS }).catch((error) => {
          console.warn('[LiveDirectorView] Native pad bridge stop failed.', error);
        });
      }
      return;
    }

    void NativeLiveDirectorEngine.setPad({
      url: resolvedPadUrl,
      active: isPadActive,
      volume: effectiveInternalPadVolume,
      fadeSeconds: INTERNAL_PAD_CROSSFADE_SECONDS,
    }).catch((error) => {
      console.warn('[LiveDirectorView] Native pad bridge failed.', error);
      setIsPadActive(false);
    });
  }, [effectiveInternalPadVolume, isIOSNativeEngineSurface, isPadActive, resolvedPadUrl, shouldUseNativePadBridge]);

  useEffect(() => () => {
    if (!isNativeLiveDirectorEngineAvailable()) {
      return;
    }

    void NativeLiveDirectorEngine.stopPad({ fadeSeconds: 0 }).catch(() => undefined);
  }, []);

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

    if (container && dragState.captured && dragState.pointerId !== null) {
      try {
        container.releasePointerCapture(dragState.pointerId);
      } catch {
        // no-op
      }
    }

    mixerDragStateRef.current = {
      active: false,
      captured: false,
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
      captured: true,
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
      keyboardSectionIndexRef.current = null;
      setKeyboardSectionIndex(null);
      setVisualSectionTime(null);
      setSectionsAutoFollowStatus('auto');
    }, SECTIONS_AUTO_FOLLOW_RESUME_MS);
  }, [setVisualSectionTime]);

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (
        showLoadPanel ||
        showStemsActionModal ||
        showTrackLoadModal ||
        showOffsetModal ||
        showBackConfirm
      ) {
        return;
      }

      const desktopSectionKeyboardEnabled =
        !isNativeIosShell &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      const isLeftSectionArrow = event.key === 'ArrowLeft' || event.code === 'ArrowLeft';
      const isRightSectionArrow = event.key === 'ArrowRight' || event.code === 'ArrowRight';
      const isSectionArrow = isLeftSectionArrow || isRightSectionArrow;
      const sectionShortcutTargetBlocked = shouldIgnoreSectionKeyboardTarget(event.target);
      const globalShortcutTargetBlocked = shouldIgnoreSectionKeyboardTarget(event.target);

      if (desktopSectionKeyboardEnabled && !globalShortcutTargetBlocked) {
        if (event.code === 'BracketLeft') {
          event.preventDefault();
          handlePreviousSection();
          return;
        }

        if (event.code === 'BracketRight') {
          event.preventDefault();
          handleNextSection();
          return;
        }

        if (event.code === 'KeyV') {
          event.preventDefault();
          setSurfaceView((previous) => previous === 'mix' ? 'sections' : 'mix');
          return;
        }

        if (event.code === 'KeyL' && hasTrackSession) {
          event.preventDefault();
          handleToggleLoop();
          return;
        }

        if (event.code === 'KeyP' && resolvedPadUrl) {
          event.preventDefault();
          setIsPadActive((previous) => !previous);
          return;
        }

        if (event.code === 'KeyR' && hasTrackSession && !isTransportCueBusy && !isCongregationFading) {
          event.preventDefault();
          void handleReturnToStart();
          return;
        }

        if (event.code === 'KeyF' && hasTrackSession && isReady && !isTransportCueBusy) {
          event.preventDefault();
          handleToggleCongregationFade();
          return;
        }

        if (event.code === 'KeyS' && canUseStemsToolbar) {
          event.preventDefault();
          handleStemsToolbarAction();
          return;
        }

        if (event.code === 'KeyB') {
          event.preventDefault();
          if (isPlaying) {
            setShowBackConfirm(true);
          } else {
            void exitLiveDirector();
          }
          return;
        }
      }

      if (
        desktopSectionKeyboardEnabled &&
        !sectionShortcutTargetBlocked &&
        isSectionArrow &&
        showSectionsPanel &&
        hasTrackSession &&
        resolvedSections.length > 0 &&
        !isTransportCueBusy &&
        !isCongregationFading
      ) {
        event.preventDefault();
        const playbackSectionIndex = getSectionIndexAtTime(getLivePlaybackTime());
        const sourceIndex = keyboardSectionIndexRef.current ?? playbackSectionIndex;
        const direction = isLeftSectionArrow ? -1 : 1;
        const nextIndex = clamp(sourceIndex + direction, 0, resolvedSections.length - 1);
        const targetSection = resolvedSections[nextIndex];

        if (!targetSection) {
          return;
        }

        isUserScrollingSectionsRef.current = true;
        keyboardSectionIndexRef.current = nextIndex;
        setKeyboardSectionIndex(nextIndex);
        setVisualSectionTime(targetSection.startTime);
        snapSectionsLaneToTime(targetSection.startTime);
        scheduleSectionsAutoFollowResume();
        return;
      }

      const pendingKeyboardSectionIndex =
        keyboardSectionIndexRef.current ?? keyboardSectionIndex;

      if (
        desktopSectionKeyboardEnabled &&
        !sectionShortcutTargetBlocked &&
        (event.key === 'Enter' || event.code === 'Enter') &&
        pendingKeyboardSectionIndex !== null
      ) {
        const targetSection = resolvedSections[pendingKeyboardSectionIndex];
        if (!targetSection || isTransportCueBusy || isCongregationFading) {
          return;
        }

        event.preventDefault();
        setVisualSectionTime(null);
        releaseSectionsAutoFollowNow();
        void handleSectionSeek(targetSection.startTime);
        return;
      }

      if (
        desktopSectionKeyboardEnabled &&
        !sectionShortcutTargetBlocked &&
        (event.key === 'Escape' || event.code === 'Escape') &&
        pendingKeyboardSectionIndex !== null
      ) {
        event.preventDefault();
        setVisualSectionTime(null);
        releaseSectionsAutoFollowNow();
        return;
      }

      if (event.code !== 'Space' && event.key !== ' ') {
        return;
      }

      if (
        shouldIgnoreKeyboardShortcutTarget(event.target) ||
        !isReady ||
        isTransportCueBusy
      ) {
        return;
      }

      event.preventDefault();
      handleTogglePlaybackFromGesture();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [
    canUseStemsToolbar,
    exitLiveDirector,
    getLivePlaybackTime,
    getSectionIndexAtTime,
    handleNextSection,
    handlePreviousSection,
    handleSectionSeek,
    handleStemsToolbarAction,
    handleReturnToStart,
    handleToggleCongregationFade,
    handleToggleLoop,
    handleTogglePlaybackFromGesture,
    hasTrackSession,
    isCongregationFading,
    isNativeIosShell,
    isPlaying,
    isReady,
    isTransportCueBusy,
    keyboardSectionIndex,
    releaseSectionsAutoFollowNow,
    resolvedPadUrl,
    resolvedSections,
    scheduleSectionsAutoFollowResume,
    setVisualSectionTime,
    showBackConfirm,
    showLoadPanel,
    showOffsetModal,
    showSectionsPanel,
    showStemsActionModal,
    showTrackLoadModal,
    snapSectionsLaneToTime,
  ]);

  const endSectionsDrag = useCallback((pointerId?: number) => {
    const container = sectionsLaneScrollRef.current;
    const dragState = sectionsDragStateRef.current;

    if (!dragState.active) {
      return;
    }

    if (typeof pointerId === 'number' && dragState.pointerId !== pointerId) {
      return;
    }

    const shouldResumeAutoFollow = sectionsGestureExceededDragThresholdRef.current;

    if (container && dragState.captured && dragState.pointerId !== null) {
      try {
        container.releasePointerCapture(dragState.pointerId);
      } catch {
        // no-op
      }
    }

    sectionsDragStateRef.current = {
      active: false,
      captured: false,
      pointerId: null,
      startX: 0,
      startScrollLeft: 0,
    };

    if (shouldResumeAutoFollow) {
      // Drag finished: now start the 5s countdown to resume auto-follow.
      scheduleSectionsAutoFollowResume();
    }
  }, [scheduleSectionsAutoFollowResume]);

  const handleSectionsPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = sectionsLaneScrollRef.current;
    if (!container) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    sectionsDragStateRef.current = {
      active: true,
      captured: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
    };
    sectionsGestureExceededDragThresholdRef.current = false;
  }, []);

  const handleSectionsPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = sectionsLaneScrollRef.current;
    const dragState = sectionsDragStateRef.current;

    if (!container || !dragState.active || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) < SECTION_DRAG_CLICK_SUPPRESS_THRESHOLD_PX) return;

    if (!dragState.captured) {
      // Hold (no timeout) once a real drag starts; a plain click must reach the
      // section button without a pre-click state update cancelling it.
      holdSectionsAutoFollow();

      try {
        container.setPointerCapture(event.pointerId);
        sectionsDragStateRef.current = {
          ...dragState,
          captured: true,
        };
      } catch {
        // no-op
      }
    }

    sectionsGestureExceededDragThresholdRef.current = true;

    container.scrollLeft = dragState.startScrollLeft - deltaX;
    event.preventDefault();
  }, [holdSectionsAutoFollow]);

  const handleSectionsPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    endSectionsDrag(event.pointerId);
  }, [endSectionsDrag]);

  useEffect(() => {
    const container = sectionsLaneScrollRef.current;
    if (!container) {
      return undefined;
    }

    const handleNativeSectionPointerUp = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      if (!(event.target instanceof Element)) {
        return;
      }

      const button = event.target.closest<HTMLButtonElement>('button[data-live-chord-section="true"]');
      if (!button || !container.contains(button)) {
        return;
      }

      const shouldSuppressClick = sectionsGestureExceededDragThresholdRef.current;
      sectionsGestureExceededDragThresholdRef.current = false;
      if (shouldSuppressClick) {
        return;
      }

      const nextTime = Number(button.dataset.liveSectionStart);
      if (!Number.isFinite(nextTime)) {
        return;
      }

      event.preventDefault();
      void handleSectionSeek(nextTime);
    };

    container.addEventListener('pointerup', handleNativeSectionPointerUp);
    return () => {
      container.removeEventListener('pointerup', handleNativeSectionPointerUp);
    };
  }, [handleSectionSeek, showSectionsPanel]);

  // ─── Minimap interaction ──────────────────────────────────────────────────
  // The minimap is a tap-and-drag scrub target. We convert clientX to a time
  // via the track's bounding rect and call the same seek used by the section
  // buttons. Drag is captured so finger-outside-rect keeps scrubbing.
  const minimapTrackRef = useRef<HTMLDivElement | null>(null);
  const minimapDragActiveRef = useRef(false);
  const minimapDragPointerIdRef = useRef<number | null>(null);
  const minimapPendingSeekTimeRef = useRef<number | null>(null);
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
    minimapPendingSeekTimeRef.current = t;
    setMinimapHoverTime(t);
    event.preventDefault();
  }, [holdSectionsAutoFollow, minimapXToTime]);

  const handleMinimapPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!minimapDragActiveRef.current) return;
    if (minimapDragPointerIdRef.current !== event.pointerId) return;
    const t = minimapXToTime(event.clientX);
    minimapPendingSeekTimeRef.current = t;
    setMinimapHoverTime(t);
    event.preventDefault();
  }, [minimapXToTime]);

  const endMinimapDrag = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    if (!minimapDragActiveRef.current) return;
    const node = minimapTrackRef.current;
    if (node && event && minimapDragPointerIdRef.current === event.pointerId) {
      try { node.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    }
    minimapDragActiveRef.current = false;
    minimapDragPointerIdRef.current = null;
    minimapPendingSeekTimeRef.current = null;
    setMinimapHoverTime(null);
    // Arm the 5s resume so the big lane auto-follow eventually retakes.
    scheduleSectionsAutoFollowResume();
  }, [scheduleSectionsAutoFollowResume]);

  const handleMinimapPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const seekTime = minimapPendingSeekTimeRef.current ?? minimapXToTime(event.clientX);
    endMinimapDrag(event);
    void handleSectionSeek(seekTime);
  }, [endMinimapDrag, handleSectionSeek, minimapXToTime]);

  const handleMinimapPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    endMinimapDrag(event);
  }, [endMinimapDrag]);

  const pendingEnabledCount = pendingEnabledMap
    ? Object.values(pendingEnabledMap).filter(Boolean).length
    : activeTracks.length;

  const advancedStreamingActive = diagnostics?.engineMode === 'streaming';

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
    <div ref={liveDirectorRootRef} className={shellClassName}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(93,214,240,0.08),_transparent_24%),linear-gradient(180deg,#232526_0%,#222425_46%,#202224_100%)]" />
      <div className="relative flex h-[100dvh] flex-col overflow-hidden" style={shellContentStyle}>
        <div className={`hide-scrollbar -mx-1 shrink-0 overflow-x-auto ${isUltraCompactLandscape ? 'pb-0' : isToolbarCompactLandscape ? 'pb-0' : 'pb-1'}`}>
          <header
            className={isToolbarCompactLandscape
              ? `flex items-stretch ${isUltraCompactLandscape ? 'gap-1 px-0' : 'gap-1.5 px-0.5'}`
              : 'grid w-full items-stretch gap-0 px-1'}
            style={toolbarHeaderStyle}
          >
            <div
              data-live-director-control="status-group"
              className={`flex min-w-0 items-stretch ${isToolbarCompactLandscape ? (isUltraCompactLandscape ? 'gap-1' : 'gap-1.5') : 'justify-start gap-1.5 pr-2'}`}
            >
              <button
                type="button"
                onClick={() => {
                  if (isPlaying) {
                    setShowBackConfirm(true);
                    return;
                  }
                  void exitLiveDirector();
                }}
                data-live-director-control="back"
                className={`${CONTROL_CARD} group relative ${isUltraCompactLandscape ? 'h-11 w-11 px-1.5' : isToolbarCompactLandscape ? 'h-12 w-12 px-2' : 'h-[var(--ld-control-height)] w-[4.25rem] px-2.5'} shrink-0 items-center justify-center text-white/85 hover:bg-white/6 hover:text-white`}
                style={isToolbarCompactLandscape ? undefined : { flex: '0 0 16%', width: '16%' }}
                aria-label="Volver al repertorio"
                aria-keyshortcuts="B"
                title="Volver al repertorio (B)"
              >
                <ChevronLeft className={`${isUltraCompactLandscape ? 'h-5 w-5' : isToolbarCompactLandscape ? 'h-6 w-6' : 'h-8 w-8'}`} strokeWidth={isToolbarCompactLandscape ? 2.1 : 2.45} />
                <KeyboardHint>B</KeyboardHint>
              </button>

              <div
                data-live-director-control="bpm"
                className={`flex ${isUltraCompactLandscape ? 'h-11 rounded-[0.8rem] px-1 py-0.5' : isToolbarCompactLandscape ? 'h-12 rounded-[1rem] px-1.5 py-1' : 'h-[var(--ld-control-height)] rounded-[1.45rem] px-2 py-3'} shrink-0 flex-col items-center justify-center gap-0.5 border border-white/8 bg-black/16 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 3.05 : 3.75, 2.75) }
                  : { flex: '0 0 18%', width: '18%' }}
              >
                <span className={`font-light leading-none tracking-tight text-white/92 ${isUltraCompactLandscape ? 'text-[1.08rem]' : isToolbarCompactLandscape ? 'text-[1.4rem]' : 'text-[2.05rem]'}`}>
                  {displayBpm || '--'}
                </span>
                <div className="h-px w-full bg-white/18" />
                <span className={`${isUltraCompactLandscape ? 'text-[0.42rem]' : 'text-[0.56rem]'} font-black uppercase tracking-[0.22em] text-white/56`}>
                  {displayBpm ? 'BPM' : 'SIN BPM'}
                </span>
              </div>

              <div
                data-live-director-control="clock"
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-11 px-1.5 py-0.5' : isToolbarCompactLandscape ? 'h-12 px-2 py-1' : 'h-[var(--ld-control-height)] px-4 py-3'} shrink-0 flex-col`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 6.15 : 7.05, 5.6) }
                  : { flex: '0 0 36%', width: '36%' }}
              >
                <span ref={passiveClockTextRef} className={`font-light leading-none tracking-tight text-white ${isUltraCompactLandscape ? 'text-[1.28rem]' : isToolbarCompactLandscape ? 'text-[1.7rem]' : 'text-[2.65rem]'}`}>
                  {formatClock(currentTime)}
                </span>
                <span ref={passiveCompactClockTextRef} className={`font-medium tabular-nums text-white/58 ${isUltraCompactLandscape ? 'text-[0.56rem]' : isToolbarCompactLandscape ? 'text-[0.72rem]' : 'mt-1 text-[0.96rem]'}`}>
                  {formatCompact(currentTime)} / {formatCompact(playbackTimelineDuration)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!resolvedPadUrl) return;
                  setIsPadActive((previous) => !previous);
                }}
                disabled={!resolvedPadUrl}
                aria-pressed={isPadActive}
                data-live-director-control="pad"
                className={`${CONTROL_CARD} group relative ${isUltraCompactLandscape ? 'h-11 px-1 text-[0.6rem]' : isToolbarCompactLandscape ? 'h-12 px-2 text-[0.72rem]' : 'h-[var(--ld-control-height)] px-3 text-[0.84rem]'} shrink-0 flex-col font-semibold tracking-[0.16em] disabled:cursor-not-allowed disabled:text-white/28 ${isPadActive
                  ? 'border-cyan-300/32 bg-cyan-300/10 text-cyan-100 shadow-[0_0_16px_rgba(103,232,249,0.10)]'
                  : 'text-cyan-100/82 hover:border-cyan-300/22 hover:bg-cyan-300/7'
                  }`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 4.35 : 4.8, 3.75) }
                  : { flex: '0 0 24%', width: '24%' }}
                aria-label={isPadActive ? `Stop pad for ${songKey}` : `Play pad for ${songKey}`}
                aria-keyshortcuts="P"
                title={resolvedPadUrl ? `${isPadActive ? 'Apagar' : 'Activar'} pad (P)` : 'Pad no disponible'}
              >
                <span>PAD</span>
                <span className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.48rem]' : 'mt-1 text-[0.62rem]'} tracking-[0.2em] text-white/46`}>
                  {isPadActive ? 'ACT' : (songKey || '--')}
                </span>
                <KeyboardHint>P</KeyboardHint>
              </button>
            </div>

            {!isToolbarCompactLandscape && <div aria-hidden="true" />}

            <div
              className={`flex shrink-0 items-stretch ${isToolbarCompactLandscape ? (isUltraCompactLandscape ? 'gap-1' : 'gap-1.5') : 'w-full justify-center gap-3'}`}
              data-live-director-control="transport-group"
            >
              <button
                type="button"
                onClick={() => {
                  void handleReturnToStart();
                }}
                disabled={!hasTrackSession || isTransportCueBusy || isCongregationFading || (DISABLE_BACKWARD_SEEK_WHILE_PLAYING && isPlaying)}
                aria-busy={isTransportCueBusy || undefined}
                data-live-director-control="return-start"
                className={`${CONTROL_CARD} group relative ${isUltraCompactLandscape ? 'h-11 px-3' : isToolbarCompactLandscape ? 'h-12 px-4' : 'h-[var(--ld-control-height)] px-5'} justify-center text-white/76 hover:text-white disabled:cursor-not-allowed disabled:text-white/24`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 4.5 : 5.2, 4.15) }
                  : { flex: '0 0 22%' }}
                aria-label="Volver al inicio"
                aria-keyshortcuts="R"
                title={isPlaying && DISABLE_BACKWARD_SEEK_WHILE_PLAYING ? 'Pausa para volver al inicio' : 'Volver al inicio (R)'}
              >
                <SkipBack className={`${isUltraCompactLandscape ? 'h-5 w-5' : isToolbarCompactLandscape ? 'h-6 w-6' : 'h-7 w-7'}`} />
                <KeyboardHint>R</KeyboardHint>
              </button>

              <button
                type="button"
                onClick={handleTogglePlaybackFromGesture}
                disabled={!isReady || isTransportCueBusy}
                aria-busy={isTransportCueBusy || undefined}
                data-live-director-control="play-pause"
                className={`${CONTROL_CARD} group relative ${isUltraCompactLandscape ? 'h-11 px-6' : isToolbarCompactLandscape ? 'h-12 px-7' : 'h-[var(--ld-control-height)] px-8'} justify-center border-cyan-300/24 bg-cyan-300/[0.08] text-cyan-100 shadow-[0_0_18px_rgba(103,232,249,0.09)] hover:border-cyan-200/38 hover:bg-cyan-300/[0.11] disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-black/12 disabled:text-white/24`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 7.25 : 8.25, 6.7) }
                  : { flex: '0 0 34%' }}
                aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                aria-keyshortcuts="Space"
                title={isPlaying ? 'Pausar · Espacio' : 'Reproducir · Espacio'}
              >
                {isPlaying ? (
                  <Pause className={`${isUltraCompactLandscape ? 'h-[1.45rem] w-[1.45rem]' : isToolbarCompactLandscape ? 'h-7 w-7' : 'h-11 w-11'}`} strokeWidth={2.15} fill="currentColor" />
                ) : (
                  <Play className={`ml-0.5 ${isUltraCompactLandscape ? 'h-[1.45rem] w-[1.45rem]' : isToolbarCompactLandscape ? 'h-7 w-7' : 'h-11 w-11'}`} strokeWidth={2.15} fill="currentColor" />
                )}
                <KeyboardHint>SPACE</KeyboardHint>
              </button>

              <button
                type="button"
                onClick={handleToggleCongregationFade}
                disabled={!hasTrackSession || !isReady || isTransportCueBusy}
                aria-pressed={congregationFadeTargetMuted}
                data-live-director-control="fade-out"
                aria-label={congregationFadeTargetMuted
                  ? 'Restaurar progresivamente el volumen de la secuencia'
                  : 'Bajar progresivamente la secuencia para que cante la congregación'}
                title={congregationFadeTargetMuted
                  ? 'Restaurar secuencia · Fade 5s (F)'
                  : 'Modo congregación · Fade 5s (F)'}
                aria-keyshortcuts="F"
                className={`${CONTROL_CARD} group relative ${isUltraCompactLandscape ? 'h-11 px-3' : isToolbarCompactLandscape ? 'h-12 px-4' : 'h-[var(--ld-control-height)] px-4'} justify-center disabled:cursor-not-allowed disabled:text-white/24 ${congregationFadeTargetMuted
                  ? 'border-cyan-300/32 bg-cyan-300/10 text-cyan-100 shadow-[0_0_16px_rgba(103,232,249,0.10)]'
                  : 'text-cyan-100/86 hover:border-cyan-300/26 hover:bg-cyan-300/8'
                }`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 4.5 : 5.2, 4.15) }
                  : { flex: '0 0 22%' }}
              >
                <CongregationFadeIcon
                  muted={congregationFadeTargetMuted}
                  fading={isCongregationFading}
                />
                <KeyboardHint>F</KeyboardHint>
                <span className="sr-only">
                  {isCongregationFading
                    ? (congregationFadeTargetMuted ? 'Bajando secuencia' : 'Restaurando secuencia')
                    : (congregationFadeTargetMuted ? 'Secuencia abajo' : 'Secuencia normal')}
                </span>
              </button>
            </div>

            {!isToolbarCompactLandscape && <div aria-hidden="true" />}

            <div className={`flex items-stretch ${isToolbarCompactLandscape ? '' : 'justify-end'}`}>
              <button
                type="button"
                onClick={handleStemsToolbarAction}
                disabled={!canUseStemsToolbar}
                aria-pressed={isStemsToolbarActive}
                data-live-director-control="stems"
                aria-keyshortcuts="S"
                className={`${CONTROL_CARD} group relative ${isUltraCompactLandscape ? 'h-11 px-1.5 text-[0.56rem]' : isToolbarCompactLandscape ? 'h-12 px-2 text-[0.68rem]' : 'h-[var(--ld-control-height)] px-3 text-[0.76rem]'} shrink-0 flex-col font-semibold tracking-[0.16em] disabled:cursor-not-allowed disabled:text-white/28 ${isStemsToolbarActive
                  ? 'border-cyan-300/32 bg-cyan-300/10 text-cyan-100 shadow-[0_0_16px_rgba(103,232,249,0.10)]'
                  : 'text-cyan-50 hover:border-cyan-300/22 hover:bg-cyan-300/7'
                  }`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 4.35 : 4.95, 3.75) }
                  : { width: '100%' }}
                aria-label={canToggleTrackLoad
                  ? 'Abrir opciones de stems'
                  : (areAllActiveTracksMuted ? 'Activar stems' : 'Apagar stems')}
                title={canToggleTrackLoad
                  ? 'Opciones de stems (S)'
                  : `${areAllActiveTracksMuted ? 'Activar' : 'Apagar'} stems (S)`}
              >
                <SlidersVertical className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : isToolbarCompactLandscape ? 'h-4 w-4' : 'h-5 w-5'}`} />
                <span className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.46rem]' : 'mt-1 text-[0.58rem]'} tracking-[0.18em] text-white/52`}>
                  STEMS
                </span>
                <KeyboardHint>S</KeyboardHint>
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
                            void handleReturnToStart();
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
              <div
                className={`flex h-full items-stretch ${isUltraCompactLandscape ? 'gap-1.5' : isCompactLandscape ? 'gap-2' : 'gap-4'}`}
                style={{
                  minHeight: scaleRem(
                    isUltraCompactLandscape ? 4.35 : isCompactLandscape ? 6.25 : 11.25,
                    isUltraCompactLandscape ? 4.1 : isCompactLandscape ? 5.75 : 10.5,
                  ),
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (hasTrackSession) {
                      void handleReturnToStart();
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
                        crossOrigin="anonymous"
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
                  <div className={`flex h-full flex-col justify-center ${isUltraCompactLandscape ? 'gap-1.5' : isCompactLandscape ? 'gap-2.5' : 'gap-5'}`}>
                    <div className="flex min-w-0 items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-baseline gap-2.5">
                          <h1 className={`shrink-0 font-semibold tracking-tight text-white ${isUltraCompactLandscape ? 'text-[0.96rem]' : isCompactLandscape ? 'text-[1.15rem]' : 'text-[1.65rem]'}`}>
                            {currentSessionLabel}
                          </h1>
                          {performerLabel && (
                            <span className={`min-w-0 truncate font-medium text-white/42 ${isUltraCompactLandscape ? 'text-[0.56rem]' : isCompactLandscape ? 'text-[0.68rem]' : 'text-[0.9rem]'}`}>
                              — {performerLabel}
                            </span>
                          )}
                          {advancedStreamingActive && (
                            <span
                              className={`inline-flex shrink-0 self-center items-center justify-center rounded-full border border-emerald-300/18 bg-emerald-300/8 text-emerald-200/88 shadow-[0_0_14px_rgba(67,196,119,0.10)] ${isUltraCompactLandscape ? 'h-5 w-5' : 'h-6 w-6'}`}
                              aria-label="Motor avanzado activo"
                              title="Motor avanzado activo"
                            >
                              <AudioWaveform className={isUltraCompactLandscape ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden="true" />
                            </span>
                          )}
                        </div>
                        <p
                          className={`font-medium text-white/58 ${isUltraCompactLandscape ? 'mt-0.5 text-[0.62rem]' : isCompactLandscape ? 'mt-1 text-[0.78rem]' : 'mt-1.5 text-[1rem]'}`}
                          title={autoDisabledTrackNames.length > 0 ? `Omitidas por estabilidad: ${autoDisabledTrackNames.join(', ')}` : undefined}
                        >
                          {hasTrackSession
                            ? `${activeTracks.length}${enabledSessionTracks.length !== activeTracks.length ? ` de ${enabledSessionTracks.length}` : ''} pistas activas`
                            : 'Sin pistas activas'}
                        </p>
                      </div>
                      <span ref={passiveProgressTextRef} className={`shrink-0 font-semibold tabular-nums tracking-[0.12em] text-white/52 ${isUltraCompactLandscape ? 'text-[0.58rem]' : isCompactLandscape ? 'text-[0.72rem]' : 'text-[0.88rem]'}`}>
                        {formatCompact(currentTime)} / {formatCompact(playbackTimelineDuration)}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className={`${isUltraCompactLandscape ? 'h-1' : isCompactLandscape ? 'h-1.5' : 'h-2.5'} rounded-full bg-black/30`}>
                        <div
                          ref={passiveProgressBarRef}
                          className="h-full origin-left rounded-full bg-[linear-gradient(90deg,#43c477_0%,#81ddf5_100%)] shadow-[0_0_14px_rgba(67,196,119,0.16)] transition-transform duration-200 will-change-transform"
                          style={{
                            transform: `scaleX(${Math.max(hasTrackSession ? progressPercent / 100 : 0, hasTrackSession ? 0.04 : 0)})`,
                          }}
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
                                style={{ width: `${widthPercent}%`, backgroundColor: sec.accent }}
                                title={sec.name}
                              />
                            );
                          })}
                          {sectionTimelineTailDuration > 0 && (
                            <div
                              className="h-full bg-white/14"
                              style={{ width: `${playbackTimelineDuration > 0 ? (sectionTimelineTailDuration / playbackTimelineDuration) * 100 : 0}%` }}
                              title="Audio sin seccion marcada"
                            />
                          )}
                        </div>
                      )}
                    </div>
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
                <div
                  className="pointer-events-none absolute left-4 top-[3.4rem] z-40 flex items-center gap-2 rounded-full border border-amber-300/28 bg-black/62 px-2.5 py-1 shadow-[0_6px_18px_rgba(0,0,0,0.28)]"
                  aria-live={keyboardSectionIndex !== null ? 'polite' : undefined}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full bg-amber-300 ${
                      sectionsAutoFollowStatus === 'held' ? 'animate-pulse' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-[0.58rem] font-black uppercase tracking-[0.22em] text-amber-100/86">
                    {keyboardSectionIndex !== null
                      ? 'Enter para ir · Auto en 5s'
                      : sectionsAutoFollowStatus === 'held'
                        ? 'Scroll libre'
                        : 'Auto en 5s'}
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
                    void handleCloseOffsetModal();
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
                      onClick={() => {
                        void handleCloseOffsetModal();
                      }}
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
                  {sectionOffsetSaveError && (
                    <p className="mt-2 text-[0.64rem] leading-snug text-rose-200/86" role="alert">
                      {sectionOffsetSaveError}
                    </p>
                  )}
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
                          disabled={isCongregationFading}
                          aria-busy={isSectionSeekBusy || undefined}
                          data-live-chord-section="true"
                          data-live-section-index={index}
                          data-live-section-start={section.startTime}
                          data-live-section-end={section.endTime}
                          title={isCongregationFading ? 'Espera a que termine el fade de congregación' : undefined}
                          onClick={(event) => {
                            if (event.detail > 0) {
                              return;
                            }
                            void handleSectionSeek(section.startTime);
                          }}
                          className="relative h-full shrink-0 rounded-[1.55rem] border text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45"
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
                            ref={(element) => {
                              const playheadRefs = passiveSectionPlayheadRefs.current;
                              if (element) {
                                playheadRefs.set(section.id, element);
                              } else {
                                playheadRefs.delete(section.id);
                              }
                            }}
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
                      onPointerCancel={handleMinimapPointerCancel}
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
                        ref={passiveMinimapPlayheadRef}
                        aria-hidden="true"
                        className="pointer-events-none absolute -top-[4px] -bottom-[4px] left-0 w-[2px] rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]"
                        style={{
                          left: `${sectionLaneMinimapPlayheadPct}%`,
                          transform: 'translate3d(-1px, 0, 0)',
                          willChange: 'transform',
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
                  <div
                    key={track.id}
                    ref={(element) => {
                      if (element) {
                        passiveMixerLevelRefs.current.set(track.id, element);
                      } else {
                        passiveMixerLevelRefs.current.delete(track.id);
                      }
                    }}
                    className="h-full min-w-0"
                  >
                    <ChannelStrip
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
                      disabledReason={track.disabledReason}
                      disabledTitle={track.disabledTitle}
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
                  </div>
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
              <button
                type="button"
                onClick={handlePreviousSection}
                disabled={!hasTrackSession || isTransportCueBusy || isCongregationFading}
                aria-label="Ir a la sección anterior"
                aria-keyshortcuts="["
                title="Sección anterior ([)"
                className={`group relative ui-pressable-soft flex min-h-0 w-full flex-1 flex-col items-center justify-center rounded-[1.2rem] border border-white/8 bg-black/24 px-1 text-white/62 transition-all disabled:cursor-not-allowed disabled:opacity-35 ${isUltraCompactLandscape ? 'rounded-[1rem]' : ''}`}
              >
                <ChevronLeft className={isUltraCompactLandscape ? 'h-3.5 w-3.5' : isCompactLandscape ? 'h-4 w-4' : 'h-6 w-6'} strokeWidth={2.2} />
                <span className={`${isUltraCompactLandscape ? 'text-[0.42rem]' : isCompactLandscape ? 'text-[0.48rem]' : 'text-[0.6rem]'} mt-1 font-black uppercase tracking-[0.13em]`}>
                  Anterior
                </span>
                <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-md border border-white/12 bg-white/8 px-1.5 py-0.5 text-[0.5rem] font-black text-white/72 opacity-0 transition-opacity group-hover:opacity-100">
                  [
                </span>
              </button>
              <button
                type="button"
                onClick={handleNextSection}
                disabled={!hasTrackSession || isTransportCueBusy || isCongregationFading}
                aria-label="Ir a la sección siguiente"
                aria-keyshortcuts="]"
                title="Sección siguiente (])"
                className={`group relative ui-pressable-soft flex min-h-0 w-full flex-1 flex-col items-center justify-center rounded-[1.2rem] border border-white/8 bg-black/24 px-1 text-white/62 transition-all disabled:cursor-not-allowed disabled:opacity-35 ${isUltraCompactLandscape ? 'rounded-[1rem]' : ''}`}
              >
                <ChevronRight className={isUltraCompactLandscape ? 'h-3.5 w-3.5' : isCompactLandscape ? 'h-4 w-4' : 'h-6 w-6'} strokeWidth={2.2} />
                <span className={`${isUltraCompactLandscape ? 'text-[0.42rem]' : isCompactLandscape ? 'text-[0.48rem]' : 'text-[0.6rem]'} mt-1 font-black uppercase tracking-[0.13em]`}>
                  Siguiente
                </span>
                <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-md border border-white/12 bg-white/8 px-1.5 py-0.5 text-[0.5rem] font-black text-white/72 opacity-0 transition-opacity group-hover:opacity-100">
                  ]
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSurfaceView((previous) => previous === 'mix' ? 'sections' : 'mix')}
                aria-pressed={showSectionsPanel}
                aria-label={showSectionsPanel ? 'Mostrar faders de mezcla' : 'Mostrar secciones'}
                aria-keyshortcuts="V"
                title={`${showSectionsPanel ? 'Mostrar mezcla' : 'Mostrar secciones'} (V)`}
                className={`group relative ui-pressable-soft flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 rounded-[1.2rem] border transition-all ${isUltraCompactLandscape ? 'rounded-[1rem] gap-0.5' : ''
                  } ${showSectionsPanel
                    ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50 shadow-[0_0_20px_rgba(129,221,245,0.14)]'
                    : 'border-white/8 bg-black/24 text-white/62'
                  }`}
              >
                {showSectionsPanel ? (
                  <SlidersVertical className={isUltraCompactLandscape ? 'h-3 w-3' : isCompactLandscape ? 'h-3.5 w-3.5' : 'h-6 w-6'} />
                ) : (
                  <ListMusic className={isUltraCompactLandscape ? 'h-3 w-3' : isCompactLandscape ? 'h-3.5 w-3.5' : 'h-6 w-6'} />
                )}
                <span className={`${isUltraCompactLandscape ? 'text-[0.46rem]' : isCompactLandscape ? 'text-[0.52rem]' : 'text-[0.66rem]'} font-black uppercase tracking-[0.16em]`}>
                  {showSectionsPanel ? 'Mezcla' : 'Secciones'}
                </span>
                <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-md border border-white/12 bg-white/8 px-1.5 py-0.5 text-[0.5rem] font-black text-white/72 opacity-0 transition-opacity group-hover:opacity-100">
                  V
                </span>
              </button>
              <button
                type="button"
                onClick={handleToggleLoop}
                disabled={!hasTrackSession || !isReady || isTransportCueBusy || isCongregationFading || loopPreparing}
                aria-pressed={loopEnabled}
                aria-busy={loopPreparing || undefined}
                aria-label={loopPreparing ? 'Preparando bucle' : loopEnabled ? 'Desactivar bucle' : 'Activar bucle en la sección actual'}
                aria-keyshortcuts="L"
                title={loopLabState.error || `${loopEnabled ? 'Desactivar' : 'Activar'} bucle experimental (L)`}
                className={`group relative ui-pressable-soft flex min-h-0 w-full flex-1 flex-col items-center justify-center rounded-[1.2rem] border px-2 text-center ${isUltraCompactLandscape ? 'rounded-[1rem] text-[0.46rem]' : isCompactLandscape ? 'text-[0.52rem]' : 'text-[0.68rem]'} font-semibold tracking-[0.16em] leading-[1.1] ${loopPreparing
                  ? 'border-amber-300/45 bg-amber-300/12 text-amber-100'
                  : loopFailed
                    ? 'border-rose-300/45 bg-rose-300/10 text-rose-100'
                    : loopEnabled
                      ? 'border-[#43c477]/50 bg-[#43c477]/14 text-[#9effc4]'
                      : 'border-white/8 bg-black/24 text-white/62'
                  }`}
              >
                <Infinity className={`${loopPreparing ? 'animate-pulse' : ''} ${isUltraCompactLandscape ? 'mb-0.5 h-3.5 w-3.5' : isCompactLandscape ? 'mb-1 h-4 w-4' : 'mb-1.5 h-6 w-6'}`} strokeWidth={2.2} />
                <span>{loopPreparing ? 'PREPARANDO' : loopFailed ? 'ERROR' : `BUCLE ${loopEnabled ? 'ON' : 'OFF'}`}</span>
                <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-md border border-white/12 bg-white/8 px-1.5 py-0.5 text-[0.5rem] font-black text-white/72 opacity-0 transition-opacity group-hover:opacity-100">
                  L
                </span>
              </button>
            </div>
          </div>

          <div className={`rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isUltraCompactLandscape ? 'px-0.5 py-0.5' : isCompactLandscape ? 'px-1 py-0.5' : 'px-3 py-4'}`}>
            <div className={`relative flex h-full flex-col items-center border border-white/7 bg-[linear-gradient(180deg,rgba(34,35,37,0.92),rgba(26,27,29,0.94))] ${isUltraCompactLandscape ? 'rounded-[1.18rem] px-0.75 pb-0.75 pt-0.85' : isCompactLandscape ? 'rounded-[1.38rem] px-1.25 pb-1.25 pt-0.95' : 'rounded-[1.75rem] px-3 pb-4 pt-3'}`}>
              <div className={`flex items-center justify-center border border-white/8 bg-black/28 text-white/62 ${isUltraCompactLandscape ? 'mb-1 min-h-[1.75rem] min-w-[1.75rem] rounded-[0.95rem]' : isCompactLandscape ? 'mb-1.5 min-h-[2rem] min-w-[2rem] rounded-[1.05rem]' : 'mb-2 h-10 w-10 rounded-full'}`}>
                <span className={`font-black tracking-[0.18em] ${isUltraCompactLandscape ? 'text-[0.54rem]' : isCompactLandscape ? 'text-[0.65rem]' : 'text-[0.82rem]'}`}>M</span>
              </div>

              <div className="relative flex w-full flex-1 items-center justify-center">
                <div className={`relative h-full w-full ${isUltraCompactLandscape ? 'max-w-[5.2rem]' : isCompactLandscape ? 'max-w-[5.95rem]' : 'max-w-[5.8rem]'}`}>
                  <div className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-[#050607] ${isUltraCompactLandscape ? 'top-[8%] bottom-[12%] w-[0.5rem]' : isCompactLandscape ? 'top-[7%] bottom-[11%] w-[0.56rem]' : 'top-[4.5%] bottom-[6.5%] w-[0.72rem]'}`} />
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
                className="ui-pressable-soft fixed right-4 top-4 z-[70] flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/70 text-white/64 backdrop-blur hover:text-white"
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

      {showStemsActionModal && canToggleTrackLoad && (
        <div
          className="absolute inset-0 z-[57] flex items-center justify-center bg-black/48 px-4 py-4 backdrop-blur-[10px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="live-director-stems-action-title"
        >
          <div className={`w-full overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,22,0.98),rgba(13,15,17,0.98))] shadow-[0_32px_72px_rgba(0,0,0,0.44)] ${useWideTrackLoadModal ? 'max-w-[42rem]' : 'max-w-[25rem]'}`}>
            <div className={`${useWideTrackLoadModal ? 'px-5 py-4' : 'px-4 py-4'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[0.66rem] font-black uppercase tracking-[0.24em] text-cyan-100/58">STEMS</p>
                  <h3
                    id="live-director-stems-action-title"
                    className={`font-semibold tracking-tight text-white ${useWideTrackLoadModal ? 'mt-1 text-[1.28rem]' : 'mt-1 text-[1.08rem]'}`}
                  >
                    ¿Qué quieres hacer?
                  </h3>
                  <p className={`max-w-2xl text-white/54 ${useWideTrackLoadModal ? 'mt-1 text-[0.8rem]' : 'mt-1 text-[0.74rem]'}`}>
                    Gestiona los stems actuales o carga/reemplaza la secuencia sin recargar la interfaz principal.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStemsActionModal(false)}
                  className="ui-pressable-soft flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/26 text-white/58 hover:text-white"
                  aria-label="Cerrar opciones de stems"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className={`mt-4 grid ${useWideTrackLoadModal ? 'grid-cols-2 gap-3' : 'grid-cols-1 gap-2.5'}`}>
                <button
                  type="button"
                  onClick={handleOpenTrackLoadModal}
                  className="ui-pressable-soft group min-h-[8.2rem] rounded-[1.35rem] border border-cyan-300/18 bg-cyan-300/[0.075] p-4 text-left text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-cyan-300/30 hover:bg-cyan-300/[0.10]"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-[1rem] border border-cyan-300/22 bg-black/24 text-cyan-100">
                    <SlidersVertical className="h-5 w-5" />
                  </span>
                  <span className="mt-4 block text-[0.96rem] font-semibold tracking-tight text-white">
                    Gestionar stems
                  </span>
                  <span className="mt-1 block text-[0.74rem] leading-relaxed text-white/54">
                    Prende o apaga pistas antes de aplicar. Ahora: {activeTracks.length}/{sessionTracks.length} activas.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenStemsLoader}
                  className="ui-pressable-soft group min-h-[8.2rem] rounded-[1.35rem] border border-white/10 bg-white/[0.045] p-4 text-left text-white/82 hover:border-cyan-300/22 hover:bg-white/[0.065]"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-[1rem] border border-white/10 bg-black/24 text-cyan-100/86">
                    <FolderOpen className="h-5 w-5" />
                  </span>
                  <span className="mt-4 block text-[0.96rem] font-semibold tracking-tight text-white">
                    Cargar / reemplazar
                  </span>
                  <span className="mt-1 block text-[0.74rem] leading-relaxed text-white/52">
                    Abre el cargador para escoger una secuencia única o una carpeta multitrack.
                  </span>
                </button>
              </div>

              <div className="mt-3 rounded-[1rem] border border-white/8 bg-black/22 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-[0.72rem] font-semibold text-white/74">{currentSessionLabel}</p>
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.58rem] font-black uppercase tracking-[0.16em] text-white/46">
                    {hasSessionTracks ? `${sessionTracks.length} stems` : 'Sin stems'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTrackLoadModal && canToggleTrackLoad && (
        <div
          className="absolute inset-0 z-[58] flex items-center justify-center bg-black/50 px-4 py-4 backdrop-blur-[10px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="live-director-stems-modal-title"
        >
          <div className={`flex w-full max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,22,0.98),rgba(13,15,17,0.98))] shadow-[0_32px_72px_rgba(0,0,0,0.44)] ${useWideTrackLoadModal ? 'max-w-[48rem]' : 'max-w-[34rem]'}`}>
            <div className={`shrink-0 border-b border-white/8 ${useWideTrackLoadModal ? 'px-5 py-4' : 'px-4 py-4'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[0.66rem] font-black uppercase tracking-[0.24em] text-cyan-100/58">STEMS</p>
                  <h3
                    id="live-director-stems-modal-title"
                    className={`truncate font-semibold tracking-tight text-white ${useWideTrackLoadModal ? 'mt-1 text-[1.18rem]' : 'mt-1 text-[1.05rem]'}`}
                  >
                    {currentSessionLabel}
                  </h3>
                  <p className={`max-w-2xl text-white/54 ${useWideTrackLoadModal ? 'mt-1 text-[0.78rem]' : 'mt-1 text-[0.74rem]'}`}>
                    {trackLoadGuidanceText}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCancelTrackLoadModal}
                  className="ui-pressable-soft flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/26 text-white/58 hover:text-white"
                  aria-label="Cancelar configuracion de stems"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className={`mt-4 grid gap-2 ${useWideTrackLoadModal ? 'grid-cols-[1fr_1fr_auto] items-stretch' : 'grid-cols-2'}`}>
                <div className="rounded-[1rem] border border-cyan-300/14 bg-cyan-300/[0.07] px-3 py-2.5">
                  <p className="text-[0.56rem] font-black uppercase tracking-[0.18em] text-cyan-100/52">Activos</p>
                  <p className="mt-0.5 text-[1.15rem] font-semibold leading-none text-cyan-50">
                    {pendingEnabledCount}/{sessionTracks.length}
                  </p>
                </div>
                <div className="rounded-[1rem] border border-white/8 bg-black/24 px-3 py-2.5">
                  <p className="text-[0.56rem] font-black uppercase tracking-[0.18em] text-white/36">Seguro</p>
                  <p className="mt-0.5 text-[1.15rem] font-semibold leading-none text-white/88">
                    {sessionActiveTrackLimit >= sessionTracks.length ? 'Todos' : sessionActiveTrackLimit}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!pendingEnabledMap) return;
                    const nextMap: Record<string, boolean> = {};
                    const rankedTracks = sessionTracks
                      .map((track, index) => ({ track, index, rank: stemPriorityRank(track) }))
                      .sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
                    let enabledCount = 0;
                    rankedTracks.forEach(({ track }) => {
                      const canEnable = enabledCount < sessionActiveTrackLimit;
                      nextMap[track.id] = canEnable;
                      if (canEnable) {
                        enabledCount += 1;
                      }
                    });
                    setPendingEnabledMap(nextMap);
                  }}
                  className={`ui-pressable-soft rounded-[1rem] border border-white/10 bg-white/[0.05] font-black uppercase tracking-[0.16em] text-white/78 hover:bg-white/[0.08] ${useWideTrackLoadModal ? 'px-4 text-[0.62rem]' : 'col-span-2 px-3 py-2.5 text-[0.62rem]'}`}
                >
                  Seleccion segura
                </button>
              </div>
            </div>

            <div className={`min-h-0 flex-1 overflow-y-auto ${useWideTrackLoadModal ? 'px-5 py-4' : 'px-4 py-3'}`}>
              <div className={`grid ${useWideTrackLoadModal ? 'grid-cols-2 gap-2.5' : 'grid-cols-1 gap-2'}`}>
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
                        if (isEnabling && enabledCount >= sessionActiveTrackLimit) {
                          window.alert(`Para estabilidad, no cargues más de ${sessionActiveTrackLimit} stems. Desactiva uno antes de activar otro.`);
                          return;
                        }

                        const next = { ...pendingEnabledMap, [track.id]: !pendingEnabledMap[track.id] };
                        const hasAny = Object.values(next).some(Boolean);
                        if (hasAny) setPendingEnabledMap(next);
                      }}
                      aria-pressed={pendingEnabled}
                      className={`group w-full rounded-[1.05rem] border text-left transition-all ${useWideTrackLoadModal ? 'px-3.5 py-3' : 'px-3 py-3'} ${pendingEnabled
                        ? 'border-cyan-300/18 bg-cyan-300/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                        : 'border-white/7 bg-black/22 opacity-72'
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${pendingEnabled ? 'bg-cyan-200 shadow-[0_0_12px_rgba(103,232,249,0.35)]' : 'bg-white/18'}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`truncate font-semibold ${useWideTrackLoadModal ? 'text-[0.92rem]' : 'text-[0.86rem]'} ${pendingEnabled ? 'text-white/92' : 'text-white/58'}`}>
                            {track.sourceFileName}
                          </p>
                          <p className={`mt-0.5 truncate uppercase tracking-[0.16em] ${useWideTrackLoadModal ? 'text-[0.62rem]' : 'text-[0.58rem]'} ${pendingEnabled ? 'text-cyan-100/58' : 'text-white/32'}`}>
                            {track.trackName}
                          </p>
                        </div>
                        <span className={`relative h-7 w-12 shrink-0 rounded-full border transition-all ${pendingEnabled ? 'border-cyan-300/28 bg-cyan-300/16' : 'border-white/10 bg-black/28'}`}>
                          <span className={`absolute top-1 h-5 w-5 rounded-full transition-all ${pendingEnabled ? 'left-6 bg-cyan-100' : 'left-1 bg-white/38'}`} />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={`shrink-0 border-t border-white/8 bg-black/16 ${useWideTrackLoadModal ? 'px-5 py-4' : 'px-4 py-3'}`}>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancelTrackLoadModal}
                  className="ui-pressable-soft h-12 flex-1 rounded-[1rem] border border-white/10 bg-white/[0.04] text-[0.82rem] font-semibold uppercase tracking-[0.14em] text-white/70 hover:bg-white/[0.07] hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleApplyTrackLoadModal}
                  className="ui-pressable-soft h-12 flex-[1.25] rounded-[1rem] border border-cyan-300/30 bg-cyan-300/[0.12] text-[0.82rem] font-semibold uppercase tracking-[0.14em] text-cyan-50 shadow-[0_0_18px_rgba(103,232,249,0.10)] hover:bg-cyan-300/[0.16]"
                >
                  Aplicar
                </button>
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

      {engineSuspensionNotice && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[58] flex justify-center px-3">
          <div className="pointer-events-auto w-full max-w-md rounded-[1.15rem] border border-emerald-300/22 bg-[linear-gradient(180deg,rgba(13,27,23,0.97),rgba(8,15,14,0.97))] px-4 py-3 shadow-[0_18px_36px_rgba(0,0,0,0.3)]">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.8rem] border border-emerald-300/20 bg-emerald-300/10 text-emerald-100">
                <Activity className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.22em] text-emerald-100/72">
                  Sesión pausada
                </p>
                <p className="mt-0.5 text-[0.86rem] leading-snug text-white/78">
                  {engineSuspensionNotice.message}
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  setBusyMessage('Reanudando sesión...');
                  try {
                    await reviveAfterSuspension();
                    setLoadError(null);
                  } catch (error) {
                    setLoadError(error instanceof Error ? error.message : 'No se pudo reanudar la sesión.');
                  } finally {
                    setBusyMessage(null);
                  }
                }}
                className="ui-pressable-soft shrink-0 rounded-[0.85rem] border border-emerald-300/28 bg-emerald-300/12 px-3 py-2 text-[0.72rem] font-black uppercase tracking-[0.16em] text-emerald-50 hover:bg-emerald-300/18"
              >
                Reanudar
              </button>
              <button
                type="button"
                onClick={clearSuspensionNotice}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.7rem] border border-white/10 bg-white/5 text-white/64 hover:bg-white/10 hover:text-white"
                aria-label="Cerrar aviso de sesión pausada"
                title="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {showTrackLimitNotice && trackLimitNotice && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[56] flex justify-center px-3">
          <div className="pointer-events-auto w-full max-w-xl rounded-[1.1rem] border border-sky-300/22 bg-[linear-gradient(180deg,rgba(13,24,29,0.97),rgba(10,17,21,0.97))] px-4 py-3 shadow-[0_18px_36px_rgba(0,0,0,0.3)]">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.75rem] border border-sky-300/22 bg-sky-300/10 text-sky-100">
                <SlidersVertical className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-sky-100/78">
                  Más de {trackLimitNotice.limit} stems
                </p>
                <p className="mt-1 text-[0.88rem] leading-snug text-white/80">
                  Se cargarán {trackLimitNotice.limit} de {trackLimitNotice.total}. Omitidos: {trackLimitNotice.names.slice(0, 3).join(', ')}{trackLimitNotice.names.length > 3 ? ` +${trackLimitNotice.names.length - 3}` : ''}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDismissedTrackLimitNoticeKey(trackLimitNotice.key)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.7rem] border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Cerrar aviso de limite de stems"
                title="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {showLoadWarningBanner && loadWarnings && loadWarnings.length > 0 && (
        <div className={`pointer-events-none absolute inset-x-0 ${showTrackLimitNotice ? 'top-[6.4rem]' : 'top-3'} z-[55] flex justify-center px-3`}>
          <div className="pointer-events-auto w-full max-w-xl rounded-[1.1rem] border border-amber-300/25 bg-[linear-gradient(180deg,rgba(34,26,12,0.96),rgba(24,18,8,0.96))] px-4 py-3 shadow-[0_18px_36px_rgba(0,0,0,0.3)]">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.75rem] border border-amber-300/25 bg-amber-300/10 text-amber-200">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-amber-200/80">
                  {hasUnsupportedStemFormat
                    ? `Formato incompatible (${unsupportedFormatWarnings.length})`
                    : hasRecoveredSyntheticClick
                      ? 'Click recuperado'
                      : `Stems omitidos (${loadWarnings.length})`}
                </p>
                <p className="mt-1 text-[0.88rem] leading-snug text-white/80">
                  {hasUnsupportedStemFormat
                    ? 'Hay stems en MP3 que el motor en vivo no puede usar. La sesión continúa con las pistas compatibles.'
                    : hasRecoveredSyntheticClick
                    ? 'Safari no pudo abrir el click original, así que generamos un click estable para mantener la guía.'
                    : 'La sesión cargó sin estos archivos porque el motor no pudo abrirlos:'}
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
                        {warning.reason === 'unsupported-format' ? (
                          <span>
                            <span className="font-semibold text-white/90">{warning.trackName || warning.trackId}</span>
                            <span className="text-white/60">{ext ? ` ${ext}` : ''}: {warning.message}</span>
                          </span>
                        ) : (
                          <>
                            <span className="font-semibold text-white/90">{warning.trackName || warning.trackId}</span>
                            <span className="text-white/60">{ext}{code}</span>
                          </>
                        )}
                      </li>
                    );
                  })}
                  {loadWarnings.length > 4 && (
                    <li className="text-white/55">+ {loadWarnings.length - 4} más…</li>
                  )}
                </ul>
                <p className="mt-2 text-[0.76rem] leading-snug text-amber-100/70">
                  {hasUnsupportedStemFormat
                    ? <>Convierte esos stems a <span className="font-semibold">M4A/AAC-LC (.m4a 256 kbps)</span> y vuelve a subirlos.</>
                    : <>Consejo: re-exporta los stems problemáticos como <span className="font-semibold">AAC-LC (.m4a 256 kbps)</span> o <span className="font-semibold">FLAC</span>. Evita ALAC — no abre en Windows ni Android.</>}
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

export default LiveDirectorLoopLabView;
