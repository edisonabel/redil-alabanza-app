create table if not exists public.configuracion_app (
  id integer primary key,
  colores jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint configuracion_app_singleton check (id = 1)
);

insert into public.configuracion_app (id, colores)
values (
  1,
  jsonb_build_object(
    'brand', '#14b8a6',
    'danger', '#ef4444',
    'success', '#22c55e',
    'warning', '#f59e0b',
    'info', '#3b82f6',
    'accent', '#ec4899'
  )
)
on conflict (id) do nothing;
