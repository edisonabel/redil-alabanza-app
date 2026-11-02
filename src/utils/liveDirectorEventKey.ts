// Tono de una canción en un evento: una copia transportada de sus pistas, solo para ese evento. La canción
// original no se toca, y la copia se borra sola cuando el evento termina.
export type EventKeyTrack = { url: string; sourceUrl: string };
export type EventKey = { semitones: number; targetKey: string; originalKey: string; tracks: Record<string, EventKeyTrack>; mp3?: EventKeyTrack; updatedAt?: string };
type SessionTrack = { id: string; name?: string; url: string; optimizedUrl?: string; iosUrl?: string; nativeUrl?: string; cafUrl?: string; pcmUrl?: string; sourceFileName?: string; enabled?: boolean };

export const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const ROOTS: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
  Do: 0, 'Do#': 1, Reb: 1, Re: 2, 'Re#': 3, Mib: 3, Mi: 4, Fa: 5, 'Fa#': 6, Solb: 6, Sol: 7, 'Sol#': 8, Lab: 8, La: 9, 'La#': 10, Sib: 10, Si: 11 };

// Solo se transporta lo armónico. Click, guía y toda la percusión quedan iguales: procesarlos los ensuciaría,
// tardaría más y ocuparía almacenamiento sin ganar nada.
const UNPITCHED = /click|metronom|guide|guia|\bcues?\b|\bconteo\b|\bcount\b|drum|bateria|perc|kick|bombo|snare|redoblante|\bcaja\b|hi ?hat|\bhats?\b|\btoms?\b|overhead|\boh\b|cymbal|platillo|shake|tambourine|pandereta|conga|bongo|cajon|clap|palmas|tumba|timbal|guira|guiro|maraca|cencerro|cowbell|agogo|triangulo|\bclaves?\b|\bride\b|\bcrash\b|\bloops?\b/;
export const isTransposableTrack = (track: Pick<SessionTrack, 'id' | 'name'>) =>
  !UNPITCHED.test(`${track.name || ''} ${track.id || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_-]+/g, ' '));

export function parseSongKey(raw?: string | null): { index: number; minor: boolean } | null {
  const source = String(raw || '').trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s+/g, '');
  const minor = source.length > 1 && /m$/.test(source) && !/^(Fa|Si|Sol|Mi|Do|Re|La)$/.test(source);
  const index = ROOTS[minor ? source.slice(0, -1) : source];
  return index === undefined ? null : { index, minor };
}
/** El camino más corto: nunca más de 6 semitonos, para no degradar el audio de más. */
export const semitonesBetween = (from: number, to: number) => { const up = ((to - from) % 12 + 12) % 12; return up > 6 ? up - 12 : up; };

/** Las pistas transportadas reemplazan a las originales, salvo que la secuencia se haya vuelto a subir. */
export function applyEventKey<T extends { tracks?: SessionTrack[] } | null | undefined>(session: T, eventKey?: EventKey | null): T {
  if (!session?.tracks || !eventKey) return session;
  const fresh = Object.entries(eventKey.tracks).every(([id, track]) => session.tracks!.some(item => item.id === id && item.url === track.sourceUrl));
  if (!fresh) return session;
  return { ...session, tracks: session.tracks.map(track => {
    const shifted = eventKey.tracks[track.id];
    return shifted ? { ...track, url: shifted.url, optimizedUrl: undefined, iosUrl: undefined, nativeUrl: undefined, cafUrl: undefined, pcmUrl: undefined, sourceFileName: `${track.id}.m4a` } : track;
  }) };
}
export const isEventKeyFresh = (session: { tracks?: SessionTrack[] } | null | undefined, eventKey?: EventKey | null) => Boolean(eventKey && applyEventKey(session, eventKey) !== session);

// El MP3 de ensayo tiene su propia copia. Si la canción cambió de MP3 después, suena el MP3 nuevo tal cual.
export const EVENT_KEY_MP3_ID = 'ensayo-mp3';
export function withEventMp3<T extends { mp3?: string | null } | null | undefined>(song: T, eventKey?: Pick<EventKey, 'targetKey' | 'mp3'> | null): T {
  return song && eventKey?.mp3 && eventKey.mp3.sourceUrl === song.mp3 ? { ...song, mp3: eventKey.mp3.url, eventMp3Key: eventKey.targetKey } : song;
}

// Candado: lo único que el cambio de tono puede borrar son sus propias copias. Los stems originales viven
// en secuencias/ y ningún camino de esta función los toca.
export const EVENT_KEY_PREFIX = 'live-director/event-keys/';
export const isEventKeyCopy = (key: string) => key.startsWith(EVENT_KEY_PREFIX) && !key.includes('..');

const API = '/api/live-director-event-key';
const cacheKey = (eventId: string, songId: string) => `live-director:event-key:${eventId}:${songId}`;
const remember = (eventId: string, songId: string, key: EventKey | null) => {
  try { if (key) localStorage.setItem(cacheKey(eventId, songId), JSON.stringify(key)); else localStorage.removeItem(cacheKey(eventId, songId)); } catch { /* sin almacenamiento */ }
};
const parse = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `No se pudo guardar el tono (${response.status}).`);
  return body;
};
/** Sin conexión se usa lo último que vio este equipo: en pleno servicio la canción no puede volver a su tono original. */
export async function readEventKey(eventId: string, songId: string): Promise<{ key: EventKey | null; canEdit: boolean }> {
  try {
    const body = await parse(await fetch(`${API}?evento_id=${encodeURIComponent(eventId)}&cancion_id=${encodeURIComponent(songId)}`, { credentials: 'same-origin', cache: 'no-store' }));
    remember(eventId, songId, body.key || null);
    return { key: body.key || null, canEdit: body.canEdit === true };
  } catch {
    try { return { key: JSON.parse(localStorage.getItem(cacheKey(eventId, songId)) || 'null'), canEdit: false }; } catch { return { key: null, canEdit: false }; }
  }
}
/** Tonos de este evento por canción, para mostrar el correcto en la lista. */
export type ListedEventKey = Pick<EventKey, 'semitones' | 'targetKey' | 'originalKey' | 'mp3'>;
export async function readEventKeys(eventId: string): Promise<Record<string, ListedEventKey>> {
  const body = await parse(await fetch(`${API}?evento_id=${encodeURIComponent(eventId)}`, { credentials: 'same-origin', cache: 'no-store' }));
  return body.keys || {};
}
const send = async (method: string, body: unknown) => parse(await fetch(API, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
export const requestEventKeyUpload = (eventId: string, songId: string, semitones: number, trackId: string): Promise<{ uploadUrl: string; key: string }> =>
  send('POST', { evento_id: eventId, cancion_id: songId, semitones, track_id: trackId });
export async function saveEventKey(eventId: string, songId: string, payload: { semitones: number; targetKey: string; originalKey: string; tracks: Array<{ id: string; key: string; sourceUrl: string }>; mp3?: { key: string; sourceUrl: string } | null }): Promise<EventKey> {
  const { key } = await send('PUT', { evento_id: eventId, cancion_id: songId, ...payload });
  remember(eventId, songId, key);
  return key;
}
/** Tras cancelar o fallar: borra lo subido a medias sin tocar el tono que ya estaba. */
export const discardUnfinishedEventKey = (eventId: string, songId: string) => send('DELETE', { evento_id: eventId, cancion_id: songId, only_unfinished: true }).catch(() => null);
export async function clearEventKey(eventId: string, songId: string) {
  await send('DELETE', { evento_id: eventId, cancion_id: songId });
  remember(eventId, songId, null);
}
