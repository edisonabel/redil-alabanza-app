export const sanitizeVoiceTrackAnchors = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

export const extractVoiceTrackAnchorsFromPayload = (value) => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return sanitizeVoiceTrackAnchors(
      parsed?.trackAnchors || parsed?.voiceTrackAnchors || parsed?.__trackAnchors,
    );
  } catch {
    return {};
  }
};

export const shiftSectionMarkersForVoiceTrack = (sectionMarkers = [], anchorStartSec = null) => {
  const safeMarkers = Array.isArray(sectionMarkers) ? sectionMarkers : [];
  const offset = Number(anchorStartSec);
  if (!Number.isFinite(offset) || offset <= 0) return safeMarkers;

  return safeMarkers.map((marker, index) => {
    const startSec = Number(marker?.startSec ?? marker?.start_sec ?? marker?.time ?? marker?.seconds);
    if (!Number.isFinite(startSec) || startSec < 0 || startSec < offset - 0.35) return null;

    const rawEndSec = Number(marker?.endSec ?? marker?.end_sec);
    const shiftedStartSec = Math.max(0, startSec - offset);
    const shiftedEndSec = Number.isFinite(rawEndSec) && rawEndSec > offset
      ? Math.max(shiftedStartSec, rawEndSec - offset)
      : null;

    return {
      ...marker,
      id: marker?.id || `voice-section-${index}`,
      startSec: shiftedStartSec,
      time: shiftedStartSec,
      seconds: shiftedStartSec,
      endSec: shiftedEndSec,
    };
  }).filter(Boolean);
};

/**
 * The saved startSec already includes the vocal track's pre-roll. Apply it once,
 * identically for event rehearsal and playback from the repertoire.
 * @param {{chordpro?: string, sectionMarkers?: any[], voiceTrackAnchors?: Record<string, any>, linkVoces?: unknown}} song
 * @param {string} trackName Canonical voice label used when saving the anchor.
 */
export const buildVoiceTrackLyricSync = (song = {}, trackName = '') => {
  const anchors = {
    ...extractVoiceTrackAnchorsFromPayload(song.linkVoces),
    ...sanitizeVoiceTrackAnchors(song.voiceTrackAnchors),
  };
  const anchor = anchors[trackName];
  return {
    chordpro: song.chordpro || '',
    sectionMarkers: shiftSectionMarkersForVoiceTrack(song.sectionMarkers || [], anchor?.startSec),
    subtitle: anchor?.sectionLabel ? `Desde ${anchor.sectionLabel}` : 'Practica vocal',
  };
};
