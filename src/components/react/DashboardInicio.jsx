import React, { useEffect, useState } from 'react';

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

    useEffect(() => {
        const scrollRoot = document.getElementById('dashboard-scroll-root');
        if (scrollRoot) scrollRoot.scrollTop = 0;
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        setIsDark(document.documentElement.classList.contains('dark'));
    }, []);

    const toggleDarkMode = () => {
        setIsDark((prev) => {
            const next = !prev;
            document.documentElement.classList.toggle('dark', next);
            localStorage.setItem('theme', next ? 'dark' : 'light');
            return next;
        });
    };

    const nombre = usuario?.nombre ? getFirstName(usuario.nombre) : 'M\u00FAsico';
    const opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const fechaHoy = new Date().toLocaleDateString('es-ES', opcionesFecha);
    const fechaHoyCapitalizada = fechaHoy.charAt(0).toUpperCase() + fechaHoy.slice(1);

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
                <header className="px-4 lg:px-0 mt-2 pr-16 md:pr-28">
                    <h1 className="text-3xl font-extrabold text-content tracking-tight">Hola {nombre}</h1>
                    <p className="text-sm font-medium text-content-muted mt-1 capitalize">{fechaHoyCapitalizada}</p>
                </header>

                <section className="flex-1 flex flex-col">
                    <div className="flex items-center justify-between px-4 lg:px-0 mb-3">
                        <h2 className="text-lg font-bold text-content tracking-tight">Próximos Servicios</h2>
                    </div>

                    <div className="flex overflow-x-auto gap-4 px-4 pb-4 snap-x snap-mandatory hide-scrollbar w-full h-full lg:flex-1 lg:px-0 lg:pb-0 lg:overflow-visible lg:grid lg:[grid-template-columns:repeat(auto-fit,minmax(300px,1fr))] lg:auto-rows-fr lg:gap-6 2xl:gap-8">
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
                                const misRoles = Array.isArray(servicio.mis_roles) && servicio.mis_roles.length > 0
                                    ? servicio.mis_roles
                                    : [servicio.roles?.nombre || 'Miembro'];
                                const miRolTexto = misRoles.join(' / ');

                                const roster = Array.isArray(evento.asignaciones) ? evento.asignaciones : [];
                                const liderAsignado = roster.find((r) => r?.roles?.codigo === 'lider_alabanza' && r?.perfiles?.nombre);
                                const dirigeTexto = liderAsignado ? getFirstName(liderAsignado.perfiles.nombre) : null;

                                return (
                                    <article
                                        key={servicio.id || `${evento.id}-${evento.fecha_hora}`}
                                        className="w-[92vw] sm:w-[420px] lg:w-full lg:min-w-0 shrink-0 snap-center bg-surface border border-border rounded-[1.65rem] p-4 md:p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between min-h-[210px]"
                                    >
                                        <div className="flex items-start gap-4 md:gap-5 min-w-0">
                                            <div className="shrink-0 w-14 rounded-xl bg-background border border-border flex flex-col items-center justify-center py-2">
                                                <span className="text-2xl leading-none font-black text-content">{fecha.day}</span>
                                                <span className="text-[10px] uppercase font-bold tracking-widest text-content-muted mt-1">{fecha.month}</span>
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <h3 className="text-lg md:text-xl font-extrabold text-content leading-tight line-clamp-2">{tema}</h3>
                                                <p className="text-xs md:text-sm text-content-muted mt-2 flex items-center gap-2">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                                    {horaTexto}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="mt-4 pt-3 border-t border-border/80 flex flex-wrap items-center gap-2 md:gap-3">
                                            {dirigeTexto ? (
                                                <span className="inline-flex items-center gap-1.5 bg-rol-dir/10 text-rol-dir border border-rol-dir px-3 py-1 rounded-[10px] text-[10px] md:text-xs font-bold uppercase tracking-wider">
                                                    <strong>DIRIGE:</strong>
                                                    <span className="truncate">{dirigeTexto}</span>
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center bg-background text-content-muted border border-border px-3 py-1 rounded-[10px] text-[10px] md:text-xs font-bold uppercase tracking-wider italic">
                                                    Dirección vacía
                                                </span>
                                            )}

                                            <span className="inline-flex items-center gap-1.5 bg-brand/10 text-brand border border-brand/30 px-3 py-1 rounded-[10px] text-[10px] md:text-xs font-bold uppercase tracking-wider max-w-full">
                                                <strong>TU:</strong>
                                                <span className="truncate">{miRolTexto}</span>
                                            </span>
                                        </div>
                                    </article>
                                );
                            })
                        )}
                    </div>
                </section>
            </div>

            {/* Columna Derecha */}
            <div className="w-full lg:w-[44%] xl:w-full shrink-0 flex flex-col gap-6 2xl:gap-8 lg:mt-20">
                <section className="px-4 lg:px-0 lg:flex-1 lg:flex lg:flex-col">
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

                <section className="px-4 lg:px-0 mb-8 lg:mb-0">
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
                            <div className={`w-12 h-12 rounded-full border border-border flex items-center justify-center transition-colors ${isDark ? 'bg-brand/20 text-brand' : 'bg-background text-content'}`}>
                                {isDark ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
                                )}
                            </div>
                            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">{isDark ? 'Claro' : 'Oscuro'}</span>
                        </button>
                    </div>
                </section>
            </div>
        </div>
        </>
    );
};

export default DashboardInicio;

