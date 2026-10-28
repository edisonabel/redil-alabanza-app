import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  SONG_TRANSITION_LABELS,
  transitionAllowsPad,
  type SongTransition,
  type SongTransitionMode,
} from '../../../utils/liveDirectorSongTransitions';

// Íconos al estilo de Playback: el círculo entre portadas muestra el de la transición elegida.
const iconProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const ICONS: Record<SongTransitionMode, ReactNode> = {
  cue: <svg {...iconProps}><path d="M2.5 12h8" /><path d="M11 7l7.5 5-7.5 5z" fill="currentColor" stroke="none" /></svg>,
  stay: <svg {...iconProps}><path d="M2 12h6.5" /><path d="M9 7l7.5 5-7.5 5z" fill="currentColor" stroke="none" /><path d="M20 6.5v11" /></svg>,
  autolink: <svg {...iconProps}><path d="M9.5 8H7.5a4 4 0 0 0 0 8h2" /><path d="M14.5 8h2a4 4 0 0 1 0 8h-2" /><path d="M8 12h8" /></svg>,
  overlap: <svg {...iconProps}><path d="M5 5h8a2.5 2.5 0 0 1 0 5h-2.5a2.5 2.5 0 0 0 0 5H13" /><path d="M5 19h14" /><path d="M13 15h6" /></svg>,
  crossfade: <svg {...iconProps}><path d="M5 5c6 0 8 14 14 14" /><path d="M5 19c6 0 8-14 14-14" /></svg>,
};
const ORDER: SongTransitionMode[] = ['cue', 'stay', 'autolink', 'overlap', 'crossfade'];
const MENU_WIDTH = 330;

type Props = {
  fromSongId: string;
  fromTitle: string;
  toTitle: string;
  transition: SongTransition;
  /** La transición que sigue a la canción que suena: la tecla L abre esta. */
  current?: boolean;
  open: boolean;
  /** Sin el motor en flujo, los modos que cambian de canción sonando no están disponibles. */
  preparedUnavailableReason?: string;
  compact?: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (transition: SongTransition) => void;
};

export const SongTransitionControl = memo(function SongTransitionControl({
  fromSongId, fromTitle, toTitle, transition, current = false, open, preparedUnavailableReason, compact = false, onOpenChange, onChange,
}: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; arrowTop: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const height = menuRef.current?.offsetHeight ?? 380;
      const left = Math.min(window.innerWidth - MENU_WIDTH - 8, rect.right + 12);
      const top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + rect.height / 2 - 40));
      setPosition({ left: Math.max(8, left), top, arrowTop: rect.top + rect.height / 2 - top });
    };
    place();
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === 'keydown') {
        if ((event as KeyboardEvent).key !== 'Escape') return;
        event.stopPropagation();
        onOpenChange(false); buttonRef.current?.focus(); return;
      }
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || buttonRef.current?.contains(target))) return;
      onOpenChange(false);
    };
    const dismiss = () => onOpenChange(false);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open, onOpenChange]);
  useEffect(() => { if (open) menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(); }, [open, position !== null]);

  const label = SONG_TRANSITION_LABELS[transition.mode];
  const padAllowed = transitionAllowsPad(transition.mode);
  const choose = (mode: SongTransitionMode) => {
    onChange({ mode, continuePad: transitionAllowsPad(mode) && transition.continuePad });
    onOpenChange(false);
  };
  const row = 'ui-no-press flex w-full items-center gap-3 px-4 text-left text-[0.95rem] font-medium text-white/92 outline-none transition-colors focus-visible:bg-white/8 hover:bg-white/6 disabled:cursor-not-allowed disabled:text-white/35 disabled:hover:bg-transparent';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-live-director-control="song-transition"
        data-transition-from={fromSongId}
        data-transition-mode={transition.mode}
        data-transition-pad={transition.continuePad ? 'on' : 'off'}
        data-transition-current={current ? 'true' : undefined}
        aria-keyshortcuts={current ? 'L' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Transición: ${label}. ${fromTitle} → ${toTitle}`}
        title={`${label}${transition.continuePad ? ' · Continuar Pad' : ''}${current ? ' · L' : ''}`}
        onClick={() => onOpenChange(!open)}
        // Como en Playback: pequeño, en el borde superior entre las dos portadas.
        className={`ui-no-press absolute left-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-[#26282a]/95 text-white shadow-[0_3px_10px_rgba(0,0,0,0.5)] transition hover:bg-[#3a3c3f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${open ? 'ring-2 ring-white/40' : ''} ${compact ? 'top-2 h-5 w-5 [&_svg]:h-3 [&_svg]:w-3' : 'top-2.5 h-6 w-6 [&_svg]:h-3.5 [&_svg]:w-3.5'}`}
      >
        {ICONS[transition.mode]}
        {transition.continuePad && <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[#26282a] bg-emerald-400" />}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Transición entre canciones"
          data-song-transition-menu={fromSongId}
          className="fixed z-[200] overflow-visible rounded-[1.4rem] border border-white/12 bg-[#1f2022]/97 py-1.5 text-white shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
          style={{ width: MENU_WIDTH, left: position?.left ?? -9999, top: position?.top ?? -9999 }}
        >
          {position && <span aria-hidden="true" className="absolute -left-[7px] h-3.5 w-3.5 rotate-45 border-b border-l border-white/12 bg-[#1f2022]" style={{ top: position.arrowTop - 7 }} />}
          {ORDER.map((mode, index) => {
            const unavailable = !transitionAllowsPad(mode) && preparedUnavailableReason;
            const item = (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={transition.mode === mode}
                data-transition-option={mode}
                disabled={Boolean(unavailable)}
                title={unavailable || undefined}
                onClick={() => choose(mode)}
                className={`${row} h-12 border-t border-white/8 ${index === 0 ? 'border-t-0' : ''}`}
              >
                <span className="flex w-7 shrink-0 justify-center">{ICONS[mode]}</span>
                <span className="min-w-0 flex-1 truncate">{SONG_TRANSITION_LABELS[mode]}</span>
                {transition.mode === mode && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sky-400" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11" /></svg>}
              </button>
            );
            if (mode !== 'stay') return item;
            // «Continuar Pad» va entre los modos que se detienen y los que pasan sonando, como en Playback.
            return [item, (
              <button
                key="continue-pad"
                type="button"
                role="menuitemcheckbox"
                aria-checked={padAllowed && transition.continuePad}
                data-transition-option="continue-pad"
                disabled={!padAllowed}
                title={padAllowed ? undefined : 'Solo con Activar Siguiente Canción o Mantenerse en Canción'}
                onClick={() => onChange({ ...transition, continuePad: !transition.continuePad })}
                className={`${row} h-12 border-t border-white/8`}
              >
                <span className="flex w-7 shrink-0 justify-center"><span className={`h-5 w-5 rounded-full border-2 ${padAllowed ? 'border-emerald-400' : 'border-emerald-400/40'}`} /></span>
                <span className="min-w-0 flex-1 truncate">Continuar Pad</span>
                <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${padAllowed && transition.continuePad ? 'bg-emerald-500' : 'bg-white/18'}`}>
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${padAllowed && transition.continuePad ? 'left-[1.375rem]' : 'left-0.5'} ${padAllowed ? '' : 'opacity-60'}`} />
                </span>
              </button>
            )];
          })}
        </div>,
        document.body,
      )}
    </>
  );
});
