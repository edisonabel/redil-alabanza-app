import { useState, useEffect, useMemo } from 'react';
import {
    AlertTriangle,
    CalendarDays,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ClipboardCheck,
    Layers3,
    ListMusic,
    Settings2,
    Trash2,
    UsersRound,
    X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import RosterManager from './RosterManager.jsx';
import { getEventThemeAndPreacher } from '../../lib/event-display.js';
import { isPredicadorColumnMissingError } from '../../lib/predicador-compat.js';
import { isEventRepertoryManagerRoleCode } from '../../lib/role-permissions.js';
import {
    formatEventRehearsalLabel,
    normalizeRehearsalWeekday,
    REHEARSAL_WEEKDAY_OPTIONS,
    resolveEventRehearsalDate,
} from '../../lib/event-rehearsal.js';
import {
    formatClockLabel,
    isSinFiltrosMinistry,
    SIN_FILTROS_MINISTRY_NAME,
    SIN_FILTROS_REHEARSAL_TIME,
    SIN_FILTROS_SERVICE_TIME,
} from '../../lib/ministry-config.js';

const composeLegacyTemaPredicacion = (temaValue, predicadorValue) => {
    const temaSafe = String(temaValue || '').trim();
    const predicadorSafe = String(predicadorValue || '').trim();

    if (temaSafe && predicadorSafe) return `${temaSafe} - ${predicadorSafe}`;
    if (temaSafe) return temaSafe;
    if (predicadorSafe) return predicadorSafe;
    return null;
};

const syncEventCalendarAssignments = async (eventoId) => {
    if (!eventoId || String(eventoId).startsWith('virtual|')) return;
    try {
        const response = await fetch('/api/calendar/google/sync', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ evento_id: eventoId })
        });
        if (!response.ok && response.status !== 503) {
            console.warn('No se pudo actualizar Google Calendar despues de editar el evento.');
        }
    } catch (error) {
        console.warn('Google Calendar sync request failed:', error);
    }
};

const toRehearsalEventDate = (dateValue = '') => (
    dateValue ? `${dateValue}T12:00:00-05:00` : ''
);

const isSundayServiceDate = (dateValue = '') => Boolean(resolveEventRehearsalDate({
    eventDate: toRehearsalEventDate(dateValue),
    rehearsalWeekday: 4,
    hour: 12,
}));

const isSaturdayDate = (dateValue = '') => {
    if (!dateValue) return false;
    const parsed = new Date(`${dateValue}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.getUTCDay() === 6;
};

const getRecurrenceDayCode = (dateValue = '') => {
    const parsed = new Date(`${dateValue}T12:00:00Z`);
    const dayCodes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    return Number.isNaN(parsed.getTime()) ? 'SU' : dayCodes[parsed.getUTCDay()];
};

const normalizePlaylistSongs = (items = []) => (
    (Array.isArray(items) ? items : []).map((item, index) => {
        const song = Array.isArray(item?.canciones) ? item.canciones[0] : item?.canciones;
        if (!song) return null;

        return {
            id: String(item?.cancion_id || song.id || `playlist-song-${index}`),
            title: song.titulo || 'Canción sin título',
            artist: song.cantante || '',
            key: song.tonalidad || '',
            order: Number.isFinite(Number(item?.orden)) ? Number(item.orden) : index,
        };
    }).filter(Boolean)
);

const EVENT_WIZARD_STEP_META = {
    service: {
        id: 'service',
        label: 'Servicio',
        shortLabel: 'Servicio',
        description: 'Nombre, ministerio, fecha y horario.',
        icon: CalendarDays,
    },
    details: {
        id: 'details',
        label: 'Detalles',
        shortLabel: 'Detalles',
        description: 'Publicación, ensayo y predicación.',
        icon: Settings2,
    },
    team: {
        id: 'team',
        label: 'Equipo',
        shortLabel: 'Equipo',
        description: 'Formato y asignaciones del servicio.',
        icon: UsersRound,
    },
    repertoire: {
        id: 'repertoire',
        label: 'Repertorio',
        shortLabel: 'Repertorio',
        description: 'Canciones preparadas para el servicio.',
        icon: ListMusic,
    },
    review: {
        id: 'review',
        label: 'Revisar',
        shortLabel: 'Revisar',
        description: 'Comprueba toda la información antes de guardar.',
        icon: ClipboardCheck,
    },
};

/** @param {{ initialMinistries?: any[] }} props */
export default function ModalEvento({ initialMinistries = [] }) {
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
    const [predicador, setPredicador] = useState('');
    const [esAcustico, setEsAcustico] = useState(false);
    const [isSerie, setIsSerie] = useState(false);
    const [applySerie, setApplySerie] = useState(false);
    const [serieId, setSerieId] = useState('');
    const [isStrictModerator, setIsStrictModerator] = useState(false);
    const [canManageRehearsal, setCanManageRehearsal] = useState(false);
    const [rehearsalWeekday, setRehearsalWeekday] = useState(4);
    const [ministryId, setMinistryId] = useState('');
    const [activeWizardStep, setActiveWizardStep] = useState('service');
    const [wizardError, setWizardError] = useState('');
    const [isSeriesOptionsOpen, setIsSeriesOptionsOpen] = useState(false);
    const [isSeriesDeleteConfirmationOpen, setIsSeriesDeleteConfirmationOpen] = useState(false);

    const [isSaving, setIsSaving] = useState(false);
    const [isDeletingSerie, setIsDeletingSerie] = useState(false);

    const [dbData, setDbData] = useState(null);
    const [showPlaylistBtn, setShowPlaylistBtn] = useState(false);
    const [hasPlaylist, setHasPlaylist] = useState(false);
    const [playlistSongs, setPlaylistSongs] = useState([]);
    const [isPlaylistLoading, setIsPlaylistLoading] = useState(false);
    const [playlistError, setPlaylistError] = useState('');
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
                setIsSeriesOptionsOpen(false);
                setIsSeriesDeleteConfirmationOpen(false);
                document.body.style.overflow = '';
                return;
            }

            setIsOpen(true);
            setMode(modalMode);
            setWizardError('');
            setIsSeriesOptionsOpen(false);
            setIsSeriesDeleteConfirmationOpen(false);
            document.body.style.overflow = 'hidden';

            if (modalMode === 'new') {
                setEvId('');
                setTitulo('');
                setFecha('');
                setHoraInicio('');
                setHoraFin('');
                setTema('');
                setPredicador('');
                setEstado('Publicado');
                setEsAcustico(false);
                setIsSerie(false);
                setSerieId('');
                setApplySerie(false);
                setIsStrictModerator(false);
                setCanManageRehearsal(false);
                setRehearsalWeekday(4);
                setMinistryId('');
                setDbData(null);
                setShowPlaylistBtn(false);
                setHasPlaylist(false);
                setPlaylistSongs([]);
                setIsPlaylistLoading(false);
                setPlaylistError('');
                setCollisionDate(null);
                setActiveWizardStep('service');
            } else if (modalMode === 'edit' && data) {
                setEvId(data.id || '');
                setTitulo(data.titulo || '');

                try {
                    const eventDateSource = data.fecha_hora || data.fecha;
                    const d = new Date(eventDateSource);
                    const offset = d.getTimezoneOffset() * 60000;
                    const localISOTime = (new Date(d.getTime() - offset)).toISOString().slice(0, 16);
                    const [fDate, fTime] = localISOTime.split('T');
                    setFecha(fDate);
                    setHoraInicio(fTime);
                } catch (e) { }

                setHoraFin(data.hora_fin || '');
                const rawTema =
                    typeof data.tema === 'string' && data.tema !== 'undefined' && data.tema !== 'null'
                        ? data.tema
                        : data.dbData?.tema_predicacion || '';
                const rawPredicador =
                    typeof data.predicador === 'string' && data.predicador !== 'undefined' && data.predicador !== 'null'
                        ? data.predicador
                        : data.dbData?.predicador || '';
                const parsedPredicacion = getEventThemeAndPreacher(
                    {
                        tema_predicacion: rawTema,
                        predicador: rawPredicador,
                    },
                    '',
                );
                setTema(parsedPredicacion.theme || '');
                setPredicador(parsedPredicacion.preacher || '');
                setEstado(data.estado || 'Publicado');
                setEsAcustico(Boolean(data.es_acustico ?? data.dbData?.es_acustico));

                const strictMod = data.moderator === 'true';
                setIsStrictModerator(strictMod);
                setActiveWizardStep(strictMod ? 'details' : 'service');
                setCanManageRehearsal(data.can_manage_rehearsal === true);
                setRehearsalWeekday(normalizeRehearsalWeekday(data.dbData?.ensayo_dia_semana));
                setMinistryId(data.ministerio_id || data.dbData?.ministerio_id || '');

                if (data.serie_id) {
                    setIsSerie(true);
                    setSerieId(data.serie_id);
                    setApplySerie(false);
                } else {
                    setIsSerie(false);
                    setSerieId('');
                }

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

        const showPlaylistForEvent = async (id) => {
            if (!id) {
                setShowPlaylistBtn(false);
                setHasPlaylist(false);
                setPlaylistSongs([]);
                setIsPlaylistLoading(false);
                setPlaylistError('');
                return;
            }

            setShowPlaylistBtn(false);
            setHasPlaylist(false);
            setPlaylistSongs([]);
            setPlaylistError('');
            setIsPlaylistLoading(true);

            if (String(id).startsWith('virtual|')) {
                setIsPlaylistLoading(false);
                return;
            }

            const currentUserId = user?.id || window.__SSR_USER__?.id || '';
            const profileReq = await supabase.from('perfiles').select('is_admin').eq('id', currentUserId).single();
            if (profileReq.data?.is_admin) {
                setShowPlaylistBtn(true);
            } else {
                const rolesReq = await supabase.from('asignaciones').select('roles(codigo)').eq('evento_id', id).eq('perfil_id', currentUserId);
                if (rolesReq.data) {
                    const codigos = rolesReq.data.map(r => r.roles?.codigo).filter(Boolean);
                    if (codigos.some(isEventRepertoryManagerRoleCode)) {
                        setShowPlaylistBtn(true);
                    }
                }
            }

            try {
                const response = await fetch(`/api/event-playlist?evento_id=${encodeURIComponent(id)}`, {
                    credentials: 'same-origin',
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload?.error || 'No se pudo cargar el repertorio.');

                const nextSongs = normalizePlaylistSongs(payload?.items);
                setPlaylistSongs(nextSongs);
                setHasPlaylist(nextSongs.length > 0);
            } catch (error) {
                console.error('Error revisando setlist del evento:', error);
                setPlaylistError('No se pudo cargar el repertorio.');
            } finally {
                setIsPlaylistLoading(false);
            }
        };
        window._showPlaylistBtn = showPlaylistForEvent;

        return () => {
            if (window._showPlaylistBtn === showPlaylistForEvent) {
                delete window._showPlaylistBtn;
            }
        };
    }, [user]);
    const handleClose = () => {
        setWizardError('');
        setIsSeriesOptionsOpen(false);
        setIsSeriesDeleteConfirmationOpen(false);
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

        const selectedMinistry = (initialMinistries || []).find(
            (ministry) => String(ministry?.id || '') === String(ministryId || ''),
        );
        const isSinFiltros = isSinFiltrosMinistry(selectedMinistry);
        if (isSinFiltros && !isSaturdayDate(fecha)) {
            alert('Sin Filtros se programa los sábados. Selecciona una fecha de sábado.');
            return;
        }

        const shouldManageRehearsal = (
            mode === 'edit'
            && evId
            && !evId.startsWith('virtual|')
            && canManageRehearsal
            && isSundayServiceDate(fecha)
        );
        const previousRehearsalWeekday = normalizeRehearsalWeekday(dbData?.ensayo_dia_semana);
        if (
            shouldManageRehearsal
            && rehearsalWeekday === null
            && previousRehearsalWeekday !== null
            && !window.confirm('¿Guardar este servicio sin ensayo? Se retirará el ensayo de los calendarios conectados y se avisará al equipo.')
        ) {
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
                setIsSaving(false);
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
            const legacyTemaPredicacion = composeLegacyTemaPredicacion(tema, predicador);

            const buildEventWritePayload = (includePredicador = true) => {
                const payload = {
                    titulo,
                    fecha_hora: isoPayload,
                    hora_fin: horaFin || null,
                    tema_predicacion: includePredicador ? (tema || null) : legacyTemaPredicacion,
                    estado,
                    es_acustico: esAcustico,
                    ministerio_id: ministryId || null,
                };

                if (includePredicador) {
                    payload.predicador = predicador || null;
                }

                return payload;
            };

            // Camino A: EdiciÃ³n de un evento existente
            if (evId && !evId.startsWith('virtual|')) {
                if (applySerie && serieId) {
                    // ActualizaciÃ³n masiva a la serie
                    const [
                        { error: serieError },
                        { error: currentEventError },
                    ] = await Promise.all([
                        supabase
                            .from('eventos')
                            .update({ titulo, hora_fin: horaFin || null, es_acustico: esAcustico, ministerio_id: ministryId || null })
                            .eq('serie_id', serieId)
                            .gte('fecha_hora', startCheck),
                        supabase
                            .from('eventos')
                            .update(buildEventWritePayload(true))
                            .eq('id', evId),
                    ]);
                    transacError = serieError || currentEventError;

                    if (transacError && isPredicadorColumnMissingError(transacError)) {
                        console.warn('[ModalEvento] Guardando con fallback legado sin columna predicador.');
                        const [
                            { error: fallbackSerieError },
                            { error: fallbackCurrentEventError },
                        ] = await Promise.all([
                            supabase
                                .from('eventos')
                                .update({ titulo, hora_fin: horaFin || null, es_acustico: esAcustico, ministerio_id: ministryId || null })
                                .eq('serie_id', serieId)
                                .gte('fecha_hora', startCheck),
                            supabase
                                .from('eventos')
                                .update(buildEventWritePayload(false))
                                .eq('id', evId),
                        ]);
                        transacError = fallbackSerieError || fallbackCurrentEventError;
                    }
                } else {
                    // ActualizaciÃ³n individual
                    let { error } = await supabase
                        .from('eventos')
                        .update(buildEventWritePayload(true))
                        .eq('id', evId);

                    if (error && isPredicadorColumnMissingError(error)) {
                        console.warn('[ModalEvento] Guardando con fallback legado sin columna predicador.');
                        const fallbackResp = await supabase
                            .from('eventos')
                            .update(buildEventWritePayload(false))
                            .eq('id', evId);
                        error = fallbackResp.error;
                    }
                    transacError = error;
                }
            } else {
                // Camino B: Evento Nuevo
                const newEv = {
                    ...buildEventWritePayload(true),
                    created_by: currentUserId
                };

                // Evento virtual o FAB (No tiene setteo de serie propio aquÃ­, la serie se crea en Generator modal)
                if (!evId) newEv.notas_especiales = `FREQ=WEEKLY;BYDAY=${getRecurrenceDayCode(fecha)}`;

                let { error } = await supabase.from('eventos').insert([newEv]);

                if (error && isPredicadorColumnMissingError(error)) {
                    console.warn('[ModalEvento] Insertando con fallback legado sin columna predicador.');
                    const fallbackResp = await supabase.from('eventos').insert([{
                        ...buildEventWritePayload(false),
                        created_by: currentUserId,
                        ...(evId ? {} : { notas_especiales: `FREQ=WEEKLY;BYDAY=${getRecurrenceDayCode(fecha)}` })
                    }]);
                    error = fallbackResp.error;
                }
                transacError = error;
            }

            if (transacError) throw transacError;

            let rehearsalSyncHandled = false;
            let rehearsalWarning = '';

            if (shouldManageRehearsal) {
                try {
                    const response = await fetch('/api/event-rehearsal', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            evento_id: evId,
                            ensayo_dia_semana: rehearsalWeekday,
                        }),
                    });
                    const payload = await response.json().catch(() => ({}));
                    if (!response.ok || payload?.ok === false) {
                        throw new Error(payload?.error || 'No se pudo actualizar el ensayo.');
                    }

                    rehearsalSyncHandled = true;
                    const calendarFailed = Number(payload?.calendar?.failed || 0);
                    const notificationFailed = Number(payload?.notification?.failed || 0);
                    const notificationSkipped = Number(payload?.notification?.skipped || 0);
                    const pending = [
                        calendarFailed > 0 ? 'Google Calendar' : '',
                        notificationFailed > 0 ? 'algunos correos' : '',
                        notificationSkipped > 0 ? `${notificationSkipped} integrante${notificationSkipped === 1 ? '' : 's'} sin correo registrado` : '',
                    ].filter(Boolean);
                    if (pending.length > 0) {
                        rehearsalWarning = `El evento y el día de ensayo quedaron guardados. Quedó pendiente: ${pending.join(', ')}.`;
                    }
                } catch (error) {
                    console.warn('No se pudo confirmar la actualización del ensayo:', error);
                    rehearsalWarning = 'El evento quedó guardado, pero no se pudo confirmar la actualización del ensayo y sus avisos. Al recargar verás la fecha que quedó registrada.';
                }
            }

            if (evId && !evId.startsWith('virtual|') && !rehearsalSyncHandled) {
                await syncEventCalendarAssignments(evId);
            }

            handleClose();
            if (rehearsalWarning) {
                alert(rehearsalWarning);
            }
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
        if (!serieId || !isSeriesDeleteConfirmationOpen) return;

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

    const wizardSteps = useMemo(() => [
        ...(!isStrictModerator ? [EVENT_WIZARD_STEP_META.service] : []),
        EVENT_WIZARD_STEP_META.details,
        ...(mode === 'edit' ? [EVENT_WIZARD_STEP_META.team, EVENT_WIZARD_STEP_META.repertoire] : []),
        EVENT_WIZARD_STEP_META.review,
    ], [isStrictModerator, mode]);

    useEffect(() => {
        if (!wizardSteps.some((step) => step.id === activeWizardStep)) {
            setActiveWizardStep(wizardSteps[0]?.id || 'details');
        }
    }, [activeWizardStep, wizardSteps]);

    useEffect(() => {
        if (!isSeriesDeleteConfirmationOpen || typeof window === 'undefined') return undefined;

        const animationFrame = window.requestAnimationFrame(() => {
            const confirmation = document.getElementById('series-delete-confirmation');
            confirmation?.focus({ preventScroll: true });
            confirmation?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });

        return () => window.cancelAnimationFrame(animationFrame);
    }, [isSeriesDeleteConfirmationOpen]);

    const activeWizardIndex = Math.max(
        0,
        wizardSteps.findIndex((step) => step.id === activeWizardStep),
    );
    const activeWizardMeta = wizardSteps[activeWizardIndex] || wizardSteps[0];
    const isLastWizardStep = activeWizardIndex === wizardSteps.length - 1;

    const validateServiceStep = () => {
        if (!titulo.trim() || !fecha || !horaInicio) {
            setWizardError('Completa el título, la fecha y la hora para continuar.');
            return false;
        }

        const ministry = (initialMinistries || []).find(
            (candidate) => String(candidate?.id || '') === String(ministryId || ''),
        );
        if (isSinFiltrosMinistry(ministry) && !isSaturdayDate(fecha)) {
            setWizardError('Sin Filtros se programa los sábados. Elige una fecha de sábado.');
            return false;
        }

        setWizardError('');
        return true;
    };

    const openWizardStep = (stepId) => {
        const targetIndex = wizardSteps.findIndex((step) => step.id === stepId);
        if (targetIndex < 0) return;
        if (
            targetIndex > activeWizardIndex
            && activeWizardStep === 'service'
            && !validateServiceStep()
        ) {
            return;
        }
        setWizardError('');
        setActiveWizardStep(stepId);
    };

    const handleWizardNext = () => {
        if (activeWizardStep === 'service' && !validateServiceStep()) {
            return;
        }
        const nextStep = wizardSteps[activeWizardIndex + 1];
        if (nextStep) {
            setWizardError('');
            setActiveWizardStep(nextStep.id);
        }
    };

    const handleWizardBack = () => {
        const previousStep = wizardSteps[activeWizardIndex - 1];
        if (previousStep) {
            setWizardError('');
            setActiveWizardStep(previousStep.id);
        }
    };

    const handleWizardFormSubmit = (event) => {
        if (!isLastWizardStep) {
            event.preventDefault();
            handleWizardNext();
            return;
        }
        handleSave(event);
    };

    // FunciÃ³n openEquipoPicker nativa movida a RosterManager
    if (!isOpen) return null;

    const rehearsalEventDate = toRehearsalEventDate(fecha);
    const selectedMinistry = (initialMinistries || []).find(
        (ministry) => String(ministry?.id || '') === String(ministryId || ''),
    );
    const isSinFiltros = isSinFiltrosMinistry(selectedMinistry);
    const showRehearsalField = (
        mode === 'edit'
        && canManageRehearsal
        && isSundayServiceDate(fecha)
    );
    const selectedMinistryLabel = selectedMinistry?.nombre || 'Alabanza general';
    const eventDateLabel = fecha
        ? new Intl.DateTimeFormat('es-CO', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
        }).format(new Date(`${fecha}T12:00:00Z`))
        : 'Sin fecha';
    const eventTimeLabel = horaInicio
        ? `${formatClockLabel(horaInicio)}${horaFin ? ` – ${formatClockLabel(horaFin)}` : ''}`
        : 'Sin horario';
    const assignmentCount = Array.isArray(dbData?.asignaciones) ? dbData.asignaciones.length : 0;
    const renderPlaylistSongs = () => {
        if (isPlaylistLoading) {
            return (
                <div className="border-y border-border py-5 text-sm text-content-muted" role="status">
                    Cargando repertorio…
                </div>
            );
        }

        if (playlistError) {
            return (
                <div className="border-y border-red-500/20 py-5 text-sm font-semibold text-red-600 dark:text-red-300" role="alert">
                    {playlistError}
                </div>
            );
        }

        if (playlistSongs.length === 0) {
            return (
                <div className="border-y border-border py-5 text-sm text-content-muted">
                    Este servicio todavía no tiene canciones en el repertorio.
                </div>
            );
        }

        return (
            <ol className="divide-y divide-border border-y border-border">
                {playlistSongs.map((song, index) => (
                    <li key={song.id} className="flex items-center gap-3 py-3.5">
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-500/10 text-xs font-black text-cyan-700 dark:text-cyan-300">
                            {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-black text-content">{song.title}</span>
                            <span className="mt-0.5 block truncate text-xs text-content-muted">{song.artist || 'Sin intérprete indicado'}</span>
                        </span>
                        {song.key && (
                            <span className="shrink-0 rounded-full bg-background px-2.5 py-1 text-xs font-black text-content-muted">
                                {song.key}
                            </span>
                        )}
                    </li>
                ))}
            </ol>
        );
    };

    return (
        <div
            id="event-modal-react"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            data-ui-modal="true"
            className="fixed inset-x-0 z-[80] flex items-end justify-center bg-slate-950/70 backdrop-blur-md sm:items-center sm:p-4"
            style={{
                top: 'var(--app-modal-viewport-offset-top, 0px)',
                height: 'var(--app-modal-viewport-height, 100dvh)',
            }}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !isSaving) handleClose();
            }}
        >
            <div
                className="flex w-full flex-col overflow-hidden rounded-t-[1.65rem] border border-border bg-surface shadow-2xl sm:max-w-4xl sm:rounded-[1.65rem] xl:max-w-5xl"
                style={{ maxHeight: 'min(54rem, calc(var(--app-modal-viewport-height, 100dvh) - 0.75rem))' }}
            >
                <header className="shrink-0 border-b border-border bg-surface/95 px-4 pb-3 pt-4 backdrop-blur-xl sm:px-6 sm:pt-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-brand">
                                {mode === 'new' ? 'Nuevo evento' : 'Gestionar evento'}
                            </p>
                            <h2 id="modal-title" className="mt-1 truncate text-xl font-black text-content sm:text-2xl">
                                {mode === 'new' ? 'Preparar servicio' : (titulo || 'Editar servicio')}
                            </h2>
                            <p className="mt-1 text-sm text-content-muted">
                                Paso {activeWizardIndex + 1} de {wizardSteps.length} · {activeWizardMeta?.label}
                            </p>
                        </div>
                        <button
                            id="btn-close-modal"
                            type="button"
                            onClick={handleClose}
                            disabled={isSaving}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-content-muted transition-colors hover:bg-surface hover:text-content disabled:opacity-50"
                            aria-label="Cerrar asistente de evento"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <ol
                        className="mt-4 grid gap-1.5"
                        style={{ gridTemplateColumns: `repeat(${wizardSteps.length}, minmax(0, 1fr))` }}
                        aria-label="Etapas del evento"
                        role="tablist"
                    >
                        {wizardSteps.map((step, index) => {
                            const StepIcon = step.icon;
                            const isActive = step.id === activeWizardStep;
                            const isComplete = index < activeWizardIndex;
                            return (
                                <li key={step.id} className="min-w-0">
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={isActive}
                                        aria-controls={`event-wizard-panel-${step.id}`}
                                        tabIndex={isActive ? 0 : -1}
                                        onClick={() => openWizardStep(step.id)}
                                        disabled={isSaving}
                                        className={`flex min-h-[3.35rem] w-full flex-col items-center justify-center rounded-xl border px-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${isActive
                                            ? 'border-brand bg-brand text-white shadow-sm'
                                            : isComplete
                                                ? 'border-brand/25 bg-brand/10 text-brand'
                                                : 'border-border bg-background text-content-muted'} disabled:cursor-not-allowed disabled:opacity-55`}
                                    >
                                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-current/10">
                                            {isComplete && !isActive ? <Check className="h-3 w-3" /> : <StepIcon className="h-3.5 w-3.5" />}
                                        </span>
                                        <span className="mt-0.5 truncate text-[10px] font-bold sm:text-xs">{step.shortLabel}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background/70 px-4 py-5 sm:px-6 sm:py-6">
                    <form id="form-event" className="mx-auto w-full max-w-4xl" onSubmit={handleWizardFormSubmit}>
                        <input type="hidden" id="ev-id" value={evId} readOnly />
                        <input type="hidden" id="ev-serie-id" value={serieId} readOnly />

                        {wizardError && (
                            <div role="alert" className="mb-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-300">
                                {wizardError}
                            </div>
                        )}

                        {activeWizardStep === 'service' && (
                            <section id="event-wizard-panel-service" role="tabpanel" aria-labelledby="event-wizard-service-title">
                                <div className="mb-5 flex items-start gap-3">
                                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                                        <CalendarDays className="h-5 w-5" />
                                    </span>
                                    <div>
                                        <h3 id="event-wizard-service-title" className="text-lg font-black text-content">Datos del servicio</h3>
                                        <p className="mt-0.5 text-sm text-content-muted">Define qué se celebra y cuándo.</p>
                                    </div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="block sm:col-span-2 lg:col-span-1" id="ev-container-titulo">
                                        <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Título del evento *</span>
                                        <input
                                            type="text"
                                            id="ev-titulo"
                                            required
                                            value={titulo}
                                            onChange={(event) => setTitulo(event.target.value)}
                                            autoFocus
                                            className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base font-semibold text-content outline-none placeholder:font-normal placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                                            placeholder="Ej. Culto de adoración"
                                        />
                                    </label>
                                    <label className="block sm:col-span-2 lg:col-span-1">
                                        <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Ministerio</span>
                                        <select
                                            id="ev-ministerio"
                                            value={ministryId}
                                            onChange={(event) => {
                                                const nextMinistryId = event.target.value;
                                                const nextMinistry = (initialMinistries || []).find((ministry) => ministry.id === nextMinistryId);
                                                setMinistryId(nextMinistryId);
                                                if (isSinFiltrosMinistry(nextMinistry)) {
                                                    if (!titulo.trim()) setTitulo(SIN_FILTROS_MINISTRY_NAME);
                                                    if (!horaInicio) setHoraInicio(SIN_FILTROS_SERVICE_TIME);
                                                }
                                            }}
                                            className="mt-2 h-12 w-full appearance-none rounded-xl border border-border bg-surface px-4 text-base text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                                        >
                                            <option value="">Alabanza general</option>
                                            {(initialMinistries || []).map((ministry) => (
                                                <option key={ministry.id} value={ministry.id}>{ministry.nombre}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block" id="ev-container-fechas">
                                        <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Fecha *</span>
                                        <input
                                            type="date"
                                            id="ev-fecha"
                                            required
                                            value={fecha}
                                            onChange={(event) => setFecha(event.target.value)}
                                            className="mt-2 h-12 w-full min-w-0 rounded-xl border border-border bg-surface px-4 text-base text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                                        />
                                    </label>
                                    <div className="grid min-w-0 grid-cols-2 gap-3">
                                        <label className="block min-w-0">
                                            <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Hora *</span>
                                            <input
                                                type="time"
                                                id="ev-hora-inicio"
                                                required
                                                value={horaInicio}
                                                onChange={(event) => setHoraInicio(event.target.value)}
                                                className="mt-2 h-12 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-base text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                                            />
                                        </label>
                                        <label className="block min-w-0">
                                            <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Fin <span className="font-normal normal-case">(opcional)</span></span>
                                            <input
                                                type="time"
                                                id="ev-hora-fin"
                                                value={horaFin}
                                                onChange={(event) => setHoraFin(event.target.value)}
                                                className="mt-2 h-12 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-base text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                                            />
                                        </label>
                                    </div>
                                </div>
                            </section>
                        )}

                        {activeWizardStep === 'details' && (
                            <section id="event-wizard-panel-details" role="tabpanel" aria-labelledby="event-wizard-details-title">
                                <div className="mb-5 flex items-start gap-3">
                                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-500">
                                        <Settings2 className="h-5 w-5" />
                                    </span>
                                    <div>
                                        <h3 id="event-wizard-details-title" className="text-lg font-black text-content">Detalles del evento</h3>
                                        <p className="mt-0.5 text-sm text-content-muted">Ajusta ensayo, publicación y predicación.</p>
                                    </div>
                                </div>

                                <div className="grid gap-4">
                                    {!isStrictModerator && (
                                        <label className="block min-w-0" id="ev-container-estado">
                                            <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Estado</span>
                                            <select
                                                id="ev-estado"
                                                value={estado}
                                                onChange={(event) => setEstado(event.target.value)}
                                                className="mt-2 h-12 w-full appearance-none rounded-xl border border-border bg-surface px-4 text-base text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                                            >
                                                <option value="Borrador">Borrador</option>
                                                <option value="Publicado">Publicado</option>
                                            </select>
                                        </label>
                                    )}

                                    {showRehearsalField && (
                                        <label className="block">
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Día de ensayo</span>
                                                <span className="text-xs font-bold text-content-muted">7:00 p. m.</span>
                                            </div>
                                            <select
                                                id="ev-ensayo-dia"
                                                value={rehearsalWeekday === null ? 'none' : String(rehearsalWeekday)}
                                                onChange={(event) => setRehearsalWeekday(event.target.value === 'none' ? null : Number(event.target.value))}
                                                className="h-12 w-full appearance-none rounded-xl border border-border bg-surface px-4 text-base text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                                            >
                                                {REHEARSAL_WEEKDAY_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {formatEventRehearsalLabel({ eventDate: rehearsalEventDate, rehearsalWeekday: option.value })}
                                                    </option>
                                                ))}
                                                <option value="none">Sin ensayo</option>
                                            </select>
                                        </label>
                                    )}

                                    {isSinFiltros && (
                                        <div className="flex min-h-14 items-center justify-between gap-4 rounded-2xl border border-blue-400/25 bg-blue-500/10 px-4 py-3">
                                            <div>
                                                <p className="text-xs font-black uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">Ensayo fijo · Sin Filtros</p>
                                                <p className="mt-1 text-sm text-content-muted">El mismo sábado antes del culto.</p>
                                            </div>
                                            <span className="shrink-0 rounded-full border border-blue-400/25 bg-surface px-3 py-1.5 text-sm font-black text-content">
                                                {formatClockLabel(SIN_FILTROS_REHEARSAL_TIME)}
                                            </span>
                                        </div>
                                    )}

                                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.65fr)_minmax(220px,0.95fr)]">
                                        <label className="block min-w-0">
                                            <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Tema de predicación <span className="font-normal normal-case">(opcional)</span></span>
                                            <input
                                                type="text"
                                                id="ev-tema"
                                                value={tema}
                                                onChange={(event) => setTema(event.target.value)}
                                                className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                                                placeholder="Ej. Proverbios"
                                            />
                                        </label>
                                        <label className="block min-w-0">
                                            <span className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Predicador <span className="font-normal normal-case">(opcional)</span></span>
                                            <input
                                                type="text"
                                                id="ev-predicador"
                                                value={predicador}
                                                onChange={(event) => setPredicador(event.target.value)}
                                                className="mt-2 h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-content outline-none placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20"
                                                placeholder="Ej. P. Ronald"
                                            />
                                        </label>
                                    </div>

                                    {isSerie && !isStrictModerator && (
                                        <section id="serie-update-section" className="overflow-hidden rounded-2xl border border-border bg-surface">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (isDeletingSerie) return;
                                                    setIsSeriesOptionsOpen((current) => {
                                                        const next = !current;
                                                        if (!next) {
                                                            setApplySerie(false);
                                                            setIsSeriesDeleteConfirmationOpen(false);
                                                        }
                                                        return next;
                                                    });
                                                }}
                                                aria-expanded={isSeriesOptionsOpen}
                                                aria-controls="series-advanced-options"
                                                className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500/30 disabled:opacity-50"
                                                disabled={isDeletingSerie}
                                            >
                                                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
                                                    <Layers3 className="h-5 w-5" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm font-black text-content">Acciones avanzadas de la serie</span>
                                                    <span className="mt-0.5 block text-xs text-content-muted">Cambios masivos y eliminación.</span>
                                                </span>
                                                <ChevronDown className={`h-5 w-5 shrink-0 text-content-muted transition-transform ${isSeriesOptionsOpen ? 'rotate-180' : ''}`} />
                                            </button>

                                            {isSeriesOptionsOpen && (
                                                <div id="series-advanced-options" className="border-t border-border px-4 pb-4">
                                                    <div className="flex items-start gap-3 py-3.5">
                                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                                                        <p className="text-xs leading-relaxed text-content-muted">
                                                            Estas acciones afectan más de un evento. Revísalas con cuidado antes de guardar.
                                                        </p>
                                                    </div>

                                                    <label className="flex cursor-pointer items-start gap-3 border-t border-border py-3.5">
                                                        <input
                                                            type="checkbox"
                                                            id="ev-serie-check"
                                                            checked={applySerie}
                                                            onChange={(event) => setApplySerie(event.target.checked)}
                                                            className="mt-0.5 h-5 w-5 rounded border-border accent-teal-500"
                                                        />
                                                        <span>
                                                            <span className="block text-sm font-bold text-content">Aplicar cambios a eventos futuros</span>
                                                            <span className="mt-1 block text-xs leading-relaxed text-content-muted">Actualiza título, hora final, formato y ministerio en esta serie.</span>
                                                        </span>
                                                    </label>

                                                    {applySerie && (
                                                        <p role="status" className="pb-1 text-xs font-semibold text-teal-700 dark:text-teal-300">
                                                            El botón final cambiará a “Guardar toda la serie”.
                                                        </p>
                                                    )}

                                                    <div className="mt-4 border-t border-border pt-4">
                                                        {!isSeriesDeleteConfirmationOpen ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => setIsSeriesDeleteConfirmationOpen(true)}
                                                                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-surface px-4 text-sm font-bold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-300"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                                Eliminar esta serie…
                                                            </button>
                                                        ) : (
                                                            <div
                                                                id="series-delete-confirmation"
                                                                className="outline-none"
                                                                role="alert"
                                                                tabIndex={-1}
                                                            >
                                                                <p className="text-sm font-black text-red-600 dark:text-red-300">¿Eliminar todos los eventos de esta serie?</p>
                                                                <p className="mt-1 text-xs leading-relaxed text-content-muted">Esta acción es permanente y no se puede deshacer.</p>
                                                                <div className="mt-3 grid grid-cols-2 gap-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setIsSeriesDeleteConfirmationOpen(false)}
                                                                        disabled={isDeletingSerie}
                                                                        className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm font-bold text-content transition-colors hover:bg-background disabled:opacity-50"
                                                                    >
                                                                        No, cancelar
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={handleDeleteSerie}
                                                                        disabled={isDeletingSerie}
                                                                        id="btn-eliminar-serie"
                                                                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 text-sm font-black text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                                                                    >
                                                                        {isDeletingSerie ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Trash2 className="h-4 w-4" />}
                                                                        {isDeletingSerie ? 'Eliminando...' : 'Sí, eliminar serie'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </section>
                                    )}
                                </div>
                            </section>
                        )}

                        {activeWizardStep === 'team' && mode === 'edit' && (
                            <section id="event-wizard-panel-team" role="tabpanel" aria-labelledby="event-wizard-team-title">
                                <div className="mb-5 flex items-start gap-3">
                                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                                        <UsersRound className="h-5 w-5" />
                                    </span>
                                    <div>
                                        <h3 id="event-wizard-team-title" className="text-lg font-black text-content">Equipo</h3>
                                        <p className="mt-0.5 text-sm text-content-muted">Define el formato y las personas asignadas.</p>
                                    </div>
                                </div>

                                {!isStrictModerator && (
                                    <label className="mb-5 flex min-h-14 cursor-pointer select-none items-center justify-between gap-4 border-y border-border py-3" id="ev-container-acustico">
                                        <span>
                                            <span className="block text-sm font-black text-content">Servicio acústico</span>
                                            <span className="mt-0.5 block text-xs text-content-muted">Ajusta los instrumentos disponibles para este formato.</span>
                                        </span>
                                        <input
                                            type="checkbox"
                                            id="ev-es-acustico"
                                            checked={esAcustico}
                                            onChange={(event) => setEsAcustico(event.target.checked)}
                                            className="h-5 w-5 shrink-0 rounded border-border accent-sky-500"
                                        />
                                    </label>
                                )}

                                <div
                                    id="modal-roster-section"
                                    style={{ '--color-rol-dir': '14 165 233', '--color-rol-voc': '249 115 22' }}
                                >
                                    <div className="mb-4 flex items-center justify-between gap-3">
                                        <div>
                                            <h4 className="text-sm font-black uppercase tracking-[0.12em] text-content">Asignaciones</h4>
                                            <p className="mt-1 text-xs text-content-muted">Los cambios de equipo se aplican al seleccionar cada persona.</p>
                                        </div>
                                        <span className="shrink-0 rounded-full bg-brand/10 px-3 py-1 text-xs font-black text-brand">{assignmentCount}</span>
                                    </div>
                                    <RosterManager
                                        evId={evId}
                                        evFechaStr={fecha}
                                        evTituloStr={titulo}
                                        evTemaStr={tema}
                                        evEstadoStr={estado}
                                        esAcustico={esAcustico}
                                        isStrictModerator={isStrictModerator}
                                        canEditRoster={mode === 'edit'}
                                        dbData={dbData}
                                        onRosterChange={(nextAsignaciones) => {
                                            setDbData((prev) => (
                                                prev ? { ...prev, asignaciones: nextAsignaciones } : { asignaciones: nextAsignaciones }
                                            ));
                                        }}
                                    />
                                </div>
                            </section>
                        )}

                        {activeWizardStep === 'repertoire' && mode === 'edit' && (
                            <section id="event-wizard-panel-repertoire" role="tabpanel" aria-labelledby="event-wizard-repertoire-title">
                                <div className="mb-5 flex items-start gap-3">
                                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-500">
                                        <ListMusic className="h-5 w-5" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <h3 id="event-wizard-repertoire-title" className="text-lg font-black text-content">Repertorio</h3>
                                        <p className="mt-0.5 text-sm text-content-muted">Canciones preparadas para este servicio.</p>
                                    </div>
                                    <span className="shrink-0 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-black text-cyan-700 dark:text-cyan-300">
                                        {playlistSongs.length}
                                    </span>
                                </div>

                                {showPlaylistBtn && (
                                    <button
                                        type="button"
                                        id="btn-armar-playlist"
                                        onClick={() => {
                                            if (evId) window.location.href = `/repertorio?seleccionar_para=${evId}`;
                                        }}
                                        className="mb-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 text-sm font-black text-white transition-colors hover:bg-cyan-700 sm:w-auto"
                                    >
                                        <ListMusic className="h-4 w-4" />
                                        {hasPlaylist ? 'Editar repertorio' : 'Armar repertorio'}
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                )}

                                {renderPlaylistSongs()}
                            </section>
                        )}

                        {activeWizardStep === 'review' && (
                            <section id="event-wizard-panel-review" role="tabpanel" aria-labelledby="event-wizard-review-title">
                                <div className="mb-5 flex items-start gap-3">
                                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                                        <CheckCircle2 className="h-5 w-5" />
                                    </span>
                                    <div>
                                        <h3 id="event-wizard-review-title" className="text-lg font-black text-content">Revisa antes de guardar</h3>
                                        <p className="mt-0.5 text-sm text-content-muted">Toda la información del evento, sin secciones ocultas.</p>
                                    </div>
                                </div>

                                <div className="space-y-8">
                                    <section>
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <h4 className="text-xs font-black uppercase tracking-[0.16em] text-content-muted">Servicio</h4>
                                            {!isStrictModerator && (
                                                <button type="button" onClick={() => openWizardStep('service')} className="text-xs font-black text-brand hover:underline">Editar</button>
                                            )}
                                        </div>
                                        <dl className="divide-y divide-border border-y border-border">
                                            <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                                                <dt className="text-xs font-bold text-content-muted">Evento</dt>
                                                <dd className="text-sm font-black text-content">{titulo || 'Sin título'}</dd>
                                            </div>
                                            <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                                                <dt className="text-xs font-bold text-content-muted">Ministerio</dt>
                                                <dd className="text-sm font-semibold text-content">{selectedMinistryLabel}</dd>
                                            </div>
                                            <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                                                <dt className="text-xs font-bold text-content-muted">Fecha</dt>
                                                <dd className="capitalize text-sm font-semibold text-content">{eventDateLabel}</dd>
                                            </div>
                                            <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                                                <dt className="text-xs font-bold text-content-muted">Horario</dt>
                                                <dd className="text-sm font-semibold text-content">{eventTimeLabel}</dd>
                                            </div>
                                        </dl>
                                    </section>

                                    <section>
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <h4 className="text-xs font-black uppercase tracking-[0.16em] text-content-muted">Detalles</h4>
                                            <button type="button" onClick={() => openWizardStep('details')} className="text-xs font-black text-brand hover:underline">Editar</button>
                                        </div>
                                        <dl className="divide-y divide-border border-y border-border">
                                            <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                                                <dt className="text-xs font-bold text-content-muted">Estado</dt>
                                                <dd className="text-sm font-semibold text-content">{estado}</dd>
                                            </div>
                                            {(showRehearsalField || isSinFiltros) && (
                                                <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                                                    <dt className="text-xs font-bold text-content-muted">Ensayo</dt>
                                                    <dd className="text-sm font-semibold text-content">
                                                        {isSinFiltros
                                                            ? `El mismo sábado · ${formatClockLabel(SIN_FILTROS_REHEARSAL_TIME)}`
                                                            : rehearsalWeekday === null
                                                                ? 'Sin ensayo'
                                                                : formatEventRehearsalLabel({ eventDate: rehearsalEventDate, rehearsalWeekday })}
                                                    </dd>
                                                </div>
                                            )}
                                            <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                                                <dt className="text-xs font-bold text-content-muted">Tema</dt>
                                                <dd className="text-sm font-semibold text-content">{tema || 'Sin tema definido'}</dd>
                                            </div>
                                            <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                                                <dt className="text-xs font-bold text-content-muted">Predicador</dt>
                                                <dd className="text-sm font-semibold text-content">{predicador || 'Sin predicador definido'}</dd>
                                            </div>
                                            {isSerie && applySerie && (
                                                <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                                                    <dt className="text-xs font-bold text-content-muted">Alcance</dt>
                                                    <dd className="text-sm font-black text-amber-700 dark:text-amber-300">Eventos futuros de toda la serie</dd>
                                                </div>
                                            )}
                                        </dl>
                                    </section>

                                    {mode === 'edit' && (
                                        <>
                                            <section>
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <div>
                                                        <h4 className="text-xs font-black uppercase tracking-[0.16em] text-content-muted">Equipo</h4>
                                                        <p className="mt-1 text-xs text-content-muted">{assignmentCount} {assignmentCount === 1 ? 'asignación' : 'asignaciones'} · {esAcustico ? 'Servicio acústico' : 'Servicio completo'}</p>
                                                    </div>
                                                    <button type="button" onClick={() => openWizardStep('team')} className="text-xs font-black text-brand hover:underline">Editar</button>
                                                </div>
                                                <div style={{ '--color-rol-dir': '14 165 233', '--color-rol-voc': '249 115 22' }}>
                                                    <RosterManager
                                                        evId={evId}
                                                        evFechaStr={fecha}
                                                        esAcustico={esAcustico}
                                                        isStrictModerator={isStrictModerator}
                                                        canEditRoster={false}
                                                        dbData={dbData}
                                                    />
                                                </div>
                                            </section>

                                            <section>
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <div>
                                                        <h4 className="text-xs font-black uppercase tracking-[0.16em] text-content-muted">Repertorio</h4>
                                                        <p className="mt-1 text-xs text-content-muted">{playlistSongs.length} {playlistSongs.length === 1 ? 'canción' : 'canciones'}</p>
                                                    </div>
                                                    <button type="button" onClick={() => openWizardStep('repertoire')} className="text-xs font-black text-brand hover:underline">Editar</button>
                                                </div>
                                                {renderPlaylistSongs()}
                                            </section>
                                        </>
                                    )}
                                </div>

                                {mode === 'new' && (
                                    <div className="mt-6 border-l-2 border-brand pl-4 text-sm text-content-muted">
                                        Guarda el evento primero; después podrás añadir repertorio y asignar el equipo.
                                    </div>
                                )}
                            </section>
                        )}
                    </form>
                </div>

                <footer className="shrink-0 border-t border-border bg-surface px-4 pb-[calc(0.9rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4">
                    <div className="flex items-center gap-2.5 sm:gap-3">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={isSaving}
                            id="btn-cancel-modal"
                            className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-border bg-background px-3 text-sm font-bold text-content transition-colors hover:bg-border disabled:opacity-50 sm:flex-none sm:px-5"
                        >
                            Cancelar
                        </button>
                        {activeWizardIndex > 0 && (
                            <button
                                type="button"
                                onClick={handleWizardBack}
                                disabled={isSaving}
                                className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-bold text-content transition-colors hover:bg-background disabled:opacity-50 sm:flex-none sm:px-5"
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Atrás
                            </button>
                        )}
                        {!isLastWizardStep ? (
                            <button
                                type="button"
                                onClick={handleWizardNext}
                                disabled={isSaving}
                                className="inline-flex h-12 flex-[1.3] items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-black text-white shadow-sm transition-colors hover:bg-brand/90 disabled:opacity-50 sm:ml-auto sm:flex-none sm:px-7"
                            >
                                Siguiente
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        ) : (
                            <button
                                type="submit"
                                form="form-event"
                                disabled={isSaving}
                                id="btn-submit-modal"
                                className="inline-flex h-12 flex-[1.3] items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-black text-white shadow-sm transition-colors hover:bg-brand/90 disabled:opacity-50 sm:ml-auto sm:flex-none sm:px-7"
                            >
                                <span>{isSaving ? 'Guardando...' : (applySerie ? 'Guardar toda la serie' : 'Guardar evento')}</span>
                                {isSaving ? <span id="btn-spinner" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Check className="h-4 w-4" />}
                            </button>
                        )}
                    </div>
                </footer>
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
