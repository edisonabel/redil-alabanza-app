import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrackData } from '../../../services/MultitrackEngine';
import type { SharedStreamingTelemetry } from '../../../services/StreamingMultitrackEngine';
import { inferMixGroup, MIX_GROUPS, type MixGroupId } from '../../../utils/liveDirectorMixGroups';
import { ChannelStrip } from './ChannelStrip';

type Props = {
  tracks: TrackData[]; isReady: boolean; isPlaying: boolean; busy: boolean; hidden: boolean;
  compact: boolean; ultraCompact: boolean;
  songGain?: number;
  onGroupGain: (trackId: string, gain: number) => void;
  getTelemetry: () => SharedStreamingTelemetry | null;
  trackLevels: Record<string, number>;
};
export function LiveDirectorGroupMixer(props: Props) {
  const settings = useRef<HTMLDialogElement>(null);
  const [gains, setGains] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [solos, setSolos] = useState<Record<string, boolean>>({});
  const [assignments, setAssignments] = useState<Record<string, MixGroupId>>({});
  const [levels, setLevels] = useState<Record<string, number>>({});
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
    <div className="ld-group-faders-toolbar"><span>Buses</span><button type="button" disabled={!props.isReady} onClick={() => settings.current?.showModal()}>Configurar grupos</button></div>
    <div data-live-director-mixer-scroll="true" className={`hide-scrollbar grid min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-[2rem] border border-white/7 bg-[linear-gradient(180deg,rgba(32,34,35,0.98),rgba(27,29,30,0.98))] ${props.ultraCompact ? 'gap-1 px-0.5 py-0.5' : props.compact ? 'gap-1.5 px-1 py-0.5' : 'gap-3 px-3 py-4'}`}
      style={{ gridTemplateColumns: `repeat(${Math.max(1, groups.filter(group => group.tracks.length > 0).length)}, minmax(${props.ultraCompact ? '6.7rem' : props.compact ? '7.45rem' : '8.5rem'}, 1fr))`, touchAction: 'pan-x pinch-zoom' }}>
      {groups.filter(group => group.tracks.length > 0).map(group => <ChannelStrip key={group.id}
        id={`group-${group.id}`} label={group.label} shortLabel={group.shortLabel} accent={group.color}
        volume={gains[group.id] ?? 1} level={levels[group.id] || 0} isPlaying={props.isPlaying}
        muted={Boolean(muted[group.id])} soloed={Boolean(solos[group.id])} dimmed={hasSolo && !solos[group.id]}
        disabled={!props.isReady || props.busy} compact={props.compact} ultraCompact={props.ultraCompact}
        onVolumeChange={gain => setGains(previous => ({ ...previous, [group.id]: gain }))}
        onMute={() => setMuted(previous => ({ ...previous, [group.id]: !previous[group.id] }))}
        onSolo={() => setSolos(previous => ({ ...previous, [group.id]: !previous[group.id] }))}
      />)}
    </div>
    <dialog ref={settings} className="ld-tools" aria-labelledby="ld-group-settings-title">
      <header className="ld-tools-header"><h2 id="ld-group-settings-title">Configurar grupos</h2><button type="button" aria-label="Cerrar configuración de grupos" onClick={() => settings.current?.close()}>Cerrar</button></header>
      <div className="ld-tools-body"><p>Las asignaciones, niveles y silencios se conservan durante esta prueba.</p>
        <div className="ld-tools-assignments">{props.tracks.map(track => <label key={track.id}>{track.name}<select aria-label={`Grupo de ${track.name}`} value={assignments[track.id] || inferMixGroup(track)} disabled={!props.isReady || props.busy} onChange={event => setAssignments(previous => ({ ...previous, [track.id]: event.target.value as MixGroupId }))}>{MIX_GROUPS.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>)}</div>
        <button type="button" className="mt-4" disabled={!props.isReady || props.busy} onClick={() => { setGains({}); setMuted({}); setSolos({}); }}>Restaurar niveles de grupos</button>
      </div>
    </dialog>
  </section>;
}
