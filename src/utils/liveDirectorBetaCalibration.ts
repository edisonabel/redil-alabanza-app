import providencia from '../../lab/providencia-reaper-map.json';
import clickGrids from '../../lab/click-grids.json';

// Overlay confirmed timing in this beta only. Never update canciones or stems.
export function applyBetaSongCalibration<T extends Record<string, any>>(song: T): T {
  if (String(song?.id || '') !== providencia.songId) return song;
  return { ...song, bpm: providencia.bpm, timeSignature: providencia.timeSignature, sectionMarkers: providencia.sectionMarkers };
}

export function applyBetaSessionCalibration<T extends { sectionOffsetSeconds?: number } | null>(songId: string, session: T): T {
  return session && songId === providencia.songId ? { ...session, sectionOffsetSeconds: 0 } : session;
}

export const betaClickGrid = (songId: string) => (
  (clickGrids as Record<string, { bpm: number; originSeconds: number }>)[songId]
);
