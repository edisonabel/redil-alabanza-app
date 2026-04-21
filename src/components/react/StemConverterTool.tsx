import {
  CheckCircle2,
  Download,
  FileAudio,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  Music4,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

const MAX_STEMS = 15;
const TARGET_STEMS = 10;
const DEFAULT_BITRATE = '256k';
const FFmpegCoreVersion = '0.12.10';

type StemStatus = 'queued' | 'processing' | 'done' | 'error';
type StemCategory = 'clickGuide' | 'drums' | 'bass' | 'piano' | 'keys' | 'acoustic' | 'electric' | 'percussion' | 'vocals' | 'pads' | 'misc';
type PlanAction = 'keep' | 'merge' | 'skip';

type SourceStem = {
  id: string;
  file: File;
  name: string;
  relativePath: string;
  size: number;
  category: StemCategory;
};

type StemItem = {
  id: string;
  sources: SourceStem[];
  name: string;
  relativePath: string;
  size: number;
  status: StemStatus;
  progress: number;
  outputName?: string;
  outputSize?: number;
  error?: string;
};

type SmartPlanGroup = {
  id: string;
  action: PlanAction;
  category: StemCategory;
  name: string;
  reason: string;
  sources: SourceStem[];
};

type OutputAsset = {
  blob: Blob;
  name: string;
};

type StatRow = {
  label: string;
  value: string;
  tone?: 'brand' | 'success';
};

type FFmpegInstance = {
  load: (config: { coreURL: string; wasmURL: string }) => Promise<boolean | void>;
  writeFile: (path: string, data: Uint8Array) => Promise<boolean | void>;
  readFile: (path: string) => Promise<Uint8Array | string>;
  deleteFile: (path: string) => Promise<boolean | void>;
  exec: (args: string[]) => Promise<number>;
  on: (
    event: 'log' | 'progress',
    callback: (payload: { message?: string; progress?: number; time?: number }) => void,
  ) => void;
};

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

const getFileExtension = (name: string) => {
  const match = /\.([^.]+)$/.exec(name.toLowerCase());
  return match?.[1] || '';
};

const getFileBaseName = (name: string) => name.replace(/\.[^.]+$/, '');

const normalizeText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const tokenize = (value: string) => normalizeText(value).split(/[^a-z0-9]+/).filter(Boolean);

const sanitizeFileName = (value: string) => {
  const safe = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 82);

  return safe || 'stem';
};

const buildStemId = (file: File, index: number) => {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return `${index}-${relativePath}-${file.size}-${file.lastModified}`;
};

const buildOutputName = (name: string, index: number) => {
  const base = sanitizeFileName(getFileBaseName(name));
  return `${String(index + 1).padStart(2, '0')}-${base}.m4a`;
};

const buildInputName = (file: File, index: number, sourceIndex = 0) => {
  const extension = getFileExtension(file.name) || 'audio';
  return `input-${index}-${sourceIndex}.${extension}`;
};

const isSupportedAudio = (file: File) => {
  const extension = getFileExtension(file.name);
  return AUDIO_EXTENSIONS.has(extension) || file.type.startsWith('audio/');
};

const hasAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

const hasToken = (tokens: string[], words: string[]) => words.some((word) => tokens.includes(word));

const categorizeStem = (file: File): StemCategory => {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const text = normalizeText(`${relativePath} ${getFileBaseName(file.name)}`);
  const tokens = tokenize(text);

  if (
    hasToken(tokens, ['click', 'clic', 'metro', 'metronomo', 'metronome', 'tempo', 'bpm', 'cue', 'cues', 'guide', 'guia', 'guias'])
    || hasAny(text, ['voz guia', 'count in', 'count-in', 'talkback'])
  ) {
    return 'clickGuide';
  }

  if (hasAny(text, ['synthbass', 'synth bass'])) return 'misc';
  if (hasToken(tokens, ['drums', 'drum', 'bateria', 'baterias'])) return 'drums';
  if (hasToken(tokens, ['bass', 'bajo'])) return 'bass';
  if (hasToken(tokens, ['piano', 'grand', 'upright'])) return 'piano';
  if (hasToken(tokens, ['keys', 'key', 'teclas', 'tecla', 'organ', 'organo', 'rhodes', 'wurli', 'wurlitzer', 'ep', 'synth', 'strings', 'string', 'brass'])) return 'keys';
  if (hasToken(tokens, ['ga', 'gac', 'acoustic', 'acustica']) || hasAny(text, ['guitarra acustica', 'gtr ac'])) return 'acoustic';
  if (hasToken(tokens, ['ge', 'ge1', 'ge2', 'ge3', 'g1', 'g1a', 'g1b', 'g2', 'eg', 'egtr', 'electric', 'electrica', 'lead', 'dist'])) return 'electric';
  if (hasAny(text, ['guitarra electrica', 'gtr elec', 'gtr electric'])) return 'electric';
  if (hasToken(tokens, ['perc', 'percs', 'percussion', 'percusion', 'shaker', 'tamb', 'tambourine', 'conga', 'bongo', 'loop', 'loops'])) return 'percussion';
  if (hasToken(tokens, ['pad', 'pads', 'ambient', 'ambiente', 'atmos', 'colchon', 'colchones'])) return 'pads';
  if (hasToken(tokens, ['voz', 'voces', 'vocal', 'vocals', 'coro', 'coros', 'choir', 'bgv', 'bv'])) return 'vocals';
  if (hasAny(text, ['guitar', 'guitarra', 'gtr'])) return 'electric';

  return 'misc';
};

const categoryOrder: StemCategory[] = [
  'clickGuide',
  'drums',
  'bass',
  'piano',
  'keys',
  'acoustic',
  'electric',
  'percussion',
  'vocals',
  'misc',
  'pads',
];

const categoryMeta: Record<StemCategory, { name: string; mergeReason: string; keepReason: string; skipReason?: string }> = {
  clickGuide: {
    name: 'Click + Guia',
    mergeReason: 'Click, guia y cues en una sola pista.',
    keepReason: 'Guia de tiempo lista.',
  },
  drums: {
    name: 'Bateria',
    mergeReason: 'Bateria unificada y separada de la percusion extra.',
    keepReason: 'Base ritmica principal.',
  },
  bass: {
    name: 'Bajo',
    mergeReason: 'Bajos juntos para mantener un solo canal base.',
    keepReason: 'Base armonica principal.',
  },
  piano: {
    name: 'Piano',
    mergeReason: 'Pianos juntos en un solo apoyo.',
    keepReason: 'Instrumento base frecuente.',
  },
  keys: {
    name: 'Keys / Organos',
    mergeReason: 'Teclas, organos y synths juntos como apoyo.',
    keepReason: 'Apoyo de teclas.',
  },
  acoustic: {
    name: 'Guitarras acusticas',
    mergeReason: 'Acusticas similares en una sola pista.',
    keepReason: 'Acustica principal.',
  },
  electric: {
    name: 'Guitarras electricas',
    mergeReason: 'GE, G1, G2 y leads juntos para ahorrar canales.',
    keepReason: 'Electrica principal.',
  },
  percussion: {
    name: 'Percusion extra',
    mergeReason: 'Loops y percusiones extra juntos.',
    keepReason: 'Percusion extra.',
  },
  vocals: {
    name: 'Coros / Voces',
    mergeReason: 'Coros y voces de apoyo en una sola guia.',
    keepReason: 'Voz de apoyo.',
  },
  misc: {
    name: 'Extras / FX',
    mergeReason: 'Extras poco criticos juntos.',
    keepReason: 'Extra disponible.',
  },
  pads: {
    name: 'Pads / Ambiente',
    mergeReason: 'Pads juntos si decides usarlos.',
    keepReason: 'Pad disponible.',
    skipReason: 'Sugerido omitir: puedes usar el pad interno.',
  },
};

const sourceStemFromFile = (file: File, index: number): SourceStem => {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return {
    id: buildStemId(file, index),
    file,
    name: file.name,
    relativePath,
    size: file.size,
    category: categorizeStem(file),
  };
};

const createPlanGroup = (category: StemCategory, sources: SourceStem[], action?: PlanAction): SmartPlanGroup => {
  const meta = categoryMeta[category];
  const finalAction = action || (sources.length > 1 ? 'merge' : 'keep');
  return {
    id: `${category}-${sources.map((source) => source.id).join('|')}`,
    action: finalAction,
    category,
    name: meta.name,
    reason: finalAction === 'skip'
      ? (meta.skipReason || 'Sugerido omitir para ahorrar canales.')
      : sources.length > 1
        ? meta.mergeReason
        : meta.keepReason,
    sources,
  };
};

const buildSmartPlan = (sources: SourceStem[]) => {
  const byCategory = new Map<StemCategory, SourceStem[]>();
  sources.forEach((source) => {
    const bucket = byCategory.get(source.category) || [];
    bucket.push(source);
    byCategory.set(source.category, bucket);
  });

  const hasNonPadSources = sources.some((source) => source.category !== 'pads');
  const groups = categoryOrder.flatMap((category) => {
    const bucket = byCategory.get(category);
    if (!bucket?.length) return [];
    const shouldSkip = category === 'pads' && hasNonPadSources;
    return [createPlanGroup(category, bucket, shouldSkip ? 'skip' : undefined)];
  });

  const outputGroups = groups.filter((group) => group.action !== 'skip');
  if (outputGroups.length <= MAX_STEMS) {
    return groups;
  }

  const allowedIds = new Set(outputGroups.slice(0, MAX_STEMS).map((group) => group.id));
  return groups.map((group) => (
    group.action !== 'skip' && !allowedIds.has(group.id)
      ? { ...group, action: 'skip' as PlanAction, reason: `Sugerido omitir para mantener maximo ${MAX_STEMS} stems.` }
      : group
  ));
};

const planGroupsToStems = (groups: SmartPlanGroup[]) => groups
  .filter((group) => group.action !== 'skip')
  .slice(0, MAX_STEMS)
  .map<StemItem>((group, index) => {
    const sourceNames = group.sources.map((source) => source.name);
    return {
      id: `plan-${index}-${group.id}`,
      sources: group.sources,
      name: group.name,
      relativePath: sourceNames.length > 3
        ? `${sourceNames.slice(0, 3).join(', ')} +${sourceNames.length - 3}`
        : sourceNames.join(', '),
      size: group.sources.reduce((total, source) => total + source.size, 0),
      status: 'queued',
      progress: 0,
      outputName: buildOutputName(group.name, index),
    };
  });

const rawSourcesToStems = (sources: SourceStem[]) => sources.slice(0, MAX_STEMS).map<StemItem>((source, index) => ({
  id: `raw-${index}-${source.id}`,
  sources: [source],
  name: source.name,
  relativePath: source.relativePath,
  size: source.size,
  status: 'queued',
  progress: 0,
  outputName: buildOutputName(source.name, index),
}));

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

export default function StemConverterTool() {
  const ffmpegRef = useRef<FFmpegInstance | null>(null);
  const activeStemIdRef = useRef<string | null>(null);
  const outputsRef = useRef<Map<string, OutputAsset>>(new Map());
  const zipUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const [stems, setStems] = useState<StemItem[]>([]);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [omittedCount, setOmittedCount] = useState(0);
  const [isLoadingEngine, setIsLoadingEngine] = useState(false);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [zipName, setZipName] = useState('stems-aac-256k.zip');
  const [zipProgress, setZipProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingSources, setPendingSources] = useState<SourceStem[]>([]);
  const [smartPlan, setSmartPlan] = useState<SmartPlanGroup[]>([]);
  const [isPlanOpen, setIsPlanOpen] = useState(false);

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
    () => smartPlan.filter((group) => group.action !== 'skip').length,
    [smartPlan],
  );
  const planMergeCount = useMemo(
    () => smartPlan.filter((group) => group.action === 'merge').length,
    [smartPlan],
  );
  const planSkippedCount = useMemo(
    () => smartPlan
      .filter((group) => group.action === 'skip')
      .reduce((total, group) => total + group.sources.length, 0),
    [smartPlan],
  );

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
  const summaryRows = useMemo<StatRow[]>(() => [
    { label: 'Stems', value: `${stems.length}/${MAX_STEMS}`, tone: stems.length ? 'brand' : undefined },
    { label: 'Original', value: formatBytes(selectedTotalBytes) },
    { label: 'Salida', value: 'M4A 256k' },
    { label: 'Convertido', value: formatBytes(convertedTotalBytes), tone: convertedTotalBytes ? 'success' : undefined },
  ], [convertedTotalBytes, selectedTotalBytes, stems.length]);

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
    const nextStems = planGroupsToStems(smartPlan);
    setStems(nextStems);
    setOmittedCount(planSkippedCount);
    setIsPlanOpen(false);
  }, [planSkippedCount, smartPlan]);

  const applyRawPlan = useCallback(() => {
    setStems(rawSourcesToStems(pendingSources));
    setOmittedCount(Math.max(0, pendingSources.length - MAX_STEMS));
    setIsPlanOpen(false);
  }, [pendingSources]);

  const loadEngine = useCallback(async () => {
    if (ffmpegRef.current) {
      return ffmpegRef.current;
    }

    setIsLoadingEngine(true);
    setErrorMessage('');

    try {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ]);

      const ffmpeg = new FFmpeg() as FFmpegInstance;
      ffmpeg.on('progress', ({ progress }) => {
        const activeId = activeStemIdRef.current;
        if (!activeId || typeof progress !== 'number') {
          return;
        }
        updateStem(activeId, { progress: Math.round(Math.max(0, Math.min(1, progress)) * 100) });
      });

      const baseURL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFmpegCoreVersion}/dist/esm`;
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      ffmpegRef.current = ffmpeg;
      setIsEngineReady(true);
      return ffmpeg;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar FFmpeg.';
      setErrorMessage(message);
      throw error;
    } finally {
      setIsLoadingEngine(false);
    }
  }, [updateStem]);

  const cleanupFfmpegFile = useCallback(async (ffmpeg: FFmpegInstance, path: string) => {
    try {
      await ffmpeg.deleteFile(path);
    } catch {
      // FFmpeg FS can ignore missing files after failed conversions.
    }
  }, []);

  const convertOneStem = useCallback(async (ffmpeg: FFmpegInstance, stem: StemItem, index: number) => {
    const inputNames = stem.sources.map((source, sourceIndex) => buildInputName(source.file, index, sourceIndex));
    const outputName = stem.outputName || buildOutputName(stem.name, index);

    activeStemIdRef.current = stem.id;
    updateStem(stem.id, {
      status: 'processing',
      progress: 1,
      error: undefined,
      outputName,
      outputSize: undefined,
    });

    try {
      for (let sourceIndex = 0; sourceIndex < stem.sources.length; sourceIndex += 1) {
        const inputBytes = new Uint8Array(await stem.sources[sourceIndex].file.arrayBuffer());
        await ffmpeg.writeFile(inputNames[sourceIndex], inputBytes);
      }

      const inputArgs = inputNames.flatMap((inputName) => ['-i', inputName]);
      const outputArgs = [
        '-vn',
        '-map_metadata',
        '-1',
        '-c:a',
        'aac',
        '-profile:a',
        'aac_low',
        '-b:a',
        DEFAULT_BITRATE,
        '-movflags',
        '+faststart',
        outputName,
      ];
      const command = inputNames.length === 1
        ? [
          '-hide_banner',
          '-y',
          ...inputArgs,
          '-map',
          '0:a:0',
          ...outputArgs,
        ]
        : [
          '-hide_banner',
          '-y',
          ...inputArgs,
          '-filter_complex',
          `${inputNames.map((_, sourceIndex) => `[${sourceIndex}:a:0]`).join('')}amix=inputs=${inputNames.length}:duration=longest:normalize=1,alimiter=limit=0.95[a]`,
          '-map',
          '[a]',
          ...outputArgs,
        ];

      await ffmpeg.exec(command);

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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversion fallida.';
      updateStem(stem.id, {
        status: 'error',
        error: message,
        progress: 0,
      });
    } finally {
      activeStemIdRef.current = null;
      await Promise.all(inputNames.map((inputName) => cleanupFfmpegFile(ffmpeg, inputName)));
      await cleanupFfmpegFile(ffmpeg, outputName);
    }
  }, [cleanupFfmpegFile, updateStem]);

  const buildZip = useCallback(async () => {
    const outputs = outputsRef.current;
    if (outputs.size === 0) {
      return;
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
    const nextZipName = 'stems-aac-256k.zip';
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
    })));

    try {
      const ffmpeg = await loadEngine();
      for (let index = 0; index < stems.length; index += 1) {
        await convertOneStem(ffmpeg, stems[index], index);
      }
      await buildZip();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo completar la conversion.';
      setErrorMessage(message);
    } finally {
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

      {isPlanOpen ? (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="smart-plan-title"
            className="max-h-[90dvh] w-full max-w-4xl overflow-hidden rounded-[1.5rem] border border-border bg-surface shadow-2xl"
          >
            <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-brand">Cerebro de stems</p>
                <h2 id="smart-plan-title" className="text-xl font-black text-content sm:text-2xl">
                  {pendingSources.length} archivos a {planOutputCount} stems
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsPlanOpen(false)}
                className="ui-pressable-soft inline-flex min-h-10 w-max items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-bold text-content"
              >
                Cerrar
              </button>
            </div>

            <div className="grid max-h-[58dvh] gap-3 overflow-y-auto p-4 sm:grid-cols-2">
              {smartPlan.map((group) => {
                const isSkipped = group.action === 'skip';
                const actionLabel = group.action === 'merge'
                  ? 'Fusionar'
                  : group.action === 'skip'
                    ? 'Omitir sugerido'
                    : 'Mantener';
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
                      {group.sources.length} pista{group.sources.length === 1 ? '' : 's'}
                    </p>
                    <div className="mt-2 space-y-1">
                      {group.sources.slice(0, 4).map((source) => (
                        <p key={source.id} className="truncate text-xs text-content-muted">
                          {source.name}
                        </p>
                      ))}
                      {group.sources.length > 4 ? (
                        <p className="text-xs font-bold text-content-muted">+{group.sources.length - 4} mas</p>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="border-t border-border px-5 py-4">
              <div className="mb-4 flex flex-wrap gap-2 text-xs font-bold text-content-muted">
                <span className="rounded-full border border-border bg-background px-3 py-1.5">Meta ideal: {TARGET_STEMS}</span>
                <span className="rounded-full border border-border bg-background px-3 py-1.5">Fusiones: {planMergeCount}</span>
                <span className="rounded-full border border-border bg-background px-3 py-1.5">Omitidos sugeridos: {planSkippedCount}</span>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={applyRawPlan}
                  className="ui-pressable-soft inline-flex min-h-12 items-center justify-center rounded-2xl border border-border bg-background px-5 font-bold text-content"
                >
                  Sin fusionar
                </button>
                <button
                  type="button"
                  onClick={applySmartPlan}
                  className="ui-pressable inline-flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-white shadow-lg"
                >
                  Aplicar plan
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
                    M4A AAC 256 kbps
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
              <div className="border-t border-danger/30 bg-danger/10 px-5 py-4 text-sm text-danger md:px-7">
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
              {omittedCount > 0 ? <p>{omittedCount} omitidos por sugerencia o limite.</p> : null}
              {rejectedCount > 0 ? <p>{rejectedCount} ignorados por no parecer audio.</p> : null}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
