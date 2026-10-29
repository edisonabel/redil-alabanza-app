import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { TrackOutputRoute } from '../../../utils/liveDirectorTrackRouting';

export type ChannelStripProps = {
  id: string;
  label: string;
  shortLabel: string;
  accent: string;
  volume: number;
  level: number;
  isPlaying: boolean;
  muted: boolean;
  soloed: boolean;
  dimmed: boolean;
  disabled: boolean;
  disabledReason?: string;
  disabledTitle?: string;
  outputRoute?: TrackOutputRoute;
  showRouteFlip?: boolean;
  compact?: boolean;
  ultraCompact?: boolean;
  onVolumeChange: (volume: number) => void;
  onMute: () => void;
  onSolo: () => void;
  onToggleOutputRoute?: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onOpenSettings?: () => void;
  /** Botón del nombre: por defecto abre el metrónomo (Click); la Guía lo usa para elegir su modo. */
  settingsLabel?: string;
  settingsTitle?: string;
  settingsShortcut?: string;
  /** Etiqueta corta junto al nombre (p. ej. «AUTO» con la guía dinámica). */
  settingsBadge?: string;
};

const FADER_AXIS_LOCK_THRESHOLD_PX = 7;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const getStableTrackPhaseMs = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 1200;
  }
  return hash;
};

type PrecisionFaderSurfaceProps = {
  value: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
};

type FaderGesture = {
  pointerId: number;
  mode: 'pending' | 'volume' | 'scroll';
  startX: number;
  startY: number;
  lastY: number;
  lastValue: number;
  anchored: boolean;
  travel: number;
  bottomY: number;
  startScrollLeft: number;
  scrollContainer: HTMLElement | null;
};

/** Pointer travel follows the visible thumb centers (bottom 10% → 88%). */
export function PrecisionFaderSurface({
  value, onChange, label, disabled = false, className = '', style,
  onInteractionStart, onInteractionEnd,
}: PrecisionFaderSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<FaderGesture | null>(null);
  const latest = useRef({ value, onChange, disabled, onInteractionEnd });
  latest.current = { value, onChange, disabled, onInteractionEnd };

  const finish = useCallback((pointerId?: number) => {
    const gesture = gestureRef.current;
    if (!gesture || (pointerId !== undefined && pointerId !== gesture.pointerId)) return;
    gestureRef.current = null;
    try { surfaceRef.current?.releasePointerCapture(gesture.pointerId); } catch { /* capture already ended */ }
    latest.current.onInteractionEnd?.();
  }, []);
  useEffect(() => () => finish(), [finish]);
  useEffect(() => { if (disabled) finish(); }, [disabled, finish]);

  const update = useCallback((gesture: FaderGesture, clientY: number, fine: boolean) => {
    if (latest.current.disabled) return;
    const next = clamp(gesture.anchored
      ? gesture.lastValue + (gesture.lastY - clientY) / gesture.travel * (fine ? .1 : 1)
      : (gesture.bottomY - clientY) / gesture.travel);
    gesture.anchored = true;
    gesture.lastY = clientY;
    if (Math.abs(next - gesture.lastValue) < 1e-8) return;
    gesture.lastValue = next;
    // Update the engine during the drag, not only when the pointer is released.
    latest.current.onChange(next);
  }, []);

  const down = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || gestureRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.height <= 0) return;
    const scrollContainer = event.currentTarget.closest('[data-live-director-mixer-scroll="true"]') as HTMLElement | null;
    const thumbBounds = event.currentTarget.parentElement?.querySelector<HTMLElement>(
      '.live-director-track-thumb, .live-director-master-thumb, [data-fader-thumb]',
    )?.getBoundingClientRect();
    const grabbedThumb = !!thumbBounds && event.clientY >= thumbBounds.top && event.clientY <= thumbBounds.bottom;
    const gesture: FaderGesture = {
      pointerId: event.pointerId,
      mode: event.pointerType === 'mouse' || !scrollContainer ? 'volume' : 'pending',
      startX: event.clientX, startY: event.clientY, lastY: event.clientY,
      lastValue: clamp(value), anchored: grabbedThumb || event.shiftKey,
      travel: bounds.height * .78, bottomY: bounds.top + bounds.height * .9,
      startScrollLeft: scrollContainer?.scrollLeft ?? 0, scrollContainer,
    };
    gestureRef.current = gesture;
    onInteractionStart?.();
    event.currentTarget.focus({ preventScroll: true });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* browser lost the pointer */ }
    if (gesture.mode === 'volume' && !grabbedThumb) update(gesture, event.clientY, event.shiftKey);
    event.preventDefault(); event.stopPropagation();
  }, [disabled, onInteractionStart, update, value]);

  const move = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX, deltaY = event.clientY - gesture.startY;
    if (gesture.mode === 'pending') {
      if (Math.abs(deltaX) < FADER_AXIS_LOCK_THRESHOLD_PX && Math.abs(deltaY) < FADER_AXIS_LOCK_THRESHOLD_PX) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      gesture.mode = Math.abs(deltaY) > Math.abs(deltaX) * 1.5 ? 'volume' : 'scroll';
    }
    if (gesture.mode === 'scroll') {
      if (gesture.scrollContainer) gesture.scrollContainer.scrollLeft = gesture.startScrollLeft - deltaX;
    } else {
      update(gesture, event.clientY, event.shiftKey);
    }
    event.preventDefault(); event.stopPropagation();
  }, [update]);

  const up = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.mode === 'volume' || (gesture.mode === 'pending' && !gesture.anchored)) update(gesture, event.clientY, event.shiftKey);
    finish(event.pointerId);
    event.preventDefault(); event.stopPropagation();
  }, [finish, update]);

  const keyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? .001 : .01;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowRight' ? clamp(value + step)
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? clamp(value - step) : null;
    if (next === null) return;
    onChange(next);
    event.preventDefault(); event.stopPropagation();
  }, [disabled, onChange, value]);
  const percent = Math.round(clamp(value) * 1000) / 10;
  return <div ref={surfaceRef} role="slider" tabIndex={disabled ? -1 : 0}
    aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
    aria-valuetext={`${percent}%`} aria-orientation="vertical" aria-disabled={disabled}
    title="Arrastra para ajustar. Shift permite ajuste fino; flechas ±1%, Shift + flechas ±0,1%."
    data-no-drag-scroll="true" className={className} style={{ ...style, touchAction: 'none' }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up}
    onPointerCancel={event => { finish(event.pointerId); event.preventDefault(); event.stopPropagation(); }}
    onLostPointerCapture={event => finish(event.pointerId)} onKeyDown={keyDown}
  />;
}

export function FaderThumb({
  accent,
  muted = false,
  className = '',
  style,
}: {
  accent: string;
  level?: number;
  muted?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const highlightColor = muted ? 'rgba(161, 169, 181, 0.62)' : accent;
  const lineOpacity = muted ? 0.34 : 0.62;
  const lineScale = muted ? 0.84 : 0.96;

  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 rounded-[1.05rem] border border-white/8 bg-[linear-gradient(180deg,rgba(24,25,27,0.99),rgba(16,17,19,0.99))] ${className}`}
      style={style}
    >
      <div className="absolute inset-x-2 top-1.5 h-2 rounded-full bg-white/[0.045]" />
      <div className="absolute bottom-1.5 left-3 right-3 h-[2px] rounded-full bg-black/35" />
      <div className="absolute left-3 top-3 bottom-3 w-px rounded-full bg-white/10" />
      <div className="absolute right-3 top-3 bottom-3 w-px rounded-full bg-white/10" />
      <div className="absolute inset-2 rounded-[0.82rem] border border-white/4 bg-[repeating-linear-gradient(180deg,rgba(255,255,255,0.045)_0px,rgba(255,255,255,0.045)_2px,transparent_2px,transparent_5px)]" />
      <div
        className="absolute inset-x-3 top-1/2 h-[2px] -translate-y-1/2 rounded-full transition-transform duration-300 ease-out will-change-transform"
        style={{
          backgroundColor: highlightColor,
          color: highlightColor,
          opacity: lineOpacity,
          transform: `translateY(-50%) scaleX(${lineScale})`,
        }}
      />
    </div>
  );
}

export const ChannelStrip = memo(function ChannelStrip({
  id,
  label,
  shortLabel,
  accent,
  volume,
  level,
  isPlaying,
  muted,
  soloed,
  dimmed,
  disabled,
  disabledReason,
  disabledTitle,
  outputRoute = 'stereo',
  showRouteFlip = false,
  compact = false,
  ultraCompact = false,
  onVolumeChange,
  onMute,
  onSolo,
  onToggleOutputRoute,
  onInteractionStart,
  onInteractionEnd,
  onOpenSettings,
  settingsLabel = 'Configurar metrónomo',
  settingsTitle = 'Abrir subdivisiones del click · T',
  settingsShortcut = 'T',
  settingsBadge,
}: ChannelStripProps) {
  const [draftVolume, setDraftVolume] = useState<number | null>(null);
  const displayVolume = draftVolume ?? volume;
  const displayLevel = muted || disabled ? 0 : clamp(level);
  const hasLiveSignal = displayLevel > 0.002;
  const isAudiblyActive = isPlaying && !muted && !dimmed && !disabled && displayVolume > 0.015 && hasLiveSignal;
  const visualActivityLevel = displayLevel > 0.002
    ? displayLevel
    : 0;
  const levelBottom = `${10 + displayVolume * 78}%`;
  const knobGlow = muted || disabled ? 'rgba(120, 128, 140, 0.15)' : `${accent}30`;
  const fallbackVuLevel = visualActivityLevel > 0.002
    ? Math.min(1, 0.08 + Math.pow(visualActivityLevel, 0.72) * 0.92)
    : 0;
  const trackBreathDelay = useMemo(
    () => `${-(getStableTrackPhaseMs(id) / 1000).toFixed(2)}s`,
    [id],
  );
  const trackBreathStyle = useMemo<CSSProperties>(
    () => ({
      '--track-accent': accent,
      '--track-breath-delay': trackBreathDelay,
    } as CSSProperties),
    [accent, trackBreathDelay],
  );
  const shellRadiusClass = ultraCompact ? 'rounded-[0.75rem]' : compact ? 'rounded-[0.85rem]' : 'rounded-[1.2rem]';
  const shellPaddingClass = ultraCompact ? 'px-0.75 pb-0.75 pt-0.85' : compact ? 'px-1.25 pb-1.25 pt-0.95' : 'px-3.5 pb-4 pt-3';
  const topControlsClass = showRouteFlip
    ? ultraCompact
      ? 'mb-1 grid w-full max-w-[9.35rem] grid-cols-[minmax(0,1fr)_minmax(2.25rem,1fr)_minmax(0,1fr)] items-center gap-1.5 px-0.25'
      : compact
        ? 'mb-1.5 grid w-full max-w-[10.5rem] grid-cols-[minmax(0,1fr)_minmax(2.5rem,1fr)_minmax(0,1fr)] items-center gap-2 px-0.25'
        : 'mb-2 flex w-full max-w-[8.5rem] items-center justify-between gap-1.5'
    : ultraCompact
      ? 'mb-1 grid w-full max-w-[6.35rem] grid-cols-2 items-center gap-1.5 px-0.25'
      : compact
        ? 'mb-1.5 grid w-full max-w-[7.25rem] grid-cols-2 items-center gap-2 px-0.25'
        : 'mb-2 flex w-full max-w-[8.5rem] items-center justify-between gap-1.5';
  const topButtonRadiusClass = ultraCompact ? 'rounded-[0.95rem]' : compact ? 'rounded-[1.05rem]' : 'rounded-full';
  const sideButtonSizeClass = ultraCompact
    ? 'min-h-[1.75rem] min-w-[1.75rem] w-full text-[0.45rem] tracking-[0.14em]'
    : compact
      ? 'min-h-[2rem] min-w-[2rem] w-full text-[0.5rem] tracking-[0.15em]'
      : 'h-10 w-10 text-[0.76rem] tracking-[0.18em]';
  const routeButtonSizeClass = ultraCompact
    ? 'min-h-[1.75rem] min-w-[2.25rem] w-full px-0.5 text-[0.5rem] tracking-[0.12em]'
    : compact
      ? 'min-h-[2rem] min-w-[2.5rem] w-full px-1 text-[0.56rem] tracking-[0.13em]'
      : 'h-10 min-w-[3.5rem] px-3 text-[0.62rem] tracking-[0.16em]';
  const routeDividerSpacingClass = ultraCompact ? 'mx-0.5' : compact ? 'mx-0.75' : 'mx-1';
  const stripViewportWidthClass = ultraCompact ? 'max-w-[6.5rem]' : compact ? 'max-w-[7.2rem]' : 'max-w-[7.6rem]';
  const stripThumbWidthClass = ultraCompact ? 'max-w-[6.15rem]' : compact ? 'max-w-[7.05rem]' : 'max-w-[7.9rem]';
  const stripSliderWidthClass = ultraCompact ? 'w-[5.15rem]' : compact ? 'w-[5.95rem]' : 'w-[6rem]';
  useEffect(() => {
    if (draftVolume !== null && Math.abs(volume - draftVolume) < 1e-7) setDraftVolume(null);
  }, [draftVolume, volume]);
  const handleFaderChange = useCallback((next: number) => {
    setDraftVolume(next);
    onVolumeChange(next);
  }, [onVolumeChange]);

  return (
    <div
      className={`live-director-track-strip relative flex h-full min-w-0 flex-col items-center overflow-hidden border bg-[linear-gradient(180deg,rgba(34,35,37,0.92),rgba(26,27,29,0.94))] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-opacity duration-200 ${shellRadiusClass} ${shellPaddingClass} ${disabled ? 'border-amber-200/18 opacity-[0.62] saturate-50' : 'border-white/7'} ${dimmed ? 'opacity-45' : ''}`}
      style={trackBreathStyle}
      aria-disabled={disabled}
      title={disabledTitle || disabledReason}
    >
      <span
        aria-hidden="true"
        className={`live-director-track-breath-layer pointer-events-none absolute inset-0 ${shellRadiusClass}`}
      />
      <span
        aria-hidden="true"
        className="live-director-track-breath-edge pointer-events-none absolute inset-x-3 top-2 h-px rounded-full"
      />
      <div className={topControlsClass}>
        <button
          type="button"
          onClick={onSolo}
          disabled={disabled}
          aria-pressed={soloed}
          aria-label={`Solo ${label}`}
          className={`ui-pressable-soft flex items-center justify-center border font-black transition-all duration-150 ${topButtonRadiusClass} ${sideButtonSizeClass} ${soloed
              ? 'border-cyan-300/60 bg-cyan-300/16 text-cyan-100 shadow-[0_0_18px_rgba(103,210,242,0.24)]'
              : 'border-white/8 bg-black/32 text-white/65 hover:border-white/14 hover:text-white'
            }`}
        >
          S
        </button>
        {showRouteFlip ? (
          <button
            type="button"
            onClick={onToggleOutputRoute}
            disabled={disabled}
            aria-pressed={outputRoute === 'right'}
            aria-label={`Cambiar salida de ${label} hacia ${outputRoute === 'right' ? 'izquierda' : 'derecha'}`}
            className={`ui-pressable-soft flex items-center justify-center border font-black transition-all duration-150 ${topButtonRadiusClass} ${routeButtonSizeClass} ${outputRoute === 'right'
                ? 'border-amber-300/55 bg-amber-300/14 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.18)]'
                : 'border-cyan-300/55 bg-cyan-300/14 text-cyan-100 shadow-[0_0_16px_rgba(103,210,242,0.18)]'
              }`}
            title={`Salida absoluta ${outputRoute === 'right' ? 'R' : 'L'}`}
          >
            <span className={outputRoute === 'left' ? 'text-white' : 'text-white/36'}>L</span>
            <span className={`${routeDividerSpacingClass} text-white/22`}>|</span>
            <span className={outputRoute === 'right' ? 'text-white' : 'text-white/36'}>R</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onMute}
          disabled={disabled}
          aria-label={`${muted ? 'Unmute' : 'Mute'} ${label}`}
          className={`ui-pressable-soft flex items-center justify-center border font-black transition-all duration-150 ${topButtonRadiusClass} ${sideButtonSizeClass} ${muted
              ? 'border-rose-300/55 bg-rose-400/16 text-rose-100 shadow-[0_0_18px_rgba(251,113,133,0.22)]'
              : 'border-white/8 bg-black/28 text-white/52 hover:border-white/14 hover:text-white'
            }`}
        >
          M
        </button>
      </div>

      <div className="relative flex w-full flex-1 items-center justify-center">
        <div className={`relative h-full w-full ${stripViewportWidthClass}`}>
          <div className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-[#040506] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] ${ultraCompact ? 'top-[8%] bottom-[12%] w-[0.5rem]' : compact ? 'top-[7%] bottom-[11%] w-[0.56rem]' : 'top-[4.5%] bottom-[6.5%] w-[0.72rem]'}`} />
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={`${id}-mark-${index}`}
              className="absolute left-1/2 h-[2px] w-[72%] -translate-x-1/2 rounded-full bg-white/18"
              style={{ bottom: `${12 + index * 10}%` }}
            />
          ))}
          <div
            className={`live-director-track-activity-meter pointer-events-none absolute left-1/2 rounded-full opacity-75 transition-transform duration-75 ease-linear will-change-transform ${ultraCompact ? 'top-[8%] bottom-[12%] w-[0.3rem]' : compact ? 'top-[7%] bottom-[11%] w-[0.38rem]' : 'top-[4.5%] bottom-[6.5%] w-[0.38rem]'}`}
            style={{
              backgroundColor: muted || disabled ? 'rgba(136, 144, 158, 0.42)' : 'var(--track-accent)',
              transform: `translateX(-50%) scaleY(var(--ld-vu-level, ${fallbackVuLevel.toFixed(4)}))`,
              transformOrigin: 'bottom center',
            }}
          />
          <FaderThumb
            accent={accent}
            level={0}
            muted={muted || disabled}
            className={`live-director-track-thumb ${ultraCompact ? 'h-[1.85rem]' : compact ? 'h-[2.2rem]' : 'h-[4.35rem]'} w-full ${stripThumbWidthClass} transition-[opacity,transform] duration-150 ease-out`}
            style={{
              bottom: `calc(${levelBottom} - ${ultraCompact ? '0.92rem' : compact ? '1.1rem' : '2.175rem'})`,
              boxShadow: muted
                ? '0 12px 20px rgba(0,0,0,0.24)'
                : `0 14px 24px rgba(0,0,0,0.35), 0 0 20px ${knobGlow}`,
              opacity: dimmed ? 0.84 : 1,
            }}
          />

          <PrecisionFaderSurface
            value={displayVolume} onChange={handleFaderChange}
            label={`Volume for ${label}`} disabled={disabled}
            onInteractionStart={onInteractionStart} onInteractionEnd={onInteractionEnd}
            className={`absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-[1rem] ${disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${stripSliderWidthClass}`}
          />
        </div>
      </div>

      <div className={`text-center ${ultraCompact ? 'mt-0' : compact ? 'mt-0.5' : 'mt-4'}`}>
        <div
          aria-hidden="true"
          className={`live-director-track-signal mx-auto mb-1 flex h-3 items-end justify-center gap-0.5 ${isAudiblyActive ? 'live-director-track-signal--active' : ''}`}
        >
          <span />
          <span />
          <span />
        </div>
        {!compact && <p className="text-[0.62rem] font-black uppercase tracking-[0.3em] text-white/28">{shortLabel}</p>}
        {onOpenSettings ? <button type="button" onClick={onOpenSettings} aria-label={settingsLabel} aria-keyshortcuts={settingsShortcut || undefined}
          title={settingsTitle} data-channel-settings-badge={settingsBadge || undefined} className={`min-h-7 rounded px-2 font-semibold text-white/88 underline decoration-white/30 decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-cyan-200 ${ultraCompact ? 'text-[10px]' : compact ? 'text-[11px]' : 'mt-1 text-[1.03rem]'}`}>{label}{settingsBadge && <span className="ml-1.5 rounded bg-cyan-300/18 px-1 py-px align-middle text-[0.55em] font-black tracking-[0.12em] text-cyan-100 no-underline">{settingsBadge}</span>}</button>
          : <p className={`leading-tight text-white/88 ${ultraCompact ? 'text-[10px] font-semibold' : compact ? 'text-[11px] font-semibold' : 'mt-1 text-[1.03rem] font-semibold'}`}>{label}</p>}
        {disabledReason ? (
          <p className={`mx-auto max-w-full truncate font-black uppercase tracking-[0.12em] text-amber-100/72 ${ultraCompact ? 'mt-0.5 text-[7px]' : compact ? 'mt-0.5 text-[8px]' : 'mt-1 text-[0.58rem]'}`}>
            {disabledReason}
          </p>
        ) : null}
      </div>
    </div>
  );
}, (previousProps, nextProps) => (
  previousProps.id === nextProps.id &&
  previousProps.label === nextProps.label &&
  previousProps.shortLabel === nextProps.shortLabel &&
  previousProps.accent === nextProps.accent &&
  previousProps.volume === nextProps.volume &&
  previousProps.level === nextProps.level &&
  previousProps.isPlaying === nextProps.isPlaying &&
  previousProps.muted === nextProps.muted &&
  previousProps.soloed === nextProps.soloed &&
  previousProps.dimmed === nextProps.dimmed &&
  previousProps.disabled === nextProps.disabled &&
  previousProps.disabledReason === nextProps.disabledReason &&
  previousProps.disabledTitle === nextProps.disabledTitle &&
  previousProps.outputRoute === nextProps.outputRoute &&
  previousProps.showRouteFlip === nextProps.showRouteFlip &&
  previousProps.compact === nextProps.compact &&
  previousProps.ultraCompact === nextProps.ultraCompact
  && previousProps.onOpenSettings === nextProps.onOpenSettings
  && previousProps.settingsLabel === nextProps.settingsLabel
  && previousProps.settingsTitle === nextProps.settingsTitle
  && previousProps.settingsShortcut === nextProps.settingsShortcut
  && previousProps.settingsBadge === nextProps.settingsBadge
));
