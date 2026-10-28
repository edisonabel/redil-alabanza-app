import { buildClickCarrierUrl, isClickCarrierUrl } from './silentClickCarrier.js';

// Canción sin stems: el mapa de REAPER (tempo, compás, UNO, FIN AUDIO, secciones e instrucciones) se
// aplica sobre una sesión que solo trae la pista virtual de click. En el Live Director suena el click
// digital (con el tempo y el compás de REAPER) y el pad interno; el MP3 fue solo la referencia en REAPER.
export const CLICK_ONLY_TRACK_ID = 'click-digital';

/** @returns {boolean} La sesión es de una canción sin stems (solo la pista virtual de click). */
export const isClickOnlySession = (session) => Boolean(
  session && Array.isArray(session.tracks) && session.tracks.length > 0 &&
  session.tracks.every((track) => isClickCarrierUrl(track?.url)),
);

/**
 * @param {{ songId: string, songTitle: string, finAudioSeconds: number, appliedAt: string,
 *   sectionMarkers: Array<{ id: string, sectionName: string, startSec: number }>,
 *   instructionMarkers?: Array<{ id: string, name: string, startSec: number }>,
 *   reaperTiming: Record<string, unknown> }} options
 */
export function buildClickOnlySession({ songId, songTitle, finAudioSeconds, appliedAt, sectionMarkers, instructionMarkers = [], reaperTiming }) {
  const url = buildClickCarrierUrl(finAudioSeconds);
  if (!url) throw new Error('FIN AUDIO debe estar entre 1 segundo y 30 minutos para crear el click.');
  return {
    version: 1,
    songId: String(songId),
    songTitle: String(songTitle || ''),
    mode: 'sequence',
    sectionOffsetSeconds: 0,
    sectionMarkers,
    instructionMarkers,
    reaperTiming,
    folder: '',
    manifestUrl: '',
    updatedAt: appliedAt,
    tracks: [{ id: CLICK_ONLY_TRACK_ID, name: 'Click', url, volume: 1, isMuted: false, enabled: true, sourceFileName: 'click-digital.m4a' }],
    unmatchedFiles: [],
  };
}
