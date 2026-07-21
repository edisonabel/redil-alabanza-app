export type LiveDirectorBrowserCapabilities = {
  isAndroid?: boolean;
  isChromeFamily?: boolean;
  isIOS?: boolean;
  isSafari?: boolean;
};

export type StreamingFallbackPolicy =
  | { action: 'block'; reason: 'ios-multitrack-requires-worker' }
  | { action: 'block'; reason: 'chrome-multitrack-requires-worker' }
  | { action: 'force-buffer'; reason: 'desktop-safari-needs-shared-clock' }
  | { action: 'auto'; reason: 'compatible-fallback-allowed' };

export type StreamingSeekPolicy = {
  hardReset: boolean;
  decodePrerollSeconds: number;
  exactSampleSeek: boolean;
  requireCompleteReady: boolean;
};

const hasMultipleTracks = (trackCount: number) => (
  Number.isFinite(trackCount) && Math.max(0, Math.floor(trackCount)) > 1
);

/**
 * iOS must never degrade a multitrack session to one HTMLMediaElement per stem.
 * Those elements use independent clocks and become expensive and unstable when
 * a session contains many stems. Desktop Safari can safely use decoded buffers
 * because every stem then remains on the same AudioContext clock.
 */
export const resolveStreamingFallbackPolicy = (
  capabilities: LiveDirectorBrowserCapabilities,
  trackCount: number,
): StreamingFallbackPolicy => {
  if (capabilities.isIOS && hasMultipleTracks(trackCount)) {
    return { action: 'block', reason: 'ios-multitrack-requires-worker' };
  }

  if (capabilities.isChromeFamily && hasMultipleTracks(trackCount)) {
    return { action: 'block', reason: 'chrome-multitrack-requires-worker' };
  }

  if (capabilities.isSafari && hasMultipleTracks(trackCount)) {
    return { action: 'force-buffer', reason: 'desktop-safari-needs-shared-clock' };
  }

  return { action: 'auto', reason: 'compatible-fallback-allowed' };
};

/**
 * Multi-stem iOS and Chrome sessions are considered stable only while decoding
 * in the dedicated producer worker and playing through one AudioWorklet clock.
 */
export const requiresSynchronizedStreamingWorker = (
  capabilities: LiveDirectorBrowserCapabilities,
  trackCount: number,
) => Boolean(
  hasMultipleTracks(trackCount) &&
  (capabilities.isIOS || capabilities.isChromeFamily),
);

/**
 * Chrome desktop can discard the first synchronous AAC batch after a forward
 * section target. Seek exact samples and wait for every stem, while preserving
 * the proven rule that only backward movement performs a hard reset.
 */
export const resolveStreamingSeekPolicy = (
  capabilities: LiveDirectorBrowserCapabilities,
  options: { isBackwardSeek: boolean; targetIsHead: boolean },
): StreamingSeekPolicy => {
  const hardReset = options.isBackwardSeek || options.targetIsHead;
  if (hardReset) {
    return {
      hardReset: true,
      decodePrerollSeconds: options.isBackwardSeek ? 3 : 0,
      exactSampleSeek: false,
      requireCompleteReady: true,
    };
  }

  const isDesktopChrome = Boolean(
    capabilities.isChromeFamily && !capabilities.isIOS && !capabilities.isAndroid,
  );
  if (isDesktopChrome) {
    return {
      hardReset: false,
      decodePrerollSeconds: 0,
      exactSampleSeek: true,
      requireCompleteReady: true,
    };
  }

  return {
    hardReset: false,
    decodePrerollSeconds: 0,
    exactSampleSeek: false,
    requireCompleteReady: false,
  };
};
