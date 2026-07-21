export type LiveDirectorBrowserCapabilities = {
  audioDecoder?: boolean;
  crossOriginIsolated?: boolean;
  isAndroid?: boolean;
  isChromeFamily?: boolean;
  isIOS?: boolean;
  isSafari?: boolean;
  sharedArrayBuffer?: boolean;
};

export type StreamingFallbackPolicy =
  | { action: 'block'; reason: 'ios-multitrack-requires-worker' }
  | { action: 'block'; reason: 'desktop-multitrack-requires-worker' }
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
 * Browser branding can be hidden or rewritten by embedded browsers. Select the
 * desktop exact-seek route from the APIs the engine actually needs instead of
 * trusting only a Chrome token in the user agent.
 */
export const supportsDesktopExactSeekRoute = (
  capabilities: LiveDirectorBrowserCapabilities,
) => Boolean(
  !capabilities.isIOS &&
  !capabilities.isAndroid &&
  !capabilities.isSafari &&
  (
    capabilities.isChromeFamily ||
    (
      capabilities.audioDecoder &&
      capabilities.sharedArrayBuffer &&
      capabilities.crossOriginIsolated
    )
  )
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

  if (supportsDesktopExactSeekRoute(capabilities) && hasMultipleTracks(trackCount)) {
    return { action: 'block', reason: 'desktop-multitrack-requires-worker' };
  }

  if (capabilities.isSafari && hasMultipleTracks(trackCount)) {
    return { action: 'force-buffer', reason: 'desktop-safari-needs-shared-clock' };
  }

  return { action: 'auto', reason: 'compatible-fallback-allowed' };
};

/**
 * Multi-stem iOS and capable desktop sessions are considered stable only while
 * decoding in the producer worker and playing through one AudioWorklet clock.
 */
export const requiresSynchronizedStreamingWorker = (
  capabilities: LiveDirectorBrowserCapabilities,
  trackCount: number,
) => Boolean(
  hasMultipleTracks(trackCount) &&
  (capabilities.isIOS || supportsDesktopExactSeekRoute(capabilities)),
);

/**
 * Capable desktop engines can discard the first synchronous AAC batch after a
 * forward section target. Seek exact samples and wait for every stem, while
 * preserving the proven rule that only backward movement performs a hard reset.
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
      exactSampleSeek: supportsDesktopExactSeekRoute(capabilities),
      requireCompleteReady: true,
    };
  }

  if (supportsDesktopExactSeekRoute(capabilities)) {
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
