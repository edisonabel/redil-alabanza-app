import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Headphones, Pause, Play, Repeat, Square, Upload } from 'lucide-react';
import { useMultitrackEngine } from '../../../hooks/useMultitrackEngine';
import type { TrackData } from '../../../services/MultitrackEngine';
import type { SharedStreamingTelemetry } from '../../../services/StreamingMultitrackEngine';

const MAX_LAB_TRACKS = 12;

const formatTime = (seconds: number) => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds % 1) * 1000);
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
};

const readStableTelemetry = (telemetry: SharedStreamingTelemetry) => {
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

export default function AudioLabView() {
  const engine = useMultitrackEngine({
    useStreamingEngine: true,
    passiveTelemetry: true,
  });
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [soloTrackIds, setSoloTrackIds] = useState<Set<string>>(() => new Set());
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [status, setStatus] = useState('Carga hasta 12 stems AAC/M4A para probar telemetria pasiva.');
  const objectUrlsRef = useRef<string[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const levelRefs = useRef(new Map<string, HTMLDivElement>());
  const timeTextRef = useRef<HTMLSpanElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const loopStartInputRef = useRef<HTMLInputElement | null>(null);
  const loopEndInputRef = useRef<HTMLInputElement | null>(null);
  const renderCountRef = useRef(0);
  const renderCountTextRef = useRef<HTMLSpanElement | null>(null);
  const durationRef = useRef(0);

  renderCountRef.current += 1;

  useEffect(() => {
    if (renderCountTextRef.current) {
      renderCountTextRef.current.textContent = String(renderCountRef.current);
    }
  });

  const stopPassiveLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const drawPassiveFrame = useCallback(() => {
    const telemetry = engine.getSharedTelemetry();

    if (telemetry) {
      const currentTime = readStableTelemetry(telemetry);
      const duration = Math.max(durationRef.current, currentTime, 0.001);

      if (timeTextRef.current) {
        timeTextRef.current.textContent = formatTime(currentTime);
      }

      if (playheadRef.current) {
        const progress = Math.max(0, Math.min(1, currentTime / duration));
        playheadRef.current.style.setProperty('--playhead-progress', String(progress));
      }

      for (let index = 0; index < telemetry.trackIds.length; index += 1) {
        const trackId = telemetry.trackIds[index];
        const levelElement = levelRefs.current.get(trackId);
        if (!levelElement) continue;

        const level = Math.max(0, Math.min(1, telemetry.levels[index] || 0));
        levelElement.style.setProperty('--vu-level', level.toFixed(4));
      }
    }

    animationFrameRef.current = window.requestAnimationFrame(drawPassiveFrame);
  }, [engine]);

  const startPassiveLoop = useCallback(() => {
    stopPassiveLoop();
    animationFrameRef.current = window.requestAnimationFrame(drawPassiveFrame);
  }, [drawPassiveFrame, stopPassiveLoop]);

  useEffect(() => () => {
    stopPassiveLoop();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, [stopPassiveLoop]);

  const handleFilesSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []).slice(0, MAX_LAB_TRACKS);

    stopPassiveLoop();
    engine.stop();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    levelRefs.current.clear();
    durationRef.current = 0;

    const nextTracks = files.map<TrackData>((file, index) => {
      const objectUrl = URL.createObjectURL(file);
      objectUrlsRef.current.push(objectUrl);

      return {
        id: `lab-track-${index + 1}`,
        name: file.name.replace(/\.[^.]+$/, '') || `Stem ${index + 1}`,
        url: objectUrl,
        sourceFileName: file.name,
        volume: 1,
        isMuted: false,
      };
    });

    setTracks(nextTracks);
    setSoloTrackIds(new Set());
    setLoopEnabled(false);
    setStatus(
      nextTracks.length > 0
        ? `${nextTracks.length} stem${nextTracks.length === 1 ? '' : 's'} listo${nextTracks.length === 1 ? '' : 's'} para inicializar.`
        : 'Carga hasta 12 stems AAC/M4A para probar telemetria pasiva.',
    );
    event.currentTarget.value = '';
  }, [engine, stopPassiveLoop]);

  const handleInitialize = useCallback(async () => {
    if (tracks.length === 0) {
      setStatus('Selecciona al menos un stem antes de inicializar.');
      return;
    }

    stopPassiveLoop();
    setStatus('Inicializando motor streaming con SharedArrayBuffer...');

    try {
      await engine.initialize(tracks);
      durationRef.current = Math.max(engine.duration, 0.001);
      setStatus(
        engine.getSharedTelemetry()
          ? 'Motor listo. La UI leera tiempo y VU directo desde SAB.'
          : 'Motor listo, pero SharedArrayBuffer no esta disponible en este contexto.',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo inicializar el motor.');
    }
  }, [engine, stopPassiveLoop, tracks]);

  const handlePlay = useCallback(async () => {
    await engine.play();
    durationRef.current = Math.max(engine.duration, durationRef.current, 0.001);
    startPassiveLoop();
  }, [engine, startPassiveLoop]);

  const handlePause = useCallback(() => {
    engine.pause();
    stopPassiveLoop();
  }, [engine, stopPassiveLoop]);

  const handleStop = useCallback(() => {
    engine.stop();
    stopPassiveLoop();

    if (timeTextRef.current) {
      timeTextRef.current.textContent = formatTime(0);
    }
    if (playheadRef.current) {
      playheadRef.current.style.setProperty('--playhead-progress', '0');
    }
    levelRefs.current.forEach((element) => {
      element.style.setProperty('--vu-level', '0');
    });
  }, [engine, stopPassiveLoop]);

  const handleLoopCommit = useCallback(() => {
    const start = Number(loopStartInputRef.current?.value || 0);
    const end = Number(loopEndInputRef.current?.value || 0);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setStatus('Define un loop valido, por ejemplo 4.0 a 12.0 segundos.');
      return;
    }

    engine.setLoopPoints(start, end);
    setLoopEnabled(true);
    setStatus(`Loop DSP activo de ${start.toFixed(2)}s a ${end.toFixed(2)}s.`);
  }, [engine]);

  const handleLoopToggle = useCallback(() => {
    engine.toggleLoop();
    setLoopEnabled((current) => !current);
  }, [engine]);

  const handleSoloToggle = useCallback((trackId: string) => {
    engine.soloTrack(trackId);
    setSoloTrackIds((current) => {
      const next = new Set(current);

      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }

      return next;
    });
  }, [engine]);

  return (
    <main className="min-h-screen bg-[#101114] px-4 py-6 text-white sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
              Audio Lab
            </p>
            <h1 className="mt-2 text-2xl font-black sm:text-3xl">SAB passive telemetry</h1>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm text-white/72 sm:text-right">
            <span>crossOriginIsolated</span>
            <strong className={self.crossOriginIsolated ? 'text-emerald-300' : 'text-red-300'}>
              {String(self.crossOriginIsolated)}
            </strong>
            <span>React renders</span>
            <strong ref={renderCountTextRef} className="font-mono text-emerald-300">
              0
            </strong>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-white/12 bg-white/8 px-4 text-sm font-bold text-white transition-colors hover:bg-white/12">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Stems
            <input
              className="sr-only"
              type="file"
              accept="audio/*,.m4a,.aac,.mp4"
              multiple
              onChange={handleFilesSelected}
            />
          </label>
          <button
            type="button"
            onClick={handleInitialize}
            className="h-11 rounded-md border border-white/12 bg-white px-4 text-sm font-black text-[#101114] transition-colors hover:bg-white/88"
          >
            Inicializar
          </button>
          <button
            type="button"
            onClick={handlePlay}
            disabled={!engine.isReady}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-emerald-300/30 bg-emerald-400/18 px-4 text-sm font-black text-emerald-100 transition-colors hover:bg-emerald-400/24 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Play
          </button>
          <button
            type="button"
            onClick={handlePause}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-white/12 bg-white/8 px-4 text-sm font-bold text-white transition-colors hover:bg-white/12"
          >
            <Pause className="h-4 w-4" aria-hidden="true" />
            Pausa
          </button>
          <button
            type="button"
            onClick={handleStop}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-white/12 bg-white/8 px-4 text-sm font-bold text-white transition-colors hover:bg-white/12"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
            Stop
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-md border border-white/10 bg-[#181a1f] p-3">
          <span className="inline-flex items-center gap-2 text-sm font-black text-white/80">
            <Repeat className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            Loop DSP
          </span>
          <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-white/54">
            Start
            <input
              ref={loopStartInputRef}
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
              className="h-9 w-24 rounded-md border border-white/12 bg-white/8 px-2 font-mono text-sm text-white outline-none focus:border-emerald-300/60"
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-white/54">
            End
            <input
              ref={loopEndInputRef}
              type="number"
              min="0"
              step="0.01"
              defaultValue="8"
              className="h-9 w-24 rounded-md border border-white/12 bg-white/8 px-2 font-mono text-sm text-white outline-none focus:border-emerald-300/60"
            />
          </label>
          <button
            type="button"
            onClick={handleLoopCommit}
            disabled={!engine.isReady}
            className="h-9 rounded-md border border-emerald-300/30 bg-emerald-400/18 px-3 text-sm font-black text-emerald-100 transition-colors hover:bg-emerald-400/24 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Aplicar
          </button>
          <button
            type="button"
            onClick={handleLoopToggle}
            disabled={!engine.isReady}
            className={`h-9 rounded-md border px-3 text-sm font-black transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              loopEnabled
                ? 'border-emerald-300/40 bg-emerald-300 text-[#101114]'
                : 'border-white/12 bg-white/8 text-white hover:bg-white/12'
            }`}
          >
            {loopEnabled ? 'Activo' : 'Inactivo'}
          </button>
        </div>

        <div className="rounded-md border border-white/10 bg-[#181a1f] p-4">
          <div className="flex items-center justify-between gap-4">
            <span ref={timeTextRef} className="font-mono text-xl font-black text-emerald-200">
              00:00.000
            </span>
            <span className="truncate text-sm text-white/64">{status}</span>
          </div>
          <div
            ref={playheadRef}
            className="mt-4 h-2 overflow-hidden rounded-full bg-white/10 [--playhead-progress:0]"
          >
            <div
              className="h-full rounded-full bg-emerald-300"
              style={{ transform: 'scaleX(var(--playhead-progress))', transformOrigin: 'left center' }}
            />
          </div>
        </div>

        <section className="grid gap-2">
          {tracks.map((track, index) => (
            <div
              key={track.id}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(4rem,auto)_minmax(8rem,18rem)] items-center gap-3 rounded-md border border-white/8 bg-[#17191d] px-3 py-2"
            >
              <span className="font-mono text-xs text-white/46">{String(index + 1).padStart(2, '0')}</span>
              <span className="truncate text-sm font-bold text-white/86">{track.name}</span>
              <button
                type="button"
                onClick={() => handleSoloToggle(track.id)}
                disabled={!engine.isReady}
                className={`inline-flex h-8 items-center justify-center gap-1 rounded-md border px-2 text-xs font-black transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  soloTrackIds.has(track.id)
                    ? 'border-emerald-300/40 bg-emerald-300 text-[#101114]'
                    : 'border-white/12 bg-white/8 text-white hover:bg-white/12'
                }`}
              >
                <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
                Solo
              </button>
              <div
                ref={(element) => {
                  if (element) {
                    levelRefs.current.set(track.id, element);
                  } else {
                    levelRefs.current.delete(track.id);
                  }
                }}
                className="h-3 overflow-hidden rounded-full bg-white/10 [--vu-level:0]"
              >
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#5ee787,#f2cc60,#ff7b72)]"
                  style={{ transform: 'scaleX(var(--vu-level))', transformOrigin: 'left center' }}
                />
              </div>
            </div>
          ))}
        </section>
      </section>
    </main>
  );
}
