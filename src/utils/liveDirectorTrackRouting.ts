export type TrackOutputRoute = 'left' | 'right' | 'stereo';

type TrackRoutingCandidate = {
  id?: unknown;
  name?: unknown;
  outputRoute?: unknown;
};

const GUIDE_ROUTE_REGEX = /\b(click|clcik|guide|guia|cue|cues|tempo|metro|metronomo|count in)\b/i;

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

  if (!normalizedId && !normalizedName) {
    return false;
  }

  return GUIDE_ROUTE_REGEX.test(`${normalizedId} ${normalizedName}`.trim());
};

export const resolveTrackOutputRoute = (track: TrackRoutingCandidate): TrackOutputRoute => {
  const explicitRoute = normalizeTrackOutputRoute(track?.outputRoute);
  if (explicitRoute) {
    return explicitRoute;
  }

  return isGuideRoutingTrack(track) ? 'left' : 'stereo';
};

export const toggleGuideTrackOutputRoute = (track: TrackRoutingCandidate): TrackOutputRoute => (
  resolveTrackOutputRoute(track) === 'right' ? 'left' : 'right'
);
