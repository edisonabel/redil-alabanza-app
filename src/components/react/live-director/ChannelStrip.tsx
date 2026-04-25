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

type FaderInteractionState = {
  active: boolean;
  pointerId: number | null;
  mode: 'pending' | 'volume' | 'scroll';
  startX: number;
  startY: number;
  startScrollLeft: number;
  scrollContainer: HTMLElement | null;
};

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

export function FaderThumb({
  accent,
  level = 0,
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
  const lineOpacity = muted ? 0.34 : 0.46 + level * 0.32;
  const lineScale = 0.84 + level * 0.2;
  const lineGlow = muted ? '0 0 0 transparent' : `0 0 ${8 + level * 10}px currentColor`;

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
        className="absolute inset-x-3 top-1/2 h-[2px] -translate-y-1/2 rounded-full transition-[opacity,transform,box-shadow] duration-300 ease-out"
        style={{
          backgroundColor: highlightColor,
          color: highlightColor,
          opacity: lineOpacity,
          transform: `translateY(-50%) scaleX(${lineScale})`,
          boxShadow: lineGlow,
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
}: ChannelStripProps) {
  const [draftVolume, setDraftVolume] = useState<number | null>(null);
  const displayVolume = draftVolume ?? volume;
  const displayLevel = muted ? 0 : clamp(level);
  const hasLiveSignal = displayLevel > 0.002;
  const isAudiblyActive = isPlaying && !muted && !dimmed && !disabled && displayVolume > 0.015 && hasLiveSignal;
  const visualActivityLevel = displayLevel > 0.002
    ? displayLevel
    : 0;
  const levelBottom = `${10 + displayVolume * 78}%`;
  const knobGlow = muted ? 'rgba(120, 128, 140, 0.15)' : `${accent}30`;
  const meterHeightPercent = visualActivityLevel > 0.002
    ? Math.min(92, 12 + Math.pow(visualActivityLevel, 0.72) * 80)
    : 0;
  const meterOpacity = muted
    ? 0.16
    : hasLiveSignal
      ? 0.28 + displayLevel * 0.54
      : 0.12;
  const meterGlow = muted
    ? '0 0 0 transparent'
    : isAudiblyActive
      ? `0 0 ${10 + visualActivityLevel * 16}px ${accent}3c`
      : `0 0 ${8 + displayLevel * 14}px ${accent}36`;
  const breathStrength = clamp(Math.pow(displayLevel, 0.72), 0.14, 0.76);
  const trackBreathDelay = useMemo(
    () => `${-(getStableTrackPhaseMs(id) / 1000).toFixed(2)}s`,
    [id],
  );
  const trackBreathStyle = useMemo<CSSProperties>(
    () => ({
      '--track-accent': accent,
      '--track-breath-strength': String(breathStrength),
      '--track-breath-delay': trackBreathDelay,
    } as CSSProperties),
    [accent, breathStrength, trackBreathDelay],
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
  const stripSliderWidthClass = ultraCompact ? 'top-[8%] bottom-[12%] w-[5.15rem]' : compact ? 'top-[7%] bottom-[11%] w-[5.95rem]' : 'top-[4.5%] bottom-[6.5%] w-[6rem]';
  const sliderSurfaceRef = useRef<HTMLDivElement | null>(null);
  const faderInteractionRef = useRef<FaderInteractionState>({
    active: false,
    pointerId: null,
    mode: 'pending',
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    scrollContainer: null,
  });

  useEffect(() => {
    if (
      draftVolume !== null &&
      !faderInteractionRef.current.active &&
      Math.abs(volume - draftVolume) < 0.001
    ) {
      setDraftVolume(null);
    }
  }, [draftVolume, volume]);

  const updateDraftVolumeFromClientY = useCallback((clientY: number) => {
    if (disabled) {
      return null;
    }

    const sliderSurface = sliderSurfaceRef.current;
    if (!sliderSurface) {
      return null;
    }

    const bounds = sliderSurface.getBoundingClientRect();
    if (bounds.height <= 0) {
      return null;
    }

    const nextVolume = clamp(1 - ((clientY - bounds.top) / bounds.height), 0, 1);
    const roundedVolume = Math.round(nextVolume * 100) / 100;
    setDraftVolume(roundedVolume);
    return roundedVolume;
  }, [disabled]);

  const finishSliderDrag = useCallback((pointerId?: number, target?: HTMLDivElement | null, keepDraft = false) => {
    const interaction = faderInteractionRef.current;
    if (
      typeof pointerId === 'number' &&
      interaction.pointerId !== null &&
      interaction.pointerId !== pointerId
    ) {
      return;
    }

    const sliderSurface = target || sliderSurfaceRef.current;
    const activePointerId = interaction.pointerId;
    faderInteractionRef.current = {
      active: false,
      pointerId: null,
      mode: 'pending',
      startX: 0,
      startY: 0,
      startScrollLeft: 0,
      scrollContainer: null,
    };

    if (!keepDraft) {
      setDraftVolume(null);
    }

    onInteractionEnd?.();

    if (sliderSurface && activePointerId !== null) {
      try {
        sliderSurface.releasePointerCapture(activePointerId);
      } catch {
        // no-op
      }
    }
  }, [onInteractionEnd]);

  const handleSliderPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const scrollContainer = event.currentTarget.closest('[data-live-director-mixer-scroll="true"]') as HTMLElement | null;
    faderInteractionRef.current = {
      active: true,
      pointerId: event.pointerId,
      mode: 'pending',
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scrollContainer?.scrollLeft ?? 0,
      scrollContainer,
    };
    setDraftVolume(volume);

    onInteractionStart?.();

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // no-op
    }

    event.preventDefault();
    event.stopPropagation();
  }, [disabled, onInteractionStart, volume]);

  const handleSliderPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = faderInteractionRef.current;
    if (!interaction.active || interaction.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - interaction.startX;
    const deltaY = event.clientY - interaction.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (interaction.mode === 'pending') {
      if (absX < FADER_AXIS_LOCK_THRESHOLD_PX && absY < FADER_AXIS_LOCK_THRESHOLD_PX) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      interaction.mode = absY > absX * 1.5 || !interaction.scrollContainer ? 'volume' : 'scroll';
    }

    if (interaction.mode === 'scroll') {
      if (interaction.scrollContainer) {
        interaction.scrollContainer.scrollLeft = interaction.startScrollLeft - deltaX;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    updateDraftVolumeFromClientY(event.clientY);
    event.preventDefault();
    event.stopPropagation();
  }, [updateDraftVolumeFromClientY]);

  const handleSliderPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = faderInteractionRef.current;
    if (!interaction.active || interaction.pointerId !== event.pointerId) {
      return;
    }

    let committedVolume: number | null = null;
    if (interaction.mode === 'pending' || interaction.mode === 'volume') {
      committedVolume = updateDraftVolumeFromClientY(event.clientY);
    } else if (interaction.scrollContainer) {
      interaction.scrollContainer.scrollLeft = interaction.startScrollLeft - (event.clientX - interaction.startX);
    }

    finishSliderDrag(event.pointerId, event.currentTarget, committedVolume !== null);
    if (committedVolume !== null) {
      onVolumeChange(committedVolume);
    }
    event.preventDefault();
    event.stopPropagation();
  }, [finishSliderDrag, onVolumeChange, updateDraftVolumeFromClientY]);

  const handleSliderPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = faderInteractionRef.current;
    if (!interaction.active || interaction.pointerId !== event.pointerId) {
      return;
    }

    finishSliderDrag(event.pointerId, event.currentTarget);
    event.preventDefault();
    event.stopPropagation();
  }, [finishSliderDrag]);

  const handleSliderKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    let nextVolume: number | null = null;

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      nextVolume = clamp(displayVolume + 0.02, 0, 1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      nextVolume = clamp(displayVolume - 0.02, 0, 1);
    } else if (event.key === 'Home') {
      nextVolume = 0;
    } else if (event.key === 'End') {
      nextVolume = 1;
    }

    if (nextVolume === null) {
      return;
    }

    onVolumeChange(Math.round(nextVolume * 100) / 100);
    event.preventDefault();
    event.stopPropagation();
  }, [disabled, displayVolume, onVolumeChange]);

  return (
    <div
      className={`live-director-track-strip relative flex h-full min-w-0 flex-col items-center overflow-hidden border border-white/7 bg-[linear-gradient(180deg,rgba(34,35,37,0.92),rgba(26,27,29,0.94))] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-all duration-200 ${isAudiblyActive ? 'live-director-track-strip--breathing' : ''} ${shellRadiusClass} ${shellPaddingClass} ${dimmed ? 'opacity-45' : 'opacity-100'}`}
      style={trackBreathStyle}
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
            className={`live-director-track-activity-meter pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full shadow-[0_0_14px_rgba(103,210,242,0.16)] transition-[height,opacity,box-shadow] duration-300 ease-out ${isAudiblyActive ? 'live-director-track-activity-meter--breathing' : ''} ${ultraCompact ? 'bottom-[11%] w-[0.3rem]' : 'bottom-[10%] w-[0.38rem]'}`}
            style={{
              height: `${meterHeightPercent}%`,
              backgroundColor: muted ? 'rgba(136, 144, 158, 0.42)' : accent,
              opacity: meterOpacity,
              boxShadow: meterGlow,
            }}
          />
          <FaderThumb
            accent={accent}
            level={visualActivityLevel}
            muted={muted}
            className={`live-director-track-thumb ${isAudiblyActive ? 'live-director-track-thumb--breathing' : ''} ${ultraCompact ? 'h-[1.85rem]' : compact ? 'h-[2.2rem]' : 'h-[4.35rem]'} w-full ${stripThumbWidthClass} transition-[bottom,box-shadow,opacity,transform] duration-300 ease-out`}
            style={{
              bottom: `calc(${levelBottom} - ${ultraCompact ? '0.92rem' : compact ? '1.1rem' : '1.75rem'})`,
              boxShadow: muted
                ? '0 12px 20px rgba(0,0,0,0.24)'
                : `0 14px 24px rgba(0,0,0,0.35), 0 0 20px ${knobGlow}`,
              opacity: dimmed ? 0.84 : 1,
            }}
          />

          <div
            ref={sliderSurfaceRef}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`Volume for ${label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayVolume * 100)}
            aria-valuetext={`${Math.round(displayVolume * 100)}%`}
            aria-orientation="vertical"
            data-no-drag-scroll="true"
            onPointerDown={handleSliderPointerDown}
            onPointerMove={handleSliderPointerMove}
            onPointerUp={handleSliderPointerUp}
            onPointerCancel={handleSliderPointerCancel}
            onLostPointerCapture={() => finishSliderDrag()}
            onKeyDown={handleSliderKeyDown}
            className={`absolute left-1/2 -translate-x-1/2 rounded-[1rem] ${disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${stripSliderWidthClass}`}
            style={{ touchAction: 'none' }}
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
        <p className={`leading-tight text-white/88 ${ultraCompact ? 'text-[10px] font-semibold' : compact ? 'text-[11px] font-semibold' : 'mt-1 text-[1.03rem] font-semibold'}`}>{label}</p>
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
  previousProps.outputRoute === nextProps.outputRoute &&
  previousProps.showRouteFlip === nextProps.showRouteFlip &&
  previousProps.compact === nextProps.compact &&
  previousProps.ultraCompact === nextProps.ultraCompact
));
