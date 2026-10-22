import { useCallback, useEffect, useRef, useState } from 'react';
export type JumpSection = { id: string; name: string; startTime: number; endTime: number };
type ArmedJump = { section: JumpSection; sourceStart: number; boundary: number };
type Options = {
  enabled: boolean; resetKey: string; sections: JumpSection[];
  isReady: boolean; isPlaying: boolean; busy: boolean;
  getTime: () => number; onJump: (time: number) => Promise<boolean | void>;
};
export function useLiveDirectorSectionJump(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [armed, setArmed] = useState<ArmedJump | null>(null);
  const [notice, setNotice] = useState('');
  const cancel = useCallback(() => { setArmed(null); setNotice('Salto cancelado.'); }, []);
  useEffect(() => { setArmed(null); setNotice(''); }, [options.resetKey]);
  const arm = useCallback((sectionId: string) => {
    const current = latest.current;
    if (!current.enabled || !current.isReady || !current.isPlaying || current.busy) return false;
    const now = current.getTime();
    const source = current.sections.find(section => now >= section.startTime && now < section.endTime);
    const section = current.sections.find(section => section.id === sectionId);
    if (!source || !section || source.endTime - now < .25) {
      setNotice('Arma el salto antes de que termine la sección actual.'); return false;
    }
    setArmed({ section, sourceStart: source.startTime, boundary: source.endTime });
    setNotice(`Salto armado a ${section.name}, al terminar ${source.name}.`);
    return true;
  }, []);
  useEffect(() => {
    if (!armed) return;
    let last = latest.current.getTime(), lastWall = performance.now();
    const stop = (message: string) => { setArmed(null); setNotice(message); };
    const timer = setInterval(() => {
      const current = latest.current;
      if (!current.enabled || !current.isPlaying || !current.isReady || current.busy) { stop('Salto cancelado: cambió el transporte.'); return; }
      const now = current.getTime(), wall = performance.now(), expected = (wall - lastWall) / 1000;
      if (now < armed.sourceStart - .1 || now < last - .15 || now - last > expected + .4) { stop('Salto cancelado al mover la posición.'); return; }
      last = now; lastWall = wall;
      if (now > armed.boundary + .3) { stop('Salto cancelado: no se pudo ejecutar a tiempo.'); return; }
      if (now >= armed.boundary) {
        clearInterval(timer); setArmed(null); setNotice(`Preparando salto a ${armed.section.name}…`);
        void current.onJump(armed.section.startTime).then(result => setNotice(result === false ? 'No se pudo completar el salto.' : `Salto a ${armed.section.name} realizado.`))
          .catch(() => setNotice('No se pudo completar el salto. Revisa el audio.'));
      }
    }, 25);
    return () => clearInterval(timer);
  }, [armed]);
  return { armed, notice, arm, cancel };
}
export type SectionJumpController = ReturnType<typeof useLiveDirectorSectionJump>;
