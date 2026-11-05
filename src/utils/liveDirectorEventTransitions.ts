import { fetchWithSessionRetry } from './authenticatedFetch.js';
import { normalizeSongTransitions, type SongTransition } from './liveDirectorSongTransitions';

// Transiciones del evento en el servidor: las guarda el líder de alabanza, el director musical o un
// administrador, y cualquier equipo del evento las usa. `transitions: null` = el evento aún no tiene.
const API = '/api/live-director-event-transitions';
export async function fetchEventSongTransitions(eventId: string): Promise<{ transitions: Record<string, SongTransition> | null; canEdit: boolean }> {
  const response = await fetchWithSessionRetry(`${API}?${new URLSearchParams({ evento_id: eventId })}`, { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudieron leer las transiciones del evento.');
  return { transitions: body.transitions ? normalizeSongTransitions(body.transitions) : null, canEdit: body.canEdit === true };
}
export async function saveEventSongTransitions(eventId: string, transitions: Record<string, SongTransition>) {
  const response = await fetchWithSessionRetry(API, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ evento_id: eventId, transitions }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se guardaron las transiciones del evento.');
}
