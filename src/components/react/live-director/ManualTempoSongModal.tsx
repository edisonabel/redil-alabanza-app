import { useEffect, useMemo, useRef, useState } from 'react';
import { Music2, Plus, X } from 'lucide-react';
import {
  LIVE_DIRECTOR_KEY_OPTIONS,
  LIVE_DIRECTOR_METER_OPTIONS,
  LIVE_DIRECTOR_SUBDIVISION_OPTIONS,
  type LiveDirectorManualSongInput,
  type LiveDirectorManualSubdivision,
} from '../../../utils/liveDirectorManualSongs';
import { getPadUrlForSongKey } from '../../../utils/padAudio';

type ManualTempoSongModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: LiveDirectorManualSongInput) => void;
};

const DEFAULT_METER = LIVE_DIRECTOR_METER_OPTIONS.find((option) => option.value === '4/4')
  || LIVE_DIRECTOR_METER_OPTIONS[0];

export function ManualTempoSongModal({
  open,
  onClose,
  onSubmit,
}: ManualTempoSongModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const tapTimesRef = useRef<number[]>([]);
  const [title, setTitle] = useState('');
  const [bpm, setBpm] = useState(120);
  const [meterValue, setMeterValue] = useState(DEFAULT_METER.value);
  const [subdivision, setSubdivision] = useState<LiveDirectorManualSubdivision>('quarter');
  const [songKey, setSongKey] = useState('C');
  const [error, setError] = useState('');

  const selectedMeter = useMemo(
    () => LIVE_DIRECTOR_METER_OPTIONS.find((option) => option.value === meterValue) || DEFAULT_METER,
    [meterValue],
  );

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setTitle('');
    setBpm(120);
    setMeterValue(DEFAULT_METER.value);
    setSubdivision('quarter');
    setSongKey('C');
    setError('');
    tapTimesRef.current = [];

    const timeoutId = window.setTimeout(() => titleInputRef.current?.focus(), 40);
    return () => {
      window.clearTimeout(timeoutId);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusableElements = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => !element.hasAttribute('hidden'));
        const firstElement = focusableElements[0];
        const lastElement = focusableElements.at(-1);

        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const handleTapTempo = () => {
    const now = performance.now();
    const previousTap = tapTimesRef.current.at(-1);

    if (previousTap && now - previousTap > 2500) {
      tapTimesRef.current = [];
    }

    tapTimesRef.current.push(now);
    tapTimesRef.current = tapTimesRef.current.slice(-6);

    if (tapTimesRef.current.length < 2) return;

    const intervals = tapTimesRef.current
      .slice(1)
      .map((time, index) => time - tapTimesRef.current[index])
      .filter((interval) => interval >= 200 && interval <= 2000);

    if (intervals.length === 0) return;
    const average = intervals.reduce((total, interval) => total + interval, 0) / intervals.length;
    setBpm(Math.max(30, Math.min(300, Math.round(60000 / average))));
  };

  const handleSubmit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const safeBpm = Math.round(Number(bpm));

    if (!cleanTitle) {
      setError('Escribe un nombre corto para la canción.');
      titleInputRef.current?.focus();
      return;
    }
    if (!Number.isFinite(safeBpm) || safeBpm < 30 || safeBpm > 300) {
      setError('El BPM debe estar entre 30 y 300.');
      return;
    }
    if (!getPadUrlForSongKey(songKey)) {
      setError('No hay un pad disponible para ese tono.');
      return;
    }

    onSubmit({
      title: cleanTitle,
      bpm: safeBpm,
      key: songKey,
      meter: {
        numerator: selectedMeter.numerator,
        denominator: selectedMeter.denominator,
      },
      subdivision,
    });
  };

  const fieldClass =
    'h-11 w-full rounded-xl border border-white/10 bg-black/28 px-3 text-sm text-white outline-none transition focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/10';

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/72 p-3 backdrop-blur-md sm:p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-[1.7rem] border border-white/12 bg-[linear-gradient(180deg,rgba(27,29,31,0.99),rgba(16,18,20,0.99))] text-white shadow-[0_30px_90px_rgba(0,0,0,0.56)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-tempo-title"
      >
        <div className="flex items-center justify-between px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-100">
              <Music2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="manual-tempo-title" className="truncate text-lg font-semibold tracking-tight">
                Añadir click + pad
              </h2>
              <p className="text-xs text-white/48">Una canción rápida sin stems.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white/58 transition hover:bg-white/7 hover:text-white"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="border-t border-white/7 px-5 py-5 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-[0.68rem] font-medium uppercase tracking-[0.16em] text-white/52">
                Nombre
              </span>
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setError('');
                }}
                maxLength={72}
                placeholder="Nombre de la canción"
                className={fieldClass}
              />
            </label>

            <div>
              <span className="mb-1.5 block text-[0.68rem] font-medium uppercase tracking-[0.16em] text-white/52">
                Tempo
              </span>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="relative">
                  <input
                    type="number"
                    min={30}
                    max={300}
                    inputMode="numeric"
                    value={bpm}
                    onChange={(event) => {
                      setBpm(Number(event.target.value));
                      setError('');
                    }}
                    className={`${fieldClass} pr-14 tabular-nums`}
                    aria-label="Tempo en BPM"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.62rem] tracking-[0.12em] text-white/38">
                    BPM
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleTapTempo}
                  className="h-11 min-w-16 rounded-xl bg-cyan-300/10 px-3 text-xs font-semibold tracking-[0.12em] text-cyan-100 transition active:scale-[0.97]"
                >
                  TAP
                </button>
              </div>
            </div>

            <label>
              <span className="mb-1.5 block text-[0.68rem] font-medium uppercase tracking-[0.16em] text-white/52">
                Compás
              </span>
              <select
                value={meterValue}
                onChange={(event) => setMeterValue(event.target.value as typeof meterValue)}
                className={fieldClass}
              >
                {LIVE_DIRECTOR_METER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <fieldset>
              <legend className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-white/52">
                Pulso
              </legend>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/28 p-1">
                {LIVE_DIRECTOR_SUBDIVISION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSubdivision(option.value)}
                    className={`min-h-9 rounded-lg px-2 text-[0.7rem] transition ${subdivision === option.value
                      ? 'bg-white/12 text-white'
                      : 'text-white/46 hover:text-white/72'
                    }`}
                    aria-pressed={subdivision === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label>
              <span className="mb-1.5 block text-[0.68rem] font-medium uppercase tracking-[0.16em] text-white/52">
                Tono del pad
              </span>
              <select
                value={songKey}
                onChange={(event) => {
                  setSongKey(event.target.value);
                  setError('');
                }}
                className={fieldClass}
              >
                {LIVE_DIRECTOR_KEY_OPTIONS.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p className="mt-4 text-sm text-rose-200" role="alert">{error}</p>
          )}

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/7 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="h-11 rounded-xl px-4 text-sm text-white/58 transition hover:bg-white/6 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex h-11 items-center gap-2 rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-[#102025] transition hover:bg-cyan-200 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              Añadir
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
