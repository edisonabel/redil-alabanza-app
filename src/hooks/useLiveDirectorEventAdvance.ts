import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

export type EventPlaybackRequest = { songId: string; token: number };
export type QueueSelectionOptions = { autoPlay?: boolean };
type Options = {
  enabled: boolean;
  /** Cuenta 5-4-3-2-1 y pasa a la siguiente. Apagado, la canción termina y se avisa con onEnded. */
  autoAdvance?: boolean;
  /** La canción llegó a su final sola (sin un cambio de canción armado): aplica la transición elegida. */
  onEnded?: () => void;
  identity: string;
  songId: string;
  nextSong?: { id: string; title: string };
  playing: boolean;
  ready: boolean;
  busy: boolean;
  hasArrangement: boolean;
  duration: number;
  finalStart?: number | null;
  getTime?: () => number;
  manualNavigation: MutableRefObject<boolean>;
  scheduleEnd?: (boundary: number) => { completion: Promise<boolean>; cancel: () => void };
  selectSong?: (id: string, options?: QueueSelectionOptions) => void;
  request?: EventPlaybackRequest | null;
  startReady: boolean;
  startError?: string;
  start: () => Promise<void>;
  pause: () => void;
  cancelSelection?: () => void;
  requestHandled?: (token: number) => void;
};

const COUNTDOWN_SECONDS = 5;

/** Final starts a cancellable countdown while the audio tail keeps playing. */
export function useLiveDirectorEventAdvance(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [countdown, setCountdown] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [notice, setNotice] = useState('');
  const waiting = useRef<{ deadline: number; nextId: string } | null>(null);
  const selectingRef = useRef(false);
  const ending = useRef<{ cancel: () => void } | null>(null);
  const generation = useRef(0);
  const starting = useRef<number | null>(null);
  const handled = useRef<number | null>(null);
  const completedPass = useRef(false);
  const cancelEnd = useCallback(() => {
    const job = ending.current;
    ending.current = null;
    job?.cancel();
  }, []);
  const cancel = useCallback(() => {
    const o = latest.current;
    const pendingRequest = o.request?.songId === o.songId && handled.current !== o.request.token;
    const pending = Boolean(waiting.current || selectingRef.current || pendingRequest || starting.current !== null);
    if (!pending) return false;
    generation.current++;
    waiting.current = null; selectingRef.current = false;
    setCountdown(null); setSelecting(false); setNotice('Avance automático cancelado.');
    if (pendingRequest) handled.current = o.request!.token;
    if (starting.current !== null) o.pause();
    starting.current = null;
    o.cancelSelection?.();
    return true;
  }, []);
  const complete = useCallback(() => {
    const o = latest.current;
    if (!o.enabled || o.busy || o.manualNavigation.current || completedPass.current || waiting.current || selectingRef.current) return;
    if (o.autoAdvance === false) { completedPass.current = true; cancelEnd(); o.onEnded?.(); return; }
    if (!o.nextSong) return;
    completedPass.current = true;
    cancelEnd();
    waiting.current = { deadline: performance.now() + COUNTDOWN_SECONDS * 1000, nextId: o.nextSong.id };
    setNotice(''); setCountdown(COUNTDOWN_SECONDS);
  }, [cancelEnd]);

  useEffect(() => {
    generation.current++;
    cancelEnd(); waiting.current = null; selectingRef.current = false;
    completedPass.current = false;
    starting.current = null; setCountdown(null); setSelecting(false); setNotice('');
  }, [options.identity, cancelEnd]);

  useEffect(() => {
    const tick = () => {
      const o = latest.current;
      const request = o.request?.songId === o.songId && handled.current !== o.request.token ? o.request : null;
      if (!o.enabled) { cancel(); cancelEnd(); return; }
      const finalStart = typeof o.finalStart === 'number' && Number.isFinite(o.finalStart) ? o.finalStart : null;
      const position = o.getTime?.();
      const boundary = finalStart ?? o.duration;
      if (Number.isFinite(position) && position! < boundary - .1) {
        completedPass.current = false;
        if (waiting.current) cancel();
      }
      if (waiting.current) {
        if (!o.ready || o.busy || o.manualNavigation.current || o.nextSong?.id !== waiting.current.nextId) { cancel(); return; }
        const remaining = Math.max(0, Math.ceil((waiting.current.deadline - performance.now()) / 1000));
        setCountdown(previous => previous === remaining ? previous : remaining);
        if (remaining === 0) {
          const nextId = waiting.current.nextId;
          waiting.current = null; selectingRef.current = true;
          setCountdown(null); setSelecting(true);
          o.selectSong?.(nextId, { autoPlay: true });
        }
        return;
      }
      if (request) {
        if (o.startError) {
          generation.current++;
          if (starting.current !== null) o.pause();
          starting.current = null; selectingRef.current = false; setSelecting(false);
          handled.current = request.token;
          o.requestHandled?.(request.token);
          setNotice(`La siguiente canción quedó pausada: ${o.startError}`);
          return;
        }
        if (!o.startReady || o.busy || starting.current !== null) return;
        const token = generation.current, identity = o.identity;
        starting.current = request.token;
        void o.start().then(() => {
          if (generation.current !== token) {
            if (latest.current.identity === identity) o.pause();
            return;
          }
          handled.current = request.token; starting.current = null;
          selectingRef.current = false; setSelecting(false);
          o.requestHandled?.(request.token);
        }).catch(() => {
          if (generation.current !== token) return;
          o.pause(); handled.current = request.token; starting.current = null;
          selectingRef.current = false; setSelecting(false);
          o.requestHandled?.(request.token);
          setNotice('La canción está lista. Pulsa Play para iniciar el audio.');
        });
        return;
      }
      // El inicio de «Final» solo adelanta la cuenta; el fin real de la canción llega por scheduleEnd.
      if (o.autoAdvance !== false && finalStart !== null && o.playing && o.ready && !o.busy && !o.manualNavigation.current &&
          Number.isFinite(position) && position! >= finalStart) {
        complete();
      }
      // Edited arrangements own their end job. A repeat/jump owns the same
      // worklet scheduler, so relinquish it before any manual navigation.
      if (!o.playing || !o.ready || o.busy || o.hasArrangement || o.manualNavigation.current || !(o.duration > 0)) {
        cancelEnd(); return;
      }
      if (completedPass.current || ending.current || selectingRef.current) return;
      try {
        const end = o.scheduleEnd?.(o.duration);
        if (!end) return;
        ending.current = end;
        // Sin encadenar, el final igual se agenda para detener el transporte limpio; complete() no avanza.
        void end.completion.then(done => {
          if (ending.current !== end) return;
          ending.current = null;
          if (done) complete();
        });
      } catch { /* Unsupported engines retain manual transport. */ }
    };
    const timer = setInterval(tick, 50);
    return () => { clearInterval(timer); generation.current++; cancelEnd(); };
  }, [cancel, cancelEnd, complete]);

  const pendingRequest = options.request?.songId === options.songId && handled.current !== options.request.token;
  return { countdown, pending: countdown !== null || selecting || Boolean(pendingRequest), notice, cancel, complete };
}
