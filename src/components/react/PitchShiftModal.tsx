import { Loader2, Music2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  NOTE_NAME_LIST,
  formatKeyLabel,
  semitonesBetweenKeys,
  type DetectedKey,
  type KeyMode,
} from '../../utils/pitchShift/keyDetection';

const SEMITONE_RANGE = 12;

type DetectionStatus = 'idle' | 'running' | 'done' | 'failed' | 'unavailable';

export type PitchShiftModalProps = {
  open: boolean;
  semitones: number;
  detectedKey: DetectedKey | null;
  detectionStatus: DetectionStatus;
  onClose: () => void;
  onApply: (semitones: number) => void;
  onRequestRedetect?: () => void;
  onPrewarmEngine?: () => void;
};

const formatSemitoneSummary = (value: number): string => {
  if (value === 0) return 'Sin cambio';
  const sign = value > 0 ? '+' : '';
  const noun = Math.abs(value) === 1 ? 'semitono' : 'semitonos';
  return `${sign}${value} ${noun}`;
};

const STATUS_LABEL: Record<DetectionStatus, string> = {
  idle: 'Detectar tono original',
  running: 'Analizando bajo / piano...',
  done: 'Detección lista',
  failed: 'No se pudo detectar — usa semitonos manuales',
  unavailable: 'Sin stems tonales para analizar',
};

export default function PitchShiftModal({
  open,
  semitones,
  detectedKey,
  detectionStatus,
  onClose,
  onApply,
  onRequestRedetect,
  onPrewarmEngine,
}: PitchShiftModalProps) {
  // We work on a draft so the user can preview different shifts before
  // committing — only `onApply` propagates the change to the parent.
  const [draftSemitones, setDraftSemitones] = useState(semitones);
  const [targetTonic, setTargetTonic] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setDraftSemitones(semitones);
      setTargetTonic(detectedKey ? (detectedKey.tonic + semitones + 12 * 12) % 12 : null);
      onPrewarmEngine?.();
    }
  }, [open, semitones, detectedKey, onPrewarmEngine]);

  const targetKey = useMemo<{ tonic: number; mode: KeyMode } | null>(() => {
    if (!detectedKey) return null;
    const tonic = ((detectedKey.tonic + draftSemitones) % 12 + 12) % 12;
    return { tonic, mode: detectedKey.mode };
  }, [detectedKey, draftSemitones]);

  const handleSemitoneChange = (value: number) => {
    setDraftSemitones(value);
    if (detectedKey) {
      setTargetTonic(((detectedKey.tonic + value) % 12 + 12) % 12);
    }
  };

  const handleTargetTonicChange = (tonic: number) => {
    setTargetTonic(tonic);
    if (detectedKey) {
      const diff = semitonesBetweenKeys(detectedKey.tonic, tonic);
      setDraftSemitones(diff);
    }
  };

  if (!open) return null;

  const confidence = detectedKey?.confidence ?? 0;
  const confidencePct = Math.max(0, Math.min(100, Math.round(((confidence + 1) / 2) * 100)));

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pitch-shift-modal-title"
        className="w-full max-w-xl overflow-hidden rounded-[1.5rem] border border-border bg-surface shadow-2xl"
      >
        <div className="flex flex-col gap-2 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 text-[0.72rem] font-black uppercase tracking-[0.22em] text-brand">
            <Sparkles className="h-3.5 w-3.5" />
            Cambio de tono — Rubberband R3
          </div>
          <h2 id="pitch-shift-modal-title" className="text-2xl font-black tracking-tight text-content">
            Cambia la tonalidad sin tocar el tempo
          </h2>
          <p className="text-sm text-content-muted">
            Motor profesional con preservación de formantes. Procesa cada stem por separado
            para máxima limpieza en voces y acústicas.
          </p>
        </div>

        <div className="space-y-5 px-5 py-5">
          <section className="rounded-2xl border border-border bg-background p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[0.7rem] font-black uppercase tracking-[0.2em] text-content-muted">
                  Tono original detectado
                </p>
                <p className="mt-1 text-2xl font-black text-content">
                  {detectedKey ? detectedKey.label : '—'}
                </p>
                <p className="mt-1 text-xs text-content-muted">
                  {STATUS_LABEL[detectionStatus]}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {detectionStatus === 'running' ? (
                  <Loader2 className="h-5 w-5 animate-spin text-brand" />
                ) : null}
                {onRequestRedetect ? (
                  <button
                    type="button"
                    onClick={onRequestRedetect}
                    disabled={detectionStatus === 'running'}
                    className="ui-pressable-soft inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-surface px-3 text-xs font-bold text-content disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Re-detectar
                  </button>
                ) : null}
              </div>
            </div>
            {detectedKey ? (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[0.65rem] font-bold text-content-muted">
                  <span>Confianza</span>
                  <span>{confidencePct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all ${confidencePct >= 60 ? 'bg-success' : confidencePct >= 35 ? 'bg-brand' : 'bg-warning'}`}
                    style={{ width: `${confidencePct}%` }}
                  />
                </div>
              </div>
            ) : null}
          </section>

          {detectedKey ? (
            <section>
              <p className="mb-2 text-[0.7rem] font-black uppercase tracking-[0.2em] text-content-muted">
                Tono destino
              </p>
              <div className="grid grid-cols-6 gap-1.5 rounded-2xl border border-border bg-background p-1.5 sm:grid-cols-12">
                {NOTE_NAME_LIST.map((name, idx) => {
                  const isSelected = targetTonic === idx;
                  const isOriginal = detectedKey.tonic === idx;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => handleTargetTonicChange(idx)}
                      aria-pressed={isSelected}
                      className={`relative min-h-10 rounded-xl px-1 text-xs font-black transition ${
                        isSelected
                          ? 'bg-brand text-white shadow-md'
                          : 'text-content-muted hover:bg-surface hover:text-content'
                      }`}
                    >
                      {name}
                      {isOriginal ? (
                        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-background" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {targetKey ? (
                <p className="mt-2 text-xs text-content-muted">
                  Tono final: <span className="font-bold text-content">{formatKeyLabel(targetKey.tonic, targetKey.mode)}</span>
                </p>
              ) : null}
            </section>
          ) : null}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[0.7rem] font-black uppercase tracking-[0.2em] text-content-muted">
                Ajuste por semitonos
              </p>
              <span className={`rounded-full border px-2.5 py-1 text-[0.7rem] font-black ${
                draftSemitones === 0
                  ? 'border-border bg-background text-content-muted'
                  : 'border-brand/30 bg-brand/10 text-brand'
              }`}>
                {formatSemitoneSummary(draftSemitones)}
              </span>
            </div>
            <input
              type="range"
              min={-SEMITONE_RANGE}
              max={SEMITONE_RANGE}
              step={1}
              value={draftSemitones}
              onChange={(event) => handleSemitoneChange(Number(event.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-brand dark:bg-white/10"
              aria-label="Cambio de tono en semitonos"
            />
            <div className="mt-1 flex justify-between text-[0.65rem] font-bold text-content-muted">
              <span>−12</span>
              <span>−6</span>
              <span>0</span>
              <span>+6</span>
              <span>+12</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[-5, -3, -2, -1, 0, 1, 2, 3, 5].map((step) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => handleSemitoneChange(step)}
                  className={`min-h-9 rounded-xl border px-3 text-xs font-bold transition ${
                    draftSemitones === step
                      ? 'border-brand bg-brand text-white'
                      : 'border-border bg-background text-content-muted hover:text-content'
                  }`}
                >
                  {formatSemitoneSummary(step)}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-background p-4">
            <p className="text-[0.7rem] font-black uppercase tracking-[0.2em] text-content-muted">
              Calidad
            </p>
            <p className="mt-1 flex items-center gap-2 text-sm font-bold text-content">
              <Music2 className="h-4 w-4 text-brand" />
              Rubberband R3 Finer · Formantes preservados · Offline
            </p>
            <p className="mt-1 text-xs text-content-muted">
              Cada stem se procesa secuencialmente para no compartir CPU. Espera ~2-4×
              el tiempo de la conversión normal por stem.
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={() => onApply(0)}
            className="ui-pressable-soft inline-flex min-h-12 items-center justify-center rounded-2xl border border-border bg-background px-5 font-bold text-content-muted"
          >
            Sin cambio de tono
          </button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onClose}
              className="ui-pressable-soft inline-flex min-h-12 items-center justify-center rounded-2xl border border-border bg-background px-5 font-bold text-content"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onApply(draftSemitones)}
              className="ui-pressable inline-flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-white shadow-lg"
            >
              Aplicar {formatSemitoneSummary(draftSemitones)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
