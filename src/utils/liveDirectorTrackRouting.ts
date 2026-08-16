export type TrackOutputRoute = 'left' | 'right' | 'stereo';
export type LiveDirectorOutputLayout = 'guide-left' | 'guide-right';

type TrackRoutingCandidate = {
  id?: unknown;
  name?: unknown;
  sourceFileName?: unknown;
  outputRoute?: unknown;
};

const GUIDE_ROUTE_REGEX = /\b(click(?:track)?|clic|clcik|guide(?:track|vox)?|guia|guias|cue(?:track)?|cues|tempo|metro|metronomo|count in|talkback)\b/i;

const normalizeRoutingToken = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeTrackOutputRoute = (value: unknown): TrackOutputRoute | null => {
  if (value === 'left' || value === 'right' || value === 'stereo') {
    return value;
  }

  return null;
};

export const isGuideRoutingTrack = (track: TrackRoutingCandidate): boolean => {
  const normalizedId = normalizeRoutingToken(track?.id);
  const normalizedName = normalizeRoutingToken(track?.name);
  const normalizedSourceFileName = normalizeRoutingToken(track?.sourceFileName);

  if (!normalizedId && !normalizedName && !normalizedSourceFileName) {
    return false;
  }

  return GUIDE_ROUTE_REGEX.test(
    `${normalizedId} ${normalizedName} ${normalizedSourceFileName}`.trim(),
  );
};

export const resolveTrackOutputRoute = (track: TrackRoutingCandidate): TrackOutputRoute => {
  const explicitRoute = normalizeTrackOutputRoute(track?.outputRoute);
  const isGuideTrack = isGuideRoutingTrack(track);

  // Old sessions could persist a guide as generic stereo before hard routing
  // existed. Preserve deliberate L/R choices, but repair that historical
  // stereo value so Click/Cue/Guide cannot leak to both outputs.
  if (explicitRoute && !(isGuideTrack && explicitRoute === 'stereo')) {
    return explicitRoute;
  }

  return isGuideTrack ? 'left' : 'stereo';
};

export const resolveTrackOutputRouteForLayout = (
  track: TrackRoutingCandidate,
  layout: LiveDirectorOutputLayout,
): TrackOutputRoute => {
  const guideOnRight = layout === 'guide-right';
  if (isGuideRoutingTrack(track)) {
    return guideOnRight ? 'right' : 'left';
  }

  return guideOnRight ? 'left' : 'right';
};

export const nextLiveDirectorOutputLayout = (
  layout: LiveDirectorOutputLayout,
): LiveDirectorOutputLayout => (
  layout === 'guide-right' ? 'guide-left' : 'guide-right'
);

export const toggleGuideTrackOutputRoute = (track: TrackRoutingCandidate): TrackOutputRoute => (
  resolveTrackOutputRoute(track) === 'right' ? 'left' : 'right'
);
