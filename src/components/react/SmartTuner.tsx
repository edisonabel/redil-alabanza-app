import {
  AlertTriangle,
  CheckCircle2,
  Guitar,
  Mic,
  MicOff,
  ShieldCheck,
} from 'lucide-react';
import {
  CHROMATIC_NOTE_NAMES,
  detectPitchYin,
  frequencyToPitchReading,
  getScalePitchClasses,
  getSmartTunerScale,
  isPitchClassInScale,
  NOTE_NAMES_ES,
  SMART_TUNER_SCALES,
  type PitchReading,
  type SmartTunerScaleId,
} from '../../utils/smartTuner';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type TunerStatus = 'idle' | 'requesting' | 'listening' | 'error';
type TunerMode = 'voice' | 'instrument';
type WindowWithWebkitAudio = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

const STORAGE_KEY = 'redil-smart-tuner-settings-v1';
const TUNER_MODE_SETTINGS = {
  voice: {
    analysisIntervalMs: 82,
    centeredCents: 12,
    frequencyHistorySize: 7,
    minClarity: 0.52,
    noteSwitchFrames: 3,
    signalHoldMs: 680,
    detection: {
      minFrequency: 75,
      maxFrequency: 1200,
      minRms: 0.006,
      threshold: 0.18,
    },
  },
  instrument: {
    analysisIntervalMs: 55,
    centeredCents: 5,
    frequencyHistorySize: 4,
    minClarity: 0.62,
    noteSwitchFrames: 1,
    signalHoldMs: 420,
    detection: {
      minFrequency: 65,
      maxFrequency: 1200,
      minRms: 0.01,
      threshold: 0.14,
    },
  },
} as const;

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const microphoneErrorMessage = (error: unknown) => {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'El micrófono está bloqueado. Permítelo en la configuración del navegador y vuelve a intentar.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No encontramos un micrófono disponible en este dispositivo.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Otro proceso está usando el micrófono. Ciérralo y vuelve a intentar.';
  }
  return 'No pudimos iniciar el afinador. Revisa el permiso del micrófono e inténtalo otra vez.';
};

export default function SmartTuner() {
  const [status, setStatus] = useState<TunerStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [rootPitchClass, setRootPitchClass] = useState(0);
  const [scaleId, setScaleId] = useState<SmartTunerScaleId>('major');
  const [tunerMode, setTunerMode] = useState<TunerMode>('voice');
  const [reading, setReading] = useState<PitchReading | null>(null);
  const [clarity, setClarity] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sessionRef = useRef(0);
  const lastAnalysisAtRef = useRef(0);
  const lastSignalAtRef = useRef(0);
  const frequencyHistoryRef = useRef<number[]>([]);
  const tunerModeRef = useRef<TunerMode>('voice');
  const displayedReadingRef = useRef<PitchReading | null>(null);
  const pendingNoteSwitchRef = useRef<{ pitchClass: number; frames: number } | null>(null);

  const selectedScale = useMemo(() => getSmartTunerScale(scaleId), [scaleId]);
  const activeModeSettings = TUNER_MODE_SETTINGS[tunerMode];
  const scalePitchClasses = useMemo(
    () => getScalePitchClasses(rootPitchClass, scaleId),
    [rootPitchClass, scaleId],
  );
  const isInScale = reading
    ? isPitchClassInScale(reading.pitchClass, rootPitchClass, scaleId)
    : null;
  const isCentered = reading
    ? Math.abs(reading.cents) <= activeModeSettings.centeredCents
    : false;
  const centsPosition = reading
    ? Math.max(0, Math.min(100, reading.cents + 50))
    : 50;

  const releaseAudio = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close().catch(() => undefined);

    sourceRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    frequencyHistoryRef.current = [];
    displayedReadingRef.current = null;
    pendingNoteSwitchRef.current = null;
    lastAnalysisAtRef.current = 0;
    lastSignalAtRef.current = 0;
  }, []);

  const stopListening = useCallback(() => {
    sessionRef.current += 1;
    releaseAudio();
    setStatus('idle');
    setReading(null);
    setClarity(0);
    setErrorMessage('');
  }, [releaseAudio]);

  const startListening = useCallback(async () => {
    releaseAudio();
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    setStatus('requesting');
    setReading(null);
    setClarity(0);
    setErrorMessage('');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('Microphone unavailable', 'NotFoundError');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
        },
        video: false,
      });

      if (sessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const browserWindow = window as WindowWithWebkitAudio;
      const AudioContextConstructor = browserWindow.AudioContext || browserWindow.webkitAudioContext;
      if (!AudioContextConstructor) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('AudioContext unavailable');
      }

      let audioContext: AudioContext;
      try {
        audioContext = new AudioContextConstructor({ latencyHint: 'interactive' });
      } catch {
        audioContext = new AudioContextConstructor();
      }
      if (audioContext.state === 'suspended') await audioContext.resume();

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      analyserRef.current = analyser;
      lastSignalAtRef.current = performance.now();
      setStatus('listening');

      const samples = new Float32Array(analyser.fftSize);
      const analyze = (timestamp: number) => {
        if (sessionRef.current !== session) return;
        animationFrameRef.current = window.requestAnimationFrame(analyze);
        const modeSettings = TUNER_MODE_SETTINGS[tunerModeRef.current];
        if (timestamp - lastAnalysisAtRef.current < modeSettings.analysisIntervalMs) return;
        lastAnalysisAtRef.current = timestamp;

        analyser.getFloatTimeDomainData(samples);
        const detected = detectPitchYin(
          samples,
          audioContext.sampleRate,
          modeSettings.detection,
        );

        if (detected && detected.clarity >= modeSettings.minClarity) {
          const rawReading = frequencyToPitchReading(detected.frequency);
          if (rawReading) {
            const history = frequencyHistoryRef.current;
            const lastFrequency = history[history.length - 1];
            const lastPitch = lastFrequency ? frequencyToPitchReading(lastFrequency) : null;
            if (lastPitch && Math.abs(lastPitch.midiFloat - rawReading.midiFloat) > 0.8) {
              history.length = 0;
            }
            history.push(detected.frequency);
            if (history.length > modeSettings.frequencyHistorySize) history.shift();

            const stableReading = frequencyToPitchReading(median(history));
            if (stableReading) {
              lastSignalAtRef.current = timestamp;
              const displayedReading = displayedReadingRef.current;
              const changesNote = displayedReading
                && displayedReading.pitchClass !== stableReading.pitchClass;

              if (changesNote) {
                const pendingSwitch = pendingNoteSwitchRef.current;
                const nextFrames = pendingSwitch?.pitchClass === stableReading.pitchClass
                  ? pendingSwitch.frames + 1
                  : 1;
                pendingNoteSwitchRef.current = {
                  pitchClass: stableReading.pitchClass,
                  frames: nextFrames,
                };
                if (nextFrames < modeSettings.noteSwitchFrames) return;
              }

              pendingNoteSwitchRef.current = null;
              displayedReadingRef.current = stableReading;
              setReading(stableReading);
              setClarity(detected.clarity);
            }
          }
          return;
        }

        if (timestamp - lastSignalAtRef.current >= modeSettings.signalHoldMs) {
          frequencyHistoryRef.current = [];
          displayedReadingRef.current = null;
          pendingNoteSwitchRef.current = null;
          setReading(null);
          setClarity(0);
        }
      };

      animationFrameRef.current = window.requestAnimationFrame(analyze);
    } catch (error) {
      if (sessionRef.current !== session) return;
      releaseAudio();
      setStatus('error');
      setErrorMessage(microphoneErrorMessage(error));
    }
  }, [releaseAudio]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
      const savedRoot = Number(saved?.rootPitchClass);
      const savedScale = String(saved?.scaleId || '');
      const savedMode = String(saved?.tunerMode || '');
      if (Number.isInteger(savedRoot) && savedRoot >= 0 && savedRoot <= 11) {
        setRootPitchClass(savedRoot);
      }
      if (SMART_TUNER_SCALES.some((scale) => scale.id === savedScale)) {
        setScaleId(savedScale as SmartTunerScaleId);
      }
      if (savedMode === 'voice' || savedMode === 'instrument') {
        setTunerMode(savedMode);
      }
    } catch {
      // Los valores predeterminados son una recuperación segura.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ rootPitchClass, scaleId, tunerMode }),
      );
    } catch {
      // El afinador sigue funcionando aunque el navegador bloquee el almacenamiento.
    }
  }, [rootPitchClass, scaleId, tunerMode]);

  useEffect(() => {
    tunerModeRef.current = tunerMode;
    frequencyHistoryRef.current = [];
    displayedReadingRef.current = null;
    pendingNoteSwitchRef.current = null;
    setReading(null);
    setClarity(0);
  }, [tunerMode]);

  useEffect(() => {
    const releaseOnPageExit = () => {
      sessionRef.current += 1;
      releaseAudio();
    };
    window.addEventListener('pagehide', releaseOnPageExit);
    document.addEventListener('astro:before-swap', releaseOnPageExit);
    return () => {
      window.removeEventListener('pagehide', releaseOnPageExit);
      document.removeEventListener('astro:before-swap', releaseOnPageExit);
      releaseOnPageExit();
    };
  }, [releaseAudio]);

  const stateClasses = reading
    ? isInScale
      ? 'border-emerald-500/35 bg-emerald-500/[0.045]'
      : 'border-rose-500/35 bg-rose-500/[0.045]'
    : 'border-border bg-background/70';
  const noteClasses = reading
    ? isInScale ? 'text-emerald-500' : 'text-rose-400'
    : 'text-content-muted';

  const guidance = !reading
    ? 'Toca o canta una nota sostenida'
    : !isInScale
      ? tunerMode === 'voice'
        ? `Nota estable fuera de ${CHROMATIC_NOTE_NAMES[rootPitchClass]} ${selectedScale.label}`
        : `Fuera de ${CHROMATIC_NOTE_NAMES[rootPitchClass]} ${selectedScale.label}`
      : isCentered
        ? tunerMode === 'voice' ? 'Voz centrada' : 'Afinado'
        : reading.cents < 0
          ? `${tunerMode === 'voice' ? 'Sube suavemente' : 'Sube'} ${Math.abs(Math.round(reading.cents))} cents`
          : `${tunerMode === 'voice' ? 'Baja suavemente' : 'Baja'} ${Math.abs(Math.round(reading.cents))} cents`;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-32 md:pb-16">
      <section className="overflow-hidden rounded-[2rem] border border-border bg-surface shadow-xl">
        <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
          <div className="p-4 sm:p-6 lg:p-8">
            <div className={`relative overflow-hidden rounded-[1.75rem] border p-5 transition-colors duration-300 sm:p-7 ${stateClasses}`}>
              <div className="mb-4 flex min-h-7 items-center justify-between gap-3">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-content-muted">
                  {status === 'listening'
                    ? tunerMode === 'voice' ? 'Escuchando voz' : 'Escuchando instrumento'
                    : tunerMode === 'voice' ? 'Modo voz' : 'Modo instrumento'}
                </span>
                {reading && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                    isInScale
                      ? 'bg-emerald-500/15 text-emerald-500'
                      : 'bg-rose-500/10 text-rose-400'
                  }`}>
                    {isInScale ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    {isInScale ? 'En la escala' : 'Fuera de escala'}
                  </span>
                )}
              </div>

              <div className="flex min-h-48 flex-col items-center justify-center text-center sm:min-h-56">
                <div className={`flex items-baseline justify-center transition-colors duration-200 ${noteClasses}`}>
                  <span className="text-[6.4rem] font-black leading-none tracking-[-0.08em] sm:text-[8rem]">
                    {reading?.noteName || '—'}
                  </span>
                  {reading && (
                    <span className="ml-2 text-3xl font-black sm:text-4xl">{reading.octave}</span>
                  )}
                </div>
                <p className="mt-2 min-h-7 text-lg font-bold text-content">
                  {reading ? reading.noteNameEs : 'Esperando señal'}
                </p>
                <p
                  className={`mt-2 min-h-6 text-sm font-bold ${
                    reading && !isInScale
                      ? 'text-rose-400'
                      : reading && isCentered
                        ? 'text-emerald-500'
                        : 'text-content-muted'
                  }`}
                  aria-live="polite"
                >
                  {guidance}
                </p>
              </div>

              <div className="mt-4">
                <div className="relative h-16" aria-label={reading ? `${Math.round(reading.cents)} cents` : 'Sin nota detectada'}>
                  <div className="absolute left-0 right-0 top-7 h-1 rounded-full bg-border">
                    <div className="absolute left-1/2 top-[-7px] h-[18px] w-0.5 -translate-x-1/2 rounded-full bg-content" />
                    {[-50, -25, 25, 50].map((mark) => (
                      <span
                        key={mark}
                        className="absolute top-[-3px] h-[10px] w-px bg-content-muted/45"
                        style={{ left: `${mark + 50}%` }}
                      />
                    ))}
                    {reading && (
                      <span
                        className={`absolute top-1/2 h-9 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg transition-[left] duration-150 ${
                          isCentered ? 'bg-emerald-500' : isInScale ? 'bg-amber-500' : 'bg-rose-400'
                        }`}
                        style={{ left: `${centsPosition}%` }}
                      />
                    )}
                  </div>
                  <div className="absolute inset-x-0 top-11 flex justify-between text-[10px] font-bold text-content-muted">
                    <span>-50</span>
                    <span>-25</span>
                    <span>0</span>
                    <span>+25</span>
                    <span>+50</span>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-border bg-surface/80 px-3 py-2.5 text-center">
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-content-muted">Frecuencia</span>
                    <strong className="mt-1 block text-base text-content">
                      {reading ? `${reading.frequency.toFixed(1)} Hz` : '—'}
                    </strong>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface/80 px-3 py-2.5 text-center">
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-content-muted">Precisión</span>
                    <strong className="mt-1 block text-base text-content">
                      {reading ? `${Math.round(clarity * 100)}%` : '—'}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={status === 'listening' ? stopListening : startListening}
              disabled={status === 'requesting'}
              aria-pressed={status === 'listening'}
              className={`mt-5 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-base font-black text-white shadow-lg transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-wait disabled:opacity-70 ${
                status === 'listening'
                  ? 'bg-red-600 hover:bg-red-500 focus-visible:ring-red-500'
                  : 'bg-action hover:bg-action/90 focus-visible:ring-action'
              }`}
            >
              {status === 'listening' ? <MicOff size={22} /> : <Mic size={22} />}
              {status === 'requesting'
                ? 'Abriendo micrófono…'
                : status === 'listening'
                  ? 'Detener afinador'
                  : 'Iniciar afinador'}
            </button>

            {status === 'error' && (
              <div className="mt-4 flex gap-3 rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-sm font-semibold leading-5 text-red-500" role="alert">
                <AlertTriangle className="mt-0.5 shrink-0" size={19} />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          <aside className="border-t border-border bg-background/45 p-5 sm:p-6 lg:border-l lg:border-t-0 lg:p-7" aria-label="Configuración de escala">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-content-muted">Escala objetivo</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-content">
                {CHROMATIC_NOTE_NAMES[rootPitchClass]} {selectedScale.label}
              </h2>
              <p className="mt-2 text-sm leading-6 text-content-muted">
                Verde dentro de la escala. Rojo solo cuando una nota fuera de ella se mantiene estable.
              </p>
            </div>

            <fieldset className="mt-6">
              <legend className="text-xs font-bold text-content-muted">Respuesta del afinador</legend>
              <div className="mt-2 grid grid-cols-2 rounded-2xl border border-border bg-surface p-1" role="radiogroup" aria-label="Respuesta del afinador">
                <button
                  type="button"
                  role="radio"
                  aria-checked={tunerMode === 'voice'}
                  onClick={() => setTunerMode('voice')}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/50 ${
                    tunerMode === 'voice'
                      ? 'bg-action text-white shadow-sm'
                      : 'text-content-muted hover:text-content'
                  }`}
                >
                  <Mic size={17} />
                  Voz
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={tunerMode === 'instrument'}
                  onClick={() => setTunerMode('instrument')}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/50 ${
                    tunerMode === 'instrument'
                      ? 'bg-action text-white shadow-sm'
                      : 'text-content-muted hover:text-content'
                  }`}
                >
                  <Guitar size={17} />
                  Instrumento
                </button>
              </div>
              <p className="mt-2 text-xs leading-5 text-content-muted">
                {tunerMode === 'voice'
                  ? 'Suaviza el vibrato y espera antes de marcar las notas de paso.'
                  : 'Respuesta rápida y tolerancia precisa para cuerdas e instrumentos.'}
              </p>
            </fieldset>

            <div className="mt-6 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3">
              <label className="min-w-0">
                <span className="mb-2 block text-xs font-bold text-content-muted">Tónica</span>
                <select
                  value={rootPitchClass}
                  onChange={(event) => setRootPitchClass(Number(event.target.value))}
                  className="min-h-12 w-full rounded-xl border border-border bg-surface px-3 text-base font-bold text-content outline-none transition focus:border-action focus:ring-2 focus:ring-action/25"
                >
                  {CHROMATIC_NOTE_NAMES.map((noteName, index) => (
                    <option key={noteName} value={index}>
                      {noteName} · {NOTE_NAMES_ES[index]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="min-w-0">
                <span className="mb-2 block text-xs font-bold text-content-muted">Tipo</span>
                <select
                  value={scaleId}
                  onChange={(event) => setScaleId(event.target.value as SmartTunerScaleId)}
                  className="min-h-12 w-full rounded-xl border border-border bg-surface px-3 text-base font-bold text-content outline-none transition focus:border-action focus:ring-2 focus:ring-action/25"
                >
                  {SMART_TUNER_SCALES.map((scale) => (
                    <option key={scale.id} value={scale.id}>{scale.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-6">
              <span className="text-xs font-bold text-content-muted">Notas permitidas</span>
              <div className="mt-3 flex flex-wrap gap-2" aria-label={`Notas de ${CHROMATIC_NOTE_NAMES[rootPitchClass]} ${selectedScale.label}`}>
                {scalePitchClasses.map((pitchClass) => {
                  const isActive = reading?.pitchClass === pitchClass;
                  return (
                    <span
                      key={pitchClass}
                      className={`flex min-h-10 min-w-10 items-center justify-center rounded-xl border px-3 text-sm font-black transition-colors ${
                        isActive
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-border bg-surface text-content'
                      }`}
                    >
                      {CHROMATIC_NOTE_NAMES[pitchClass]}
                    </span>
                  );
                })}
              </div>
              {reading && !isInScale && (
                <p className="mt-3 inline-flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.08] px-3 py-2 text-sm font-bold text-rose-400">
                  <AlertTriangle size={16} />
                  Detectada: {reading.noteName}
                </p>
              )}
            </div>

            <div className="mt-7 rounded-2xl border border-border bg-surface/70 p-4">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 shrink-0 text-emerald-500" size={20} />
                <div>
                  <h3 className="text-sm font-black text-content">Audio privado</h3>
                  <p className="mt-1 text-xs leading-5 text-content-muted">
                    La voz o el instrumento se analiza en este dispositivo. No se graba ni se envía.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
