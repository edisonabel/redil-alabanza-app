// Consultar la misma regla RLS usada por los RPC de asignación. No inferir
// permisos globales a partir del catálogo de roles de una persona.
export async function canManageEventAssignments(database, eventId) {
  const { data, error } = await database.rpc('can_manage_event_assignments', { evt_id: eventId });
  if (error) throw error;
  return data === true;
}

export const isLeaderForEventMinistry = (event, leaderMinistryIds = [], generalMinistryId = '') => {
  const ministryId = String(event?.ministerio_id || generalMinistryId || '');
  return Boolean(ministryId) && leaderMinistryIds.some((id) => String(id) === ministryId);
};
