import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import microphoneIcon from '@iconify-icons/mdi/microphone';
import guitarAcousticIcon from '@iconify-icons/mdi/guitar-acoustic';
import guitarElectricIcon from '@iconify-icons/mdi/guitar-electric';
import pianoIcon from '@iconify-icons/mdi/piano';
import drumIcon from '@iconify-icons/mdi/music-circle';
import violinIcon from '@iconify-icons/mdi/violin';
import speakerIcon from '@iconify-icons/mdi/speaker';
import scriptTextIcon from '@iconify-icons/mdi/script-text';
import musicNoteIcon from '@iconify-icons/mdi/music-note';
import { supabase } from '../../lib/supabase';
import { normalizeRosterAssignments } from '../../lib/roster-utils';
import { getEventThemeAndPreacher } from '../../lib/event-display.js';
import { isEventRepertoryManagerRoleCode } from '../../lib/role-permissions.js';

const getRoleBadgeIcon = (role) => {
    const codigo = String(role?.codigo || '').toLowerCase();
    const nombre = String(role?.nombre || '').toLowerCase();
    const text = `${codigo} ${nombre}`.trim();

    if (
        text.includes('voz') ||
        text.includes('direccion') ||
        text.includes('direcciÃ³n') ||
        text.includes('talkback') ||
        text.includes('lider_alabanza') ||
        text.includes('lÃ­der de alabanza')
    ) return microphoneIcon;

    if (text.includes('guitarra_acustica') || text.includes('guitarra acÃºstica')) return guitarAcousticIcon;

    if (
        text.includes('guitarra_electrica') ||
        text.includes('guitarra elÃ©ctrica') ||
        text.includes('bajo')
    ) return guitarElectricIcon;

    if (text.includes('piano') || text.includes('teclado')) return pianoIcon;
    if (text.includes('bateria') || text.includes('baterÃ­a')) return drumIcon;
    if (text.includes('violin') || text.includes('violÃ­n')) return violinIcon;
    if (text.includes('caja') || text.includes('cajon') || text.includes('cajÃ³n')) return speakerIcon;
    if (text.includes('encargado_letras') || text.includes('encargado de letras')) return scriptTextIcon;

    return musicNoteIcon;
};

const RosterIcon = ({ role }) => {
    const icon = getRoleBadgeIcon(role);
    const codigo = String(role?.codigo || '').toLowerCase();
    const nombre = String(role?.nombre || '').toLowerCase();
    const isPianoBadge = codigo.includes('piano') || nombre.includes('teclado');

    return <Icon icon={icon} className={isPianoBadge ? 'w-3 h-3' : 'w-3.5 h-3.5'} />;
};

const getCleanName = (name = '') => String(name || '').replace(/\s*\(.*?\)\s*/g, '').trim();

const getInitials = (name = '') => {
    const cleanName = getCleanName(name);
    return cleanName
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part[0])
        .join('')
        .substring(0, 2)
        .toUpperCase() || 'RD';
};

const getRoleSection = (role = {}) => {
    const codigo = String(role?.codigo || '').toLowerCase();
    const nombre = String(role?.nombre || '').toLowerCase();
    const text = `${codigo} ${nombre}`.trim();

    if (
        isEventRepertoryManagerRoleCode(codigo) ||
        text.includes('direccion') ||
        text.includes('dirección') ||
        text.includes('lider_alabanza') ||
        text.includes('líder de alabanza')
    ) {
        return { key: 'direccion', label: 'Dirección', accent: 'text-violet-400', line: 'bg-violet-400/24' };
    }

    if (
        codigo.includes('encargado_letras') ||
        codigo.includes('letra_y_notas') ||
        codigo.includes('produccion_visual') ||
        codigo.includes('letras') ||
        nombre.includes('letras')
    ) {
        return { key: 'letras', label: 'Letras', accent: 'text-amber-400', line: 'bg-amber-400/24' };
    }

    if (codigo.startsWith('voz_') || nombre.includes('voz') || nombre.includes('vocal')) {
        return { key: 'voces', label: 'Voces', accent: 'text-blue-400', line: 'bg-blue-400/24' };
    }

    if (
        text.includes('sonido') ||
        text.includes('audio') ||
        text.includes('consola') ||
        text.includes('multimedia') ||
        text.includes('video') ||
        text.includes('visual')
    ) {
        return { key: 'produccion', label: 'Producción', accent: 'text-sky-300', line: 'bg-sky-300/24' };
    }

    return { key: 'banda', label: 'Banda', accent: 'text-teal-300', line: 'bg-teal-300/24' };
};

const getSongArtworkUrl = (song = {}) => {
    const directArtwork =
        song.portada ||
        song.imagen ||
        song.image ||
        song.cover ||
        song.thumbnail ||
        song.artwork ||
        song.album_art ||
        song.albumArt ||
        song.caratula ||
        '';

    if (directArtwork) return directArtwork;
    if (!song.mp3) return '';

    return `/api/mp3-cover-art?src=${encodeURIComponent(song.mp3)}`;
};

function SongArtwork({ song }) {
    const [failed, setFailed] = useState(false);
    const artworkUrl = getSongArtworkUrl(song);

    if (!artworkUrl || failed) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.38),transparent_36%),linear-gradient(135deg,rgba(255,255,255,0.14),rgba(255,255,255,0.03))] text-white/74">
                <Icon icon={musicNoteIcon} className="h-7 w-7" aria-hidden="true" />
            </div>
        );
    }

    return (
        <img
            src={artworkUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
        />
    );
}

export default function ModalDetalle({ initialRoles, sessionUser, isAdmin = false }) {
    const [isOpen, setIsOpen] = useState(false);
    const [eventData, setEventData] = useState(null);
    const [playlist, setPlaylist] = useState(null);
    const [playlistItems, setPlaylistItems] = useState([]);
    const [loadingPlaylist, setLoadingPlaylist] = useState(false);
    const [focusSection, setFocusSection] = useState(null);
    const [activeTab, setActiveTab] = useState('repertorio');
    const [flashPlaylistSection, setFlashPlaylistSection] = useState(false);
    const playlistSectionRef = useRef(null);
    const previousBottomNavHiddenRef = useRef(null);

    useEffect(() => {
        // Register global hook for CalendarioGrid
        window.openDetalleReact = (cardData, options = {}) => {
            if (!cardData) return;
            setEventData(cardData);
            setFocusSection(options?.focusSection || null);
            setActiveTab(options?.focusSection === 'equipo' ? 'equipo' : 'repertorio');
            setIsOpen(true);
            document.body.style.overflow = 'hidden';
            fetchPlaylist(cardData.dbData?.id);
        };
    }, []);

    useEffect(() => {
        if (!isOpen || focusSection !== 'repertorio') return;

        const scrollTimer = setTimeout(() => {
            if (playlistSectionRef.current) {
                playlistSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setFlashPlaylistSection(true);
                setTimeout(() => setFlashPlaylistSection(false), 1200);
            }
        }, 240);

        return () => clearTimeout(scrollTimer);
    }, [isOpen, focusSection, playlistItems.length, loadingPlaylist]);

    useEffect(() => {
        if (!isOpen || typeof document === 'undefined') return undefined;

        const root = document.documentElement;
        previousBottomNavHiddenRef.current = root.getAttribute('data-bottom-nav-hidden');
        root.setAttribute('data-bottom-nav-hidden', 'true');

        return () => {
            if (previousBottomNavHiddenRef.current === null) {
                root.removeAttribute('data-bottom-nav-hidden');
            } else {
                root.setAttribute('data-bottom-nav-hidden', previousBottomNavHiddenRef.current);
            }
        };
    }, [isOpen]);

    const fetchPlaylist = async (eventoId) => {
        if (!eventoId) return;
        setLoadingPlaylist(true);
        try {
            const { data: pl } = await supabase
                .from('playlists')
                .select('id, created_at, updated_at')
                .eq('evento_id', eventoId)
                .single();

            if (!pl) {
                setPlaylist(null);
                setPlaylistItems([]);
                return;
            }
            setPlaylist(pl);

            const { data: items } = await supabase
                .from('playlist_canciones')
                .select('orden, cancion_id, canciones(id, titulo, cantante, tonalidad, bpm, mp3, link_youtube, link_acordes, link_letras, link_voces, link_secuencias)')
                .eq('playlist_id', pl.id)
                .order('orden');

            const uniqueItems = [];
            const seenSongs = new Set();

            (items || []).forEach((item) => {
                const c = item?.canciones || {};
                const dedupeKey = item?.cancion_id || c?.id || `${(c?.titulo || '').trim().toLowerCase()}::${(c?.cantante || '').trim().toLowerCase()}`;
                if (!dedupeKey || seenSongs.has(dedupeKey)) return;
                seenSongs.add(dedupeKey);
                uniqueItems.push(item);
            });

            setPlaylistItems(uniqueItems);
        } catch (err) {
            console.error('Error fetching playlist:', err);
        } finally {
            setLoadingPlaylist(false);
        }
    };

    const handleClose = () => {
        setIsOpen(false);
        document.body.style.overflow = '';
        // Wait for animation before clearing data
        setTimeout(() => {
            setEventData(null);
            setPlaylist(null);
            setPlaylistItems([]);
            setFocusSection(null);
            setFlashPlaylistSection(false);
        }, 300);
    };

    if (!isOpen && !eventData) return null;

    const fechaObj = eventData?.fecha || new Date();
    const titulo = eventData?.dbData?.titulo || 'Actividad Redil';
    const { theme: temaPrincipal, preacher: predicador } = getEventThemeAndPreacher(eventData?.dbData || {}, titulo);
    const eventNote =
        String(eventData?.dbData?.descripcion || '').trim() ||
        String(eventData?.dbData?.anexo || '').trim() ||
        String(eventData?.dbData?.notas || '').trim() ||
        String(eventData?.dbData?.observaciones || '').trim() ||
        String(predicador || '').trim();

    const mesStr = fechaObj.toLocaleString('es-ES', { month: 'short' });
    const fechaFormat = `${fechaObj.toLocaleString('es-ES', { weekday: 'long' })} ${fechaObj.getDate()} ${mesStr}`;
    const horaInicio = fechaObj.toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const timeString = eventData?.dbData?.hora_fin ? `${horaInicio} - ${eventData.dbData.hora_fin.substring(0, 5)}` : horaInicio;

    const roster = normalizeRosterAssignments(eventData?.dbData?.asignaciones || [], initialRoles || [], { maxVoiceSlots: 4 });
    const rolesById = new Map((initialRoles || []).map((role) => [role.id, role]));
    const rosterGroupsMap = new Map();

    roster.forEach((asig) => {
        if (!asig?.perfiles) return;
        const role = rolesById.get(asig.rol_id) || asig.roles || {};
        const section = getRoleSection(role);
        const group = rosterGroupsMap.get(section.key) || { ...section, members: [] };
        group.members.push({ assignment: asig, profile: asig.perfiles, role });
        rosterGroupsMap.set(section.key, group);
    });

    const rosterGroups = ['direccion', 'letras', 'banda', 'voces', 'produccion']
        .map((key) => rosterGroupsMap.get(key))
        .filter(Boolean);
    const eventoId = eventData?.dbData?.id || '';
    const miAsignacion = roster.find((asig) => asig?.perfiles?.id === sessionUser?.id || asig?.perfiles?.email === sessionUser?.email);
    let isModerator = false;
    if (miAsignacion) {
        const miRolObj = initialRoles?.find?.((r) => r.id === miAsignacion.rol_id);
        if (miRolObj && (isEventRepertoryManagerRoleCode(miRolObj.codigo) || miRolObj.codigo === 'moderador')) {
            isModerator = true;
        }
    }
    const canManageRepertorio = isAdmin || isModerator;
    const manageRepertorioLabel = playlistItems.length > 0 ? 'Editar repertorio' : 'Armar repertorio';

    const rehearsalHref = eventoId ? `/ensayo/${eventoId}` : '/ensayo/demo';

    const handleManageRepertorio = () => {
        if (!eventoId) return;
        window.location.href = `/repertorio?seleccionar_para=${eventoId}`;
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-hidden={isOpen ? 'false' : 'true'}
            data-ui-modal="true"
            className={`fixed inset-0 z-[140] min-h-[100dvh] items-start justify-center overflow-y-auto bg-zinc-950/76 p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-md transition-opacity duration-300 sm:p-4 sm:pt-6 lg:flex lg:items-start lg:px-6 lg:pb-6 lg:pt-[7vh] ${isOpen ? 'flex opacity-100' : 'pointer-events-none opacity-0'}`}
            onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
            <div className={`relative my-0 flex max-h-[84dvh] w-[calc(100%-0.35rem)] max-w-2xl flex-col overflow-hidden rounded-[24px] border border-white/12 bg-[linear-gradient(145deg,rgba(20,26,35,0.98),rgba(9,12,17,0.98))] text-white shadow-[0_30px_90px_rgba(0,0,0,0.54)] transition-transform duration-300 sm:max-h-[calc(100dvh-112px-env(safe-area-inset-bottom))] sm:w-full sm:rounded-[28px] lg:my-0 lg:max-h-[calc(100dvh-8.5rem)] lg:max-w-[1180px] xl:max-w-[1260px] ${isOpen ? 'scale-100' : 'scale-95'}`}>
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(59,130,246,0.16),transparent_34%),radial-gradient(circle_at_96%_0%,rgba(59,130,246,0.10),transparent_28%)]" />

                <button
                    type="button"
                    onClick={handleClose}
                    aria-label="Cerrar detalle"
                    className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white sm:right-4 sm:top-4 sm:h-10 sm:w-10"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>

                <div className="relative z-10 shrink-0 border-b border-white/10 px-3 pb-2.5 pt-4 sm:px-7 sm:pb-4 sm:pt-8 lg:px-8 lg:py-6">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 pr-9 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-center lg:gap-x-8 lg:gap-y-0 lg:pr-12">
                        <div className="min-w-0">
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 lg:block">
                                <div className="min-w-0">
                                    <h2 className="text-[1.35rem] font-black capitalize leading-none tracking-tight text-white min-[390px]:text-[1.5rem] sm:text-[2.85rem] sm:leading-[0.9] lg:text-[2.35rem]">
                                        {fechaFormat}
                                    </h2>
                                    {temaPrincipal ? (
                                        <p className="mt-1.5 text-[0.95rem] font-semibold leading-tight text-white/68 min-[390px]:text-base sm:mt-3 sm:text-xl lg:mt-2 lg:text-lg">
                                            <span className="text-action">{temaPrincipal}</span>
                                        </p>
                                    ) : null}
                                </div>
                                <span className="mt-0.5 inline-flex h-8 w-max items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-2.5 text-xs font-bold text-white/76 shadow-inner min-[390px]:text-[13px] sm:h-11 sm:gap-2 sm:px-4 sm:text-base lg:hidden">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-action sm:h-[17px] sm:w-[17px]"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                    {timeString}
                                </span>
                            </div>
                            {eventNote ? (
                                <p className="mt-2 line-clamp-1 max-w-3xl text-[12px] font-light leading-4 text-white/62 min-[390px]:text-[13px] sm:mt-3 sm:line-clamp-2 sm:text-base sm:leading-7 lg:mt-3 lg:line-clamp-1 lg:text-base lg:leading-6">
                                    {eventNote}
                                </p>
                            ) : null}
                        </div>

                        <div className="col-span-2 flex min-w-0 flex-col gap-3 lg:col-span-1 lg:items-stretch">
                            <span className="hidden h-10 w-max items-center gap-2 self-end rounded-full border border-white/12 bg-white/[0.06] px-4 text-sm font-bold text-white/76 shadow-inner lg:inline-flex">
                                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-action"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                {timeString}
                            </span>
                            <a
                                href={rehearsalHref}
                                className="group relative inline-flex min-h-[42px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl border border-blue-300/30 bg-[linear-gradient(135deg,#3b82f6,#1d4ed8)] px-4 py-2 text-sm font-black text-white shadow-[0_12px_28px_rgba(37,99,235,0.30)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(37,99,235,0.42)] min-[390px]:min-h-[44px] min-[390px]:text-[15px] sm:min-h-[58px] sm:gap-3 sm:rounded-2xl sm:px-6 sm:py-3 sm:text-lg lg:min-h-[48px] lg:text-base"
                            >
                                <span className="absolute inset-0 translate-y-full bg-white/14 transition-transform duration-300 group-hover:translate-y-0" />
                                <Icon icon={musicNoteIcon} className="relative z-10 h-[1.125rem] w-[1.125rem] sm:h-7 sm:w-7 lg:h-5 lg:w-5" aria-hidden="true" />
                                <span className="relative z-10">Entrar a Modo Ensayo</span>
                            </a>
                        </div>
                    </div>
                </div>

                <div className="relative z-10 flex min-h-0 flex-1 flex-col">
                    <div className="grid grid-cols-2 border-b border-white/10 px-4 sm:px-7 lg:px-8">
                        {[
                            { id: 'repertorio', label: 'Repertorio' },
                            { id: 'equipo', label: `Equipo (${roster.length})` },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`relative h-10 text-sm font-black transition-colors sm:h-14 sm:text-base ${activeTab === tab.id ? 'text-action' : 'text-white/55 hover:text-white/78'}`}
                            >
                                {tab.label}
                                <span className={`absolute inset-x-0 bottom-0 h-1 rounded-t-full bg-action transition-opacity ${activeTab === tab.id ? 'opacity-100' : 'opacity-0'}`} />
                            </button>
                        ))}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-7 sm:py-5 lg:px-8 lg:py-6">
                        {activeTab === 'repertorio' ? (
                            <div ref={playlistSectionRef} className={`grid gap-3 rounded-2xl transition-shadow sm:gap-4 ${flashPlaylistSection ? 'shadow-[0_0_0_2px_rgba(59,130,246,0.48)]' : ''}`}>
                                {loadingPlaylist ? (
                                    <div className="flex justify-center py-14"><div className="h-9 w-9 animate-spin rounded-full border-4 border-blue-400/25 border-t-blue-400" /></div>
                                ) : !playlist ? (
                                    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/14 bg-white/[0.035] px-5 py-12 text-center">
                                        <Icon icon={musicNoteIcon} className="mb-3 h-9 w-9 text-white/40" aria-hidden="true" />
                                        <p className="text-base font-black text-white/70">Sin repertorio asignado</p>
                                    </div>
                                ) : playlistItems.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/14 bg-white/[0.035] px-5 py-12 text-center">
                                        <Icon icon={musicNoteIcon} className="mb-3 h-9 w-9 text-white/40" aria-hidden="true" />
                                        <p className="text-base font-black text-white/70">Repertorio sin canciones</p>
                                        {canManageRepertorio && (
                                            <button
                                                type="button"
                                                onClick={handleManageRepertorio}
                                                className="mt-5 inline-flex min-h-[46px] items-center justify-center gap-2 rounded-2xl border border-action/60 bg-transparent px-5 py-3 text-base font-bold text-action transition-colors hover:bg-action/10"
                                            >
                                                <span>{manageRepertorioLabel}</span>
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid gap-2.5 sm:gap-3 lg:grid-cols-2">
                                            {playlistItems.map((item, idx) => {
                                                const c = item.canciones || {};
                                                const order = idx + 1;
                                                return (
                                                    <article key={`${item.cancion_id || c.id || idx}-${order}`} className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-blue-400/36 hover:bg-white/[0.055]">
                                                        <div className="grid min-w-0 grid-cols-[3.85rem_minmax(0,1fr)_2.4rem] items-center gap-2 p-2 min-[390px]:grid-cols-[4.35rem_minmax(0,1fr)_2.65rem] min-[390px]:gap-2.5 min-[390px]:p-2.5 sm:grid-cols-[6rem_minmax(0,1fr)_3.25rem] sm:gap-3 sm:p-3.5">
                                                            <div className="h-[3.85rem] w-[3.85rem] overflow-hidden rounded-xl border border-white/10 bg-white/[0.05] shadow-lg min-[390px]:h-[4.35rem] min-[390px]:w-[4.35rem] sm:h-24 sm:w-24">
                                                                <SongArtwork song={c} />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <h3 className="truncate text-[0.95rem] font-black leading-tight text-white min-[390px]:text-base sm:text-xl">
                                                                    {c.titulo || 'Sin título'}
                                                                </h3>
                                                                <p className="mt-0.5 line-clamp-1 text-[11px] font-medium leading-4 text-white/58 min-[390px]:mt-1 min-[390px]:text-xs sm:line-clamp-2 sm:text-base sm:leading-5">
                                                                    {c.cantante || ''}
                                                                </p>
                                                            </div>
                                                            <span className="inline-flex h-8 w-8 items-center justify-center justify-self-end rounded-xl border border-white/12 bg-white/[0.06] text-sm font-black text-white/78 min-[390px]:h-9 min-[390px]:w-9 min-[390px]:text-base sm:h-11 sm:w-11 sm:text-lg">
                                                                {order}
                                                            </span>
                                                        </div>
                                                    </article>
                                                );
                                            })}
                                        </div>
                                        {canManageRepertorio && (
                                            <button
                                                type="button"
                                                onClick={handleManageRepertorio}
                                                className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-action/60 bg-transparent px-5 py-3 text-base font-bold text-action transition-colors hover:bg-action/10"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                                    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                                </svg>
                                                <span>{manageRepertorioLabel}</span>
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="grid gap-4 sm:gap-5 lg:gap-6">
                                {rosterGroups.length > 0 ? rosterGroups.map((group) => (
                                    <section key={group.key} className="grid gap-2.5 sm:gap-3">
                                        <div className="flex items-center gap-3">
                                            <h3 className={`shrink-0 text-[11px] font-black uppercase tracking-[0.18em] sm:text-[12px] ${group.accent}`}>
                                                {group.label}
                                            </h3>
                                            <span className={`h-px flex-1 ${group.line}`} aria-hidden="true" />
                                        </div>
                                        <div className={`grid gap-2 sm:gap-2.5 lg:grid-cols-4 xl:grid-cols-5 ${group.members.length === 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
                                            {group.members.map(({ assignment, profile, role }) => {
                                                const roleName = role?.nombre || assignment?.roles?.nombre || 'Equipo';
                                                const displayName = getCleanName(profile.nombre) || profile.nombre || 'Persona';
                                                return (
                                                    <article key={`${assignment.rol_id}-${profile.id || profile.email || displayName}`} className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.025] p-2 text-left">
                                                        <div className="relative h-11 w-11 shrink-0 sm:h-12 sm:w-12 lg:h-13 lg:w-13">
                                                            {profile.avatar_url ? (
                                                                <img
                                                                    src={profile.avatar_url}
                                                                    alt={profile.nombre}
                                                                    loading="lazy"
                                                                    decoding="async"
                                                                    className="h-full w-full rounded-full border border-white/14 object-cover shadow-[0_8px_20px_rgba(0,0,0,0.30)]"
                                                                />
                                                            ) : (
                                                                <div className="flex h-full w-full items-center justify-center rounded-full border border-action/24 bg-action/12 text-base font-black text-action shadow-[0_8px_20px_rgba(0,0,0,0.26)] sm:text-lg">
                                                                    {getInitials(profile.nombre)}
                                                                </div>
                                                            )}
                                                            <span className="absolute -right-1 -top-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/14 bg-zinc-950 text-action shadow-[0_8px_20px_rgba(0,0,0,0.35)] sm:h-7 sm:w-7">
                                                                <RosterIcon role={role} />
                                                            </span>
                                                        </div>
                                                        <div className="min-w-0">
                                                            <h4 className="truncate text-sm font-black leading-tight text-white sm:text-base">
                                                                {displayName}
                                                            </h4>
                                                            <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[0.10em] text-white/46 sm:text-[11px]">
                                                                {roleName}
                                                            </p>
                                                        </div>
                                                    </article>
                                                );
                                            })}
                                        </div>
                                    </section>
                                )) : (
                                    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/14 bg-white/[0.035] px-5 py-12 text-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mb-3 text-white/36"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m19 8 3 3-3 3" /></svg>
                                        <p className="text-base font-black text-white/70">Nadie asignado aún al equipo</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
