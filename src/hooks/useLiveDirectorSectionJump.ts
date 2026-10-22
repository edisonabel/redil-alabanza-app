import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuideCuePlan } from '../utils/liveDirectorGuideCues';
export type JumpSection = { id: string; name: string; startTime: number; endTime: number };
type ArmedJump = { section: JumpSection; sourceStart: number; boundary: number };
type RepeatState = { section: JumpSection; mode: 'once' | 'hold'; completed: number; exitRequested: boolean };
type Options = {
  enabled: boolean; resetKey: string; sections: JumpSection[];
  isReady: boolean; isPlaying: boolean; busy: boolean;
  getSectionAtTime?: (time: number) => JumpSection | undefined;
  getTime: () => number; onJump: (time: number) => Promise<boolean | void>;
  prepareJump?: (targetSeconds: number, boundarySeconds: number) => Promise<{ serial: number; completion: Promise<boolean> }>;
  cancelPreparedJump?: () => void;
  onNavigate?: (sectionId: string) => void;
};
export function useLiveDirectorSectionJump(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [armed, setArmed] = useState<ArmedJump | null>(null);
  const [repeat, setRepeat] = useState<RepeatState | null>(null);
  const [notice, setNotice] = useState('');
  const [preparation, setPreparation] = useState<'preparing' | 'ready' | null>(null);
  const state = useRef({ armed, repeat, preparation }); state.current = { armed, repeat, preparation };
  const generation = useRef(0), inFlight = useRef(false), settling = useRef(false);
  const cancel = useCallback(() => { generation.current++; latest.current.cancelPreparedJump?.(); setPreparation(null); setArmed(null); setRepeat(null); setNotice('Navegación cancelada.'); }, []);
  useEffect(() => { generation.current++; latest.current.cancelPreparedJump?.(); setPreparation(null); setArmed(null); setRepeat(null); setNotice(''); }, [options.resetKey]);
  useEffect(() => () => { generation.current++; latest.current.cancelPreparedJump?.(); }, []);
  const arm = useCallback((sectionId: string) => {
    const current = latest.current;
    if (!current.enabled || !current.isReady || !current.isPlaying || current.busy || inFlight.current) return false;
    const now = current.getTime();
    const source = current.getSectionAtTime?.(now) ?? current.sections.find(section => now >= section.startTime && now < section.endTime);
    const section = current.sections.find(section => section.id === sectionId);
    if (!source || !section || source.endTime - now < .25) { setNotice('Arma el salto antes de que termine la sección actual.'); return false; }
    generation.current++; setRepeat(null);
    setArmed({ section, sourceStart: source.startTime, boundary: source.endTime });
    setNotice(`Salto armado a ${section.name}, al terminar ${source.name}.`); return true;
  }, []);
  const startRepeat = useCallback((mode: 'once' | 'hold') => {
    const current = latest.current;
    if (!current.enabled || !current.isReady || !current.isPlaying || current.busy || inFlight.current) return false;
    const now = current.getTime(), section = current.getSectionAtTime?.(now) ?? current.sections.find(section => now >= section.startTime && now < section.endTime);
    if (!section || section.endTime - now < .25) { setNotice('Activa la repetición antes de que termine la sección.'); return false; }
    generation.current++; setArmed(null); setRepeat({ section, mode, completed: 0, exitRequested: false });
    setNotice(`${section.name}: ${mode === 'once' ? 'repetir una vez' : 'repetir hasta salir'}.`); return true;
  }, []);
  const exitRepeat = useCallback(() => {
    generation.current++;
    latest.current.cancelPreparedJump?.();
    setPreparation(null);
    setRepeat(previous => previous ? { ...previous, exitRequested: true } : null);
    setNotice('La canción continuará al terminar esta sección.');
  }, []);
  const getCuePlan = useCallback((time: number): GuideCuePlan | null => {
    const current = latest.current, navigation = state.current;
    const destinationReady = !current.prepareJump || navigation.preparation === 'ready';
    if ((navigation.armed || (navigation.repeat && !navigation.repeat.exitRequested)) && !destinationReady) return null;
    if (navigation.armed && destinationReady) return { id: `jump:${navigation.armed.section.id}`, boundary: navigation.armed.boundary, name: navigation.armed.section.name };
    if (navigation.repeat && !navigation.repeat.exitRequested && destinationReady) {
      return { id: `repeat:${navigation.repeat.section.id}:${navigation.repeat.completed}`, boundary: navigation.repeat.section.endTime, name: 'Repetir' };
    }
    const next = current.sections.find(section => section.startTime > time + .02);
    return next ? { id: `normal:${next.id}`, boundary: next.startTime, name: next.name } : null;
  }, []);
  useEffect(() => {
    if (!armed && !repeat) return;
    let last = latest.current.getTime(), lastWall = performance.now();
    const token = generation.current;
    let disposed = false;
    const stop = (message: string) => { generation.current++; latest.current.cancelPreparedJump?.(); setPreparation(null); setArmed(null); setRepeat(null); setNotice(message); };
    const complete = (result: boolean | void) => {
      if (disposed || generation.current !== token) return;
      if (result === false) { stop('El destino no estuvo listo a tiempo. La canción continúa sin saltar.'); return; }
      setPreparation(null);
      setArmed(null);
      const section = armed?.section ?? repeat!.section;
      latest.current.onNavigate?.(section.id);
      if (repeat?.mode === 'hold') {
        setRepeat(previous => previous ? { ...previous, completed: previous.completed + 1 } : null);
        setNotice(`${section.name} en repetición.`);
      } else {
        setRepeat(null); setNotice(repeat ? 'Una repetición completada. La canción continuará.' : `Salto a ${section.name} realizado.`);
      }
    };
    // Preparation runs while the current section keeps playing. The worklet,
    // rather than this UI timer, owns the boundary and the all-track switch.
    const prepareJump = latest.current.prepareJump;
    if (prepareJump && !repeat?.exitRequested) {
      const section = armed?.section ?? repeat!.section;
      const boundary = armed?.boundary ?? repeat!.section.endTime;
      setPreparation('preparing');
      setNotice(`Preparando ${section.name} sin interrumpir la canción…`);
      void prepareJump(section.startTime, boundary).then(async prepared => {
        if (disposed || generation.current !== token) return;
        setPreparation('ready');
        setNotice(`${section.name} listo. Cambiará al terminar la sección.`);
        complete(await prepared.completion);
      }).catch(() => {
        if (!disposed && generation.current === token) stop('No se pudo preparar el destino. La canción continúa sin saltar.');
      });
    }
    const timer = setInterval(() => {
      if (generation.current !== token || inFlight.current) return;
      const current = latest.current;
      if (settling.current) {
        if (current.busy) return;
        settling.current = false; last = current.getTime(); lastWall = performance.now(); return;
      }
      if (!current.enabled || !current.isPlaying || !current.isReady || current.busy) { stop('Salto cancelado: cambió el transporte.'); return; }
      const now = current.getTime(), wall = performance.now(), expected = (wall - lastWall) / 1000;
      if (prepareJump && !repeat?.exitRequested) return;
      const sourceStart = armed?.sourceStart ?? repeat!.section.startTime;
      const boundary = armed?.boundary ?? repeat!.section.endTime;
      if (now < sourceStart - .1 || now < last - .15 || now - last > expected + .4) { stop('Salto cancelado al mover la posición.'); return; }
      last = now; lastWall = wall;
      if (now > boundary + .3) { stop('Salto cancelado: no se pudo ejecutar a tiempo.'); return; }
      if (now < boundary) return;
      clearInterval(timer);
      if (repeat?.exitRequested) { setRepeat(null); setNotice('Repetición terminada. La canción continúa.'); return; }
      const section = armed?.section ?? repeat!.section;
      inFlight.current = true; setNotice(`Preparando ${section.name}…`);
      void current.onJump(section.startTime).then(complete).catch(() => { if (!disposed && generation.current === token) stop('No se pudo completar el cambio. Revisa el audio.'); })
        .finally(() => { inFlight.current = false; settling.current = true; });
    }, 25);
    return () => { disposed = true; clearInterval(timer); latest.current.cancelPreparedJump?.(); };
  }, [armed, repeat]);
  return { armed, repeat, notice, preparation, arm, cancel, startRepeat, exitRepeat, getCuePlan };
}
export type SectionJumpController = ReturnType<typeof useLiveDirectorSectionJump>;
