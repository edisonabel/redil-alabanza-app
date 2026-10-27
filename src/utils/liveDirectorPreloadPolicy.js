/**
 * Full-file Cache API prewarm competes with the active producer's Range
 * requests on desktop too. It also bypasses the active transport's
 * request scheduling. Native preload keeps its existing separate policy.
 */
export const shouldRunLiveDirectorFullFileWebPrewarm = ({
  hasNativePreloadEngine = false,
  isNativeRuntime = false,
} = {}) => {
  if (hasNativePreloadEngine) {
    return false;
  }

  if (isNativeRuntime) {
    return true;
  }

  return false;
};
