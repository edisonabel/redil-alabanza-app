export const canOpenLiveDirectorSongLoader = ({
  isManualTempoMode,
  hasPersistedSongContext,
  hasProvidedTracks,
  requiresSongContext,
}: {
  isManualTempoMode: boolean;
  hasPersistedSongContext: boolean;
  hasProvidedTracks: boolean;
  requiresSongContext: boolean;
}): boolean => (
  (!isManualTempoMode || hasPersistedSongContext)
  && !hasProvidedTracks
  && (!requiresSongContext || hasPersistedSongContext)
);
