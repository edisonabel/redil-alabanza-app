import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * CalendarioGrid (React Phase 2)
 * Renderizador maestro del motor de Eventos (Tarjetas, Listas y Calendarios).
 * Reemplaza mÃ¡s de 1000 lÃ­neas de Vanilla JS en programacion.astro
 */
export default function CalendarioGrid({ initialEvents, sessionUser, initialRoles, ssrError, isAdmin }) {
    // --- ESTADOS REACTIVOS PRINCIPALES ---
    const [eventos, setEventos] = useState(initialEvents || []);
    const [viewMode, setViewMode] = useState('tarjeta'); // 'tarjeta', 'lista', 'calendario'
    const [filtro, setFiltro] = useState('Todos');
    const [isLoading, setIsLoading] = useState(false);
    const [calendarDate, setCalendarDate] = useState(new Date());

    // UI Modals
    const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // --- INICIALIZACIÃ“N Y MERGE POR FECHA (TIMEZONE SAFE) ---
    // Helper estricto de Strings para evitar offsets de zona horaria del cliente
    const getPaddedDateKey = (dateInput) => {
        if (!dateInput) return null;

        // Si viene de la Base de Datos suele ser un String ISO '2026-03-08T...'
        if (typeof dateInput === 'string') {
            return dateInput.substring(0, 10);
        }

        // Si es un objeto nativo Date (como el currentTracker generado localmente en JS)
        if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
            const y = dateInput.getFullYear();
            const m = String(dateInput.getMonth() + 1).padStart(2, '0');
            const day = String(dateInput.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }

        return null;
    };

    // --- DERIVACIÃ“N PURA (1:1 DB MAP) ---
    // Al dejar de crear "Virtuales" domingos, cualquier borrado se refleja como inexistente en la UI.
    const tarjetasGeneradas = useMemo(() => {
        return [...eventos]
            .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora))
            .map(ev => ({
                id: ev.id,
                isVirtual: false,
                fecha: new Date(ev.fecha_hora),
                dbData: ev
            }));
    }, [eventos]);

    // --- LOGICA DEL ROSTER ESTATICO ---
    const renderRoster = (dbData) => {
        if (!dbData || !dbData.asignaciones) return null;

        const asignaciones = dbData.asignaciones;
        const dictRoles = initialRoles || [];

        // Agrupadores
        const direccion = [];
        const letras = [];
        const voces = [];
        const banda = [];

        asignaciones.forEach(asig => {
            if (!asig.perfiles) return;
            const rolMatch = dictRoles.find(r => r.id === asig.rol_id);
            if (!rolMatch) return;

            const names = asig.perfiles.nombre.trim().split(' ');
            const displayName = `${names[0]}`.trim(); // Just first name to match image

            const isN1 = ['lider_alabanza', 'talkback'].includes(rolMatch.codigo);
            const isN2 = ['encargado_letras'].includes(rolMatch.codigo);
            const isVoz = ['voz_soprano', 'voz_tenor'].includes(rolMatch.codigo);

            const bgColor = isN1 ? 'bg-rol-dir' : (isN2 ? 'bg-rol-let' : 'bg-rol-ban');

            // Map standard badges / icons 
            let badgeSvg = '';
            if (rolMatch.codigo === 'lider_alabanza') badgeSvg = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>;
            else if (rolMatch.codigo === 'talkback') badgeSvg = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" /></svg>;
            else if (isVoz) badgeSvg = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 8-9.04 9.06a2.82 2.82 0 1 0 3.98 3.98L16 12" /><circle cx="17" cy="7" r="5" /></svg>;
            else if (rolMatch.codigo === 'bateria') badgeSvg = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m2 2 8 8" /><path d="m22 2-8 8" /><ellipse cx="12" cy="9" rx="10" ry="5" /><path d="M2 9v6c0 2.8 4.5 5 10 5s10-2.2 10-5V9" /></svg>;
            else if (rolMatch.codigo === 'piano') badgeSvg = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2" /><path d="M6 5v4" /><path d="M10 5v4" /><path d="M14 5v4" /><path d="M18 5v4" /></svg>;
            else if (rolMatch.codigo.includes('guitarra')) badgeSvg = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a2 2 0 0 1-2 2v0a2 2 0 0 1-2-2v-4" /><path d="M14 15v4a2 2 0 0 0 2 2v0a2 2 0 0 0 2-2v-4" /><path d="M8 15V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v10" /><path d="M4 15h16" /><path d="M8 11h8" /></svg>;
            else if (rolMatch.codigo === 'bajo') badgeSvg = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;

            const iniciales = names.length > 1 ? `${names[0].charAt(0)}${names[1].charAt(0)}` : names[0].charAt(0);
            const colorSeccion = isN1 ? 'bg-rol-dir' : (isN2 ? 'bg-rol-let' : (isVoz ? 'bg-rol-voc' : 'bg-rol-ban'));

            const itemNode = (
                <div key={asig.id || `${asig.rol_id}-${asig.perfiles?.id || Math.random()}`} className="flex flex-col items-center gap-1.5 group relative cursor-pointer hover:bg-neutral/20 rounded-xl p-2 -m-2 transition-colors" title={`${asig.perfiles.nombre} (${rolMatch.nombre})`}>
                    <div className="relative">
                        {asig.perfiles.avatar_url ? (
                            <img src={asig.perfiles.avatar_url} alt={asig.perfiles.nombre} className="w-[42px] h-[42px] sm:w-[46px] sm:h-[46px] shrink-0 rounded-full object-cover shadow-sm border border-border" />
                        ) : (
                            <div className={`w-[42px] h-[42px] sm:w-[46px] sm:h-[46px] shrink-0 rounded-full text-white flex items-center justify-center font-bold text-sm shadow-sm ${colorSeccion}`}>
                                {iniciales.toUpperCase()}
                            </div>
                        )}
                        {badgeSvg && (
                            <div className="absolute -top-1.5 -right-1.5 w-[22px] h-[22px] bg-surface rounded-full flex items-center justify-center shadow-sm border border-border text-content-muted z-10 transition-transform group-hover:scale-110">
                                {badgeSvg}
                            </div>
                        )}
                    </div>
                    <span className="text-[11px] font-semibold text-content capitalize max-w-[60px] truncate text-center leading-none tracking-tight">{displayName}</span>
                </div>
            );

            if (isN1) direccion.push(itemNode);
            else if (isN2) letras.push(itemNode);
            else if (isVoz) voces.push(itemNode);
            else banda.push(itemNode);
        });

        return (
            <div className="bg-border/45 rounded-2xl p-4 border border-border/80 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col">
                        <div className="flex items-center justify-between mb-2 w-full">
                            <span className="text-[10px] font-bold text-rol-dir uppercase tracking-widest leading-none mt-0.5">Dirección</span>
                            <div className="h-px flex-1 bg-rol-dir/10 ml-3"></div>
                        </div>
                        <div className="flex flex-wrap gap-3">{direccion.length > 0 ? direccion : <span className="text-xs text-content-muted font-medium">Vacío</span>}</div>
                    </div>
                    <div className="flex flex-col">
                        <div className="flex items-center justify-between mb-2 w-full">
                            <span className="text-[10px] font-bold text-rol-let uppercase tracking-widest leading-none mt-0.5">Letras</span>
                            <div className="h-px flex-1 bg-rol-let/10 ml-3"></div>
                        </div>
                        <div className="flex flex-wrap gap-3">{letras.length > 0 ? letras : <span className="text-xs text-content-muted font-medium">Vacío</span>}</div>
                    </div>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-2 w-full">
                        <span className="text-[10px] font-bold text-rol-ban uppercase tracking-widest leading-none mt-0.5">Banda</span>
                        <div className="h-px flex-1 bg-rol-ban/10 ml-3"></div>
                    </div>
                    <div className="flex flex-wrap gap-3">{banda.length > 0 ? banda : <span className="text-xs text-content-muted font-medium">Vacío</span>}</div>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-2 w-full">
                        <span className="text-[10px] font-bold text-rol-voc uppercase tracking-widest leading-none mt-0.5">Voces</span>
                        <div className="h-px flex-1 bg-rol-voc/10 ml-3"></div>
                    </div>
                    <div className="flex flex-wrap gap-3">{voces.length > 0 ? voces : <span className="text-xs text-content-muted font-medium">Vacío</span>}</div>
                </div>
            </div>
        );
    };

    // La funciÃ³n renderSetlist fue removida a peticiÃ³n del Arquitecto (reservada para la vista "VER MAS").

    const handleDeleteEventClick = (e, evId, isVirtual) => {
        e.stopPropagation();
        if (isVirtual) {
            alert("Este es un evento virtual, no pertenece a la base de datos aún.");
            return;
        }
        setDeleteConfirmTarget(evId);
    };

    const confirmDeleteEvent = async () => {
        if (!deleteConfirmTarget) return;
        setIsDeleting(true);
        try {
            const { error } = await supabase.from('eventos').delete().eq('id', deleteConfirmTarget);
            if (error) throw error;

            // Reflejar cambios visuales en vivo filtrando solo el origin map
            setEventos(prev => prev.filter(ev => ev.id !== deleteConfirmTarget));
            setDeleteConfirmTarget(null);
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el evento: ' + err.message);
        } finally {
            setIsDeleting(false);
        }
    };

    const renderListRow = (cardData) => {
        const isSuspended = cardData.dbData && cardData.dbData.notas_especiales && cardData.dbData.notas_especiales.includes('SUSPENDIDO');
        const titulo = cardData.dbData?.titulo || 'Actividad Redil';
        const tema = cardData.dbData?.tema_predicacion || cardData.dbData?.titulo || 'Sin tema asignado';
        const estado = cardData.dbData?.estado || 'ACTIVO';

        const fechaObj = cardData.fecha;
        const diaStr = fechaObj.getDate().toString();
        const mesStr = fechaObj.toLocaleString('es-ES', { month: 'short' }).toLowerCase();

        const horaInicio = fechaObj.toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const timeString = cardData.dbData?.hora_fin ? `${horaInicio} - ${cardData.dbData.hora_fin.substring(0, 5)}` : horaInicio;

        const rosterDb = cardData.dbData?.asignaciones || [];
        const dictRoles = initialRoles || [];

        const miAsignacion = rosterDb.find((asig) => asig.perfiles?.id === sessionUser?.id || asig.perfiles?.email === sessionUser?.email);
        const isUsuarioAsignado = !!miAsignacion;

        let isModerator = false;
        if (miAsignacion) {
            const miRolObj = dictRoles.find(r => r.id === miAsignacion.rol_id);
            if (miRolObj && (miRolObj.codigo === 'lider_alabanza' || miRolObj.codigo === 'talkback')) {
                isModerator = true;
            }
        }

        const canManage = isAdmin || isModerator;

        const listHighlightClass = isUsuarioAsignado ? 'border-brand/30 bg-brand/10' : 'border-border bg-surface hover:bg-background border-solid';

        let miRolBadge = null;
        if (miAsignacion) {
            const rolText = dictRoles.find((r) => r.id === miAsignacion.rol_id)?.nombre || 'Banda';
            miRolBadge = (
                <span className="inline-flex items-center gap-1.5 md:gap-2 bg-brand/10 md:bg-surface text-brand md:text-brand border border-brand/30 md:border-brand/30 md:px-5 md:py-1.5 text-[10px] md:text-xs font-bold px-2.5 py-1 rounded-md md:rounded-[10px] uppercase tracking-wider max-w-[50vw] sm:max-w-none shadow-sm" title={`Tú: ${rolText}`}>
                    <strong className="font-extrabold flex items-center">TÚ:</strong>
                    <span className="truncate">{rolText}</span>
                </span>
            );
        }

        let dirListStr = (
            <span className="inline-flex items-center md:bg-surface text-content-muted text-[10px] md:text-xs font-bold px-2.5 md:px-5 md:py-1.5 py-1 rounded-md md:rounded-[10px] border border-border md:border-border/80 bg-background uppercase tracking-wider italic shadow-sm">Dirección vacía</span>
        );
        const asignadoLider = rosterDb.find((r) => dictRoles.find((ro) => ro.id === r.rol_id && ro.codigo === 'lider_alabanza'));
        if (asignadoLider && asignadoLider.perfiles) {
            const shortName = asignadoLider.perfiles.nombre.split(' ')[0];
            dirListStr = (
                <span className="inline-flex items-center gap-1.5 md:gap-2 bg-rol-dir/10 md:bg-surface text-rol-dir md:text-rol-dir border border-rol-dir md:border-rol-dir md:px-5 md:py-1.5 text-[10px] md:text-xs font-bold px-2.5 py-1 rounded-md md:rounded-[10px] uppercase tracking-wider max-w-[50vw] sm:max-w-none shadow-sm" title={`Dirige: ${shortName}`}>
                    <strong className="font-extrabold flex items-center">DIRIGE:</strong>
                    <span className="truncate">{shortName}</span>
                </span>
            );
        }

        return (
            <div
                key={cardData.id}
                className={`relative flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 md:py-6 md:px-8 md:gap-8 rounded-2xl md:rounded-[24px] border ${listHighlightClass} transition-colors group cursor-pointer`}
                onClick={() => {
                    if (cardData.dbData?.id && !cardData.isVirtual) {
                        if (window.openDetalleReact) {
                            window.openDetalleReact(cardData);
                        } else if (window.openDetalleGlobal) {
                            window.openDetalleGlobal(cardData.dbData.id);
                        } else {
                            // Fallback to navigating
                            window.location.href = `/repertorio?seleccionar_para=${cardData.dbData.id}`;
                        }
                    } else {
                        alert("Guarda / GESTIONA este evento virtual primero.");
                    }
                }}
            >
                {/* --- BOTON ELIMINAR --- */}
                {isAdmin && !cardData.isVirtual && (
                    <button
                        onClick={(e) => handleDeleteEventClick(e, cardData.dbData.id, cardData.isVirtual)}
                        className="absolute -top-3 -right-3 md:-top-3 md:-right-3 z-[60] w-8 h-8 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full transition-all duration-200 md:opacity-0 group-hover:opacity-100 shadow-xl transform hover:scale-110 border-[3px] border-white"
                        title="Eliminar Evento"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                )}

                {isUsuarioAsignado && (
                    <div className="w-3 md:w-3.5 h-3 md:h-3.5 rounded-full bg-brand shadow-[0_0_8px_rgba(20,184,166,0.6)] absolute -left-1.5 md:-left-[7px] top-1/2 -translate-y-1/2"></div>
                )}

                <div className="flex items-center gap-5 md:gap-10 min-w-0 flex-1">
                    <div className="flex flex-col items-center justify-center shrink-0 w-16 md:w-auto px-3 py-2 md:p-0 bg-background md:bg-transparent rounded-xl md:rounded-none border border-border/50 md:border-transparent">
                        <span className="text-2xl md:text-[32px] font-black md:font-extrabold text-content leading-none tracking-tight">{diaStr}</span>
                        <span className="text-[10px] md:text-xs font-bold md:font-semibold text-content-muted md:text-content-muted/80 uppercase tracking-widest mt-0.5 md:mt-1">{mesStr}</span>
                    </div>

                    <div className="min-w-0 flex flex-col justify-center">
                        <div className="flex items-start md:items-center justify-between gap-2 md:gap-3 md:mb-1">
                            <h4 className={`font-bold text-lg md:text-[22px] md:tracking-tight leading-tight flex-1 ${isSuspended ? 'text-content-muted line-through' : 'text-content'}`}>{tema !== 'Sin tema asignado' ? tema : titulo}</h4>
                            {canManage && (
                                <button
                                    className="ml-auto shrink-0 p-1.5 md:p-2 text-content-muted hover:text-content hover:bg-background/80 dark:text-white/80 dark:hover:text-white dark:hover:bg-white/10 md:bg-transparent rounded-lg transition-colors"
                                    title="Gestionar Evento"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (window.toggleModalGlobal) {
                                            window.toggleModalGlobal(true, 'edit', {
                                                id: cardData.id,
                                                fecha: cardData.fecha,
                                                titulo,
                                                tema,
                                                estado,
                                                hora_fin: cardData.dbData?.hora_fin || '',
                                                serie_id: cardData.dbData?.serie_id || '',
                                                moderator: !isAdmin && isModerator ? 'true' : 'false'
                                            });
                                        }
                                    }}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" className="md:w-3.5 md:h-3.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                                </button>
                            )}
                        </div>
                        <p className="text-xs md:text-sm text-content-muted md:text-content-muted flex items-center gap-2 mt-1 md:mt-0 md:font-medium">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" className="opacity-70 md:w-3.5 md:h-3.5" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                            {timeString}
                            {isSuspended && <span className="ml-2 text-red-500 font-bold uppercase md:tracking-widest md:text-[10px]">SUSPENDIDO</span>}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 md:gap-4 flex-wrap border-t md:border-t-0 md:border-l border-border/80 pt-2 md:pt-0 md:pl-6 shrink-0 md:ml-4">
                    {dirListStr}
                    {miRolBadge}
                </div>
            </div>
        );
    };

    // --- HANDLERS SECUNDARIOS JSX ---
    const renderCard = (cardData) => {
        const isSuspended = cardData.dbData && cardData.dbData.notas_especiales && cardData.dbData.notas_especiales.includes('SUSPENDIDO');
        const titulo = cardData.dbData?.titulo || 'Actividad Redil';
        const tema = cardData.dbData?.tema_predicacion || cardData.dbData?.titulo || 'Sin tema asignado';
        const estado = cardData.dbData?.estado || 'ACTIVO';

        const fechaObj = cardData.fecha;
        const diaStr = fechaObj.getDate().toString();
        const mesStr = fechaObj.toLocaleString('es-ES', { month: 'short' }).toLowerCase();
        const anioStr = fechaObj.getFullYear().toString();
        const diaSemana = fechaObj.toLocaleString('es-ES', { weekday: 'long' }).toUpperCase();

        const horaInicio = fechaObj.toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const timeString = cardData.dbData?.hora_fin ? `${horaInicio} - ${cardData.dbData.hora_fin.substring(0, 5)}` : horaInicio;

        // CascarÃ³n Suspendido (JSX puro)
        if (isSuspended) {
            return (
                <div key={cardData.id} className="agenda-card w-[85vw] sm:w-[380px] shrink-0 snap-center md:snap-align-none relative transition-all duration-700 bg-background border border-red-500/30 rounded-[2rem] p-8 opacity-70">
                    <div className="flex items-start justify-between mb-6">
                        <span className="px-3 py-1 bg-red-500/10 text-red-600 text-xs font-bold rounded-full border border-red-500/20">
                            {fechaObj.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="px-2 py-1 bg-red-500 text-white text-xs font-bold rounded-md uppercase tracking-widest flex items-center gap-1">
                            SUSPENDIDO
                        </span>
                    </div>
                    <h3 className="text-xl font-bold text-content-muted mb-4 line-through">{tema !== 'Sin tema asignado' ? tema : titulo}</h3>
                </div>
            );
        }

        return (
            <div key={cardData.id} className="agenda-card w-[85vw] sm:w-[340px] shrink-0 snap-center group relative bg-surface rounded-[2rem] shadow-sm hover:shadow-lg transition-shadow duration-300 border border-border p-5 flex flex-col">

                {/* --- BOTON ELIMINAR --- */}
                {isAdmin && !cardData.isVirtual && (
                    <button
                        onClick={(e) => handleDeleteEventClick(e, cardData.dbData.id, cardData.isVirtual)}
                        className="absolute -top-2.5 -right-2.5 z-[60] w-8 h-8 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full transition-all duration-200 md:opacity-0 group-hover:opacity-100 shadow-xl transform hover:scale-110 border-[3px] border-white"
                        title="Eliminar Evento"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                )}

                {/* Indicador de Suspendido */}
                {isSuspended && (
                    <div className="absolute top-0 right-0 py-1 px-3 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-bl-3xl rounded-tr-[2rem] shadow-sm z-10">Suspendido</div>
                )}

                {/* HEADER ROW 1 */}
                <div className="flex justify-between items-start mb-2 relative z-20">
                    <div className="flex items-baseline gap-1 text-content">
                        <span className="text-[2.75rem] font-normal tracking-tighter leading-none">{diaStr}</span>
                        <span className="text-3xl font-light tracking-tight leading-none ml-0.5">{mesStr}</span>
                        <span className="text-xs font-bold text-content-muted ml-1 pb-1">{anioStr}</span>
                    </div>
                    <span className="px-3 py-1 bg-background text-content-muted text-[10px] font-bold rounded-lg border border-border uppercase tracking-widest">{estado}</span>
                </div>

                {/* HEADER ROW 2 */}
                <div className="flex items-center gap-3 mb-3 relative z-20">
                    <span className="px-2.5 py-0.5 bg-info/10 text-info border border-info/30 rounded-md text-[10px] font-bold uppercase tracking-widest leading-relaxed">{diaSemana}</span>
                    <span className="text-sm font-medium text-content-muted">{timeString}</span>
                </div>

                {/* TEMA PREDICACIÃ“N (GIGANTE) */}
                <h1 className="text-[22px] font-bold text-content tracking-tight leading-tight mb-4 relative z-20">
                    {tema}
                </h1>

                {/* ROSTER ESTÃTICO PHASE 2 */}
                {renderRoster(cardData.dbData)}

                {/* BOTONES INFERIORES */}
                <div className="grid grid-cols-2 gap-3 border-t border-border mt-auto pt-4 -mx-5 px-5 pb-0 relative z-20">
                    <button
                        onClick={() => {
                            if (window.toggleModalGlobal) {
                                window.toggleModalGlobal(true, 'edit', {
                                    id: cardData.id,
                                    fecha: cardData.fecha,
                                    titulo,
                                    tema,
                                    estado,
                                    hora_fin: cardData.dbData?.hora_fin || '',
                                    serie_id: cardData.dbData?.serie_id || '',
                                    moderator: !isAdmin && isModerator ? 'true' : 'false',
                                    dbData: cardData.dbData
                                });
                            }
                        }}
                        className="btn-gestionar-modal flex items-center justify-center gap-2 py-2.5 bg-surface text-content hover:bg-background rounded-xl transition-colors font-bold text-xs tracking-wide border border-border dark:bg-white dark:text-zinc-900 dark:border-white/90 dark:hover:bg-zinc-100"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                        GESTIONAR
                    </button>

                    <button
                        onClick={() => {
                            if (cardData.dbData?.id && !cardData.isVirtual) {
                                if (window.openDetalleReact) {
                                    window.openDetalleReact(cardData);
                                } else if (window.openDetalleGlobal) {
                                    window.openDetalleGlobal(cardData.dbData.id);
                                } else {
                                    // Fallback to navigating
                                    window.location.href = `/repertorio?seleccionar_para=${cardData.dbData.id}`;
                                }
                            } else {
                                alert("Guarda / GESTIONA este evento virtual primero.");
                            }
                        }}
                        className="btn-expandir-detalle flex items-center justify-center gap-2 py-2.5 bg-surface border border-border text-content hover:bg-background rounded-xl transition-colors font-bold text-xs tracking-wide shadow-sm dark:bg-transparent dark:border-white/80 dark:text-white dark:hover:bg-white/10"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                        VER MÁS
                    </button>
                </div>
            </div>
        );
    };

    // --- RENDERIZADO PRINCIPAL ---

    // 1. AgrupaciÃ³n por Meses (LÃ³gica Reactiva)
    const groupedMonths = [];
    let currentMonthName = '';

    tarjetasGeneradas.forEach(card => {
        const monthName = card.fecha.toLocaleString('es-ES', { month: 'long' });
        if (monthName !== currentMonthName) {
            groupedMonths.push({ month: monthName, cards: [] });
            currentMonthName = monthName;
        }
        groupedMonths[groupedMonths.length - 1].cards.push(card);
    });

    // --- LOGICA DE CALENDARIO MENSUAL (PC) ---
    const renderMonthCalendar = () => {
        const year = calendarDate.getFullYear();
        const month = calendarDate.getMonth();

        // 1. Obtener el primer dia del mes
        const firstDayOfMonth = new Date(year, month, 1);
        const startDayIndex = firstDayOfMonth.getDay(); // 0 is Sunday, 1 is Monday...

        // 2. Cantidad de dias en el mes
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // 3. Cantidad de dias del mes anterior a rellenar
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        const calendarCells = [];

        // Rellenar desde el mes anterior
        for (let i = startDayIndex - 1; i >= 0; i--) {
            const date = new Date(year, month - 1, daysInPrevMonth - i);
            calendarCells.push({ date, isCurrentMonth: false });
        }

        // Dias del mes actual
        for (let i = 1; i <= daysInMonth; i++) {
            const date = new Date(year, month, i);
            calendarCells.push({ date, isCurrentMonth: true });
        }

        // Rellenar final para cuadrar la grilla (total 42 celdas - 6 semanas)
        const remainingCells = 42 - calendarCells.length;
        for (let i = 1; i <= remainingCells; i++) {
            const date = new Date(year, month + 1, i);
            calendarCells.push({ date, isCurrentMonth: false });
        }

        const formatter = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });
        const monthYearLabel = formatter.format(calendarDate);
        const isToday = (date) => {
            const today = new Date();
            return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
        };

        const goToPrevMonth = () => setCalendarDate(new Date(year, month - 1, 1));
        const goToNextMonth = () => setCalendarDate(new Date(year, month + 1, 1));
        const goToToday = () => setCalendarDate(new Date());

        return (
            <div className="w-full hidden md:flex flex-col animate-in fade-in duration-300">
                <div className="flex items-center justify-between mb-4 px-2">
                    <h2 className="text-2xl font-bold text-content capitalize">{monthYearLabel}</h2>
                    <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 shadow-sm">
                        <button onClick={goToToday} className="px-4 py-1.5 text-sm font-bold text-content-muted hover:text-content hover:bg-background rounded-lg transition-colors">Hoy</button>
                        <div className="w-px h-4 bg-neutral/20 mx-1"></div>
                        <button onClick={goToPrevMonth} className="p-1.5 text-content-muted hover:text-content hover:bg-background rounded-lg transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                        </button>
                        <button onClick={goToNextMonth} className="p-1.5 text-content-muted hover:text-content hover:bg-background rounded-lg transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                        </button>
                    </div>
                </div>

                <div className="rounded-2xl border border-border overflow-hidden bg-surface shadow-sm ring-1 ring-neutral-900/5">
                    {/* Header Dias */}
                    <div className="grid grid-cols-7 border-b border-border bg-background/50">
                        {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(dia => (
                            <div key={dia} className="py-3 px-3 text-center text-[11px] font-bold text-content-muted uppercase tracking-widest">{dia}</div>
                        ))}
                    </div>

                    {/* Grid de Dias */}
                    <div className="grid grid-cols-7 auto-rows-fr">
                        {calendarCells.map((cell, idx) => {
                            // Find events for this specific day
                            const dayEvents = [];
                            const dayKey = getPaddedDateKey(cell.date);

                            // 1. Agregar todos los eventos reales documentados en base de datos.
                            // Iteramos 'eventos' para no perder citas de MiÃ©rcoles u otros dÃ­as.
                            eventos.forEach(ev => {
                                if (ev.fecha_hora && getPaddedDateKey(new Date(ev.fecha_hora)) === dayKey) {
                                    dayEvents.push({
                                        id: ev.id,
                                        isVirtual: false,
                                        fecha: new Date(ev.fecha_hora),
                                        dbData: ev
                                    });
                                }
                            });

                            // 2. Agregar SOLO los eventos virtuales generados dinÃ¡micamente.
                            // Ignoramos los tc reales de tarjetasGeneradas porque ya los aÃ±adimos arriba.
                            tarjetasGeneradas.forEach(tc => {
                                if (tc.isVirtual && getPaddedDateKey(tc.fecha) === dayKey) {
                                    dayEvents.push(tc);
                                }
                            });

                            // Ordenar cronolÃ³gicamente ascendente
                            dayEvents.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

                            return (
                                <div key={idx} className={`min-h-[140px] border-r border-b border-border p-2 lg:p-3 relative group transition-colors ${cell.isCurrentMonth ? 'bg-surface hover:bg-background/30' : 'bg-background/80'}`}>
                                    <div className="flex justify-between items-start mb-2">
                                        <span className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${isToday(cell.date) ? 'bg-red-500 text-white shadow-md' : (cell.isCurrentMonth ? 'text-neutral-700' : 'text-content-muted')}`}>
                                            {cell.date.getDate()}
                                        </span>
                                    </div>

                                    <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[85px] hide-scrollbar pr-1">
                                        {dayEvents.map((ev, i) => {
                                            let timeStr = '';
                                            try {
                                                timeStr = ev.fecha.toLocaleString('es-ES', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(' ', '');
                                            } catch (e) { }

                                            const clickHandler = () => {
                                                if (window.openDetalleReact) {
                                                    window.openDetalleReact(ev);
                                                }
                                            };

                                            const tituloBase = ev.dbData?.titulo || 'Actividad Redil';
                                            const tema_predicacion = ev.dbData?.tema_predicacion && ev.dbData?.tema_predicacion !== 'Sin tema asignado' ? ev.dbData.tema_predicacion : tituloBase;
                                            const finalTitleDisplay = ev.isVirtual ? 'Actividad Redil' : (tema_predicacion !== tituloBase ? tema_predicacion : tituloBase);

                                            return (
                                                <button key={i} onClick={clickHandler} title={finalTitleDisplay} className={`text-left text-xs px-2 py-1.5 rounded-lg font-medium tracking-tight truncate w-full flex items-center gap-1.5 transition-colors ${ev.isVirtual ? 'bg-background text-content-muted hover:bg-neutral/20' : 'bg-brand/10 text-brand hover:bg-brand/20 cursor-pointer pointer-events-auto shadow-sm border border-brand/20'}`}>
                                                    <div className={`w-2 h-2 rounded-full shrink-0 ${ev.isVirtual ? 'bg-neutral-300' : 'bg-brand'}`}></div>
                                                    <span className="font-bold opacity-70">{timeStr}</span>
                                                    <span className="truncate">{finalTitleDisplay}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    // 4. El Motor de Arrastre para PC (Drag to Scroll)
    let isDown = false; let startX; let scrollLeft;
    const onMouseDown = (e) => { isDown = true; startX = e.pageX - e.currentTarget.offsetLeft; scrollLeft = e.currentTarget.scrollLeft; };
    const onMouseLeave = () => { isDown = false; };
    const onMouseUp = () => { isDown = false; };
    const onMouseMove = (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - e.currentTarget.offsetLeft;
        const walk = (x - startX) * 2;
        e.currentTarget.scrollLeft = scrollLeft - walk;
    };

    return (
        <div className="w-full">

            {/* HEADER DE GRID / CONTROLES DE VISTA AQUI (Migrado desde programacion.astro HTML) */}
            <div className="flex items-center justify-center md:justify-end gap-2 mb-4 md:mb-6 mt-1 md:mt-2 w-full">
                <div className="flex bg-background p-1 rounded-2xl border border-border/60 shadow-inner">
                    <button
                        onClick={() => setViewMode('tarjeta')}
                        className={`flex items-center justify-center px-4 py-2 ${viewMode === 'tarjeta' ? 'bg-surface text-orange-500 shadow-sm border border-border/50' : 'bg-transparent text-content-muted border border-transparent hover:text-neutral-700'} text-xs sm:text-sm font-bold rounded-xl transition-all`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" className="inline-block mr-1.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
                        Tarjeta
                    </button>
                    <button
                        onClick={() => setViewMode('lista')}
                        className={`flex items-center justify-center px-4 py-2 ${viewMode === 'lista' ? 'bg-surface text-orange-500 shadow-sm border border-border/50' : 'bg-transparent text-content-muted border border-transparent hover:text-neutral-700'} text-xs sm:text-sm font-bold rounded-xl transition-all`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" className="inline-block mr-1.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                        Lista
                    </button>
                    <button
                        onClick={() => setViewMode('calendario')}
                        className={`hidden md:flex items-center justify-center px-4 py-2 ${viewMode === 'calendario' ? 'bg-surface text-orange-500 shadow-sm border border-border/50' : 'bg-transparent text-content-muted border border-transparent hover:text-neutral-700'} text-xs sm:text-sm font-bold rounded-xl transition-all`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" className="inline-block mr-1.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /><path d="M8 14h.01" /><path d="M12 14h.01" /><path d="M16 14h.01" /><path d="M8 18h.01" /><path d="M12 18h.01" /><path d="M16 18h.01" /></svg>
                        Calendario
                    </button>
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            {eventos.length === 0 ? (
                <div id="empty-state" className="flex flex-col items-center justify-center py-20 bg-background border border-border rounded-3xl w-full max-w-7xl mx-auto my-10 shadow-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-content-muted mb-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /><path d="M10 16h4" /><path d="M12 14v4" /></svg>
                    <h3 className="text-2xl font-bold text-content mb-2">No hay programaciones</h3>
                    <p className="text-content-muted text-center max-w-sm">No se encontraron registros activos en la base de datos.</p>
                </div>
            ) : (
                <>
                    {/* CONTENEDOR DE TARJETAS REACTIVAS MESTRAS */}
                    {viewMode === 'tarjeta' && (
                        <div className="flex flex-col gap-10 max-w-7xl mx-auto w-full">
                            {groupedMonths.map((group, idx) => (
                                <div key={idx} className="w-full">
                                    <h3 className="text-[12px] font-bold text-content-muted uppercase tracking-widest mb-4 ml-1">{group.month}</h3>
                                    <div
                                        className="flex overflow-x-auto overflow-y-visible snap-x snap-mandatory gap-6 pb-8 pt-6 px-4 -mx-4 hide-scrollbar cursor-grab active:cursor-grabbing scroll-smooth"
                                        onMouseDown={onMouseDown}
                                        onMouseLeave={onMouseLeave}
                                        onMouseUp={onMouseUp}
                                        onMouseMove={onMouseMove}
                                    >
                                        {group.cards.map(card => renderCard(card))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* VISTA LISTA (DRIVE MODO) */}
                    {viewMode === 'lista' && (
                        <div className="flex flex-col gap-3 max-w-7xl mx-auto w-full px-4 shrink-0 transition-opacity animate-in fade-in duration-300">
                            {tarjetasGeneradas.map(card => renderListRow(card))}
                        </div>
                    )}

                    {/* VISTA CALENDARIO GRID */}
                    {viewMode === 'calendario' && renderMonthCalendar()}


                </>
            )}

            {/* FAB AÑADIR EVENTO */}
            <button
                onClick={() => {
                    if (window.toggleModalGlobal) window.toggleModalGlobal(true, 'new');
                }}
                className="fixed bottom-24 right-4 md:bottom-28 md:right-8 bg-brand hover:bg-brand text-white w-14 h-14 md:w-auto md:px-6 rounded-full shadow-2xl flex items-center justify-center gap-2 transition-transform hover:scale-105 z-40 group"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-90 transition-transform duration-300"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                <span className="hidden md:block font-ui-strong text-base">Añadir Evento</span>
            </button>

            {/* FAB GENERAR SERIE (SOLO ADMIN) */}
            {isAdmin && (
                <button
                    onClick={() => {
                        if (window.openSerieModal) window.openSerieModal();
                    }}
                    className="fixed bottom-40 right-4 md:bottom-44 md:right-8 bg-rol-dir hover:bg-rol-dir/90 text-white w-14 h-14 md:w-auto md:px-5 rounded-full shadow-2xl flex items-center justify-center gap-2 transition-transform hover:scale-105 z-40 group"
                    title="Generar Serie de Eventos"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-180 transition-transform duration-500"><path d="M17 2.1l4 4-4 4" /><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8M7 21.9l-4-4 4-4" /><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2" /></svg>
                    <span className="hidden md:block font-ui-strong text-sm">Generar Serie</span>
                </button>
            )}
            {/* DELETE CONFIRMATION MODAL PRO */}
            {deleteConfirmTarget && (
                <div className="fixed inset-0 z-[200] bg-overlay/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface rounded-[2rem] shadow-2xl max-w-sm w-full p-8 text-center animate-in zoom-in-95 duration-200 border border-border relative overflow-hidden">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center bg-red-50 text-red-500 mx-auto mb-5 relative shrink-0 shadow-[0_0_0_4px_rgba(254,226,226,0.5)]">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                        </div>
                        <h3 className="text-xl font-extrabold text-content mb-2 tracking-tight">Eliminar Evento</h3>
                        <p className="text-sm text-content-muted mb-6 leading-relaxed">
                            ¿Estás seguro de que deseas borrar este evento permanentemente? <br /> <strong className="text-red-500">Esta acción es irreversible</strong> y liberará la fecha en tu calendario.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteConfirmTarget(null)}
                                disabled={isDeleting}
                                className="flex-1 py-3 px-4 bg-background hover:bg-neutral/20 text-neutral text-sm font-bold rounded-xl transition-colors shadow-sm"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmDeleteEvent}
                                disabled={isDeleting}
                                className="flex-1 py-3 px-4 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm shadow-red-500/20 active:scale-[0.98]"
                            >
                                {isDeleting ? (
                                    <div className="w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin"></div>
                                ) : (
                                    "Sí, Eliminar"
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}



