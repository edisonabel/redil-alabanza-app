import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase.js';
import RosterManager from '../RosterManager.jsx';
import ModalEvento from '../ModalEvento.jsx';
import CalendarioGrid from '../CalendarioGrid.jsx';

const roles = [{ id: 'guitar-role', codigo: 'guitarra_acustica', nombre: 'Guitarra electroacústica' }, { id: 'caja-role', codigo: 'caja', nombre: 'Caja' }];
const ministries = [{ id: 'sf', codigo: 'sin_filtros', nombre: 'Sin Filtros' }, { id: 'general', codigo: 'alabanza_general', nombre: 'Alabanza general' }];
roles.push({ id: 'direction-role', codigo: 'lider_alabanza', nombre: 'Líder de alabanza' }, { id: 'lyrics-role', codigo: 'encargado_letras', nombre: 'Letras' }, { id: 'voice-role', codigo: 'voz_principal', nombre: 'Voz' });
const profiles = ['Ana', 'Luis', 'Sara'].map((nombre, i) => ({ id: `profile-${i}`, nombre, avatar_url: null }));
const event = { id: 'preview-event', titulo: 'Sin Filtros', fecha_hora: '2026-10-03T18:30:00-05:00', hora_fin: '19:30', ministerio_id: 'sf', ministerios: ministries[0], estado: 'Publicado', es_acustico: true, asignaciones: [] };

const comparisonEvents = [
    { ...event, id: 'notice-preview', sin_servicio_motivo: 'Asamblea de miembros' },
    { ...event, id: 'active-preview', fecha_hora: '2026-10-10T18:30:00-05:00', tema_predicacion: 'Una fe que permanece', predicador: 'Luis', asignaciones: [
        { id: 'dir', rol_id: 'direction-role', perfiles: profiles[0] },
        { id: 'lyrics', rol_id: 'lyrics-role', perfiles: profiles[1] },
        { id: 'guitar', rol_id: 'guitar-role', perfiles: profiles[2] },
        ...profiles.map((profile, i) => ({ id: `voice-${i}`, rol_id: 'voice-role', perfiles: profile })),
    ] },
];

// Esta vista se sirve únicamente en DEV. Cada consulta utiliza datos locales.
export default function EventSchedulingPreview() {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const originalFrom = supabase.from;
        const originalRpc = supabase.rpc;
        const originalFetch = window.fetch;
        const assignments = [];
        window.appStateRoles = roles;
        window.__SSR_USER__ = { id: 'leader' };
        supabase.from = (table) => {
            let payload = null;
            const query = {
                select: () => query, eq: () => query, neq: () => query, gte: () => query, lte: () => query,
                order: () => query, in: () => query, update: (value) => { payload = value; return query; },
                single: () => Promise.resolve({ data: { ...event, ...payload, asignaciones: [...assignments] }, error: null }),
                then: (resolve) => Promise.resolve({ data: table === 'asignaciones' ? [...assignments]
                    : table === 'perfil_roles' ? profiles.map((profile) => ({ perfil_id: profile.id, rol_id: 'guitar-role', perfiles: profile }))
                    : table === 'roles' ? roles : table === 'eventos' ? comparisonEvents : [], error: null }).then(resolve),
            };
            return query;
        };
        supabase.rpc = async (name, args) => {
            if (name === 'can_manage_event_assignments') return { data: true, error: null };
            if (name === 'get_event_eligible_profile_ids') return { data: profiles.map((profile) => ({ perfil_id: profile.id })), error: null };
            if (name === 'assign_event_acoustic_guitar') {
                const index = assignments.findIndex((a) => a.id === args.p_asignacion_id);
                if (index >= 0) assignments.splice(index, 1);
                assignments.push({ id: `assignment-${args.p_perfil_id}`, rol_id: args.p_rol_id, perfil_id: args.p_perfil_id, perfiles: profiles.find((p) => p.id === args.p_perfil_id) });
                return { data: {}, error: null };
            }
            return { data: [], error: null };
        };
        window.fetch = async (url, options) => String(url).startsWith('/api/')
            ? new Response(JSON.stringify({ ok: true, blocked_profiles: [], items: [], event_date: '2026-10-03' }), { headers: { 'content-type': 'application/json' } })
            : originalFetch(url, options);
        setReady(true);
        return () => { supabase.from = originalFrom; supabase.rpc = originalRpc; window.fetch = originalFetch; };
    }, []);
    if (!ready) return null;
    return <main className="mx-auto max-w-6xl space-y-8 p-5 text-content">
        <h1 className="text-2xl font-bold">Programación · Vista local</h1>
        <CalendarioGrid initialEvents={comparisonEvents} initialRoles={roles} sessionUser={{ id: 'leader' }} leaderMinistryIds={['sf']} initialToday="2026-10-01" initialLoadUntil="2026-12-31T23:59:59Z" hasMoreInitialEvents={false} />
        <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-5 text-lg font-bold">Formato acústico · dos electroacústicas</h2>
            <RosterManager evId={event.id} evFechaStr="2026-10-03" esAcustico dbData={event} canEditRoster />
        </section>
        <button className="min-h-11 rounded-xl border border-border bg-surface px-4" onClick={() => window.toggleModalGlobal?.(true, 'edit', { id: event.id, fecha: event.fecha_hora, titulo: event.titulo, estado: event.estado, hora_fin: event.hora_fin, moderator: 'true', dbData: event })}>Gestionar servicio activo</button>
        <ModalEvento initialMinistries={ministries} />
    </main>;
}
