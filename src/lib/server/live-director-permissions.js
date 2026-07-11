import { isLiveDirectorSequenceManagerRoleCode } from '../role-permissions.js';

export const canManageLiveDirectorUploads = async ({ serviceRoleClient, userId }) => {
  const { data: perfil, error: perfilError } = await serviceRoleClient
    .from('perfiles')
    .select('id, is_admin')
    .eq('id', userId)
    .single();

  if (perfilError) throw perfilError;
  if (perfil?.is_admin) return true;

  const { data: profileRoles, error: profileRolesError } = await serviceRoleClient
    .from('perfil_roles')
    .select('rol_id')
    .eq('perfil_id', userId);

  if (profileRolesError) throw profileRolesError;

  const roleIds = [...new Set((profileRoles || []).map((row) => row?.rol_id).filter(Boolean))];
  if (roleIds.length === 0) return false;

  const { data: roles, error: rolesError } = await serviceRoleClient
    .from('roles')
    .select('codigo')
    .in('id', roleIds);

  if (rolesError) throw rolesError;

  return (roles || []).some((role) => isLiveDirectorSequenceManagerRoleCode(role?.codigo));
};

export const assertCanManageLiveDirectorUploads = async ({ serviceRoleClient, userId }) => {
  const allowed = await canManageLiveDirectorUploads({ serviceRoleClient, userId });
  if (!allowed) {
    const error = new Error('No autorizado. Necesitas el rol Gestor de Secuencias para modificar secuencias.');
    error.status = 403;
    throw error;
  }
};
