import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

const iconSvgPaths = {
    'lider_alabanza': '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    'talkback': '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    'encargado_letras': '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    'voz_soprano': '<path d="m12 8-9.04 9.06a2.82 2.82 0 1 0 3.98 3.98L16 12"/><circle cx="17" cy="7" r="5"/>',
    'voz_tenor': '<path d="m12 8-9.04 9.06a2.82 2.82 0 1 0 3.98 3.98L16 12"/><circle cx="17" cy="7" r="5"/>',
    'bateria': '<path d="m2 2 8 8"/><path d="m22 2-8 8"/><ellipse cx="12" cy="9" rx="10" ry="5"/><path d="M2 9v6c0 2.8 4.5 5 10 5s10-2.2 10-5V9"/>',
    'piano': '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M6 5v4"/><path d="M10 5v4"/><path d="M14 5v4"/><path d="M18 5v4"/>',
    'guitarra_electrica': '<path d="M10 15v4a2 2 0 0 1-2 2v0a2 2 0 0 1-2-2v-4"/><path d="M14 15v4a2 2 0 0 0 2 2v0a2 2 0 0 0 2-2v-4"/><path d="M8 15V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v10"/><path d="M4 15h16"/><path d="M8 11h8"/>',
    'guitarra_acustica': '<path d="M10 15v4a2 2 0 0 1-2 2v0a2 2 0 0 1-2-2v-4"/><path d="M14 15v4a2 2 0 0 0 2 2v0a2 2 0 0 0 2-2v-4"/><path d="M8 15V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v10"/><path d="M4 15h16"/><path d="M8 11h8"/>',
    'bajo': '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    'violin': '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'
};

const DefaultIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-neutral-500" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
);

const RosterIcon = ({ codigo }) => {
    if (!codigo || !iconSvgPaths[codigo]) return <DefaultIcon />;
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-neutral-500" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: iconSvgPaths[codigo] }} />
    );
};

export default function ModalDetalle({ initialRoles }) {
    const [isOpen, setIsOpen] = useState(false);
    const [eventData, setEventData] = useState(null);
    const [playlist, setPlaylist] = useState(null);
    const [playlistItems, setPlaylistItems] = useState([]);
    const [loadingPlaylist, setLoadingPlaylist] = useState(false);

    useEffect(() => {
        // Register global hook for CalendarioGrid
        window.openDetalleReact = (cardData) => {
            if (!cardData) return;
            setEventData(cardData);
            setIsOpen(true);
            document.body.style.overflow = 'hidden';
            fetchPlaylist(cardData.dbData?.id);
        };
    }, []);

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
                .select('orden, canciones(titulo, cantante, tonalidad, bpm, link_youtube, link_acordes, link_letras, link_voces, link_secuencias)')
                .eq('playlist_id', pl.id)
                .order('orden');

            setPlaylistItems(items || []);
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
        <div className={`fixed inset-0 z-[70] bg-white/80 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
            <div className={`bg-white border border-neutral-200 rounded-[24px] md:rounded-3xl w-full max-w-2xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden transition-transform duration-300 ${isOpen ? 'scale-100' : 'scale-95'}`}>
                {/* Header */}
                <div className="p-6 border-b border-neutral-100 flex justify-between items-start bg-neutral-50 shrink-0">
                    <div>
                        <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold tracking-widest uppercase mb-3 border border-blue-200/60 shadow-sm">{estado}</span>
                        <h2 className="text-3xl font-black text-neutral-900 tracking-tight capitalize">{fechaFormat}</h2>
                        <div className="flex items-center gap-2 mt-2">
                            <span className="text-neutral-500 font-medium text-lg capitalize">{tema !== titulo ? tema : titulo}</span>
                            <span className="text-sm font-bold text-neutral-400 bg-neutral-200/50 px-2 py-0.5 rounded-md ml-2">{timeString}</span>
                        </div>
                    </div>
                    <button onClick={handleClose} className="text-neutral-500 hover:text-neutral-800 transition-colors p-2 bg-white rounded-full shadow-sm border border-neutral-200">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                {/* Body scrollable */}
                <div className="p-6 overflow-y-auto flex-1 bg-white">
                    {/* Assigned Personnel */}
                    <div className="mb-8 relative z-10">
                        <h4 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                            Personal Asignado
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {roster.length > 0 ? roster.map((asig, idx) => {
                                if (!asig.perfiles) return null;
                                const p = asig.perfiles;
                                const rNombre = initialRoles?.find?.(r => r.id === asig.rol_id)?.nombre || asig.roles?.nombre || 'Músico';
                                const rCodigo = initialRoles?.find?.(r => r.id === asig.rol_id)?.codigo || asig.roles?.codigo || '';

                                const cleanName = p.nombre.replace(/\s*\(.*?\)\s*/g, '').trim();
                                const initials = cleanName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

                                return (
                                    <div key={idx} className="flex items-center gap-4 p-3 rounded-2xl border border-neutral-100 bg-neutral-50 hover:bg-white transition-colors group relative overflow-hidden">
                                        <div className="relative">
                                            {p.avatar_url ? (
                                                <img src={p.avatar_url} alt={p.nombre} className="w-14 h-14 shrink-0 rounded-full object-cover shadow-sm bg-white" />
                                            ) : (
                                                <div className="w-14 h-14 shrink-0 rounded-full bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center font-black text-lg shadow-sm">{initials}</div>
                                            )}
                                            <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-md border border-neutral-200 text-neutral-600">
                                                <RosterIcon codigo={rCodigo} />
                                            </div>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-neutral-900 text-base truncate">{p.nombre}</p>
                                            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">{rNombre}</p>
                                        </div>
                                    </div>
                                );
                            }) : (
                                <div className="col-span-1 md:col-span-2 flex flex-col items-center justify-center py-8 opacity-50 bg-neutral-50 rounded-2xl border border-neutral-100 border-dashed">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-3 text-neutral-400"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m19 8 3 3-3 3" /></svg>
                                    <p className="font-bold text-base text-neutral-600">Nadie asignado aún al roster</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Playlist */}
                    <div className="relative z-10">
                        <h4 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                            Repertorio / Playlist
                        </h4>

                        <div className="bg-neutral-50 border border-neutral-100 rounded-[24px] p-5 shadow-inner min-h-[150px]">
                            {loadingPlaylist ? (
                                <div className="flex justify-center py-10"><div className="w-8 h-8 border-4 border-teal-500/30 border-t-teal-500 rounded-full animate-spin"></div></div>
                            ) : !playlist ? (
                                <div className="flex flex-col items-center justify-center py-6 opacity-60">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" className="mx-auto mb-3 text-neutral-500" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                                    <p className="text-sm font-bold text-neutral-600">Sin playlist asignada</p>
                                    <p className="text-[11px] text-neutral-500 mt-1">El líder de alabanza puede crear una desde el módulo Repertorio.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col">
                                    <div className="flex flex-col items-center justify-center w-full gap-2.5 mb-6">
                                        <a href={rehearsalHref} target="_blank" rel="noopener noreferrer" className="group relative inline-flex items-center justify-center gap-3 px-8 py-3 w-full sm:w-auto overflow-hidden rounded-xl bg-gradient-to-br from-teal-500 via-emerald-500 to-green-500 text-white font-bold text-sm sm:text-base tracking-wide shadow-lg shadow-teal-500/30 hover:shadow-teal-500/50 hover:-translate-y-0.5 transition-all duration-300">
                                            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 relative z-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                            <span className="relative z-10">Entrar a Modo Ensayo</span>
                                        </a>
                                    </div>
                                    <div className="flex flex-col gap-3">
                                        {playlistItems.length > 0 ? playlistItems.map((item, idx) => {
                                            const c = item.canciones || {};
                                            return (
                                                <article key={idx} className="relative bg-white border border-neutral-200 rounded-2xl shadow-sm flex flex-col mb-2 overflow-hidden hover:border-teal-200 transition-colors">
                                                    <div className="p-4 sm:p-5 flex gap-4">
                                                        <div className="w-10 h-10 rounded-full bg-teal-50 text-teal-600 border border-teal-100 flex items-center justify-center font-black shrink-0 text-lg shadow-sm">{idx + 1}</div>
                                                        <div className="flex-1 min-w-0 flex flex-col pt-0.5">
                                                            <h3 className="text-lg sm:text-xl font-bold tracking-tight text-neutral-900 mb-0.5 truncate">{c.titulo || 'Sin Título'}</h3>
                                                            <p className="text-sm font-medium text-neutral-500 mb-3 truncate">{c.cantante || 'Redil Sur'}</p>
                                                            <div className="flex flex-wrap gap-2 text-[11px] sm:text-xs">
                                                                {c.tonalidad && c.tonalidad !== '-' && (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-700 font-bold tracking-wider">
                                                                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5 text-neutral-500"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                                                                        Key: {c.tonalidad}
                                                                    </span>
                                                                )}
                                                                {c.bpm > 0 && (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-700 font-bold tracking-wider">
                                                                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5 text-neutral-500"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                                                                        {c.bpm} BPM
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
                                                            {c.link_youtube && <a href={c.link_youtube} target="_blank" rel="noreferrer" className="flex items-center justify-center py-2.5 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/20 font-bold text-xs tracking-wide transition-colors">YouTube</a>}
                                                            {c.link_acordes && <a href={c.link_acordes} target="_blank" rel="noreferrer" className="flex items-center justify-center py-2.5 rounded-xl bg-green-500/10 text-green-500 hover:bg-green-500/20 font-bold text-xs tracking-wide transition-colors">Acordes</a>}
                                                            {c.link_voces && <a href={c.link_voces} target="_blank" rel="noreferrer" className="flex items-center justify-center py-2.5 rounded-xl bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 font-bold text-xs tracking-wide transition-colors">Voces</a>}
                                                            {c.link_secuencias && <a href={c.link_secuencias} target="_blank" rel="noreferrer" className="flex items-center justify-center py-2.5 rounded-xl bg-pink-500/10 text-pink-500 hover:bg-pink-500/20 font-bold text-xs tracking-wide transition-colors">E-Tracks</a>}
                                                        </div>
                                                    </div>
                                                </article>
                                            )
                                        }) : null}
                                    </div>
                                    <p className="text-[10px] sm:text-xs text-neutral-400 mt-4 text-center">
                                        Última modificación: {new Date(playlist.updated_at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
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
