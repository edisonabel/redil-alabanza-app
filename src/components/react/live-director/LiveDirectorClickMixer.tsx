import { useEffect, useMemo, useRef, useState } from 'react';
import { ChannelStrip } from './ChannelStrip';
import { CLICK_LAYERS, normalizeGeneratedClick, type GeneratedClickSettings } from '../../../utils/liveDirectorGeneratedClick';

type Props = {
  open: boolean; onClose: () => void; trackId: string; bpm: number; originSeconds: number;
  ready: boolean; playing: boolean; busy: boolean;
  loadSamples: () => Promise<void>;
  onConfigure: (trackId: string, settings: GeneratedClickSettings | null) => boolean;
};
export function LiveDirectorClickMixer(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bpm, setBpm] = useState(props.bpm);
  const [origin, setOrigin] = useState(props.originSeconds);
  const [numerator, setNumerator] = useState(4);
  const [denominator, setDenominator] = useState(4);
  const [accentConfirmed, setAccentConfirmed] = useState(false);
  const [levels, setLevels] = useState([.65, 0, .7, .35, 0]);
  const [muted, setMuted] = useState<boolean[]>([]);
  const [solo, setSolo] = useState<boolean[]>([]);
  const hasSolo = solo.some(Boolean);
  const settings = useMemo(() => normalizeGeneratedClick({ bpm, originSeconds: origin, numerator, denominator, accentConfirmed,
    levels: levels.map((value, index) => muted[index] || (hasSolo && !solo[index]) ? 0 : value) as GeneratedClickSettings['levels'],
  }), [bpm, origin, numerator, denominator, accentConfirmed, levels, muted, hasSolo, solo]);
  const gridLocked = props.playing || props.busy || loading || !props.ready;
  useEffect(() => {
    if (props.open && !dialog.current?.open) dialog.current?.showModal();
    if (!props.open && dialog.current?.open) dialog.current?.close();
  }, [props.open]);
  useEffect(() => { if (!props.ready) { generation.current++; setEnabled(false); setLoading(false); } }, [props.ready]);
  useEffect(() => { if (!settings) setEnabled(false); }, [settings]);
  useEffect(() => { if (props.playing && loading) { generation.current++; setLoading(false); } }, [props.playing, loading]);
  useEffect(() => {
    props.onConfigure(props.trackId, enabled && settings ? settings : null);
  }, [props.onConfigure, props.trackId, enabled, settings]);
  useEffect(() => () => {
    generation.current++;
    props.onConfigure(props.trackId, null);
  }, [props.onConfigure, props.trackId]);
  const enable = async () => {
    if (gridLocked || !settings || enabled) return;
    const token = ++generation.current;
    setLoading(true); setError('');
    try {
      await props.loadSamples();
      if (generation.current === token) {
        if (!props.onConfigure(props.trackId, settings)) throw new Error('El motor no está disponible. Se conserva el click grabado.');
        setEnabled(true);
      }
    } catch (error) {
      if (generation.current === token) setError(error instanceof Error ? error.message : 'No se pudo preparar el metrónomo.');
    } finally { if (generation.current === token) setLoading(false); }
  };
  const changeGrid = (update: () => void) => { update(); setAccentConfirmed(false); };
  const controlClass = 'min-h-10 rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-40';
  return <dialog ref={dialog} onClose={props.onClose} aria-labelledby="ld-click-title"
    className="m-auto w-[min(850px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl border border-white/15 bg-[#202426] p-4 text-white shadow-2xl backdrop:bg-black/70">
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-[#202426] pb-1">
      <h2 id="ld-click-title" className="text-lg font-semibold">Metrónomo · Click</h2>
      <button type="button" className={controlClass} onClick={() => dialog.current?.close()} aria-label="Cerrar metrónomo">Cerrar</button>
    </header>
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Fuente del click">
      <button type="button" className={`${controlClass} ${!enabled ? 'border-cyan-200/60 bg-cyan-300/15' : ''}`} aria-pressed={!enabled} disabled={gridLocked}
        onClick={() => { generation.current++; setEnabled(false); setError(''); }}>Click grabado</button>
      <button type="button" className={`${controlClass} ${enabled ? 'border-cyan-200/60 bg-cyan-300/15' : ''}`} aria-pressed={enabled}
        disabled={gridLocked || !settings} onClick={() => { void enable(); }}>{loading ? 'Preparando sonidos…' : 'Click generado'}</button>
      <span className="text-xs text-white/60">{props.playing ? 'Pausa para cambiar la fuente o el mapa.' : 'Los faders se pueden ajustar durante la reproducción.'}</span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1.3fr_1fr]">
      <label className="grid gap-1 text-xs text-white/70">BPM · negras
        <input className={`${controlClass} w-full`} aria-label="BPM del click generado" type="number" min="30" max="300" step="0.001" value={bpm} disabled={gridLocked}
          onChange={event => changeGrid(() => setBpm(event.target.valueAsNumber || 0))} />
      </label>
      <label className="grid gap-1 text-xs text-white/70">Pulso de referencia · segundos
        <input className={`${controlClass} w-full`} aria-label="Pulso de referencia del click" type="number" min="0" step="0.001" value={origin} disabled={gridLocked}
          onChange={event => changeGrid(() => setOrigin(event.target.valueAsNumber || 0))} />
      </label>
      <div className="grid gap-1 text-xs text-white/70"><span>Compás para el acento</span><div className="flex items-center gap-1">
        <input className={`${controlClass} w-16`} type="number" min="1" max="16" step="1" aria-label="Numerador del compás" value={numerator} disabled={gridLocked}
          onChange={event => changeGrid(() => setNumerator(event.target.valueAsNumber || 0))} /><span>/</span>
        <select className={`${controlClass} min-w-16`} aria-label="Denominador del compás" value={denominator} disabled={gridLocked}
          onChange={event => changeGrid(() => setDenominator(Number(event.target.value)))}>{[2, 4, 8, 16].map(value => <option key={value} value={value}>{value}</option>)}</select>
      </div></div>
    </div>
    <label className="mt-3 flex min-h-10 items-center gap-2 text-xs text-white/75">
      <input type="checkbox" checked={accentConfirmed} disabled={gridLocked || !settings} className="h-4 w-4 accent-cyan-200"
        onChange={event => setAccentConfirmed(event.target.checked)} />El pulso de referencia es el «uno» y el compás está confirmado.
    </label>
    <p className="mt-1 text-xs text-white/55">Tempo constante. Si la canción cambia de tempo o compás, conserva el click grabado. Ajustes locales de esta prueba.</p>
    <div role="status" className="mt-2 min-h-5 text-xs text-amber-100">{error || (!settings ? 'Revisa el tempo, el pulso y el compás antes de activar.' : !accentConfirmed ? 'Acento desactivado hasta confirmar el compás.' : '')}</div>
    <div className="mt-2 grid h-[clamp(240px,40dvh,380px)] grid-cols-[repeat(5,minmax(112px,1fr))] gap-2 overflow-x-auto" data-live-director-mixer-scroll="true">
      {CLICK_LAYERS.map((layer, index) => <ChannelStrip key={layer.id} id={`click-${layer.id}`} label={layer.label} shortLabel={layer.shortLabel}
        accent={layer.accent} volume={levels[index]} level={0} isPlaying={props.playing && enabled}
        muted={Boolean(muted[index])} soloed={Boolean(solo[index])} dimmed={hasSolo && !solo[index]} compact
        disabled={!props.ready || props.busy || (index === 0 && !accentConfirmed)}
        disabledReason={index === 0 && !accentConfirmed ? 'Confirma el compás' : undefined}
        onVolumeChange={value => setLevels(previous => previous.map((level, i) => i === index ? value : level))}
        onMute={() => setMuted(previous => Array.from({ length: 5 }, (_, i) => i === index ? !previous[i] : Boolean(previous[i])))}
        onSolo={() => setSolo(previous => Array.from({ length: 5 }, (_, i) => i === index ? !previous[i] : Boolean(previous[i])))} />)}
    </div>
    <p className="mt-2 text-xs text-white/55">Click controla el volumen y la salida de todas las capas. Corcheas y semicorcheas añaden los pulsos intermedios.</p>
  </dialog>;
}
