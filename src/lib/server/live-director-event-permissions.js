// Catalog membership is not event authority. Only the person assigned as
// musical director in this event (Talkback) and an administrator may write.
export async function getLiveDirectorEventAccess(database, userId, eventId) {
  const [profile, assignments] = await Promise.all([
    database.from('perfiles').select('is_admin').eq('id', userId).maybeSingle(),
    database.from('asignaciones').select('roles(codigo)').eq('evento_id', eventId).eq('perfil_id', userId),
  ]);
  if (profile.error || assignments.error) throw new Error('No se pudo validar el acceso al evento.');
  const isAdmin = profile.data?.is_admin === true;
  const rows = assignments.data || [];
  const isDirector = rows.some(row => {
    const roles = Array.isArray(row.roles) ? row.roles : [row.roles];
    return roles.some(role => ['talkback', 'director_musical'].includes(String(role?.codigo || '').trim().toLowerCase()));
  });
  return { canRead: isAdmin || rows.length > 0, canWrite: isAdmin || isDirector };
}
