export const LIVE_DIRECTOR_STEMS_ORIGIN = 'https://stems.alabanzaredilestadio.com';

export const primeLiveDirectorStemConnection = (): void => {
  if (typeof document === 'undefined') {
    return;
  }

  const ensureHint = (rel: 'preconnect' | 'dns-prefetch') => {
    const selector = `link[rel="${rel}"][href="${LIVE_DIRECTOR_STEMS_ORIGIN}"]`;
    if (document.head.querySelector(selector)) {
      return;
    }

    const link = document.createElement('link');
    link.rel = rel;
    link.href = LIVE_DIRECTOR_STEMS_ORIGIN;
    if (rel === 'preconnect') {
      link.crossOrigin = 'anonymous';
    }
    document.head.appendChild(link);
  };

  ensureHint('dns-prefetch');
  ensureHint('preconnect');
};
