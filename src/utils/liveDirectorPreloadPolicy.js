const IOS_WEB_USER_AGENT_PATTERN = /iPad|iPhone|iPod/i;
const ANDROID_WEB_USER_AGENT_PATTERN = /Android/i;
const MACINTOSH_USER_AGENT_PATTERN = /Macintosh/i;

/**
 * Full-file Cache API prewarm competes with the active producer's Range
 * requests on mobile browsers. Native preload keeps its separate route;
 * desktop web retains the existing Cache API behavior.
 */
export const shouldRunLiveDirectorFullFileWebPrewarm = ({
  hasNativePreloadEngine = false,
  isNativeRuntime = false,
  maxTouchPoints = 0,
  userAgent = '',
  userAgentDataMobile = false,
} = {}) => {
  if (hasNativePreloadEngine) {
    return false;
  }

  if (isNativeRuntime) {
    return true;
  }

  const normalizedUserAgent = String(userAgent || '');
  const isIOSWeb = IOS_WEB_USER_AGENT_PATTERN.test(normalizedUserAgent);
  const isAndroidWeb = ANDROID_WEB_USER_AGENT_PATTERN.test(normalizedUserAgent);
  const isTouchIPadOS = (
    MACINTOSH_USER_AGENT_PATTERN.test(normalizedUserAgent) &&
    Number(maxTouchPoints) > 1
  );

  return !(
    userAgentDataMobile === true ||
    isIOSWeb ||
    isAndroidWeb ||
    isTouchIPadOS
  );
};
