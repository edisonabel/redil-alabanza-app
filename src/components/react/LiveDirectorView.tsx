import {readEventArrangementForRehearsal} from '../../utils/rehearsalDeviceData';
import {useLiveDirectorEntryCount} from '../../hooks/useLiveDirectorEntryCount';
import {useLiveDirectorMusicalNavigation} from '../../hooks/useLiveDirectorMusicalNavigation';
import {entryCountPlan} from '../../utils/liveDirectorEntryCount';
import {queueNumberFromKey} from '../../utils/liveDirectorEntryCount';
import { useLiveDirectorEventAdvance, type EventPlaybackRequest, type QueueSelectionOptions } from '../../hooks/useLiveDirectorEventAdvance';
import { useLiveDirectorSongLevel } from '../../hooks/useLiveDirectorSongLevel';
import { LiveDirectorSongLevel } from './live-director/LiveDirectorSongLevel';
import { useLiveDirectorEventArrangement } from '../../hooks/useLiveDirectorEventArrangement';
import { useLiveDirectorArrangement } from '../../hooks/useLiveDirectorArrangement';
import { LiveDirectorArrangementEditor } from './live-director/LiveDirectorArrangementEditor';
import { buildSectionWavePath as buildWavePath, SECTION_WAVE_BAR_WIDTH_PX, SECTION_WAVE_BAR_GAP_PX } from '../../utils/liveDirectorSectionWave';
import { resolveArrangement, arrangementTimeline, arrangementElapsed, arrangementSourceAt, arrangementDuration, type ArrangementEntry } from '../../utils/liveDirectorArrangement';
import { useLiveDirectorDynamicGuide } from '../../hooks/useLiveDirectorDynamicGuide';
import { GUIDE_INSTRUCTION_OPTIONS } from '../../utils/guideSectionCatalog';
import { useLiveDirectorSectionJump } from '../../hooks/useLiveDirectorSectionJump';
import {
  Activity,
  AlertTriangle,
  AudioWaveform,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Pencil,
  ListMusic,
  Pause,
  Play,
  Radio,
  Repeat1,
  Infinity as InfinityIcon,
  Headphones,
  ArrowRight,
  SkipBack,
  SlidersVertical,
  Smartphone,
  Upload,
  X,
  Megaphone,
  Map as MapIcon,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  canUseAdvancedStreamingEngine,
  canUseSharedStreamingTelemetry,
  useMultitrackEngine,
} from '../../hooks/useMultitrackEngine';
import { useLiveDirectorManualTempoTransport } from '../../hooks/useLiveDirectorManualTempoTransport';
import { useNativeIOSMultitrackEngine } from '../../hooks/useNativeIOSMultitrackEngine';
import type { MultitrackEngineLoadWarning, SongStructure, TrackData } from '../../services/MultitrackEngine';
import type { SharedStreamingTelemetry } from '../../services/StreamingMultitrackEngine';
import { LiveDirectorGroupMixer, type SavedMixGroups } from './live-director/LiveDirectorGroupMixer';
import { LiveDirectorClickMixer } from './live-director/LiveDirectorClickMixer';
import type { GeneratedClickSettings } from '../../utils/liveDirectorGeneratedClick';
import { ChannelStrip, FaderThumb, PrecisionFaderSurface } from './live-director/ChannelStrip';
import { EnsayoQueueAddCard, EnsayoQueueCard, EnsayoQueueSaveCard } from './live-director/EnsayoQueueCard';
import { SongTransitionControl } from './live-director/SongTransitionControl';
import {
  DEFAULT_SONG_TRANSITION, SONG_BLEND_SECONDS, readSongTransitions, transitionAllowsPad, writeSongTransitions,
  type SongTransition,
} from '../../utils/liveDirectorSongTransitions';
import { useLiveDirectorRehearsalDownload } from '../../hooks/useLiveDirectorRehearsalDownload';
import { ManualTempoSongModal } from './live-director/ManualTempoSongModal';
import {
  isNativeLiveDirectorEngineAvailable,
  NativeLiveDirectorEngine,
} from '../../services/NativeLiveDirectorEnginePlugin';
import { IndependentPadPlayer } from '../../services/IndependentPadPlayer';
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
import { applyLiveDirectorSectionOffset, resolveLiveDirectorSessionSections, resolveLiveDirectorTerminalSectionEnd, resolveLiveDirectorReaperTransportTiming } from '../../utils/liveDirectorSongSession';
import { canOpenLiveDirectorSongLoader } from '../../utils/liveDirectorLoadAccess';
import {
  sampleActivityEnvelope,
} from '../../utils/audioActivityEnvelope';
import {
  deleteLiveDirectorSongTrack,
  deleteLiveDirectorSongSession,
  fetchLiveDirectorUploadPermission,
  requestLiveDirectorUploadTarget,
  saveLiveDirectorSectionOffset,
  saveLiveDirectorSongSession,
  uploadFileToLiveDirectorTarget,
} from '../../utils/liveDirectorUploadClient';
import { resolveFetchableAudioUrl } from '../../lib/audio-playback.js';
import { audioSessionService } from '../../services/AudioSessionService';
import {
  isGuideRoutingTrack,
  nextLiveDirectorOutputLayout,
  resolveTrackOutputRoute,
  resolveTrackOutputRouteForLayout,
  toggleGuideTrackOutputRoute,
  type LiveDirectorOutputLayout,
  type TrackOutputRoute,
} from '../../utils/liveDirectorTrackRouting';
import { getPadUrlForSongKey } from '../../utils/padAudio';
import { extractCoverArtFromMp3 } from '../../utils/mp3CoverArt';
import { supportsPreparedSectionJump } from '../../utils/liveDirectorEnginePolicy';
import {
  isLiveDiagnosticsEnabled,
  logLiveDiagnostic,
  readLiveBrowserCapabilities,
} from '../../utils/liveDiagnostics';
import {
  assertLiveDirectorM4aFiles,
  LIVE_DIRECTOR_M4A_ACCEPT,
} from '../../utils/liveDirectorStemFormat';
import { buildLiveDirectorEventMix } from '../../utils/liveDirectorEventMix';
import type {
  LiveDirectorManualSongInput,
  LiveDirectorManualTempo,
} from '../../utils/liveDirectorManualSongs';
import { getManualPulseBpm } from '../../utils/liveDirectorManualSongs';

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
  wavePath: string;
  waveViewBoxWidth: number;
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

type SurfaceView = 'mix' | 'sections' | 'groups';
type LiveDirectorMode = 'director' | 'ensayo';
type LiveDirectorEngineSurface = 'web' | 'ios-native';

type LiveDirectorQueueSong = {
  id: string;
  title: string;
  subtitle?: string;
  mp3?: string;
  artworkUrl?: string;
  kind?: string;
  manualTempo?: LiveDirectorManualTempo;
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

type LiveDirectorEventMixPayload = {
  version: 1;
  tracks: Array<{
    id: string;
    enabled: boolean;
    volume: number;
  }>;
};

type EventMixSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type LiveDirectorBroadcastState = 'off' | 'checking' | 'occupied' | 'active' | 'unavailable';

type LiveDirectorViewProps = {
  experimentalTools?: boolean;
  eventId?: string;
  eventTitle?: string;
  tracks?: TrackData[];
  sections?: Array<SectionVisual | LiveDirectorSectionVisual>;
  title?: string;
  subtitle?: string;
  bpm?: number;
  generatedClickGrid?: Pick<GeneratedClickSettings, 'bpm' | 'originSeconds'>;
  className?: string;
  songId?: string;
  songTitle?: string;
  songMp3?: string;
  songArtworkUrl?: string;
  timeSignature?: { numerator: number; denominator: number };
  songKey?: string;
  initialSession?: LiveDirectorPersistedSession | null;
  requiresSongContext?: boolean;
  mode?: LiveDirectorMode;
  engineSurface?: LiveDirectorEngineSurface;
  maxWebActiveTracks?: number;
  queueSongs?: LiveDirectorQueueSong[];
  activeQueueSongId?: string;
  onPrepareQueueSong?: (songId:string) => Promise<LiveDirectorPersistedSession>;
  /** Enabled stems of a queue song with its event mix, without selecting it. */
  onResolveQueueSongTracks?: (songId:string) => Promise<TrackData[]>;
  onSelectQueueSong?: (songId: string, options?: QueueSelectionOptions) => void;
  autoPlayRequest?: EventPlaybackRequest | null;
  onCancelAutoPlay?: () => void;
  onAutoPlayHandled?: (token: number) => void;
  canAddQueueSong?: boolean;
  onAddQueueSong?: (input: LiveDirectorManualSongInput) => void;
  onRemoveQueueSong?: (songId: string) => void;
  manualTempoConfig?: {
    songId: string;
    bpm: number;
    manualTempo: LiveDirectorManualTempo;
  } | null;
  autoStartPadWithTransport?: boolean;
  operationalChips?: LiveDirectorOperationalChip[];
  liveBroadcastState?: LiveDirectorBroadcastState;
  onToggleLiveBroadcast?: () => void;
  sessionPreparationPending?: boolean;
  internalPadVolume?: number;
  onInternalPadVolumeChange?: (volume: number) => void;
  onPlaybackSnapshot?: (snapshot: LiveDirectorPlaybackSnapshot) => void;
  onSessionPersisted?: (session: LiveDirectorPersistedSession) => void;
  onEventMixChange?: (mix: LiveDirectorEventMixPayload) => Promise<void> | void;
  eventMixSaveStatus?: EventMixSaveStatus;
  onBack?: () => void;
  backLabel?: string;
  returnHref?: string;
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
const MANUAL_CLICK_TRACK_ID = '__manual-click__';
const DISABLE_BACKWARD_SEEK_WHILE_PLAYING = true;
const LIVE_DIRECTOR_COMBINED_MIN_HEIGHT = 900;
const LIVE_DIRECTOR_COMPACT_MAX_HEIGHT = 700;
const CHAIN_MIN_PREPARE_SECONDS = 4;
// Instrucciones «se dicen ahora»: toda la fila de encima del espacio (posición física, sirve igual en
// teclado español e inglés). Lógica: Z baja / X sube (con Shift, el tono), C A capella, V última Vez,
// B entra Batería, M Mantener; los instrumentos van juntos con Shift (B N M ,).
const INSTRUCTION_KEYS: Record<string, string> = {
  KeyZ: 'softly', KeyX: 'build', KeyC: 'a-capella', KeyV: 'last-time', KeyB: 'drums-in', KeyN: 'all-in', KeyM: 'hold',
  Comma: 'break', Period: 'hits', Slash: 'big-ending',
};
const INSTRUCTION_SHIFT_KEYS: Record<string, string> = {
  KeyZ: 'key-change-down', KeyX: 'key-change-up', KeyC: 'swell', KeyB: 'drums', KeyN: 'bass', KeyM: 'keys', Comma: 'guitar',
};
const keyCodeLabel = (code: string) => code === 'Comma' ? ',' : code === 'Period' ? '.' : code === 'Slash' ? '-' : code.replace(/^Key/, '');
const INSTRUCTION_SHORTCUT_LABELS: Record<string, string> = Object.fromEntries([
  ...Object.entries(INSTRUCTION_KEYS).map(([code, key]) => [key, keyCodeLabel(code)]),
  ...Object.entries(INSTRUCTION_SHIFT_KEYS).map(([code, key]) => [key, `⇧${keyCodeLabel(code)}`]),
]);
// Pulsa el botón de la pantalla: mismo comportamiento que con el ratón, incluido cuando está deshabilitado.
const pressLiveDirectorControl = (selector: string) => {
  const control = document.querySelector<HTMLButtonElement>(selector);
  if (!control || control.disabled) return false;
  control.click(); return true;
};
// The internal pad masters are intentionally lush, but their raw gain is too hot
// for live control. Apply a fixed -8 dB trim before the pad reaches either engine.
const INTERNAL_PAD_GAIN_TRIM = Math.pow(10, -8 / 20);
const INTERNAL_PAD_CROSSFADE_SECONDS = 5;
const INTERNAL_PAD_CROSSFADE_MS = INTERNAL_PAD_CROSSFADE_SECONDS * 1000;

// Priority buckets for auto-disabling extras when a session has more
// enabled stems than the platform can run. Lower number = more important
// (kept in the mix). Names are matched case-insensitively; anything not
// matched falls into the generic bucket and loses ties to recognized
// roles. The list mirrors the roles that are essential for live worship:
// click → guide → rhythm section → voices → harmonic → colour.
const STEM_PRIORITY_RULES: Array<{ rank: number; pattern: RegExp }> = [
  { rank: 0, pattern: /\b(click|clic|clcik|tempo|metro|metronom[oe]?)\b/i },
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

function isCongregationCueTrack(track: { name?: string; label?: string; id?: string }): boolean {
  return stemPriorityRank(track) <= 1;
}

function mixerRoleRank(track: { name?: string; label?: string; id?: string }): number {
  const priority = stemPriorityRank(track);
  if (priority === 0) return 0;
  if (priority === 1) return 1;
  return 2;
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
const SECTION_WAVE_BAR_INSET_PX = 16;
const SECTION_WAVE_BAR_MIN_COUNT = 7;
const SECTION_TRANSITION_FADE_OUT_MS = 170;
const SECTION_TRANSITION_FADE_IN_MS = 180;
const CONGREGATION_FADE_MS = 5000;
const SECTIONS_AUTO_FOLLOW_RESUME_MS = 5000;
const SECTION_DRAG_CLICK_SUPPRESS_THRESHOLD_PX = 8;
const SEQUENCE_FILE_ACCEPT = LIVE_DIRECTOR_M4A_ACCEPT;

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
const PASSIVE_LIVE_SYNC_SNAPSHOT_INTERVAL_MS = 250;
const PASSIVE_TELEMETRY_UI_INTERVAL_MS = 1000 / 24;

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
  tracks: Array<Pick<TrackData, 'id' | 'name' | 'sourceFileName' | 'outputRoute'>>,
  layout: LiveDirectorOutputLayout = 'guide-left',
): Record<string, TrackOutputRoute> => (
  tracks.reduce<Record<string, TrackOutputRoute>>((routes, track) => {
    routes[track.id] = resolveTrackOutputRouteForLayout(track, layout);
    return routes;
  }, {})
);

const toResolvedSession = (
  session: LiveDirectorPersistedSession,
): LiveDirectorResolvedSession => ({
  songId: session.songId,
  sectionMarkers: session.sectionMarkers,
  instructionMarkers: session.instructionMarkers,
  reaperTiming: session.reaperTiming,
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

export function LiveDirectorView({
  experimentalTools = false,
  tracks,
  sections = DEFAULT_SECTIONS,
  title = 'Sunday AM',
  subtitle = 'Battle Belongs',
  bpm: catalogBpm = 81,
  generatedClickGrid: catalogClickGrid,
  className = '',
  eventId = '',
  eventTitle = '',
  songId = '',
  songTitle = '',
  songMp3 = '',
  songArtworkUrl = '',
  timeSignature: catalogTimeSignature,
  songKey = '',
  initialSession = null,
  requiresSongContext = false,
  mode = 'director',
  engineSurface = 'web',
  maxWebActiveTracks = WEB_ENGINE_MAX_ACTIVE_TRACKS,
  queueSongs = EMPTY_QUEUE_SONGS,
  activeQueueSongId = '',
  onSelectQueueSong,
  onPrepareQueueSong,
  onResolveQueueSongTracks,
  autoPlayRequest = null,
  onCancelAutoPlay,
  onAutoPlayHandled,
  canAddQueueSong = false,
  onAddQueueSong,
  onRemoveQueueSong,
  manualTempoConfig = null,
  autoStartPadWithTransport = false,
  liveBroadcastState = 'off',
  onToggleLiveBroadcast,
  sessionPreparationPending = false,
  internalPadVolume,
  onInternalPadVolumeChange,
  onPlaybackSnapshot,
  onSessionPersisted,
  onEventMixChange,
  eventMixSaveStatus = 'idle',
  onBack,
  backLabel,
  returnHref,
}: LiveDirectorViewProps) {
  const isManualTempoMode = Boolean(manualTempoConfig);
  const hasProvidedTracks = Boolean(tracks && tracks.length > 0);
  const hasPersistedSongContext = Boolean(songId);
  const isSongBoundView = requiresSongContext || hasPersistedSongContext;
  const canLoadManualSession = canOpenLiveDirectorSongLoader({
    isManualTempoMode,
    hasPersistedSongContext,
    hasProvidedTracks,
    requiresSongContext,
  });
  const usesEventMixPersistence = mode === 'ensayo' && Boolean(onEventMixChange);
  const sequenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const singleStemInputRef = useRef<HTMLInputElement | null>(null);
  const sectionsLaneScrollRef = useRef<HTMLDivElement | null>(null);
  const sectionsLaneScrollLeftRef = useRef(0);
  const passiveSectionIndexRef = useRef<number | null>(null);
  const [passiveActiveSectionIndex, setPassiveActiveSectionIndex] = useState<number | null>(null);
  const sectionsMinimapViewportRef = useRef<HTMLDivElement | null>(null);
  const updateSectionsMinimapViewportRef = useRef<((scrollLeft: number) => void) | null>(null);
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
  const independentPadPlayerRef = useRef<IndependentPadPlayer | null>(null);
  const padGestureStartUrlRef = useRef<string | null>(null);
  const autoPadStartRef = useRef<() => void>(() => undefined);
  const autoPadStartedForTransportRef = useRef('');
  const autoPadOwnedByFallbackRef = useRef(false);
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
  const masterVolumeRef = useRef(experimentalTools ? 1 : 0.82);
  const appliedMasterVolumeRef = useRef(experimentalTools ? 1 : 0.82);
  const masterVolumeFadeFrameRef = useRef<number | null>(null);
  const masterVolumeFadeResolveRef = useRef<(() => void) | null>(null);
  const congregationMutedRef = useRef(false);
  const congregationFadeFrameRef = useRef<number | null>(null);
  const congregationFadeResolveRef = useRef<(() => void) | null>(null);
  const congregationFadeTokenRef = useRef(0);
  const congregationOriginalVolumesRef = useRef<Map<string, number>>(new Map());
  const congregationAppliedVolumesRef = useRef<Map<string, number>>(new Map());
  const congregationPadGainRef = useRef(1);
  const resumeNativeMetersTimeoutRef = useRef<number | null>(null);
  const passiveTelemetryFrameRef = useRef<number | null>(null);
  const passiveCurrentTimeRef = useRef(0);
  const lastPassiveUiFrameAtRef = useRef(0);
  const lastPassiveLiveSyncSnapshotAtRef = useRef(0);
  const visualSectionTimeRef = useRef<number | null>(null);
  const passiveClockTextRef = useRef<HTMLSpanElement | null>(null);
  const passiveCompactClockTextRef = useRef<HTMLSpanElement | null>(null);
  const passiveProgressTextRef = useRef<HTMLSpanElement | null>(null);
  const passiveProgressBarRef = useRef<HTMLDivElement | null>(null);
  const passiveMixerLevelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const passiveSectionPlayheadRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const passiveMinimapPlayheadRef = useRef<HTMLDivElement | null>(null);
  // Mapa de secciones (barra de toda la canción bajo el carril): desplegable y oculto por defecto para
  // ganar alto y quitar ruido. Se recuerda en este dispositivo.
  const [showSectionMap, setShowSectionMap] = useState(() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('live-director:section-map') === 'open'; } catch { return false; }
  });
  const toggleSectionMap = useCallback(() => setShowSectionMap(previous => {
    try { localStorage.setItem('live-director:section-map', previous ? 'closed' : 'open'); } catch { /* solo se pierde el recuerdo */ }
    return !previous;
  }), []);
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
  const eventMixFlushRef = useRef<() => void>(() => undefined);
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
  const passiveStreamingTelemetryEnabled =
    !isIOSNativeEngineSurface && useStreamingEngine && canUseSharedStreamingTelemetry();
  const webMultitrackEngine = useMultitrackEngine({
    useStreamingEngine,
    passiveTelemetry: passiveStreamingTelemetryEnabled,
  });
  const nativeIOSMultitrackEngine = useNativeIOSMultitrackEngine();
  const selectedMultitrackEngine = isIOSNativeEngineSurface
    ? nativeIOSMultitrackEngine
    : webMultitrackEngine;
  const manualTempoTransport = useLiveDirectorManualTempoTransport(manualTempoConfig);
  const {
    currentTime: engineCurrentTime,
    duration: enginePlaybackDuration,
    diagnostics,
    initialize: initializeEngine,
    isPlaying: engineIsPlaying,
    isReady: engineIsReady,
    play: playEngine,
    pause: pauseEngine,
    seekTo: seekEngineTo,
    setMasterVolume: setEngineMasterVolume,
    setTrackOutputRoute: setEngineTrackOutputRoute,
    setVolume: setEngineTrackVolume,
    soloTrack: soloEngineTrack,
    stop: stopEngine,
    trackLevels,
    trackEnvelopes,
    toggleMute: toggleEngineMute,
    trackVolumes,
    loadProgress,
    loadWarnings,
  } = selectedMultitrackEngine;
  const currentTime = isManualTempoMode
    ? manualTempoTransport.currentTime
    : engineCurrentTime;
  const playbackDuration = isManualTempoMode
    ? manualTempoTransport.duration
    : enginePlaybackDuration;
  const isPlaying = isManualTempoMode
    ? manualTempoTransport.isPlaying
    : engineIsPlaying;
  const isReady = isManualTempoMode
    ? manualTempoTransport.isReady
    : engineIsReady;
  const play = useCallback(
    () => (isManualTempoMode ? manualTempoTransport.play() : playEngine()),
    [isManualTempoMode, manualTempoTransport.play, playEngine],
  );
  const pause = useCallback(() => {
    if (isManualTempoMode) {
      manualTempoTransport.pause();
      return;
    }
    pauseEngine();
  }, [isManualTempoMode, manualTempoTransport.pause, pauseEngine]);
  const seekTo = useCallback((
    nextTime: number,
    options?: {
      forceFreshStart?: boolean;
      wasPlayingBeforeUiSeek?: boolean;
    },
  ) => (
    isManualTempoMode
      ? manualTempoTransport.seekTo(nextTime)
      : seekEngineTo(nextTime, options)
  ), [isManualTempoMode, manualTempoTransport.seekTo, seekEngineTo]);
  const stop = useCallback(() => {
    if (isManualTempoMode) {
      manualTempoTransport.stop();
      return;
    }
    stopEngine();
  }, [isManualTempoMode, manualTempoTransport.stop, stopEngine]);
  const setMasterVolume = useCallback((nextVolume: number) => {
    if (isManualTempoMode) {
      manualTempoTransport.setMasterVolume(nextVolume);
      return;
    }
    setEngineMasterVolume(nextVolume);
  }, [isManualTempoMode, manualTempoTransport.setMasterVolume, setEngineMasterVolume]);
  const setTrackOutputRoute = setEngineTrackOutputRoute;
  const setVolume = useCallback((trackId: string, nextVolume: number) => {
    if (isManualTempoMode && trackId === MANUAL_CLICK_TRACK_ID) {
      manualTempoTransport.setVolume(nextVolume);
      return;
    }
    setEngineTrackVolume(trackId, nextVolume);
  }, [isManualTempoMode, manualTempoTransport.setVolume, setEngineTrackVolume]);
  const soloTrack = useCallback((trackId: string) => {
    if (isManualTempoMode && trackId === MANUAL_CLICK_TRACK_ID) return;
    soloEngineTrack(trackId);
  }, [isManualTempoMode, soloEngineTrack]);
  const toggleMute = useCallback((trackId: string) => {
    if (isManualTempoMode && trackId === MANUAL_CLICK_TRACK_ID) {
      manualTempoTransport.toggleMute();
      return;
    }
    toggleEngineMute(trackId);
  }, [isManualTempoMode, manualTempoTransport.toggleMute, toggleEngineMute]);
  const passiveStreamingTelemetryActive =
    !isManualTempoMode
    && passiveStreamingTelemetryEnabled
    && diagnostics?.engineMode === 'streaming';
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
  const eventAdvanceRef = useRef<{ cancel: () => boolean; complete: () => void } | null>(null);
  const eventArrangementBlockedRef = useRef(false);
  const musicalNavigationRef = useRef<{cancel:()=>boolean}|null>(null);
  const musicalNavigationPendingRef = useRef(false);
  const sectionJumpActiveRef = useRef(false);
  const entryCountCancelRef = useRef<(() => boolean) | null>(null);
  const entryCountStartRef = useRef<(() => Promise<void>) | null>(null);
  const entryCountNeedsRef = useRef<(() => boolean) | null>(null);
  const cancelGestureConsumedRef = useRef(false);
  const cancelAutomaticAdvancePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // A new physical gesture always clears any click left over from cancellation.
    cancelGestureConsumedRef.current = false;
    if (!eventAdvanceRef.current?.cancel()) return;
    cancelGestureConsumedRef.current = true;
    event.preventDefault(); event.stopPropagation();
  }, []);
  const cancelAutomaticAdvanceClick = useCallback((event: import('react').MouseEvent<HTMLDivElement>) => {
    const consumed = cancelGestureConsumedRef.current;
    cancelGestureConsumedRef.current = false;
    if (!consumed && !eventAdvanceRef.current?.cancel()) return;
    event.preventDefault(); event.stopPropagation();
  }, []);
  const currentSessionPreparedRef = useRef(false);
  const prepareArrangementPlayRef = useRef<(() => boolean) | null>(null);
  const isTransportCueBusyRef = useRef(false);
  const getVisualClockTime = useCallback(() => (
    isManualTempoMode
      ? manualTempoTransport.getCurrentTimeSnapshot()
      : selectedMultitrackEngine.getCurrentTimeSnapshot()
  ), [isManualTempoMode, manualTempoTransport.getCurrentTimeSnapshot, selectedMultitrackEngine]);

  const handleTogglePlaybackFromGesture = useCallback(() => {
    if (eventAdvanceRef.current?.cancel()) return;
    if (entryCountCancelRef.current?.()) return;
    if (!currentSessionPreparedRef.current || isTransportCueBusyRef.current || eventArrangementBlockedRef.current) {
      return;
    }

    if (isPlaying) {
      pause();
      return;
    }

    if (isManualTempoMode) {
      if (autoStartPadWithTransport) {
        autoPadStartRef.current();
      }
      void play().catch((error) => {
        console.warn('[LiveDirectorView] No se pudo iniciar el click manual.', error);
      });
      return;
    }

    if (prepareArrangementPlayRef.current?.()) return;
    if (entryCountNeedsRef.current?.() && entryCountStartRef.current) {
      void unlockAudioForUserGesture();
      void entryCountStartRef.current().catch(error => { if(error?.name !== 'AbortError') console.warn('[LiveDirectorView] Entry count failed.',error); });
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
  }, [autoStartPadWithTransport, isManualTempoMode, isPlaying, pause, play, unlockAudioForUserGesture]);

  useEffect(() => {
    visualClockReaderRef.current = getVisualClockTime;
  }, [getVisualClockTime]);

  useEffect(() => {
    if (!isManualTempoMode) return;

    if (passiveClockTextRef.current) {
      passiveClockTextRef.current.textContent = formatClock(currentTime);
    }
    if (passiveCompactClockTextRef.current) {
      passiveCompactClockTextRef.current.textContent = `${formatCompact(currentTime)} / LIBRE`;
    }
    if (passiveProgressTextRef.current) {
      passiveProgressTextRef.current.textContent = `${formatCompact(currentTime)} / LIBRE`;
    }
  }, [currentTime, isManualTempoMode]);

  const initializeEngineRef = useRef(initializeEngine);
  const stopEngineRef = useRef(stopEngine);

  useEffect(() => {
    initializeEngineRef.current = initializeEngine;
    stopEngineRef.current = stopEngine;
  }, [initializeEngine, stopEngine]);

  const transportIdentity = `${eventId}:${String(activeQueueSongId || songId || '').trim()}:${isManualTempoMode ? 'tempo' : 'stems'}`;
  const transportIdentityRef = useRef(transportIdentity); transportIdentityRef.current = transportIdentity;
  useEffect(() => {
    autoPadStartedForTransportRef.current = '';
    setOutputLayout('guide-left');
    stopEngineRef.current();
  }, [transportIdentity]);

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
  // Teléfono en horizontal: la tira de canciones se abre con «Canciones» (como la lista de Playback)
  // para que los faders y la columna lateral quepan completos.
  const [showPhoneSongStrip, setShowPhoneSongStrip] = useState(false);
  const [hasFinePointer, setHasFinePointer] = useState(false);
  useEffect(() => {
    const query = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
    if (!query) return;
    const update = () => setHasFinePointer(query.matches);
    update(); query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  const [isNativeIosShell, setIsNativeIosShell] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [sectionsLaneViewportWidth, setSectionsLaneViewportWidth] = useState(0);
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
  const reaperTransport = !isManualTempoMode ? resolveLiveDirectorReaperTransportTiming(manualSession) : null;
  const bpm = reaperTransport?.bpm ?? catalogBpm;
  const generatedClickGrid = reaperTransport?.clickGrid ?? catalogClickGrid;
  const timeSignature = reaperTransport?.timeSignature ?? catalogTimeSignature;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sectionOffsetSaveError, setSectionOffsetSaveError] = useState<string | null>(null);
  const [dismissedLoadWarningKey, setDismissedLoadWarningKey] = useState<string | null>(null);
  const [browserPlaybackRecommendation, setBrowserPlaybackRecommendation] = useState('');
  const [trackLimitNotice, setTrackLimitNotice] = useState<{
    key: string;
    names: string[];
    limit: number;
    total: number;
  } | null>(null);
  const [dismissedTrackLimitNoticeKey, setDismissedTrackLimitNoticeKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { passiveSectionIndexRef.current = null; setPassiveActiveSectionIndex(null); }, [songId, reloadKey]);
  const [isInitializingSession, setIsInitializingSession] = useState(false);
  const [isSectionSeekBusy, setIsSectionSeekBusy] = useState(false);
  const [canManageLiveDirectorUploads, setCanManageLiveDirectorUploads] = useState(!hasPersistedSongContext);
  const canManagePersistedSongSession = !hasPersistedSongContext || canManageLiveDirectorUploads;
  const canOpenLoadPanel = canLoadManualSession && canManagePersistedSongSession;
  const [showLoadPanel, setShowLoadPanel] = useState(canOpenLoadPanel && !initialSession);
  // When the user taps Back while audio is playing, defer the navigation and
  // show a confirmation modal. Prevents disastrous accidental exits live.
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [showRedownloadConfirm, setShowRedownloadConfirm] = useState(false);
  const [showManualTempoModal, setShowManualTempoModal] = useState(false);

  useEffect(() => {
    if (isManualTempoMode) {
      setShowLoadPanel(false);
    }
  }, [isManualTempoMode]);

  useEffect(() => {
    const capabilities = readLiveBrowserCapabilities();
    if (!capabilities.isFirefox) return;

    if (capabilities.isAndroid) {
      setBrowserPlaybackRecommendation('Firefox en Android puede rechazar stems AAC. Para este ensayo usa Chrome.');
      return;
    }
    if (capabilities.isIOS) {
      setBrowserPlaybackRecommendation('Para mayor compatibilidad con stems AAC en iPhone o iPad, usa Safari.');
      return;
    }
    setBrowserPlaybackRecommendation('Firefox puede limitar la reproducción multitrack. Prueba Chrome o Safari.');
  }, []);

  const exitLiveDirector = useCallback(async () => {
    eventAdvanceRef.current?.cancel();
    setShowBackConfirm(false);
    if (usesEventMixPersistence) {
      eventMixFlushRef.current();
    }

    try {
      stop();
      if (isNativeLiveDirectorEngineAvailable()) {
        await NativeLiveDirectorEngine.stop();
        await NativeLiveDirectorEngine.clearNowPlayingMetadata().catch(() => undefined);
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
      const safeReturnHref = String(returnHref || '').trim();
      if (safeReturnHref.startsWith('/')) {
        window.location.replace(safeReturnHref);
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.replace('/repertorio');
      }
    }
  }, [onBack, returnHref, stop, usesEventMixPersistence]);

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
  const [outputLayout, setOutputLayout] = useState<LiveDirectorOutputLayout>('guide-left');
  const [trackOutputRoutes, setTrackOutputRoutes] = useState<Record<string, TrackOutputRoute>>({});
  const [soloTrackIds, setSoloTrackIds] = useState<Set<string>>(() => new Set());
  const [masterVolume, setMasterVolumeState] = useState(experimentalTools ? 1 : 0.82);
  const [masterMeterTarget, setMasterMeterTarget] = useState<HTMLDivElement | null>(null);
  const songLevel = useLiveDirectorSongLevel(`${eventId || 'independent'}:${songId || activeQueueSongId || songTitle}`);
  const [congregationFadeState, setCongregationFadeState] = useState<
    'normal' | 'fading-out' | 'muted' | 'fading-in'
  >('normal');
  const isCongregationFading =
    congregationFadeState === 'fading-out' || congregationFadeState === 'fading-in';
  const congregationFadeTargetMuted =
    congregationFadeState === 'fading-out' || congregationFadeState === 'muted';
  const [congregationPadGain, setCongregationPadGain] = useState(1);
  const [surfaceView, setSurfaceView] = useState<SurfaceView>('mix');
  const [showOffsetModal, setShowOffsetModal] = useState(false);
  const [showStemsActionModal, setShowStemsActionModal] = useState(false);
  const [showTrackLoadModal, setShowTrackLoadModal] = useState(false);
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null);
  const [pendingEnabledMap, setPendingEnabledMap] = useState<Record<string, boolean> | null>(null);
  const [isReturnToStartBusy, setIsReturnToStartBusy] = useState(false);
  const isTransportCueBusy = isReturnToStartBusy || isSectionSeekBusy;
  isTransportCueBusyRef.current = isTransportCueBusy;
  useEffect(() => { setIsReturnToStartBusy(false); isTransportCueBusyRef.current = false; }, [transportIdentity]);
  const offsetModalInitialValueRef = useRef<number | null>(null);
  const [isPadActive, setIsPadActive] = useState(false);

  useEffect(() => {
    if (isManualTempoMode) {
      setSurfaceView('mix');
    }
  }, [isManualTempoMode]);
  const [internalPadVolumeState, setInternalPadVolumeState] = useState(0.34);
  const [songCoverArtUrl, setSongCoverArtUrl] = useState<string | null>(null);
  const [queueSongCoverArtMap, setQueueSongCoverArtMap] = useState<Record<string, string | null>>({});
  const getLivePlaybackTime = useCallback(() => {
    if (visualSectionTimeRef.current !== null) {
      return visualSectionTimeRef.current;
    }

    return passiveStreamingTelemetryActive ? passiveCurrentTimeRef.current : currentTime;
  }, [currentTime, passiveStreamingTelemetryActive]);
  const setVisualSectionTime = useCallback((nextTime: number | null) => {
    visualSectionTimeRef.current = nextTime;
    setVisualSectionTimeState(nextTime);
  }, []);
  const isEnsayoMode = mode === 'ensayo';
  const showLiveBroadcastControl =
    isEnsayoMode
    && !isManualTempoMode
    && typeof onToggleLiveBroadcast === 'function';
  const resolvedBackLabel = String(
    backLabel || (isEnsayoMode ? 'Volver al modo ensayo' : 'Volver al repertorio'),
  ).trim();
  const resolvedBackActionLabel = isEnsayoMode ? 'Volver al ensayo' : 'Ir a repertorio';
  const resolvedInternalPadVolume = clamp(
    Number.isFinite(Number(internalPadVolume)) ? Number(internalPadVolume) : internalPadVolumeState,
    0,
    1,
  );
  const effectiveInternalPadVolume = clamp(
    resolvedInternalPadVolume * INTERNAL_PAD_GAIN_TRIM * congregationPadGain,
    0,
    1,
  );
  const resolvedPadUrl = useMemo(() => getPadUrlForSongKey(songKey), [songKey]);
  const shouldUseNativePadBridge = Boolean(isIOSNativeEngineSurface && isEnsayoMode && resolvedPadUrl);
  const setPadActiveFromGesture = useCallback((
    nextValue: boolean | ((previous: boolean) => boolean),
  ) => {
    const resolvedNextValue = typeof nextValue === 'function'
      ? nextValue(isPadActive)
      : nextValue;

    if (resolvedNextValue && !isIOSNativeEngineSurface && resolvedPadUrl) {
      // Start while WebKit still recognizes the tap/key as a user gesture.
      padGestureStartUrlRef.current = resolvedPadUrl;
      void independentPadPlayerRef.current?.switchTo(
        resolvedPadUrl,
        effectiveInternalPadVolume,
      ).then((result) => {
        if (result.status === 'failed') {
          padGestureStartUrlRef.current = null;
          setIsPadActive(false);
        }
      });
    } else if (!resolvedNextValue) {
      padGestureStartUrlRef.current = null;
      autoPadOwnedByFallbackRef.current = false;
    }
    setIsPadActive(resolvedNextValue);
  }, [effectiveInternalPadVolume, isIOSNativeEngineSurface, isPadActive, resolvedPadUrl]);
  autoPadStartRef.current = () => {
    const songIdentity = String(activeQueueSongId || songId || '').trim();
    if (
      !autoStartPadWithTransport
      || !songIdentity
      || !resolvedPadUrl
      || isPadActive
      || autoPadStartedForTransportRef.current === songIdentity
    ) {
      return;
    }

    autoPadStartedForTransportRef.current = songIdentity;
    autoPadOwnedByFallbackRef.current = true;
    setPadActiveFromGesture(true);
  };
  useEffect(() => {
    if (autoStartPadWithTransport || !autoPadOwnedByFallbackRef.current) {
      return;
    }

    setPadActiveFromGesture(false);
  }, [autoStartPadWithTransport, setPadActiveFromGesture, transportIdentity]);
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
          ? (showLiveBroadcastControl ? '39rem' : '34rem')
          : scaleRem(58, 46)
    ),
    [isToolbarCompactLandscape, isUltraCompactLandscape, scaleRem, showLiveBroadcastControl],
  );
  const toolbarHeaderStyle = useMemo<CSSProperties>(
    () => (
      isToolbarCompactLandscape
        ? { minWidth: headerMinWidth }
        : {
          minWidth: headerMinWidth,
          gridTemplateColumns: experimentalTools
            ? (showLiveBroadcastControl ? '31% 2% 43% 2% 22%' : '33% 2% 47% 2% 16%')
            : showLiveBroadcastControl ? '33% 2% 47% 2% 16%' : '35% 3% 49% 5% 8%',
        }
    ),
    [experimentalTools, headerMinWidth, isToolbarCompactLandscape, showLiveBroadcastControl],
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
    () => {
      if (hasProvidedTracks) return tracks || [];
      // Props can switch to the next song one render before local state syncs.
      if (songId && manualSession?.songId && manualSession.songId !== songId) return [];
      return manualSession?.tracks || [];
    },
    [hasProvidedTracks, manualSession?.songId, manualSession?.tracks, songId, tracks],
  );

  const trackRouteSeedSignature = useMemo(
    () => sessionTracks
      .map((track) => `${track.id}:${track.name}:${track.sourceFileName || ""}`)
      .join('|'),
    [sessionTracks],
  );

  const seededTrackOutputRoutes = useMemo(
    () => buildTrackOutputRouteMap(sessionTracks, outputLayout),
    [outputLayout, trackRouteSeedSignature],
  );

  const activeTrackWarningThreshold = useMemo(() => {
    // Runtime diagnostics change during startup and fallback. They must not
    // change the requested track set and cancel/restart the load in progress.
    const synchronizedStreamingActive = useStreamingEngine && canRunAdvancedStreamingEngine;

    if (synchronizedStreamingActive) {
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
  const synchronizedStreamingExpected = diagnostics
    ? diagnostics.engineRoute === 'streaming-worker'
    : useStreamingEngine && canRunAdvancedStreamingEngine;
  const trackLoadGuidanceText = synchronizedStreamingExpected
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
  const engineMixAtLoadEndRef = useRef({ tracks: activeEngineTracks, setVolume: setEngineTrackVolume });
  engineMixAtLoadEndRef.current = { tracks: activeEngineTracks, setVolume: setEngineTrackVolume };

  const hasSessionTracks = sessionTracks.length > 0;
  const hasTrackSession = activeTracks.length > 0;
  const hasPlayableSession = hasTrackSession || isManualTempoMode;
  const currentSessionLabel = hasProvidedTracks
    ? subtitle
    : manualSession?.sessionLabel || songTitle || 'Sin sesion cargada';
  const inferredSessionMode = manualSession?.mode || (sessionTracks.length > 1 ? 'folder' : 'sequence');
  const sessionModeLabel = isManualTempoMode
    ? 'Click + Pad'
    : !hasSessionTracks
      ? 'Sin preparar'
    : inferredSessionMode === 'folder'
      ? `${activeTracks.length} stem${activeTracks.length === 1 ? '' : 's'} activo${activeTracks.length === 1 ? '' : 's'}`
      : 'Secuencia unica';
  const canToggleTrackLoad = !hasProvidedTracks && manualSession?.mode === 'folder' && sessionTracks.length > 1;
  const canOpenStemsActionModal = !hasProvidedTracks && canManagePersistedSongSession && hasPersistedSongContext;
  const canAddSingleStem = !hasProvidedTracks
    && canManagePersistedSongSession
    && hasPersistedSongContext
    && manualSession?.mode === 'folder'
    && sessionTracks.length > 0;
  const canManageStemSelection = canAddSingleStem || (experimentalTools && canToggleTrackLoad);
  const canUseStemsToolbar = canManageStemSelection || canOpenStemsActionModal;
  const isStemsToolbarActive = canToggleTrackLoad && enabledSessionTracks.length !== sessionTracks.length;
  const useWideTrackLoadModal = !isPortrait;
  // Secciones y mezcla juntas solo con pantalla de 1080 o más (≈900 px útiles con el navegador maximizado).
  // En pantallas menores (768, 800, 900) las secciones se abren con el botón «Secciones» (V).
  const desktopCombined = experimentalTools && !isManualTempoMode && viewportWidth >= 1100 && viewportHeight >= LIVE_DIRECTOR_COMBINED_MIN_HEIGHT;
  const showSectionsPanel = (desktopCombined || surfaceView === 'sections') && !isManualTempoMode;
  const showGroupsPanel = surfaceView === 'groups' && experimentalTools && !isManualTempoMode;
  const showMixReturn = !desktopCombined && (showSectionsPanel || showGroupsPanel);
  const displayBpm = Number.isFinite(Number(bpm)) ? Math.max(0, Math.round(Number(bpm) * 1000) / 1000) : 0;
  const canTogglePulseSubdivision = isManualTempoMode && displayBpm > 0;
  const displayedPulseBpm = canTogglePulseSubdivision
    ? getManualPulseBpm(displayBpm, manualTempoTransport.pulseSubdivision)
    : displayBpm;
  const pulseSubdivisionLabel = manualTempoTransport.pulseMultiplier === 2
    ? 'CORCHEAS'
    : manualTempoTransport.pulseMultiplier === 4
      ? 'SEMICORCHEAS'
      : 'NEGRAS';
  const bpmControlLabel = canTogglePulseSubdivision
    ? manualTempoTransport.pulseMultiplier === 2
      ? `${displayedPulseBpm} pulsos por minuto en corcheas. Tocar para volver a negras.`
      : `${displayedPulseBpm} pulsos por minuto en ${pulseSubdivisionLabel.toLowerCase()}. Tocar para activar corcheas a ${displayBpm * 2} pulsos por minuto.`
    : displayBpm
      ? `${displayBpm} BPM. La secuencia controla el tempo.`
      : 'Sin BPM';
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
  const sourceAudioDuration = selectedMultitrackEngine.getDurationSnapshot?.() ?? playbackDuration;
  const sourceSections = useMemo(
    () => {
      const sessionSections = resolveLiveDirectorSessionSections(manualSession, sections)
        || DEFAULT_SECTIONS as LiveDirectorSectionVisual[];
      const shifted = applyLiveDirectorSectionOffset(sessionSections, sectionOffsetSeconds) || sessionSections;
      return experimentalTools ? resolveLiveDirectorTerminalSectionEnd(shifted, sourceAudioDuration) : shifted;
    },
    [experimentalTools, sourceAudioDuration, sectionOffsetSeconds, sections, manualSession?.sectionMarkers],
  );
  // RPP instructions share the section offset; they are spoken cues, never section cards.
  const guideInstructions = useMemo(
    () => (manualSession?.instructionMarkers || []).map(cue => ({ ...cue, startSec: Math.max(0, cue.startSec + sectionOffsetSeconds) })),
    [manualSession?.instructionMarkers, sectionOffsetSeconds],
  );

  const eventArrangement = useLiveDirectorEventArrangement(isManualTempoMode ? '' : eventId, songId);
  const arrangementIdentity = `${eventId}:${songId}:${reloadKey}:${sectionOffsetSeconds}`;
  const [arrangementState, setArrangementState] = useState<{ key: string; entries: ArrangementEntry[] | null }>({ key: '', entries: null });
  const arrangementEntries = arrangementState.key === arrangementIdentity ? arrangementState.entries : eventArrangement.entries;
  const [showArrangementEditor, setShowArrangementEditor] = useState(false);
  useEffect(() => {
    setShowArrangementEditor(false);
    setArrangementState({ key: '', entries: null });
  }, [arrangementIdentity]);
  eventArrangementBlockedRef.current = showArrangementEditor || eventArrangement.loading || Boolean(eventArrangement.error);
  const arrangementCursor = useRef(0);
  const manualArrangementNavigation = useRef(false);
  const resolvedSections = useMemo(() => arrangementEntries ? resolveArrangement(sourceSections, arrangementEntries) : sourceSections, [sourceSections, arrangementEntries]);
  const arrangement = useLiveDirectorArrangement({
    enabled: experimentalTools && Boolean(arrangementEntries), resetKey: `${arrangementIdentity}:${arrangementEntries?.map(entry => entry.id).join('|') ?? 'original'}`,
    sections: resolvedSections, playing: isPlaying, ready: isReady, busy: isSectionSeekBusy || isCongregationFading,
    cursor: arrangementCursor, manualNavigation: manualArrangementNavigation,
    getTime: selectedMultitrackEngine.getCurrentTimeSnapshot, pause: selectedMultitrackEngine.pause,
    prepare: selectedMultitrackEngine.prepareSectionJump, cancel: selectedMultitrackEngine.cancelSectionJump,
    scheduleEnd: selectedMultitrackEngine.scheduleSectionEnd,
    onCompleted: () => eventAdvanceRef.current?.complete(),
  });

  prepareArrangementPlayRef.current = () => {
    if (!arrangementEntries || !resolvedSections.length) return false;
    const time = selectedMultitrackEngine.getCurrentTimeSnapshot();
    const section = resolvedSections[arrangementCursor.current];
    if (section && time >= section.startTime && time < section.endTime) return false;
    const first = resolvedSections[0];
    void Promise.allSettled([unlockAudioForUserGesture(), audioSessionService.unlockFromUserGesture()]);
    isTransportCueBusyRef.current = true;
    arrangement.focus(first.id);
    const identity = transportIdentityRef.current;
    void seekTo(first.startTime, { wasPlayingBeforeUiSeek: false }).then(() => { if (transportIdentityRef.current !== identity) return; return entryCountStartRef.current?.() ?? play(); }).catch(reason => {
      setLoadError(reason instanceof Error ? reason.message : 'No se pudo preparar el arreglo.');
    }).finally(() => { isTransportCueBusyRef.current = false; });
    return true;
  };

  const sectionTimelineDuration = useMemo(
    () => resolvedSections.reduce((maxTime, section) => Math.max(maxTime, section.endTime), 0),
    [resolvedSections],
  );
  const playbackTimelineDuration = useMemo(
    () => Math.max(sectionTimelineDuration, hasTrackSession ? playbackDuration : 0, hasTrackSession ? currentTime : 0),
    [currentTime, hasTrackSession, playbackDuration, sectionTimelineDuration],
  );
  const navigationDuration = arrangementEntries ? arrangementDuration(resolvedSections) : playbackTimelineDuration;
  const navigationSections = useMemo(() => arrangementEntries ? arrangementTimeline(resolvedSections) : resolvedSections, [arrangementEntries, resolvedSections]);
  const getNavigationTime = useCallback((sourceTime: number) => arrangementEntries ? arrangementElapsed(resolvedSections, arrangementCursor.current, sourceTime) : sourceTime, [arrangementEntries, resolvedSections]);
  const navigationTime = getNavigationTime(currentTime);
  const sectionTimelineTailDuration = arrangementEntries ? 0 : Math.max(0, playbackTimelineDuration - sectionTimelineDuration);
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
        const wave = buildWavePath(index + 1, waveBarCount);
        const segment: SectionLaneSegment = {
          section,
          wavePath: wave.path,
          waveViewBoxWidth: wave.viewBoxWidth,
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
    if (arrangementEntries) {
      const index = arrangementCursor.current;
      const section = resolvedSections[index];
      if (section && (safeTime >= section.startTime && safeTime <= section.endTime || index === 0 && safeTime < section.startTime)) return index;
    }
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
  }, [arrangementEntries, resolvedSections, sectionTimelineDuration]);

  const publishPlaybackSnapshot = useCallback((timeInSeconds: number, playing: boolean) => {
    if (!songId || !onPlaybackSnapshot) {
      return;
    }

    const rawTime = Math.max(0, Number(timeInSeconds) || 0);
    onPlaybackSnapshot({
      songId,
      sectionIndex: getSectionIndexAtTime(rawTime),
      currentTime: Math.max(0, rawTime - sectionOffsetSeconds),
      currentTimeRaw: rawTime,
      sectionOffsetSeconds,
      isPlaying: playing,
    });
  }, [getSectionIndexAtTime, onPlaybackSnapshot, sectionOffsetSeconds, songId]);

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

    if (!arrangementEntries && safeTime >= sectionTimelineDuration) {
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
  }, [arrangementEntries, getSectionIndexAtTime, playbackTimelineDuration, sectionLaneSegments, sectionTimelineDuration]);

  const progressPercent = navigationDuration > 0 ? clamp(navigationTime / navigationDuration, 0, 1) * 100 : 0;

  // Passive playback writes these labels directly. Reconcile them after
  // pausing or changing the arrangement even when React's old text is equal.
  useEffect(() => {
    if (isPlaying) return;
    if (passiveClockTextRef.current) passiveClockTextRef.current.textContent = formatClock(navigationTime);
    const label = `${formatCompact(navigationTime)} / ${isManualTempoMode ? 'LIBRE' : formatCompact(navigationDuration)}`;
    if (passiveCompactClockTextRef.current) passiveCompactClockTextRef.current.textContent = label;
    if (passiveProgressTextRef.current) passiveProgressTextRef.current.textContent = label;
    if (passiveProgressBarRef.current) passiveProgressBarRef.current.style.transform = `scaleX(${Math.max(hasTrackSession ? progressPercent / 100 : 0, hasTrackSession ? .04 : 0)})`;
  }, [isPlaying, isManualTempoMode, navigationTime, navigationDuration, hasTrackSession, progressPercent]);

  const stopPassiveTelemetryLoop = useCallback(() => {
    if (passiveTelemetryFrameRef.current !== null) {
      window.cancelAnimationFrame(passiveTelemetryFrameRef.current);
      passiveTelemetryFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!passiveStreamingTelemetryActive || !isPlaying) {
      stopPassiveTelemetryLoop();
      return undefined;
    }

    passiveFpsMonitorRef.current = {
      lastSampleAt: 0,
      frames: 0,
      lowSamples: 0,
      lastAlertAt: 0,
    };
    lastPassiveLiveSyncSnapshotAtRef.current = 0;
    lastPassiveUiFrameAtRef.current = 0;
    // Each frame only writes values that changed; identical writes still cost
    // style recalculation, text relayout and paint on every meter tick.
    const writtenVuLevels = new WeakMap<HTMLElement, string>();
    // The level variable goes on the meter bar itself, its only consumer, so a
    // tick restyles one element instead of the whole inherited strip subtree.
    const vuMeterTargets = new WeakMap<HTMLElement, HTMLElement>();
    const resolveVuMeterTarget = (strip: HTMLElement) => {
      const cached = vuMeterTargets.get(strip);
      if (cached?.isConnected && strip.contains(cached)) return cached;
      const meter = strip.querySelector<HTMLElement>('.live-director-track-activity-meter') ?? strip;
      vuMeterTargets.set(strip, meter);
      return meter;
    };
    const writeText = (element: HTMLElement | null, text: string) => {
      if (element && element.textContent !== text) element.textContent = text;
    };

    const drawPassiveTelemetry = (frameTime: number) => {
      passiveTelemetryFrameRef.current = window.requestAnimationFrame(drawPassiveTelemetry);

      if (lastPassiveUiFrameAtRef.current > 0) {
        const elapsedSinceUiFrame = frameTime - lastPassiveUiFrameAtRef.current;
        if (elapsedSinceUiFrame < PASSIVE_TELEMETRY_UI_INTERVAL_MS) {
          return;
        }
        lastPassiveUiFrameAtRef.current += PASSIVE_TELEMETRY_UI_INTERVAL_MS;
        if (
          frameTime - lastPassiveUiFrameAtRef.current >
          PASSIVE_TELEMETRY_UI_INTERVAL_MS
        ) {
          lastPassiveUiFrameAtRef.current = frameTime;
        }
      } else {
        lastPassiveUiFrameAtRef.current = frameTime;
      }

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
          fpsMonitor.lowSamples = fps < 18 ? fpsMonitor.lowSamples + 1 : 0;

          if (
            isLiveDiagnosticsEnabled() &&
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
        // Read layout before this frame's writes so it never forces a sync reflow.
        const minimapWidth = passiveMinimapPlayheadRef.current?.parentElement?.clientWidth || 0;
        const nextTime = readStableStreamingTelemetryTime(telemetry);
        const visibleTime = getNavigationTime(nextTime);
        const duration = Math.max(navigationDuration, visibleTime, 0.001);
        const progress = hasTrackSession ? clamp(visibleTime / duration, 0, 1) * 100 : 0;

        passiveCurrentTimeRef.current = nextTime;
        if (
          frameTime - lastPassiveLiveSyncSnapshotAtRef.current >=
          PASSIVE_LIVE_SYNC_SNAPSHOT_INTERVAL_MS
        ) {
          lastPassiveLiveSyncSnapshotAtRef.current = frameTime;
          publishPlaybackSnapshot(nextTime, true);
        }
        if (
          visualSectionTimeRef.current !== null &&
          Math.abs(nextTime - visualSectionTimeRef.current) < 0.25
        ) {
          visualSectionTimeRef.current = null;
          setVisualSectionTimeState(null);
        }

        writeText(passiveClockTextRef.current, formatClock(visibleTime));
        const compactProgressText = `${formatCompact(visibleTime)} / ${formatCompact(duration)}`;
        writeText(passiveCompactClockTextRef.current, compactProgressText);
        writeText(passiveProgressTextRef.current, compactProgressText);
        if (passiveProgressBarRef.current) {
          passiveProgressBarRef.current.style.transform = `scaleX(${Math.max(hasTrackSession ? progress / 100 : 0, hasTrackSession ? 0.04 : 0)})`;
        }

        if (passiveMinimapPlayheadRef.current) {
          if (passiveMinimapPlayheadRef.current.style.left !== '0px') passiveMinimapPlayheadRef.current.style.left = '0px';
          passiveMinimapPlayheadRef.current.style.transform = `translate3d(${minimapWidth * (progress / 100) - 1}px, 0, 0)`;
        }

        const liveSectionIndex = getSectionIndexAtTime(nextTime);
        if (passiveSectionIndexRef.current !== liveSectionIndex) {
          passiveSectionIndexRef.current = liveSectionIndex;
          setPassiveActiveSectionIndex(liveSectionIndex);
        }
        if (showSectionsPanel) {
          const progressPx = getSectionLaneProgressPxAtTime(nextTime);
          const activeSectionIndex = liveSectionIndex;
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
              // Colour and glow change only when the section (or its accent) changes.
              if (element.style.opacity !== '1' || element.dataset.playheadAccent !== segment.section.accent) {
                element.dataset.playheadAccent = segment.section.accent;
                element.style.opacity = '1';
                element.style.backgroundColor = `${segment.section.accent}cc`;
                element.style.boxShadow = `0 0 14px ${segment.section.accent}66`;
                element.style.willChange = 'transform';
              }
            } else if (element.style.opacity !== '0') {
              delete element.dataset.playheadAccent;
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
          // The custom property is inherited by the whole strip, so skip no-op updates
          // (silent or muted stems). A 0.001 step is below one pixel of meter height.
          const vuLevel = levelScale.toFixed(3);
          const meterTarget = resolveVuMeterTarget(element);
          if (writtenVuLevels.get(meterTarget) !== vuLevel) {
            writtenVuLevels.set(meterTarget, vuLevel);
            meterTarget.style.setProperty('--ld-vu-level', vuLevel);
          }
        }
      }

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
    passiveStreamingTelemetryActive,
    playbackTimelineDuration,
    navigationDuration,
    getNavigationTime,
    publishPlaybackSnapshot,
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
    () => passiveStreamingTelemetryActive && isPlaying && visualSectionTime === null && passiveActiveSectionIndex !== null
      ? passiveActiveSectionIndex : getSectionIndexAtTime(sectionVisualTime),
    [getSectionIndexAtTime, sectionVisualTime, passiveStreamingTelemetryActive, isPlaying, visualSectionTime, passiveActiveSectionIndex],
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
    sectionsLaneScrollLeftRef.current = targetScrollLeft;
    scrollContainer.scrollLeft = targetScrollLeft;
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
    if (navigationDuration <= 0 || navigationSections.length === 0) {
      return [] as Array<{
        id: string;
        leftPct: number;
        widthPct: number;
        accent: string;
        name: string;
      }>;
    }
    return navigationSections.map((section) => {
      const startFrac = clamp(section.startTime / navigationDuration, 0, 1);
      const endFrac = clamp(section.endTime / navigationDuration, 0, 1);
      return {
        id: section.id,
        leftPct: startFrac * 100,
        widthPct: Math.max(0, (endFrac - startFrac) * 100),
        accent: section.accent,
        name: section.name,
      };
    });
  }, [navigationDuration, navigationSections]);

  const sectionLaneMinimapPlayheadPct = useMemo(() => {
    if (navigationDuration <= 0) return 0;
    return clamp(navigationTime / navigationDuration, 0, 1) * 100;
  }, [navigationTime, navigationDuration]);

  // Both the passive playback clock and paused React updates write the same
  // transform. Never combine a percentage left with an old pixel transform.
  useEffect(() => {
    const marker = passiveMinimapPlayheadRef.current;
    if (!marker) return;
    const width = marker.parentElement?.clientWidth || 0;
    marker.style.transform = `translate3d(${width * sectionLaneMinimapPlayheadPct / 100 - 1}px, 0, 0)`;
  }, [sectionLaneMinimapPlayheadPct, sectionsLaneViewportWidth, showSectionsPanel, showSectionMap]);

  // Project the big lane's scrolled viewport onto the timeline fraction.
  // Simplification: we treat the scrollable track as linear over
  // sectionLaneContentWidth, which is good enough visually even with gaps
  // between sections. The playhead line stays in true time domain above.
  const getSectionLaneMinimapViewport = useCallback((scrollLeft: number) => {
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
    const startPx = Math.max(0, scrollLeft);
    const widthFrac = clamp(sectionsLaneViewportWidth / contentWithoutPads, 0.03, 1);
    const startFrac = clamp(startPx / contentWithoutPads, 0, 1 - widthFrac);
    return { leftPct: startFrac * 100, widthPct: widthFrac * 100 };
  }, [
    playbackTimelineDuration,
    sectionLaneContentWidth,
    sectionLanePlayheadOffsetPx,
    sectionLaneTrailingPaddingPx,
    sectionsLaneViewportWidth,
  ]);
  const sectionLaneMinimapViewport = getSectionLaneMinimapViewport(
    sectionsLaneScrollLeftRef.current,
  );
  useEffect(() => {
    if (showSectionMap) updateSectionsMinimapViewportRef.current?.(sectionsLaneScrollLeftRef.current);
  }, [showSectionMap]);
  const updateSectionsMinimapViewport = useCallback((scrollLeft: number) => {
    const marker = sectionsMinimapViewportRef.current;
    sectionsLaneScrollLeftRef.current = Math.max(0, scrollLeft);
    if (!marker) {
      return;
    }

    const viewport = getSectionLaneMinimapViewport(sectionsLaneScrollLeftRef.current);
    const minimapWidth = marker.parentElement?.clientWidth || 0;
    marker.style.left = '0px';
    marker.style.width = `${viewport.widthPct}%`;
    marker.style.transform = `translate3d(${minimapWidth * (viewport.leftPct / 100)}px, 0, 0)`;
  }, [getSectionLaneMinimapViewport]);
  updateSectionsMinimapViewportRef.current = updateSectionsMinimapViewport;

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
      isManualTempoMode
        ? [{
          id: MANUAL_CLICK_TRACK_ID,
          name: 'Click',
          url: '',
          volume: manualTempoTransport.volume,
          isMuted: manualTempoTransport.muted,
          outputRoute: 'left' as TrackOutputRoute,
        }]
        : activeTracks.length > 0
        ? activeTracks
        : MIXER_TRACKS.map((track) => ({
          id: track.id,
          name: track.label,
          url: '',
          volume: track.defaultVolume,
          isMuted: false,
        }));

    const resolvedMixerTracks: MixerTrackView[] = sourceTracks.map((track, index) => {
      const meta = buildMixerTrackMeta(track, index);
      const omittedWarning = omittedWarningByTrackId.get(track.id);
      const outputRoute = trackOutputRoutes[track.id] ?? resolveTrackOutputRoute(track);
      const isManualClickTrack = isManualTempoMode && track.id === MANUAL_CLICK_TRACK_ID;
      const showRouteFlip = false;
      const volume = isManualClickTrack
        ? manualTempoTransport.volume
        : trackVolumes[track.id] ?? track.volume ?? meta.defaultVolume;
      const muted = isManualClickTrack
        ? manualTempoTransport.muted
        : omittedWarning ? false : mutedTrackIds.has(track.id);
      const dimmed = soloTrackIds.size > 0 && !soloTrackIds.has(track.id);
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
        soloed: omittedWarning ? false : soloTrackIds.has(track.id),
        dimmed,
        disabled: (!isManualClickTrack && activeTracks.length === 0) || Boolean(omittedWarning),
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

    resolvedMixerTracks.sort((a, b) => mixerRoleRank(a) - mixerRoleRank(b));

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
        volume: resolvedInternalPadVolume * congregationPadGain,
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
  }, [activeTracks, congregationPadGain, currentTime, isManualTempoMode, isPadActive, isPlaying, manualTempoTransport.muted, manualTempoTransport.volume, mutedTrackIds, omittedWarningByTrackId, resolvedInternalPadVolume, resolvedPadUrl, soloTrackIds, trackEnvelopes, trackLevels, trackOutputRoutes, trackVolumes]);

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
    if (!hasPersistedSongContext) {
      setCanManageLiveDirectorUploads(true);
      return;
    }

    let cancelled = false;
    setCanManageLiveDirectorUploads(false);

    fetchLiveDirectorUploadPermission()
      .then((allowed) => {
        if (!cancelled) {
          setCanManageLiveDirectorUploads(allowed);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCanManageLiveDirectorUploads(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasPersistedSongContext, songId]);

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
      setSoloTrackIds(new Set());
      setShowLoadPanel(canOpenLoadPanel);
    }
  }, [hasProvidedTracks, initialSession, isSongBoundView, replaceOwnedObjectUrls, requiresSongContext, songId]);

  useEffect(() => {
    if (!canOpenStemsActionModal) {
      setShowStemsActionModal(false);
    }
  }, [canOpenStemsActionModal]);

  useEffect(() => {
    if (!canManageStemSelection) {
      setShowTrackLoadModal(false);
    }
  }, [canManageStemSelection]);

  useEffect(() => {
    if (!canOpenLoadPanel) {
      setShowLoadPanel(false);
    }
  }, [canOpenLoadPanel]);

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

  // Keep the minimap viewport aligned without routing the 24 Hz auto-follow
  // through React state. Only the small marker is updated on each frame.
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
      updateSectionsMinimapViewport(latest);
    };

    const onScroll = () => {
      latest = scrollContainer.scrollLeft;
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(commit);
    };

    updateSectionsMinimapViewport(scrollContainer.scrollLeft);
    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', onScroll);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [releaseSectionsAutoFollowNow, showSectionsPanel, updateSectionsMinimapViewport]);

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

    if (songArtworkUrl) { setSongCoverArtUrl(songArtworkUrl); return; }
    if (!songMp3) {
      setSongCoverArtUrl(null);
      return () => {
        cancelled = true;
      };
    }

    // Embedded covers are optional; never compete with audio startup.
    if (!isReady || sessionPreparationPending) return;

    void extractCoverArtFromMp3(songMp3).then((coverUrl) => {
      if (!cancelled) {
        setSongCoverArtUrl(coverUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [songMp3, songArtworkUrl, isReady, sessionPreparationPending]);

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

    setQueueSongCoverArtMap(Object.fromEntries(
      ensayoQueueSongs.map((song) => [song.id, song.artworkUrl || null]),
    ));
    if (!isReady || sessionPreparationPending) return;

    // Reuse stored artwork immediately. Scan missing embedded covers one at a
    // time after audio is ready so cosmetic requests cannot starve the engine.
    void (async () => {
      for (const song of ensayoQueueSongs) {
        if (cancelled) return;
        if (song.artworkUrl || !song.mp3) continue;
        const coverUrl = await extractCoverArtFromMp3(song.mp3);
        if (cancelled) return;
        setQueueSongCoverArtMap((previous) => ({ ...previous, [song.id]: coverUrl }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ensayoQueueSongs, isReady, sessionPreparationPending]);

  useEffect(() => {
    publishPlaybackSnapshot(currentTime, isPlaying);
  }, [currentTime, isPlaying, publishPlaybackSnapshot]);

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
    setSoloTrackIds(new Set());
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
    if (!hasPersistedSongContext || !canManagePersistedSongSession || isFlushingSilentSessionSaveRef.current) {
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
  }, [canManagePersistedSongSession, enqueueSessionSave, hasPersistedSongContext, onSessionPersisted, songId]);

  const queueSilentSessionSave = useCallback((payload: LiveDirectorSessionSavePayload | null) => {
    if (!hasPersistedSongContext || !canManagePersistedSongSession || !payload) {
      return;
    }

    pendingSilentSessionSaveRef.current = {
      songId,
      payload,
    };
    void flushSilentSessionSaveQueue();
  }, [canManagePersistedSongSession, flushSilentSessionSaveQueue, hasPersistedSongContext, songId]);

  const clearManualSession = useCallback(async () => {
    if (hasPersistedSongContext && !canManagePersistedSongSession) {
      setLoadError('Necesitas el rol Gestor de Secuencias para borrar esta sesion.');
      return;
    }

    stop();
    setLoadError(null);
    setBusyMessage(hasPersistedSongContext ? 'Borrando sesion y archivos de R2...' : null);

    try {
      if (hasPersistedSongContext) {
        await deleteLiveDirectorSongSession(songId);
      }

      setUnmatchedFiles([]);
      setMutedTrackIds(new Set());
      setSoloTrackIds(new Set());
      setManualSession(null);
      setShowLoadPanel(canOpenLoadPanel);
      replaceOwnedObjectUrls([]);
      setReloadKey((previous) => previous + 1);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo limpiar la sesion.');
    } finally {
      setBusyMessage(null);
    }
  }, [canManagePersistedSongSession, canOpenLoadPanel, hasPersistedSongContext, replaceOwnedObjectUrls, songId, stop]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const capacitorBridge = (window as WindowWithCapacitor).Capacitor;
    const platform = capacitorBridge?.getPlatform?.();
    const isNativeRuntime = Boolean(capacitorBridge?.isNativePlatform?.()) || platform === 'ios';
    const isIosDevice =
      /iP(hone|ad|od)/.test(window.navigator.userAgent) ||
      (/Macintosh/i.test(window.navigator.userAgent) && window.navigator.maxTouchPoints > 1);

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
      // El diseño normal necesita ~685 px de alto: PCs de 768/800 e iPads en horizontal usan el compacto.
      setIsCompactLandscape(!portrait && nextViewportHeight <= LIVE_DIRECTOR_COMPACT_MAX_HEIGHT);
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

  const [preparedSessionKey, setPreparedSessionKey] = useState('');
  const failedSessionLoadRef = useRef<{ key: string; message: string } | null>(null);
  const sessionLoadKey = `${songId}:${reloadKey}:${enabledSessionTracks.map(track => `${track.id}:${track.optimizedUrl || track.url}`).join('|')}`;
  const trackSignature = useMemo(() => (
    activeEngineTracks.map(track => `${track.id}:${track.url}`).join('|')
  ), [activeEngineTracks]);
  const currentSessionPrepared = isReady && !sessionPreparationPending && !isInitializingSession &&
    (isManualTempoMode || (hasTrackSession && preparedSessionKey === `${sessionLoadKey}:${trackSignature}`));
  currentSessionPreparedRef.current = currentSessionPrepared;

  useEffect(() => {
    setPreparedSessionKey('');
    if (sessionPreparationPending) {
      return undefined;
    }

    let cancelled = false;

    const setup = async () => {
      if (!hasResolvedEngineCapability) {
        return;
      }

      if (activeTracks.length === 0) {
        stopEngineRef.current();
        setIsInitializingSession(false);
        setBusyMessage(null);
        setLoadError(null);
        return;
      }

      if (failedSessionLoadRef.current?.key === sessionLoadKey) {
        setLoadError(failedSessionLoadRef.current.message);
        setIsInitializingSession(false);
        setBusyMessage(null);
        return;
      }
      failedSessionLoadRef.current = null;
      setLoadError(null);
      setIsInitializingSession(true);
      setBusyMessage(isIOSNativeEngineSurface ? 'Iniciando motor Apple...' : useStreamingEngine ? 'Iniciando motor en flujo...' : 'Cargando buffers de audio...');
      setMutedTrackIds(new Set(activeTracks.filter((track) => track.isMuted).map((track) => track.id)));
      setSoloTrackIds(new Set());

      const disabledCount = Math.max(0, sessionTracks.length - enabledSessionTracks.length);
      logLiveDiagnostic('live-director:tracks-loading', {
        activeTracks: activeTracks.length,
        enabledTracks: enabledSessionTracks.length,
        disabledTracks: disabledCount,
        nativePadBridge: shouldUseNativePadBridge,
        recommendedTrackLimit: sessionActiveTrackLimit,
        aboveRecommendedLimit: isWebTrackLimitExceeded,
      });

      try {
        await initializeEngineRef.current(activeEngineTracks);
        if (cancelled) {
          return;
        }

        // Event volumes can arrive while the same audio URLs are loading.
        // Apply that latest mix before enabling transport or autosave; changing
        // a fader later must never reload the audio session.
        const latestMix = engineMixAtLoadEndRef.current;
        for (const track of latestMix.tracks) {
          const loaded = activeEngineTracks.find(candidate => candidate.id === track.id);
          if (loaded && loaded.volume !== track.volume) latestMix.setVolume(track.id, track.volume);
        }
        setPreparedSessionKey(`${sessionLoadKey}:${trackSignature}`);
        setIsInitializingSession(false);
        setBusyMessage(null);
        logLiveDiagnostic('live-director:tracks-initialized', {
          trackCount: activeEngineTracks.length,
          engineSurface: isIOSNativeEngineSurface ? 'native' : 'web',
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIsInitializingSession(false);
        setBusyMessage(null);
        console.error('[LiveDirectorView] Failed to initialize the multitrack engine.', error);
        const message = error instanceof Error ? error.message : 'No se pudieron cargar los buffers de audio.';
        failedSessionLoadRef.current = { key: sessionLoadKey, message };
        setLoadError(message);
      }
    };

    void setup();

    return () => {
      cancelled = true;
      stopEngineRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoadKey, trackSignature, hasResolvedEngineCapability, isIOSNativeEngineSurface, reloadKey, sessionPreparationPending, useStreamingEngine]);

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

  const audioMasterFadeCancelRef = useRef<(() => void) | null>(null);
  const stopMasterVolumeFade = useCallback(() => {
    audioMasterFadeCancelRef.current?.();
    audioMasterFadeCancelRef.current = null;
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

  const scheduleEngineMasterFade = !isManualTempoMode ? selectedMultitrackEngine.fadeMasterVolume : undefined;
  const fadeMasterVolume = useCallback((targetVolume: number, durationMs: number, transitionToken: number) => {
    if (scheduleEngineMasterFade) {
      stopMasterVolumeFade();
      const fade = scheduleEngineMasterFade(targetVolume, durationMs);
      if (fade) {
        audioMasterFadeCancelRef.current = fade.cancel;
        return fade.finished.then(() => {
          if (sectionTransitionTokenRef.current === transitionToken) appliedMasterVolumeRef.current = targetVolume;
        }).finally(() => {
          if (audioMasterFadeCancelRef.current === fade.cancel) audioMasterFadeCancelRef.current = null;
        });
      }
    }
    return new Promise<void>((resolve) => {
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
    });
  }, [applyMasterVolume, stopMasterVolumeFade, scheduleEngineMasterFade]);

  const stopCongregationTrackFade = useCallback(() => {
    if (congregationFadeFrameRef.current !== null) {
      window.cancelAnimationFrame(congregationFadeFrameRef.current);
      congregationFadeFrameRef.current = null;
    }

    if (congregationFadeResolveRef.current) {
      const resolveFade = congregationFadeResolveRef.current;
      congregationFadeResolveRef.current = null;
      resolveFade();
    }
  }, []);

  const fadeCongregationMix = useCallback((
    nextMuted: boolean,
    startVolumes: Map<string, number>,
    transitionToken: number,
  ) => (
    new Promise<void>((resolve) => {
      stopCongregationTrackFade();

      const fadeTracks = activeTracks.filter((track) => !isCongregationCueTrack(track));
      const startPadGain = congregationPadGainRef.current;
      const targetPadGain = nextMuted ? 0 : 1;
      let startTime: number | null = null;
      let lastAppliedAt = Number.NEGATIVE_INFINITY;

      const complete = () => {
        if (congregationFadeResolveRef.current === complete) {
          congregationFadeResolveRef.current = null;
        }
        congregationFadeFrameRef.current = null;
        resolve();
      };

      const applyProgress = (easedProgress: number) => {
        for (const track of fadeTracks) {
          const startVolume = startVolumes.get(track.id) ?? 0;
          const targetVolume = nextMuted
            ? 0
            : (congregationOriginalVolumesRef.current.get(track.id) ?? startVolume);
          const nextVolume = clamp(
            startVolume + (targetVolume - startVolume) * easedProgress,
            0,
            1,
          );

          congregationAppliedVolumesRef.current.set(track.id, nextVolume);
          setVolume(track.id, nextVolume);
        }

        const nextPadGain = clamp(
          startPadGain + (targetPadGain - startPadGain) * easedProgress,
          0,
          1,
        );
        congregationPadGainRef.current = nextPadGain;
        setCongregationPadGain(nextPadGain);
      };

      const animate = (frameTime: number) => {
        if (congregationFadeTokenRef.current !== transitionToken) {
          complete();
          return;
        }

        if (startTime === null) {
          startTime = frameTime;
        }

        const progress = clamp((frameTime - startTime) / CONGREGATION_FADE_MS, 0, 1);

        // Twenty control updates per second keep the bridge and React light;
        // ChannelStrip smooths the visible fader movement between updates.
        if (progress >= 1 || frameTime - lastAppliedAt >= 50) {
          const easedProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          applyProgress(easedProgress);
          lastAppliedAt = frameTime;
        }

        if (progress >= 1) {
          complete();
          return;
        }

        congregationFadeFrameRef.current = window.requestAnimationFrame(animate);
      };

      congregationFadeResolveRef.current = complete;
      congregationFadeFrameRef.current = window.requestAnimationFrame(animate);
    })
  ), [activeTracks, setVolume, stopCongregationTrackFade]);

  const handleToggleCongregationFade = useCallback(() => {
    if (
      !hasPlayableSession ||
      !isReady ||
      isTransportCueBusyRef.current ||
      sectionSeekInFlightRef.current
    ) {
      return;
    }

    const nextMuted = !congregationMutedRef.current;
    const transitionToken = congregationFadeTokenRef.current + 1;
    const fadeTracks = activeTracks.filter((track) => !isCongregationCueTrack(track));
    const startVolumes = new Map<string, number>();

    for (const track of fadeTracks) {
      const currentVolume = clamp(
        congregationAppliedVolumesRef.current.get(track.id) ??
          trackVolumes[track.id] ??
          track.volume ??
          1,
        0,
        1,
      );
      startVolumes.set(track.id, currentVolume);

      if (nextMuted && !congregationOriginalVolumesRef.current.has(track.id)) {
        congregationOriginalVolumesRef.current.set(track.id, currentVolume);
      }
    }

    congregationMutedRef.current = nextMuted;
    congregationFadeTokenRef.current = transitionToken;
    setCongregationFadeState(nextMuted ? 'fading-out' : 'fading-in');

    void (async () => {
      await fadeCongregationMix(nextMuted, startVolumes, transitionToken);

      if (congregationFadeTokenRef.current !== transitionToken) {
        return;
      }

      if (!nextMuted) {
        congregationOriginalVolumesRef.current.clear();
        congregationAppliedVolumesRef.current.clear();
      }
      setCongregationFadeState(nextMuted ? 'muted' : 'normal');
    })();
  }, [activeTracks, fadeCongregationMix, hasTrackSession, isReady, trackVolumes]);

  useEffect(() => {
    masterVolumeRef.current = masterVolume;

    if (!isSectionTransitioningRef.current) {
      stopMasterVolumeFade();
      applyMasterVolume(masterVolume);
    }
  }, [applyMasterVolume, masterVolume, stopMasterVolumeFade]);

  useEffect(() => {
    if (!experimentalTools || !isReady || isManualTempoMode) return;
    // The first requested value can precede creation of the audio graph.
    // Reapply once ready so the audible master matches the visible fader.
    appliedMasterVolumeRef.current = NaN;
    applyMasterVolume(masterVolumeRef.current);
  }, [experimentalTools, isReady, isManualTempoMode, applyMasterVolume]);

  useEffect(() => {
    if (isManualTempoMode) {
      manualTempoTransport.setMasterVolume(masterVolume);
    }
  }, [isManualTempoMode, manualTempoTransport.setMasterVolume, masterVolume]);

  useEffect(() => {
    sectionTransitionTokenRef.current += 1;
    congregationFadeTokenRef.current += 1;
    congregationMutedRef.current = false;
    isSectionTransitioningRef.current = false;
    setCongregationFadeState('normal');
    congregationOriginalVolumesRef.current.clear();
    congregationAppliedVolumesRef.current.clear();
    congregationPadGainRef.current = 1;
    setCongregationPadGain(1);
    stopCongregationTrackFade();
    stopMasterVolumeFade();
    applyMasterVolume(masterVolumeRef.current);
  }, [applyMasterVolume, stopCongregationTrackFade, stopMasterVolumeFade, trackSignature]);

  useEffect(() => () => {
    sectionTransitionTokenRef.current += 1;
    congregationFadeTokenRef.current += 1;
    isSectionTransitioningRef.current = false;
    stopCongregationTrackFade();
    stopMasterVolumeFade();
  }, [stopCongregationTrackFade, stopMasterVolumeFade]);

  const handleSectionSeek = useCallback(async (nextTime: number) => {
    eventAdvanceRef.current?.cancel();
    entryCountCancelRef.current?.();
    musicalNavigationRef.current?.cancel();
    if (!hasTrackSession || isCongregationFading) {
      return;
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

            const restoredVolume = masterVolumeRef.current;
            await fadeMasterVolume(restoredVolume, SECTION_TRANSITION_FADE_IN_MS, transitionToken);
          } finally {
            if (sectionTransitionTokenRef.current === transitionToken) {
              isSectionTransitioningRef.current = false;
              applyMasterVolume(masterVolumeRef.current);
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
      if (error instanceof Error && error.name === 'AbortError') return false;
      console.warn('[LiveDirectorView] Section seek failed.', error);
      setLoadError(error instanceof Error ? error.message : 'No se pudo preparar el salto de sección.');
      return false;
    } finally {
      pendingSectionSeekTargetRef.current = null;
      pendingSectionSeekWasPlayingRef.current = null;
      sectionSeekInFlightRef.current = false;
      setIsSectionSeekBusy(false);
    }
  }, [
    applyMasterVolume,
    fadeMasterVolume,
    getLivePlaybackTime,
    hasTrackSession,
    isCongregationFading,
    isPlaying,
    isReady,
    primeSectionVisuals,
    releaseSectionsAutoFollowNow,
    seekTo,
    setVisualSectionTime,
  ]);

  const sectionJump = useLiveDirectorSectionJump({
    getSectionAtTime: arrangementEntries ? time => {
      const section = resolvedSections[getSectionIndexAtTime(time)];
      return section && time >= section.startTime && time < section.endTime ? section : undefined;
    } : undefined,
    enabled: experimentalTools, resetKey: `${trackSignature}:${reloadKey}:${sectionOffsetSeconds}`, sections: resolvedSections,
    isReady, isPlaying, busy: isSectionSeekBusy || isCongregationFading,
    getTime: selectedMultitrackEngine.getCurrentTimeSnapshot, onJump: handleSectionSeek,
    prepareJump: !isManualTempoMode && diagnostics?.engineRoute === 'streaming-worker' && supportsPreparedSectionJump(readLiveBrowserCapabilities()) ? selectedMultitrackEngine.prepareSectionJump : undefined,
    cancelPreparedJump: selectedMultitrackEngine.cancelSectionJump, onNavigate: arrangementEntries ? arrangement.focus : undefined,
  });
  manualArrangementNavigation.current = Boolean(sectionJump.armed || sectionJump.repeat || musicalNavigationPendingRef.current);
  sectionJumpActiveRef.current = Boolean(sectionJump.armed || sectionJump.repeat);

  // Only the songs of this rehearsal that have stems are saved on the device.
  const rehearsalStemSongIds = useMemo(
    () => queueSongs.filter(song => song.kind !== 'manual-tempo').map(song => song.id),
    [queueSongs],
  );
  const rehearsalDownload = useLiveDirectorRehearsalDownload({
    enabled: isEnsayoMode && Boolean(eventId) && Boolean(onResolveQueueSongTracks) && diagnostics?.engineRoute === 'streaming-worker',
    // En PC la sesión se carga sola, cuando la canción actual ya está lista (no le quita red a su carga).
    autoStart: hasFinePointer && currentSessionPrepared,
    rehearsalId: eventId || null,
    songIds: rehearsalStemSongIds,
    resolveTracks: onResolveQueueSongTracks,
    download: selectedMultitrackEngine.downloadTracksToDevice,
  });
  const showRehearsalSaveCard = isEnsayoMode && Boolean(eventId) && Boolean(onResolveQueueSongTracks) &&
    Boolean(selectedMultitrackEngine.downloadTracksToDevice) && diagnostics?.engineRoute === 'streaming-worker' &&
    rehearsalStemSongIds.length > 0;

  // Section starts are cached in the background so jumps decode local audio.
  const prefetchSectionStarts = selectedMultitrackEngine.prefetchSectionStarts;
  const sectionStartsKey = resolvedSections.map(section => section.startTime.toFixed(3)).join(',');
  useEffect(() => {
    if (!isReady || !prefetchSectionStarts || !sectionStartsKey || diagnostics?.engineRoute !== 'streaming-worker') return;
    prefetchSectionStarts(sectionStartsKey.split(',').map(Number));
  }, [diagnostics?.engineRoute, isReady, prefetchSectionStarts, reloadKey, sectionStartsKey, trackSignature]);

  const eventQueueIndex = queueSongs.findIndex(song => song.id === (activeQueueSongId || songId));
  const nextEventSong = eventQueueIndex >= 0 ? queueSongs[eventQueueIndex + 1] : undefined;
  const nextEventSongRef = useRef(nextEventSong); nextEventSongRef.current = nextEventSong;
  // Transiciones del evento, como en Playback: el círculo entre dos portadas elige qué pasa al terminar
  // «esta canción → la siguiente». Se recuerdan por evento en este dispositivo.
  const [songTransitions, setSongTransitions] = useState<Record<string, SongTransition>>({});
  useEffect(() => { setSongTransitions(readSongTransitions(eventId || '')); }, [eventId]);
  const [openTransitionFrom, setOpenTransitionFrom] = useState<string | null>(null);
  const currentQueueSongId = activeQueueSongId || songId;
  const currentTransition = songTransitions[currentQueueSongId] ?? DEFAULT_SONG_TRANSITION;
  const currentTransitionRef = useRef(currentTransition); currentTransitionRef.current = currentTransition;
  const showSongTransitions = experimentalTools && !isManualTempoMode && Boolean(eventId && onSelectQueueSong);
  // AutoLink, Sobreponer y Transición Cruzada cambian de canción sonando: necesitan el cambio preparado.
  const preparedTransitionUnavailable = diagnostics?.engineRoute !== 'streaming-worker' || !onPrepareQueueSong
    ? 'Este navegador no puede pasar a la siguiente canción sin detenerse.' : '';
  const transitionTarget = nextEventSong && nextEventSong.kind !== 'manual-tempo' ? nextEventSong : undefined;
  const chainArmedRef = useRef('');
  // Un salto o una repetición manual manda sobre el encadenado: suelta el cambio de canción ya armado
  // (podrá armarse otra vez al terminar la repetición si aún queda tiempo).
  const cancelChainedSongChange = () => {
    if (!chainArmedRef.current) return;
    chainArmedRef.current = '';
    if (musicalNavigationPendingRef.current) musicalNavigationRef.current?.cancel();
  };
  const eventAdvance = useLiveDirectorEventAdvance({
    enabled: experimentalTools && Boolean(eventId && onSelectQueueSong) && !isManualTempoMode,
    // Sin cuenta 5-4-3-2-1: al terminar sola, la transición elegida decide (los modos que pasan
    // sonando ya cambiaron de canción antes del final con el cambio preparado).
    autoAdvance: false,
    onEnded: () => {
      const transition = currentTransitionRef.current;
      if (!transitionAllowsPad(transition.mode)) return;
      if (transition.continuePad && !isPadActive) setPadActiveFromGesture(true);
      const next = nextEventSongRef.current;
      if (transition.mode === 'cue' && next) { eventMixFlushRef.current(); onSelectQueueSong?.(next.id, { autoPlay: false }); }
    },
    identity: `${transportIdentity}:${reloadKey}`, songId: activeQueueSongId || songId,
    nextSong: nextEventSong?.kind === 'manual-tempo' ? undefined : nextEventSong,
    playing: isPlaying, ready: currentSessionPrepared,
    busy: isSectionSeekBusy || isCongregationFading || showArrangementEditor || eventArrangement.loading || Boolean(eventArrangement.error),
    // getTime devuelve tiempo del arreglo: la duración debe estar en esa misma línea de tiempo, o el
    // conteo al final de un arreglo se cancela creyendo que la canción volvió atrás.
    hasArrangement: Boolean(arrangementEntries),
    duration: arrangementEntries ? navigationSections.at(-1)?.endTime ?? 0 : sourceAudioDuration,
    finalStart: /^(final|último acorde|ultimo acorde)(?:\s+\d+)?$/i.test(navigationSections.at(-1)?.name.trim() ?? '')
      ? navigationSections.at(-1)!.startTime : null,
    getTime: () => getNavigationTime(selectedMultitrackEngine.getCurrentTimeSnapshot()),
    manualNavigation: manualArrangementNavigation,
    scheduleEnd: diagnostics?.engineRoute === 'streaming-worker' ? selectedMultitrackEngine.scheduleSectionEnd : undefined,
    selectSong: (id, options) => { eventMixFlushRef.current(); onSelectQueueSong?.(id, options); },
    request: autoPlayRequest,
    startReady: currentSessionPrepared,
    startError: (failedSessionLoadRef.current?.key === sessionLoadKey ? loadError ?? '' : '') || eventArrangement.error ||
      (preparedSessionKey === `${sessionLoadKey}:${trackSignature}` && (isWebTrackLimitExceeded || omittedWarningByTrackId.size > 0)
        ? 'Faltan stems. Revisa la carga antes de reproducir.' : ''),
    start: async () => {
      const identity = transportIdentityRef.current;
      if (arrangementEntries && resolvedSections[0]) {
        arrangement.focus(resolvedSections[0].id);
        await seekTo(resolvedSections[0].startTime, { wasPlayingBeforeUiSeek: false });
      }
      if (transportIdentityRef.current !== identity) throw new DOMException('Cambió la canción', 'AbortError');
      await (entryCountStartRef.current?.() ?? play());
    },
    pause: () => { entryCountCancelRef.current?.(); pause(); }, cancelSelection: onCancelAutoPlay, requestHandled: onAutoPlayHandled,
  });
  eventAdvanceRef.current = eventAdvance;

  const [guideRetryKey, setGuideRetryKey] = useState(0);
  // Anchor of the manual instruction menu; it lives in a portal because the section panel clips overflow.
  const [instructionMenuAnchor, setInstructionMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!instructionMenuAnchor) return;
    const close = (event: Event) => {
      const target = event.target as Element | null;
      if (event.type === 'keydown' ? (event as KeyboardEvent).key === 'Escape' : !target?.closest('[data-guide-instruction-menu], [data-live-director-control="guide-instructions"]')) setInstructionMenuAnchor(null);
    };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', close); window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close); window.removeEventListener('resize', close); };
  }, [instructionMenuAnchor]);
  const [showClickMixer, setShowClickMixer] = useState(false);
  const [confirmedClickMeter, setConfirmedClickMeter] = useState<{ numerator: number; denominator: number } | null>(null);
  useEffect(() => { setConfirmedClickMeter(null); }, [songId, reloadKey]);
  const shownMeter = isManualTempoMode ? manualTempoConfig?.manualTempo.meter : confirmedClickMeter || timeSignature;
  const meterLabel = shownMeter && Number.isInteger(shownMeter.numerator) && shownMeter.numerator > 0 && [1, 2, 4, 8, 16].includes(shownMeter.denominator)
    ? `${shownMeter.numerator}/${shownMeter.denominator}` : '—/—';
  const openClickMixer = useCallback(() => setShowClickMixer(true), []);
  const closeClickMixer = useCallback(() => setShowClickMixer(false), []);
  useEffect(() => { setShowClickMixer(false); }, [trackSignature, reloadKey]);
  const clickTrack = activeEngineTracks.find(track => /\b(click|metronomo|metronome)\b/i.test(`${track.id} ${track.name}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
  const canUseGeneratedClick = experimentalTools && !isManualTempoMode && Boolean(clickTrack) && diagnostics?.engineRoute === 'streaming-worker';
  const guideTrack = activeEngineTracks.find(track => /\b(guide|guia)\b/i.test(`${track.id} ${track.name}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
  // Conteo de entrada solo en canciones con mapa de REAPER: sin él, la guía subida ya trae su
  // propio conteo y uno añadido se oiría dos veces.
  const entryCountEnabled = experimentalTools && !isManualTempoMode && Boolean(reaperTransport);
  const entryCount = useLiveDirectorEntryCount({
    enabled: entryCountEnabled,
    identity: `${transportIdentity}:${reloadKey}`, ready: currentSessionPrepared, playing: isPlaying,
    bpm, meter: shownMeter, unoSeconds: arrangementEntries ? null : reaperTransport?.clickGrid?.originSeconds,
    getTime: selectedMultitrackEngine.getCurrentTimeSnapshot,
    getGraph: () => (guideTrack || clickTrack) ? selectedMultitrackEngine.getGuideAudioGraph?.((guideTrack || clickTrack)!.id) ?? null : null,
    play, pause,
  });
  entryCountCancelRef.current = entryCount.cancel;
  entryCountStartRef.current = entryCountEnabled ? entryCount.start : null;
  entryCountNeedsRef.current = entryCount.needsCount;
  const dynamicGuide = useLiveDirectorDynamicGuide({
    wanted: experimentalTools && Boolean(guideTrack) && diagnostics?.engineRoute === 'streaming-worker', ready: isReady, playing: isPlaying,
    busy: isSectionSeekBusy, resetKey: `${trackSignature}:${reloadKey}:${guideRetryKey}`, bpm, meter:shownMeter,
    getGraph: () => guideTrack ? selectedMultitrackEngine.getGuideAudioGraph?.(guideTrack.id) ?? null : null,
    getTime: selectedMultitrackEngine.getCurrentTimeSnapshot, getPlan: time => { const plan = sectionJump.getCuePlan(time); return plan && /^(jump|repeat):/.test(plan.id) ? plan : arrangementEntries ? arrangement.getCuePlan() : null; },
    getInstructions: () => guideInstructions,
  });
  const applyArrangement = useCallback(async (entries: ArrangementEntry[] | null) => {
    if (isPlaying || isSectionSeekBusy || isCongregationFading) throw new Error('Pausa la canción antes de aplicar.');
    if (diagnostics?.engineRoute !== 'streaming-worker') throw new Error('Este motor no permite probar arreglos.');
    const next = entries ? resolveArrangement(sourceSections, entries) : sourceSections;
    if (eventId) await eventArrangement.save(entries);
    arrangement.cancel();
    const start = entries ? next[0]?.startTime ?? 0 : 0;
    await seekTo(start, { wasPlayingBeforeUiSeek: false, forceFreshStart: start === 0 });
    setArrangementState({ key: arrangementIdentity, entries: entries?.map(entry => ({ ...entry })) ?? null });
    setVisualSectionTime(null); setKeyboardSectionIndex(null); releaseSectionsAutoFollowNow();
  }, [isPlaying, isSectionSeekBusy, isCongregationFading, diagnostics?.engineRoute, sourceSections, arrangementIdentity, seekTo, setVisualSectionTime, releaseSectionsAutoFollowNow, arrangement.cancel, eventId, eventArrangement.save]);
  const lastSectionTapRef = useRef<{ id: string; time: number } | null>(null);
  useEffect(() => { lastSectionTapRef.current = null; }, [isPlaying, trackSignature]);
  const selectedJumpSection = keyboardSectionIndex !== null ? resolvedSections[keyboardSectionIndex] : null;
  const armSectionFromTimeline = useCallback((sectionId: string) => {
    cancelChainedSongChange();
    if (sectionJump.arm(sectionId)) {
      setVisualSectionTime(null);
      releaseSectionsAutoFollowNow();
    }
  }, [sectionJump.arm, releaseSectionsAutoFollowNow]);

  const startRepeatFromTimeline = useCallback((mode: 'once' | 'hold') => {
    cancelChainedSongChange();
    if (sectionJump.startRepeat(mode)) {
      setVisualSectionTime(null);
      releaseSectionsAutoFollowNow();
    }
  }, [sectionJump.startRepeat, releaseSectionsAutoFollowNow]);

  const handleReturnToStart = useCallback(async () => {
    eventAdvanceRef.current?.cancel();
    entryCountCancelRef.current?.();
    musicalNavigationRef.current?.cancel();
    if (
      !hasPlayableSession ||
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
      if (arrangementEntries && resolvedSections[0]) arrangement.focus(resolvedSections[0].id);
      await seekTo(arrangementEntries ? resolvedSections[0]?.startTime ?? 0 : 0, { forceFreshStart: true });
    } catch (error) {
      console.warn('[LiveDirectorView] Return to start failed.', error);
    } finally {
      isTransportCueBusyRef.current = false;
      setIsReturnToStartBusy(false);
    }
  }, [hasPlayableSession, isCongregationFading, isPlaying, primeSectionVisuals, seekTo, arrangementEntries, resolvedSections, sourceSections, arrangement.focus]);

  const musicalNavigation = useLiveDirectorMusicalNavigation({
    enabled: experimentalTools && !isManualTempoMode && diagnostics?.engineRoute === 'streaming-worker',
    identity: `${transportIdentity}:${reloadKey}`, playing:isPlaying, ready:currentSessionPrepared,
    busy:isTransportCueBusy || isCongregationFading || showArrangementEditor,
    getTime:selectedMultitrackEngine.getCurrentTimeSnapshot,
    sectionEnd:time=>{const section=resolvedSections[getSectionIndexAtTime(time)];return section&&section.endTime>time?section.endTime:resolvedSections.find(item=>item.endTime>time)?.endTime??null;},
    recordedEntry:!reaperTransport || (!arrangementEntries && !!entryCountPlan(bpm,shownMeter,reaperTransport.clickGrid?.originSeconds)?.recorded),
    prepareSong:onPrepareQueueSong ? async id=>{
      const session=await onPrepareQueueSong(id);
      const timing=resolveLiveDirectorReaperTransportTiming(session);
      const saved=eventId?await readEventArrangementForRehearsal(eventId,id):null;
      if(saved?.arrangement?.entries && saved.arrangement.sourceSignature!==saved.sourceSignature)throw new Error('El arreglo de destino necesita revisión.');
      const source=applyLiveDirectorSectionOffset(resolveLiveDirectorSessionSections(session,null)??[],Number(session.sectionOffsetSeconds)||0);
      const arranged=saved?.arrangement?.entries?resolveArrangement(source??[],saved.arrangement.entries):null;
      return {tracks:session.tracks.filter(track=>track.enabled!==false),startSeconds:arranged?.[0]?.startTime??0,recordedEntry:!timing || !arranged && !!entryCountPlan(timing?.bpm??bpm,timing?.timeSignature??shownMeter,timing?.clickGrid?.originSeconds)?.recorded};
    }:undefined,
    prepareAudio:selectedMultitrackEngine.prepareSongChange, prepareRestart:pause=>selectedMultitrackEngine.prepareRestart!(pause,arrangementEntries?resolvedSections[0]?.startTime??0:0),
    afterRestart:()=>{selectedMultitrackEngine.refreshTransport?.();if(arrangementEntries&&resolvedSections[0])arrangement.focus(resolvedSections[0].id);},
    schedule:selectedMultitrackEngine.schedulePreparedSongChange, cancelAudio:selectedMultitrackEngine.cancelSectionJump,
    beforeArm:()=>{eventAdvanceRef.current?.cancel();entryCount.cancel();sectionJump.cancel();arrangement.cancel();musicalNavigationPendingRef.current=true;manualArrangementNavigation.current=true;},
    select:(id,recorded)=>{eventMixFlushRef.current();onSelectQueueSong?.(id,{autoPlay:!recorded});},
    startCount:entryCount.start,
  });
  musicalNavigationRef.current=musicalNavigation;
  musicalNavigationPendingRef.current=!!musicalNavigation.pending;
  // Volver al inicio, automático: sonando, espera el final de la sección y reinicia con entrada
  // (nunca corta de golpe); detenido, vuelve al inicio de inmediato. Pulsar otra vez cancela el reinicio armado.
  const handleRestartAtSectionEnd=useCallback(()=>{
    if(musicalNavigation.pending?.kind==='restart'){musicalNavigation.cancel();return;}
    if(!isPlaying){void handleReturnToStart();return;}
    void musicalNavigation.arm('restart',songId,songTitle);
  },[isPlaying,handleReturnToStart,musicalNavigation.pending,musicalNavigation.arm,musicalNavigation.cancel,songId,songTitle]);
  const handleMusicalQueueSelect=useCallback((target:LiveDirectorQueueSong)=>{
    if(target.id===activeQueueSongId)return;
    if(isPlaying&&!isManualTempoMode){void musicalNavigation.arm('song',target.id,target.title);return;}
    musicalNavigation.cancel();entryCount.cancel();if(usesEventMixPersistence)eventMixFlushRef.current();onSelectQueueSong?.(target.id);
  },[activeQueueSongId,isPlaying,isManualTempoMode,musicalNavigation.arm,musicalNavigation.cancel,entryCount.cancel,usesEventMixPersistence,onSelectQueueSong]);
  const changeSongTransition=useCallback((fromSongId:string,transition:SongTransition)=>{
    setSongTransitions(previous=>{const next={...previous,[fromSongId]:transition};writeSongTransitions(eventId||'',next);return next;});
    // Un cambio ya armado para esta canción se suelta; el nuevo modo se arma solo si corresponde.
    if(fromSongId===currentQueueSongId&&chainArmedRef.current){chainArmedRef.current='';if(musicalNavigation.pending?.kind==='song')musicalNavigation.cancel();}
  },[eventId,currentQueueSongId,musicalNavigation.pending,musicalNavigation.cancel]);
  // AutoLink, Sobreponer y Cruzada: al entrar en la última sección se prepara la siguiente canción. AutoLink
  // entra justo al terminar esta; las mezclas empiezan antes para terminar con ella (lo menor entre 5 s y
  // la última sección). Una vez por pasada; si ya no queda tiempo para prepararla, la canción termina sola.
  const preparedTransition=showSongTransitions&&!preparedTransitionUnavailable&&transitionTarget&&!transitionAllowsPad(currentTransition.mode)?currentTransition.mode:null;
  useEffect(()=>{
    const nextEventSong=transitionTarget;
    if(!preparedTransition||!nextEventSong||!isPlaying)return;
    const key=`${currentQueueSongId}>${nextEventSong.id}:${preparedTransition}`;
    const timer=setInterval(()=>{
      if(musicalNavigationPendingRef.current||isTransportCueBusyRef.current||sectionJumpActiveRef.current)return;
      const lastIndex=resolvedSections.length-1,last=resolvedSections[lastIndex];if(!last)return;
      const time=selectedMultitrackEngine.getCurrentTimeSnapshot();
      const inLast=arrangementEntries?arrangementCursor.current===lastIndex&&time>=last.startTime:time>=last.startTime;
      if(!inLast){if(chainArmedRef.current===key)chainArmedRef.current='';return;}
      if(chainArmedRef.current===key||last.endTime-time<CHAIN_MIN_PREPARE_SECONDS)return;
      chainArmedRef.current=key;
      if(preparedTransition==='autolink'){handleMusicalQueueSelect(nextEventSong);return;}
      void musicalNavigation.arm('song',nextEventSong.id,nextEventSong.title,
        {mode:preparedTransition,seconds:Math.min(SONG_BLEND_SECONDS,last.endTime-last.startTime)});
    },100);
    return()=>clearInterval(timer);
  },[preparedTransition,transitionTarget,isPlaying,currentQueueSongId,resolvedSections,arrangementEntries,selectedMultitrackEngine,handleMusicalQueueSelect,musicalNavigation.arm]);

  useEffect(() => {
    if (isIOSNativeEngineSurface) {
      independentPadPlayerRef.current?.dispose();
      independentPadPlayerRef.current = null;
      return undefined;
    }

    const padPlayer = new IndependentPadPlayer({
      transitionMs: INTERNAL_PAD_CROSSFADE_MS,
      onPlaybackError: (error) => {
        console.warn('[LiveDirectorView] Independent pad playback failed.', error);
      },
    });
    independentPadPlayerRef.current = padPlayer;

    return () => {
      if (independentPadPlayerRef.current === padPlayer) {
        independentPadPlayerRef.current = null;
      }
      padPlayer.dispose();
    };
  }, [isIOSNativeEngineSurface]);

  useEffect(() => {
    if (isIOSNativeEngineSurface) return undefined;
    const padPlayer = independentPadPlayerRef.current;
    if (!padPlayer) return undefined;
    let cancelled = false;

    if (isPadActive && resolvedPadUrl) {
      const alreadyStartedFromGesture = padGestureStartUrlRef.current === resolvedPadUrl;
      padGestureStartUrlRef.current = null;
      if (!alreadyStartedFromGesture) {
        void padPlayer.switchTo(resolvedPadUrl, effectiveInternalPadVolume).then((result) => {
          if (!cancelled && result.status === 'failed') {
            setIsPadActive(false);
          }
        });
      }
    } else {
      padGestureStartUrlRef.current = null;
      padPlayer.stop(INTERNAL_PAD_CROSSFADE_MS);
    }

    return () => {
      cancelled = true;
    };
  }, [isIOSNativeEngineSurface, isPadActive, resolvedPadUrl]);

  useEffect(() => {
    if (isIOSNativeEngineSurface) return;
    independentPadPlayerRef.current?.setVolume(effectiveInternalPadVolume);
  }, [effectiveInternalPadVolume, isIOSNativeEngineSurface]);

  const persistSongSession = useCallback(async (payload: {
    mode: 'sequence' | 'folder';
    tracks: Array<TrackData & { sourceFileName?: string }>;
    unmatchedFiles?: string[];
    sectionOffsetSeconds?: number;
  }) => {
    if (!hasPersistedSongContext) {
      throw new Error('No hay una cancion seleccionada para guardar esta sesion.');
    }
    if (!canManagePersistedSongSession) {
      throw new Error('Necesitas el rol Gestor de Secuencias para cargar o reemplazar secuencias.');
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
  }, [applyManualSession, buildSessionSavePayload, canManagePersistedSongSession, enqueueSessionSave, hasPersistedSongContext, onSessionPersisted, sectionOffsetSeconds, songId]);

  const updateSectionOffsetLocally = useCallback((nextOffset: number) => {
    if (!Number.isFinite(nextOffset)) return;
    const safeOffset = experimentalTools ? Math.round(nextOffset * 1000) / 1000 : Math.round(nextOffset * 4) / 4;
    setManualSession((previous) => (
      previous
        ? {
          ...previous,
          sectionOffsetSeconds: safeOffset,
        }
        : previous
    ));
  }, [experimentalTools]);

  const commitSectionOffset = useCallback(async (): Promise<boolean> => {
    if (experimentalTools || !hasPersistedSongContext || !manualSession) {
      return true;
    }
    if (!canManagePersistedSongSession) {
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
  }, [experimentalTools, canManagePersistedSongSession, enqueueSessionSave, hasPersistedSongContext, manualSession, onSessionPersisted, songId]);

  // Buses de la mezcla del evento: llegan con la sesión (applyLiveDirectorEventMix) y se guardan con los stems.
  const savedMixGroups = (initialSession as { mixGroups?: SavedMixGroups } | null | undefined)?.mixGroups ?? null;
  const eventMixGroupsRef = useRef<SavedMixGroups | null>(savedMixGroups);
  const eventMixGroupsSongRef = useRef(songId);
  if (eventMixGroupsSongRef.current !== songId) { eventMixGroupsSongRef.current = songId; eventMixGroupsRef.current = savedMixGroups; }

  const commitMixerStateSilent = useCallback((tracksOverride?: TrackData[]) => {
    if (!hasPersistedSongContext || !manualSession || manualSession.songId !== songId ||
        (usesEventMixPersistence && !currentSessionPreparedRef.current)) {
      return;
    }

    const currentVolumes = congregationOriginalVolumesRef.current.size > 0
      ? {
        ...trackVolumes,
        ...Object.fromEntries(congregationOriginalVolumesRef.current),
      }
      : trackVolumes;
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

    if (usesEventMixPersistence && onEventMixChange) {
      const eventMix = buildLiveDirectorEventMix(nextTracks, eventMixGroupsRef.current) as LiveDirectorEventMixPayload | null;
      if (eventMix) {
        void Promise.resolve(onEventMixChange(eventMix)).catch((error) => {
          console.warn('[LiveDirectorView] Event mixer autosave failed.', error);
        });
      }
      return;
    }

    queueSilentSessionSave(buildSessionSavePayload({
      mode: manualSession.mode,
      tracks: nextTracks,
      unmatchedFiles: manualSession.unmatchedFiles || [],
      sectionOffsetSeconds: Number(manualSession.sectionOffsetSeconds) || 0,
    }));
  }, [buildSessionSavePayload, hasPersistedSongContext, manualSession, mutedTrackIds, onEventMixChange, queueSilentSessionSave, songId, trackOutputRoutes, trackVolumes, usesEventMixPersistence]);

  useEffect(() => {
    eventMixFlushRef.current = () => commitMixerStateSilent();
    return () => {
      eventMixFlushRef.current = () => undefined;
    };
  }, [commitMixerStateSilent]);

  useEffect(() => {
    if (!usesEventMixPersistence) return;
    const flushEventMix = () => eventMixFlushRef.current();
    window.addEventListener('pagehide', flushEventMix);
    return () => window.removeEventListener('pagehide', flushEventMix);
  }, [usesEventMixPersistence]);

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
    // Congregation mode changes live faders temporarily. The originals map is
    // populated synchronously, so it also closes the gap before React commits
    // the visible fade state.
    if (
      !hasPersistedSongContext ||
      !manualSession ||
      !currentSessionPrepared ||
      isInitializingSession ||
      congregationFadeState !== 'normal' ||
      congregationOriginalVolumesRef.current.size > 0
    ) return;

    const isDirty = manualSession.tracks.some((t) => (
      (trackVolumes[t.id] !== undefined && trackVolumes[t.id] !== t.volume) ||
      (!usesEventMixPersistence && (
        (mutedTrackIds.has(t.id) !== t.isMuted) ||
        ((trackOutputRoutes[t.id] ?? resolveTrackOutputRoute(t)) !== resolveTrackOutputRoute(t))
      ))
    ));

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
  }, [trackOutputRoutes, trackVolumes, mutedTrackIds, manualSession, commitMixerStateSilent, congregationFadeState, hasPersistedSongContext, currentSessionPrepared, isInitializingSession, usesEventMixPersistence]);

  // Persist newly-computed activity envelopes exactly once. When either the
  // iOS native engine or the web engine finishes loading tracks it hands us a
  // fresh `trackEnvelopes` map. We push that snapshot back into R2 via the
  // silent save queue so subsequent reloads (including cold iPhone starts)
  // skip the per-track envelope computation entirely.
  const persistedEnvelopeSignatureRef = useRef<string>('');
  useEffect(() => {
    if (!hasPersistedSongContext || !manualSession || isInitializingSession || usesEventMixPersistence) return;

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
  }, [commitMixerStateSilent, hasPersistedSongContext, isInitializingSession, manualSession, trackEnvelopes, usesEventMixPersistence]);

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
    if (!canManageStemSelection) {
      return;
    }

    const initial: Record<string, boolean> = {};
    (manualSession?.tracks || []).forEach((track) => { initial[track.id] = track.enabled !== false; });
    setPendingEnabledMap(capEnabledMapToTrackLimit(initial));
    setShowStemsActionModal(false);
    setShowTrackLoadModal(true);
  }, [canManageStemSelection, capEnabledMapToTrackLimit, manualSession?.tracks]);

  const handleOpenStemsLoader = useCallback(() => {
    if (!canOpenLoadPanel) {
      return;
    }

    setShowStemsActionModal(false);
    setShowTrackLoadModal(false);
    setLoaderMode('folder');
    setShowLoadPanel(true);
  }, [canOpenLoadPanel]);

  const handleOpenSingleStemPicker = useCallback(() => {
    if (!canAddSingleStem || busyMessage || deletingTrackId) {
      return;
    }

    setLoadError(null);
    setShowStemsActionModal(false);
    setShowTrackLoadModal(false);
    singleStemInputRef.current?.click();
  }, [busyMessage, canAddSingleStem, deletingTrackId]);

  const offsetButtonRef = useRef<HTMLButtonElement | null>(null);
  const [offsetAnchor, setOffsetAnchor] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!showOffsetModal) { setOffsetAnchor(null); return undefined; }
    const place = () => {
      const rect = offsetButtonRef.current?.getBoundingClientRect();
      setOffsetAnchor(rect && rect.width > 0
        ? { top: Math.min(rect.bottom + 8, window.innerHeight - 120), right: Math.max(8, window.innerWidth - rect.right) }
        : { top: 72, right: 16 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [showOffsetModal]);
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
      await assertLiveDirectorM4aFiles([file]);

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
      await assertLiveDirectorM4aFiles(files);

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

  const handleSingleStemSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      if (!canAddSingleStem || !manualSession) {
        throw new Error('Primero carga una sesion multitrack para agregar stems individuales.');
      }

      await assertLiveDirectorM4aFiles([file]);
      setLoadError(null);
      setBusyMessage(`Preparando ${file.name}...`);

      const inference = inferStemTracksFromFiles([file]);
      const matchedFile = inference.matchedFiles[0];
      if (!matchedFile) {
        throw new Error('No se pudo reconocer el stem seleccionado.');
      }

      const existingTrackIds = new Set(manualSession.tracks.map((track) => track.id));
      let nextTrackId = matchedFile.trackId;
      let nextTrackName = matchedFile.trackName;
      let duplicateIndex = 2;
      while (existingTrackIds.has(nextTrackId)) {
        nextTrackId = `${matchedFile.trackId}-${duplicateIndex}`;
        nextTrackName = `${matchedFile.trackName} ${duplicateIndex}`;
        duplicateIndex += 1;
      }

      setBusyMessage(`Subiendo ${file.name}...`);
      const uploadTarget = await requestLiveDirectorUploadTarget({
        songId,
        fileName: `${nextTrackId}-${file.name}`,
        fileType: file.type,
        kind: 'stems',
      });
      await uploadFileToLiveDirectorTarget(file, uploadTarget);

      const currentTracks = manualSession.tracks.map((track) => ({
        ...track,
        volume: trackVolumes[track.id] ?? track.volume,
        isMuted: mutedTrackIds.has(track.id),
        outputRoute: trackOutputRoutes[track.id] ?? resolveTrackOutputRoute(track),
      }));

      await persistSongSession({
        mode: 'folder',
        tracks: [
          ...currentTracks,
          {
            id: nextTrackId,
            name: nextTrackName,
            url: uploadTarget.publicUrl,
            volume: matchedFile.defaultVolume,
            isMuted: false,
            enabled: true,
            sourceFileName: file.name,
            outputRoute: resolveTrackOutputRoute({
              id: nextTrackId,
              name: nextTrackName,
              sourceFileName: file.name,
            }),
          },
        ],
        unmatchedFiles: manualSession.unmatchedFiles,
        sectionOffsetSeconds: Number(manualSession.sectionOffsetSeconds) || 0,
      });
    } catch (error) {
      console.error('[LiveDirectorView] Single stem upload failed.', error);
      setBusyMessage(null);
      setLoadError(error instanceof Error ? error.message : 'No se pudo agregar el stem.');
    }
  };

  const handleDeleteStem = useCallback(async (trackId: string) => {
    if (!hasPersistedSongContext || !canManagePersistedSongSession || deletingTrackId) {
      return;
    }

    if (!manualSession) {
      return;
    }

    const track = manualSession.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
      return;
    }

    const isLastTrack = manualSession.tracks.length === 1;
    const confirmed = window.confirm(
      isLastTrack
        ? `¿Eliminar "${track.sourceFileName || track.name}"? Es el ultimo stem; tambien se borrara la sesion y sus archivos de R2.`
        : `¿Eliminar "${track.sourceFileName || track.name}" de la sesion y de R2?`,
    );
    if (!confirmed) {
      return;
    }

    stop();
    setLoadError(null);
    setDeletingTrackId(trackId);
    setBusyMessage(`Eliminando ${track.sourceFileName || track.name} de R2...`);

    try {
      const savedSession = await deleteLiveDirectorSongTrack({ songId, trackId });

      if (savedSession) {
        applyManualSession(toResolvedSession(savedSession));
        onSessionPersisted?.(savedSession);
      } else {
        setUnmatchedFiles([]);
        setMutedTrackIds(new Set());
        setSoloTrackIds(new Set());
        setManualSession(null);
        replaceOwnedObjectUrls([]);
        setReloadKey((previous) => previous + 1);
      }

      setLoaderMode('folder');
      setShowStemsActionModal(false);
      setShowTrackLoadModal(false);
      setShowLoadPanel(canOpenLoadPanel);
    } catch (error) {
      console.error('[LiveDirectorView] Single stem delete failed.', error);
      setLoadError(error instanceof Error ? error.message : 'No se pudo eliminar el stem.');
    } finally {
      setDeletingTrackId(null);
      setBusyMessage(null);
    }
  }, [applyManualSession, canManagePersistedSongSession, canOpenLoadPanel, deletingTrackId, hasPersistedSongContext, manualSession, onSessionPersisted, replaceOwnedObjectUrls, songId, stop]);

  const navigateToSection = (section: LiveDirectorSectionVisual) => {
    if (experimentalTools && isPlaying) {
      armSectionFromTimeline(section.id);
      return;
    }
    if (arrangementEntries) arrangement.focus(section.id);
    void handleSectionSeek(section.startTime);
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

    const playbackSectionIndex = getSectionIndexAtTime(getLivePlaybackTime());
    const currentSection = resolvedSections[playbackSectionIndex];
    if (currentSection && (getLivePlaybackTime() - currentSection.startTime > 2.5)) {
      navigateToSection(currentSection);
      return;
    }

    const targetIndex = Math.max(0, playbackSectionIndex - 1);
    const targetSection = resolvedSections[targetIndex];
    if (targetSection) navigateToSection(targetSection);
  };

  const handleNextSection = () => {
    if (!hasTrackSession || isTransportCueBusy || isCongregationFading) {
      return;
    }

    if (resolvedSections.length === 0) {
      return;
    }

    const lastIndex = resolvedSections.length - 1;
    const playbackSectionIndex = getSectionIndexAtTime(getLivePlaybackTime());
    const targetIndex = Math.min(lastIndex, playbackSectionIndex + 1);
    const targetSection = resolvedSections[targetIndex];
    if (!targetSection) {
      return;
    }

    // If we're already on the last section, snap to its start (useful for
    // re-cueing the outro) instead of doing nothing.
    navigateToSection(targetSection);
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

  const handleMuteTrack = (trackId: string) => {
    const isManualClickTrack = isManualTempoMode && trackId === MANUAL_CLICK_TRACK_ID;
    if (!hasTrackSession && !isManualClickTrack) {
      return;
    }

    toggleMute(trackId);
    if (isManualClickTrack) {
      return;
    }
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

  const handleStemsToolbarAction = () => {
    if (!canUseStemsToolbar) {
      return;
    }

    if (canManageStemSelection) {
      handleOpenTrackLoadModal();
      return;
    }

    if (canOpenStemsActionModal) {
      setShowStemsActionModal(true);
    }
  };

  const handleSoloTrack = (trackId: string) => {
    if (isManualTempoMode && trackId === MANUAL_CLICK_TRACK_ID) {
      return;
    }
    if (!hasTrackSession) {
      return;
    }

    soloTrack(trackId);
    setSoloTrackIds((previous) => {
      const next = new Set(previous);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
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

  const handleCycleOutputLayout = useCallback(() => {
    if (!hasTrackSession) {
      return;
    }

    const nextLayout = nextLiveDirectorOutputLayout(outputLayout);
    const sourceTracks = hasProvidedTracks ? sessionTracks : manualSession?.tracks || [];
    const nextRoutes = buildTrackOutputRouteMap(sourceTracks, nextLayout);
    const activeIds = new Set(activeTracks.map((track) => track.id));

    setOutputLayout(nextLayout);
    setTrackOutputRoutes(nextRoutes);

    sourceTracks.forEach((track) => {
      if (activeIds.has(track.id)) {
        setTrackOutputRoute(track.id, nextRoutes[track.id]);
      }
    });

    if (!manualSession) {
      return;
    }

    const nextTracks = manualSession.tracks.map((track) => ({
      ...track,
      outputRoute: nextRoutes[track.id] ?? resolveTrackOutputRouteForLayout(track, nextLayout),
    }));

    setManualSession((previous) => (
      previous ? { ...previous, tracks: nextTracks } : previous
    ));

    if (hasPersistedSongContext && !usesEventMixPersistence) {
      queueSilentSessionSave(buildSessionSavePayload({
        mode: manualSession.mode,
        tracks: nextTracks,
        unmatchedFiles: manualSession.unmatchedFiles || [],
        sectionOffsetSeconds: Number(manualSession.sectionOffsetSeconds) || 0,
      }));
    }
  }, [
    activeTracks,
    buildSessionSavePayload,
    hasPersistedSongContext,
    hasProvidedTracks,
    hasTrackSession,
    manualSession,
    outputLayout,
    queueSilentSessionSave,
    sessionTracks,
    setTrackOutputRoute,
    usesEventMixPersistence,
  ]);

  const outputLayoutLabel = outputLayout === 'guide-right'
    ? 'STEMS L · CLICK+GUÍA R'
    : 'CLICK+GUÍA L · STEMS R';

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
      void NativeLiveDirectorEngine.stopPad({ fadeSeconds: INTERNAL_PAD_CROSSFADE_SECONDS }).catch((error) => {
        console.warn('[LiveDirectorView] Native pad bridge stop failed.', error);
      });
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
    setIsPadActive: setPadActiveFromGesture,
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

      cancelGestureConsumedRef.current = false;
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) && eventAdvanceRef.current?.cancel()) {
        cancelGestureConsumedRef.current = true;
        event.preventDefault(); event.stopPropagation(); return;
      }

      if (entryCount.pending && (event.key === 'Escape' || event.code === 'Space' || event.key === ' ')) {
        event.preventDefault(); event.stopPropagation(); entryCount.cancel(); return;
      }

      if (
        showLoadPanel ||
        showStemsActionModal ||
        showTrackLoadModal ||
        showOffsetModal ||
        showManualTempoModal ||
        showArrangementEditor ||
        showBackConfirm
      ) {
        return;
      }

      if (event.key==='Escape' && musicalNavigation.cancel()) {event.preventDefault();return;}
      if (document.querySelector('dialog[open]')) return;
      const editing = event.target instanceof Element && !!event.target.closest('input,textarea,select,[contenteditable="true"],[data-live-director-shortcuts="off"]');
      const queueNumber = queueNumberFromKey(event.key);
      if (experimentalTools && isEnsayoMode && !editing && queueNumber && onSelectQueueSong) {
        const target = ensayoSlotSongs[queueNumber - 1];
        if (target) {
          event.preventDefault(); event.stopPropagation();
          if (target.id !== activeQueueSongId) {
            handleMusicalQueueSelect(target);
          }
        }
        return;
      }
      if (experimentalTools && !editing && event.code === 'KeyE' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        if (event.shiftKey) pressLiveDirectorControl('[data-live-director-control="edit-song"]');
        else handleRestartAtSectionEnd();
        return;
      }
      if (entryCount.pending && event.key === 'Escape') { event.preventDefault(); entryCount.cancel(); return; }

      if (experimentalTools && (sectionJump.armed || sectionJump.repeat) && event.key === 'Escape') {
        event.preventDefault(); sectionJump.cancel(); return;
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

      if (desktopSectionKeyboardEnabled && !globalShortcutTargetBlocked && experimentalTools && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const instructionKey = (event.shiftKey ? INSTRUCTION_SHIFT_KEYS : INSTRUCTION_KEYS)[event.code];
        if (instructionKey) {
          event.preventDefault();
          const option = GUIDE_INSTRUCTION_OPTIONS.find(item => item.key === instructionKey);
          if (option && dynamicGuide.status === 'ready') dynamicGuide.speak(option.label);
          return;
        }
        const control = !event.shiftKey ? ({
          KeyG: '[data-live-director-control="groups"]',
          KeyH: '[data-live-director-control="repeat-hold"]',
          KeyL: '[data-live-director-control="song-transition"][data-transition-current="true"]',
          KeyA: '[data-live-director-control="song-level"]',
          KeyT: 'button[aria-label="Configurar metrónomo"]',
          KeyI: '[data-live-director-control="guide-instructions"]',
        } as Record<string, string>)[event.code] : undefined;
        if (control) { event.preventDefault(); pressLiveDirectorControl(control); return; }
      }

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

        if (event.code === 'KeyS' && event.shiftKey && !isManualTempoMode && !desktopCombined) {
          event.preventDefault();
          setSurfaceView((previous) => previous === 'mix' ? 'sections' : 'mix');
          return;
        }

        if (event.code === 'KeyP' && resolvedPadUrl) {
          event.preventDefault();
          setPadActiveFromGesture((previous) => !previous);
          return;
        }

        if (event.code === 'KeyR' && hasPlayableSession && !isTransportCueBusy && !isCongregationFading) {
          event.preventDefault();
          if (experimentalTools) {
            if (sectionJump.repeat?.mode === 'once') sectionJump.cancel();
            else startRepeatFromTimeline('once');
          } else {
            void handleReturnToStart();
          }
          return;
        }

        if (event.code === 'KeyF' && hasTrackSession && isReady && !isTransportCueBusy) {
          event.preventDefault();
          handleToggleCongregationFade();
          return;
        }

        if (event.code === 'KeyS' && !event.shiftKey && canUseStemsToolbar) {
          event.preventDefault();
          handleStemsToolbarAction();
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
        if (experimentalTools && isPlaying) armSectionFromTimeline(targetSection.id);
        else { if (arrangementEntries) arrangement.focus(targetSection.id); void handleSectionSeek(targetSection.startTime); }
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

      // Salir con Esc, solo cuando no queda nada que cancelar (salto, repetición, conteo y selección ya
      // respondieron arriba) ni hay un menú o panel abierto; sonando, pide confirmación.
      if ((event.key === 'Escape' || event.code === 'Escape') && desktopSectionKeyboardEnabled && !globalShortcutTargetBlocked) {
        const overlayOpen = Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [role="menu"]'))
          .some(element => element.getClientRects().length > 0 || element.matches('dialog[open]'));
        if (!overlayOpen) {
          event.preventDefault();
          if (isPlaying) setShowBackConfirm(true); else void exitLiveDirector();
        }
        return;
      }

      if (event.code !== 'Space' && event.key !== ' ') {
        return;
      }

      // Space cancels the visible countdown even if a queue card still has
      // focus; do not also activate that focused button and restart the song.
      if (eventAdvanceRef.current?.cancel()) { event.preventDefault(); event.stopPropagation(); return; }
      if (shouldIgnoreKeyboardShortcutTarget(event.target)) return;
      if (!isReady || isTransportCueBusy) return;

      event.preventDefault();
      handleTogglePlaybackFromGesture();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [
    canUseStemsToolbar,
    musicalNavigation.cancel, handleMusicalQueueSelect, handleRestartAtSectionEnd, dynamicGuide.status, dynamicGuide.speak, entryCount.cancel, entryCount.pending, isEnsayoMode, ensayoSlotSongs, onSelectQueueSong, activeQueueSongId, usesEventMixPersistence,
    exitLiveDirector,
    getLivePlaybackTime,
    getSectionIndexAtTime,
    handleNextSection,
    handlePreviousSection,
    handleSectionSeek,
    experimentalTools,
    armSectionFromTimeline,
    desktopCombined,
    sectionJump.armed,
    sectionJump.repeat,
    sectionJump.cancel,
    startRepeatFromTimeline,
    handleStemsToolbarAction,
    handleReturnToStart,
    handleToggleCongregationFade,
    handleTogglePlaybackFromGesture,
    hasPlayableSession,
    hasTrackSession,
    isCongregationFading,
    isNativeIosShell,
    isManualTempoMode,
    isPlaying,
    isReady,
    isTransportCueBusy,
    keyboardSectionIndex,
    releaseSectionsAutoFollowNow,
    resolvedPadUrl,
    resolvedSections,
    arrangementEntries,
    arrangement.focus,
    scheduleSectionsAutoFollowResume,
    setPadActiveFromGesture,
    setVisualSectionTime,
    showBackConfirm,
    showLoadPanel,
    showManualTempoModal,
    showArrangementEditor,
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
    lastSectionTapRef.current = null;

    container.scrollLeft = dragState.startScrollLeft - deltaX;
    event.preventDefault();
  }, [holdSectionsAutoFollow]);

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
  const minimapPendingSeekTimeRef = useRef<number | null>(null);
  // When set, render a tooltip above the minimap showing the section name and
  // timestamp at the hovered/dragged position. Cleared when the finger lifts.
  const [minimapHoverTime, setMinimapHoverTime] = useState<number | null>(null);

  const minimapXToTime = useCallback((clientX: number): number => {
    const node = minimapTrackRef.current;
    if (!node || navigationDuration <= 0) return 0;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const x = clamp(clientX - rect.left, 0, rect.width);
    return (x / rect.width) * navigationDuration;
  }, [navigationDuration]);

  const handleMinimapPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!isReady || isCongregationFading || isTransportCueBusy) return;
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
  }, [holdSectionsAutoFollow, minimapXToTime, isReady, isCongregationFading, isTransportCueBusy]);

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
    if (!minimapDragActiveRef.current || minimapDragPointerIdRef.current !== event.pointerId) return;
    const seekTime = minimapPendingSeekTimeRef.current ?? minimapXToTime(event.clientX);
    endMinimapDrag(event);
    if (!isReady || isCongregationFading || isTransportCueBusy) return;
    if (seekTime <= 0) { void handleReturnToStart(); return; }
    const target = arrangementEntries ? arrangementSourceAt(resolvedSections, seekTime) : null;
    if (target) arrangement.focus(target.id);
    void handleSectionSeek(target?.time ?? seekTime);
  }, [endMinimapDrag, handleSectionSeek, minimapXToTime, arrangementEntries, resolvedSections, arrangement.focus, handleReturnToStart, isReady, isCongregationFading, isTransportCueBusy]);

  const handleMinimapPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    endMinimapDrag(event);
  }, [endMinimapDrag]);

  const handleMinimapKeyDown = useCallback((event: import('react').KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? navigationDuration
      : ['ArrowRight', 'ArrowUp'].includes(event.key) ? navigationTime + step
      : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? navigationTime - step : null;
    if (next === null) return;
    event.preventDefault(); event.stopPropagation();
    if (!isReady || isCongregationFading || isTransportCueBusy) return;
    const time = clamp(next, 0, navigationDuration);
    if (time <= 0) { void handleReturnToStart(); return; }
    const target = arrangementEntries ? arrangementSourceAt(resolvedSections, time) : null;
    if (target) arrangement.focus(target.id);
    void handleSectionSeek(target?.time ?? time);
  }, [navigationDuration, navigationTime, isReady, isCongregationFading, isTransportCueBusy, arrangementEntries, resolvedSections, arrangement.focus, handleSectionSeek, handleReturnToStart]);

  const pendingEnabledCount = pendingEnabledMap
    ? Object.values(pendingEnabledMap).filter(Boolean).length
    : activeTracks.length;

  const advancedStreamingActive = diagnostics?.engineRoute === 'streaming-worker';
  // Por qué «Editar» está apagado, en el orden en que conviene resolverlo (null = disponible).
  const editSongUnavailableReason = !eventArrangement.canEdit
    ? (eventId ? 'Este evento es de solo lectura: no tienes permiso para editar su arreglo.' : 'No tienes permiso para editar esta canción.')
    : eventArrangement.loading ? 'Cargando el arreglo del evento…'
    : eventArrangement.error ? `No se pudo cargar el arreglo: ${eventArrangement.error}`
    : isPlaying ? 'Pausa para editar la canción.'
    : !isReady || isInitializingSession || sessionPreparationPending ? 'Espera a que termine de cargar la canción.'
    : busyMessage || isTransportCueBusy || isCongregationFading ? 'Espera a que termine la acción en curso.'
    : diagnostics?.engineRoute !== 'streaming-worker' ? 'Editar necesita el motor nuevo, que este navegador no está usando.'
    : sourceSections.length === 0 ? 'La canción no tiene secciones marcadas para editar.'
    : null;
  const eventMixSaveNotice = eventMixSaveStatus === 'saving' ? 'Guardando…'
    : eventMixSaveStatus === 'saved' ? 'Guardado'
      : eventMixSaveStatus === 'error' ? 'Mezcla pendiente de guardar. Se reintentará al reconectar.' : '';

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

  const sectionSurface = showArrangementEditor ? (
    <LiveDirectorArrangementEditor key={arrangementIdentity} onClose={() => setShowArrangementEditor(false)}
      busy={isPlaying || isSectionSeekBusy || isCongregationFading} sections={sourceSections} entries={arrangementEntries}
      eventTitle={eventId ? eventTitle || 'Evento actual' : undefined} onApply={applyArrangement} />
  ) : (
<div data-live-director-section-surface="true" className="relative flex min-h-0 flex-col overflow-hidden rounded-[1.2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(29,30,32,0.98),rgba(23,24,26,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div data-live-director-section-controls="true" data-live-repeat-count={sectionJump.repeat?.completed ?? 0} className="relative z-40 flex h-11 shrink-0 items-center gap-2 border-b border-white/5 px-3 text-xs text-white/60">
                <span className="shrink-0 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-white/35">Secciones</span>
                <span className="min-w-0 truncate font-medium text-white/80">{activeSection?.name || '—'}</span>
                {experimentalTools && <>
                  {sectionJump.armed ? <span role="status" title={sectionJump.notice} className="flex min-w-0 items-center gap-1.5 text-amber-100/90">
                    <ArrowRight size={13} className="shrink-0"/><span className="truncate">{sectionJump.armed.section.name}</span>
                    <span aria-label={sectionJump.preparation === 'ready' ? 'Stems listos' : 'Preparando stems'} className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-bold ${sectionJump.preparation === 'ready' ? 'bg-emerald-300/15 text-emerald-200' : 'animate-pulse text-amber-200'}`}>
                      <span className={`h-2 w-2 rounded-full ${sectionJump.preparation === 'ready' ? 'bg-emerald-300' : 'bg-amber-200'}`}/>
                      {sectionJump.preparation === 'ready' ? `Listo · ${activeTracks.length}/${activeTracks.length}` : 'Precargando…'}
                    </span>
                    <button type="button" aria-label="Cancelar salto de sección" onClick={sectionJump.cancel} className="flex h-8 w-7 shrink-0 items-center justify-center rounded-lg hover:bg-white/5"><X size={14}/></button>
                  </span> : sectionJump.repeat ? <span role="status" title={sectionJump.notice} className="min-w-0 truncate text-cyan-100/70">{sectionJump.repeat.exitRequested ? 'Sale al terminar' : sectionJump.preparation === 'preparing' ? 'Preparando…' : `× ${sectionJump.repeat.completed}`}</span>
                  : selectedJumpSection && isPlaying && selectedJumpSection.id !== activeSection?.id ? <span className="flex min-w-0 items-center gap-1 text-white/65"><span className="truncate">{selectedJumpSection.name}</span><button type="button" aria-label="Armar salto" title="Armar salto al terminar la sección actual" onClick={() => armSectionFromTimeline(selectedJumpSection.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-cyan-100 hover:bg-white/5"><ArrowRight size={17}/></button></span>
                  : null}
                  <span className="flex-1"/>
                  {dynamicGuide.nextInstruction && <span data-live-director-control="next-instruction" title="Próxima instrucción de la guía" className="min-w-0 truncate text-[10px] text-white/50">Próx. instrucción · <span className="text-white/75">{dynamicGuide.nextInstruction.name}</span></span>}
                  <button type="button" data-live-director-control="guide-instructions" aria-label="Instrucciones" aria-haspopup="menu" aria-expanded={Boolean(instructionMenuAnchor)} disabled={dynamicGuide.status !== 'ready'} aria-keyshortcuts="I" title={dynamicGuide.status === 'ready' ? 'Decir una instrucción ahora · I (o directo con Z X C V B N M , . -)' : 'Disponible con la guía automática'} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setInstructionMenuAnchor(open => open ? null : { top: rect.bottom + 6, right: window.innerWidth - rect.right }); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/35 hover:bg-white/5 hover:text-white/80 disabled:opacity-40 disabled:hover:bg-transparent"><Megaphone size={14}/></button>
                  {instructionMenuAnchor && dynamicGuide.status === 'ready' && createPortal(<div role="menu" aria-label="Instrucciones" data-guide-instruction-menu="true" style={{ position: 'fixed', top: instructionMenuAnchor.top, right: instructionMenuAnchor.right }} className="z-[80] w-[27rem] max-w-[calc(100vw-1rem)] rounded-xl border border-white/10 bg-[#17181a] p-2 shadow-[0_14px_32px_rgba(0,0,0,0.4)]">
                    <p className="px-2 pb-1.5 pt-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-white/35">Instrucciones · se dicen ahora</p>
                    <div className="grid grid-cols-3 gap-1">{GUIDE_INSTRUCTION_OPTIONS.map(option => <button key={option.key} type="button" role="menuitem" data-guide-instruction={option.key} aria-keyshortcuts={INSTRUCTION_SHORTCUT_LABELS[option.key]?.replace('⇧', 'Shift+')} onClick={() => { dynamicGuide.speak(option.label); setInstructionMenuAnchor(null); }} className="flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-left text-xs text-white/75 hover:bg-white/5 hover:text-white"><span className="min-w-0 flex-1 truncate">{option.label}</span>{INSTRUCTION_SHORTCUT_LABELS[option.key] && <kbd className="shrink-0 rounded border border-white/12 px-1 font-sans text-[0.58rem] font-bold text-white/45">{INSTRUCTION_SHORTCUT_LABELS[option.key]}</kbd>}</button>)}</div>
                  </div>, document.body)}
                  {dynamicGuide.status === 'error' ? <button type="button" data-live-director-control="guide-status" data-guide-state="error" aria-label="Reintentar guía automática" title={dynamicGuide.error || 'Reintentar guía automática'} onClick={() => setGuideRetryKey(previous => previous + 1)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-amber-200/75"><Headphones size={14}/></button>
                  : <span data-live-director-control="guide-status" data-guide-state={dynamicGuide.status} role="img" aria-label={dynamicGuide.status === 'loading' ? 'Preparando guía automática' : dynamicGuide.status === 'off' ? 'Guía grabada' : 'Guía automática'} title={dynamicGuide.status === 'loading' ? 'Preparando guía automática' : dynamicGuide.status === 'off' ? 'Guía grabada' : 'Cuenta en español solo al armar un salto que omite o vuelve a una sección'} className={`flex h-8 w-5 shrink-0 items-center justify-center text-white/30 ${dynamicGuide.status === 'loading' ? 'animate-pulse' : ''}`}><Headphones size={13}/></span>}
                </>}
                {eventAdvance.notice && <span role="status" title={eventAdvance.notice} className="min-w-0 truncate text-[10px] text-cyan-100/60">{eventAdvance.notice}</span>}
                {arrangementEntries && <span data-live-director-control="arrangement-status" title={arrangement.notice || 'Arreglo de prueba'} className="min-w-0 truncate text-[10px] text-cyan-100/60">Arreglo {arrangement.index + 1}/{resolvedSections.length}{arrangement.notice.startsWith('Arreglo pausado') ? ' · Pausado' : ''}</span>}
                <button ref={offsetButtonRef} type="button" aria-label="Abrir ajuste de desfase" title="Ajustar marcadores con precisión" onClick={() => showOffsetModal ? void handleCloseOffsetModal() : handleOpenOffsetModal()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/35 hover:bg-white/5 hover:text-white/80">±</button>
                {sectionLaneMinimapSegments.length > 0 && <button type="button" data-live-director-control="section-map" aria-pressed={showSectionMap}
                  aria-label={showSectionMap ? 'Ocultar mapa de secciones' : 'Mostrar mapa de secciones'} title={showSectionMap ? 'Ocultar mapa de secciones' : 'Mostrar mapa de secciones'}
                  onClick={toggleSectionMap}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-white/5 ${showSectionMap ? 'bg-white/8 text-cyan-100/90' : 'text-white/35 hover:text-white/80'}`}><MapIcon size={14}/></button>}
                <span className="sr-only" role="status" aria-live="polite">{[sectionJump.notice, arrangementEntries ? arrangement.notice : ''].filter(Boolean).join('. ')}</span>
              </div>
              {!experimentalTools && nextSectionPreview && !sectionJump.armed && !sectionJump.repeat && (
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
                      ? (experimentalTools && isPlaying ? 'Enter para armar · Auto en 5s' : 'Enter para ir · Auto en 5s')
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
              {/* En una capa propia, anclada bajo el botón ±: dentro del panel de secciones quedaba recortado. */}
              {showOffsetModal && offsetAnchor && createPortal(
                <div data-live-director-offset-panel="true" style={{ position: 'fixed', top: offsetAnchor.top, right: offsetAnchor.right }} className="z-[80] w-[16rem] max-w-[calc(100vw-1rem)] rounded-[1.25rem] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,22,0.98),rgba(13,15,17,0.98))] p-3 shadow-[0_24px_48px_rgba(0,0,0,0.5)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-white/42">Desfase</p>
                      <p className="mt-1 text-[1rem] font-semibold text-white/86">
                        {sectionOffsetSeconds >= 0 ? '+' : ''}
                        {sectionOffsetSeconds.toFixed(3)}s
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
                        updateSectionOffsetLocally(sectionOffsetSeconds - (experimentalTools ? 0.01 : 0.25));
                      }}
                      className="ui-pressable-soft flex h-10 items-center justify-center rounded-[0.95rem] border border-white/10 bg-black/28 text-[0.88rem] font-black text-white/76"
                      aria-label="Mover secciones antes" title={experimentalTools ? 'Adelantar 10 ms' : 'Adelantar 250 ms'}
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
                        updateSectionOffsetLocally(sectionOffsetSeconds + (experimentalTools ? 0.01 : 0.25));
                      }}
                      className="ui-pressable-soft flex h-10 items-center justify-center rounded-[0.95rem] border border-white/10 bg-black/28 text-[0.88rem] font-black text-white/76"
                      aria-label="Mover secciones despues" title={experimentalTools ? 'Retrasar 10 ms' : 'Retrasar 250 ms'}
                    >
                      +
                    </button>
                  </div>
                  {experimentalTools && <label className="mt-3 block text-[0.65rem] text-white/55">Desfase en segundos
                    <input type="number" aria-label="Desfase preciso de secciones" step="0.001" value={sectionOffsetSeconds} onChange={event => { if (event.currentTarget.value !== '') updateSectionOffsetLocally(Number(event.currentTarget.value)); }} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm tabular-nums text-white/90"/>
                    <span className="mt-2 block leading-relaxed">Ajuste local de 1 ms. No mueve los marcadores a una cuadrícula sin verificar el primer pulso y el compás.</span>
                  </label>}
                  {sectionOffsetSaveError && (
                    <p className="mt-2 text-[0.64rem] leading-snug text-rose-200/86" role="alert">
                      {sectionOffsetSaveError}
                    </p>
                  )}
                </div>
              , document.body)}
              <div className="relative min-h-0 flex-1 overflow-hidden bg-black/12">
                <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-16 bg-[linear-gradient(90deg,rgba(23,24,26,0.96),rgba(23,24,26,0))]" />
                <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-16 bg-[linear-gradient(270deg,rgba(23,24,26,0.96),rgba(23,24,26,0))]" />
                <div
                  className={`pointer-events-none absolute top-3 z-30 w-[4px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.68)] ${
                    !showSectionMap ? 'bottom-3' : isUltraCompactLandscape ? 'bottom-[28px]' : isCompactLandscape ? 'bottom-[36px]' : 'bottom-[44px]'
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
                      className={`relative flex h-full min-h-0 items-stretch gap-[14px] pt-4 ${!showSectionMap ? 'pb-3' : isUltraCompactLandscape ? 'pb-[32px]' : isCompactLandscape ? 'pb-[40px]' : 'pb-[48px]'}`}
                      style={{
                        width: `${sectionLaneContentWidth}px`,
                        paddingLeft: `${sectionLanePlayheadOffsetPx}px`,
                        paddingRight: `${sectionLaneTrailingPaddingPx}px`,
                      }}
                    >
                    {sectionLaneSegments.map(({
                      section,
                      wavePath,
                      waveViewBoxWidth,
                      widthPx,
                      leftPx,
                      activeStyle,
                      inactiveStyle,
                    }, index) => {
                      const isActive = index === activeSectionIndex;
                      const preparedDestination = sectionJump.armed?.section.id === section.id && sectionJump.preparation === 'ready';

                      return (
                        <button
                          key={section.id}
                          type="button"
                          disabled={isCongregationFading}
                          aria-busy={isSectionSeekBusy || undefined}
                          data-live-chord-section="true"
                          data-live-section-preparation={sectionJump.armed?.section.id === section.id ? sectionJump.preparation || 'preparing' : undefined}
                          data-live-section-index={index}
                          data-live-section-start={section.startTime}
                          data-live-section-end={section.endTime}
                          title={isCongregationFading ? 'Espera a que termine el fade de congregación' : experimentalTools && isPlaying ? `${section.name} · Doble toque para armar el salto al final de la sección actual` : `${section.name} · ${section.startTime.toFixed(3)}–${section.endTime.toFixed(3)} s`}
                          onClick={(event) => {
                            // The section lane is replaced while its editor is open.
                            // Handle clicks in React so the newly mounted lane always works.
                            if (sectionsGestureExceededDragThresholdRef.current) {
                              sectionsGestureExceededDragThresholdRef.current = false;
                              return;
                            }
                            if (experimentalTools && isPlaying) {
                              if (isSectionSeekBusy || isCongregationFading) return;
                              if (event.detail === 0) {
                                armSectionFromTimeline(section.id);
                                return;
                              }
                              const previous = lastSectionTapRef.current;
                              const now = performance.now();
                              lastSectionTapRef.current = { id: section.id, time: now };
                              if (previous?.id === section.id && now - previous.time < 500) {
                                lastSectionTapRef.current = null;
                                armSectionFromTimeline(section.id);
                              } else {
                                isUserScrollingSectionsRef.current = true;
                                keyboardSectionIndexRef.current = index;
                                setKeyboardSectionIndex(index);
                                scheduleSectionsAutoFollowResume();
                              }
                              return;
                            }
                            if (arrangementEntries) arrangement.focus(section.id);
                            void handleSectionSeek(section.startTime);
                          }}
                          aria-label={`${section.name}${experimentalTools && isPlaying ? '. Doble toque para armar salto al terminar la sección actual' : ''}`}
                          aria-pressed={sectionJump.armed?.section.id === section.id}
                          className="relative h-full shrink-0 rounded-[1.55rem] border text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45"
                          style={{ ...(isActive ? activeStyle : inactiveStyle), ...(experimentalTools && (sectionJump.armed?.section.id === section.id || keyboardSectionIndex === index) ? { outline: `2px solid ${preparedDestination ? '#6ee7b7' : sectionJump.armed?.section.id === section.id ? '#f5cf79' : '#8de7ef'}`, outlineOffset: '-3px' } : {}), ...(preparedDestination ? { borderColor: '#6ee7b7', background: 'linear-gradient(180deg, rgba(16,80,59,.45), rgba(16,28,24,.96))' } : {}) }}
                        >
                          <div className="absolute inset-0 rounded-[1.5rem] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_2px,transparent_2px,transparent_20px)]" />
                          <div className="absolute inset-0 rounded-[1.5rem] bg-black/10" />
                          <div
                            className="absolute inset-y-0 left-0 w-px bg-white/12"
                            style={{ opacity: isActive ? 0.52 : 0.2 }}
                          />
                          <svg
                            aria-hidden="true"
                            className={`pointer-events-none absolute left-4 right-4 -translate-y-1/2 overflow-visible ${desktopCombined ? 'top-[82%] h-[18%]' : 'top-[65%] h-[28%]'}`}
                            style={{ width: 'calc(100% - 2rem)' }}
                            viewBox={`0 0 ${waveViewBoxWidth} 100`}
                            preserveAspectRatio="none"
                          >
                            <path
                              d={wavePath}
                              fill="none"
                              stroke="rgba(255,255,255,0.72)"
                              strokeWidth={SECTION_WAVE_BAR_WIDTH_PX}
                              strokeLinecap="round"
                              strokeOpacity={isActive ? 0.96 : 0.7}
                              vectorEffect="non-scaling-stroke"
                            />
                          </svg>
                          <div className={`absolute left-4 flex items-center gap-2 rounded-[0.8rem] border border-white/8 bg-black/56 px-2.5 py-1.5 ${desktopCombined ? 'top-2' : 'top-4'}`}>
                            <span
                              className={`flex items-center justify-center rounded-full border px-2 font-semibold ${desktopCombined ? 'h-7 min-w-7 text-xs' : 'h-9 min-w-9 text-sm'}`}
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

                {/* Whole-song overview follows the edited order, including duplicates. */}
                {showSectionMap && sectionLaneMinimapSegments.length > 0 && (
                  <div
                    className={`pointer-events-none absolute left-4 right-4 z-40 ${
                      isUltraCompactLandscape ? 'bottom-1 h-[20px]' : isCompactLandscape ? 'bottom-1.5 h-[24px]' : 'bottom-2 h-[28px]'
                    }`}
                  >
                    <div
                      ref={minimapTrackRef}
                      onPointerDown={handleMinimapPointerDown}
                      onPointerMove={handleMinimapPointerMove}
                      onPointerUp={handleMinimapPointerUp}
                      onPointerCancel={handleMinimapPointerCancel}
                      onKeyDown={handleMinimapKeyDown}
                      tabIndex={0}
                      data-live-section-minimap="true"
                      className="pointer-events-auto relative h-full cursor-pointer overflow-hidden rounded-lg border border-white/10 bg-[#0c0f10] focus-visible:outline-2 focus-visible:outline-cyan-200"
                      style={{ touchAction: 'none' }}
                      aria-label="Mini-mapa de la canción"
                      role="slider"
                      aria-valuemin={0}
                      aria-valuemax={navigationDuration}
                      aria-valuenow={clamp(navigationTime, 0, navigationDuration)}
                      aria-valuetext={`${formatClock(navigationTime)} · ${activeSection?.name || 'Sin sección'}`}
                      aria-disabled={!isReady || isCongregationFading || isTransportCueBusy}
                    >
                      {sectionLaneMinimapSegments.map((seg, index) => {
                        const isActive = index === activeSectionIndex;
                        const preparedDestination = sectionJump.armed?.section.id === seg.id && sectionJump.preparation === 'ready';
                        return (
                          <div
                            key={seg.id}
                            aria-hidden="true"
                            data-minimap-section={seg.id}
                            data-minimap-preparation={preparedDestination ? 'ready' : undefined}
                            title={`${index + 1}. ${seg.name}`}
                            className="absolute inset-y-0 flex items-center justify-center overflow-hidden"
                            style={{
                              left: `${seg.leftPct}%`,
                              width: `${seg.widthPct}%`,
                              backgroundColor: preparedDestination ? 'rgba(16, 100, 70, .65)' : `color-mix(in srgb, ${seg.accent} ${isActive ? 15 : 6}%, #0c0f10)`,
                              border: preparedDestination ? '1px solid #6ee7b7' : `1px solid color-mix(in srgb, ${seg.accent} ${isActive ? 70 : 35}%, transparent)`,
                              borderRadius: '3px',
                              transition:
                                'background-color 160ms ease',
                            }}
                          ><span className={`truncate px-0.5 font-medium leading-none text-white/85 ${isUltraCompactLandscape ? 'text-[10px]' : 'text-[11px]'}`}>{seg.name}</span></div>
                        );
                      })}
                      {/* Instrucciones: marcas finas en tiempo de canción (no en arreglos reordenados). */}
                      {!arrangementEntries && navigationDuration > 0 && guideInstructions.map(cue => <div key={cue.id} aria-hidden="true" data-minimap-instruction={cue.id} title={`Instrucción · ${cue.name}`} className="pointer-events-none absolute top-0 h-[6px] w-[2px] -translate-x-1/2 rounded-b-sm bg-white/60" style={{ left: `${clamp(cue.startSec / navigationDuration, 0, 1) * 100}%` }}/>)}
                      {/* Viewport marker: qué rango de la canción está visible
                          en la lane grande. */}
                      <div
                        ref={sectionsMinimapViewportRef}
                        aria-hidden="true"
                        className="pointer-events-none absolute -top-[2px] -bottom-[2px] rounded-[6px] border border-white/60 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                        style={{
                          left: '0px',
                          width: `${sectionLaneMinimapViewport.widthPct}%`,
                          transition: 'transform 120ms ease, width 120ms ease',
                        }}
                      />
                      {/* Playhead global */}
                      <div
                        ref={passiveMinimapPlayheadRef}
                        data-live-minimap-playhead="true"
                        aria-hidden="true"
                        className="pointer-events-none absolute -top-[4px] -bottom-[4px] left-0 w-[2px] rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]"
                        style={{
                          left: '0px',
                          transform: 'translate3d(-1px, 0, 0)',
                          willChange: 'transform',
                        }}
                      />
                    </div>
                    {/* Tooltip que sigue al dedo mientras el usuario arrastra
                        en el mini-mapa: muestra nombre de sección + timestamp
                        para que el seek ciego se convierta en seek informado. */}
                    {minimapHoverTime !== null && navigationDuration > 0 && (() => {
                      const hoverPct = clamp(
                        (minimapHoverTime / navigationDuration) * 100,
                        0,
                        100,
                      );
                      const hoverSection = navigationSections.find(
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
  );
  const mixerSurface = (
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
                const lockedByCongregation =
                  congregationFadeState !== 'normal' && !isCongregationCueTrack(track);
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
                      disabled={track.disabled || lockedByCongregation}
                      disabledReason={track.disabledReason}
                      disabledTitle={lockedByCongregation
                        ? 'Modo congregación activo: restaura los instrumentos para ajustar este fader.'
                        : track.disabledTitle}
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
                      onOpenSettings={canUseGeneratedClick && track.id === clickTrack?.id ? openClickMixer : undefined}
                    />
                  </div>
                );
              })}
            </div>
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
    <div ref={liveDirectorRootRef} className={shellClassName} onPointerDownCapture={cancelAutomaticAdvancePointer} onClickCapture={cancelAutomaticAdvanceClick}>
      {/* La carga del arreglo ya se ve en el indicador de carga de la canción: aquí solo el error. */}
      {eventId && eventArrangement.error && !eventArrangement.loading && <div role="status" className="absolute inset-x-3 top-3 z-[90] flex items-center gap-3 rounded-lg border border-amber-200/30 bg-[#252325] p-3 text-xs text-amber-100">
        <span>{eventArrangement.error}</span>
        <button type="button" className="rounded border border-white/20 px-3 py-2" onClick={eventArrangement.reload}>Reintentar</button>
      </div>}
      {canUseGeneratedClick && clickTrack && selectedMultitrackEngine.loadGeneratedClickSamples && selectedMultitrackEngine.setGeneratedClick &&
        <LiveDirectorClickMixer key={`click:${trackSignature}:${reloadKey}`} open={showClickMixer} onClose={closeClickMixer}
          onConfirmedMeter={setConfirmedClickMeter} trackId={clickTrack.id} bpm={generatedClickGrid?.bpm ?? reaperTransport?.clickGrid?.bpm ?? bpm}
          originSeconds={generatedClickGrid?.originSeconds ?? reaperTransport?.clickGrid?.originSeconds ?? sourceSections[0]?.startTime ?? 0}
          meter={reaperTransport?.timeSignature ?? shownMeter} confirmedByReaper={Boolean(reaperTransport?.timeSignature && reaperTransport?.clickGrid)}
          ready={isReady} playing={isPlaying} busy={isSectionSeekBusy || isCongregationFading}
          loadSamples={selectedMultitrackEngine.loadGeneratedClickSamples} onConfigure={selectedMultitrackEngine.setGeneratedClick} />}
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
                aria-label={resolvedBackLabel}
                aria-keyshortcuts="Escape"
                title={`${resolvedBackLabel} (Esc)`}
              >
                <ChevronLeft className={`${isUltraCompactLandscape ? 'h-5 w-5' : isToolbarCompactLandscape ? 'h-6 w-6' : 'h-8 w-8'}`} strokeWidth={isToolbarCompactLandscape ? 2.1 : 2.45} />
                <KeyboardHint>ESC</KeyboardHint>
              </button>

              <button
                type="button"
                data-live-director-control="bpm"
                data-pulse-multiplier={canTogglePulseSubdivision ? manualTempoTransport.pulseMultiplier : undefined}
                onClick={canTogglePulseSubdivision ? manualTempoTransport.togglePulseSubdivision : openClickMixer}
                disabled={!canTogglePulseSubdivision && !canUseGeneratedClick}
                aria-label={`${bpmControlLabel} · Compás ${meterLabel === '—/—' ? 'pendiente de confirmar' : meterLabel}`}
                aria-pressed={canTogglePulseSubdivision ? manualTempoTransport.pulseMultiplier === 2 : undefined}
                title={`${bpmControlLabel} · ${meterLabel === '—/—' ? 'Compás pendiente: abre el metrónomo para confirmarlo' : `Compás ${meterLabel}`}`}
                className={`flex ${isUltraCompactLandscape ? 'h-11 rounded-[0.8rem] px-1 py-0.5' : isToolbarCompactLandscape ? 'h-12 rounded-[1rem] px-1.5 py-1' : 'h-[var(--ld-control-height)] rounded-[1.45rem] px-2 py-3'} shrink-0 appearance-none flex-col items-center justify-center gap-0.5 border bg-black/16 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 ${canTogglePulseSubdivision
                  ? manualTempoTransport.pulseMultiplier === 2
                    ? 'cursor-pointer border-cyan-300/42 bg-cyan-300/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_20px_rgba(103,232,249,0.08)] active:scale-[0.98]'
                    : 'cursor-pointer border-white/12 hover:border-cyan-200/28 hover:bg-white/[0.04] active:scale-[0.98]'
                  : canUseGeneratedClick ? 'cursor-pointer border-white/12 hover:border-cyan-200/28' : 'cursor-default border-white/8'}`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 3.05 : 3.75, 2.75) }
                  : { flex: '0 0 18%', width: '18%' }}
              >
                <span className={`font-light leading-none tracking-tight text-white/92 ${isUltraCompactLandscape ? 'text-[0.95rem]' : isToolbarCompactLandscape ? 'text-[1.18rem]' : 'text-[1.65rem]'}`}>
                  {displayedPulseBpm || '--'}
                </span>
                <div className="h-px w-full bg-white/18" />
                <span data-live-director-time-signature="true" data-meter-confirmed={meterLabel !== '—/—'} className={`${isUltraCompactLandscape ? 'text-[0.78rem]' : isToolbarCompactLandscape ? 'text-sm' : 'text-lg'} font-semibold leading-none text-white/85`}>
                  {meterLabel}
                </span>
              </button>

              <div
                data-live-director-control="clock"
                className={`${CONTROL_CARD} ${isUltraCompactLandscape ? 'h-11 px-1.5 py-0.5' : isToolbarCompactLandscape ? 'h-12 px-2 py-1' : 'h-[var(--ld-control-height)] px-4 py-3'} shrink-0 flex-col`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 6.15 : 7.05, 5.6) }
                  : { flex: '0 0 36%', width: '36%' }}
              >
                <span ref={passiveClockTextRef} className={`font-light leading-none tracking-tight text-white ${isUltraCompactLandscape ? 'text-[1.28rem]' : isToolbarCompactLandscape ? 'text-[1.7rem]' : 'text-[2.65rem]'}`}>
                  {formatClock(navigationTime)}
                </span>
                <span ref={passiveCompactClockTextRef} className={`font-medium tabular-nums text-white/58 ${isUltraCompactLandscape ? 'text-[0.56rem]' : isToolbarCompactLandscape ? 'text-[0.72rem]' : 'mt-1 text-[0.96rem]'}`}>
                  {formatCompact(navigationTime)} / {isManualTempoMode ? 'LIBRE' : formatCompact(navigationDuration)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!resolvedPadUrl) return;
                  setPadActiveFromGesture((previous) => !previous);
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
                  if(experimentalTools)handleRestartAtSectionEnd();else void handleReturnToStart();
                }}
                disabled={!hasPlayableSession || !currentSessionPrepared || isTransportCueBusy || isCongregationFading || (!experimentalTools && DISABLE_BACKWARD_SEEK_WHILE_PLAYING && isPlaying)}
                aria-busy={isTransportCueBusy || undefined}
                data-live-director-control="return-start"
                aria-pressed={experimentalTools ? musicalNavigation.pending?.kind === 'restart' : undefined}
                className={`${CONTROL_CARD} group relative ${isUltraCompactLandscape ? 'h-11 px-3' : isToolbarCompactLandscape ? 'h-12 px-4' : 'h-[var(--ld-control-height)] px-5'} justify-center ${musicalNavigation.pending?.kind === 'restart' ? 'border-cyan-200/35 text-cyan-100' : 'text-white/76'} hover:text-white disabled:cursor-not-allowed disabled:text-white/24`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 4.5 : 5.2, 4.15) }
                  : { flex: '0 0 22%' }}
                aria-label={!experimentalTools ? 'Volver al inicio' : musicalNavigation.pending?.kind === 'restart' ? 'Cancelar regreso al inicio' : isPlaying ? 'Volver al inicio al terminar la sección' : 'Volver al inicio'}
                aria-keyshortcuts={experimentalTools ? 'E' : 'R'}
                title={!experimentalTools ? (isPlaying && DISABLE_BACKWARD_SEEK_WHILE_PLAYING ? 'Pausa para volver al inicio' : 'Volver al inicio (R)')
                  : musicalNavigation.pending?.kind === 'restart' ? 'Cancelar regreso al inicio · E' : isPlaying ? 'Volver al inicio con entrada al terminar la sección · E' : 'Volver al inicio · E'}
              >
                <SkipBack className={`${isUltraCompactLandscape ? 'h-5 w-5' : isToolbarCompactLandscape ? 'h-6 w-6' : 'h-7 w-7'}`} />
                <KeyboardHint>{experimentalTools ? 'E' : 'R'}</KeyboardHint>
              </button>

              <button
                type="button"
                onClick={handleTogglePlaybackFromGesture}
                disabled={!eventAdvance.pending && !entryCount.pending && (!currentSessionPrepared || isTransportCueBusy || showArrangementEditor || eventArrangement.loading || Boolean(eventArrangement.error))}
                aria-busy={isTransportCueBusy || undefined}
                data-live-director-control="play-pause"
                className={`${CONTROL_CARD} group relative ${isUltraCompactLandscape ? 'h-11 px-6' : isToolbarCompactLandscape ? 'h-12 px-7' : 'h-[var(--ld-control-height)] px-8'} justify-center border-cyan-300/24 bg-cyan-300/[0.08] text-cyan-100 shadow-[0_0_18px_rgba(103,232,249,0.09)] hover:border-cyan-200/38 hover:bg-cyan-300/[0.11] disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-black/12 disabled:text-white/24`}
                style={isToolbarCompactLandscape
                  ? { width: scaleRem(isUltraCompactLandscape ? 7.25 : 8.25, 6.7) }
                  : { flex: '0 0 34%' }}
                aria-label={eventAdvance.pending ? 'Cancelar reproducción automática' : entryCount.pending ? 'Cancelar conteo de entrada' : isPlaying ? 'Pausar' : 'Reproducir'}
                aria-keyshortcuts="Space"
                title={eventAdvance.pending ? 'Cancelar reproducción automática · Espacio' : isPlaying ? 'Pausar · Espacio' : 'Reproducir · Espacio'}
              >
                {eventAdvance.pending ? (
                  <span data-live-event-countdown={eventAdvance.countdown ?? 'preparing'} className="flex min-w-0 max-w-full items-center justify-center gap-2" role="status">
                    <span className="text-xl font-semibold tabular-nums">{eventAdvance.countdown ?? '…'}</span>
                    <span className="min-w-0 max-w-36 truncate text-left text-[11px] leading-tight">{eventAdvance.countdown !== null ? nextEventSong?.title : 'Preparando audio'}<span className="block text-[9px] text-cyan-100/60">Cualquier botón cancela</span></span>
                  </span>
                ) : isPlaying || entryCount.pending ? (
                  <Pause className={`${isUltraCompactLandscape ? 'h-[1.45rem] w-[1.45rem]' : isToolbarCompactLandscape ? 'h-7 w-7' : 'h-11 w-11'}`} strokeWidth={2.15} fill="currentColor" />
                ) : (
                  <Play className={`ml-0.5 ${isUltraCompactLandscape ? 'h-[1.45rem] w-[1.45rem]' : isToolbarCompactLandscape ? 'h-7 w-7' : 'h-11 w-11'}`} strokeWidth={2.15} fill="currentColor" />
                )}
                {!eventAdvance.pending && <KeyboardHint>SPACE</KeyboardHint>}
              </button>

              <button
                type="button"
                onClick={handleToggleCongregationFade}
                disabled={!hasTrackSession || !isReady || isTransportCueBusy}
                aria-pressed={congregationFadeTargetMuted}
                data-live-director-control="fade-out"
                aria-label={congregationFadeTargetMuted
                  ? 'Restaurar progresivamente los instrumentos'
                  : 'Bajar progresivamente los instrumentos y mantener Click y Guide'}
                title={congregationFadeTargetMuted
                  ? 'Restaurar instrumentos · Fade 5s (F)'
                  : 'Modo congregación · Instrumentos abajo, Click y Guide activos (F)'}
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
                    ? (congregationFadeTargetMuted ? 'Bajando instrumentos' : 'Restaurando instrumentos')
                    : (congregationFadeTargetMuted ? 'Instrumentos abajo' : 'Instrumentos normales')}
                </span>
              </button>
            </div>

            {!isToolbarCompactLandscape && <div aria-hidden="true" />}

            <div className={`flex items-stretch gap-1.5 ${showLiveBroadcastControl ? (isUltraCompactLandscape ? 'gap-1' : 'gap-1.5') : ''} ${isToolbarCompactLandscape ? '' : 'justify-end'}`}>
              {showLiveBroadcastControl && (
                <button
                  type="button"
                  onClick={onToggleLiveBroadcast}
                  disabled={liveBroadcastState === 'checking' || liveBroadcastState === 'unavailable'}
                  aria-pressed={liveBroadcastState === 'active'}
                  aria-busy={liveBroadcastState === 'checking' || undefined}
                  data-live-director-control="live-broadcast"
                  className={`${CONTROL_CARD} group relative ${isUltraCompactLandscape ? 'h-11 px-1.5 text-[0.56rem]' : isToolbarCompactLandscape ? 'h-12 px-2 text-[0.68rem]' : 'h-[var(--ld-control-height)] px-3 text-[0.76rem]'} shrink-0 flex-col font-semibold tracking-[0.16em] disabled:cursor-not-allowed ${liveBroadcastState === 'active'
                    ? 'border-emerald-300/55 bg-emerald-500/24 text-emerald-200'
                    : liveBroadcastState === 'occupied'
                      ? 'border-amber-300/30 bg-amber-300/10 text-amber-100'
                      : liveBroadcastState === 'checking'
                        ? 'border-cyan-300/28 bg-cyan-300/9 text-cyan-100'
                        : liveBroadcastState === 'unavailable'
                          ? 'border-white/7 bg-black/14 text-white/26'
                          : 'text-white/68 hover:border-emerald-300/24 hover:bg-emerald-400/8 hover:text-emerald-50'
                  }`}
                  style={isToolbarCompactLandscape
                    ? { width: scaleRem(isUltraCompactLandscape ? 4.35 : 4.95, 3.75) }
                    : { flex: '1 1 0' }}
                  aria-label={liveBroadcastState === 'active'
                    ? 'Detener transmisión LIVE'
                    : liveBroadcastState === 'occupied'
                      ? 'LIVE ocupado por otro dispositivo'
                      : 'Iniciar transmisión LIVE'}
                  title={liveBroadcastState === 'active'
                    ? 'Detener transmisión LIVE'
                    : liveBroadcastState === 'occupied'
                      ? 'Otro dispositivo está enviando LIVE'
                      : liveBroadcastState === 'unavailable'
                        ? 'LIVE sin conexión'
                        : 'Enviar señal LIVE'}
                >
                  <Radio className={`${isUltraCompactLandscape ? 'h-3.5 w-3.5' : isToolbarCompactLandscape ? 'h-4 w-4' : 'h-5 w-5'}`} />
                  <span className={`${isUltraCompactLandscape ? 'mt-0.5 text-[0.46rem]' : 'mt-1 text-[0.58rem]'} tracking-[0.18em] ${liveBroadcastState === 'active'
                    ? 'text-emerald-200'
                    : liveBroadcastState === 'occupied'
                      ? 'text-amber-100/88'
                      : 'text-white/58'
                  }`}>
                    LIVE
                  </span>
                </button>
              )}

              {isUltraCompactLandscape && <button type="button" data-live-director-control="song-strip"
                aria-label={showPhoneSongStrip ? 'Ocultar canciones' : 'Mostrar canciones'} aria-pressed={showPhoneSongStrip}
                onClick={() => setShowPhoneSongStrip(previous => !previous)}
                className={`${CONTROL_CARD} h-11 shrink-0 flex-col px-1.5 font-semibold ${showPhoneSongStrip ? 'border-cyan-300/32 bg-cyan-300/10 text-cyan-100' : 'text-white/75 hover:bg-white/5'}`}
                style={{ width: scaleRem(4.35, 3.75) }}><ListMusic className="h-3.5 w-3.5" /><span className="mt-0.5 text-[0.46rem] tracking-[0.12em]">CANCIONES</span></button>}
              {/* El motivo va en el contenedor: Safari no muestra el título de un botón deshabilitado. */}
              {experimentalTools && !isManualTempoMode && <span className="flex flex-1" style={{ minWidth: '4rem' }} data-live-director-edit-reason={editSongUnavailableReason ?? undefined}
                title={editSongUnavailableReason ?? `${arrangementEntries ? 'Editar arreglo de prueba' : 'Editar canción'} · Shift+E`}><button type="button" data-live-director-control="edit-song" aria-keyshortcuts="Shift+E"
                aria-label="Editar canción" aria-describedby={editSongUnavailableReason ? 'live-director-edit-reason' : undefined}
                disabled={editSongUnavailableReason !== null}
                onClick={() => { setShowArrangementEditor(true); setSurfaceView('sections'); }}
                className={`${CONTROL_CARD} group relative w-full flex-col px-3 text-xs font-semibold tracking-[0.12em] disabled:pointer-events-none disabled:opacity-30 ${arrangementEntries ? 'border-cyan-200/40 text-cyan-100' : 'text-white/75 hover:bg-white/5'}`}
                ><Pencil size={isUltraCompactLandscape ? 14 : 18}/><span className="mt-1 text-[0.58rem]">EDITAR</span><KeyboardHint>⇧ E</KeyboardHint></button>
                {editSongUnavailableReason && <span id="live-director-edit-reason" className="sr-only">{editSongUnavailableReason}</span>}</span>}
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
                  : { flex: showLiveBroadcastControl || experimentalTools ? '1 1 0' : undefined, width: showLiveBroadcastControl || experimentalTools ? undefined : '100%', minWidth: experimentalTools ? '4rem' : undefined }}
                aria-label="Administrar stems"
                title="Administrar stems (S)"
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

        {(musicalNavigation.pending || musicalNavigation.notice) && <div data-live-musical-navigation={musicalNavigation.pending?.phase??'notice'} className={`flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2 text-xs ${musicalNavigation.pending?.phase==='ready'?'border-emerald-200/30 bg-emerald-300/10 text-emerald-100':'border-amber-200/25 bg-amber-200/5 text-amber-100'}`}>
          <span role="status" className="min-w-0 flex-1 truncate">{musicalNavigation.pending ? `${musicalNavigation.pending.phase==='ready'?'Listo':'Preparando'} · ${musicalNavigation.pending.kind==='restart'?'Reinicio con entrada al terminar sección':musicalNavigation.pending.title+' · al terminar la sección actual'}` : musicalNavigation.notice}</span>
          {musicalNavigation.pending && <button type="button" onClick={musicalNavigation.cancel} aria-label="Cancelar cambio musical" className="min-h-9 shrink-0 rounded-md border border-current/25 px-3">Cancelar · Esc</button>}{!musicalNavigation.pending&&musicalNavigation.notice&&<button type="button" onClick={musicalNavigation.clearNotice} className="min-h-9 px-3" aria-label="Cerrar aviso de cambio musical">Cerrar</button>}
        </div>}
        {sectionJump.repeat && !showSectionsPanel && <div className="flex shrink-0 items-center gap-3 rounded-lg border border-violet-200/25 bg-violet-200/5 px-3 py-1 text-xs text-violet-100">
          <span role="status" className="min-w-0 flex-1 truncate">↻ {sectionJump.repeat.section.name} · {sectionJump.repeat.exitRequested ? 'Sale al terminar' : sectionJump.preparation === 'preparing' ? 'Preparando stems…' : sectionJump.repeat.mode === 'once' ? 'Una vez' : `Hasta salir · ${sectionJump.repeat.completed} repeticiones`}</span>
          <button type="button" disabled={isSectionSeekBusy} className="rounded-md border border-violet-200/30 px-3 py-1" onClick={sectionJump.exitRepeat}>Salir al terminar</button>
        </div>}
        {sectionJump.armed && !showSectionsPanel && <div className="flex shrink-0 items-center gap-3 rounded-lg border border-amber-200/25 bg-amber-200/5 px-3 py-1 text-xs text-amber-100">
          <span role="status" className="min-w-0 flex-1 truncate">→ {sectionJump.armed.section.name} · {sectionJump.preparation === 'preparing' ? 'Preparando stems…' : sectionJump.preparation === 'ready' ? 'Stems listos · Al terminar' : 'Al terminar la sección actual'}</span>
          <button type="button" aria-label="Cancelar salto armado" className="rounded-md border border-amber-200/30 px-3 py-1" onClick={sectionJump.cancel}>Cancelar</button>
        </div>}
        <section data-live-director-song-strip={isUltraCompactLandscape ? (showPhoneSongStrip ? 'open' : 'collapsed') : 'visible'}
          // Al elegir una canción en el teléfono, la tira se cierra y vuelve la mezcla completa.
          onClickCapture={isUltraCompactLandscape ? (event) => { const target = event.target as HTMLElement; if (target.closest('button') && !target.closest('[data-live-director-control="song-transition"]')) setShowPhoneSongStrip(false); } : undefined}
          className={`shrink-0 overflow-hidden ${isUltraCompactLandscape ? `pr-0 pb-0 ${showPhoneSongStrip ? '' : 'hidden'}` : isCompactLandscape ? 'pr-0.5' : ''}`}>
          {/* En el evento las portadas van sin panel de fondo, como en Playback: solo un margen arriba para
              el círculo de transición, que asoma sobre el borde de las portadas. */}
          <div className={isEnsayoMode
            ? `overflow-hidden ${isUltraCompactLandscape ? 'pt-1' : 'pt-1.5'}`
            : `overflow-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.96),rgba(27,29,30,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isUltraCompactLandscape ? 'px-1.5 py-1' : isCompactLandscape ? 'px-2 py-1.5' : 'px-4 py-4'}`}>
            {isEnsayoMode ? (
              <div className="flex h-full items-center">
                <div className="hide-scrollbar -mx-0.5 -my-4 overflow-x-auto overflow-y-hidden">
                  <div className={`flex py-4 ${isUltraCompactLandscape ? 'gap-1 px-0.5' : 'gap-1.5 px-0.5'}`}>
                    {ensayoSlotSongs.map((queueSong, queueIndex) => {
                      const followingSong = ensayoSlotSongs[queueIndex + 1];
                      const transition = songTransitions[queueSong.id] ?? DEFAULT_SONG_TRANSITION;
                      return (
                      <Fragment key={queueSong.id}>
                      <EnsayoQueueCard
                        key={queueSong.id}
                        song={queueSong}
                        queueNumber={experimentalTools ? queueIndex + 1 : undefined}
                        coverUrl={queueSong.artworkUrl || (queueSong.id === activeQueueSongId ? songCoverArtUrl : queueSongCoverArtMap[queueSong.id])}
                        active={queueSong.id === activeQueueSongId}
                        compact={isCompactLandscape}
                        ultraCompact={isUltraCompactLandscape}
                        onClick={() => {
                          if(experimentalTools && queueSong.id!==activeQueueSongId){handleMusicalQueueSelect(queueSong);return;}
                          eventAdvanceRef.current?.cancel();entryCount.cancel();
                          if(queueSong.id===activeQueueSongId){void handleReturnToStart();return;}
                          if(usesEventMixPersistence)eventMixFlushRef.current();onSelectQueueSong?.(queueSong.id);
                        }}
                        queued={musicalNavigation.pending?.id===queueSong.id && musicalNavigation.pending.kind==='song' ? musicalNavigation.pending.phase : undefined}
                        onRemove={queueSong.kind === 'manual-tempo' && onRemoveQueueSong
                          ? () => onRemoveQueueSong(queueSong.id)
                          : undefined}
                      />
                      {showSongTransitions && followingSong && queueSong.kind !== 'manual-tempo' && followingSong.kind !== 'manual-tempo' && (
                        // Sin ancho propio: el círculo queda centrado en el hueco entre las dos portadas.
                        <div className="relative w-0 shrink-0 self-stretch" style={{ margin: isUltraCompactLandscape ? '0 -0.125rem' : '0 -0.1875rem' }}>
                          <SongTransitionControl
                            fromSongId={queueSong.id} fromTitle={queueSong.title} toTitle={followingSong.title}
                            transition={transition} current={queueSong.id === currentQueueSongId}
                            open={openTransitionFrom === queueSong.id} compact={isCompactLandscape}
                            preparedUnavailableReason={preparedTransitionUnavailable}
                            onOpenChange={open => setOpenTransitionFrom(open ? queueSong.id : null)}
                            onChange={next => changeSongTransition(queueSong.id, next)}
                          />
                        </div>
                      )}
                      </Fragment>
                      );
                    })}
                    {canAddQueueSong && onAddQueueSong && (
                      <EnsayoQueueAddCard
                        compact={isCompactLandscape}
                        ultraCompact={isUltraCompactLandscape}
                        onClick={() => setShowManualTempoModal(true)}
                      />
                    )}
                    {showRehearsalSaveCard && (
                      <EnsayoQueueSaveCard
                        state={rehearsalDownload.state}
                        compact={isCompactLandscape}
                        ultraCompact={isUltraCompactLandscape}
                        // Ya cargada, volver a descargarla (para refrescarla) se confirma antes.
                        onSave={() => { if (rehearsalDownload.state.phase === 'saved') setShowRedownloadConfirm(true); else void rehearsalDownload.start(); }}
                        onCancel={rehearsalDownload.cancel}
                      />
                    )}
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
                    if (hasPlayableSession) {
                      void handleReturnToStart();
                      return;
                    }

                    if (canOpenLoadPanel) {
                      setShowLoadPanel(true);
                    }
                  }}
                  className={`ui-pressable-card group relative flex shrink-0 overflow-hidden rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(35,37,39,0.98),rgba(24,26,28,0.98))] text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:border-white/20 ${isUltraCompactLandscape ? 'p-1' : isCompactLandscape ? 'p-1.5' : 'p-3'}`}
                  style={{ width: scaleRem(isUltraCompactLandscape ? 11.6 : isCompactLandscape ? 13.4 : 15, 9.8) }}
                  aria-label={hasPlayableSession ? `Volver al inicio de ${currentSessionLabel}` : 'Abrir cargador de canción'}
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
                          {isManualTempoMode
                            ? 'Click manual · Pad independiente'
                            : hasTrackSession
                            ? `${activeTracks.length}${enabledSessionTracks.length !== activeTracks.length ? ` de ${enabledSessionTracks.length}` : ''} pistas activas`
                            : 'Sin pistas activas'}
                        </p>
                      </div>
                      <span ref={passiveProgressTextRef} className={`shrink-0 font-semibold tabular-nums tracking-[0.12em] text-white/52 ${isUltraCompactLandscape ? 'text-[0.58rem]' : isCompactLandscape ? 'text-[0.72rem]' : 'text-[0.88rem]'}`}>
                        {formatCompact(navigationTime)} / {isManualTempoMode ? 'LIBRE' : formatCompact(navigationDuration)}
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
                            const widthPercent = navigationDuration > 0 ? (duration / navigationDuration) * 100 : 0;
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
          data-live-director-layout={desktopCombined ? 'desktop-combined' : 'mobile-pages'}
          style={{ gridTemplateColumns: `minmax(0,1fr) ${mixerLayoutColumns}`, ...(desktopCombined ? { gridTemplateRows: showArrangementEditor ? 'minmax(250px, 0.55fr) minmax(210px, 1fr)' : showSectionMap ? 'minmax(170px, 0.42fr) minmax(250px, 1fr)' : 'minmax(140px, 0.36fr) minmax(250px, 1fr)' } : {}) }}
        >
          {desktopCombined && <div className="grid min-h-0 min-w-0" style={{ gridColumn: '1 / -1' }}>{sectionSurface}</div>}
          <div className="grid min-h-0 min-w-0">
            {experimentalTools && selectedMultitrackEngine.setTrackGroupGain && !isManualTempoMode && <LiveDirectorGroupMixer
              key={`${trackSignature}:${reloadKey}`} hidden={!showGroupsPanel} tracks={activeEngineTracks}
              isReady={isReady} busy={isCongregationFading || isSectionSeekBusy}
              onGroupGain={selectedMultitrackEngine.setTrackGroupGain} songGain={songLevel.gain}
              isPlaying={isPlaying} compact={isCompactLandscape} ultraCompact={isUltraCompactLandscape}
              getTelemetry={getSharedTelemetry} trackLevels={trackLevels}
              savedGroups={savedMixGroups} groupsKey={`${songId}:${JSON.stringify(savedMixGroups)}`}
              onGroupsChange={usesEventMixPersistence ? groups => { eventMixGroupsRef.current = groups; commitMixerStateSilent(); } : undefined}
            />}
            <div className={showGroupsPanel ? 'hidden' : 'grid min-h-0 min-w-0'}>
          {showSectionsPanel && !desktopCombined ? sectionSurface : mixerSurface}
            </div>
          </div>

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
                disabled={!hasTrackSession || isTransportCueBusy || isCongregationFading || showArrangementEditor}
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
                disabled={!hasTrackSession || isTransportCueBusy || isCongregationFading || showArrangementEditor}
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
              {!desktopCombined && <>
              <button
                type="button"
                onClick={() => setSurfaceView((previous) => previous === 'mix' ? 'sections' : 'mix')}
                disabled={isManualTempoMode || showArrangementEditor}
                aria-pressed={showSectionsPanel}
                aria-label={showMixReturn ? 'Mostrar faders de mezcla' : 'Mostrar secciones'}
                aria-keyshortcuts="Shift+S"
                title={`${showMixReturn ? 'Mostrar mezcla' : 'Mostrar secciones'} (Shift+S)`}
                className={`group relative ui-pressable-soft flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 rounded-[1.2rem] border transition-all disabled:cursor-not-allowed disabled:opacity-35 ${isUltraCompactLandscape ? 'rounded-[1rem] gap-0.5' : ''
                  } ${showSectionsPanel
                    ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50 shadow-[0_0_20px_rgba(129,221,245,0.14)]'
                    : 'border-white/8 bg-black/24 text-white/62'
                  }`}
              >
                {showMixReturn ? (
                  <SlidersVertical className={isUltraCompactLandscape ? 'h-3 w-3' : isCompactLandscape ? 'h-3.5 w-3.5' : 'h-6 w-6'} />
                ) : (
                  <ListMusic className={isUltraCompactLandscape ? 'h-3 w-3' : isCompactLandscape ? 'h-3.5 w-3.5' : 'h-6 w-6'} />
                )}
                <span className={`${isUltraCompactLandscape ? 'text-[0.46rem]' : isCompactLandscape ? 'text-[0.52rem]' : 'text-[0.66rem]'} font-black uppercase tracking-[0.16em]`}>
                  {showMixReturn ? 'Mezcla' : 'Secciones'}
                </span>
                <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-md border border-white/12 bg-white/8 px-1.5 py-0.5 text-[0.5rem] font-black text-white/72 opacity-0 transition-opacity group-hover:opacity-100">
                  ⇧ S
                </span>
              </button>
              </>}
              {experimentalTools && !isManualTempoMode && selectedMultitrackEngine.setTrackGroupGain ? <button
                type="button" data-live-director-control="groups"
                disabled={showArrangementEditor}
                onClick={() => setSurfaceView(previous => previous === 'groups' ? 'mix' : 'groups')}
                aria-label={showGroupsPanel ? 'Volver a mezcla individual' : 'Mostrar grupos de mezcla'}
                aria-pressed={showGroupsPanel}
                title={`${showGroupsPanel ? 'Volver a mezcla individual' : 'Grupos de mezcla'} · G`} aria-keyshortcuts="G"
                className={`group relative ui-pressable-soft flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 rounded-[1.2rem] border px-1 ${showGroupsPanel ? 'border-cyan-300/34 bg-cyan-300/12 text-cyan-50' : 'border-white/8 bg-black/24 text-white/62'}`}
              >
                <SlidersVertical className={isUltraCompactLandscape ? 'h-3 w-3' : isCompactLandscape ? 'h-3.5 w-3.5' : 'h-6 w-6'} />
                <span className={`${isUltraCompactLandscape ? 'text-[0.46rem]' : isCompactLandscape ? 'text-[0.52rem]' : 'text-[0.66rem]'} font-black uppercase tracking-[0.12em]`}>Grupos</span>
                <KeyboardHint>G</KeyboardHint>
              </button> : <div aria-hidden="true" className="min-h-0 w-full flex-1" data-live-director-control-slot="reserved" />}
              {experimentalTools && !isManualTempoMode && <div data-live-director-repeat-controls="true" className="contents">
                <button type="button" data-live-director-control="repeat-once" aria-label="Repetir sección una vez" aria-keyshortcuts="R" aria-pressed={sectionJump.repeat?.mode === 'once'}
                  disabled={!isPlaying || !isReady || isSectionSeekBusy || isCongregationFading || showArrangementEditor}
                  title="Repetir la sección una vez con conteo de entrada al terminar · R"
                  className={`ui-pressable-soft flex min-h-8 w-full flex-1 flex-col items-center justify-center gap-1 rounded-[1.2rem] border px-1 disabled:opacity-30 ${sectionJump.repeat?.mode === 'once' ? 'border-cyan-200/45 bg-cyan-200/15 text-cyan-100' : 'border-white/15 bg-black/35 text-white/80 hover:bg-white/5'}`}
                  onClick={() => sectionJump.repeat?.mode === 'once' ? sectionJump.cancel() : startRepeatFromTimeline('once')}>
                  <Repeat1 size={isCompactLandscape ? 24 : 28}/><span className={isCompactLandscape ? 'sr-only' : 'text-[10px] font-semibold'}>Una vez</span><KeyboardHint>R</KeyboardHint>
                </button>
                <button type="button" data-live-director-control="repeat-hold" aria-label="Mantener sección en repetición" aria-pressed={sectionJump.repeat?.mode === 'hold' && !sectionJump.repeat.exitRequested}
                  disabled={!isPlaying || !isReady || isSectionSeekBusy || isCongregationFading || showArrangementEditor}
                  aria-keyshortcuts="H" title={`${sectionJump.repeat?.mode === 'hold' ? 'Salir de la repetición al terminar esta pasada' : 'Repetir con conteo de entrada hasta salir'} · H`}
                  className={`group relative ui-pressable-soft flex min-h-8 w-full flex-1 flex-col items-center justify-center gap-1 rounded-[1.2rem] border px-1 disabled:opacity-30 ${sectionJump.repeat?.mode === 'hold' && !sectionJump.repeat.exitRequested ? 'border-cyan-200/45 bg-cyan-200/15 text-cyan-100' : 'border-white/15 bg-black/35 text-white/80 hover:bg-white/5'}`}
                  onClick={() => sectionJump.repeat?.mode === 'hold' && !sectionJump.repeat.exitRequested ? sectionJump.exitRepeat() : startRepeatFromTimeline('hold')}>
                  <InfinityIcon size={isCompactLandscape ? 26 : 30}/><span className={isCompactLandscape ? 'sr-only' : 'text-[10px] font-semibold'}>{sectionJump.repeat?.exitRequested ? 'Saliendo' : 'Hasta salir'}</span><KeyboardHint>H</KeyboardHint>
                </button>
              </div>}
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
                  <div ref={setMasterMeterTarget} data-live-director-master-meter-slot="true"
                    className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${isUltraCompactLandscape ? 'top-[8%] bottom-[12%] w-[0.5rem]' : isCompactLandscape ? 'top-[7%] bottom-[11%] w-[0.56rem]' : 'top-[4.5%] bottom-[6.5%] w-[0.72rem]'}`} />
                  <FaderThumb
                    accent="#81ddf5"
                    className={`live-director-master-thumb ${isUltraCompactLandscape ? 'h-[1.85rem]' : isCompactLandscape ? 'h-[2.2rem]' : 'h-[4.35rem]'} w-full ${isUltraCompactLandscape ? 'max-w-[5.1rem]' : isCompactLandscape ? 'max-w-[5.85rem]' : 'max-w-[6.1rem]'} transition-[box-shadow] duration-150`}
                    style={{
                      bottom: `calc(${10 + masterVolume * 78}% - ${isUltraCompactLandscape ? '0.925rem' : isCompactLandscape ? '1.1rem' : '2.175rem'})`,
                      boxShadow: '0 14px 24px rgba(0,0,0,0.35), 0 0 20px rgba(115,209,248,0.18)',
                    }}
                  />
                  <PrecisionFaderSurface value={masterVolume} onChange={setMasterVolumeState} label="Master volume"
                    disabled={!hasPlayableSession} onInteractionStart={suspendNativeMeters} onInteractionEnd={resumeNativeMetersSoon}
                    className="absolute inset-y-0 left-1/2 z-20 w-full -translate-x-1/2 cursor-ns-resize rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/60"/>

                </div>
              </div>

              <div className={`text-center ${isUltraCompactLandscape ? 'mt-0' : isCompactLandscape ? 'mt-1' : 'mt-4'}`}>
                {!isCompactLandscape && <p className="text-[0.62rem] font-black uppercase tracking-[0.3em] text-white/28">BUS</p>}
                <p className={`font-semibold text-white/90 ${isUltraCompactLandscape ? 'text-[0.78rem]' : isCompactLandscape ? 'text-[0.9rem]' : 'mt-1 text-[1.15rem]'}`}>Master</p>
                {experimentalTools && !isManualTempoMode && selectedMultitrackEngine.setTrackGroupGain && selectedMultitrackEngine.getLevelMeterSnapshot && selectedMultitrackEngine.resetLevelMeter && <LiveDirectorSongLevel
                  key={`${eventId}:${songId}:${reloadKey}`} db={songLevel.db} onChange={songLevel.setDb} title={songTitle || title} compact={isCompactLandscape}
                  playing={isPlaying} getMeter={selectedMultitrackEngine.getLevelMeterSnapshot!} resetMeter={selectedMultitrackEngine.resetLevelMeter!}
                  meterTarget={masterMeterTarget}
                  disabled={!isReady || isSectionSeekBusy || isCongregationFading || showArrangementEditor} />}
              </div>
            </div>
          </div>
        </section>
      </div>

      {!hasProvidedTracks && showLoadPanel && canOpenLoadPanel && (
        <div className={`absolute inset-0 z-[45] flex items-center justify-center bg-black/26 backdrop-blur-[8px] ${isCompactLandscape ? 'px-2 py-2' : 'px-6'}`}>
          <div className={`w-full overflow-y-auto rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(17,19,21,0.96),rgba(13,15,16,0.96))] shadow-[0_34px_70px_rgba(0,0,0,0.34)] ${isCompactLandscape ? 'max-h-[calc(100dvh-1rem)] max-w-[46rem] p-3' : 'max-w-[62rem] p-6'}`}>
            <div className={`flex items-start justify-between ${isCompactLandscape ? 'gap-3' : 'gap-6'}`}>
              <div>
                <p className="text-[0.78rem] font-black uppercase tracking-[0.28em] text-cyan-100/62">Cargador de sesion</p>
                <h2 className={`font-semibold tracking-tight text-white ${isCompactLandscape ? 'mt-1 text-[1.35rem]' : 'mt-2 text-[2rem]'}`}>
                  {hasPersistedSongContext ? `Carga ${songTitle || 'esta cancion'}.` : 'Carga una pista o multitrack.'}
                </h2>
                <p className={`max-w-3xl leading-relaxed text-white/62 ${isCompactLandscape ? 'mt-1 text-[0.84rem]' : 'mt-3 text-[1rem]'}`}>
                  Elige una pista unica, agrega un stem o reemplaza la carpeta multitrack.
                </p>
                <p className={`max-w-3xl text-amber-200/70 ${isCompactLandscape ? 'mt-1 text-[0.7rem]' : 'mt-2 text-[0.82rem]'}`}>
                  Formato requerido: <span className="font-semibold">M4A/AAC-LC · 256 kbps · 48 kHz · Fast Start</span>. Convierte MP3, FLAC o ALAC antes de cargar.
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
                      {canAddSingleStem
                        ? 'Agrega solo el stem que falta o reemplaza toda la carpeta.'
                        : 'Sube una carpeta con stems.'}
                    </p>
                    <div className={`mt-3 grid gap-2.5 ${canAddSingleStem && !isCompactLandscape ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {canAddSingleStem && (
                        <button
                          type="button"
                          onClick={handleOpenSingleStemPicker}
                          disabled={Boolean(busyMessage || deletingTrackId)}
                          className={`ui-pressable-soft flex w-full items-center justify-center gap-3 rounded-[1.2rem] border border-cyan-300/30 bg-cyan-300/10 text-cyan-50 disabled:cursor-not-allowed disabled:opacity-45 ${isCompactLandscape ? 'h-16 px-4' : 'h-28 px-5'}`}
                        >
                          <Upload className={isCompactLandscape ? 'h-5 w-5' : 'h-7 w-7'} />
                          <span className={`${isCompactLandscape ? 'text-sm' : 'text-base'} font-semibold`}>AGREGAR UN STEM</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => folderInputRef.current?.click()}
                        disabled={Boolean(busyMessage || deletingTrackId)}
                        className={`ui-pressable-soft flex w-full items-center justify-center gap-3 rounded-[1.2rem] border border-dashed border-white/16 bg-black/24 text-white/78 disabled:cursor-not-allowed disabled:opacity-45 ${isCompactLandscape ? 'h-16 px-4' : canAddSingleStem ? 'h-28 px-5' : 'h-32 px-6'}`}
                      >
                        <FolderOpen className={isCompactLandscape ? 'h-5 w-5' : 'h-7 w-7'} />
                        <span className={`${isCompactLandscape ? 'text-sm' : 'text-base'} font-semibold`}>
                          {canAddSingleStem ? 'REEMPLAZAR CON CARPETA' : 'ELEGIR CARPETA'}
                        </span>
                      </button>
                    </div>
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

                <div className={`mt-4 grid ${isCompactLandscape ? 'grid-cols-1 gap-2' : 'grid-cols-[minmax(0,1fr)_minmax(0,0.88fr)] gap-4'}`}>
                    <div className="rounded-[1rem] border border-white/8 bg-black/24 p-3">
                      <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-white/38">Pistas cargadas</p>
                      <div className={`${isCompactLandscape ? 'mt-2 max-h-36' : 'mt-3 max-h-32'} space-y-2 overflow-y-auto pr-1`}>
                        {mappedTrackDetails.length > 0 ? (
                          mappedTrackDetails.map((track) => (
                            <div
                              key={`mapped-${track.id}-${track.sourceFileName}`}
                              className={`flex items-center gap-2 rounded-[0.9rem] border px-3 py-2 transition-all ${track.enabled
                                ? 'border-white/6 bg-white/[0.03]'
                                : 'border-white/5 bg-white/[0.018] opacity-65'
                                }`}
                            >
                              <div className="min-w-0 flex-1">
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
                              <button
                                type="button"
                                onClick={() => void handleDeleteStem(track.id)}
                                disabled={Boolean(deletingTrackId || busyMessage)}
                                className="ui-pressable-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rose-300/16 bg-rose-300/[0.06] text-rose-100/72 hover:border-rose-300/28 hover:bg-rose-300/[0.10] hover:text-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label={`Eliminar ${track.sourceFileName} de la sesion y de R2`}
                                title="Eliminar stem de la sesion y de R2"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm leading-relaxed text-white/48">Todavia no hay archivos cargados.</p>
                        )}
                      </div>
                    </div>

                    {!isCompactLandscape && <div className="rounded-[1rem] border border-white/8 bg-black/24 p-3">
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
                    </div>}
                  </div>

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
            accept={LIVE_DIRECTOR_M4A_ACCEPT}
            multiple
            onChange={handleStemFolderSelection}
            className="hidden"
          />
          <input
            ref={singleStemInputRef}
            type="file"
            accept={LIVE_DIRECTOR_M4A_ACCEPT}
            onChange={handleSingleStemSelection}
            className="hidden"
          />
        </>
      )}

      {showStemsActionModal && canOpenStemsActionModal && (
        <div
          className="absolute inset-0 z-[57] flex items-center justify-center bg-black/48 px-4 py-4 backdrop-blur-[10px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="live-director-stems-action-title"
        >
          <div className={`w-full overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,22,0.98),rgba(13,15,17,0.98))] shadow-[0_32px_72px_rgba(0,0,0,0.44)] ${useWideTrackLoadModal ? 'max-w-[58rem]' : 'max-w-[25rem]'}`}>
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

              <div className={`mt-4 grid ${useWideTrackLoadModal ? `${canAddSingleStem ? 'grid-cols-3' : 'grid-cols-2'} gap-3` : 'grid-cols-1 gap-2.5'}`}>
                {canAddSingleStem && (
                  <button
                    type="button"
                    onClick={handleOpenSingleStemPicker}
                    disabled={Boolean(busyMessage || deletingTrackId)}
                    className="ui-pressable-soft group min-h-[8.2rem] rounded-[1.35rem] border border-cyan-300/24 bg-cyan-300/[0.09] p-4 text-left text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-cyan-300/36 hover:bg-cyan-300/[0.13] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-[1rem] border border-cyan-300/24 bg-black/24 text-cyan-100">
                      <Upload className="h-5 w-5" />
                    </span>
                    <span className="mt-4 block text-[0.96rem] font-semibold tracking-tight text-white">
                      Agregar un stem
                    </span>
                    <span className="mt-1 block text-[0.74rem] leading-relaxed text-white/56">
                      Sube una sola pista y conserva todos los stems actuales.
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleOpenTrackLoadModal}
                  disabled={!canManageStemSelection}
                  className="ui-pressable-soft group min-h-[8.2rem] rounded-[1.35rem] border border-white/10 bg-white/[0.045] p-4 text-left text-white/82 hover:border-cyan-300/22 hover:bg-white/[0.065] disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.025] disabled:text-white/38"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-[1rem] border border-white/10 bg-black/24 text-cyan-100/86">
                    <SlidersVertical className="h-5 w-5" />
                  </span>
                  <span className="mt-4 block text-[0.96rem] font-semibold tracking-tight text-white">
                    Gestionar stems
                  </span>
                  <span className="mt-1 block text-[0.74rem] leading-relaxed text-white/54">
                    {canManageStemSelection
                      ? `Prende o apaga pistas antes de aplicar. Ahora: ${activeTracks.length}/${sessionTracks.length} activas.`
                      : 'Disponible cuando la cancion tenga una carpeta multitrack cargada.'}
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
                    Reemplazar todo
                  </span>
                  <span className="mt-1 block text-[0.74rem] leading-relaxed text-white/52">
                    Selecciona otra carpeta y reemplaza la sesión multitrack completa.
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

      {showTrackLoadModal && canManageStemSelection && (
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

              <div className={`mt-4 grid gap-2 ${useWideTrackLoadModal ? 'grid-cols-[1fr_1fr_1.35fr_auto] items-stretch' : 'grid-cols-2'}`}>
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
                  onClick={handleCycleOutputLayout}
                  disabled={!hasTrackSession}
                  className={`ui-pressable-soft rounded-[1rem] px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                    outputLayout === 'guide-right'
                      ? 'border border-orange-300/40 bg-orange-400/[0.14] text-orange-50 hover:border-orange-300/60 hover:bg-orange-400/[0.20]'
                      : 'border border-blue-300/40 bg-blue-400/[0.14] text-blue-50 hover:border-blue-300/60 hover:bg-blue-400/[0.20]'
                  } ${useWideTrackLoadModal ? '' : 'col-span-2'}`}
                  aria-label={`Cambiar distribución de salida. Actual: ${outputLayoutLabel}`}
                  title="Toca para invertir Click/Guía y stems entre L/R"
                >
                  <p className="text-[0.56rem] font-black uppercase tracking-[0.18em] text-white/55">Salida L/R</p>
                  <p className="mt-0.5 text-[0.78rem] font-semibold leading-tight text-white">
                    {outputLayoutLabel}
                  </p>
                </button>
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
                      className={`group flex w-full items-center gap-3 rounded-[1.05rem] border text-left transition-all ${useWideTrackLoadModal ? 'px-3.5 py-3' : 'px-3 py-3'} ${pendingEnabled
                        ? 'border-cyan-300/18 bg-cyan-300/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                        : 'border-white/7 bg-black/22 opacity-72'
                        }`}
                    >
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
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={`shrink-0 border-t border-white/8 bg-black/16 ${useWideTrackLoadModal ? 'px-5 py-4' : 'px-4 py-3'}`}>
              <div className="flex items-center gap-3">
                {!isEnsayoMode && canOpenLoadPanel && (
                  <button
                    type="button"
                    onClick={handleOpenStemsLoader}
                    className="ui-pressable-soft h-12 flex-1 rounded-[1rem] border border-white/10 bg-white/[0.04] px-3 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-white/70 hover:bg-white/[0.07] hover:text-white"
                  >
                    Agregar / reemplazar
                  </button>
                )}
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

      {showRedownloadConfirm && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/58 px-5 backdrop-blur-[6px]"
          role="dialog" aria-modal="true" aria-labelledby="live-director-redownload-title"
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setShowRedownloadConfirm(false); } }}>
          <div className="w-full max-w-sm rounded-[1.6rem] border border-white/12 bg-[linear-gradient(180deg,rgba(22,24,26,0.98),rgba(16,18,20,0.98))] px-6 py-6 shadow-[0_32px_72px_rgba(0,0,0,0.42)]">
            <p className="text-[0.68rem] font-black uppercase tracking-[0.28em] text-emerald-200/82">Sesión cargada</p>
            <h3 id="live-director-redownload-title" className="mt-2 text-[1.25rem] font-semibold tracking-tight text-white">¿Volver a descargar la sesión?</h3>
            <p className="mt-2 text-[0.88rem] leading-relaxed text-white/60">
              Ya está guardada en este equipo. Vuelve a descargarla solo para refrescarla: se revisan los stems y se bajan los que falten o hayan cambiado.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button type="button" autoFocus onClick={() => setShowRedownloadConfirm(false)}
                className="ui-pressable-soft flex-1 rounded-[1rem] border border-white/12 bg-white/4 px-4 py-3 text-[0.92rem] font-semibold text-white/86 hover:bg-white/8">
                Cancelar
              </button>
              <button type="button" onClick={() => { setShowRedownloadConfirm(false); void rehearsalDownload.start(); }}
                className="ui-pressable-soft flex-1 rounded-[1rem] border border-cyan-300/38 bg-cyan-300/12 px-4 py-3 text-[0.92rem] font-semibold text-cyan-50 hover:bg-cyan-300/18">
                Volver a descargar
              </button>
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
                {resolvedBackActionLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {entryCount.beat !== null && eventAdvance.countdown === null && (
        <div className="pointer-events-none absolute inset-0 z-[79] flex flex-col items-center justify-center bg-black/45 px-5 text-center" data-live-entry-count={entryCount.beat}>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-amber-100">Entrada · {songTitle}</p>
          <div aria-hidden="true" className="text-[clamp(5rem,min(24vw,42vh),20rem)] font-bold leading-none tabular-nums text-amber-100">{entryCount.beat}</div>
          <p className="sr-only" role="status">Entrada: {entryCount.beat}</p>
          {entryCount.notice && <p className="mt-2 text-sm text-white/75">{entryCount.notice}</p>}
          {entryCount.pending && <button type="button" onClick={() => entryCount.cancel()} className="pointer-events-auto mt-4 min-h-11 rounded-xl border border-white/25 bg-[#202223] px-5 py-2 text-white">Cancelar entrada · Esc</button>}
        </div>
      )}

      {eventAdvance.countdown !== null && (
        <div className="pointer-events-none absolute inset-0 z-[80] flex flex-col items-center justify-center bg-black/65 px-6 text-center" data-live-event-advance-overlay>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-100/80">Siguiente canción</p>
          <p className="mt-3 max-w-3xl text-[clamp(1.25rem,3vw,2.5rem)] font-semibold leading-tight text-white">{nextEventSong?.title}</p>
          <div aria-hidden="true" className="text-[clamp(8rem,min(30vw,42vh),22rem)] font-bold leading-none tabular-nums text-cyan-100" data-live-event-countdown-large>{eventAdvance.countdown}</div>
          <p className="sr-only" role="status" aria-live="polite">{nextEventSong?.title} en {eventAdvance.countdown} segundos.</p>
          <button type="button" onClick={() => eventAdvance.cancel()} className="pointer-events-auto mt-4 min-h-12 rounded-2xl border border-white/30 bg-[#202223] px-7 py-3 text-lg font-semibold text-white hover:bg-[#303436] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Cancelar · Cualquier botón o tecla</button>
        </div>
      )}

      {usesEventMixPersistence && eventMixSaveNotice && (
        <div
          className="pointer-events-none absolute bottom-2 right-4 z-[59] flex items-center gap-1.5 text-[0.68rem]"
          data-live-event-mix-status={eventMixSaveStatus}
          role={eventMixSaveStatus === 'error' ? 'alert' : undefined}
          aria-live={eventMixSaveStatus === 'error' ? 'assertive' : 'off'}
        >
          <span className={eventMixSaveStatus === 'error' ? 'rounded-lg bg-rose-950/95 px-3 py-2 text-rose-100' : 'text-white/45'}>
            {eventMixSaveStatus === 'saved' && <span aria-hidden="true">✓ </span>}{eventMixSaveNotice}
          </span>
        </div>
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
                    : browserPlaybackRecommendation
                      ? browserPlaybackRecommendation
                      : <>Consejo: pasa los stems problemáticos por el conversor y expórtalos como <span className="font-semibold">M4A/AAC-LC · 256 kbps · 48 kHz · Fast Start</span>.</>}
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

      {(sessionPreparationPending || busyMessage) && (() => {
        const loadLabel = isIOSNativeEngineSurface ? 'Preparando motor Apple' : useStreamingEngine ? 'Preparando motor' : 'Cargando audio';
        const displayBusyMessage = sessionPreparationPending ? `Preparando ${songTitle || 'canción'}…`
          : isInitializingSession && loadProgress && loadProgress.total > 0 ? `${loadLabel} ${loadProgress.loaded}/${loadProgress.total}...` : busyMessage;
        // When we have real load progress, compute fill + counts so the
        // overlay becomes a live progress indicator instead of an opaque
        // "please wait" spinner. Fall back to indeterminate style when we
        // don't know the denominator yet.
        const hasDeterminateProgress =
          !sessionPreparationPending && !!loadProgress && loadProgress.total > 0 && loadProgress.loaded >= 0;
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
                  <p className="mt-1 truncate text-[1.18rem] font-semibold text-white">{displayBusyMessage}</p>
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

      {(loadError || selectedMultitrackEngine.runtimeError) && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/24 backdrop-blur-[8px]">
          <div role="alertdialog" aria-modal="true" aria-labelledby="ld-audio-error-title" className="max-w-lg rounded-[1.8rem] border border-rose-300/18 bg-[linear-gradient(180deg,rgba(23,15,17,0.96),rgba(16,12,13,0.96))] px-7 py-6 shadow-[0_30px_60px_rgba(0,0,0,0.32)]">
            <p className="text-[0.8rem] font-black uppercase tracking-[0.28em] text-rose-200/70">Error de audio</p>
            <h2 id="ld-audio-error-title" className="mt-2 text-2xl font-semibold text-white">{selectedMultitrackEngine.runtimeError ? 'La reproducción se detuvo.' : 'La sesión multitrack no pudo terminar de cargarse.'}</h2>
            <p className="mt-3 text-base leading-relaxed text-white/62">{loadError || selectedMultitrackEngine.runtimeError}</p>
            <button
              type="button"
              autoFocus
              onClick={() => {
                if (hasTrackSession) {
                  setReloadKey((previous) => previous + 1);
                  return;
                }

                setLoadError(null);
                if (canOpenLoadPanel) {
                  setShowLoadPanel(true);
                }
              }}
              className="ui-pressable mt-5 rounded-[1rem] border border-white/10 bg-white/8 px-5 py-3 text-sm tracking-[0.18em] text-white"
            >
              {hasTrackSession ? 'REINTENTAR CARGA' : 'VOLVER AL CARGADOR'}
            </button>
            <button type="button" onClick={() => { void exitLiveDirector(); }} className="ml-3 mt-3 rounded-xl border border-white/20 px-5 py-3 text-sm text-white">
              Volver
            </button>
          </div>
        </div>
      )}

      <ManualTempoSongModal
        open={showManualTempoModal}
        onClose={() => setShowManualTempoModal(false)}
        onSubmit={(input) => {
          onAddQueueSong?.(input);
          setShowManualTempoModal(false);
        }}
      />
    </div>
  );
}

export default LiveDirectorView;
