export type LiveDirectorBrowserCapabilities = {
  isIOS?: boolean;
  isSafari?: boolean;
};

export type StreamingFallbackPolicy =
  | { action: 'block'; reason: 'ios-multitrack-requires-worker' }
  | { action: 'force-buffer'; reason: 'desktop-safari-needs-shared-clock' }
  | { action: 'auto'; reason: 'compatible-fallback-allowed' };

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

  if (capabilities.isSafari && hasMultipleTracks(trackCount)) {
    return { action: 'force-buffer', reason: 'desktop-safari-needs-shared-clock' };
  }

  return { action: 'auto', reason: 'compatible-fallback-allowed' };
};

/**
 * A multi-stem iOS session is considered stable only while decoding in the
 * dedicated producer worker and playing through one AudioWorklet clock.
 */
export const requiresSynchronizedStreamingWorker = (
  capabilities: LiveDirectorBrowserCapabilities,
  trackCount: number,
) => Boolean(capabilities.isIOS && hasMultipleTracks(trackCount));
