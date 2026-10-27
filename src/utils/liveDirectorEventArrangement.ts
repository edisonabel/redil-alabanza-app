import type { ArrangementEntry } from './liveDirectorArrangement';
import { fetchWithSessionRetry } from './authenticatedFetch.js';
export type EventArrangement = { entries: ArrangementEntry[] | null; sourceSignature: string; version: 1 };
export function normalizeEventArrangement(value: unknown): EventArrangement {
  const raw = value as Partial<EventArrangement> | null;
  if (!raw || raw.version !== 1 || typeof raw.sourceSignature !== 'string' || raw.sourceSignature.length > 20000) throw new Error('Arreglo inválido.');
  if (raw.entries === null) return { version: 1, entries: null, sourceSignature: raw.sourceSignature };
  if (!Array.isArray(raw.entries) || raw.entries.length < 1 || raw.entries.length > 80) throw new Error('El arreglo debe tener entre 1 y 80 secciones.');
  const ids = new Set<string>();
  const entries = raw.entries.map(entry => {
    if (!entry || typeof entry.id !== 'string' || typeof entry.sectionId !== 'string' || !entry.id || !entry.sectionId || entry.id.length > 160 || entry.sectionId.length > 160 || ids.has(entry.id)) throw new Error('El arreglo contiene secciones inválidas.');
    ids.add(entry.id); return { id: entry.id, sectionId: entry.sectionId };
  });
  return { version: 1, entries, sourceSignature: raw.sourceSignature };
}
export async function fetchEventArrangement(eventId: string, songId: string) {
  const response = await fetchWithSessionRetry(`/api/live-director-event-arrangement?${new URLSearchParams({ evento_id: eventId, cancion_id: songId })}`, { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || 'No se pudo cargar el arreglo del evento.');
  return { arrangement: body.arrangement ? normalizeEventArrangement(body.arrangement) : null, canEdit: body.canEdit === true, revision: String(body.revision || ''), sourceSignature: String(body.sourceSignature || '') };
}
export async function saveEventArrangement(eventId: string, songId: string, arrangement: EventArrangement, revision: string) {
  const response = await fetchWithSessionRetry('/api/live-director-event-arrangement', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ evento_id: eventId, cancion_id: songId, arrangement: normalizeEventArrangement(arrangement), revision }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || 'No se pudo guardar el arreglo.');
  return { arrangement: normalizeEventArrangement(body.arrangement), revision: String(body.revision || '') };
}
