import React, { useMemo, useState } from 'react';

const formatServiceDate = (isoString) => {
    if (!isoString) {
        return { weekday: 'FECHA', day: '--', month: '---', year: '' };
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        return { weekday: 'FECHA', day: '--', month: '---', year: '' };
    }

    return {
        weekday: date.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '').toUpperCase(),
        day: String(date.getDate()),
        month: date.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '').toLowerCase(),
        year: String(date.getFullYear()),
    };
};

const formatExactDate = (isoString) => {
    if (!isoString) return 'Fecha por definir';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'Fecha por definir';

    return date.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
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

const getShortName = (fullName) => {
    if (!fullName || typeof fullName !== 'string') return 'Persona';
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'Persona';
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
};

function EmptyState({ children }) {
    return (
        <div className="rounded-[2rem] border border-dashed border-border bg-surface/70 px-5 py-10 text-center text-sm font-medium text-content-muted">
            {children}
        </div>
    );
}

function SegmentedTabs({ activeTab, onTabChange }) {
    const tabs = [
        { id: 'servicios', label: 'Últimos servicios' },
        { id: 'ranking', label: 'Más cantadas' },
    ];

    return (
        <div className="inline-flex w-full rounded-full border border-border bg-surface p-1 shadow-sm sm:w-auto">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    aria-pressed={activeTab === tab.id}
                    onClick={() => onTabChange(tab.id)}
                    className={`ui-no-press h-11 flex-1 rounded-full px-4 text-[11px] font-black uppercase tracking-[0.14em] transition-colors sm:flex-none ${
                        activeTab === tab.id
                            ? 'bg-content text-background'
                            : 'text-content-muted hover:text-content'
                    }`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

function ServiceCard({ service }) {
    const [showTeam, setShowTeam] = useState(false);
    const date = formatServiceDate(service.dateIso);
    const songs = Array.isArray(service.songs) ? service.songs : [];
    const team = Array.isArray(service.team) ? service.team : [];

    return (
        <article className="rounded-[1.75rem] border border-border bg-surface p-4 shadow-sm sm:p-5 md:p-6">
            <div className="grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] items-start gap-4 sm:grid-cols-[minmax(7.5rem,auto)_minmax(0,1fr)] sm:gap-6">
                <div className="min-w-0">
                    <p className="mb-1 text-[10px] font-black uppercase tracking-[0.22em] text-content-muted sm:text-[11px]">
                        {date.weekday}
                    </p>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-5xl font-black leading-none tracking-tight text-action sm:text-6xl">
                            {date.day}
                        </span>
                        <span className="text-2xl font-light leading-none text-content sm:text-3xl">
                            {date.month}
                        </span>
                        <span className="text-sm font-black text-content-muted sm:text-base">
                            {date.year}
                        </span>
                    </div>
                </div>

                <div className="min-w-0 text-right">
                    <h2 className="text-2xl font-black leading-[1.04] tracking-tight text-action sm:text-3xl md:text-4xl">
                        {service.title || 'Servicio'}
                    </h2>
                    {team.length > 0 ? (
                        <button
                            type="button"
                            aria-expanded={showTeam}
                            onClick={() => setShowTeam((value) => !value)}
                            className="ui-no-press mt-2 inline-flex h-8 items-center justify-center rounded-full border border-border bg-background px-3 text-[10px] font-black uppercase tracking-[0.16em] text-content-muted transition-colors hover:border-action/40 hover:text-action"
                        >
                            {showTeam ? 'Ocultar' : `Equipo (${team.length})`}
                        </button>
                    ) : null}
                </div>
            </div>

            <ol className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:mt-6 sm:gap-x-8">
                {songs.map((song, index) => (
                    <li key={`${service.id}-${song.id}-${index}`} className="flex min-w-0 items-start gap-3">
                        <span className="mt-1 w-5 shrink-0 text-[10px] font-black tracking-[0.14em] text-content-muted sm:w-7 sm:text-[11px]">
                            {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0 text-[15px] font-black leading-tight text-content sm:text-lg md:text-xl">
                            {song.title || 'Canción sin título'}
                        </span>
                    </li>
                ))}
            </ol>

            {showTeam ? (
                <div className="mt-4 border-t border-border pt-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-content-muted">
                        Equipo del servicio
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {team.map((person) => (
                            <span
                                key={person.id}
                                title={[person.name, ...(person.roles || [])].filter(Boolean).join(' · ')}
                                className="inline-flex h-11 max-w-full items-center gap-2 rounded-full border border-border bg-background px-2.5 pr-3 text-sm font-black text-content"
                            >
                                {person.avatarUrl ? (
                                    <img
                                        src={person.avatarUrl}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                                    />
                                ) : (
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-action/12 text-[10px] font-black text-action">
                                        {getInitials(person.name)}
                                    </span>
                                )}
                                <span className="truncate">{getShortName(person.name)}</span>
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}
        </article>
    );
}

function SongRankCard({ song, index, maxCount, expanded, onToggle }) {
    const history = Array.isArray(song.history) ? song.history : [];
    const lastUsage = history[0];
    const barWidth = maxCount > 0 ? Math.max(16, Math.round((Number(song.count || 0) / maxCount) * 100)) : 0;

    return (
        <article className="rounded-[2rem] border border-border bg-surface p-4 shadow-sm md:p-5">
            <button
                type="button"
                aria-expanded={expanded}
                onClick={onToggle}
                className="ui-no-press flex w-full items-start gap-4 text-left outline-none focus-visible:outline-none"
            >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-content text-base font-black text-background">
                    {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-xl font-black leading-tight tracking-tight text-content md:text-2xl">
                        {song.title || 'Canción sin título'}
                    </span>
                    <span className="mt-1 block text-sm font-bold text-content-muted">
                        Última vez: {lastUsage ? formatExactDate(lastUsage.dateIso) : 'sin fecha'}
                    </span>
                    <span className="mt-3 block h-2 overflow-hidden rounded-full bg-background">
                        <span
                            className="block h-full rounded-full bg-action"
                            style={{ width: `${barWidth}%` }}
                        />
                    </span>
                </span>
                <span className="shrink-0 pt-1 text-right">
                    <span className="block text-base font-black text-action">
                        {song.count} {song.count === 1 ? 'vez' : 'veces'}
                    </span>
                    <span className="mt-1 block text-[11px] font-black uppercase tracking-[0.16em] text-content-muted">
                        {expanded ? 'Ocultar' : 'Ver fechas'}
                    </span>
                </span>
            </button>

            {expanded ? (
                <div className="mt-5 border-t border-border pt-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-content-muted">
                        Fechas exactas
                    </p>
                    <div className="mt-3 divide-y divide-border">
                        {history.map((usage) => (
                            <a
                                key={`${song.id}-${usage.eventId}`}
                                href={usage.href}
                                className="block py-3 transition-colors hover:text-action"
                            >
                                <span className="block text-base font-black capitalize leading-tight text-content">
                                    {formatExactDate(usage.dateIso)}
                                </span>
                                <span className="mt-1 block text-sm font-semibold text-content-muted">
                                    {usage.title || 'Servicio'}
                                </span>
                            </a>
                        ))}
                    </div>
                </div>
            ) : null}
        </article>
    );
}

export default function HistorialCantos({ recentServices = [], topSongs = [], meta = {} }) {
    const [activeTab, setActiveTab] = useState('servicios');
    const [expandedSongId, setExpandedSongId] = useState(null);
    const maxCount = useMemo(
        () => Math.max(0, ...topSongs.map((song) => Number(song?.count || 0))),
        [topSongs],
    );

    return (
        <div className="space-y-6">
            <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                <div className="max-w-3xl">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-action">
                        Consulta para todos
                    </p>
                    <h1 className="mt-2 text-[2.35rem] font-black leading-[0.95] tracking-tight text-content md:text-6xl">
                        Historial de cantos
                    </h1>
                    <p className="mt-3 text-sm font-medium leading-6 text-content-muted md:text-base">
                        Últimos servicios publicados y canciones más repetidas para cuidar mejor el repertorio.
                    </p>
                    <p className="mt-2 text-xs font-black uppercase tracking-[0.16em] text-content-muted">
                        {Number(meta.servicesAnalyzed || 0)} servicios analizados · {Number(meta.usedSongs || 0)} canciones usadas
                    </p>
                </div>
                <SegmentedTabs activeTab={activeTab} onTabChange={setActiveTab} />
            </header>

            {activeTab === 'servicios' ? (
                <section className="grid gap-4" aria-label="Últimos servicios publicados">
                    {recentServices.length === 0 ? (
                        <EmptyState>Aún no hay servicios publicados con canciones cargadas.</EmptyState>
                    ) : (
                        recentServices.map((service) => (
                            <ServiceCard key={service.id} service={service} />
                        ))
                    )}
                </section>
            ) : (
                <section className="grid gap-4" aria-label="Canciones más cantadas">
                    {topSongs.length === 0 ? (
                        <EmptyState>Aún no hay suficientes canciones para armar el ranking.</EmptyState>
                    ) : (
                        topSongs.map((song, index) => (
                            <SongRankCard
                                key={song.id}
                                song={song}
                                index={index}
                                maxCount={maxCount}
                                expanded={expandedSongId === song.id}
                                onToggle={() => setExpandedSongId(expandedSongId === song.id ? null : song.id)}
                            />
                        ))
                    )}
                </section>
            )}
        </div>
    );
}
