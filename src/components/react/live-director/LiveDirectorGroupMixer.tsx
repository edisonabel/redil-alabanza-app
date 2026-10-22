import './LiveDirectorTools.css';
import { useMemo, useState } from 'react';
import type { TrackData } from '../../../services/MultitrackEngine';
import { inferMixGroup, MIX_GROUPS, type MixGroupId } from '../../../utils/liveDirectorMixGroups';

type Props = {
  tracks: TrackData[];
  isReady: boolean;
  busy: boolean;
  hidden: boolean;
  onGroupGain: (trackId: string, gain: number) => void;
};

/** Remains mounted between views so its displayed mix always matches the engine. */
export function LiveDirectorGroupMixer(props: Props) {
  const [gains, setGains] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [assignments, setAssignments] = useState<Record<string, MixGroupId>>({});
  const groups = useMemo(() => MIX_GROUPS.map(group => ({ ...group,
    tracks: props.tracks.filter(track => (assignments[track.id] || inferMixGroup(track)) === group.id),
  })), [props.tracks, assignments]);

  const applyGain = (groupId: string, gain: number, isMuted = muted[groupId]) => {
    for (const track of groups.find(group => group.id === groupId)?.tracks || []) props.onGroupGain(track.id, isMuted ? 0 : gain);
  };
  return <section hidden={props.hidden} aria-label="Grupos de mezcla" className="ld-group-mixer">

    <h3>Mezcla por familias</h3><p>Conserva el balance de cada stem y sus salidas. Los grupos sólo afectan esta sesión de prueba.</p>
    <div className="ld-tools-groups">{groups.filter(group => group.tracks.length > 0).map(group => <div key={group.id} className="ld-tools-group">
      <div><strong>{group.label}</strong><span>{group.tracks.length} stems</span><button type="button" aria-pressed={Boolean(muted[group.id])} disabled={!props.isReady || props.busy}
        aria-label={`${muted[group.id] ? 'Activar' : 'Silenciar'} grupo ${group.label}`} onClick={() => { const next = !muted[group.id]; setMuted(previous => ({ ...previous, [group.id]: next })); applyGain(group.id, gains[group.id] ?? 1, next); }}>{muted[group.id] ? 'Activar' : 'Silenciar'}</button></div>
      <label><span>Nivel {Math.round((gains[group.id] ?? 1) * 100)}%</span><input type="range" min="0" max="100" step="1" aria-label={`Nivel de grupo ${group.label}`} value={(gains[group.id] ?? 1) * 100} disabled={!props.isReady || props.busy || muted[group.id]} onChange={event => { const gain = Number(event.target.value) / 100; setGains(previous => ({ ...previous, [group.id]: gain })); applyGain(group.id, gain); }} /></label>
    </div>)}</div>
    <details><summary>Asignar stems a grupos</summary><div className="ld-tools-assignments">{props.tracks.map(track => <label key={track.id}>{track.name}<select aria-label={`Grupo de ${track.name}`} value={assignments[track.id] || inferMixGroup(track)} disabled={!props.isReady || props.busy} onChange={event => { const id = event.target.value as MixGroupId; setAssignments(previous => ({ ...previous, [track.id]: id })); props.onGroupGain(track.id, muted[id] ? 0 : gains[id] ?? 1); }}>{MIX_GROUPS.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>)}</div></details>
    <button type="button" disabled={!props.isReady || props.busy} onClick={() => { for (const track of props.tracks) props.onGroupGain(track.id, 1); setGains({}); setMuted({}); }}>Restaurar niveles de grupos</button>
  </section>;
}
