import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FileAudio,
  FolderOpen,
  Loader2,
  Music4,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

const MAX_STEMS = 15;
const DEFAULT_BITRATE = '256k';
const MAX_QUALITY_BITRATE = '320k';
const FFmpegCoreVersion = '0.12.10';

type StemStatus = 'queued' | 'processing' | 'done' | 'error';

type StemItem = {
  id: string;
  file: File;
  name: string;
  relativePath: string;
  size: number;
  status: StemStatus;
  progress: number;
  outputName?: string;
  outputSize?: number;
  error?: string;
};

type OutputAsset = {
  blob: Blob;
  name: string;
};

type FFmpegInstance = {
  load: (config: { coreURL: string; wasmURL: string }) => Promise<void>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  readFile: (path: string) => Promise<Uint8Array | string>;
  deleteFile: (path: string) => Promise<void>;
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

const buildOutputName = (file: File, index: number) => {
  const base = sanitizeFileName(getFileBaseName(file.name));
  return `${String(index + 1).padStart(2, '0')}-${base}.m4a`;
};

const buildInputName = (file: File, index: number) => {
  const extension = getFileExtension(file.name) || 'audio';
  return `input-${index}.${extension}`;
};

const isSupportedAudio = (file: File) => {
  const extension = getFileExtension(file.name);
  return AUDIO_EXTENSIONS.has(extension) || file.type.startsWith('audio/');
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
  const [bitrate, setBitrate] = useState(DEFAULT_BITRATE);
  const [engineLog, setEngineLog] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [zipName, setZipName] = useState('stems-aac-256k.zip');
  const [zipProgress, setZipProgress] = useState(0);

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

  const canConvert = stems.length > 0 && !isConverting;
  const bitrateLabel = bitrate === MAX_QUALITY_BITRATE ? '320 kbps' : '256 kbps';

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

    const selectedFiles = audioFiles.slice(0, MAX_STEMS);
    setRejectedCount(allFiles.length - audioFiles.length);
    setOmittedCount(Math.max(0, audioFiles.length - selectedFiles.length));
    setStems(selectedFiles.map((file, index) => ({
      id: buildStemId(file, index),
      file,
      name: file.name,
      relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      size: file.size,
      status: 'queued',
      progress: 0,
      outputName: buildOutputName(file, index),
    })));
  }, [resetOutputs]);

  const loadEngine = useCallback(async () => {
    if (ffmpegRef.current) {
      return ffmpegRef.current;
    }

    setIsLoadingEngine(true);
    setErrorMessage('');
    setEngineLog('Cargando motor FFmpeg en el navegador...');

    try {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ]);

      const ffmpeg = new FFmpeg() as FFmpegInstance;
      ffmpeg.on('log', ({ message }) => {
        if (message) {
          setEngineLog(message.slice(-180));
        }
      });
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
      setEngineLog('Motor listo. Conversion local activa.');
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
    const inputName = buildInputName(stem.file, index);
    const outputName = buildOutputName(stem.file, index);

    activeStemIdRef.current = stem.id;
    updateStem(stem.id, {
      status: 'processing',
      progress: 1,
      error: undefined,
      outputName,
      outputSize: undefined,
    });

    try {
      const inputBytes = new Uint8Array(await stem.file.arrayBuffer());
      await ffmpeg.writeFile(inputName, inputBytes);

      await ffmpeg.exec([
        '-hide_banner',
        '-y',
        '-i',
        inputName,
        '-vn',
        '-map',
        '0:a:0',
        '-map_metadata',
        '-1',
        '-c:a',
        'aac',
        '-profile:a',
        'aac_low',
        '-b:a',
        bitrate,
        '-movflags',
        '+faststart',
        outputName,
      ]);

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
      await cleanupFfmpegFile(ffmpeg, inputName);
      await cleanupFfmpegFile(ffmpeg, outputName);
    }
  }, [bitrate, cleanupFfmpegFile, updateStem]);

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
    const nextZipName = `stems-aac-${bitrate}.zip`;
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
  }, [bitrate, revokeZipUrl, stems]);

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
      setEngineLog('Conversion terminada. ZIP listo.');
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
    setRejectedCount(0);
    setOmittedCount(0);
    setErrorMessage('');
    setEngineLog('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }, [resetOutputs]);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-24">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
        <div className="rounded-[1.5rem] border border-border bg-surface p-5 shadow-xl md:p-7">
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand/12 text-brand">
                <Archive className="h-6 w-6" />
              </span>
              <div>
                <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-content-muted">
                  Procesamiento local
                </p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-content md:text-3xl">
                  WAV/FLAC a M4A para Live Director
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-content-muted">
                  Convierte stems en el navegador usando AAC-LC a 256 kbps por defecto. Nada se sube al servidor.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isConverting}
                className="ui-pressable-soft flex min-h-24 items-center gap-3 rounded-2xl border border-border bg-background p-4 text-left transition disabled:opacity-50"
              >
                <UploadCloud className="h-6 w-6 shrink-0 text-brand" />
                <span>
                  <span className="block font-bold text-content">Elegir stems</span>
                  <span className="mt-1 block text-xs text-content-muted">WAV, FLAC, AIFF, CAF, MP3 o M4A</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={isConverting}
                className="ui-pressable-soft flex min-h-24 items-center gap-3 rounded-2xl border border-border bg-background p-4 text-left transition disabled:opacity-50"
              >
                <FolderOpen className="h-6 w-6 shrink-0 text-info" />
                <span>
                  <span className="block font-bold text-content">Elegir carpeta</span>
                  <span className="mt-1 block text-xs text-content-muted">Ideal para una secuencia completa</span>
                </span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.flac,.aif,.aiff,.caf,.m4a,.mp3,.aac"
              multiple
              className="hidden"
              onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)}
            />
            <input
              ref={folderInputRef}
              type="file"
              accept="audio/*,.wav,.flac,.aif,.aiff,.caf,.m4a,.mp3,.aac"
              multiple
              className="hidden"
              onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)}
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            />

            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-100 dark:text-amber-100">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <p>
                  Limite practico: <strong>15 stems por secuencia</strong>. Si eliges mas, se procesan solo los
                  primeros 15 archivos de audio y el resto queda omitido para proteger la RAM del navegador.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[0.72rem] font-black uppercase tracking-[0.18em] text-content-muted">
                    Preset AAC
                  </p>
                  <p className="mt-1 text-sm text-content-muted">
                    256k es el recomendado para iPhone y Live Director. 320k queda como modo maximo.
                  </p>
                </div>
                <div className="grid grid-cols-2 rounded-2xl border border-border bg-surface p-1">
                  <button
                    type="button"
                    onClick={() => setBitrate(DEFAULT_BITRATE)}
                    disabled={isConverting}
                    className={`rounded-xl px-4 py-2 text-sm font-black transition ${
                      bitrate === DEFAULT_BITRATE
                        ? 'bg-brand text-white shadow-md'
                        : 'text-content-muted hover:text-content'
                    }`}
                  >
                    256k
                  </button>
                  <button
                    type="button"
                    onClick={() => setBitrate(MAX_QUALITY_BITRATE)}
                    disabled={isConverting}
                    className={`rounded-xl px-4 py-2 text-sm font-black transition ${
                      bitrate === MAX_QUALITY_BITRATE
                        ? 'bg-brand text-white shadow-md'
                        : 'text-content-muted hover:text-content'
                    }`}
                  >
                    320k
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={startConversion}
                disabled={!canConvert || isLoadingEngine}
                className="ui-pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand px-5 font-bold text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isConverting || isLoadingEngine ? <Loader2 className="h-5 w-5 animate-spin" /> : <Music4 className="h-5 w-5" />}
                {isLoadingEngine ? 'Cargando motor...' : isConverting ? 'Convirtiendo...' : `Convertir ${stems.length || ''}`}
              </button>
              {zipUrl ? (
                <a
                  href={zipUrl}
                  download={zipName}
                  className="ui-pressable-soft inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-success/40 bg-success/12 px-5 font-bold text-success"
                >
                  <Download className="h-5 w-5" />
                  Descargar ZIP
                </a>
              ) : null}
              <button
                type="button"
                onClick={clearSelection}
                disabled={isConverting && stems.length > 0}
                className="ui-pressable-soft inline-flex min-h-12 items-center justify-center rounded-2xl border border-border bg-background px-5 font-bold text-content-muted transition disabled:opacity-50"
              >
                Limpiar
              </button>
            </div>

            {errorMessage ? (
              <div className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
                {errorMessage}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="rounded-[1.5rem] border border-border bg-surface p-5 shadow-xl md:p-6">
          <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-content-muted">Resumen</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs text-content-muted">Stems</p>
              <p className="mt-1 text-2xl font-black text-content">{stems.length}/{MAX_STEMS}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs text-content-muted">Original</p>
              <p className="mt-1 text-2xl font-black text-content">{formatBytes(selectedTotalBytes)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs text-content-muted">Preset</p>
              <p className="mt-1 text-2xl font-black text-content">{bitrateLabel}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs text-content-muted">Convertido</p>
              <p className="mt-1 text-2xl font-black text-content">{formatBytes(convertedTotalBytes)}</p>
            </div>
          </div>

          {(omittedCount > 0 || rejectedCount > 0) ? (
            <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              {omittedCount > 0 ? <p>{omittedCount} archivo(s) de audio omitido(s) por superar el limite.</p> : null}
              {rejectedCount > 0 ? <p>{rejectedCount} archivo(s) ignorado(s) por no parecer audio.</p> : null}
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-border bg-background p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-content-muted">
              <span>Progreso</span>
              <span>{completedCount}/{stems.length}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: stems.length ? `${Math.round((completedCount / stems.length) * 100)}%` : '0%' }}
              />
            </div>
            {zipProgress > 0 ? (
              <p className="mt-3 text-xs text-content-muted">ZIP: {zipProgress}%</p>
            ) : null}
          </div>

          <p className="mt-4 min-h-5 truncate text-xs text-content-muted">
            {isEngineReady ? 'FFmpeg listo.' : 'FFmpeg se carga bajo demanda.'} {engineLog}
          </p>
        </aside>
      </div>

      <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-[0.72rem] font-black uppercase tracking-[0.22em] text-content-muted">Cola</p>
            <h3 className="text-lg font-black text-content">Stems seleccionados</h3>
          </div>
          {hasFailed ? (
            <span className="rounded-full border border-danger/30 bg-danger/10 px-3 py-1 text-xs font-bold text-danger">
              Revisar errores
            </span>
          ) : null}
        </div>

        {stems.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-5 py-10 text-center">
            <FileAudio className="h-10 w-10 text-content-muted" />
            <p className="mt-3 font-bold text-content">Todavia no hay stems.</p>
            <p className="mt-1 max-w-md text-sm text-content-muted">
              Elige archivos o una carpeta. La conversion se ejecuta uno por uno para cuidar la memoria.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {stems.map((stem) => {
              const output = outputsRef.current.get(stem.id);
              return (
                <div key={stem.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_8rem_8rem_7rem] md:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {stem.status === 'done' ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      ) : stem.status === 'error' ? (
                        <XCircle className="h-4 w-4 shrink-0 text-danger" />
                      ) : stem.status === 'processing' ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
                      ) : (
                        <FileAudio className="h-4 w-4 shrink-0 text-content-muted" />
                      )}
                      <p className="truncate font-bold text-content">{stem.name}</p>
                    </div>
                    <p className="mt-1 truncate text-xs text-content-muted">{stem.relativePath}</p>
                    {stem.error ? <p className="mt-1 text-xs text-danger">{stem.error}</p> : null}
                  </div>
                  <p className="text-sm font-semibold text-content-muted md:text-right">{formatBytes(stem.size)}</p>
                  <p className="text-sm font-semibold text-content-muted md:text-right">
                    {stem.outputSize ? formatBytes(stem.outputSize) : stem.outputName || 'm4a'}
                  </p>
                  <div className="flex items-center gap-2 md:justify-end">
                    {stem.status === 'processing' ? (
                      <span className="text-sm font-black text-brand">{stem.progress}%</span>
                    ) : stem.status === 'done' && output ? (
                      <button
                        type="button"
                        onClick={() => createDownload(output.blob, output.name)}
                        className="ui-pressable-soft rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-content"
                      >
                        Bajar
                      </button>
                    ) : (
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-content-muted">
                        {stem.status === 'queued' ? 'Lista' : stem.status}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
