import { useEffect, useRef, useState } from 'react';
import { DynamicGuidePlayer, type GuideAudioGraph } from '../services/DynamicGuidePlayer';
import { nextGuideInstruction, type GuideCuePlan, type GuideInstructionCue } from '../utils/liveDirectorGuideCues';
type Options = {
  wanted: boolean; ready: boolean; playing: boolean; busy: boolean; resetKey: string; bpm: number; meter?:{numerator:number;denominator:number}|null;
  getGraph: () => GuideAudioGraph | null;
  getTime: () => number; getPlan: (time: number) => GuideCuePlan | null;
  /** RPP instructions in song time; spoken apart from section cues. */
  getInstructions?: () => ReadonlyArray<GuideInstructionCue>;
};
export function useLiveDirectorDynamicGuide(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [status, setStatus] = useState<'off' | 'loading' | 'ready' | 'error'>('off');
  const [error, setError] = useState('');
  const playerRef = useRef<DynamicGuidePlayer | null>(null);
  // Only re-render when the upcoming instruction changes, not on every 25 ms tick.
  const [nextInstruction, setNextInstruction] = useState<GuideInstructionCue | null>(null);
  useEffect(() => {
    if (!options.wanted || !options.ready) { setStatus('off'); setError(''); return; }
    const graph = latest.current.getGraph();
    if (!graph) { setError('Esta sesión necesita una pista Guide separada y el motor streaming.'); setStatus('error'); return; }
    const controller = new AbortController();
    const player = new DynamicGuidePlayer(graph); playerRef.current = player;
    let cancelled = false, timer: ReturnType<typeof setInterval> | undefined;
    setStatus('loading'); setError('');
    void player.load(controller.signal).then(() => {
      if (cancelled) return;
      setStatus('ready');
      timer = setInterval(() => {
        const current = latest.current;
        const time = current.getTime(), cues = current.getInstructions?.() ?? [];
        const upcoming = nextGuideInstruction(cues, time);
        setNextInstruction(previous => previous?.id === upcoming?.id ? previous : upcoming);
        if (!current.playing || current.busy) { player.pause(); return; }
        player.update(current.getPlan(time), time, current.bpm,current.meter);
        player.updateInstructions(cues, time, current.bpm);
      }, 25);
    }).catch(reason => {
      if (cancelled) return;
      player.dispose(); setStatus('error'); setError(reason instanceof Error ? reason.message : 'No se pudo preparar la guía.');
    });
    return () => {
      cancelled = true; controller.abort(); clearInterval(timer); player.dispose();
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [options.wanted, options.ready, options.resetKey]);
  return {
    status, error, nextInstruction, getDiagnostics: () => playerRef.current?.events || [],
    speak: (name: string) => playerRef.current?.speakNow(name) ?? false,
  };
}
