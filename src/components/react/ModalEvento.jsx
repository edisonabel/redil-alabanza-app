import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import RosterManager from './RosterManager.jsx';

export default function ModalEvento() {
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState('new');
    const [evId, setEvId] = useState('');
    const [titulo, setTitulo] = useState('');
    const [fecha, setFecha] = useState('');
    const [horaInicio, setHoraInicio] = useState('');
    const [horaFin, setHoraFin] = useState('');
    const [collisionDate, setCollisionDate] = useState(null);
    const [estado, setEstado] = useState('Publicado');
    const [tema, setTema] = useState('');
    const [esAcustico, setEsAcustico] = useState(false);
    const [isSerie, setIsSerie] = useState(false);
    const [applySerie, setApplySerie] = useState(false);
    const [serieId, setSerieId] = useState('');
    const [isStrictModerator, setIsStrictModerator] = useState(false);

    const [isSaving, setIsSaving] = useState(false);
    const [isDeletingSerie, setIsDeletingSerie] = useState(false);

    const [rosterHtml, setRosterHtml] = useState('');
    const [dbData, setDbData] = useState(null);
    const [showPlaylistBtn, setShowPlaylistBtn] = useState(false);
    const [hasPlaylist, setHasPlaylist] = useState(false);
    const [user, setUser] = useState(null);

    useEffect(() => {
        // Aprovechar la inyecciÃ³n SSR de Astro para obtener el usuario sin latencia
        if (typeof window !== 'undefined' && window.__SSR_USER__) {
            setUser(window.__SSR_USER__);
        }

        // Registrar la funciÃ³n global para que Vanilla JS (el grid) pueda invocar a React
        window.toggleModalGlobal = async (show, modalMode = 'new', data = null) => {
            if (!show) {
                setIsOpen(false);
                document.body.style.overflow = '';
                return;
            }

            setIsOpen(true);
            setMode(modalMode);
            document.body.style.overflow = 'hidden';

            if (modalMode === 'new') {
                setEvId('');
                setTitulo('');
                setFecha('');
                setHoraInicio('');
                setHoraFin('');
                setTema('');
                setEstado('Publicado');
                setEsAcustico(false);
                setIsSerie(false);
                setSerieId('');
                setApplySerie(false);
                setIsStrictModerator(false);
                setRosterHtml('');
                setDbData(null);
                setShowPlaylistBtn(false);
                setHasPlaylist(false);
                setCollisionDate(null);
            } else if (modalMode === 'edit' && data) {
                setEvId(data.id || '');
                setTitulo(data.titulo || '');

                try {
                    const d = new Date(data.fecha);
                    const offset = d.getTimezoneOffset() * 60000;
                    const localISOTime = (new Date(d.getTime() - offset)).toISOString().slice(0, 16);
                    const [fDate, fTime] = localISOTime.split('T');
                    setFecha(fDate);
                    setHoraInicio(fTime);
                } catch (e) { }

                setHoraFin(data.hora_fin || '');
                setTema(data.tema && data.tema !== 'undefined' && data.tema !== 'null' ? data.tema : '');
                setEstado(data.estado || 'Publicado');
                setEsAcustico(Boolean(data.es_acustico ?? data.dbData?.es_acustico));

                const strictMod = data.moderator === 'true';
                setIsStrictModerator(strictMod);

                if (data.serie_id) {
                    setIsSerie(true);
                    setSerieId(data.serie_id);
                    setApplySerie(false);
                } else {
                    setIsSerie(false);
                    setSerieId('');
                }

                setRosterHtml(data.rosterHtml || '');
                setDbData(data.dbData || null);

                // RBAC simulado para Playlist
                setTimeout(() => {
                    if (window._showPlaylistBtn) window._showPlaylistBtn(data.id);
                }, 100);
            }
        };
    }, []);

    // Enganchar Vanilla Listeners eliminados en favor de React Native Manager

    // Sobrescribir lÃ³gica Visual del BotÃ³n de Playlist con React State (Si es llamada por Vanilla JS)
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const originalShowPlaylistBtn = window._showPlaylistBtn;
        window._showPlaylistBtn = async (id) => {
            if (originalShowPlaylistBtn) originalShowPlaylistBtn(id); // Para mantener cualquier otra lÃ³gica viva
            if (!id) {
                setShowPlaylistBtn(false);
                setHasPlaylist(false);
                return;
            }

            setShowPlaylistBtn(false);
            setHasPlaylist(false);

            const profileReq = await supabase.from('perfiles').select('is_admin').eq('id', user?.id || '').single();
            if (profileReq.data?.is_admin) {
                setShowPlaylistBtn(true);
            } else {
                const rolesReq = await supabase.from('asignaciones').select('roles(codigo)').eq('evento_id', id).eq('perfil_id', user?.id || '');
                if (rolesReq.data) {
                    const codigos = rolesReq.data.map(r => r.roles?.codigo).filter(Boolean);
                    if (codigos.includes('lider_alabanza') || codigos.includes('talkback')) {
                        setShowPlaylistBtn(true);
                    }
                }
            }

            const { data: playlistData, error: playlistError } = await supabase
                .from('playlists')
                .select('id')
                .eq('evento_id', id)
                .maybeSingle();

            if (playlistError) {
                console.error('Error revisando setlist del evento:', playlistError);
                return;
            }

            setHasPlaylist(Boolean(playlistData?.id));
        };

    }, [user, evId]);
    const handleClose = () => {
        if (typeof window !== 'undefined' && typeof window.toggleModalGlobal === 'function') {
            window.toggleModalGlobal(false);
        } else {
            setIsOpen(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();

        if (!fecha || !horaInicio || !titulo) {
            alert('Faltan campos obligatorios');
            return;
        }

        setIsSaving(true);

        try {
            let transacError = null;
            const currentUserId = user?.id;

            // 1. Check for collisions (if Date was changed or making a new Event)
            // Solo probamos para ese dÃ­a entero.
            const startCheck = new Date(fecha + 'T00:00:00Z').toISOString();
            const endCheck = new Date(fecha + 'T23:59:59Z').toISOString();

            let query = supabase.from('eventos').select('id, fecha_hora').gte('fecha_hora', startCheck).lte('fecha_hora', endCheck);
            // Ignorar el actual si es ediciÃ³n de un existente de BDD y no un virtual insert
            if (evId && !evId.startsWith('virtual|')) {
                query = query.neq('id', evId);
            }
            const { data: existingEvents, error: fetchErr } = await query;

            if (fetchErr) {
                alert("Error validando fecha: " + fetchErr.message);
                setIsLoading(false);
                return;
            }

            if (existingEvents && existingEvents.length > 0) {
                setCollisionDate(fecha);
                setIsSaving(false);
                return;
            }

            // 2. Assembler Time Payload
            const localDate = new Date(`${fecha}T00:00:00`);
            const [h, m] = horaInicio.split(':').map(Number);
            localDate.setHours(h, m, 0, 0);
            const isoPayload = localDate.toISOString();

            // Camino A: EdiciÃ³n de un evento existente
            if (evId && !evId.startsWith('virtual|')) {
                if (applySerie && serieId) {
                    // ActualizaciÃ³n masiva a la serie
                    const { error } = await supabase
                        .from('eventos')
                        .update({ titulo, hora_fin: horaFin || null, es_acustico: esAcustico })
                        .eq('serie_id', serieId)
                        .gte('fecha_hora', startCheck);
                    transacError = error;
                } else {
                    // ActualizaciÃ³n individual
                    const { error } = await supabase
                        .from('eventos')
                        .update({
                            titulo,
                            fecha_hora: isoPayload,
                            hora_fin: horaFin || null,
                            tema_predicacion: tema || null,
                            estado,
                            es_acustico: esAcustico
                        })
                        .eq('id', evId);
                    transacError = error;
                }
            } else {
                // Camino B: Evento Nuevo
                const newEv = {
                    titulo,
                    fecha_hora: isoPayload,
                    hora_fin: horaFin || null,
                    tema_predicacion: tema || null,
                    estado,
                    es_acustico: esAcustico,
                    created_by: currentUserId
                };

                // Evento virtual o FAB (No tiene setteo de serie propio aquÃ­, la serie se crea en Generator modal)
                if (!evId) newEv.notas_especiales = 'FREQ=WEEKLY;BYDAY=SU';

                const { error } = await supabase.from('eventos').insert([newEv]);
                transacError = error;
            }

            if (transacError) throw transacError;

            handleClose();
            if (evId && evId.startsWith('virtual|')) {
            alert('Evento publicado. Haz clic en GESTIONAR de nuevo para añadir el equipo.');
            }

            // Forzar recarga SSR para que Astro pinte los datos frescos de Supabase
            window.location.reload();

        } catch (err) {
            console.error('❌ [ModalEvento] Error Guardando:', err);
            alert('Error crítico al guardar: ' + (err?.message || 'Revisa la consola.'));
            setIsSaving(false); // Solo bajamos el spinner si hubo error, si no se recarga la pÃ¡gina
        }
    };

    const handleDeleteSerie = async () => {
        if (!serieId) return;
        if (!window.confirm('ATENCIÓN: Estás a punto de eliminar TODOS los eventos asociados a esta serie de forma permanente.\\n\\n¿Estás seguro de que deseas continuar?')) return;

        setIsDeletingSerie(true);
        try {
            const { error } = await supabase.from('eventos').delete().eq('serie_id', serieId);
            if (error) throw error;
            handleClose();
            alert('Serie eliminada correctamente.');
            window.location.reload();
        } catch (e) {
            alert('Error al eliminar serie: ' + e.message);
            setIsDeletingSerie(false);
        }
    };

    // FunciÃ³n openEquipoPicker nativa movida a RosterManager
    if (!isOpen) return null;

    return (
        <div id="event-modal-react" className="fixed inset-0 z-[80] min-h-[100dvh] bg-overlay/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 pt-6 pb-[calc(104px+env(safe-area-inset-bottom))] lg:items-center lg:p-6 transition-opacity">
            <div className="bg-surface border border-border rounded-3xl w-full max-w-2xl max-h-[calc(100dvh-132px-env(safe-area-inset-bottom))] lg:max-h-[calc(100dvh-96px)] overflow-hidden shadow-2xl flex flex-col transform my-auto lg:my-0">
                <div className="p-6 border-b border-border flex justify-between items-center bg-background sticky top-0 z-10">
                    <h2 id="modal-title" className="text-xl font-bold text-content ">
                        {mode === 'new' ? 'Nuevo Evento' : 'Gestionar Evento'}
                    </h2>
                    <button id="btn-close-modal" type="button" onClick={handleClose} className="text-content-muted hover:text-content transition-colors p-2 -mr-2 bg-background hover:bg-border rounded-full">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                <div className="p-6 bg-surface flex-1 overflow-y-auto overflow-x-hidden">
                    <form id="form-event" className="flex flex-col gap-5" onSubmit={handleSave}>
                        <input type="hidden" id="ev-id" value={evId} readOnly />
                        <input type="hidden" id="ev-serie-id" value={serieId} readOnly />

                        <div className="grid grid-cols-1 gap-5 w-full">
                            <div className={`w-full ${isStrictModerator ? 'hidden' : ''}`} id="ev-container-titulo">
                                <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">TÍTULO DEL EVENTO <span className="text-red-500">*</span></label>
                                <input type="text" id="ev-titulo" required disabled={isStrictModerator} value={titulo} onChange={e => setTitulo(e.target.value)} className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors" placeholder="Ej: Culto de Adoración" />
                            </div>

                            <div className={`w-full grid grid-cols-1 sm:grid-cols-2 gap-4 ${isStrictModerator ? 'hidden' : ''}`} id="ev-container-fechas">
                                <div className="w-full min-w-0">
                                    <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">Fecha <span className="text-red-500">*</span></label>
                                    <input type="date" id="ev-fecha" required disabled={isStrictModerator} value={fecha} onChange={e => setFecha(e.target.value)} className="w-full min-w-0 bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors" />
                                </div>
                                <div className="flex gap-4 form-row-compact min-w-0">
                                    <div className="flex-1 min-w-0">
                                        <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">Hora <span className="text-red-500">*</span></label>
                                        <input type="time" id="ev-hora-inicio" required disabled={isStrictModerator} value={horaInicio} onChange={e => setHoraInicio(e.target.value)} className="w-full min-w-0 bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors" />
                                    </div>
                                    <div className="flex-[0.7] min-w-0">
                                        <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2 truncate" title="Hora Fin">Fin <span className="text-content-muted font-normal lowercase">(opc)</span></label>
                                        <input type="time" id="ev-hora-fin" disabled={isStrictModerator} value={horaFin} onChange={e => setHoraFin(e.target.value)} className="w-full min-w-0 bg-background border border-border rounded-xl px-3 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors" />
                                    </div>
                                </div>
                            </div>

                            {isSerie && !isStrictModerator && (
                                <div id="serie-update-section" className="flex flex-col gap-2">
                                    <label className="flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-xl p-3 cursor-pointer hover:bg-violet-100 transition-colors">
                                        <input type="checkbox" id="ev-serie-check" checked={applySerie} onChange={e => setApplySerie(e.target.checked)} className="w-5 h-5 accent-violet-500 rounded" />
                                        <div>
                                            <span className="text-sm font-bold text-violet-700">Aplicar a toda la serie</span>
                                            <p className="text-[11px] text-violet-500 mt-0.5">Actualiza título y hora en todos los eventos futuros de esta serie</p>
                                        </div>
                                    </label>
                                    <button type="button" onClick={handleDeleteSerie} disabled={isDeletingSerie} id="btn-eliminar-serie" className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 rounded-xl transition-colors font-ui-strong text-sm leading-tight">
                                        {isDeletingSerie ? (
                                            <div className="w-4 h-4 border-2 border-red-600/30 border-t-red-600 rounded-full animate-spin"></div>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                        )}
                                        {isDeletingSerie ? 'Eliminando...' : 'Eliminar toda la serie permanentemente'}
                                    </button>
                                </div>
                            )}

                            <div className={`grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 items-end ${isStrictModerator ? 'hidden' : ''}`} id="ev-container-estado">
                                <div className="min-w-0">
                                    <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">Estado</label>
                                    <select id="ev-estado" value={estado} onChange={e => setEstado(e.target.value)} disabled={isStrictModerator} className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors appearance-none">
                                        <option value="Borrador">Borrador</option>
                                        <option value="Publicado">Publicado</option>
                                    </select>
                                </div>

                                <div className="w-full md:w-auto" id="ev-container-acustico">
                                    <label className="inline-flex w-full md:w-auto items-center gap-3 bg-background border border-border rounded-xl px-4 py-3 cursor-pointer hover:bg-surface transition-colors select-none">
                                        <input
                                            type="checkbox"
                                            id="ev-es-acustico"
                                            checked={esAcustico}
                                            onChange={e => setEsAcustico(e.target.checked)}
                                            disabled={isStrictModerator}
                                            className="h-5 w-5 rounded border-border accent-brand"
                                        />
                                        <span className="text-sm font-semibold text-content whitespace-nowrap">Servicio Acústico</span>
                                    </label>
                                </div>
                            </div>

                            <div className="w-full">
                                <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">TEMA DE PREDICACIÓN <span className="text-content-muted font-normal lowercase">(opcional)</span></label>
                                <input type="text" id="ev-tema" value={tema} onChange={e => setTema(e.target.value)} className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors" placeholder="Ej: La Gracia de Dios" />
                            </div>

                        </div>

                        <div id="modal-roster-section" className={`${mode === 'new' ? 'hidden' : ''} mt-4 pt-6 border-t border-border flex flex-col gap-4`}>
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-bold text-content uppercase tracking-wider flex items-center gap-2">Asignaciones de Equipo <span className="text-[10px] font-normal text-content-muted bg-background px-2 py-0.5 rounded hidden sm:inline-block">Clic editar</span></h3>
                            </div>

                            <button
                                type="button"
                                id="btn-armar-playlist"
                                onClick={() => {
                                    if (evId) window.location.href = '/repertorio?seleccionar_para=' + evId;
                                }}
                                className={`w-full relative overflow-hidden group items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 text-white font-ui-strong text-[15px] leading-tight shadow-md shadow-fuchsia-500/30 hover:shadow-fuchsia-500/50 hover:-translate-y-0.5 transition-all duration-300 ${showPlaylistBtn ? 'flex' : 'hidden'}`}
                            >
                                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-in-out"></div>
                                <span className="relative z-10 flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>{hasPlaylist ? 'Editar Repertorio' : 'Armar Repertorio (Setlist)'}</span>
                            </button>

                            <RosterManager
                                evId={evId}
                                evFechaStr={fecha}
                                evTituloStr={titulo}
                                evTemaStr={tema}
                                evEstadoStr={estado}
                                esAcustico={esAcustico}
                                isStrictModerator={isStrictModerator}
                                dbData={dbData}
                                onRosterChange={(nextAsignaciones) => {
                                    setDbData((prev) => (
                                        prev
                                            ? { ...prev, asignaciones: nextAsignaciones }
                                            : { asignaciones: nextAsignaciones }
                                    ));
                                }}
                            />
                        </div>

                    </form>
                </div>
                <div className="shrink-0 border-t border-border bg-surface px-6 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={handleClose}
                            id="btn-cancel-modal"
                            className="flex-1 py-3.5 px-4 bg-background hover:bg-border border border-border text-sm text-content rounded-xl font-bold transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            form="form-event"
                            disabled={isSaving}
                            id="btn-submit-modal"
                            className="flex-1 py-3.5 px-4 bg-brand hover:bg-brand/90 text-white text-sm rounded-xl font-bold transition-colors flex justify-center items-center gap-2"
                        >
                            <span>{isSaving ? 'Guardando...' : 'Guardar Evento'}</span>
                            {isSaving && <div id="btn-spinner" className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>}
                        </button>
                    </div>
                </div>
            </div>
            {/* ERROR MODAL NATIVO OVERRIDE (COLISIÃ“N) */}
            {collisionDate && (
                <div className="fixed inset-0 z-[100] min-h-[100dvh] bg-overlay/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 pt-6 pb-[calc(104px+env(safe-area-inset-bottom))] lg:items-center lg:p-6" style={{ animation: 'fadeIn 0.2s ease-in-out' }}>
                    <div className="bg-surface rounded-[2rem] shadow-2xl max-w-sm w-full overflow-hidden border border-red-100" style={{ animation: 'scaleUp 0.3s ease-in-out' }}>
                        <style>{`
                            @keyframes scaleUp { from { transform: scale(0.95) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
                            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        `}</style>
                        <div className="p-8 text-center pb-6">
                            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-red-50 text-red-500 border-4 border-white shadow-[0_0_0_4px_rgba(254,226,226,0.5)] mx-auto mb-5 relative">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center">
                                    <div className="w-2 h-2 rounded-full bg-red-500 animate-ping"></div>
                                </div>
                            </div>
                            <h3 className="text-xl font-extrabold text-content mb-3 tracking-tight">¡Día Ocupado!</h3>
                            <p className="text-sm text-content-muted leading-relaxed">
                                Ya existe un evento en la base de datos para el día <br /> <strong className="text-red-500 bg-red-50 px-2 py-1 rounded-lg inline-block mt-2 mb-1">{collisionDate}</strong>
                            </p>
                            <p className="text-xs text-content-muted mt-4 px-2">
                                Para evitar sobreescribir o colisionar eventos, por favor elige una fecha libre o borra el evento actual en ese día.
                            </p>
                        </div>
                        <div className="flex bg-background p-4 border-t border-red-100/50">
                            <button
                                type="button"
                                onClick={() => setCollisionDate(null)}
                                className="w-full py-3.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold transition-colors shadow-sm shadow-red-500/20 active:scale-[0.98]"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


