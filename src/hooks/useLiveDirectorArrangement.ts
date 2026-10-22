import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { LiveDirectorSectionVisual } from '../utils/liveDirectorSongSession';
import type { GuideCuePlan } from '../utils/liveDirectorGuideCues';
type Prepared = { serial: number; completion: Promise<boolean> };
type Options = {
  enabled: boolean; resetKey: string; sections: LiveDirectorSectionVisual[]; playing: boolean; ready: boolean; busy: boolean;
  cursor: MutableRefObject<number>; manualNavigation: MutableRefObject<boolean>;
  getTime: () => number; pause: () => void;
  prepare?: (target: number, boundary: number) => Promise<Prepared>; cancel?: (serial?: number) => void;
  scheduleEnd?: (boundary: number) => { completion: Promise<boolean>; cancel: () => void };
};
export function useLiveDirectorArrangement(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [index, setIndex] = useState(0), [notice, setNotice] = useState('');
  const cue = useRef<GuideCuePlan | null>(null);
  const generation = useRef(0);
  const job = useRef<{ key: string; serial?: number; cancelEnd?: () => void } | null>(null);
  const moveTo = useCallback((index: number) => {
    latest.current.cursor.current = index; setIndex(index);
  }, []);
  const cancelOwn = useCallback(() => {
    generation.current++; cue.current = null;
    if (job.current?.serial !== undefined) latest.current.cancel?.(job.current.serial);
    job.current?.cancelEnd?.(); job.current = null;
  }, []);
  const focus = useCallback((id: string) => {
    const index = latest.current.sections.findIndex(section => section.id === id);
    if (index < 0) return;
    cancelOwn(); moveTo(index);
  }, [cancelOwn, moveTo]);
  useEffect(() => { cancelOwn(); moveTo(0); setNotice(''); }, [options.resetKey, cancelOwn, moveTo]);
  useEffect(() => {
    const tick = () => {
      const o = latest.current;
      if (!o.enabled || !o.playing || !o.ready || o.busy || o.manualNavigation.current) {
        if (job.current) cancelOwn(); return;
      }
      let currentIndex = o.cursor.current;
      let section = o.sections[currentIndex];
      if (!section) return;
      const time = o.getTime();
      // Contiguous portions need no decoder change. Advance the occurrence,
      // not a search by source time, so two copies of a chorus stay distinct.
      while (time >= section.endTime && currentIndex < o.sections.length - 1 &&
             Math.abs(section.endTime - o.sections[currentIndex + 1].startTime) < .0001) {
        currentIndex++; section = o.sections[currentIndex]; moveTo(currentIndex);
      }
      if (time < section.startTime - .1 && !(currentIndex === 0 && time < section.startTime)) {
        cancelOwn(); o.pause(); setNotice('Elige una sección del arreglo para continuar.'); return;
      }
      const next = o.sections[currentIndex + 1];
      if (next && Math.abs(section.endTime - next.startTime) < .0001) return;
      const key = `${currentIndex}:${section.id}`;
      if (job.current?.key === key) return;
      cancelOwn();
      const token = generation.current;
      job.current = { key };
      const failed = () => {
        if (generation.current !== token) return;
        job.current = null; cue.current = null;
        // A manual jump/repeat cancels the automatic pool before the next
        // 25ms tick. Its rejected promise is an interruption, not a load fault.
        if (latest.current.manualNavigation.current || !latest.current.playing || latest.current.busy) {
          generation.current++; return;
        }
        o.pause();
        setNotice('Arreglo pausado: no se pudieron preparar todos los stems. Vuelve a intentarlo.');
      };
      if (!next) {
        try {
          if (!o.scheduleEnd) throw new Error('Final no disponible');
          const end = o.scheduleEnd(section.endTime);
          job.current.cancelEnd = end.cancel;
          void end.completion.then(done => { if (generation.current !== token) return; job.current = null; if (done) setNotice('Arreglo terminado.'); else failed(); });
        } catch { failed(); }
        return;
      }
      if (!o.prepare || section.endTime - time < .25) { failed(); return; }
      setNotice(`Preparando ${next.name}…`);
      void o.prepare(next.startTime, section.endTime).then(async prepared => {
        if (generation.current !== token) { o.cancel?.(prepared.serial); return; }
        job.current!.serial = prepared.serial;
        cue.current = { id: `arrangement:${next.id}`, boundary: section.endTime, name: next.name };
        setNotice(`${next.name} listo · al terminar la sección`);
        const done = await prepared.completion;
        if (generation.current !== token) return;
        cue.current = null; job.current = null;
        if (!done) { failed(); return; }
        moveTo(currentIndex + 1); setNotice('');
      }).catch(failed);
    };
    const timer = setInterval(tick, 25);
    return () => { clearInterval(timer); cancelOwn(); };
  }, [cancelOwn, moveTo]);
  return { index, notice, focus, getCuePlan: () => cue.current, cancel: cancelOwn };
}
