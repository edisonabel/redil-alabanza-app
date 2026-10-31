import { memo, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Link2, Unlink, X } from 'lucide-react';
import type { PadKey, PadKit } from '../../../utils/padKits';

// Pad Player, como el de Playback: el kit arriba, LINK (el pad sigue la tonalidad de cada canción) y las 12
// tonalidades en dos filas, negras arriba y blancas abajo. Tocar una tonalidad la suena (con fundido) y suelta
// el LINK; tocar la que suena la apaga.
const TOP_ROW: PadKey[] = ['Db', 'Eb', 'Gb', 'Ab', 'Bb', 'B'];
const BOTTOM_ROW: PadKey[] = ['C', 'D', 'E', 'F', 'G', 'A'];

type Props = {
  kits: readonly PadKit[];
  activeKit: PadKit;
  deviceKitId: string;
  songKitId: string | null;
  songTitle: string;
  linked: boolean;
  songKey: PadKey | null;
  selectedKey: PadKey | null;
  playing: boolean;
  notice: string;
  autoEnabled: boolean;
  onToggleAuto: () => void;
  onChooseDeviceKit: (id: string) => void;
  onChooseSongKit: (id: string | null) => void;
  onToggleLink: () => void;
  onPressKey: (key: PadKey) => void;
  onClose: () => void;
};

function KitCover({ kit, className }: { kit: PadKit; className: string }) {
  const [failed, setFailed] = useState(false);
  return kit.cover && !failed
    ? <img src={kit.cover} alt="" draggable={false} onError={() => setFailed(true)} className={`${className} object-cover`} />
    : <span aria-hidden="true" className={`${className} flex items-center justify-center bg-gradient-to-br ${kit.tint} text-[0.7rem] font-black tracking-[0.16em] text-white/90`}>{kit.name.slice(0, 2).toUpperCase()}</span>;
}

function PadPlayerPanel(props: Props) {
  const { kits, activeKit, linked, songKey, selectedKey, playing } = props;
  const [view, setView] = useState<'keys' | 'kits'>('keys');
  const [scope, setScope] = useState<'device' | 'song'>(props.songKitId ? 'song' : 'device');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);

  const keyTile = (key: PadKey) => {
    const sounding = playing && selectedKey === key, isSongKey = songKey === key;
    return (
      <button key={key} type="button" data-pad-key={key} aria-pressed={sounding}
        aria-label={`${sounding ? 'Apagar' : 'Sonar'} pad en ${key}${isSongKey ? ' (tonalidad de la canción)' : ''}`}
        onClick={() => props.onPressKey(key)}
        className={`ui-pressable-soft group relative flex min-h-0 items-center justify-center overflow-hidden rounded-[0.9rem] border text-[clamp(1.05rem,3.2vh,1.7rem)] font-medium tracking-tight transition-colors duration-200 ${sounding
          ? 'border-cyan-200/55 bg-cyan-300/[0.14] text-white shadow-[0_0_32px_rgba(103,232,249,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]'
          : 'border-white/8 bg-[#151718] text-white/62 hover:border-white/16 hover:bg-[#1a1d1f] hover:text-white/85'}`}>
        {sounding && <span aria-hidden="true" className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${activeKit.tint} opacity-25`} />}
        <span className="relative">{key}</span>
        {sounding && <span aria-hidden="true" className="pad-player-wave absolute bottom-2 left-1/2 flex h-3 -translate-x-1/2 items-end gap-[3px]"><span /><span /><span /><span /></span>}
        {isSongKey && !sounding && <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[0.5rem] font-black uppercase tracking-[0.2em] text-emerald-200/70">Canción</span>}
      </button>
    );
  };

  const kitOption = (kit: PadKit) => {
    const chosen = scope === 'device' ? props.deviceKitId === kit.id : props.songKitId === kit.id;
    return (
      <button key={kit.id} type="button" role="radio" aria-checked={chosen} data-pad-kit-option={kit.id}
        onClick={() => { if (scope === 'device') props.onChooseDeviceKit(kit.id); else props.onChooseSongKit(kit.id); }}
        className={`ui-pressable-soft group flex min-w-0 items-center gap-3 rounded-[1rem] border p-2 pr-3 text-left ${chosen ? 'border-cyan-300/50 bg-cyan-300/[0.1]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
        <KitCover kit={kit} className="h-14 w-14 shrink-0 rounded-[0.7rem]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.95rem] font-semibold text-white">{kit.name}</span>
          <span className="block truncate text-[0.74rem] text-white/50">{kit.author}</span>
        </span>
        {chosen && <Check className="h-5 w-5 shrink-0 text-cyan-200" />}
      </button>
    );
  };

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/62 p-3 backdrop-blur-[8px]"
      onPointerDown={event => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Pad Player" data-live-director-pad-player={view}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (view === 'kits') setView('keys'); else props.onClose(); } }}
        className="relative flex h-full max-h-[34rem] w-full max-w-4xl flex-col overflow-hidden rounded-[1.6rem] border border-white/12 bg-[#111314] shadow-[0_32px_80px_rgba(0,0,0,0.5)] outline-none">
        {activeKit.cover && <img src={activeKit.cover} alt="" aria-hidden="true" className="pointer-events-none absolute -inset-10 h-[calc(100%+5rem)] w-[calc(100%+5rem)] scale-110 object-cover opacity-[0.16] blur-3xl" />}
        <div className="relative flex shrink-0 items-stretch gap-2 p-3">
          <button type="button" onClick={() => setView(view === 'kits' ? 'keys' : 'kits')} aria-expanded={view === 'kits'} data-pad-player-control="kit"
            className="ui-pressable-soft flex min-w-0 max-w-[45%] items-center gap-3 rounded-[1rem] border border-white/10 bg-black/30 p-1.5 pr-3 text-left hover:bg-black/40">
            {view === 'kits' ? <ChevronLeft className="ml-1 h-5 w-5 shrink-0 text-white/70" /> : <KitCover kit={activeKit} className="h-10 w-10 shrink-0 rounded-[0.6rem]" />}
            <span className="min-w-0">
              <span className="block truncate text-[0.92rem] font-semibold leading-tight text-white">{view === 'kits' ? 'Volver al pad' : activeKit.name}</span>
              <span className="block truncate text-[0.7rem] text-white/50">{view === 'kits' ? activeKit.name : props.songKitId ? 'Kit de esta canción' : 'Kit del equipo'}</span>
            </span>
            {view === 'keys' && <ChevronRight className="h-4 w-4 shrink-0 text-white/45" />}
          </button>
          <button type="button" onClick={props.onToggleLink} aria-pressed={linked} data-pad-player-control="link"
            title={linked ? 'El pad sigue la tonalidad de cada canción' : 'Tonalidad elegida a mano'}
            className={`ui-pressable-soft flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[1rem] border text-[0.8rem] font-semibold tracking-[0.18em] shadow-[inset_0_2px_10px_rgba(0,0,0,0.45)] ${linked
              ? 'border-emerald-300/25 bg-black/45 text-emerald-300'
              : 'border-white/10 bg-black/35 text-white/40 hover:text-white/65'}`}>
            {linked ? <Link2 className="h-4 w-4 shrink-0" /> : <Unlink className="h-4 w-4 shrink-0" />}
            <span>LINK</span>
            {linked && songKey && <span className="truncate font-medium normal-case tracking-normal text-emerald-200/60">· {songKey}</span>}
          </button>
          <button type="button" onClick={props.onToggleAuto} aria-pressed={props.autoEnabled} data-pad-player-control="auto"
            title={props.autoEnabled ? 'El pad entra solo y muy suave al tocar la secuencia' : 'El pad solo suena si lo prendes'}
            className={`ui-pressable-soft flex w-16 shrink-0 items-center justify-center rounded-[1rem] border text-[0.72rem] font-semibold tracking-[0.14em] ${props.autoEnabled
              ? 'border-cyan-300/40 bg-cyan-300/[0.12] text-cyan-100'
              : 'border-white/10 bg-black/30 text-white/40 hover:text-white/65'}`}>AUTO</button>
          <button type="button" onClick={props.onClose} aria-label="Cerrar Pad Player"
            className="ui-pressable-soft flex w-12 shrink-0 items-center justify-center rounded-[1rem] border border-white/10 bg-black/30 text-white/70 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {view === 'keys' ? (
          <div className="relative grid min-h-0 flex-1 grid-cols-6 grid-rows-2 gap-2 px-3 pb-3" role="group" aria-label="Tonalidades">
            {TOP_ROW.map(keyTile)}
            {BOTTOM_ROW.map(keyTile)}
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
            <div role="tablist" aria-label="Dónde se usa el kit" className="flex shrink-0 gap-1 rounded-[0.9rem] border border-white/10 bg-black/30 p-1">
              {([['device', 'Kit del equipo'], ['song', 'Solo esta canción']] as const).map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={scope === value} onClick={() => setScope(value)}
                  className={`flex-1 rounded-[0.7rem] px-3 py-2 text-[0.8rem] font-semibold ${scope === value ? 'bg-white/12 text-white' : 'text-white/50 hover:text-white/75'}`}>{label}</button>
              ))}
            </div>
            <p className="shrink-0 text-[0.76rem] leading-snug text-white/50">
              {scope === 'device'
                ? 'Suena en todas las canciones que no tengan un kit propio.'
                : <>Solo para «{props.songTitle || 'esta canción'}»; se guarda en la canción.</>}
            </p>
            <div role="radiogroup" aria-label="Kits de pads" className="grid shrink-0 gap-2 sm:grid-cols-2">
              {scope === 'song' && (
                <button type="button" role="radio" aria-checked={!props.songKitId} onClick={() => props.onChooseSongKit(null)}
                  className={`ui-pressable-soft flex items-center gap-3 rounded-[1rem] border p-2 pr-3 text-left ${!props.songKitId ? 'border-cyan-300/50 bg-cyan-300/[0.1]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[0.7rem] border border-dashed border-white/20 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-white/50">Equipo</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.95rem] font-semibold text-white">Usar el del equipo</span>
                    <span className="block truncate text-[0.74rem] text-white/50">{kits.find(kit => kit.id === props.deviceKitId)?.name}</span>
                  </span>
                  {!props.songKitId && <Check className="h-5 w-5 shrink-0 text-cyan-200" />}
                </button>
              )}
              {kits.map(kitOption)}
            </div>
          </div>
        )}
        {props.notice && <p role="status" className="relative shrink-0 px-4 pb-3 text-[0.76rem] text-white/60">{props.notice}</p>}
      </div>
    </div>
  );
}

export default memo(PadPlayerPanel);
