import { StemSongLevelAnalyzer, SONG_TARGET_LUFS, SONG_PEAK_DB } from '../../utils/stemSongLevel';
import {
  CheckCircle2,
  Download,
  FileAudio,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  Music2,
  Music4,
  UploadCloud,
  Volume2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import ffmpegCoreURL from '@ffmpeg/core?url';
import ffmpegCoreWasmURL from '@ffmpeg/core/wasm?url';
import ffmpegWorkerURL from '../../workers/stemConverterFfmpegWorker?worker&url';

import PitchShiftModal from './PitchShiftModal';
import { detectKey, type DetectedKey } from '../../utils/pitchShift/keyDetection';
import {
  pitchShiftAudioBuffer,
  prewarmPitchShiftEngine,
  type PitchShiftMaterial,
} from '../../utils/pitchShift/rubberbandEngine';
import { encodeAudioBufferToFloat32Wav } from '../../utils/pitchShift/wavEncoder';

import {
  CONTROL_STEM_CATEGORIES, categoryOptions, buildClassifiedStemFileName as buildOutputName, type StemCategory,
} from '../../utils/stemCategories';
import {
  MAX_STEMS, sourceStemFromFile, buildSmartPlan, getPlanReason, getGroupOutputCount, getPlanOutputCount,
  planGroupsToStems, rawSourcesToStems, canMergeStemGroup,
  type StemStatus, type SourceStem, type StemItem, type SmartPlanGroup, type PlanAction,
} from '../../utils/stemConverterPlan';

const DEFAULT_BITRATE = '256k';
const TARGET_SAMPLE_RATE = 48_000;
const TARGET_SAMPLE_RATE_FILTER = `aresample=${TARGET_SAMPLE_RATE},aformat=sample_rates=${TARGET_SAMPLE_RATE}`;
const FFMPEG_LOAD_TIMEOUT_MS = 45_000;
const FFMPEG_WORKER_CACHE_VERSION = '2026-07-16-csp-wasm-v2';
const FFMPEG_WORKER_URL = `${ffmpegWorkerURL}${ffmpegWorkerURL.includes('?') ? '&' : '?'}v=${FFMPEG_WORKER_CACHE_VERSION}`;
const MONO_ANALYSIS_SAMPLE_LIMIT = 120_000;
const MONO_ANALYSIS_MAX_FILE_BYTES = 220 * 1024 * 1024;
const MONO_CORRELATION_THRESHOLD = 0.997;
const MONO_SIDE_RATIO_DB_THRESHOLD = -30;
const MONO_BALANCE_DB_THRESHOLD = 1.25;

type ChannelMode = 'mono' | 'stereo';

type OutputAsset = {
  blob: Blob;
  name: string;
};

type ChannelAnalysisResult = {
  mode: ChannelMode;
  note: string;
};

type StatRow = {
  label: string;
  value: string;
  tone?: 'brand' | 'success';
};

type FFmpegInstance = {
  load: (
    config: { classWorkerURL?: string; coreURL: string; wasmURL: string },
    options?: { signal?: AbortSignal },
  ) => Promise<boolean | void>;
  writeFile: (path: string, data: Uint8Array) => Promise<boolean | void>;
  readFile: (path: string) => Promise<Uint8Array | string>;
  deleteFile: (path: string) => Promise<boolean | void>;
  exec: (args: string[]) => Promise<number>;
  terminate: () => void;
  on: (
    event: 'log' | 'progress',
    callback: (payload: { message?: string; progress?: number; time?: number }) => void,
  ) => void;
};

type StemConversionResult =
  | { ok: true }
  | { ok: false; message: string };

const AUDIO_EXTENSIONS = new Set([
  'aac',
  'aif',
  'aiff',
  'caf',
  'flac',
  'm4a',
  'mp3',
  'wav',
]);

const autoMonoCategories = new Set<StemCategory>(['click', 'guide', 'cues', 'bass', 'vocals']);

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 MB';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`;
};

const formatDb = (value: number, includePlus = false) => {
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  const prefix = includePlus && normalized > 0 ? '+' : '';
  return `${prefix}${normalized.toFixed(1).replace('.0', '')} dB`;
};

const getFileExtension = (name: string) => {
  const match = /\.([^.]+)$/.exec(name.toLowerCase());
  return match?.[1] || '';
};

const buildInputName = (file: File, index: number, sourceIndex = 0) => {
  const extension = getFileExtension(file.name) || 'audio';
  return `input-${index}-${sourceIndex}.${extension}`;
};

const isSupportedAudio = (file: File) => {
  const extension = getFileExtension(file.name);
  return AUDIO_EXTENSIONS.has(extension) || file.type.startsWith('audio/');
};

const shouldForceMonoForStem = (stem: StemItem) => (
  stem.sources.length > 0
  && stem.sources.every((source) => CONTROL_STEM_CATEGORIES.has(source.category))
);

const shouldAnalyzeMonoForStem = (stem: StemItem) => (
  stem.sources.length === 1
  && !shouldForceMonoForStem(stem)
  && autoMonoCategories.has(stem.sources[0].category)
  && stem.sources[0].file.size <= MONO_ANALYSIS_MAX_FILE_BYTES
);

const compactMetric = (value: number, digits = 2) => (
  Number.isFinite(value) ? value.toFixed(digits) : '?'
);

const analyzeStemChannelMode = async (stem: StemItem): Promise<ChannelAnalysisResult> => {
  if (shouldForceMonoForStem(stem)) {
    return { mode: 'mono', note: 'Mono forzado: click, guia y cues.' };
  }

  if (stem.sources.length !== 1) {
    return { mode: 'stereo', note: 'Fusion sin forzar mono.' };
  }

  const [source] = stem.sources;
  if (!autoMonoCategories.has(source.category)) {
    return { mode: 'stereo', note: 'Stereo preservado.' };
  }

  if (source.file.size > MONO_ANALYSIS_MAX_FILE_BYTES) {
    return { mode: 'stereo', note: 'Stereo: archivo grande, analisis omitido.' };
  }

  if (typeof window === 'undefined') {
    return { mode: 'stereo', note: 'Stereo.' };
  }

  const AudioContextCtor = window.AudioContext
    || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    return { mode: 'stereo', note: 'Stereo: analisis no disponible.' };
  }

  const audioContext = new AudioContextCtor();
  try {
    const audioBuffer = await audioContext.decodeAudioData(await source.file.arrayBuffer());
    if (audioBuffer.numberOfChannels <= 1) {
      return { mode: 'mono', note: 'Mono: archivo de 1 canal.' };
    }

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    const step = Math.max(1, Math.floor(audioBuffer.length / MONO_ANALYSIS_SAMPLE_LIMIT));
    let count = 0;
    let sumLeftSquared = 0;
    let sumRightSquared = 0;
    let sumCross = 0;
    let sumMidSquared = 0;
    let sumSideSquared = 0;

    for (let frame = 0; frame < audioBuffer.length; frame += step) {
      const leftSample = left[frame] || 0;
      const rightSample = right[frame] || 0;
      if (!Number.isFinite(leftSample) || !Number.isFinite(rightSample)) {
        continue;
      }

      const mid = (leftSample + rightSample) * 0.5;
      const side = (leftSample - rightSample) * 0.5;
      sumLeftSquared += leftSample * leftSample;
      sumRightSquared += rightSample * rightSample;
      sumCross += leftSample * rightSample;
      sumMidSquared += mid * mid;
      sumSideSquared += side * side;
      count += 1;
    }

    if (count === 0 || sumLeftSquared <= 0 || sumRightSquared <= 0) {
      return { mode: 'stereo', note: 'Stereo: sin lectura L/R confiable.' };
    }

    const epsilon = 1e-12;
    const correlation = sumCross / Math.sqrt(sumLeftSquared * sumRightSquared);
    const leftRms = Math.sqrt(sumLeftSquared / count);
    const rightRms = Math.sqrt(sumRightSquared / count);
    const balanceDb = 20 * Math.log10((leftRms + epsilon) / (rightRms + epsilon));
    const sideRatioDb = 10 * Math.log10((sumSideSquared + epsilon) / (sumMidSquared + epsilon));
    const isSafeMono = correlation >= MONO_CORRELATION_THRESHOLD
      && sideRatioDb <= MONO_SIDE_RATIO_DB_THRESHOLD
      && Math.abs(balanceDb) <= MONO_BALANCE_DB_THRESHOLD;

    if (isSafeMono) {
      return {
        mode: 'mono',
        note: `Mono seguro: corr ${compactMetric(correlation, 3)}, side ${compactMetric(sideRatioDb, 1)} dB.`,
      };
    }

    return {
      mode: 'stereo',
      note: `Stereo: corr ${compactMetric(correlation, 3)}, side ${compactMetric(sideRatioDb, 1)} dB.`,
    };
  } catch {
    return { mode: 'stereo', note: 'Stereo: no se pudo analizar L/R.' };
  } finally {
    await audioContext.close().catch(() => undefined);
  }
};

/**
 * Capacitor bridge shape — we read it off `window.Capacitor` instead of
 * importing `@capacitor/core` directly so the web build never pulls in the
 * native plugin runtime.
 */
type CapacitorBridgeLike = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

type WindowWithCapacitorBridge = Window & typeof globalThis & {
  Capacitor?: CapacitorBridgeLike;
};

/**
 * Returns `true` when running inside the iOS Capacitor shell (or any native
 * Capacitor wrapper). The pitch-shift feature relies on a GPLv2 WASM build of
 * Rubber Band, which we don't ship inside the App Store binary — so we hide
 * the entry point on native iOS and let the rest of the converter run normally.
 */
const isNativeMobileRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;
  const bridge = (window as WindowWithCapacitorBridge).Capacitor;
  return Boolean(bridge?.isNativePlatform?.());
};

/**
 * Categories that are most likely to carry the tonic of the song. We try to
 * detect on bass first (the strongest fundamental) and fall back through the
 * keyboard family before giving up on guitars.
 */
const KEY_DETECTION_PRIORITY: StemCategory[] = ['bass', 'piano', 'keys', 'acoustic'];

const findKeyDetectionSource = (sources: SourceStem[]): SourceStem | null => {
  for (const category of KEY_DETECTION_PRIORITY) {
    const match = sources.find((source) => source.category === category);
    if (match) return match;
  }
  return null;
};

/**
 * The Rubber Band engine accepts a `material` hint to tune transient handling.
 * Drum and click stems do better with mixed transients; everything else uses
 * the melodic preset (formant-preserved, long window).
 */
const getStemMaterial = (stem: StemItem): PitchShiftMaterial => {
  if (stem.sources.length === 0) return 'melodic';
  const isAllPercussive = stem.sources.every((source) => (
    source.category === 'drums'
    || source.category === 'percussion'
    || CONTROL_STEM_CATEGORIES.has(source.category)
  ));
  return isAllPercussive ? 'percussive' : 'melodic';
};

/**
 * Decode an audio file into a Web Audio `AudioBuffer`. Returns `null` if the
 * environment doesn't expose AudioContext or the file can't be decoded.
 *
 * Also exposes the raw decode error so the caller can decide whether to fail
 * the conversion or fall back to the non-pitch-shifted path.
 */
const decodeFileToAudioBuffer = async (file: File): Promise<AudioBuffer | null> => {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext
    || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const audioContext = new AudioContextCtor();
  try {
    const buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    return buffer;
  } catch {
    return null;
  } finally {
    await audioContext.close().catch(() => undefined);
  }
};

const formatPitchSummary = (semitones: number): string => {
  if (semitones === 0) return 'Sin cambio';
  const sign = semitones > 0 ? '+' : '';
  const noun = Math.abs(semitones) === 1 ? 'semitono' : 'semitonos';
  return `${sign}${semitones} ${noun}`;
};

const getStatusLabel = (status: StemStatus) => {
  switch (status) {
    case 'processing':
      return 'Convirtiendo';
    case 'done':
      return 'Listo';
    case 'error':
      return 'Error';
    case 'queued':
    default:
      return 'En cola';
  }
};

const createDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const getEngineErrorMessage = (error: unknown) => {
  const rawMessage = error instanceof Error ? error.message : '';
  if (rawMessage.includes('tardó demasiado')) {
    return rawMessage;
  }

  return 'No se pudo iniciar el motor de audio. Pulsa Convertir para reintentar sin recargar la página.';
};

const getConversionFailureMessage = (stemName: string, exitCode: number, logs: string[]) => {
  const detail = [...logs]
    .reverse()
    .find((line) => /(?:error|invalid|failed|unsupported|not found|could not|unable)/i.test(line));
  const compactDetail = detail
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

  return compactDetail
    ? `No se pudo convertir "${stemName}". ${compactDetail}`
    : `No se pudo convertir "${stemName}" (código FFmpeg ${exitCode}).`;
};

export default function StemConverterTool() {
  const ffmpegRef = useRef<FFmpegInstance | null>(null);
  const loadingFfmpegRef = useRef<FFmpegInstance | null>(null);
  const engineLoadPromiseRef = useRef<Promise<FFmpegInstance> | null>(null);
  const ffmpegLogsRef = useRef<string[]>([]);
  const activeStemIdRef = useRef<string | null>(null);
  const outputsRef = useRef<Map<string, OutputAsset>>(new Map());
  const zipUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  // The FFmpeg progress callback always reports 0..1 of the encode step. When
  // a pitch shift runs first we want the visible progress bar to reflect both
  // phases — so we keep an offset/scale here that maps the raw FFmpeg
  // progress into the slice of the bar reserved for the encoding step.
  const ffmpegProgressRangeRef = useRef<{ offset: number; scale: number }>({ offset: 0, scale: 1 });

  const [stems, setStems] = useState<StemItem[]>([]);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [omittedCount, setOmittedCount] = useState(0);
  const [isLoadingEngine, setIsLoadingEngine] = useState(false);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [zipName, setZipName] = useState('stems-aac-256k-48k.zip');
  const [zipProgress, setZipProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingSources, setPendingSources] = useState<SourceStem[]>([]);
  const [smartPlan, setSmartPlan] = useState<SmartPlanGroup[]>([]);
  const [isPlanOpen, setIsPlanOpen] = useState(false);

  // Pitch-shift integration state.
  const [pitchShiftSemitones, setPitchShiftSemitones] = useState(0);
  const [detectedKey, setDetectedKey] = useState<DetectedKey | null>(null);
  const [keyDetectionStatus, setKeyDetectionStatus] = useState<'idle' | 'running' | 'done' | 'failed' | 'unavailable'>('idle');
  const [isPitchModalOpen, setIsPitchModalOpen] = useState(false);

  const [levelStage, setLevelStage] = useState('');

  const selectedTotalBytes = useMemo(
    () => stems.reduce((total, item) => total + item.size, 0),
    [stems],
  );

  const convertedTotalBytes = useMemo(
    () => stems.reduce((total, item) => total + (item.outputSize || 0), 0),
    [stems],
  );

  const completedCount = useMemo(
    () => stems.filter((item) => item.status === 'done').length,
    [stems],
  );

  const hasFailed = useMemo(
    () => stems.some((item) => item.status === 'error'),
    [stems],
  );
  const planOutputCount = useMemo(
    () => getPlanOutputCount(smartPlan),
    [smartPlan],
  );
  const planMergeCount = useMemo(
    () => smartPlan.filter((group) => group.action === 'merge' && group.sources.length > 1).length,
    [smartPlan],
  );
  const planSkippedCount = useMemo(
    () => smartPlan
      .filter((group) => group.action === 'skip')
      .reduce((total, group) => total + group.sources.length, 0),
    [smartPlan],
  );
  const isPlanOverLimit = planOutputCount > MAX_STEMS;

  const canConvert = stems.length > 0 && !isConverting;
  const completedPercent = stems.length ? Math.round((completedCount / stems.length) * 100) : 0;
  const activeStem = useMemo(
    () => stems.find((item) => item.status === 'processing') || null,
    [stems],
  );
  const runtimeStatus = useMemo(() => {
    if (errorMessage) return 'Error';
    if (isLoadingEngine) return 'Cargando motor';
    if (isConverting) return 'Convirtiendo';
    if (zipUrl) return 'ZIP listo';
    if (isEngineReady) return 'Motor listo';
    if (stems.length) return 'Listo para convertir';
    return 'Arrastra stems para empezar';
  }, [errorMessage, isConverting, isEngineReady, isLoadingEngine, stems.length, zipUrl]);
  const summaryRows = useMemo<StatRow[]>(() => {
    const rows: StatRow[] = [
      { label: 'Stems', value: `${stems.length}/${MAX_STEMS}`, tone: stems.length ? 'brand' : undefined },
      { label: 'Original', value: formatBytes(selectedTotalBytes) },
      { label: 'Salida', value: 'M4A 48k' },
      { label: 'Canales', value: 'Auto mono' },
    ];
    rows.push({
      label: 'Nivel',
      value: 'Automático por canción',
      tone: 'brand',
    });
    if (detectedKey || pitchShiftSemitones !== 0) {
      const detected = detectedKey ? detectedKey.label : '—';
      const shift = pitchShiftSemitones === 0
        ? 'sin cambio'
        : formatPitchSummary(pitchShiftSemitones);
      rows.push({
        label: 'Tono',
        value: `${detected} · ${shift}`,
        tone: pitchShiftSemitones !== 0 ? 'brand' : undefined,
      });
    }
    rows.push({
      label: 'Convertido',
      value: formatBytes(convertedTotalBytes),
      tone: convertedTotalBytes ? 'success' : undefined,
    });
    return rows;
  }, [convertedTotalBytes, detectedKey, pitchShiftSemitones, selectedTotalBytes, stems.length]);

  const revokeZipUrl = useCallback(() => {
    if (zipUrlRef.current) {
      URL.revokeObjectURL(zipUrlRef.current);
      zipUrlRef.current = null;
    }
    setZipUrl(null);
  }, []);

  useEffect(() => () => {
    revokeZipUrl();
  }, [revokeZipUrl]);

  useEffect(() => () => {
    loadingFfmpegRef.current?.terminate();
    if (ffmpegRef.current !== loadingFfmpegRef.current) {
      ffmpegRef.current?.terminate();
    }
    loadingFfmpegRef.current = null;
    ffmpegRef.current = null;
    engineLoadPromiseRef.current = null;
  }, []);

  // Run automatic key detection any time the user loads a fresh batch of
  // sources. We pick the most tonal stem (bass first, then keyboards, then
  // acoustic guitar) and fire Krumhansl-Schmuckler on it. Detection happens
  // entirely in the browser — no upload — and is fully cancellable so a fast
  // re-selection doesn't leave stale results behind.
  useEffect(() => {
    if (pendingSources.length === 0) {
      setDetectedKey(null);
      setKeyDetectionStatus('idle');
      return;
    }

    const tonalSource = findKeyDetectionSource(pendingSources);
    if (!tonalSource) {
      setDetectedKey(null);
      setKeyDetectionStatus('unavailable');
      return;
    }

    let cancelled = false;
    setKeyDetectionStatus('running');
    setDetectedKey(null);

    (async () => {
      try {
        const audioBuffer = await decodeFileToAudioBuffer(tonalSource.file);
        if (cancelled) return;
        if (!audioBuffer) {
          setKeyDetectionStatus('failed');
          return;
        }
        const result = detectKey(audioBuffer);
        if (cancelled) return;
        if (result) {
          setDetectedKey(result);
          setKeyDetectionStatus('done');
        } else {
          setKeyDetectionStatus('failed');
        }
      } catch {
        if (!cancelled) setKeyDetectionStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingSources]);

  const updateStem = useCallback((id: string, patch: Partial<StemItem>) => {
    setStems((current) => current.map((stem) => (
      stem.id === id ? { ...stem, ...patch } : stem
    )));
  }, []);

  const resetOutputs = useCallback(() => {
    outputsRef.current.clear();
    setZipProgress(0);
    revokeZipUrl();
  }, [revokeZipUrl]);

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }

    resetOutputs();
    setErrorMessage('');

    const allFiles = Array.from(fileList);
    const audioFiles = allFiles
      .filter(isSupportedAudio)
      .sort((a, b) => {
        const pathA = ((a as File & { webkitRelativePath?: string }).webkitRelativePath || a.name).toLowerCase();
        const pathB = ((b as File & { webkitRelativePath?: string }).webkitRelativePath || b.name).toLowerCase();
        return pathA.localeCompare(pathB);
      });

    const sources = audioFiles.map(sourceStemFromFile);
    const nextPlan = buildSmartPlan(sources);
    setRejectedCount(allFiles.length - audioFiles.length);
    setOmittedCount(0);
    setPendingSources(sources);
    setSmartPlan(nextPlan);
    setIsPlanOpen(sources.length > 0);
    setStems([]);
  }, [resetOutputs]);

  const applySmartPlan = useCallback(() => {
    if (planOutputCount === 0 || planOutputCount > MAX_STEMS) {
      return;
    }
    const nextStems = planGroupsToStems(smartPlan);
    setStems(nextStems);
    setOmittedCount(planSkippedCount);
    setIsPlanOpen(false);
  }, [planOutputCount, planSkippedCount, smartPlan]);

  const applyRawPlan = useCallback(() => {
    if (pendingSources.length > MAX_STEMS) return;
    setStems(rawSourcesToStems(pendingSources));
    setOmittedCount(0);
    setIsPlanOpen(false);
  }, [pendingSources]);

  const handleApplyPitchShift = useCallback((semitones: number) => {
    setPitchShiftSemitones(semitones);
    setIsPitchModalOpen(false);
  }, []);

  const handleRedetectKey = useCallback(() => {
    if (pendingSources.length === 0) return;
    // Trigger the detection effect by re-pushing the same array reference.
    setPendingSources((current) => [...current]);
  }, [pendingSources.length]);

  const handlePrewarmPitchEngine = useCallback(() => {
    // Fire and forget: warm the WASM cache while the user picks a target key
    // so the actual conversion doesn't pay the network round-trip.
    void prewarmPitchShiftEngine();
  }, []);

  const updatePendingSourceCategory = useCallback((sourceId: string, category: StemCategory) => {
    setPendingSources((current) => {
      const nextSources = current.map((source) => (
        source.id === sourceId ? { ...source, category } : source
      ));
      setSmartPlan((previous) => buildSmartPlan(nextSources, previous));
      return nextSources;
    });
  }, []);

  const updatePlanGroupAction = useCallback((groupId: string, action: PlanAction) => {
    setSmartPlan((current) => current.map((group) => (
      group.id === groupId && (action !== 'merge' || canMergeStemGroup(group))
        ? { ...group, action, reason: getPlanReason(group.category, group.sources, action) }
        : group
    )));
  }, []);

  const loadEngine = useCallback(() => {
    if (ffmpegRef.current) {
      return Promise.resolve(ffmpegRef.current);
    }
    if (engineLoadPromiseRef.current) {
      return engineLoadPromiseRef.current;
    }

    setIsLoadingEngine(true);
    setIsEngineReady(false);
    setErrorMessage('');

    let loadPromise: Promise<FFmpegInstance>;
    loadPromise = (async () => {
      let ffmpeg: FFmpegInstance | null = null;
      let timeoutId: number | undefined;
      let didTimeout = false;
      const abortController = new AbortController();

      try {
        const { FFmpeg } = await import('@ffmpeg/ffmpeg');
        ffmpeg = new FFmpeg() as FFmpegInstance;
        loadingFfmpegRef.current = ffmpeg;
        ffmpegLogsRef.current = [];

        ffmpeg.on('log', ({ message }) => {
          if (!message?.trim()) return;
          ffmpegLogsRef.current = [...ffmpegLogsRef.current.slice(-79), message.trim()];
        });
        ffmpeg.on('progress', ({ progress }) => {
          const activeId = activeStemIdRef.current;
          if (!activeId || typeof progress !== 'number') {
            return;
          }
          const { offset, scale } = ffmpegProgressRangeRef.current;
          const clamped = Math.max(0, Math.min(1, progress));
          const mapped = offset + clamped * scale;
          updateStem(activeId, { progress: Math.round(Math.max(0, Math.min(1, mapped)) * 100) });
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            didTimeout = true;
            reject(new Error('El motor de audio tardó demasiado en iniciar. Pulsa Convertir para reintentar.'));
            abortController.abort();
            ffmpeg?.terminate();
          }, FFMPEG_LOAD_TIMEOUT_MS);
        });

        await Promise.race([
          ffmpeg.load(
            {
              classWorkerURL: FFMPEG_WORKER_URL,
              coreURL: ffmpegCoreURL,
              wasmURL: ffmpegCoreWasmURL,
            },
            { signal: abortController.signal },
          ),
          timeoutPromise,
        ]);

        ffmpegRef.current = ffmpeg;
        loadingFfmpegRef.current = null;
        setIsEngineReady(true);
        return ffmpeg;
      } catch (error) {
        if (ffmpeg && ffmpegRef.current !== ffmpeg) {
          ffmpeg.terminate();
        }
        loadingFfmpegRef.current = null;
        ffmpegRef.current = null;
        setIsEngineReady(false);

        const message = didTimeout
          ? 'El motor de audio tardó demasiado en iniciar. Pulsa Convertir para reintentar.'
          : getEngineErrorMessage(error);
        console.error('[StemConverter] No se pudo iniciar FFmpeg.', error);
        setErrorMessage(message);
        throw new Error(message);
      } finally {
        if (typeof timeoutId === 'number') {
          window.clearTimeout(timeoutId);
        }
        engineLoadPromiseRef.current = null;
        setIsLoadingEngine(false);
      }
    })();

    engineLoadPromiseRef.current = loadPromise;
    return loadPromise;
  }, [updateStem]);

  const cleanupFfmpegFile = useCallback(async (ffmpeg: FFmpegInstance, path: string) => {
    try {
      await ffmpeg.deleteFile(path);
    } catch {
      // FFmpeg FS can ignore missing files after failed conversions.
    }
  }, []);

  const convertOneStem = useCallback(async (
    ffmpeg: FFmpegInstance,
    stem: StemItem,
    index: number,
    level: StemSongLevelAnalyzer | number,
  ): Promise<StemConversionResult> => {
    const needsPitchShift = pitchShiftSemitones !== 0;
    const analyzing = level instanceof StemSongLevelAnalyzer;
    const pitchProgressShare = needsPitchShift ? 0.7 : 0;
    const encodeProgressOffset = pitchProgressShare;
    // When pitch-shifting we hand FFmpeg a self-describing 32-bit float WAV;
    // otherwise we keep the original container so the encoder can decode
    // whatever native format the user supplied.
    const inputNames = stem.sources.map((source, sourceIndex) => (
      needsPitchShift
        ? `input-${index}-${sourceIndex}.wav`
        : buildInputName(source.file, index, sourceIndex)
    ));
    const outputName = analyzing ? `prepared-${index}.wav` : stem.outputName || buildOutputName(stem.name, index);
    const shouldForceMono = shouldForceMonoForStem(stem);
    const shouldAnalyzeChannels = shouldAnalyzeMonoForStem(stem);

    activeStemIdRef.current = stem.id;
    // Reset the FFmpeg progress mapping to "full bar". When pitch-shifting we
    // re-scope it below so encoding fills the final part of the bar.
    ffmpegProgressRangeRef.current = { offset: 0, scale: 1 };
    updateStem(stem.id, {
      status: 'processing',
      progress: 1,
      error: undefined,
      outputName: stem.outputName,
      outputSize: undefined,
      channelMode: undefined,
      channelNote: shouldForceMono ? 'Mono forzado: click, guia y cues.' : shouldAnalyzeChannels ? 'Analizando L/R...' : 'Stereo preservado.',
      levelNote: analyzing ? 'Analizando el balance de la canción...' : `Ganancia ${formatDb(level as number, true)} · ${shouldForceMono ? 'control nivelado aparte' : 'balance conservado'}.`,
    });

    try {
      const channelAnalysis = shouldForceMono || shouldAnalyzeChannels
        ? await analyzeStemChannelMode(stem)
        : { mode: 'stereo' as const, note: stem.sources.length > 1 ? 'Fusion sin forzar mono.' : 'Stereo preservado.' };
      updateStem(stem.id, {
        channelMode: channelAnalysis.mode,
        channelNote: channelAnalysis.note,
      });

      if (needsPitchShift) {
        const material = getStemMaterial(stem);
        // Analyze and export the same pitch-shifted signal in both passes.
        ffmpegProgressRangeRef.current = { offset: encodeProgressOffset, scale: 1 - encodeProgressOffset };
        for (let sourceIndex = 0; sourceIndex < stem.sources.length; sourceIndex += 1) {
          const file = stem.sources[sourceIndex].file;
          const sourceShare = pitchProgressShare / stem.sources.length;
          const sourceOffset = sourceShare * sourceIndex;

          const audioBuffer = await decodeFileToAudioBuffer(file);
          if (!audioBuffer) {
            throw new Error(`No se pudo decodificar "${file.name}" para cambio de tono.`);
          }
          const shifted = await pitchShiftAudioBuffer(audioBuffer, pitchShiftSemitones, {
            material,
            onProgress: ({ phase, progress }) => {
              // Within each source's slice, give the WASM load 0..5%, the
              // study pass 5..40%, and the actual process pass 40..100%.
              const phaseProgress = phase === 'load'
                ? 0.05 * progress
                : phase === 'study'
                  ? 0.05 + progress * 0.35
                  : 0.4 + progress * 0.6;
              const overall = sourceOffset + sourceShare * phaseProgress;
              updateStem(stem.id, { progress: Math.round(Math.max(1, overall * 100)) });
            },
          });
          const wavBytes = encodeAudioBufferToFloat32Wav(shifted);
          await ffmpeg.writeFile(inputNames[sourceIndex], wavBytes);
        }
        updateStem(stem.id, { progress: Math.round(pitchProgressShare * 100) });
      } else {
        for (let sourceIndex = 0; sourceIndex < stem.sources.length; sourceIndex += 1) {
          const inputBytes = new Uint8Array(await stem.sources[sourceIndex].file.arrayBuffer());
          await ffmpeg.writeFile(inputNames[sourceIndex], inputBytes);
        }
      }

      const inputArgs = inputNames.flatMap((inputName) => ['-i', inputName]);
      const mixedInputFilter = `${inputNames.map((_, sourceIndex) => `[${sourceIndex}:a:0]`).join('')}amix=inputs=${inputNames.length}:duration=longest:normalize=0`;
      ffmpegProgressRangeRef.current = { offset: encodeProgressOffset, scale: 1 - encodeProgressOffset };
      const channelArgs = channelAnalysis.mode === 'mono' ? ['-ac', '1'] : ['-ac', '2'];
      const audioFilter = analyzing ? TARGET_SAMPLE_RATE_FILTER
        : `${TARGET_SAMPLE_RATE_FILTER},volume=${(level as number).toFixed(4)}dB`;
      const outputArgs = analyzing
        ? ['-vn', '-map_metadata', '-1', '-c:a', 'pcm_f32le', '-ar', String(TARGET_SAMPLE_RATE), ...channelArgs, outputName]
        : ['-vn', '-map_metadata', '-1', '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', DEFAULT_BITRATE,
          '-ar', String(TARGET_SAMPLE_RATE), ...channelArgs, '-movflags', '+faststart', outputName];
      const command = inputNames.length === 1
        ? ['-hide_banner', '-y', ...inputArgs, '-map', '0:a:0', '-af', audioFilter, ...outputArgs]
        : ['-hide_banner', '-y', ...inputArgs, '-filter_complex', `${mixedInputFilter},${audioFilter}[a]`, '-map', '[a]', ...outputArgs];

      ffmpegLogsRef.current = [];
      const exitCode = await ffmpeg.exec(command);
      if (exitCode !== 0) {
        throw new Error(getConversionFailureMessage(stem.name, exitCode, ffmpegLogsRef.current));
      }

      if (level instanceof StemSongLevelAnalyzer) {
        await level.add(stem.id, outputName, shouldForceMono);
        updateStem(stem.id, { status: 'queued', progress: 0, levelNote: 'Análisis listo. Esperando el resto de la canción.' });
        return { ok: true };
      }

      const result = await ffmpeg.readFile(outputName);
      if (typeof result === 'string') {
        throw new Error('FFmpeg devolvio un resultado inesperado.');
      }

      const outputBytes = new Uint8Array(result);
      const outputBuffer = outputBytes.buffer.slice(
        outputBytes.byteOffset,
        outputBytes.byteOffset + outputBytes.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([outputBuffer], { type: 'audio/mp4' });
      outputsRef.current.set(stem.id, { blob, name: outputName });
      updateStem(stem.id, {
        status: 'done',
        progress: 100,
        outputName,
        outputSize: blob.size,
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : `No se pudo convertir "${stem.name}".`;
      updateStem(stem.id, {
        status: 'error',
        error: message,
        progress: 0,
      });
      return { ok: false, message };
    } finally {
      activeStemIdRef.current = null;
      ffmpegProgressRangeRef.current = { offset: 0, scale: 1 };
      await Promise.all(inputNames.map((inputName) => cleanupFfmpegFile(ffmpeg, inputName)));
      await cleanupFfmpegFile(ffmpeg, outputName);
    }
  }, [cleanupFfmpegFile, pitchShiftSemitones, updateStem]);

  const buildZip = useCallback(async () => {
    const outputs = outputsRef.current;
    if (outputs.size === 0) {
      throw new Error('Ningún stem pudo convertirse. Revisa el error indicado en la cola y vuelve a intentar.');
    }

    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    stems.forEach((stem) => {
      const output = outputs.get(stem.id);
      if (output) {
        zip.file(output.name, output.blob);
      }
    });

    setZipProgress(1);
    const nextZipName = 'stems-aac-256k-48k.zip';
    const zipBlob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      (metadata) => {
        setZipProgress(Math.round(metadata.percent));
      },
    );

    revokeZipUrl();
    const url = URL.createObjectURL(zipBlob);
    zipUrlRef.current = url;
    setZipUrl(url);
    setZipName(nextZipName);
    setZipProgress(100);
  }, [revokeZipUrl, stems]);

  const startConversion = useCallback(async () => {
    if (!canConvert) {
      return;
    }

    setIsConverting(true);
    setErrorMessage('');
    resetOutputs();
    setStems((current) => current.map((stem) => ({
      ...stem,
      status: 'queued',
      progress: 0,
      error: undefined,
      outputSize: undefined,
      channelMode: undefined,
      channelNote: undefined,
      levelNote: undefined,
    })));

    let analyzer: StemSongLevelAnalyzer | undefined;
    try {
      const ffmpeg = await loadEngine();
      analyzer = new StemSongLevelAnalyzer(ffmpeg, () => ffmpegLogsRef.current, () => { ffmpegLogsRef.current = []; });
      for (let index = 0; index < stems.length; index += 1) {
        setLevelStage(`Analizando canción · ${index + 1}/${stems.length}`);
        const result = await convertOneStem(ffmpeg, stems[index], index, analyzer);
        if (!result.ok) throw new Error(result.message);
      }
      setLevelStage('Calculando el volumen de la canción...');
      const gainForStem = await analyzer.finish();
      await analyzer.cleanup();
      const failures: string[] = [];
      for (let index = 0; index < stems.length; index += 1) {
        setLevelStage(`Exportando · ${index + 1}/${stems.length}`);
        const result = await convertOneStem(ffmpeg, stems[index], index, gainForStem(stems[index].id));
        if (!result.ok) {
          failures.push(result.message);
        }
      }

      if (outputsRef.current.size === 0) {
        throw new Error(failures[0] || 'Ningún stem pudo convertirse. Vuelve a intentar.');
      }

      await buildZip();
      if (failures.length > 0) {
        const successfulCount = outputsRef.current.size;
        setErrorMessage(
          `${successfulCount} ${successfulCount === 1 ? 'stem convertido' : 'stems convertidos'}; ${failures.length} no ${failures.length === 1 ? 'pudo' : 'pudieron'} convertirse. El ZIP incluye los archivos listos.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'No se pudo completar la conversión. Pulsa Convertir para reintentar.';
      setErrorMessage(message);
    } finally {
      await analyzer?.cleanup();
      setLevelStage('');
      activeStemIdRef.current = null;
      setIsConverting(false);
    }
  }, [buildZip, canConvert, convertOneStem, loadEngine, resetOutputs, stems]);

  const clearSelection = useCallback(() => {
    resetOutputs();
    setStems([]);
    setPendingSources([]);
    setSmartPlan([]);
    setIsPlanOpen(false);
    setRejectedCount(0);
    setOmittedCount(0);
    setErrorMessage('');
    setPitchShiftSemitones(0);
    setDetectedKey(null);
    setKeyDetectionStatus('idle');
    setIsPitchModalOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }, [resetOutputs]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isConverting) {
      setIsDragging(true);
    }
  }, [isConverting]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isConverting) {
      return;
    }
    handleFiles(event.dataTransfer.files);
  }, [handleFiles, isConverting]);

  return (
    <section
      className="mx-auto w-full max-w-6xl px-4 pb-24"
      aria-busy={isConverting || isLoadingEngine}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.wav,.flac,.aif,.aiff,.caf,.m4a,.mp3,.aac"
        multiple
        className="hidden"
        aria-label="Elegir stems de audio"
        onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept="audio/*,.wav,.flac,.aif,.aiff,.caf,.m4a,.mp3,.aac"
        multiple
        className="hidden"
        aria-label="Elegir carpeta de stems"
        onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />

      <PitchShiftModal
        open={isPitchModalOpen}
        semitones={pitchShiftSemitones}
        detectedKey={detectedKey}
        detectionStatus={keyDetectionStatus}
        onClose={() => setIsPitchModalOpen(false)}
        onApply={handleApplyPitchShift}
        onRequestRedetect={pendingSources.length > 0 ? handleRedetectKey : undefined}
        onPrewarmEngine={handlePrewarmPitchEngine}
      />

      {isPlanOpen ? (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="smart-plan-title"
            className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[1.5rem] border border-border bg-surface shadow-2xl"
          >
            <div className="flex shrink-0 flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-brand">Clasificación de stems</p>
                <h2 id="smart-plan-title" className="text-xl font-black text-content sm:text-2xl">
                  {pendingSources.length} archivos a {planOutputCount} stems
                </h2>
                <p className="mt-1 text-sm text-content-muted">Separados por defecto. Fusiona solo los grupos que elijas.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsPlanOpen(false)}
                className="ui-pressable-soft inline-flex min-h-10 w-max items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-bold text-content"
              >
                Cerrar
              </button>
            </div>

            <div className="grid min-h-0 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
              {smartPlan.map((group) => {
                const isSkipped = group.action === 'skip';
                const groupOutputCount = getGroupOutputCount(group);
                const actionLabel = group.action === 'merge'
                  ? 'Fusionar'
                  : group.action === 'skip'
                    ? 'Omitir'
                    : group.sources.length > 1
                      ? 'Separar'
                      : 'Mantener';
                const groupActions: Array<{ action: PlanAction; label: string; disabled?: boolean }> = [
                  { action: 'keep', label: group.sources.length > 1 ? 'Separar' : 'Mantener' },
                  { action: 'merge', label: 'Fusionar', disabled: !canMergeStemGroup(group) },
                  { action: 'skip', label: 'Omitir' },
                ];
                return (
                  <article
                    key={group.id}
                    className={`rounded-2xl border p-4 ${isSkipped ? 'border-border bg-background/70 opacity-75' : 'border-border bg-background'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-black text-content">{group.name}</h3>
                        <p className="mt-1 text-xs text-content-muted">{group.reason}</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.68rem] font-black ${isSkipped ? 'border-border text-content-muted' : group.action === 'merge' ? 'border-brand/30 bg-brand/10 text-brand' : 'border-success/30 bg-success/10 text-success'}`}>
                        {actionLabel}
                      </span>
                    </div>
                    <p className="mt-3 text-xs font-bold text-content-muted">
                      {group.sources.length} pista{group.sources.length === 1 ? '' : 's'} / {groupOutputCount} salida{groupOutputCount === 1 ? '' : 's'}
                    </p>
                    <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-surface p-1">
                      {groupActions.map((option) => {
                        const isSelected = group.action === option.action;
                        return (
                          <button
                            key={option.action}
                            type="button"
                            onClick={() => updatePlanGroupAction(group.id, option.action)}
                            disabled={option.disabled}
                            aria-pressed={isSelected}
                            className={`min-h-9 rounded-lg px-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-35 ${
                              isSelected
                                ? option.action === 'skip'
                                  ? 'bg-content text-surface'
                                  : 'bg-brand text-white'
                                : 'text-content-muted hover:bg-background hover:text-content'
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2 space-y-1">
                      {group.sources.map((source) => (
                        <div key={source.id} className="grid min-w-0 gap-2">
                          <p className="truncate text-xs text-content-muted">
                            {source.name}
                          </p>
                          <select
                              aria-label={`Categoría de ${source.name}`}
                              value={source.category}
                              onChange={(event) => updatePendingSourceCategory(source.id, event.target.value as StemCategory)}
                              className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-sm font-bold text-content outline-none transition focus:border-brand"
                            >
                              {categoryOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="shrink-0 border-t border-border px-5 py-4">
              <div className="mb-4 flex flex-wrap gap-2 text-xs font-bold text-content-muted">
                <span className={`rounded-full border px-3 py-1.5 ${isPlanOverLimit ? 'border-danger/30 bg-danger/10 text-danger' : 'border-border bg-background'}`}>
                  Salidas: {planOutputCount}/{MAX_STEMS}
                </span>
                <span className="rounded-full border border-border bg-background px-3 py-1.5">Hasta {MAX_STEMS} salidas</span>
                <span className="rounded-full border border-border bg-background px-3 py-1.5">Fusiones: {planMergeCount}</span>
                <span className="rounded-full border border-border bg-background px-3 py-1.5">Omitidos: {planSkippedCount}</span>
              </div>
              {isPlanOverLimit ? (
                <p className="mb-4 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
                  Baja a {MAX_STEMS} salidas: fusiona u omite algunos grupos.
                </p>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={applyRawPlan}
                  disabled={pendingSources.length > MAX_STEMS}
                  className="ui-pressable-soft inline-flex min-h-12 items-center justify-center rounded-2xl border border-border bg-background px-5 font-bold text-content disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Sin fusionar
                </button>
                <button
                  type="button"
                  onClick={applySmartPlan}
                  disabled={planOutputCount === 0 || isPlanOverLimit}
                  className="ui-pressable inline-flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPlanOverLimit ? `Baja a ${MAX_STEMS}` : 'Aplicar plan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-5">
          <div className="overflow-hidden rounded-[1.5rem] border border-border bg-surface shadow-xl">
            <div className="border-b border-border px-5 py-5 md:px-7">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-content-muted">
                    M4A AAC 256 kbps · 48 kHz · auto mono
                  </p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-content md:text-3xl">
                    Arrastra stems y descarga
                  </h2>
                </div>
                <span className="inline-flex w-max items-center gap-2 rounded-full border border-brand/25 bg-brand/10 px-3 py-1.5 text-xs font-black text-brand">
                  {stems.length}/{MAX_STEMS} stems
                </span>
              </div>
            </div>

            <div className="p-4 md:p-6">
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`flex min-h-[18rem] flex-col justify-center rounded-2xl border-2 border-dashed p-5 text-center transition md:p-8 ${
                  isDragging
                    ? 'border-brand bg-brand/10'
                    : 'border-border bg-background/70 hover:border-brand/50'
                }`}
              >
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/12 text-brand">
                  <HardDriveDownload className="h-8 w-8" />
                </div>
                <h3 className="mt-5 text-xl font-black text-content md:text-2xl">
                  {stems.length ? `${stems.length}/${MAX_STEMS} stems listos` : 'Arrastra tus stems aqui'}
                </h3>
                <p className="mx-auto mt-2 max-w-sm text-sm text-content-muted">
                  WAV, FLAC, AIFF, CAF, MP3, M4A o AAC.
                </p>
                <div className="mx-auto mt-5 grid w-full max-w-md gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isConverting}
                    className="ui-pressable-soft inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 font-bold text-content transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <UploadCloud className="h-5 w-5 text-brand" />
                    Elegir stems
                  </button>
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    disabled={isConverting}
                    className="ui-pressable-soft inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 font-bold text-content transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FolderOpen className="h-5 w-5 text-info" />
                    Elegir carpeta
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-border bg-background/35 px-5 py-5 md:px-7">
              <div className="flex items-start gap-3">
                <Volume2 className="mt-1 h-5 w-5 shrink-0 text-brand" />
                <div>
                  <h3 className="font-black text-content">Volumen automático por canción</h3>
                  <p className="mt-1 text-sm leading-relaxed text-content-muted">
                    Carga una canción por conversión. Se mide la mezcla y se ajustan todos sus instrumentos por igual,
                    conservando su balance. Click, guía y conteos se nivelan aparte.
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-content-muted">
                    Referencia: {SONG_TARGET_LUFS} LUFS, con margen de {Math.abs(SONG_PEAK_DB)} dB para los picos.
                    Si acercarse a la referencia saturaría el audio, se conserva un nivel menor.
                    El análisis previo puede aumentar el tiempo de conversión.
                  </p>
                  <p className="mt-2 text-sm font-bold text-brand" role="status" aria-live="polite">{levelStage || 'Siempre activo'}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:flex-wrap md:px-7">
              <button
                type="button"
                onClick={startConversion}
                disabled={!canConvert || isLoadingEngine}
                className="ui-pressable inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand px-5 font-bold text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                {isConverting || isLoadingEngine ? <Loader2 className="h-5 w-5 animate-spin" /> : <Music4 className="h-5 w-5" />}
                {isLoadingEngine ? 'Cargando motor...' : isConverting ? 'Convirtiendo...' : stems.length ? `Convertir ${stems.length} a M4A` : 'Selecciona stems'}
              </button>
              {smartPlan.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setIsPlanOpen(true)}
                  disabled={isConverting}
                  className="ui-pressable-soft inline-flex min-h-12 items-center justify-center rounded-2xl border border-border bg-background px-5 font-bold text-content transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ver plan
                </button>
              ) : null}
              {stems.length > 0 && !isNativeMobileRuntime() ? (
                <button
                  type="button"
                  onClick={() => {
                    void prewarmPitchShiftEngine();
                    setIsPitchModalOpen(true);
                  }}
                  disabled={isConverting}
                  className={`ui-pressable-soft inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-5 font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    pitchShiftSemitones !== 0
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-border bg-background text-content'
                  }`}
                >
                  <Music2 className="h-4 w-4" />
                  {pitchShiftSemitones === 0 ? 'Cambiar tono' : `Tono: ${formatPitchSummary(pitchShiftSemitones)}`}
                </button>
              ) : null}
              {zipUrl ? (
                <a
                  href={zipUrl}
                  download={zipName}
                  className="ui-pressable-soft inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-success/40 bg-success/12 px-5 font-bold text-success sm:flex-none"
                >
                  <Download className="h-5 w-5" />
                  Descargar ZIP
                </a>
              ) : null}
              <button
                type="button"
                onClick={clearSelection}
                disabled={isConverting || (stems.length === 0 && pendingSources.length === 0)}
                className="ui-pressable-soft inline-flex min-h-12 items-center justify-center rounded-2xl border border-border bg-background px-5 font-bold text-content-muted transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                Limpiar
              </button>
            </div>

            {errorMessage ? (
              <div
                role="alert"
                className="border-t border-danger/30 bg-danger/10 px-5 py-4 text-sm text-danger md:px-7"
              >
                {errorMessage}
              </div>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-[1.5rem] border border-border bg-surface shadow-xl">
            <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-content-muted">Cola</p>
                <h3 className="text-lg font-black text-content">Stems seleccionados</h3>
              </div>
              {hasFailed ? (
                <span className="w-max rounded-full border border-danger/30 bg-danger/10 px-3 py-1 text-xs font-bold text-danger">
                  Revisar errores
                </span>
              ) : null}
            </div>

            {stems.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center px-5 py-10 text-center">
                <FileAudio className="h-10 w-10 text-content-muted" />
                <p className="mt-3 font-bold text-content">Suelta stems para empezar.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {stems.map((stem) => {
                  const output = outputsRef.current.get(stem.id);
                  const isActive = stem.status === 'processing';
                  const statusClass = stem.status === 'done'
                    ? 'border-success/30 bg-success/10 text-success'
                    : stem.status === 'error'
                      ? 'border-danger/30 bg-danger/10 text-danger'
                      : isActive
                        ? 'border-brand/30 bg-brand/10 text-brand'
                        : 'border-border bg-background text-content-muted';

                  return (
                    <div
                      key={stem.id}
                      className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_7.5rem_8rem_7rem] md:items-center md:px-5"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          {stem.status === 'done' ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                          ) : stem.status === 'error' ? (
                            <XCircle className="h-4 w-4 shrink-0 text-danger" />
                          ) : isActive ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
                          ) : (
                            <FileAudio className="h-4 w-4 shrink-0 text-content-muted" />
                          )}
                          <p className="truncate font-bold text-content">{stem.name}</p>
                        </div>
                        <p className="mt-1 truncate text-xs text-content-muted">
                          {stem.sources.length > 1 ? `${stem.sources.length} pistas: ${stem.relativePath}` : stem.relativePath}
                        </p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                          <div
                            className={`h-full rounded-full transition-all ${stem.status === 'error' ? 'bg-danger' : stem.status === 'done' ? 'bg-success' : 'bg-brand'}`}
                            style={{ width: `${stem.status === 'queued' ? 0 : stem.progress}%` }}
                          />
                        </div>
                        {stem.error ? <p className="mt-2 text-xs text-danger">{stem.error}</p> : null}
                        {stem.channelNote ? (
                          <p className={`mt-2 text-xs font-semibold ${stem.channelMode === 'mono' ? 'text-success' : 'text-content-muted'}`}>
                            {stem.channelNote}
                          </p>
                        ) : null}
                        {stem.levelNote ? (
                          <p className="mt-1 text-xs font-semibold text-brand">
                            {stem.levelNote}
                          </p>
                        ) : null}
                      </div>
                      <p className="text-sm font-semibold text-content-muted md:text-right">{formatBytes(stem.size)}</p>
                      <p className="text-sm font-semibold text-content-muted md:text-right">
                        {stem.outputSize ? formatBytes(stem.outputSize) : stem.outputName || 'm4a'}
                      </p>
                      <div className="flex items-center gap-2 md:justify-end">
                        {stem.status === 'done' && output ? (
                          <button
                            type="button"
                            onClick={() => createDownload(output.blob, output.name)}
                            className="ui-pressable-soft inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-background px-3 text-xs font-bold text-content"
                          >
                            Bajar
                          </button>
                        ) : (
                          <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-bold ${statusClass}`}>
                            {isActive ? `${stem.progress}%` : getStatusLabel(stem.status)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="rounded-[1.5rem] border border-border bg-surface p-5 shadow-xl lg:sticky lg:top-24">
          <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-content-muted">Resumen</p>
          <dl className="mt-4 divide-y divide-border">
            {summaryRows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 py-3 first:pt-0">
                <dt className="text-sm text-content-muted">{row.label}</dt>
                <dd className={`text-right text-xl font-black ${row.tone === 'success' ? 'text-success' : row.tone === 'brand' ? 'text-brand' : 'text-content'}`}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4" role="status" aria-live="polite">
            <p className="mb-3 text-sm font-bold text-content">{runtimeStatus}</p>
            <div className="mb-2 flex items-center justify-between text-xs text-content-muted">
              <span>Progreso total</span>
              <span>{completedPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${completedPercent}%` }}
              />
            </div>
            {activeStem ? (
              <p className="mt-3 truncate text-xs text-content-muted">
                Ahora: <span className="font-bold text-content">{activeStem.name}</span>
              </p>
            ) : null}
            {zipProgress > 0 ? (
              <p className="mt-2 text-xs text-content-muted">ZIP: {zipProgress}%</p>
            ) : null}
          </div>

          {(omittedCount > 0 || rejectedCount > 0) ? (
            <div className="mt-4 rounded-2xl border border-border bg-background p-3 text-sm text-content-muted">
              {omittedCount > 0 ? <p>{omittedCount} omitidos por tu elección.</p> : null}
              {rejectedCount > 0 ? <p>{rejectedCount} ignorados por no parecer audio.</p> : null}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
