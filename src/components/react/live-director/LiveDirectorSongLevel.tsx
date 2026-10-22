import { useEffect, useRef, useState } from 'react';
import type { LiveDirectorLevelMeter } from '../../../services/StreamingMultitrackEngine';
import { nextPeakAttenuation, samplePeakDb } from '../../../utils/liveDirectorPeakLevel';
type Props = { db: number; onChange: (db: number) => void; title: string; disabled: boolean; compact: boolean;
  playing: boolean; getMeter: () => LiveDirectorLevelMeter | null; resetMeter: () => void };
const peakLabel = (peak: number) => peak > .000001 ? `${samplePeakDb(peak).toFixed(1)} dBFS` : '−∞ dBFS';
export function LiveDirectorSongLevel(props: Props) {
  const { db, onChange, title, disabled, compact } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [meter, setMeter] = useState<LiveDirectorLevelMeter | null>(null);
  const [automatic, setAutomatic] = useState(false);
  const current = useRef(props); current.current = props;
  const autoRef = useRef(false); autoRef.current = automatic;
  const settleUntil = useRef(0);
  useEffect(() => { settleUntil.current = performance.now() + 1000; }, [props.playing, disabled]);
  useEffect(() => {
    if (disabled && !props.playing) return;
    const read = () => {
      const p = current.current, next = p.getMeter();
      setMeter(next);
      if (!next || !autoRef.current || !p.playing || p.disabled || performance.now() < settleUntil.current || next.musicAt < 0 || next.audioTime - next.musicAt > .25 || next.audioTime - next.outputAt > .25) return;
      const dbNext = nextPeakAttenuation(p.db, next.musicPeak, next.master);
      if (dbNext < p.db) {
        settleUntil.current = performance.now() + 1000;
        p.onChange(dbNext);
      }
    };
    read(); const timer = setInterval(read, 50); return () => clearInterval(timer);
  }, [disabled, props.playing, props.getMeter]);
  const label = `${db.toFixed(1)} dB`;
  const recent = meter && meter.audioTime - meter.outputAt <= .25;
  const peak = recent ? meter.peak : 0;
  const fill = Math.max(0, Math.min(100, (samplePeakDb(peak) + 60) / 60 * 100));
  const held = meter?.held || 0;
  const color = peak >= 1 ? '#fb7185' : peak >= .708 ? '#fbbf24' : '#7dd3bc';
  return <>
    <div data-live-director-output-meter="true" title={`Pico retenido: ${peakLabel(held)} · Salida digital de stems y guía, después de Master`} className="mt-1 w-full">
      <div role="meter" aria-label="Pico de salida digital" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.max(-60, Math.min(0, samplePeakDb(peak)))} aria-valuetext={peakLabel(peak)} className="h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${fill}%`, background: color }} />
      </div>
      <span data-output-peak-hold={held} className={`block text-[9px] tabular-nums ${held >= 1 ? 'text-rose-300' : 'text-white/45'}`}>{peakLabel(held)}</span>
    </div>
    <button type="button" data-live-director-control="song-level" aria-label="Ajustar nivel de esta canción" aria-haspopup="dialog" title={`Nivel de esta canción: ${label}${automatic ? ' · Auto picos' : ''}`}
      disabled={disabled} onClick={() => dialog.current?.showModal()}
      className={`mt-1 min-h-7 w-full rounded-lg border px-1 text-[9px] font-semibold tracking-wide focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-30 ${db < 0 || automatic ? 'border-cyan-200/30 text-cyan-100' : 'border-white/10 text-white/50 hover:text-white/80'}`}>
      {compact ? automatic ? 'AUTO' : db < 0 ? label : 'NIVEL' : automatic ? `Auto ${label}` : db < 0 ? `Nivel ${label}` : 'Nivel canción'}
    </button>
    <dialog ref={dialog} className="ld-tools" style={{ maxWidth: 440 }} aria-labelledby="ld-song-level-title">
      <header className="ld-tools-header"><h2 id="ld-song-level-title">Nivel de esta canción</h2><button type="button" aria-label="Cerrar nivel de canción" onClick={() => dialog.current?.close()}>Cerrar</button></header>
      <div className="ld-tools-body">
        <p className="truncate" title={title}>{title}</p>
        <p className={held >= 1 ? 'text-rose-300' : 'text-white/65'}>Pico de salida: <output className="tabular-nums">{peakLabel(held)}</output> <button type="button" aria-label="Reiniciar pico retenido" onClick={props.resetMeter}>↺</button></p>
        <label className="grid gap-3 text-sm">Ajuste <output className="text-xl tabular-nums text-cyan-100">{label}</output>
          <input type="range" aria-label="Atenuación de canción en decibelios" min={-24} max={0} step={0.1} value={db} disabled={disabled}
            aria-valuetext={label} onChange={event => { setAutomatic(false); onChange(Number(event.target.value)); }} className="h-10 w-full accent-cyan-200" />
        </label>
        <button type="button" aria-pressed={automatic} aria-label="Ajuste automático por picos" disabled={disabled || !meter} onClick={() => { settleUntil.current = performance.now() + 1000; setAutomatic(previous => !previous); }}>Auto picos · {automatic ? 'Activo' : 'Apagado'}</button>
        <p className="ld-tools-note mt-3">Escucha un tramo fuerte. Auto reduce la música si sus picos superan −6 dBFS después de Master; mantiene la reducción sin subirla en los pasajes suaves. Click y guía conservan su nivel.</p>
        {held >= 1 && <p role="status">La salida alcanzó 0 dBFS. Revisa también los niveles de click y guía.</p>}
        {automatic && db <= -24 && <p role="status">Se alcanzó la reducción máxima de −24 dB.</p>}
        {!meter && <p className="ld-tools-note">Medidor no disponible todavía.</p>}
        <p className="ld-tools-note">Mide picos de muestras, no sonoridad LUFS. El ajuste se conserva por canción en esta pestaña; Auto se desactiva al salir de la canción.</p>
        <button type="button" disabled={disabled || db === 0} onClick={() => { setAutomatic(false); onChange(0); }}>Restaurar 0 dB</button>
      </div>
    </dialog>
  </>;
}
