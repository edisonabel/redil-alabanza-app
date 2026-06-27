import React, { useMemo, useState } from 'react';
import { BarChart3, Clock3, EyeOff, UsersRound } from 'lucide-react';

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
        { id: 'servicios', label: 'Servicios recientes', icon: Clock3 },
        { id: 'ranking', label: 'Más repetidas', icon: BarChart3 },
    ];

    return (
        <div className="inline-flex h-9 w-full rounded-full border border-white/[0.12] bg-[#15161b]/90 p-1 shadow-sm sm:w-auto">
            {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        aria-pressed={activeTab === tab.id}
                        onClick={() => onTabChange(tab.id)}
                        className={`ui-no-press inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 text-[9px] font-black uppercase tracking-[0.12em] transition-colors sm:flex-none sm:px-3.5 ${
                            activeTab === tab.id
                                ? 'bg-white text-action'
                                : 'text-zinc-500 hover:text-content'
                        }`}
                    >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="truncate">{tab.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

function ServiceCard({ service }) {
    const [showTeam, setShowTeam] = useState(false);
    const date = formatServiceDate(service.dateIso);
    const songs = Array.isArray(service.songs) ? service.songs : [];
    const team = Array.isArray(service.team) ? service.team : [];

    return (
        <article className="relative overflow-hidden rounded-[1.7rem] border border-[#343946]/70 bg-[#15161b] p-4 shadow-[0_14px_44px_rgba(0,0,0,0.24)] transition-all duration-300 sm:p-5 md:rounded-[2rem] md:p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(59,130,246,0.10),transparent_38%),radial-gradient(circle_at_100%_0%,rgba(59,130,246,0.07),transparent_32%),linear-gradient(145deg,rgba(255,255,255,0.035),rgba(255,255,255,0))]" />
            <div className="relative">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-4 border-b border-white/[0.10] pb-4 sm:gap-5">
                    <div className="min-w-0">
                        <span className="inline-flex h-7 items-center rounded-full border border-white/[0.12] bg-black/10 px-4 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400 shadow-inner">
                            {date.weekday}
                        </span>
                        <div className="mt-3 flex min-w-0 items-end gap-2.5">
                            <span className="text-[3.1rem] font-black leading-[0.82] tracking-tight text-action drop-shadow-[0_0_16px_rgba(59,130,246,0.30)] sm:text-[3.7rem] md:text-[4.1rem]">
                                {date.day}
                            </span>
                            <span className="mb-0.5 hidden h-11 w-px bg-white/[0.16] sm:block" aria-hidden="true" />
                            <span className="mb-0.5 flex min-w-0 items-baseline gap-2">
                                <span className="text-2xl font-light leading-none text-white sm:text-3xl">
                                    {date.month}
                                </span>
                                <span className="text-lg font-black leading-none text-zinc-500 sm:text-xl">
                                    {date.year}
                                </span>
                            </span>
                        </div>
                    </div>

                    <div className="min-w-0 text-right">
                        <h2 className="text-[1.85rem] font-black leading-[0.95] tracking-tight text-action drop-shadow-[0_0_16px_rgba(59,130,246,0.24)] sm:text-[2.55rem] md:text-[3rem]">
                            {service.title || 'Servicio'}
                        </h2>
                        {team.length > 0 ? (
                            <button
                                type="button"
                                aria-expanded={showTeam}
                                onClick={() => setShowTeam((value) => !value)}
                                className="ui-no-press mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/[0.18] bg-black/10 px-3.5 text-xs font-bold text-zinc-400 shadow-inner transition-colors duration-200 hover:border-action/45 hover:text-white sm:px-4 sm:text-sm"
                            >
                                {showTeam ? (
                                    <>
                                        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                                        Ocultar equipo
                                    </>
                                ) : (
                                    <>
                                        <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
                                        Equipo ({team.length})
                                    </>
                                )}
                            </button>
                        ) : null}
                    </div>
                </div>

                <div className="transition-all duration-300 ease-out">
                    {!showTeam ? (
                        <ol className="grid grid-cols-2">
                            {songs.map((song, index) => {
                                const isRightColumn = index % 2 === 1;
                                const hasTopBorder = index > 1;
                                return (
                                    <li
                                        key={`${service.id}-${song.id}-${index}`}
                                        className={`grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-start gap-2.5 py-3 sm:grid-cols-[2.55rem_minmax(0,1fr)] sm:gap-3 sm:py-4 ${
                                            hasTopBorder ? 'border-t border-white/[0.08]' : ''
                                        } ${isRightColumn ? 'border-l border-white/[0.08] pl-3 sm:pl-5' : 'pr-3 sm:pr-5'}`}
                                    >
                                        <span className="inline-flex h-7 min-w-8 items-center justify-center rounded-lg border border-[#273044] bg-white/[0.035] px-1.5 text-[12px] font-black leading-none text-action shadow-inner">
                                            {String(index + 1).padStart(2, '0')}
                                        </span>
                                        <span className="min-w-0 text-[14px] font-light leading-tight text-white sm:text-lg md:text-xl">
                                            {song.title || 'Canción sin título'}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>
                    ) : (
                        <div className="pt-4">
                            <p className="text-[11px] font-black uppercase tracking-[0.26em] text-zinc-500">
                                Equipo del servicio
                            </p>
                            <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-2.5">
                                {team.map((person) => (
                                    <span
                                        key={person.id}
                                        title={[person.name, ...(person.roles || [])].filter(Boolean).join(' · ')}
                                        className="inline-flex h-10 min-w-0 items-center gap-1.5 rounded-full border border-white/[0.13] bg-black/[0.18] px-1.5 pr-2 text-[11px] font-black text-white shadow-inner sm:h-12 sm:gap-2 sm:px-2 sm:pr-3 sm:text-sm"
                                    >
                                        {person.avatarUrl ? (
                                            <img
                                                src={person.avatarUrl}
                                                alt=""
                                                loading="lazy"
                                                decoding="async"
                                                className="h-7 w-7 shrink-0 rounded-full object-cover sm:h-8 sm:w-8"
                                            />
                                        ) : (
                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-action/14 text-[9px] font-black text-action sm:h-8 sm:w-8 sm:text-[10px]">
                                                {getInitials(person.name)}
                                            </span>
                                        )}
                                        <span className="min-w-0 truncate">{getShortName(person.name)}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}

function SongRankCard({ song, index, maxCount, expanded, onToggle }) {
    const history = Array.isArray(song.history) ? song.history : [];
    const lastUsage = history[0];
    const barWidth = maxCount > 0 ? Math.max(16, Math.round((Number(song.count || 0) / maxCount) * 100)) : 0;

    return (
        <article className="relative overflow-hidden rounded-[1.7rem] border border-[#343946]/65 bg-[#15161b] p-4 shadow-[0_12px_38px_rgba(0,0,0,0.20)] md:p-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(59,130,246,0.09),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(255,255,255,0.035),transparent_30%),linear-gradient(145deg,rgba(255,255,255,0.028),rgba(255,255,255,0))]" />
            <button
                type="button"
                aria-expanded={expanded}
                onClick={onToggle}
                className="ui-no-press relative flex w-full items-start gap-4 text-left outline-none focus-visible:outline-none"
            >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white bg-white text-base font-black text-[#0b0b0f] shadow-[0_8px_22px_rgba(255,255,255,0.10)]">
                    {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-xl font-semibold leading-tight tracking-tight text-content md:text-2xl">
                        {song.title || 'Canción sin título'}
                    </span>
                    <span className="mt-1 block text-sm font-medium leading-5 text-zinc-400">
                        Última vez: {lastUsage ? formatExactDate(lastUsage.dateIso) : 'sin fecha'}
                    </span>
                    <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-black/35">
                        <span
                            className="block h-full rounded-full bg-action"
                            style={{ width: `${barWidth}%` }}
                        />
                    </span>
                </span>
                <span className="shrink-0 pt-1 text-right">
                    <span className="block text-base font-bold text-action">
                        {song.count} {song.count === 1 ? 'vez' : 'veces'}
                    </span>
                    <span className="mt-1 block text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                        {expanded ? 'Ocultar' : 'Ver fechas'}
                    </span>
                </span>
            </button>

            {expanded ? (
                <div className="relative mt-5 border-t border-white/[0.08] pt-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">
                        Fechas exactas
                    </p>
                    <div className="mt-3 divide-y divide-white/[0.08]">
                        {history.map((usage) => (
                            <a
                                key={`${song.id}-${usage.eventId}`}
                                href={usage.href}
                                className="block py-3 transition-colors hover:text-action"
                            >
                                <span className="block text-base font-semibold capitalize leading-tight text-content">
                                    {formatExactDate(usage.dateIso)}
                                </span>
                                <span className="mt-1 block text-sm font-medium text-zinc-400">
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
        <div className="space-y-3.5">
            <header className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-5">
                <div className="min-w-0">
                    <h1 className="text-[1.9rem] font-black leading-[0.92] tracking-tight text-content md:text-[2.45rem]">
                        Historial de cantos
                    </h1>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-semibold leading-5 text-content-muted md:text-sm">
                        <span>Servicios recientes y canciones repetidas</span>
                        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-black uppercase tracking-[0.1em] text-zinc-400 md:text-xs">
                            <span>{Number(meta.servicesAnalyzed || 0)} servicios</span>
                            <span className="text-zinc-600" aria-hidden="true">·</span>
                            <span>{Number(meta.usedSongs || 0)} canciones</span>
                        </span>
                    </div>
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
