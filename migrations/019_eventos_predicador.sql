alter table public.eventos
add column if not exists predicador text;

comment on column public.eventos.predicador is
'Nombre del predicador o expositor asociado al tema del evento.';
