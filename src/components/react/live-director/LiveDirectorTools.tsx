import './LiveDirectorTools.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrackData } from '../../../services/MultitrackEngine';
import { resolveTrackOutputRoute } from '../../../utils/liveDirectorTrackRouting';
import { inferMixGroup, MIX_GROUPS, type MixGroupId } from '../../../utils/liveDirectorMixGroups';

type Section = { id: string; name: string; startTime: number; endTime: number };
type Props = {
  tracks: TrackData[];
  sections: Section[];
  isReady: boolean;
  isPlaying: boolean;
  busy: boolean;
  loadProgress: { loaded: number; total: number } | null;
  warnings: string[];
  engineRoute?: string;
  getTime: () => number;
  onJump: (time: number) => Promise<boolean | void>;
  onGroupGain: (trackId: string, gain: number) => void;
};
type ArmedJump = { section: Section; sourceStart: number; boundary: number };
const timeLabel = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;

/** Experimental controls. Group gains are separate from persisted individual faders. */
export function LiveDirectorTools(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'ready' | 'jump' | 'groups'>('ready');
  const [target, setTarget] = useState('');
  const [armed, setArmed] = useState<ArmedJump | null>(null);
  const [notice, setNotice] = useState('');
  const [gains, setGains] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [assignments, setAssignments] = useState<Record<string, MixGroupId>>({});
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (props.warnings.length > 0 && !props.isReady) dialog.current?.close();
  }, [props.warnings.length, props.isReady]);
  const groups = useMemo(() => MIX_GROUPS.map(group => ({ ...group,
    tracks: props.tracks.filter(track => (assignments[track.id] || inferMixGroup(track)) === group.id),
  })), [props.tracks, assignments]);

  useEffect(() => {
    if (!armed) return;
    let last = latest.current.getTime();
    let lastWall = performance.now();
    const cancel = (message: string) => { setArmed(null); setNotice(message); };
    const check = () => {
      const current = latest.current;
      if (!current.isPlaying || !current.isReady || current.busy) { cancel('Salto cancelado: cambió el transporte.'); return; }
      const now = current.getTime();
      const wall = performance.now();
      const expected = (wall - lastWall) / 1000;
      if (now < armed.sourceStart - 0.1 || now < last - 0.15 || now - last > expected + 0.4) {
        cancel('Salto cancelado al mover la posición.'); return;
      }
      last = now; lastWall = wall;
      if (now > armed.boundary + 0.3) { cancel('Salto cancelado: no se pudo ejecutar a tiempo.'); return; }
      if (now >= armed.boundary) {
        clearInterval(timer);
        setArmed(null);
        setNotice(`Preparando salto a ${armed.section.name}…`);
        void current.onJump(armed.section.startTime).then(result => setNotice(result === false ? 'No se pudo completar el salto. Revisa el estado de audio.' : `Salto a ${armed.section.name} realizado.`))
          .catch(() => setNotice('No se pudo completar el salto. Revisa el estado de audio.'));
      }
    };
    const timer = setInterval(check, 25);
    return () => clearInterval(timer);
  }, [armed]);

  const applyGain = (groupId: string, gain: number, isMuted = muted[groupId]) => {
    for (const track of groups.find(group => group.id === groupId)?.tracks || []) props.onGroupGain(track.id, isMuted ? 0 : gain);
  };
  const arm = () => {
    const now = props.getTime();
    const source = props.sections.find(section => now >= section.startTime && now < section.endTime);
    const section = props.sections.find(section => section.id === target);
    if (!source || !section || source.endTime - now < 0.25) { setNotice('Selecciona una sección y arma el salto antes de que termine la actual.'); return; }
    setArmed({ section, sourceStart: source.startTime, boundary: source.endTime });
    setNotice(`Salto armado a ${section.name}, al terminar ${source.name}.`);
  };
  return <>
    <button type="button" data-live-director-control="tools" onClick={() => dialog.current?.showModal()}
      className="ui-pressable shrink-0 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100">Herramientas</button>
    {armed && <button type="button" onClick={() => { setArmed(null); setNotice('Salto cancelado.'); }}
      className="shrink-0 rounded-xl border border-amber-300/35 px-3 text-xs text-amber-100" aria-label="Cancelar salto armado">→ {armed.section.name} · Cancelar</button>}
    <dialog ref={dialog} aria-labelledby="ld-tools-title" className="ld-tools">
      <header className="ld-tools-header"><div><p className="ld-tools-eyebrow">EXPERIMENTAL</p><h2 id="ld-tools-title">Herramientas de directo</h2></div>
        <button type="button" aria-label="Cerrar herramientas" onClick={() => dialog.current?.close()}>Cerrar</button></header>
      <nav aria-label="Herramientas de directo" className="ld-tools-tabs">
        {([['ready', 'Preparación'], ['jump', 'Salto de sección'], ['groups', 'Grupos']] as const).map(([id, label]) =>
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      <div className="ld-tools-body">
        {tab === 'ready' && <section aria-label="Preparación de audio">
          <h3>{props.isReady ? 'Inicio de canción preparado' : 'Preparando audio…'}</h3>
          <p>{props.isReady ? props.tracks.length : props.loadProgress?.loaded || 0} / {props.tracks.length} stems · {props.engineRoute === 'streaming-worker' ? 'Motor sincronizado con Worker' : 'Motor web'}</p>
          <p className="ld-tools-note">Preparado indica que puedes iniciar. El audio continúa cargando durante la reproducción; no confirma disponibilidad sin conexión.</p>
          {props.warnings.length > 0 && <ul role="alert">{props.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          <h3 className="ld-tools-subheading">Salidas de la sesión</h3>
          <ul className="ld-tools-tracks">{props.tracks.map(track => <li key={track.id}><span>{track.name}</span><span>{({ left: 'Izquierda', right: 'Derecha', stereo: 'Estéreo' })[resolveTrackOutputRoute(track)]}</span></li>)}</ul>
        </section>}
        {tab === 'jump' && <section aria-label="Programar salto">
          <h3>Al terminar la sección actual</h3>
          <p>Elige el destino y arma el salto mientras suena la canción. Puedes repetir una sección anterior.</p>
          <label className="ld-tools-field">Destino<select aria-label="Destino del salto" value={target} onChange={event => setTarget(event.target.value)}><option value="">Seleccionar sección…</option>{props.sections.map(section => <option key={section.id} value={section.id}>{section.name} · {timeLabel(section.startTime)}</option>)}</select></label>
          <div className="ld-tools-actions"><button type="button" disabled={!props.isReady || !props.isPlaying || props.busy || !target} onClick={arm}>Armar salto</button>
            {armed && <button type="button" onClick={() => { setArmed(null); setNotice('Salto cancelado.'); }}>Cancelar salto</button>}</div>
          <p className="ld-tools-note">Usa el cambio de sección con fade y preparación de pistas. Puede haber una pausa de carga; este prototipo todavía no hace transiciones continuas.</p>
          {!props.sections.length && <p>Esta canción no tiene marcadores de sección.</p>}
        </section>}
        {tab === 'groups' && <section aria-label="Grupos de mezcla">
          <h3>Mezcla por familias</h3><p>Conserva el balance de cada stem y sus salidas. Los grupos sólo afectan esta sesión de prueba.</p>
          <div className="ld-tools-groups">{groups.filter(group => group.tracks.length > 0).map(group => <div key={group.id} className="ld-tools-group">
            <div><strong>{group.label}</strong><span>{group.tracks.length} stems</span><button type="button" aria-pressed={Boolean(muted[group.id])} disabled={!props.isReady || props.busy}
              aria-label={`${muted[group.id] ? 'Activar' : 'Silenciar'} grupo ${group.label}`} onClick={() => { const next = !muted[group.id]; setMuted(previous => ({ ...previous, [group.id]: next })); applyGain(group.id, gains[group.id] ?? 1, next); }}>{muted[group.id] ? 'Activar' : 'Silenciar'}</button></div>
            <label><span>Nivel {Math.round((gains[group.id] ?? 1) * 100)}%</span><input type="range" min="0" max="100" step="1" aria-label={`Nivel de grupo ${group.label}`} value={(gains[group.id] ?? 1) * 100} disabled={!props.isReady || props.busy || muted[group.id]} onChange={event => { const gain = Number(event.target.value) / 100; setGains(previous => ({ ...previous, [group.id]: gain })); applyGain(group.id, gain); }} /></label>
          </div>)}</div>
          <details><summary>Asignar stems a grupos</summary><div className="ld-tools-assignments">{props.tracks.map(track => <label key={track.id}>{track.name}<select aria-label={`Grupo de ${track.name}`} value={assignments[track.id] || inferMixGroup(track)} disabled={!props.isReady || props.busy} onChange={event => { const id = event.target.value as MixGroupId; setAssignments(previous => ({ ...previous, [track.id]: id })); props.onGroupGain(track.id, muted[id] ? 0 : gains[id] ?? 1); }}>{MIX_GROUPS.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>)}</div></details>
          <button type="button" disabled={!props.isReady || props.busy} onClick={() => { for (const track of props.tracks) props.onGroupGain(track.id, 1); setGains({}); setMuted({}); }}>Restaurar niveles de grupos</button>
        </section>}
        <p role="status" aria-live="polite" className="ld-tools-notice">{notice}</p>
      </div>
    </dialog>
  </>;
}
