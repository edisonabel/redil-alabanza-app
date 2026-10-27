import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrackData } from '../../../services/MultitrackEngine';
import type { SharedStreamingTelemetry } from '../../../services/StreamingMultitrackEngine';
import { inferMixGroup, MIX_GROUPS, type MixGroupId } from '../../../utils/liveDirectorMixGroups';
import { Settings2 } from 'lucide-react';
import { ChannelStrip } from './ChannelStrip';

type Props = {
  tracks: TrackData[]; isReady: boolean; isPlaying: boolean; busy: boolean; hidden: boolean;
  compact: boolean; ultraCompact: boolean;
  songGain?: number;
  onGroupGain: (trackId: string, gain: number) => void;
  getTelemetry: () => SharedStreamingTelemetry | null;
  trackLevels: Record<string, number>;
  /** Buses guardados en la mezcla del evento para esta canción; se aplican al cambiar `groupsKey`. */
  savedGroups?: SavedMixGroups | null;
  groupsKey?: string;
  onGroupsChange?: (groups: SavedMixGroups) => void;
};
export type SavedMixGroups = { gains: Record<string, number>; muted: Record<string, true>; assignments: Record<string, MixGroupId> };
export function LiveDirectorGroupMixer(props: Props) {
  const settings = useRef<HTMLDialogElement>(null);
  const [gains, setGains] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [solos, setSolos] = useState<Record<string, boolean>>({});
  const [assignments, setAssignments] = useState<Record<string, MixGroupId>>({});
  const [levels, setLevels] = useState<Record<string, number>>({});
  // Al abrir otra canción se cargan sus buses guardados; el solo siempre empieza apagado.
  const loadedKey = useRef<string | null>(null);
  const changedByUser = useRef(false);
  useEffect(() => {
    if (loadedKey.current === (props.groupsKey ?? '')) return;
    loadedKey.current = props.groupsKey ?? '';
    if (changedByUser.current) return; // un cambio propio todavía sin guardar manda sobre el eco del servidor
    setGains({ ...(props.savedGroups?.gains || {}) });
    setMuted({ ...(props.savedGroups?.muted || {}) });
    setAssignments({ ...(props.savedGroups?.assignments || {}) });
    setSolos({});
  }, [props.groupsKey, props.savedGroups]);
  // Guarda nivel, silencio y asignaciones con una pausa corta para no escribir en cada píxel del fader.
  const onGroupsChange = useRef(props.onGroupsChange); onGroupsChange.current = props.onGroupsChange;
  useEffect(() => {
    if (!changedByUser.current) return;
    const timer = setTimeout(() => {
      changedByUser.current = false;
      onGroupsChange.current?.({
        gains: Object.fromEntries(Object.entries(gains).filter(([, gain]) => gain !== 1)),
        muted: Object.fromEntries(Object.entries(muted).filter(([, isMuted]) => isMuted).map(([id]) => [id, true as const])),
        assignments,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [gains, muted, assignments]);
  const groups = useMemo(() => MIX_GROUPS.map(group => ({ ...group,
    tracks: props.tracks.filter(track => (assignments[track.id] || inferMixGroup(track)) === group.id),
  })), [props.tracks, assignments]);
  const hasSolo = groups.some(group => group.tracks.length > 0 && solos[group.id]);
  useEffect(() => { if (!props.isReady) settings.current?.close(); }, [props.isReady]);
  // Group gain is independent of each stem's persisted fader, mute and solo.
  useEffect(() => {
    if (!props.isReady) return;
    for (const group of groups) {
      const gain = muted[group.id] || (hasSolo && !solos[group.id]) ? 0 : gains[group.id] ?? 1;
      for (const track of group.tracks) props.onGroupGain(track.id, gain * (inferMixGroup(track) === 'cues' ? 1 : props.songGain ?? 1));
    }
  }, [groups, gains, muted, solos, hasSolo, props.onGroupGain, props.isReady, props.songGain]);
  useEffect(() => {
    if (props.hidden || !props.isPlaying) { setLevels({}); return; }
    const update = () => {
      const telemetry = props.getTelemetry();
      const source = telemetry ? Object.fromEntries(telemetry.trackIds.map((id, index) => [id, telemetry.levels[index]])) : props.trackLevels;
      setLevels(Object.fromEntries(groups.map(group => [group.id, Math.max(0, ...group.tracks.map(track => source[track.id] || 0))])));
    };
    update(); const timer = setInterval(update, 80); return () => clearInterval(timer);
  }, [props.hidden, props.isPlaying, props.getTelemetry, props.trackLevels, groups]);
  return <section hidden={props.hidden} aria-label="Grupos de mezcla" className="ld-group-faders">
    {/* «Configurar grupos» va al lado de los buses, no encima: no le quita alto a los faders. */}
    <div className="ld-group-faders-row">
    <div data-live-director-mixer-scroll="true" className={`hide-scrollbar grid min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] ${props.ultraCompact ? 'gap-1 px-0.5 py-0.5' : props.compact ? 'gap-1.5 px-1 py-0.5' : 'gap-3 px-3 py-4'}`}
      style={{ gridTemplateColumns: `repeat(${Math.max(1, groups.filter(group => group.tracks.length > 0).length)}, minmax(${props.ultraCompact ? '6.7rem' : props.compact ? '7.45rem' : '8.5rem'}, 1fr))`, touchAction: 'pan-x pinch-zoom' }}>
      {groups.filter(group => group.tracks.length > 0).map(group => <ChannelStrip key={group.id}
        id={`group-${group.id}`} label={group.label} shortLabel={group.shortLabel} accent={group.color}
        volume={gains[group.id] ?? 1} level={levels[group.id] || 0} isPlaying={props.isPlaying}
        muted={Boolean(muted[group.id])} soloed={Boolean(solos[group.id])} dimmed={hasSolo && !solos[group.id]}
        disabled={!props.isReady || props.busy} compact={props.compact} ultraCompact={props.ultraCompact}
        onVolumeChange={gain => { changedByUser.current = true; setGains(previous => ({ ...previous, [group.id]: gain })); }}
        onMute={() => { changedByUser.current = true; setMuted(previous => ({ ...previous, [group.id]: !previous[group.id] })); }}
        onSolo={() => setSolos(previous => ({ ...previous, [group.id]: !previous[group.id] }))}
      />)}
    </div>
    <button type="button" className="ld-group-settings-button" aria-label="Configurar grupos" title="Configurar grupos"
      disabled={!props.isReady} onClick={() => settings.current?.showModal()}>
      <Settings2 size={props.ultraCompact ? 16 : 20} strokeWidth={2} aria-hidden="true" /><span aria-hidden="true">Configurar</span>
    </button>
    </div>
    <dialog ref={settings} className="ld-tools" aria-labelledby="ld-group-settings-title">
      <header className="ld-tools-header"><h2 id="ld-group-settings-title">Configurar grupos</h2><button type="button" aria-label="Cerrar configuración de grupos" onClick={() => settings.current?.close()}>Cerrar</button></header>
      <div className="ld-tools-body"><p>{props.onGroupsChange ? 'Las asignaciones, niveles y silencios se guardan en la mezcla de este evento.' : 'Las asignaciones, niveles y silencios se conservan durante esta prueba.'}</p>
        <div className="ld-tools-assignments">{props.tracks.map(track => <label key={track.id}>{track.name}<select aria-label={`Grupo de ${track.name}`} value={assignments[track.id] || inferMixGroup(track)} disabled={!props.isReady || props.busy} onChange={event => { changedByUser.current = true; setAssignments(previous => ({ ...previous, [track.id]: event.target.value as MixGroupId })); }}>{MIX_GROUPS.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>)}</div>
        <button type="button" className="mt-4" disabled={!props.isReady || props.busy} onClick={() => { changedByUser.current = true; setGains({}); setMuted({}); setSolos({}); }}>Restaurar niveles de grupos</button>
      </div>
    </dialog>
  </section>;
}
