type BufferedRangesLike = Pick<TimeRanges, 'end' | 'length' | 'start'>;

type MediaSeekReadinessInput = {
  allowCurrentData?: boolean;
  buffered: BufferedRangesLike;
  bufferAheadSeconds?: number;
  currentTime: number;
  duration?: number;
  readyState: number;
  seeking: boolean;
  targetTime: number;
  toleranceSeconds?: number;
};

type WaitForMediaSeekBarrierOptions = {
  bufferAheadSeconds?: number;
  duration?: number;
  label?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  toleranceSeconds?: number;
};

export const MEDIA_SEEK_BARRIER_BUFFER_AHEAD_SECONDS = 0.75;
export const MEDIA_SEEK_BARRIER_TARGET_TOLERANCE_SECONDS = 0.04;
export const MEDIA_SEEK_BARRIER_TIMEOUT_MS = 4000;
const MEDIA_HAVE_CURRENT_DATA = 2;
const MEDIA_HAVE_FUTURE_DATA = 3;

const isBufferedAtTarget = (
  buffered: BufferedRangesLike,
  targetTime: number,
  requiredEndTime: number,
  toleranceSeconds: number,
) => {
  for (let index = 0; index < buffered.length; index += 1) {
    try {
      const rangeStart = buffered.start(index);
      const rangeEnd = buffered.end(index);
      if (
        rangeStart <= targetTime + toleranceSeconds
        && rangeEnd >= requiredEndTime - toleranceSeconds
      ) {
        return true;
      }
    } catch {
      // Ignore a TimeRanges entry that changed while it was being inspected.
    }
  }
  return false;
};

export const isMediaElementReadyAtTarget = ({
  allowCurrentData = false,
  buffered,
  bufferAheadSeconds = MEDIA_SEEK_BARRIER_BUFFER_AHEAD_SECONDS,
  currentTime,
  duration = 0,
  readyState,
  seeking,
  targetTime,
  toleranceSeconds = MEDIA_SEEK_BARRIER_TARGET_TOLERANCE_SECONDS,
}: MediaSeekReadinessInput) => {
  if (seeking || Math.abs(currentTime - targetTime) > toleranceSeconds) {
    return false;
  }

  if (readyState >= MEDIA_HAVE_FUTURE_DATA) {
    return true;
  }

  if (readyState < MEDIA_HAVE_CURRENT_DATA) {
    return false;
  }

  if (allowCurrentData) {
    return true;
  }

  const safeDuration = Number.isFinite(duration) && duration > 0
    ? duration
    : Number.POSITIVE_INFINITY;
  const requiredEndTime = Math.min(
    safeDuration,
    targetTime + Math.max(0.1, bufferAheadSeconds),
  );

  return isBufferedAtTarget(
    buffered,
    targetTime,
    requiredEndTime,
    toleranceSeconds,
  );
};

const createAbortError = () => {
  const error = new Error('Media seek barrier was cancelled.');
  error.name = 'AbortError';
  return error;
};

export const seekMediaElementAndWait = (
  mediaElement: HTMLMediaElement,
  targetTime: number,
  {
    bufferAheadSeconds = MEDIA_SEEK_BARRIER_BUFFER_AHEAD_SECONDS,
    duration = 0,
    label = 'pista',
    signal,
    timeoutMs = MEDIA_SEEK_BARRIER_TIMEOUT_MS,
    toleranceSeconds = MEDIA_SEEK_BARRIER_TARGET_TOLERANCE_SECONDS,
  }: WaitForMediaSeekBarrierOptions = {},
): Promise<void> => {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeTargetTime = safeDuration > 0
    ? Math.min(Math.max(0, targetTime), Math.max(0, safeDuration - 0.001))
    : Math.max(0, targetTime);
  const requiresSeekConfirmation =
    Math.abs(mediaElement.currentTime - safeTargetTime) > toleranceSeconds;

  return new Promise((resolve, reject) => {
    let settled = false;
    let seekConfirmed = !requiresSeekConfirmation;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

    const cleanup = () => {
      ['canplay', 'canplaythrough', 'loadeddata', 'progress'].forEach((eventName) => {
        mediaElement.removeEventListener(eventName, handleProgress);
      });
      mediaElement.removeEventListener('seeked', handleSeeked);
      mediaElement.removeEventListener('error', handleError);
      signal?.removeEventListener('abort', handleAbort);
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const checkReadiness = () => {
      if (signal?.aborted) {
        finish(createAbortError());
        return;
      }
      if (!seekConfirmed) {
        return;
      }
      if (isMediaElementReadyAtTarget({
        allowCurrentData: seekConfirmed,
        buffered: mediaElement.buffered,
        bufferAheadSeconds,
        currentTime: mediaElement.currentTime,
        duration: safeDuration,
        readyState: mediaElement.readyState,
        seeking: mediaElement.seeking,
        targetTime: safeTargetTime,
        toleranceSeconds,
      })) {
        finish();
      }
    };

    function handleProgress() {
      checkReadiness();
    }

    function handleSeeked() {
      seekConfirmed = true;
      checkReadiness();
    }

    function handleError() {
      finish(new Error(`No se pudo preparar "${label}" en ${safeTargetTime.toFixed(2)}s.`));
    }

    function handleAbort() {
      finish(createAbortError());
    }

    ['canplay', 'canplaythrough', 'loadeddata', 'progress'].forEach((eventName) => {
      mediaElement.addEventListener(eventName, handleProgress);
    });
    mediaElement.addEventListener('seeked', handleSeeked);
    mediaElement.addEventListener('error', handleError);
    signal?.addEventListener('abort', handleAbort, { once: true });

    timeoutId = globalThis.setTimeout(() => {
      finish(
        new Error(
          `Tiempo agotado preparando "${label}" en ${safeTargetTime.toFixed(2)}s.`,
        ),
      );
    }, Math.max(250, timeoutMs));

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    try {
      mediaElement.currentTime = safeTargetTime;
    } catch {
      finish(new Error(`No se pudo posicionar "${label}" en ${safeTargetTime.toFixed(2)}s.`));
      return;
    }

    checkReadiness();
  });
};
