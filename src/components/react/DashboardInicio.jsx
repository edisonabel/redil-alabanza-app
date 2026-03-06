import React, { useEffect, useRef, useState } from 'react';

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

const DashboardInicio = ({ usuario, proximosServicios = [] }) => {
    const [isDark, setIsDark] = useState(false);
    const [dismissUpcomingHint, setDismissUpcomingHint] = useState(false);
    const [devicePlatform, setDevicePlatform] = useState('other');
    const [canInstallPrompt, setCanInstallPrompt] = useState(false);
    const [isStandaloneApp, setIsStandaloneApp] = useState(false);
    const [installNotice, setInstallNotice] = useState('');
    const [installModal, setInstallModal] = useState({ open: false, title: '', steps: [], platform: 'ios' });
    const installPromptRef = useRef(null);

    useEffect(() => {
        const scrollRoot = document.getElementById('dashboard-scroll-root');
        if (scrollRoot) scrollRoot.scrollTop = 0;
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        setIsDark(document.documentElement.classList.contains('dark'));
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

    const toggleDarkMode = () => {
        setIsDark((prev) => {
            const next = !prev;
            document.documentElement.classList.toggle('dark', next);
            localStorage.setItem('theme', next ? 'dark' : 'light');
            return next;
        });
    };

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
    const showUpcomingHint = proximosServicios.length > 1 && !dismissUpcomingHint;

    return (
        <>
        <a
            href="/"
            className="fixed top-3 right-4 z-40 rounded-2xl border border-border bg-surface/80 backdrop-blur p-1.5 shadow-lg"
            aria-label="Inicio Redil"
        >
            <img src="/LOGO%20REDIL%20LIGHT.png" alt="Redil" className="w-[80px] h-auto dark:hidden md:w-[96px]" />
            <img src="/LOGO%20REDIL.png" alt="Redil" className="hidden w-[80px] h-auto dark:block md:w-[96px]" />
        </a>
        <div className="w-full max-w-[1720px] mx-auto selection:bg-brand/20 flex flex-col lg:flex-row gap-6 lg:gap-8 2xl:gap-10 xl:grid xl:grid-cols-[minmax(0,1fr)_460px] 2xl:grid-cols-[minmax(0,1fr)_560px]">
            {/* Columna Izquierda */}
            <div className="flex-1 min-w-0 w-full flex flex-col gap-6">
                <header className="px-3 sm:px-4 lg:px-0 mt-2 pr-16 md:pr-28">
                    <h1 className="text-3xl font-extrabold text-content tracking-tight">Hola {nombre}</h1>
                    <p className="text-sm font-medium text-content-muted mt-1 capitalize">{fechaHoyCapitalizada}</p>
                </header>

                <section className="flex-1 flex flex-col">
                    <div className="flex items-center justify-between gap-3 px-3 sm:px-4 lg:px-0 mb-3">
                        <h2 className="text-lg font-bold text-content tracking-tight">Próximos Servicios</h2>
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
                            <div className="w-full h-full shrink-0 snap-center bg-surface rounded-[2rem] p-6 shadow-sm border border-border lg:min-h-[260px] 2xl:min-h-[300px] lg:col-span-full flex items-center justify-center">
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
                                const tema = evento.tema_predicacion || evento.tema || evento.titulo || 'Servicio';
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
                                        className="w-[90vw] sm:w-[420px] lg:w-full lg:min-w-0 shrink-0 snap-center bg-overlay/95 dark:bg-border border border-border/30 dark:border-border rounded-[1.65rem] p-3.5 md:p-4 shadow-none dark:shadow-sm hover:shadow-none dark:hover:shadow-md transition-shadow flex flex-col gap-2.5 min-h-[220px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/60"
                                        role="button"
                                        tabIndex={0}
                                        aria-label={hasSetlist ? `Abrir setlist de ${tema}` : canManageSetlist ? `Crear setlist para ${tema}` : `Ver detalle de ${tema}`}
                                        onClick={openSetlistFromCard}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                openSetlistFromCard();
                                            }
                                        }}
                                    >
                                        <div className="flex items-start gap-3 md:gap-4 min-w-0">
                                            <div className="shrink-0 w-14 h-16 rounded-xl bg-white/5 border border-white/20 dark:bg-surface dark:border-border flex flex-col items-center justify-between py-1.5">
                                                <span className="text-[2rem] leading-none font-black text-white dark:text-content">{fecha.day}</span>
                                                <span className="text-[10px] uppercase font-bold tracking-widest text-white/70 dark:text-content-muted mt-0.5">{fecha.month}</span>
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <h3 className="text-lg md:text-xl font-extrabold text-white dark:text-content leading-tight line-clamp-2">{tema}</h3>
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
                                                <span className="inline-flex w-full min-w-0 items-center justify-center gap-1.5 bg-rol-dir/10 text-rol-dir border border-rol-dir/60 dark:bg-rol-dir/25 dark:text-white dark:border-rol-dir/90 px-3 py-1 rounded-xl text-[11px] md:text-xs font-bold uppercase tracking-wider">
                                                    <strong>DIRIGE:</strong>
                                                    <span className="truncate">{dirigeTexto}</span>
                                                </span>
                                            ) : (
                                                <span className="inline-flex w-full min-w-0 items-center justify-center bg-white/10 text-white/75 border border-white/20 dark:bg-background dark:text-content-muted dark:border-border px-3 py-1.5 rounded-xl text-[11px] md:text-xs font-bold uppercase tracking-wider italic">
                                                    Dirección vacía
                                                </span>
                                            )}

                                            <span className="inline-flex w-full min-w-0 items-center justify-center gap-1.5 bg-action/10 text-action border border-action/40 dark:bg-action/25 dark:text-white dark:border-action/75 px-3 py-1 rounded-xl text-[11px] md:text-xs font-bold uppercase tracking-wider max-w-full">
                                                <strong>TU:</strong>
                                                <span className="truncate">{miRolTexto}</span>
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
            <div className="w-full lg:w-[44%] xl:w-full shrink-0 flex flex-col gap-6 2xl:gap-8 lg:mt-20">
                <section className="px-3 sm:px-4 lg:px-0 lg:flex-1 lg:flex lg:flex-col">
                    <h2 className="text-lg font-bold text-content tracking-tight mb-3">Tu Entorno</h2>
                    <div className="grid grid-cols-2 gap-4 2xl:gap-6 lg:flex-1 lg:auto-rows-fr">
                        <a href="/repertorio" className="aspect-square lg:aspect-auto lg:h-full lg:min-h-[240px] xl:min-h-[280px] 2xl:min-h-[320px] rounded-[2rem] p-5 flex flex-col justify-between shadow-md active:scale-[0.98] transition-all relative overflow-hidden group">
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

                        <a href="/herramientas" className="aspect-square lg:aspect-auto lg:h-full lg:min-h-[240px] xl:min-h-[280px] 2xl:min-h-[320px] rounded-[2rem] p-5 flex flex-col justify-between shadow-md active:scale-[0.98] transition-all relative overflow-hidden group">
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
                    </div>
                </section>

                <section className="px-3 sm:px-4 lg:px-0 mb-8 lg:mb-0">
                    <h2 className="text-lg font-bold text-content tracking-tight mb-3">Atajos</h2>
                    <div className="bg-surface border border-border rounded-[2rem] p-5 shadow-sm flex justify-between items-start">
                        <a href="/programacion" className="flex flex-col items-center gap-2 group w-1/4">
                            <div className="w-12 h-12 bg-background border border-border text-content rounded-full flex items-center justify-center group-active:scale-90 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></svg>
                            </div>
                            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">Calendario</span>
                        </a>

                        <a href="/perfil" className="flex flex-col items-center gap-2 group w-1/4">
                            <div className="w-12 h-12 bg-background border border-border text-content rounded-full flex items-center justify-center group-active:scale-90 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="10" r="3" /><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" /></svg>
                            </div>
                            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">Mi Perfil</span>
                        </a>

                        <a href="/perfil#ausencias" className="flex flex-col items-center gap-2 group w-1/4">
                            <div className="w-12 h-12 bg-background border border-border text-content rounded-full flex items-center justify-center group-active:scale-90 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                            </div>
                            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">Ausencias</span>
                        </a>

                        <button type="button" onClick={toggleDarkMode} className="flex flex-col items-center gap-2 group w-1/4">
                            <div className={`w-12 h-12 rounded-full border border-border flex items-center justify-center transition-colors ${isDark ? 'bg-action/20 text-action' : 'bg-background text-content'}`}>
                                {isDark ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
                                )}
                            </div>
                            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">{isDark ? 'Claro' : 'Oscuro'}</span>
                        </button>
                    </div>

                    {!isStandaloneApp && (
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <article className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
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

                            <article className="bg-surface border border-border rounded-2xl p-4 shadow-sm">
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

