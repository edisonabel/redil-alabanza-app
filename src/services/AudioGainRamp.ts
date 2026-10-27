/** Schedule fades on the audio clock; UI polling only observes completion. */
export function holdAudioGain(context: BaseAudioContext, gain: AudioParam): void {
  const now = context.currentTime;
  const value = gain.value;
  if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
  else { gain.cancelScheduledValues(now); gain.setValueAtTime(value, now); }
}

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
  holdAudioGain(context, gain);
  gain.setValueAtTime(start, now);
  if (duration === 0) { gain.setValueAtTime(safeTarget, now); return now; }
  for (let index = 1; index <= 128; index += 1) {
    const progress = index / 128;
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    gain.linearRampToValueAtTime(start + (safeTarget - start) * eased, now + duration * progress);
  }
  return now + duration;
}

export function startAudioGainFade(context: AudioContext, gain: AudioParam, target: number, durationMs: number) {
  let cancel = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.removeEventListener('statechange', onState);
      if (error) reject(error); else resolve();
    };
    const onState = () => {
      if (context.state !== 'running') {
        holdAudioGain(context, gain);
        finish(new Error('El dispositivo suspendió el audio durante la transición.'));
      }
    };
    cancel = () => {
      if (settled) return;
      holdAudioGain(context, gain);
      const error = new Error('Transición cancelada.');
      error.name = 'AbortError';
      finish(error);
    };
    if (context.state !== 'running') { finish(new Error('El audio está suspendido.')); return; }
    const end = scheduleAudioGainRamp(context, gain, target, durationMs / 1000);
    context.addEventListener('statechange', onState);
    const check = () => {
      if (context.currentTime >= end) finish();
      else timer = setTimeout(check, 16);
    };
    check();
  });
  return { finished, cancel: () => cancel() };
}
