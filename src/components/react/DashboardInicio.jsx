import React, { useEffect, useRef, useState } from 'react';
import { buildEventHeadline, getEventThemeAndPreacher } from '../../lib/event-display.js';

const getFirstName = (fullName) => {
    if (!fullName || typeof fullName !== 'string') return '';
    return fullName.trim().split(' ')[0] || '';
};

const formatEventDate = (isoString) => {
    if (!isoString) return { day: '--', month: '---' };
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return { day: '--', month: '---' };

    return {
        day: String(date.getDate()),
        month: date.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '').toUpperCase()
    };
};

const formatTimeRange = (isoString, horaFin) => {
    if (!isoString) return 'Hora por definir';
    const start = new Date(isoString);
    if (Number.isNaN(start.getTime())) return 'Hora por definir';

    const startText = start.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (!horaFin) return startText;
    return `${startText} - ${String(horaFin).slice(0, 5)}`;
};

const formatDayMonth = (isoDate) => {
    if (!isoDate || typeof isoDate !== 'string') return '';
    const safeDate = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(safeDate.getTime())) return '';
    return safeDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
};

const getInitials = (fullName) => {
    if (!fullName || typeof fullName !== 'string') return 'RD';
    return fullName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('');
};

const getMonthName = (monthNumber) => {
    if (!monthNumber) return '';
    const safeDate = new Date(2026, monthNumber - 1, 1);
    if (Number.isNaN(safeDate.getTime())) return '';
    return safeDate.toLocaleDateString('es-ES', { month: 'long' });
};

const DashboardInicio = ({ usuario, proximosServicios = [], eventosEspeciales = [], cumpleanerosMes = [], cumpleanerosTodos = [] }) => {
    const [dismissUpcomingHint, setDismissUpcomingHint] = useState(false);
    const [dismissEnvironmentHint, setDismissEnvironmentHint] = useState(false);
    const [devicePlatform, setDevicePlatform] = useState('other');
    const [canInstallPrompt, setCanInstallPrompt] = useState(false);
    const [isStandaloneApp, setIsStandaloneApp] = useState(false);
    const [installNotice, setInstallNotice] = useState('');
    const [installModal, setInstallModal] = useState({ open: false, title: '', steps: [], platform: 'ios' });
    const [birthdaysModalOpen, setBirthdaysModalOpen] = useState(false);
    const installPromptRef = useRef(null);

    useEffect(() => {
        const scrollRoot = document.getElementById('dashboard-scroll-root');
        if (scrollRoot) scrollRoot.scrollTop = 0;
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        return () => {
        };
    }, []);

    useEffect(() => {
        setDismissUpcomingHint(false);
    }, [proximosServicios.length]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const ua = window.navigator.userAgent.toLowerCase();
        const isIOS = /iphone|ipad|ipod/.test(ua);
        const isAndroid = /android/.test(ua);
        const mediaStandalone = window.matchMedia('(display-mode: standalone)');

        const syncStandalone = () => {
            const standalone = mediaStandalone.matches || window.navigator.standalone === true;
            setIsStandaloneApp(Boolean(standalone));
            if (standalone) {
                setCanInstallPrompt(false);
            }
        };

        syncStandalone();

        if (isIOS) setDevicePlatform('ios');
        else if (isAndroid) setDevicePlatform('android');
        else setDevicePlatform('other');

        const onBeforeInstallPrompt = (event) => {
            event.preventDefault();
            installPromptRef.current = event;
            setCanInstallPrompt(true);
            setInstallNotice('');
        };

        const onAppInstalled = () => {
            installPromptRef.current = null;
            setCanInstallPrompt(false);
            setInstallNotice('Aplicacion instalada correctamente.');
            syncStandalone();
        };

        if (typeof mediaStandalone.addEventListener === 'function') {
            mediaStandalone.addEventListener('change', syncStandalone);
        } else if (typeof mediaStandalone.addListener === 'function') {
            mediaStandalone.addListener(syncStandalone);
        }

        window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
        window.addEventListener('appinstalled', onAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
            window.removeEventListener('appinstalled', onAppInstalled);
            if (typeof mediaStandalone.removeEventListener === 'function') {
                mediaStandalone.removeEventListener('change', syncStandalone);
            } else if (typeof mediaStandalone.removeListener === 'function') {
                mediaStandalone.removeListener(syncStandalone);
            }
        };
    }, []);

    const openInstallHelpModal = (platform) => {
        if (platform === 'android') {
            setInstallModal({
                open: true,
                platform: 'android',
                title: 'Instalar la app en Android',
                steps: [
                    'Abre el menu del navegador (tres puntos).',
                    'Toca "Agregar a pantalla de inicio" o "Instalar app".',
                    'Confirma y quedara como app en tu inicio.',
                ],
            });
            return;
        }

        setInstallModal({
            open: true,
            platform: 'ios',
            title: 'Instalar la app en iOS',
            steps: [
                'Abre esta pagina en Safari.',
                'Toca el boton Compartir.',
                'Selecciona "Añadir a pantalla de inicio".',
                'Confirma y aparecera como app en el inicio.',
            ],
        });
    };

    const handleInstallAndroid = async () => {
        if (installPromptRef.current) {
            const promptEvent = installPromptRef.current;
            promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            installPromptRef.current = null;
            setCanInstallPrompt(false);
            if (choice?.outcome === 'accepted') {
                setInstallNotice('Instalacion iniciada en Android.');
            } else {
                setInstallNotice('Instalacion cancelada.');
            }
            return;
        }

        openInstallHelpModal('android');
    };

    const handleInstallIOS = () => {
        setInstallNotice('');
        openInstallHelpModal('ios');
    };

    const nombre = usuario?.nombre ? getFirstName(usuario.nombre) : 'M\u00FAsico';
    const opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const fechaHoy = new Date().toLocaleDateString('es-ES', opcionesFecha);
    const fechaHoyCapitalizada = fechaHoy.charAt(0).toUpperCase() + fechaHoy.slice(1);
    const mesActualStr = new Date().toLocaleString('es-ES', { month: 'long' });
    const showUpcomingHint = proximosServicios.length > 1 && !dismissUpcomingHint;
    const cumpleanerosPorMes = cumpleanerosTodos.reduce((groups, persona) => {
        if (!persona?.mes) return groups;
        const month = persona.mes;
        const existingGroup = groups.find((group) => group.month === month);
        if (existingGroup) {
            existingGroup.personas.push(persona);
        } else {
            groups.push({
                month,
                label: getMonthName(month),
                personas: [persona],
            });
        }
        return groups;
    }, []);

    return (
        <>
        <div className="w-full max-w-[1720px] mx-auto selection:bg-brand/20 flex flex-col lg:flex-row gap-6 lg:gap-8 2xl:gap-10 xl:grid xl:grid-cols-[minmax(0,1fr)_460px] 2xl:grid-cols-[minmax(0,1fr)_560px]">
            {/* Columna Izquierda */}
            <div className="flex-1 min-w-0 w-full flex flex-col gap-6">
                <header className="px-3 sm:px-4 lg:px-0 mt-2">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h1 className="text-[2rem] md:text-[2.5rem] font-extrabold text-content tracking-tight leading-none">Hola {nombre}</h1>
                            <p className="text-sm font-medium text-content-muted mt-2 capitalize">{fechaHoyCapitalizada}</p>
                        </div>
                        <a
                            href="/"
                            className="rounded-xl border border-border bg-surface/90 p-1 shadow-sm"
                            aria-label="Inicio Redil"
                        >
                            <img src="/LOGO%20REDIL%20LIGHT.png" alt="Redil" decoding="async" className="w-12 h-auto dark:hidden md:w-14" />
                            <img src="/LOGO%20REDIL.png" alt="Redil" decoding="async" className="hidden w-12 h-auto dark:block md:w-14" />
                        </a>
                    </div>
                </header>

                <section className="flex-1 flex flex-col" data-tour="assignments">
                    <div className="flex items-center justify-between gap-3 px-3 sm:px-4 lg:px-0 mb-3">
                        <h2 className="text-lg font-bold text-content tracking-tight">Mis Asignaciones</h2>
                        {showUpcomingHint && (
                            <span className="md:hidden inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-surface/80 text-[10px] font-bold text-content-muted uppercase tracking-wide [animation:deslizaInicioHintLoop_4.8s_ease-in-out_infinite]">
                                Desliza
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse">
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                            </span>
                        )}
                    </div>

                    <div className="relative -mx-3 sm:mx-0">
                    <div
                        className="flex overflow-x-auto gap-4 px-3 sm:px-4 pb-4 snap-x snap-mandatory hide-scrollbar w-full h-full lg:flex-1 lg:px-0 lg:pb-0 lg:overflow-visible lg:grid lg:[grid-template-columns:repeat(auto-fit,minmax(300px,1fr))] lg:auto-rows-fr lg:gap-6 2xl:gap-8"
                        onScroll={(e) => {
                            const el = e.currentTarget;
                            const reachedEnd = (el.scrollWidth - (el.scrollLeft + el.clientWidth)) <= 12;
                            if (reachedEnd) {
                                setDismissUpcomingHint(true);
                            }
                        }}
                    >
                        {proximosServicios.length === 0 ? (
                            <div className="w-full h-full shrink-0 snap-center rounded-[2rem] p-6 shadow-sm border border-zinc-200/80 lg:min-h-[260px] 2xl:min-h-[300px] lg:col-span-full flex items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(59,130,246,0.05),_transparent_50%),linear-gradient(180deg,_rgba(255,255,255,0.99),_rgba(244,244,245,0.97))] dark:border-white/10 dark:bg-[radial-gradient(circle_at_center,_rgba(59,130,246,0.12),_transparent_50%),linear-gradient(180deg,_rgba(24,24,27,0.98),_rgba(15,23,42,0.95))]">
                                <div className="flex flex-col items-center justify-center text-center gap-3 py-4">
                                    <div className="w-16 h-16 bg-neutral/20 rounded-full flex items-center justify-center text-neutral mb-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h20" /><path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" /><path d="m4 8 16-4" /><path d="m4 4 16 4" /></svg>
                                    </div>
                                    <h3 className="font-bold text-content">Sin Asignaciones</h3>
                                    <p className="text-sm text-content-muted">No tienes servicios próximos asignados.</p>
                                </div>
                            </div>
                        ) : (
                            proximosServicios.map((servicio) => {
                                const evento = servicio.eventos || servicio;
                                const fecha = formatEventDate(evento.fecha_hora);
                                const { theme: temaPrincipal, preacher: predicador } = getEventThemeAndPreacher(
                                    evento,
                                    evento.titulo || 'Servicio',
                                );
                                const headline = buildEventHeadline(evento, evento.titulo || 'Servicio');
                                const horaTexto = formatTimeRange(evento.fecha_hora, evento.hora_fin);
                                const hasSetlist = Boolean(servicio?.has_setlist);
                                const setlistCount = Number(servicio?.setlist_count || 0);
                                const crearSetlistHref = servicio?.crear_setlist_href || `/repertorio?seleccionar_para=${evento.id}`;
                                const roleCodes = Array.isArray(servicio?.mi_rol_codigos) ? servicio.mi_rol_codigos : [];
                                const canManageSetlist = Boolean(
                                    usuario?.is_admin
                                    || roleCodes.includes('lider_alabanza')
                                    || roleCodes.includes('talkback')
                                );
                                const misRoles = Array.isArray(servicio.mis_roles) && servicio.mis_roles.length > 0
                                    ? servicio.mis_roles
                                    : [servicio.roles?.nombre || 'Miembro'];
                                const miRolTexto = misRoles.join(' / ');

                                const roster = Array.isArray(evento.asignaciones) ? evento.asignaciones : [];
                                const liderAsignado = roster.find((r) => r?.roles?.codigo === 'lider_alabanza' && r?.perfiles?.nombre);
                                const dirigeTexto = liderAsignado ? getFirstName(liderAsignado.perfiles.nombre) : null;
                                const openDetalleRepertorio = () => {
                                    if (typeof window === 'undefined') return;

                                    const detallePayload = {
                                        id: evento.id,
                                        isVirtual: false,
                                        fecha: new Date(evento.fecha_hora),
                                        dbData: evento
                                    };

                                    const tryOpen = (attempt = 0) => {
                                        if (window.openDetalleReact) {
                                            window.openDetalleReact(detallePayload, { focusSection: 'repertorio' });
                                            return;
                                        }
                                        if (attempt < 12) {
                                            window.setTimeout(() => tryOpen(attempt + 1), 120);
                                        }
                                    };

                                    tryOpen();
                                };

                                const openSetlistFromCard = () => {
                                    if (hasSetlist) {
                                        openDetalleRepertorio();
                                        return;
                                    }

                                    if (canManageSetlist) {
                                        if (typeof window !== 'undefined') window.location.href = crearSetlistHref;
                                        return;
                                    }

                                    openDetalleRepertorio();
                                };

                                return (
                                    <article
                                        key={servicio.id || `${evento.id}-${evento.fecha_hora}`}
                                        className="ui-pressable-card w-[90vw] sm:w-[420px] lg:w-full lg:min-w-0 shrink-0 snap-center border rounded-[1.65rem] p-3.5 md:p-4 transition-all duration-300 flex flex-col gap-2.5 min-h-[220px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/60 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_50%),linear-gradient(180deg,_rgba(24,24,27,0.97),_rgba(15,23,42,0.95))] border-zinc-700/50 shadow-[0_8px_32px_rgba(2,6,23,0.3)] hover:shadow-[0_12px_40px_rgba(2,6,23,0.45)] hover:border-zinc-600/60 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_45%),linear-gradient(180deg,_rgba(39,39,42,0.98),_rgba(24,24,27,0.95))] dark:border-zinc-700 dark:shadow-[0_8px_32px_rgba(2,6,23,0.5)] dark:hover:shadow-[0_12px_40px_rgba(2,6,23,0.6)]"
                                        role="button"
                                        tabIndex={0}
                                        aria-label={hasSetlist ? `Abrir setlist de ${headline}` : canManageSetlist ? `Crear setlist para ${headline}` : `Ver detalle de ${headline}`}
                                        onClick={openSetlistFromCard}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                openSetlistFromCard();
                                            }
                                        }}
                                    >
                                        <div className="flex items-start gap-3 md:gap-4 min-w-0">
                                            <div className="shrink-0 w-14 h-16 rounded-xl bg-white/8 border border-white/15 dark:bg-white/5 dark:border-white/10 flex flex-col items-center justify-between py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                                                <span className="text-[2rem] leading-none font-black text-white dark:text-content">{fecha.day}</span>
                                                <span className="text-[10px] uppercase font-bold tracking-widest text-white/70 dark:text-content-muted mt-0.5">{fecha.month}</span>
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex min-w-0 items-end gap-3">
                                                    <div className={`min-w-0 ${predicador ? 'flex-[0_1_65%] max-w-[65%]' : 'flex-1 max-w-full'}`}>
                                                        <h3 className="min-w-0 text-lg md:text-xl font-extrabold text-white dark:text-content leading-[1.04] line-clamp-2">
                                                            {temaPrincipal || evento.titulo || 'Servicio'}
                                                        </h3>
                                                    </div>
                                                    {predicador && (
                                                        <div className="min-w-0 flex-[1_1_35%] self-end border-l border-white/12 pl-2.5">
                                                            <p className="min-w-0 text-left line-clamp-2 text-[12px] md:text-[13px] font-light leading-[1.08] text-white/92 dark:text-white/95">
                                                                {predicador}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                                <p className="text-xs md:text-sm text-white/70 dark:text-content-muted mt-2 flex items-center gap-2">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                                    {horaTexto}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="mt-2.5 rounded-2xl border border-white/10 dark:border-border bg-black/20 dark:bg-surface/60 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-[11px] font-bold uppercase tracking-wider text-white/70 dark:text-content-muted">Repertorio / Setlist</p>
                                                {hasSetlist ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-action/20 text-action border border-action/40 dark:bg-action/35 dark:border-action/70 dark:text-white">
                                                        {setlistCount} canciones
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-white/70 border border-white/20 dark:bg-background dark:text-content-muted dark:border-border">
                                                        Sin setlist
                                                    </span>
                                                )}
                                            </div>
                                            {hasSetlist ? (
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        openDetalleRepertorio();
                                                    }}
                                                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-action/45 bg-action/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-action hover:bg-action/20 dark:bg-action/25 dark:border-action/70 dark:text-white dark:hover:bg-action/35 transition-colors"
                                                >
                                                    Ver canciones
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="m9 18 6-6-6-6" />
                                                    </svg>
                                                </button>
                                            ) : (
                                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                                    <p className="text-xs text-white/60 dark:text-content-muted">Sin setlist asignada para este servicio.</p>
                                                    {canManageSetlist ? (
                                                        <a
                                                            href={crearSetlistHref}
                                                            onClick={(event) => event.stopPropagation()}
                                                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/90 dark:border-border dark:bg-background dark:text-content hover:bg-white/20 dark:hover:bg-surface transition-colors"
                                                        >
                                                            Crear setlist
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="m9 18 6-6-6-6" />
                                                            </svg>
                                                        </a>
                                                    ) : null}
                                                </div>
                                            )}
                                        </div>

                                        <div className="mt-1 grid grid-cols-2 gap-2">
                                            {dirigeTexto ? (
                                                <span className="inline-flex w-full min-w-0 items-center gap-1.5 overflow-hidden bg-rol-dir/10 text-rol-dir border border-rol-dir/60 dark:bg-rol-dir/25 dark:text-white dark:border-rol-dir/90 px-2.5 py-1.5 rounded-xl text-[11px] md:text-xs font-bold uppercase tracking-wider">
                                                    <strong className="shrink-0">DIRIGE:</strong>
                                                    <span className="min-w-0 flex-1 truncate">{dirigeTexto}</span>
                                                </span>
                                            ) : (
                                                <span className="inline-flex w-full min-w-0 items-center justify-center bg-white/10 text-white/75 border border-white/20 dark:bg-background dark:text-content-muted dark:border-border px-3 py-1.5 rounded-xl text-[11px] md:text-xs font-bold uppercase tracking-wider italic">
                                                    Dirección vacía
                                                </span>
                                            )}

                                            <span className="inline-flex w-full min-w-0 items-center gap-1.5 overflow-hidden bg-action/10 text-action border border-action/40 dark:bg-action/25 dark:text-white dark:border-action/75 px-2.5 py-1.5 rounded-xl text-[11px] md:text-xs font-bold uppercase tracking-wider max-w-full">
                                                <strong className="shrink-0">TU:</strong>
                                                <span className="min-w-0 flex-1 truncate">{miRolTexto}</span>
                                            </span>
                                        </div>
                                    </article>
                                );
                            })
                        )}
                    </div>
                    {showUpcomingHint && (
                        <>
                            <div className="md:hidden pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background/95 via-background/65 to-transparent dark:from-surface/90 dark:via-surface/55"></div>
                            <div className="md:hidden pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full border border-border bg-surface/90 text-content-muted flex items-center justify-center shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                            </div>
                        </>
                    )}
                    </div>
                </section>
            </div>

            {/* Columna Derecha */}
            <div className="w-full lg:w-[44%] xl:w-full shrink-0 flex flex-col gap-5 2xl:gap-6">
                <section className="px-3 sm:px-4 lg:px-0" data-tour="environment">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <h2 className="text-lg font-bold text-content tracking-tight">Tu Entorno</h2>
                        {!dismissEnvironmentHint && (
                            <span className="md:hidden inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-surface/80 text-[10px] font-bold text-content-muted uppercase tracking-wide [animation:deslizaInicioHintLoop_4.8s_ease-in-out_infinite]">
                                Desliza
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse">
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                            </span>
                        )}
                    </div>
                    <div className="relative -mx-3 sm:mx-0">
                    <div
                        className="flex overflow-x-auto gap-3 px-3 sm:px-4 pb-2 snap-x snap-mandatory hide-scrollbar w-full lg:grid lg:grid-cols-3 lg:gap-4 lg:px-0 lg:pb-0 lg:overflow-visible"
                        onScroll={(e) => {
                            const el = e.currentTarget;
                            const moved = el.scrollLeft > 10;
                            const reachedEnd = (el.scrollWidth - (el.scrollLeft + el.clientWidth)) <= 12;
                            if (moved || reachedEnd) setDismissEnvironmentHint(true);
                        }}
                    >
                        <a href="/repertorio" data-tour="setlist" data-astro-prefetch="hover" className="ui-pressable-card w-[44vw] min-w-[160px] max-w-[220px] aspect-square lg:w-full lg:min-w-0 lg:max-w-none lg:aspect-auto lg:h-full lg:min-h-[180px] xl:min-h-[200px] 2xl:min-h-[220px] rounded-[2rem] p-5 flex flex-col justify-between shadow-md transition-all relative overflow-hidden group snap-center">
                            <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110" style={{ backgroundImage: "url('/repertorio-bg.webp')" }}></div>
                            <div className="absolute inset-0 bg-gradient-to-t from-overlay/95 via-overlay/70 to-transparent"></div>
                            <div className="absolute right-0 top-0 w-32 h-32 bg-white/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2"></div>
                            <div className="w-12 h-12 relative z-10 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-white border border-white/20 shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                            </div>
                            <div className="relative z-10 mt-auto drop-shadow-md">
                                <h3 className="text-white font-extrabold text-xl leading-tight">Repertorio<br />Oficial</h3>
                                <p className="text-white/90 text-xs font-medium mt-1">Acordes & Pistas</p>
                            </div>
                        </a>

                        <a href="/herramientas" data-astro-prefetch="hover" className="ui-pressable-card w-[44vw] min-w-[160px] max-w-[220px] aspect-square lg:w-full lg:min-w-0 lg:max-w-none lg:aspect-auto lg:h-full lg:min-h-[180px] xl:min-h-[200px] 2xl:min-h-[220px] rounded-[2rem] p-5 flex flex-col justify-between shadow-md transition-all relative overflow-hidden group snap-center">
                            <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110" style={{ backgroundImage: "url('/afinacion-bg.webp')" }}></div>
                            <div className="absolute inset-0 bg-gradient-to-t from-overlay/95 via-overlay/70 to-transparent"></div>
                            <div className="absolute left-0 bottom-0 w-32 h-32 bg-white/10 rounded-full blur-2xl transform -translate-x-1/2 translate-y-1/2"></div>
                            <div className="w-12 h-12 relative z-10 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-white border border-white/20 shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
                            </div>
                            <div className="relative z-10 mt-auto drop-shadow-md">
                                <h3 className="text-white font-extrabold text-xl leading-tight">Caja de<br />Afinación</h3>
                                <p className="text-white/90 text-xs font-medium mt-1">Metrónomo & Setup</p>
                            </div>
                        </a>

                        <a href="/herramientas/calentamiento-vocal" data-astro-prefetch="hover" className="ui-pressable-card w-[44vw] min-w-[160px] max-w-[220px] aspect-square lg:w-full lg:min-w-0 lg:max-w-none lg:aspect-auto lg:h-full lg:min-h-[180px] xl:min-h-[200px] 2xl:min-h-[220px] rounded-[2rem] p-5 flex flex-col justify-between shadow-md transition-all relative overflow-hidden group snap-center">
                            <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110" style={{ backgroundImage: "url('/calentamiento-bg.webp')" }}></div>
                            <div className="absolute inset-0 bg-gradient-to-t from-overlay/95 via-overlay/75 to-transparent"></div>
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_12%,rgba(255,255,255,0.24),transparent_45%),radial-gradient(circle_at_18%_86%,rgba(255,255,255,0.12),transparent_42%)]"></div>
                            <div className="w-12 h-12 relative z-10 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-white border border-white/20 shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                            </div>
                            <div className="relative z-10 mt-auto drop-shadow-md">
                                <h3 className="text-white font-extrabold text-xl leading-tight">Calentamiento<br />Vocal</h3>
                                <p className="text-white/90 text-xs font-medium mt-1">Ejercicios & Ensayo</p>
                            </div>
                        </a>
                    </div>

                    {!dismissEnvironmentHint && (
                        <>
                            <div className="md:hidden pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background/95 via-background/65 to-transparent dark:from-surface/90 dark:via-surface/55"></div>
                            <div className="md:hidden pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full border border-border bg-surface/90 text-content-muted flex items-center justify-center shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                            </div>
                        </>
                    )}
                    </div>
                </section>

                <section className="px-3 sm:px-4 lg:px-0 mb-2 lg:mb-0" data-tour="shortcuts">
                    <div id="dashboard-shortcuts-slot" className="relative z-20 min-h-[200px]"></div>
                </section>

                <section className="px-3 sm:px-4 lg:px-0" data-tour="extras">
                    <div className="space-y-4">
                        <article className="relative overflow-hidden border border-zinc-200/80 rounded-[2rem] p-5 shadow-sm bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.07),_transparent_45%),linear-gradient(180deg,_rgba(255,255,255,0.99),_rgba(244,244,245,0.97))] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_40%),linear-gradient(180deg,_rgba(24,24,27,0.98),_rgba(15,23,42,0.95))] dark:shadow-[0_8px_32px_rgba(2,6,23,0.3)]">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <h3 className="text-sm font-black text-content uppercase tracking-wide">Eventos Especiales</h3>
                            </div>
                            {eventosEspeciales.length === 0 ? (
                                <p className="text-sm text-content-muted">No hay eventos especiales activos.</p>
                            ) : (
                                <div className="space-y-2.5">
                                    {eventosEspeciales.map((evento) => (
                                        <div
                                            key={evento.id}
                                            className="rounded-2xl border border-white/35 px-4 py-3 shadow-sm"
                                            style={{ backgroundColor: 'rgb(var(--color-brand))', color: 'white' }}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="mt-0.5 w-8 h-8 rounded-lg bg-white/15 border border-white/35 flex items-center justify-center shrink-0">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                                        <rect width="18" height="18" x="3" y="4" rx="2" />
                                                        <line x1="16" x2="16" y1="2" y2="6" />
                                                        <line x1="8" x2="8" y1="2" y2="6" />
                                                        <line x1="3" x2="21" y1="10" y2="10" />
                                                    </svg>
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-3xl md:text-4xl leading-none font-black tracking-tight text-white">{formatDayMonth(evento.fecha)}</p>
                                                    <p className="text-lg font-bold text-white mt-1.5">{evento.titulo}</p>
                                                    {evento.descripcion ? (
                                                        <p className="text-sm text-white/90 mt-1.5 line-clamp-2">{evento.descripcion}</p>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </article>

                        <article className="relative mb-[calc(7rem+env(safe-area-inset-bottom))] overflow-hidden border border-zinc-200/80 rounded-[2rem] p-5 shadow-sm bg-[radial-gradient(circle_at_top_right,_rgba(20,184,166,0.06),_transparent_45%),linear-gradient(180deg,_rgba(255,255,255,0.99),_rgba(244,244,245,0.97))] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_right,_rgba(20,184,166,0.15),_transparent_40%),linear-gradient(180deg,_rgba(24,24,27,0.98),_rgba(15,23,42,0.95))] dark:shadow-[0_8px_32px_rgba(2,6,23,0.3)] lg:mb-0">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <h3 className="text-sm font-black text-content uppercase tracking-wide inline-flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-md bg-brand/15 border border-brand/30 text-brand flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M20 12v10H4V12" />
                                            <path d="M2 7h20v5H2z" />
                                            <path d="M12 22V7" />
                                            <path d="M12 7h4a2 2 0 1 0 0-4c-2.1 0-4 2-4 4Z" />
                                            <path d="M12 7H8a2 2 0 1 1 0-4c2.1 0 4 2 4 4Z" />
                                        </svg>
                                    </span>
                                    Cumpleaneros del Mes
                                </h3>
                                {cumpleanerosTodos.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setBirthdaysModalOpen(true)}
                                        className="ui-pressable-soft inline-flex h-8 items-center rounded-full border border-border bg-background/90 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-content-muted transition-colors hover:bg-surface hover:text-content dark:bg-white/5 dark:hover:bg-white/10"
                                    >
                                        Ver todos
                                    </button>
                                )}
                            </div>
                            {cumpleanerosMes.length === 0 ? (
                                <p className="text-sm text-content-muted">No hay cumpleaneros registrados este mes.</p>
                            ) : (
                                <div className="flex gap-2.5 overflow-x-auto hide-scrollbar pb-1">
                                    {cumpleanerosMes.map((persona) => (
                                        <article key={persona.id} className="min-w-[232px] rounded-xl border border-border bg-background px-3.5 py-3 shrink-0 flex items-center gap-3">
                                            {persona.avatar_url ? (
                                                <img
                                                    src={persona.avatar_url}
                                                    alt={persona.nombre}
                                                    loading="lazy"
                                                    decoding="async"
                                                    className="w-11 h-11 rounded-xl object-cover border border-white/10 shadow-sm shrink-0"
                                                />
                                            ) : (
                                                <div className="w-11 h-11 rounded-xl bg-brand/10 border border-brand/25 text-brand flex items-center justify-center shrink-0 text-xs font-black uppercase">
                                                    {getInitials(persona.nombre)}
                                                </div>
                                            )}
                                            <div className="min-w-0">
                                                <p className="text-lg font-black text-content truncate">{persona.nombre}</p>
                                                <p className="text-sm font-semibold text-content-muted mt-0.5">{`${persona.dia} de ${mesActualStr}`}</p>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </article>
                    </div>

                    {!isStandaloneApp && (
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <article className="border border-zinc-200/80 rounded-[1.5rem] p-4 shadow-sm bg-white dark:border-white/10 dark:bg-zinc-900/80">
                                <div className="flex items-start gap-3">
                                    <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border border-border ${devicePlatform === 'android' ? 'bg-action/10 text-action' : 'bg-background text-content'}`}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                            <path d="M7.2 8.1 5.7 5.5a.6.6 0 1 1 1-.5l1.5 2.6a9 9 0 0 1 7.6 0l1.5-2.6a.6.6 0 1 1 1 .5l-1.5 2.6A7.4 7.4 0 0 1 20 14v4.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2V14c0-2.5 1.3-4.7 3.2-5.9Z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-content">Instalar la app en Android</h3>
                                        <p className="text-xs text-content-muted mt-0.5">Instala Redil como app nativa en Android.</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleInstallAndroid}
                                    className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border border-action/40 bg-action/10 text-action hover:bg-action/20 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M7.2 8.1 5.7 5.5a.6.6 0 1 1 1-.5l1.5 2.6a9 9 0 0 1 7.6 0l1.5-2.6a.6.6 0 1 1 1 .5l-1.5 2.6A7.4 7.4 0 0 1 20 14v4.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2V14c0-2.5 1.3-4.7 3.2-5.9Z" />
                                    </svg>
                                    {canInstallPrompt ? 'Instalar ahora' : 'Ver pasos'}
                                </button>
                            </article>

                            <article className="border border-zinc-200/80 rounded-[1.5rem] p-4 shadow-sm bg-white dark:border-white/10 dark:bg-zinc-900/80">
                                <div className="flex items-start gap-3">
                                    <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border border-border ${devicePlatform === 'ios' ? 'bg-action/10 text-action' : 'bg-background text-content'}`}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                            <path d="M16.37 12.47c.02 2.27 1.99 3.03 2.01 3.04-.02.05-.31 1.08-1.02 2.13-.61.91-1.25 1.81-2.24 1.83-.97.02-1.28-.58-2.39-.58-1.11 0-1.45.56-2.36.6-.95.04-1.67-.96-2.29-1.86-1.27-1.83-2.24-5.16-.94-7.41.64-1.11 1.79-1.81 3.04-1.83.95-.02 1.84.64 2.39.64.55 0 1.58-.79 2.66-.67.45.02 1.72.18 2.53 1.37-.07.04-1.51.88-1.49 2.74Zm-1.78-4.63c.51-.62.86-1.48.76-2.34-.74.03-1.63.49-2.16 1.11-.47.55-.88 1.42-.77 2.26.82.06 1.66-.42 2.17-1.03Z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-content">Instalar la app en iOS</h3>
                                        <p className="text-xs text-content-muted mt-0.5">Guia rapida para iPhone y iPad en Safari.</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleInstallIOS}
                                    className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border border-border bg-background text-content hover:bg-surface transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M16.37 12.47c.02 2.27 1.99 3.03 2.01 3.04-.02.05-.31 1.08-1.02 2.13-.61.91-1.25 1.81-2.24 1.83-.97.02-1.28-.58-2.39-.58-1.11 0-1.45.56-2.36.6-.95.04-1.67-.96-2.29-1.86-1.27-1.83-2.24-5.16-.94-7.41.64-1.11 1.79-1.81 3.04-1.83.95-.02 1.84.64 2.39.64.55 0 1.58-.79 2.66-.67.45.02 1.72.18 2.53 1.37-.07.04-1.51.88-1.49 2.74Z" />
                                    </svg>
                                    Ver pasos
                                </button>
                            </article>
                        </div>
                    )}

                    {installNotice && !isStandaloneApp && (
                        <p className="mt-2 text-[11px] text-content-muted">{installNotice}</p>
                    )}
                </section>
            </div>
        </div>
        {birthdaysModalOpen && (
            <div
                className="fixed inset-0 z-[155] min-h-[100dvh] bg-overlay/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 pt-6 pb-[calc(104px+env(safe-area-inset-bottom))] lg:items-center lg:p-6"
                onClick={() => setBirthdaysModalOpen(false)}
            >
                <div
                    className="w-full max-w-3xl rounded-[2rem] bg-surface border border-border shadow-2xl p-5 md:p-6 max-h-[calc(100dvh-132px-env(safe-area-inset-bottom))] lg:max-h-[calc(100dvh-96px)] overflow-hidden flex flex-col my-auto lg:my-0"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                            <h3 className="text-xl font-black text-content">Cumpleanos del equipo</h3>
                            <p className="text-sm text-content-muted mt-1">Todos los cumpleanos registrados, ordenados por mes.</p>
                        </div>
                        <button
                            type="button"
                            className="w-9 h-9 rounded-xl border border-border text-content-muted hover:text-content hover:bg-background"
                            onClick={() => setBirthdaysModalOpen(false)}
                            aria-label="Cerrar cumpleanos"
                        >
                            x
                        </button>
                    </div>

                    <div className="overflow-y-auto pr-1 space-y-5">
                        {cumpleanerosPorMes.map((grupo) => (
                            <section key={grupo.month} className="space-y-3">
                                <h4 className="text-xs font-black uppercase tracking-[0.18em] text-content-muted">{grupo.label}</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {grupo.personas
                                        .slice()
                                        .sort((a, b) => a.dia - b.dia)
                                        .map((persona, index) => {
                                            const isNextBirthday = index === 0
                                                && cumpleanerosTodos[0]?.id === persona.id
                                                && cumpleanerosTodos[0]?.mes === persona.mes;

                                            return (
                                                <article key={persona.id} className="rounded-2xl border border-border bg-background px-3.5 py-3 flex items-center gap-3">
                                                    {persona.avatar_url ? (
                                                        <img
                                                            src={persona.avatar_url}
                                                            alt={persona.nombre}
                                                            loading="lazy"
                                                            decoding="async"
                                                            className="w-12 h-12 rounded-2xl object-cover border border-white/10 shadow-sm shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-12 h-12 rounded-2xl bg-brand/10 border border-brand/25 text-brand flex items-center justify-center shrink-0 text-sm font-black uppercase">
                                                            {getInitials(persona.nombre)}
                                                        </div>
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-base font-black text-content truncate">{persona.nombre}</p>
                                                        <p className="text-sm font-semibold text-content-muted">{`${persona.dia} de ${grupo.label}`}</p>
                                                    </div>
                                                    {isNextBirthday && (
                                                        <span className="inline-flex h-7 items-center rounded-full border border-brand/30 bg-brand/10 px-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-brand">
                                                            Proximo
                                                        </span>
                                                    )}
                                                </article>
                                            );
                                        })}
                                </div>
                            </section>
                        ))}
                    </div>
                </div>
            </div>
        )}
        {installModal.open && (
            <div
                className="fixed inset-0 z-[150] bg-overlay/60 backdrop-blur-sm flex items-center justify-center p-4"
                onClick={() => setInstallModal((prev) => ({ ...prev, open: false }))}
            >
                <div
                    className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-2xl p-5"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <div className={`w-9 h-9 rounded-lg border border-border flex items-center justify-center ${installModal.platform === 'android' ? 'text-action bg-action/10' : 'text-content bg-background'}`}>
                                {installModal.platform === 'android' ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M7.2 8.1 5.7 5.5a.6.6 0 1 1 1-.5l1.5 2.6a9 9 0 0 1 7.6 0l1.5-2.6a.6.6 0 1 1 1 .5l-1.5 2.6A7.4 7.4 0 0 1 20 14v4.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2V14c0-2.5 1.3-4.7 3.2-5.9Z" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M16.37 12.47c.02 2.27 1.99 3.03 2.01 3.04-.02.05-.31 1.08-1.02 2.13-.61.91-1.25 1.81-2.24 1.83-.97.02-1.28-.58-2.39-.58-1.11 0-1.45.56-2.36.6-.95.04-1.67-.96-2.29-1.86-1.27-1.83-2.24-5.16-.94-7.41.64-1.11 1.79-1.81 3.04-1.83.95-.02 1.84.64 2.39.64.55 0 1.58-.79 2.66-.67.45.02 1.72.18 2.53 1.37-.07.04-1.51.88-1.49 2.74Z" />
                                    </svg>
                                )}
                            </div>
                            <h3 className="text-base font-black text-content">{installModal.title}</h3>
                        </div>
                        <button
                            type="button"
                            className="w-8 h-8 rounded-lg border border-border text-content-muted hover:text-content hover:bg-background"
                            onClick={() => setInstallModal((prev) => ({ ...prev, open: false }))}
                            aria-label="Cerrar"
                        >
                            x
                        </button>
                    </div>

                    <ol className="mt-3 space-y-2">
                        {installModal.steps.map((step, index) => (
                            <li key={`${step}-${index}`} className="flex items-start gap-2 text-sm text-content-muted">
                                <span className="w-5 h-5 mt-0.5 rounded-full border border-border bg-background text-[11px] font-bold text-content flex items-center justify-center">{index + 1}</span>
                                <span>{step}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
        )}
        <style>{`
            @keyframes deslizaInicioHintLoop {
                0% { opacity: 0; transform: translateX(0); }
                12% { opacity: 1; transform: translateX(0); }
                55% { opacity: 1; transform: translateX(0); }
                78% { opacity: 1; transform: translateX(12px); }
                90% { opacity: 0.25; transform: translateX(20px); }
                100% { opacity: 0; transform: translateX(20px); }
            }
        `}</style>
        </>
    );
};

export default DashboardInicio;
