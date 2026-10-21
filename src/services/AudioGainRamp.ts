/** Experimental web gain envelope. Completion of UI commands is a separate concern. */
export function scheduleAudioGainRamp(
  context: BaseAudioContext,
  gain: AudioParam,
  target: number,
  durationSeconds: number,
): number {
  const now = context.currentTime;
  const start = gain.value;
  const safeTarget = Number.isFinite(target) ? Math.max(0, Math.min(1, target)) : start;
  const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(start, now);
  if (duration === 0) {
    gain.setValueAtTime(safeTarget, now);
    return now;
  }
  const curve = new Float32Array(257);
  for (let index = 0; index < curve.length; index += 1) {
    const progress = index / (curve.length - 1);
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    curve[index] = start + (safeTarget - start) * eased;
  }
  gain.setValueCurveAtTime(curve, now, duration);
  return now + duration;
}
