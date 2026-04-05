-- ── Roles: Pastor y Audiovisuales ──────────────────────────────────────────
-- Estos roles tienen los mismos permisos que un músico regular pero
-- además pueden editar el tema de predicación y el predicador de un evento.

insert into public.roles (id, codigo, nombre)
values
  (gen_random_uuid(), 'pastor',        'Pastor / Predicador'),
  (gen_random_uuid(), 'audiovisuales', 'Audiovisuales')
on conflict (codigo) do nothing;

-- ── Helper: verifica si el usuario actual tiene alguno de estos roles ──────
create or replace function public.has_sermon_edit_role()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from public.perfil_roles pr
    join public.roles r on r.id = pr.rol_id
    where pr.perfil_id = auth.uid()
      and r.codigo in ('pastor', 'audiovisuales')
  );
$$;

-- ── RPC: actualizar solo tema_predicacion + predicador ────────────────────
-- Solo pueden llamarla: admins, pastores y audiovisuales.
create or replace function public.update_evento_tema(
  p_evento_id  uuid,
  p_tema       text,
  p_predicador text
)
returns void
language plpgsql
security definer
as $$
declare
  v_is_admin boolean;
begin
  select is_admin into v_is_admin
  from public.perfiles
  where id = auth.uid();

  if not (v_is_admin or public.has_sermon_edit_role()) then
    raise exception 'No autorizado para editar el tema de predicación';
  end if;

  update public.eventos
  set
    tema_predicacion = p_tema,
    predicador       = p_predicador
  where id = p_evento_id;
end;
$$;

-- Revocar ejecución pública y otorgársela solo a usuarios autenticados
revoke execute on function public.update_evento_tema(uuid, text, text) from public;
grant  execute on function public.update_evento_tema(uuid, text, text) to authenticated;
