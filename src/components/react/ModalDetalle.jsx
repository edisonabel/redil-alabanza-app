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

const getRoleBadgeIcon = (role) => {
    const codigo = String(role?.codigo || '').toLowerCase();
    const nombre = String(role?.nombre || '').toLowerCase();
    const text = `${codigo} ${nombre}`.trim();

    if (
        text.includes('voz') ||
        text.includes('direccion') ||
        text.includes('dirección') ||
        text.includes('talkback') ||
        text.includes('lider_alabanza') ||
        text.includes('líder de alabanza')
    ) return microphoneIcon;

    if (text.includes('guitarra_acustica') || text.includes('guitarra acústica')) return guitarAcousticIcon;

    if (
        text.includes('guitarra_electrica') ||
        text.includes('guitarra eléctrica') ||
        text.includes('bajo')
    ) return guitarElectricIcon;

    if (text.includes('piano') || text.includes('teclado')) return pianoIcon;
    if (text.includes('bateria') || text.includes('batería')) return drumIcon;
    if (text.includes('violin') || text.includes('violín')) return violinIcon;
    if (text.includes('caja') || text.includes('cajon') || text.includes('cajón')) return speakerIcon;
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

export default function ModalDetalle({ initialRoles }) {
    const [isOpen, setIsOpen] = useState(false);
    const [eventData, setEventData] = useState(null);
    const [playlist, setPlaylist] = useState(null);
    const [playlistItems, setPlaylistItems] = useState([]);
    const [loadingPlaylist, setLoadingPlaylist] = useState(false);
    const [focusSection, setFocusSection] = useState(null);
    const [flashPlaylistSection, setFlashPlaylistSection] = useState(false);
    const playlistSectionRef = useRef(null);

    useEffect(() => {
        // Register global hook for CalendarioGrid
        window.openDetalleReact = (cardData, options = {}) => {
            if (!cardData) return;
            setEventData(cardData);
            setFocusSection(options?.focusSection || null);
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
                .select('orden, cancion_id, canciones(id, titulo, cantante, tonalidad, bpm, link_youtube, link_acordes, link_letras, link_voces, link_secuencias)')
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
    const tema = eventData?.dbData?.tema_predicacion || titulo;
    const estado = eventData?.dbData?.estado || 'Activo';

    const mesStr = fechaObj.toLocaleString('es-ES', { month: 'short' });
    const fechaFormat = `${fechaObj.toLocaleString('es-ES', { weekday: 'long' })} ${fechaObj.getDate()} ${mesStr}`;
    const horaInicio = fechaObj.toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const timeString = eventData?.dbData?.hora_fin ? `${horaInicio} - ${eventData.dbData.hora_fin.substring(0, 5)}` : horaInicio;

    const roster = eventData?.dbData?.asignaciones || [];

    // URL parameter for rehearsal mode
    let rehearsalHref = '';
    if (playlistItems.length > 0) {
        const setlistArray = playlistItems.map(item => item.canciones?.titulo).filter(Boolean);
        const base64Str = btoa(encodeURIComponent(JSON.stringify(setlistArray)));
        rehearsalHref = `/repertorio?setlist=${encodeURIComponent(base64Str)}`;
    }

    return (
        <div className={`fixed inset-0 z-[70] bg-overlay/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
            <div className={`bg-surface border border-border rounded-[24px] md:rounded-3xl w-full max-w-2xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden transition-transform duration-300 ${isOpen ? 'scale-100' : 'scale-95'}`}>
                {/* Header */}
                <div className="p-6 border-b border-border flex justify-between items-start bg-background shrink-0">
                    <div>
                        <span className="inline-block px-3 py-1 bg-brand/10 text-brand rounded-full text-xs font-bold tracking-widest uppercase mb-3 border border-brand/30 shadow-sm">{estado}</span>
                        <h2 className="text-3xl font-black text-content tracking-tight capitalize">{fechaFormat}</h2>
                        <div className="flex items-center gap-2 mt-2">
                            <span className="text-content-muted font-medium text-lg capitalize">{tema !== titulo ? tema : titulo}</span>
                            <span className="text-sm font-bold text-content-muted bg-border/50 px-2 py-0.5 rounded-md ml-2">{timeString}</span>
                        </div>
                    </div>
                    <button onClick={handleClose} className="text-content-muted hover:text-content transition-colors p-2 bg-background hover:bg-border rounded-full shadow-sm border border-border">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                {/* Body scrollable */}
                <div className="p-6 overflow-y-auto flex-1 bg-surface">
                    {/* Assigned Personnel */}
                    <div className="mb-8 relative z-10">
                        <h4 className="text-xs font-bold text-content-muted uppercase tracking-widest mb-4 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                            Personal Asignado
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {roster.length > 0 ? roster.map((asig, idx) => {
                                if (!asig.perfiles) return null;
                                const p = asig.perfiles;
                                const rNombre = initialRoles?.find?.(r => r.id === asig.rol_id)?.nombre || asig.roles?.nombre || 'MÃºsico';
                                const rCodigo = initialRoles?.find?.(r => r.id === asig.rol_id)?.codigo || asig.roles?.codigo || '';

                                const cleanName = p.nombre.replace(/\s*\(.*?\)\s*/g, '').trim();
                                const initials = cleanName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

                                return (
                                    <div key={idx} className="flex items-center gap-4 p-3 rounded-2xl border border-border bg-background hover:bg-surface transition-colors group relative overflow-hidden">
                                        <div className="relative">
                                            {p.avatar_url ? (
                                                <img src={p.avatar_url} alt={p.nombre} className="w-14 h-14 shrink-0 rounded-full object-cover shadow-sm bg-surface" />
                                            ) : (
                                                <div className="w-14 h-14 shrink-0 rounded-full bg-brand/10 text-brand border border-brand/30 flex items-center justify-center font-black text-lg shadow-sm">{initials}</div>
                                            )}
                                            <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-surface rounded-full flex items-center justify-center shadow-md border border-border text-content-muted">
                                                <RosterIcon role={{ codigo: rCodigo, nombre: rNombre }} />
                                            </div>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-content text-base truncate">{p.nombre}</p>
                                            <p className="text-xs font-semibold text-content-muted uppercase tracking-wider">{rNombre}</p>
                                        </div>
                                    </div>
                                );
                            }) : (
                                <div className="col-span-1 md:col-span-2 flex flex-col items-center justify-center py-8 opacity-50 bg-background rounded-2xl border border-border border-dashed">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-3 text-content-muted"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m19 8 3 3-3 3" /></svg>
                                    <p className="font-bold text-base text-content-muted">Nadie asignado aÃºn al roster</p>
                                </div>
                            )}
                        </div>
                    </div>

                                        {/* Setlist */}
                    <div
                        ref={playlistSectionRef}
                        className={`relative z-10 rounded-2xl transition-shadow ${flashPlaylistSection ? 'shadow-[0_0_0_2px_rgba(20,184,166,0.45)]' : ''}`}
                    >
                        <h4 className="text-xs font-bold text-content-muted uppercase tracking-widest mb-4 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                            Repertorio / Setlist
                        </h4>

                        <div className="bg-background border border-border rounded-[24px] p-5 shadow-inner min-h-[150px]">
                            {loadingPlaylist ? (
                                <div className="flex justify-center py-10"><div className="w-8 h-8 border-4 border-brand/30 border-t-brand rounded-full animate-spin"></div></div>
                            ) : !playlist ? (
                                <div className="flex flex-col items-center justify-center py-6 opacity-60">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" className="mx-auto mb-3 text-content-muted" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                                    <p className="text-sm font-bold text-content-muted">Sin setlist asignada</p>
                                    <p className="text-[11px] text-content-muted mt-1">El lÃ­der de alabanza puede crear una desde el mÃ³dulo Repertorio.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col">
                                    <div className="flex flex-col items-center justify-center w-full gap-2.5 mb-6">
                                        <a href={rehearsalHref} target="_blank" rel="noopener noreferrer" className="group relative inline-flex w-full items-center justify-center gap-3 px-8 py-3 overflow-hidden rounded-xl bg-action text-white font-bold text-sm sm:text-base tracking-wide shadow-lg hover:bg-action/90 hover:-translate-y-0.5 transition-all duration-300">
                                            <div className="absolute inset-0 bg-white/15 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-in-out"></div>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 relative z-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                            <span className="relative z-10">Entrar a Modo Ensayo</span>
                                        </a>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        {playlistItems.length > 0 ? playlistItems.map((item, idx) => {
                                            const c = item.canciones || {};
                                            return (
                                                <article key={idx} className="relative bg-surface border border-border rounded-xl shadow-sm overflow-hidden hover:border-brand/30 transition-colors">
                                                    <div className="px-3 py-2.5 sm:px-4 sm:py-3 flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-brand/10 text-brand border border-brand/30 flex items-center justify-center font-black shrink-0 text-sm shadow-sm">{idx + 1}</div>
                                                        <div className="flex-1 min-w-0">
                                                            <h3 className="text-base font-bold tracking-tight text-content truncate">{c.titulo || 'Sin tÃ­tulo'}</h3>
                                                            <p className="text-xs font-medium text-content-muted truncate">{c.cantante || 'Redil Sur'}</p>
                                                        </div>
                                                    </div>
                                                </article>
                                            )
                                        }) : null}
                                    </div>
                                    <p className="text-[10px] sm:text-xs text-content-muted mt-4 text-center">
                                        Ãšltima modificaciÃ³n: {new Date(playlist.updated_at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}



