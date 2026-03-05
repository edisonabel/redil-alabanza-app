import React from 'react';

const DashboardInicio = ({ usuario, proximosServicios = [] }) => {
    const nombre = usuario?.nombre ? usuario.nombre.split(' ')[0] : 'Músico';

    // Opciones de formato de fecha en español
    const opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const fechaHoy = new Date().toLocaleDateString('es-ES', opcionesFecha);
    const fechaHoyCapitalizada = fechaHoy.charAt(0).toUpperCase() + fechaHoy.slice(1);

    // Helper para parsear la fecha del evento a "Día, DD Mes"
    const formatEventDate = (isoString) => {
        if (!isoString) return '';
        const date = new Date(isoString + "T12:00:00"); // forzar mediodía para evitar saltos de timezone
        const dia = date.toLocaleDateString('es-ES', { weekday: 'short' });
        const num = date.getDate();
        const mes = date.toLocaleDateString('es-ES', { month: 'short' });
        return `${dia.charAt(0).toUpperCase() + dia.slice(1)}, ${num} ${mes.charAt(0).toUpperCase() + mes.slice(1)}`;
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 2xl:gap-12 w-full selection:bg-brand/20">
            {/* Columna Izquierda (Principal - PC) */}
            <div className="flex-1 w-full flex flex-col gap-6">

                {/* Header */}
                <header className="px-4 lg:px-0 mt-2">
                    <h1 className="text-3xl font-extrabold text-content tracking-tight">
                        Hola {nombre} 👋
                    </h1>
                    <p className="text-sm font-medium text-content-muted mt-1 capitalize">
                        {fechaHoyCapitalizada}
                    </p>
                </header>

                {/* Tracker de Servicios (Carrusel Horizontal) */}
                <section className="lg:pr-4">
                    <div className="flex items-center justify-between px-4 lg:px-0 mb-3">
                        <h2 className="text-lg font-bold text-content tracking-tight">Próximos Servicios</h2>
                    </div>

                    <div className="flex overflow-x-auto lg:overflow-visible lg:grid lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 xl:gap-8 snap-x snap-mandatory hide-scrollbar gap-4 px-4 lg:px-0 pb-4 w-full h-full">
                        {proximosServicios.length === 0 ? (
                            <div className="w-full flex-1 shrink-0 snap-center bg-gradient-to-br from-[#eff6ff] to-[#e0e7ff] dark:from-blue-900/20 dark:to-indigo-900/20 rounded-[2rem] p-6 shadow-sm border border-blue-100 dark:border-blue-800/30 lg:min-h-[220px] flex items-center justify-center">
                                <div className="flex flex-col items-center justify-center text-center gap-3 py-4">
                                    <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 mb-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h20" /><path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" /><path d="m4 8 16-4" /><path d="m4 4 16 4" /></svg>
                                    </div>
                                    <h3 className="font-bold text-blue-900 dark:text-blue-100">Sin Asignaciones</h3>
                                    <p className="text-sm text-blue-700/70 dark:text-blue-200/70">No tienes servicios próximos. ¡Disfruta tu descanso!</p>
                                </div>
                            </div>
                        ) : (
                            proximosServicios.map((asignacion, index) => {
                                const evento = asignacion.eventos;
                                const nombreRol = asignacion.roles?.nombre || 'Miembro';
                                const isEnsayo = evento.tema?.toLowerCase().includes('ensayo') || false;

                                return (
                                    <div key={index} className="w-[85vw] sm:w-[320px] lg:w-full lg:min-w-[320px] shrink-0 snap-center bg-gradient-to-br from-[#eff6ff] to-[#e0e7ff] dark:from-blue-900/20 dark:to-indigo-900/20 rounded-[2rem] p-5 shadow-sm border border-blue-100 dark:border-blue-800/30 flex flex-col justify-between min-h-[160px] lg:min-h-[220px] relative overflow-hidden transition-transform hover:scale-[1.02] active:scale-[0.98]">
                                        {/* Decoración de fondo */}
                                        <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl pointer-events-none"></div>

                                        <div className="flex justify-between items-start z-10">
                                            <div>
                                                <p className="text-sm font-bold text-brand uppercase tracking-wider mb-1">
                                                    {formatEventDate(evento.fecha_hora)}
                                                </p>
                                                <h3 className="text-xl font-extrabold text-content leading-tight line-clamp-2 pr-2">
                                                    {evento.tema || 'Servicio Regular'}
                                                </h3>
                                                {isEnsayo && (
                                                    <span className="inline-block mt-1 px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-md uppercase tracking-wide">Ensayo</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="mt-4 flex items-center justify-between z-10 w-full">
                                            <div className="bg-brand/10 text-brand font-bold rounded-full px-4 py-1.5 text-sm flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-brand animate-pulse"></div>
                                                {nombreRol}
                                            </div>
                                            {evento.enlace_videollamada && (
                                                <a href={evento.enlace_videollamada} target="_blank" rel="noopener noreferrer" className="p-2 bg-neutral-100 dark:bg-neutral-800 text-content rounded-full hover:bg-neutral-200 transition-colors">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </section>

            </div>

            {/* Columna Derecha (Bentos y Atajos - PC) */}
            <div className="lg:w-2/5 xl:w-1/3 2xl:w-[400px] shrink-0 flex flex-col gap-6 2xl:gap-8 lg:mt-2">

                {/* Bloques Principales (Bento Box) */}
                <section className="px-4 lg:px-0">
                    <h2 className="text-lg font-bold text-content tracking-tight mb-3">Tu Entorno</h2>
                    <div className="grid grid-cols-2 gap-4">

                        {/* Bento: Repertorio */}
                        <a href="/repertorio" className="aspect-square lg:aspect-auto lg:h-[220px] rounded-[2rem] p-5 flex flex-col justify-between shadow-md active:scale-[0.98] transition-all relative overflow-hidden group">
                            <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110" style={{ backgroundImage: "url('/images/repertorio-bg.webp')" }}></div>
                            <div className="absolute inset-0 bg-gradient-to-br from-brand/70 to-[#0ea5e9]/80"></div>
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent"></div>

                            <div className="absolute right-0 top-0 w-32 h-32 bg-white/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2"></div>
                            <div className="w-12 h-12 relative z-10 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-white border border-white/20 shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                            </div>
                            <div className="relative z-10 mt-auto drop-shadow-md">
                                <h3 className="text-white font-extrabold text-xl leading-tight">Repertorio<br />Oficial</h3>
                                <p className="text-white/90 text-xs font-medium mt-1">Acordes & Pistas</p>
                            </div>
                        </a>

                        {/* Bento: Herramientas */}
                        <a href="/herramientas" className="aspect-square lg:aspect-auto lg:h-[220px] rounded-[2rem] p-5 flex flex-col justify-between shadow-md active:scale-[0.98] transition-all relative overflow-hidden group">
                            <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110" style={{ backgroundImage: "url('/images/afinacion-bg.webp')" }}></div>
                            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/70 to-blue-600/80"></div>
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent"></div>

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

                {/* Accesos Rápidos */}
                <section className="px-4 lg:px-0 mb-8">
                    <h2 className="text-lg font-bold text-content tracking-tight mb-3">Atajos</h2>
                    <div className="bg-surface border border-border rounded-[2rem] p-5 shadow-sm flex justify-between items-start">

                        <a href="/programacion" className="flex flex-col items-center gap-2 group w-1/4">
                            <div className="w-12 h-12 bg-neutral-100 dark:bg-neutral-800 text-content rounded-full flex items-center justify-center group-active:scale-90 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></svg>
                            </div>
                            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">Calendario</span>
                        </a>

                        <a href="/perfil" className="flex flex-col items-center gap-2 group w-1/4">
                            <div className="w-12 h-12 bg-neutral-100 dark:bg-neutral-800 text-content rounded-full flex items-center justify-center group-active:scale-90 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="10" r="3" /><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" /></svg>
                            </div>
                            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">Mi Perfil</span>
                        </a>

                        <a href="/perfil#ausencias" className="flex flex-col items-center gap-2 group w-1/4">
                            <div className="w-12 h-12 bg-neutral-100 dark:bg-neutral-800 text-content rounded-full flex items-center justify-center group-active:scale-90 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                            </div>
                            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">Ausencias</span>
                        </a>

                        <div className="flex flex-col items-center gap-2 group w-1/4 relative opacity-60 cursor-not-allowed">
                            <div className="absolute -top-2 bg-neutral-900 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider z-10">Pronto</div>
                            <div className="w-12 h-12 bg-neutral-100 dark:bg-neutral-800 text-content rounded-full flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
                            </div>
                            <span className="text-[10px] sm:text-xs font-semibold text-content text-center leading-tight">Oscuro</span>
                        </div>

                    </div>
                </section>

            </div>

        </div>
    );
};

export default DashboardInicio;
