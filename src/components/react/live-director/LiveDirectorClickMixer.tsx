import { useEffect, useMemo, useRef, useState } from 'react';
import { ChannelStrip } from './ChannelStrip';
import { CLICK_LAYERS, normalizeGeneratedClick, type GeneratedClickSettings } from '../../../utils/liveDirectorGeneratedClick';
import type { ClickPreference } from '../../../utils/liveDirectorClickPreference';

type Props = {
  open: boolean; onClose: () => void;
  onConfirmedMeter?: (meter: { numerator: number; denominator: number } | null) => void; trackId: string; bpm: number; originSeconds: number;
  ready: boolean; playing: boolean; busy: boolean;
  /** Compás de la canción; con REAPER el «uno» y el compás ya están confirmados y el acento suena sin marcar la casilla. */
  meter?: { numerator: number; denominator: number } | null; confirmedByReaper?: boolean;
  loadSamples: () => Promise<void>;
  /** Canción sin stems: no hay click grabado, así que el digital se enciende solo (aunque llegue sonando). */
  forceGenerated?: boolean;
  /** Click digital de una canción sin pista Click: siempre digital, pero las capas y el tempo sí se recuerdan. */
  rememberForced?: boolean;
  onConfigure: (trackId: string, settings: GeneratedClickSettings | null) => boolean;
  /** Lo elegido antes para esta canción: se aplica solo, también al entrar sonando. */
  saved?: ClickPreference | null;
  onPreferenceChange?: (preference: ClickPreference) => void;
  onDigitalChange?: (digital: boolean) => void;
};
export function LiveDirectorClickMixer(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const savedGrid = props.confirmedByReaper ? null : props.saved;
  // Lo que eligió el músico; `enabled` es lo que el motor ya aplicó.
  const [wanted, setWanted] = useState(Boolean(props.forceGenerated || props.saved?.enabled));
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [gridOpen, setGridOpen] = useState(false);
  const [bpm, setBpm] = useState(savedGrid?.bpm ?? props.bpm);
  const [origin, setOrigin] = useState(savedGrid?.originSeconds ?? props.originSeconds);
  const [numerator, setNumerator] = useState(savedGrid?.numerator ?? props.meter?.numerator ?? 4);
  const [denominator, setDenominator] = useState(savedGrid?.denominator ?? props.meter?.denominator ?? 4);
  const [accentConfirmed, setAccentConfirmed] = useState(savedGrid?.accentConfirmed ?? Boolean(props.confirmedByReaper && props.meter));
  const [levels, setLevels] = useState(props.saved?.levels ?? [.65, 0, .7, .35, 0]);
  const [muted, setMuted] = useState<boolean[]>([]);
  const [solo, setSolo] = useState<boolean[]>([]);
  const hasSolo = solo.some(Boolean);
  const settings = useMemo(() => normalizeGeneratedClick({ bpm, originSeconds: origin, numerator, denominator, accentConfirmed,
    levels: levels.map((value, index) => muted[index] || (hasSolo && !solo[index]) ? 0 : value) as GeneratedClickSettings['levels'],
  }), [bpm, origin, numerator, denominator, accentConfirmed, levels, muted, hasSolo, solo]);
  const gridLocked = props.playing || props.busy || loading || !props.ready;
  const meterValid = Boolean(settings);
  useEffect(() => { props.onConfirmedMeter?.(accentConfirmed && meterValid ? { numerator, denominator } : null); }, [accentConfirmed, numerator, denominator, meterValid, props.onConfirmedMeter]);
  useEffect(() => {
    if (props.open && !dialog.current?.open) dialog.current?.showModal();
    if (!props.open && dialog.current?.open) dialog.current?.close();
  }, [props.open]);
  useEffect(() => { if (!props.ready) { generation.current++; setEnabled(false); setLoading(false); } }, [props.ready]);
  useEffect(() => { if (!settings) setEnabled(false); }, [settings]);
  useEffect(() => { props.onDigitalChange?.(enabled); }, [enabled, props.onDigitalChange]);
  // Se guarda solo lo que elige el músico, nunca el apagado momentáneo mientras el motor se prepara.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    if (props.forceGenerated && !props.rememberForced) return;
    props.onPreferenceChange?.({ enabled: wanted, levels, bpm, originSeconds: origin, numerator, denominator, accentConfirmed, updatedAt: Date.now() });
  }, [wanted, levels, bpm, origin, numerator, denominator, accentConfirmed]);
  useEffect(() => {
    props.onConfigure(props.trackId, enabled && settings ? settings : null);
  }, [props.onConfigure, props.trackId, enabled, settings]);
  useEffect(() => () => {
    generation.current++;
    props.onConfigure(props.trackId, null);
  }, [props.onConfigure, props.trackId]);
  const enable = async () => {
    if (!props.ready || !settings || enabled) return;
    const token = ++generation.current;
    setLoading(true); setError('');
    try {
      await props.loadSamples();
      if (generation.current === token) {
        if (!props.onConfigure(props.trackId, settings)) throw new Error('El motor no está disponible. Se conserva el click grabado.');
        setEnabled(true);
      }
    } catch (error) {
      if (generation.current === token) { setWanted(false); setError(error instanceof Error ? error.message : 'No se pudo preparar el metrónomo.'); }
    } finally { if (generation.current === token) setLoading(false); }
  };
  useEffect(() => {
    if (wanted && props.ready && settings && !enabled && !loading && !error) void enable();
  });
  const changeGrid = (update: () => void) => { update(); setAccentConfirmed(false); };
  const sourceClass = 'min-h-16 rounded-xl border px-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50';
  const sourceOn = 'border-cyan-200/70 bg-cyan-300/20 text-white';
  const sourceOff = 'border-white/15 bg-black/25 text-white/70 hover:bg-white/5';
  const controlClass = 'min-h-10 rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-40';
  return <dialog ref={dialog} onClose={props.onClose} aria-labelledby="ld-click-title"
    className="m-auto w-[min(850px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl border border-white/15 bg-[#202426] p-4 text-white shadow-2xl backdrop:bg-black/70">
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-[#202426] pb-1">
      <h2 id="ld-click-title" className="text-lg font-semibold">Metrónomo</h2>
      <button type="button" className={controlClass} onClick={() => dialog.current?.close()} aria-label="Cerrar metrónomo">Cerrar</button>
    </header>
    <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Metrónomo que suena">
      {!props.forceGenerated && <button type="button" aria-pressed={!wanted} disabled={gridLocked}
        className={`${sourceClass} ${!wanted ? sourceOn : sourceOff}`}
        onClick={() => { generation.current++; setWanted(false); setEnabled(false); setError(''); }}>Metrónomo</button>}
      <button type="button" aria-pressed={wanted} disabled={gridLocked || !settings}
        className={`${sourceClass} ${wanted ? sourceOn : sourceOff} ${props.forceGenerated ? 'col-span-2' : ''}`}
        onClick={() => { setError(''); setWanted(true); }}>{loading ? 'Preparando…' : 'Metrónomo digital'}</button>
    </div>
    <div role="status" className="mt-2 min-h-5 text-sm text-amber-100">{error || (!settings ? 'Revisa el tempo y el compás.' : props.playing && !props.forceGenerated ? 'Pausa para cambiarlo.' : '')}</div>
    <details data-click-grid="true" className="mt-1 rounded-lg border border-white/10 bg-black/15 px-3 py-2" open={gridOpen || !settings}
      onToggle={event => setGridOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm text-white/75">Tempo y compás · {bpm} BPM · {numerator}/{denominator}</summary>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1.3fr_1fr]">
        <label className="grid gap-1 text-xs text-white/70">BPM
          <input className={`${controlClass} w-full`} aria-label="BPM del click generado" type="number" min="30" max="300" step="0.001" value={bpm} disabled={gridLocked}
            onChange={event => changeGrid(() => setBpm(event.target.valueAsNumber || 0))} />
        </label>
        <label className="grid gap-1 text-xs text-white/70">Primer pulso (segundos)
          <input className={`${controlClass} w-full`} aria-label="Pulso de referencia del click" type="number" min="0" step="0.001" value={origin} disabled={gridLocked}
            onChange={event => changeGrid(() => setOrigin(event.target.valueAsNumber || 0))} />
        </label>
        <div className="grid gap-1 text-xs text-white/70"><span>Compás</span><div className="flex items-center gap-1">
          <input className={`${controlClass} w-16`} type="number" min="1" max="16" step="1" aria-label="Numerador del compás" value={numerator} disabled={gridLocked}
            onChange={event => changeGrid(() => setNumerator(event.target.valueAsNumber || 0))} /><span>/</span>
          <select className={`${controlClass} min-w-16`} aria-label="Denominador del compás" value={denominator} disabled={gridLocked}
            onChange={event => changeGrid(() => setDenominator(Number(event.target.value)))}>{[2, 4, 8, 16].map(value => <option key={value} value={value}>{value}</option>)}</select>
        </div></div>
      </div>
      <label className="mt-3 flex min-h-10 items-center gap-2 text-sm text-white/75">
        <input type="checkbox" checked={accentConfirmed} disabled={gridLocked || !settings} className="h-4 w-4 accent-cyan-200"
          onChange={event => setAccentConfirmed(event.target.checked)} />El primer pulso es el «uno»: acentuar el compás
      </label>
    </details>
    {wanted && <div className="mt-2 grid h-[clamp(240px,40dvh,380px)] grid-cols-[repeat(5,minmax(112px,1fr))] gap-2 overflow-x-auto" data-live-director-mixer-scroll="true">
      {CLICK_LAYERS.map((layer, index) => <ChannelStrip key={layer.id} id={`click-${layer.id}`} label={layer.label} shortLabel={layer.shortLabel}
        accent={layer.accent} volume={levels[index]} level={0} isPlaying={props.playing && enabled}
        muted={Boolean(muted[index])} soloed={Boolean(solo[index])} dimmed={hasSolo && !solo[index]} compact
        disabled={!props.ready || props.busy || (index === 0 && !accentConfirmed)}
        disabledReason={index === 0 && !accentConfirmed ? 'Confirma el compás' : undefined}
        onVolumeChange={value => setLevels(previous => previous.map((level, i) => i === index ? value : level))}
        onMute={() => setMuted(previous => Array.from({ length: 5 }, (_, i) => i === index ? !previous[i] : Boolean(previous[i])))}
        onSolo={() => setSolo(previous => Array.from({ length: 5 }, (_, i) => i === index ? !previous[i] : Boolean(previous[i])))} />)}
    </div>}
  </dialog>;
}
