import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Clock3,
  LayoutDashboard,
  ListChecks,
  Music4,
  Repeat2,
  ShieldCheck,
  SlidersHorizontal,
  Users2,
} from 'lucide-react';

const TABS = [
  { id: 'operacion', label: 'Operacion', icon: LayoutDashboard },
  { id: 'repertorio', label: 'Repertorio', icon: Music4 },
  { id: 'equipo', label: 'Equipo', icon: Users2 },
  { id: 'sistema', label: 'Sistema', icon: ShieldCheck },
];

const SECTION_META = {
  operacion: {
    title: 'Operacion',
    subtitle: 'Servicios, alertas y checks del periodo seleccionado.',
  },
  repertorio: {
    title: 'Repertorio',
    subtitle: 'Uso de canciones, rotacion y recursos para ensayo.',
  },
  equipo: {
    title: 'Equipo',
    subtitle: 'Carga, cobertura de roles, ausencias y disponibilidad.',
  },
  sistema: {
    title: 'Sistema',
    subtitle: 'Huecos operativos, catalogo, perfiles y warnings tecnicos.',
  },
};

const SUBTABS = {
  operacion: [
    { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
    { id: 'servicios', label: 'Servicios', icon: CalendarClock },
    { id: 'alertas', label: 'Alertas', icon: AlertTriangle },
    { id: 'checks', label: 'Checks', icon: ListChecks },
  ],
  repertorio: [
    { id: 'ranking', label: 'Ranking', icon: Music4 },
    { id: 'rotacion', label: 'Rotacion', icon: Repeat2 },
    { id: 'recursos', label: 'Recursos', icon: SlidersHorizontal },
    { id: 'distribucion', label: 'Distribucion', icon: LayoutDashboard },
  ],
  equipo: [
    { id: 'carga', label: 'Carga', icon: Users2 },
    { id: 'roles', label: 'Roles', icon: ListChecks },
    { id: 'ausencias', label: 'Ausencias', icon: CalendarClock },
    { id: 'disponibles', label: 'Disponibles', icon: Clock3 },
  ],
  sistema: [
    { id: 'eventos', label: 'Eventos', icon: CalendarClock },
    { id: 'catalogo', label: 'Catalogo', icon: Music4 },
    { id: 'perfiles', label: 'Perfiles', icon: Users2 },
    { id: 'tecnico', label: 'Tecnico', icon: ShieldCheck },
  ],
};

const toneMap = {
  brand: 'from-blue-500/14 to-cyan-500/8 text-blue-700 dark:text-blue-200 border-blue-200/70 dark:border-blue-500/20',
  blue: 'from-sky-500/14 to-blue-500/8 text-sky-700 dark:text-sky-200 border-sky-200/70 dark:border-sky-500/20',
  amber: 'from-amber-500/18 to-orange-500/8 text-amber-700 dark:text-amber-200 border-amber-200/70 dark:border-amber-500/20',
  emerald: 'from-emerald-500/18 to-teal-500/8 text-emerald-700 dark:text-emerald-200 border-emerald-200/70 dark:border-emerald-500/20',
  danger: 'from-rose-500/18 to-red-500/8 text-rose-700 dark:text-rose-200 border-rose-200/70 dark:border-rose-500/20',
  neutral: 'from-zinc-400/8 to-zinc-200/5 text-zinc-700 dark:text-zinc-200 border-zinc-200/70 dark:border-zinc-800',
};

const statusTone = {
  listo: 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-500/25',
  riesgo: 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/12 dark:text-amber-200 dark:ring-amber-500/25',
  incompleto: 'bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/12 dark:text-rose-200 dark:ring-rose-500/25',
};

const clampPercent = (value) => Math.max(0, Math.min(100, Number(value || 0)));

const formatDateTime = (value) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

const formatShortDate = (value) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
  }).format(date);
};

const formatFullDateTime = (value) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

const getInitials = (name = '') =>
  String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || '')
    .join('') || 'RD';

const getShortName = (name = '') => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Sin nombre';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0]?.toUpperCase() || ''}.`;
};

function PanelCard({ title, subtitle, action, children, className = '' }) {
  return (
    <section data-panel-card={title || ''} className={`rounded-[28px] border border-zinc-200/80 bg-white/92 p-4 shadow-[0_20px_60px_-42px_rgba(15,23,42,0.45)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/92 dark:shadow-[0_26px_90px_-52px_rgba(0,0,0,0.7)] ${className}`}>
      {(title || subtitle || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-zinc-950 dark:text-zinc-50">{title}</h2>
            ) : null}
            {subtitle ? (
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{subtitle}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

function MetricCard({ metric }) {
  const tone = toneMap[metric?.tone] || toneMap.neutral;
  return (
    <article data-panel-metric={metric?.label || 'Metrica'} className={`rounded-[20px] border bg-gradient-to-br p-3 ${tone}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-80">{metric?.label || 'Metrica'}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{metric?.value || '--'}</p>
      <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-300/80">{metric?.detail || ''}</p>
    </article>
  );
}

function StatusBadge({ status = 'riesgo' }) {
  const label = status === 'listo' ? 'Listo' : status === 'incompleto' ? 'Incompleto' : 'Con riesgo';
  return <span className={`inline-flex h-8 items-center rounded-full px-3 text-[11px] font-semibold uppercase tracking-[0.16em] ${statusTone[status] || statusTone.riesgo}`}>{label}</span>;
}

function AvatarCell({ name, avatarUrl, subtitle = '', size = 'md' }) {
  const isLarge = size === 'lg';
  const avatarClassName = isLarge ? 'h-12 w-12 text-sm' : 'h-10 w-10 text-xs';
  const nameClassName = isLarge ? 'text-base sm:text-lg' : 'text-sm';

  return (
    <div className="flex min-w-0 items-center gap-3">
      {avatarUrl ? (
        <img src={avatarUrl} alt={name || 'Avatar'} className={`${avatarClassName} shrink-0 rounded-full border border-white/70 object-cover shadow-sm dark:border-zinc-800`} />
      ) : (
        <div className={`flex ${avatarClassName} shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300`}>
          {getInitials(name)}
        </div>
      )}
      <div className="min-w-0">
        <span className={`block truncate font-semibold text-zinc-900 dark:text-zinc-100 ${nameClassName}`}>{name || 'Sin nombre'}</span>
        {subtitle ? <p className="mt-1 truncate text-xs leading-5 text-zinc-500 dark:text-zinc-400">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function PersonBubble({ person }) {
  const name = person?.name || person || 'Sin nombre';
  const avatarUrl = person?.avatarUrl || '';

  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3 dark:border-zinc-800 dark:bg-zinc-950">
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="h-8 w-8 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          {getInitials(name)}
        </span>
      )}
      <span className="min-w-0 truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200" title={name}>
        {getShortName(name)}
      </span>
    </div>
  );
}

function MiniProgress({ percent, tone = 'brand' }) {
  const fillTone =
    tone === 'emerald'
      ? 'bg-emerald-500'
      : tone === 'amber'
        ? 'bg-amber-500'
        : tone === 'danger'
          ? 'bg-rose-500'
          : 'bg-blue-500';

  return (
    <div className="h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-900">
      <div className={`h-full rounded-full ${fillTone}`} style={{ width: `${clampPercent(percent)}%` }} />
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="rounded-[22px] border border-dashed border-zinc-200 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <p className="font-medium text-zinc-800 dark:text-zinc-200">{title}</p>
      <p className="mt-1 leading-6">{detail}</p>
    </div>
  );
}

function LoadingState({ title = 'Cargando datos', detail = 'Estamos preparando la informacion del panel.' }) {
  return (
    <div className="rounded-[22px] border border-zinc-200 bg-zinc-50/80 px-4 py-6 dark:border-zinc-800 dark:bg-zinc-900/65">
      <div className="h-3 w-32 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-4 h-2.5 w-full animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-2.5 w-2/3 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
      <p className="mt-4 text-sm font-medium text-zinc-800 dark:text-zinc-200">{title}</p>
      <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{detail}</p>
    </div>
  );
}

function SubtabNav({ tabs = [], activeId, onChange }) {
  if (!tabs.length) return null;

  return (
    <div data-panel-subtabs className="mt-4 rounded-[22px] border border-zinc-200/80 bg-zinc-50/85 p-1.5 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex gap-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeId === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(tab.id)}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-[20px] px-3 text-sm font-semibold transition-colors sm:px-4 ${
                active
                  ? 'bg-zinc-950 text-white shadow-lg shadow-zinc-950/12 dark:bg-white dark:text-zinc-950'
                  : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResourceCoverageList({ items = [] }) {
  if (!items.length) {
    return <EmptyState title="Sin recursos medibles" detail="No hay canciones suficientes para calcular cobertura." />;
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.label} className="space-y-2">
          <div className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{item.label}</span>
              {item.detail ? <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{item.detail}</p> : null}
            </div>
            <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{item.count}/{item.total}</span>
          </div>
          <MiniProgress percent={item.percent} tone={item.percent >= 80 ? 'emerald' : item.percent >= 50 ? 'amber' : 'danger'} />
        </div>
      ))}
    </div>
  );
}

function SequenceBreakdown({ breakdown = [], gaps = [] }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {breakdown.map((item) => (
          <div key={item.type} className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{item.label}</p>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">{item.count}</p>
            <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{item.detail}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Por completar</p>
        <SimpleList
          items={gaps}
          emptyTitle="Secuencias sanas"
          emptyDetail="Las canciones del rango ya tienen una cobertura util de secuencias."
          renderItem={(item) => (
            <div key={item.id} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/65">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{item.detail}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  item.type === 'missing'
                    ? statusTone.incompleto
                    : item.type === 'simple'
                      ? statusTone.riesgo
                      : statusTone.listo
                }`}>
                  {item.label}
                </span>
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}

function RepeatWatchList({ items = [] }) {
  if (!items.length) {
    return <EmptyState title="Sin repeticiones sensibles" detail="No hay canciones repetidas tres veces dentro de una ventana de 60 dias." />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article key={item.song_id || item.id} className="rounded-[22px] border border-amber-200 bg-amber-50/75 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-base font-semibold leading-6 text-zinc-950 dark:text-zinc-50">{item.title}</h3>
              <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-100">{item.repeatAlert?.detail || 'Revisar rotacion.'}</p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/25">
              {item.repeatAlert?.label || 'Repetida'}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(item.history || []).slice(0, 5).map((usage) => (
              <a
                key={`${item.song_id}-${usage.eventId}`}
                href={usage.href}
                className="rounded-full border border-amber-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-white dark:border-amber-500/20 dark:bg-zinc-950/40 dark:text-amber-100 dark:hover:bg-zinc-950/70"
              >
                {formatShortDate(usage.dateIso)}
              </a>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function RoleRiskList({ items = [] }) {
  if (!items.length) {
    return <EmptyState title="Cobertura sana" detail="No hay roles musicales con cobertura fragil en este rango." />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{item.detail || `Codigo: ${item.code || 'sin codigo'}`}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${item.risk === 'critico' ? statusTone.incompleto : statusTone.riesgo}`}>
              {item.count} {item.count === 1 ? 'persona' : 'personas'}
            </span>
          </div>
          {(item.members || []).length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.members.map((member) => (
                <PersonBubble key={`${item.id}-${member?.id || member?.name || member}`} person={member} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RoleCoverageList({ items = [], tone = 'blue', emptyTitle = 'Sin roles cargados', emptyDetail = 'No hay roles suficientes para medir cobertura.' }) {
  const [expandedRoleId, setExpandedRoleId] = useState(null);

  if (!items.length) {
    return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  }

  const maxValue = Math.max(...items.map((item) => Number(item?.count || 0)), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const count = Number(item?.count || 0);
        const percent = (count / maxValue) * 100;
        const roleId = item?.id || item?.label;
        const expanded = expandedRoleId === roleId;

        return (
          <article key={`${roleId}-${count}`} className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedRoleId(expanded ? null : roleId)}
              className="w-full text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-zinc-950 dark:text-zinc-50">{item?.label || 'Sin definir'}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    {count} {count === 1 ? 'persona disponible' : 'personas disponibles'}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                  {expanded ? 'Ocultar' : 'Ver equipo'}
                </span>
              </div>
              <div className="mt-3">
                <MiniProgress percent={percent} tone={tone} />
              </div>
            </button>

            {expanded ? (
              <div className="mt-4 rounded-[18px] border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/55">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Personas en este rol</p>
                {(item.members || []).length ? (
                  <div className="flex flex-wrap gap-2">
                    {item.members.map((member) => (
                      <PersonBubble key={`${roleId}-${member?.id || member?.name || member}`} person={member} />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Sin personas asignadas" detail="Este rol no tiene miembros visibles todavia." />
                )}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function BarList({ items = [], tone = 'brand', valueSuffix = '', emptyTitle = 'Sin datos', emptyDetail = 'No hay suficientes registros para mostrar este bloque.' }) {
  if (!items.length) {
    return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  }

  const maxValue = Math.max(...items.map((item) => Number(item?.count || 0)), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const percent = (Number(item?.count || 0) / maxValue) * 100;
        const label = item?.label || item?.title || 'Sin definir';
        return (
          <div key={`${label}-${item.count}`} className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
              <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">{item.count}{valueSuffix}</span>
            </div>
            <MiniProgress percent={percent} tone={tone} />
          </div>
        );
      })}
    </div>
  );
}

function SongRankingList({ items = [], meta = {}, errors = [], loading = false }) {
  const [expandedSongId, setExpandedSongId] = useState(null);

  if (loading) {
    return <LoadingState title="Cargando canciones" detail="Estamos calculando el ranking desde servicios reales." />;
  }

  if (errors.length) {
    return <EmptyState title="No se pudo cargar el ranking" detail={errors[0]} />;
  }

  if (!items.length) {
    return <EmptyState title={meta?.emptyTitle || 'Sin canciones usadas este ano'} detail={meta?.emptyDetail || 'Todavia no hay canciones registradas como usadas este ano.'} />;
  }

  const maxValue = Math.max(...items.map((item) => Number(item?.usage_count || item?.count || 0)), 1);
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const count = Number(item?.usage_count || item?.count || 0);
        const percent = (count / maxValue) * 100;
        const title = item?.title || item?.label || 'Cancion sin titulo';
        const rank = Number(item?.rank || index + 1);
        const songKey = item?.song_id || item?.id || `${title}-${rank}`;
        const expanded = expandedSongId === songKey;
        return (
          <article key={songKey} className={`rounded-[22px] border p-4 transition-colors ${
            item?.repeatAlert
              ? 'border-amber-200 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-500/10'
              : 'border-zinc-200/80 bg-zinc-50/90 dark:border-zinc-800 dark:bg-zinc-900/65'
          }`}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedSongId(expanded ? null : songKey)}
              className="w-full text-left"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white dark:bg-white dark:text-zinc-950">
                  {rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <h3 className="break-words text-base font-semibold leading-6 text-zinc-950 dark:text-zinc-50 sm:text-lg">{title}</h3>
                      {item?.last_used_at ? (
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Ultima vez: {formatShortDate(item.last_used_at)}</p>
                      ) : null}
                      {item?.repeatAlert ? (
                        <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-100">{item.repeatAlert.label}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <p className="text-sm font-semibold text-blue-700 dark:text-blue-200">
                        {count} {count === 1 ? 'vez' : 'veces'}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                        {expanded ? 'Ocultar historial' : 'Ver fechas'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <MiniProgress percent={percent} tone={item?.repeatAlert ? 'amber' : 'brand'} />
                  </div>
                </div>
              </div>
            </button>

            {expanded ? (
              <div className="mt-4 rounded-[18px] border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Fechas cantadas</p>
                <SimpleList
                  items={item?.history || []}
                  emptyTitle="Sin historial detallado"
                  emptyDetail="No hay servicios vinculados a esta cancion en el rango cargado."
                  renderItem={(usage) => (
                    <a
                      key={`${songKey}-${usage.eventId}`}
                      href={usage.href}
                      className="block rounded-[16px] border border-zinc-200 bg-zinc-50/80 px-3 py-2 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:bg-zinc-900"
                    >
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{formatFullDateTime(usage.dateIso)}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{usage.serviceTitle}</p>
                    </a>
                  )}
                />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function LinkButton({ href, label, tone = 'neutral' }) {
  const styles =
    tone === 'brand'
      ? 'bg-blue-600 text-white hover:bg-blue-500'
      : 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800';

  return (
    <a href={href} className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors ${styles}`}>
      {label}
    </a>
  );
}

function UpcomingServiceItem({ item }) {
  return (
    <article className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{item.title}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{formatDateTime(item.dateIso)}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <div className="mt-4 grid gap-3 text-sm text-zinc-600 dark:text-zinc-300 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">Lider</p>
          <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{item.leaderName || 'Sin definir'}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">Setlist</p>
          <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{item.setlistCount} canciones</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">Roster</p>
          <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{item.rosterCount} asignaciones</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <LinkButton href={item.programacionHref} label="Abrir programacion" />
        {item.ensayoHref ? <LinkButton href={item.ensayoHref} label="Abrir ensayo" tone="brand" /> : null}
        {!item.ensayoHref ? <LinkButton href={item.repertorioHref} label="Cargar setlist" /> : null}
      </div>
    </article>
  );
}

function AlertList({ items = [] }) {
  if (!items.length) {
    return <EmptyState title="Sin alertas activas" detail="La ventana actual no muestra riesgos operativos relevantes." />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className={`rounded-[20px] border px-4 py-3 ${
            item.level === 'danger'
              ? 'border-rose-200 bg-rose-50/70 dark:border-rose-500/20 dark:bg-rose-500/10'
              : 'border-amber-200 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-500/10'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${item.level === 'danger' ? 'text-rose-500' : 'text-amber-500'}`} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {item.serviceTitle ? `${item.serviceTitle} | ${formatShortDate(item.dateIso)} | ` : ''}
                {item.detail}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionSummary({ items = [] }) {
  if (!items.length) {
    return <EmptyState title="Sin resumen operativo" detail="Aun no hay un proximo servicio en la ventana seleccionada." />;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{item.label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">{item.value}</p>
          <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

function WorkloadList({ items = [] }) {
  const [expandedProfileId, setExpandedProfileId] = useState(null);

  if (!items.length) {
    return <EmptyState title="Sin carga detectada" detail="No hay asignaciones futuras dentro de la ventana actual." />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const expanded = expandedProfileId === item.id;
        const rolesLabel = (item.roles || []).join(' | ') || 'Sin roles visibles';

        return (
          <article key={item.id} className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedProfileId(expanded ? null : item.id)}
              className="w-full text-left"
            >
              <div className="flex items-center justify-between gap-3">
                <AvatarCell name={item.name} avatarUrl={item.avatarUrl} subtitle={rolesLabel} size="lg" />
                <div className="shrink-0 text-right">
                  <p className="text-3xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">{item.services}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">servicios</p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-300">
                    {expanded ? 'Ocultar' : 'Ver detalle'}
                  </p>
                </div>
              </div>
            </button>

            {expanded ? (
              <div className="mt-4 rounded-[18px] border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/55">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Servicios asignados</p>
                <SimpleList
                  items={item.assignedServices || []}
                  emptyTitle="Sin historial visible"
                  emptyDetail="No hay servicios detallados para esta persona en el rango."
                  renderItem={(service) => (
                    <a
                      key={`${item.id}-${service.id}`}
                      href={service.href}
                      className="block rounded-[16px] border border-zinc-200 bg-zinc-50/80 px-3 py-2 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:bg-zinc-900"
                    >
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{service.title}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                        {formatFullDateTime(service.dateIso)}
                        {(service.roles || []).length ? ` | ${(service.roles || []).join(' | ')}` : ''}
                      </p>
                    </a>
                  )}
                />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function SimpleList({ items = [], renderItem, emptyTitle, emptyDetail }) {
  if (!items.length) return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  return <div className="space-y-3">{items.map(renderItem)}</div>;
}

export default function PanelControl({ data }) {
  const [activeTab, setActiveTab] = useState('operacion');
  const [activeSubtabs, setActiveSubtabs] = useState({});
  const [activePeriod, setActivePeriod] = useState(data?.activePeriod || data?.periods?.[0]?.id || 'proximos_45');
  const activeSnapshot = data?.snapshots?.[activePeriod] || {};
  const activeData = activeSnapshot?.[activeTab] || {};
  const activePeriodMeta = activeSnapshot?.meta || {};
  const activeSubtab = activeSubtabs[activeTab] || SUBTABS[activeTab]?.[0]?.id || 'resumen';
  const activeTabMeta = SECTION_META[activeTab] || SECTION_META.operacion;
  const activeTabConfig = TABS.find((tab) => tab.id === activeTab) || TABS[0];
  const ActiveTabIcon = activeTabConfig.icon || LayoutDashboard;

  return (
    <div className="relative z-10">
      <section className="rounded-[28px] border border-zinc-200/80 bg-white/94 px-4 py-4 shadow-[0_18px_60px_-48px_rgba(15,23,42,0.42)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/94 dark:shadow-[0_24px_90px_-58px_rgba(0,0,0,0.78)] sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200/70 bg-blue-50/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-200">
              <Activity className="h-3.5 w-3.5" />
              {data?.header?.title || 'Panel'}
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50 sm:text-3xl">
              {data?.header?.subtitle || 'Estado del ministerio'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              {data?.header?.helper || 'Vista operativa del sistema.'}
            </p>
          </div>

          <div className="inline-flex max-w-full items-center gap-1 rounded-[22px] border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900/70">
            <span className="hidden px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400 sm:inline">Rango</span>
            <div className="flex gap-1 overflow-x-auto">
              {(data?.periods || []).map((period) => {
                const isActive = activePeriod === period.id;
                return (
                  <button
                    key={period.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActivePeriod(period.id)}
                    className={`inline-flex h-9 shrink-0 items-center rounded-[18px] px-3 text-xs font-semibold transition-colors sm:text-sm ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                        : 'text-zinc-600 hover:bg-white hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-950 dark:hover:text-zinc-50'
                    }`}
                  >
                    {period.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex h-12 items-center justify-center gap-2 rounded-[20px] px-4 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-zinc-950 text-white shadow-lg shadow-zinc-950/15 dark:bg-white dark:text-zinc-950'
                    : 'border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-50'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-5 rounded-[28px] border border-zinc-200/80 bg-white/92 p-4 shadow-[0_16px_55px_-48px_rgba(15,23,42,0.42)] dark:border-zinc-800 dark:bg-zinc-950/92">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
              <ActiveTabIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">{activeTabMeta.title}</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{activeTabMeta.subtitle}</p>
            </div>
          </div>

          <div className="grid gap-2 text-xs text-zinc-500 dark:text-zinc-400 sm:grid-cols-3 xl:min-w-[520px]">
            <div className="rounded-[18px] border border-zinc-200/80 bg-zinc-50/90 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="font-semibold uppercase tracking-[0.14em]">Periodo</p>
              <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{activePeriodMeta?.label || 'Actual'}</p>
            </div>
            <div className="rounded-[18px] border border-zinc-200/80 bg-zinc-50/90 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="font-semibold uppercase tracking-[0.14em]">{activePeriodMeta?.serviceLabel || 'Servicios'}</p>
              <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{activePeriodMeta?.serviceValue || '--'} · {activePeriodMeta?.serviceDetail || 'Sin resumen'}</p>
            </div>
            <div className="rounded-[18px] border border-zinc-200/80 bg-zinc-50/90 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="font-semibold uppercase tracking-[0.14em]">Actualizado</p>
              <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{formatDateTime(data?.generatedAt)}</p>
            </div>
          </div>
        </div>

      </section>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(activeData?.kpis || []).map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      <SubtabNav
        tabs={SUBTABS[activeTab] || []}
        activeId={activeSubtab}
        onChange={(nextSubtab) => setActiveSubtabs((prev) => ({ ...prev, [activeTab]: nextSubtab }))}
      />

      {activeTab === 'operacion' && activeSubtab === 'resumen' ? (
        <div className="mt-4">
          <PanelCard title={activeData?.heroTitle || 'Proximo servicio'} subtitle={activeData?.heroSubtitle || 'Lo mas importante para alinear en el siguiente evento.'} action={activeData?.nextService ? <StatusBadge status={activeData.nextService.status} /> : null}>
            {activeData?.nextService ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">{activeData.nextService.title}</h3>
                    <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                      {formatDateTime(activeData.nextService.dateIso)}
                      {activeData.nextService.leaderName ? ` | Lider: ${activeData.nextService.leaderName}` : ''}
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-blue-200/80 bg-blue-50/80 px-4 py-3 text-right dark:border-blue-500/20 dark:bg-blue-500/10">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-200">Readiness</p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-blue-700 dark:text-blue-100">{activeData.nextService.readinessScore}%</p>
                  </div>
                </div>
                <SectionSummary items={activeData.nextService.summary || []} />
              </div>
            ) : (
              <EmptyState title={activeData?.emptyFocusTitle || 'Sin servicios cercanos'} detail={activeData?.emptyFocusDetail || 'No hay eventos publicados o visibles en la ventana actual.'} />
            )}
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'operacion' && activeSubtab === 'servicios' ? (
        <div className="mt-4">
          <PanelCard title={activeData?.listTitle || 'Servicios proximos'} subtitle={activeData?.listSubtitle || 'Acceso rapido a los eventos que requieren atencion.'}>
            <SimpleList items={activeData?.upcomingServices || []} emptyTitle={activeData?.emptyListTitle || 'Sin servicios en la ventana'} emptyDetail={activeData?.emptyListDetail || 'Cuando haya programacion proxima, aparecera aqui.'} renderItem={(item) => <UpcomingServiceItem key={item.id} item={item} />} />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'operacion' && activeSubtab === 'alertas' ? (
        <div className="mt-4">
          <PanelCard title="Alertas operativas" subtitle="Pendientes que pueden bloquear un ensayo o un servicio.">
            <AlertList items={activeData?.alerts || []} />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'operacion' && activeSubtab === 'checks' ? (
        <div className="mt-4">
          <PanelCard title="Checks del servicio" subtitle="Detalle de readiness para el evento enfocado.">
            {activeData?.nextService ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {(activeData.nextService.readinessChecks || []).map((check) => (
                  <div key={check.key} className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{check.label}</p>
                      <span className={`inline-flex h-7 items-center rounded-full px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${check.ok ? statusTone.listo : statusTone.riesgo}`}>
                        {check.ok ? 'OK' : 'Pendiente'}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">{check.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Sin servicio enfocado" detail="No hay un evento cercano para revisar checks." />
            )}
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'repertorio' && activeSubtab === 'ranking' ? (
        <div className="mt-4">
          <PanelCard
            title={`Canciones mas usadas ${activeData?.topSongsMeta?.year || ''}`}
            subtitle={`${activeData?.topSongsMeta?.servicesCount || 0} servicios realizados analizados | ${(activeData?.topSongsMeta?.usedSongsCount || 0)} canciones usadas`}
          >
            <SongRankingList
              items={activeData?.topSongs || []}
              meta={activeData?.topSongsMeta || {}}
              errors={activeData?.errors || []}
              loading={Boolean(activeData?.loading)}
            />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'repertorio' && activeSubtab === 'rotacion' ? (
        <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_0.9fr]">
          <PanelCard title="Repeticiones sensibles" subtitle="Canciones que se repitieron tres veces dentro de 60 dias.">
            <RepeatWatchList items={activeData?.repeatWatch || []} />
          </PanelCard>
          <PanelCard title="Sin uso en el rango" subtitle="Opciones para refrescar sin perder el pulso del repertorio.">
            <SimpleList
              items={activeData?.unusedSongs || []}
              emptyTitle="Todo el catalogo aparece en el rango"
              emptyDetail="No hay canciones activas sin uso dentro de esta ventana."
              renderItem={(item) => (
                <div key={item.id} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/65">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{item.detail}</p>
                </div>
              )}
            />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'repertorio' && activeSubtab === 'recursos' ? (
        <div className="mt-4 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <PanelCard title="Cobertura de recursos" subtitle="Que tan listo esta el repertorio para ensayo y montaje.">
            <ResourceCoverageList items={activeData?.resourceCoverage || []} />
          </PanelCard>
          <PanelCard title="Secuencias" subtitle="Separacion entre secuencia simple, parcial y multitrack completa.">
            <SequenceBreakdown breakdown={activeData?.sequenceBreakdown || []} gaps={activeData?.sequenceGaps || []} />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'repertorio' && activeSubtab === 'distribucion' ? (
        <div className="mt-4">
          <PanelCard title="Distribucion del repertorio" subtitle="Balance real del catalogo para tomar decisiones de refresh.">
            <div className="grid gap-6 lg:grid-cols-3">
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Categoria</p>
                <BarList items={activeData?.categoryDistribution || []} tone="amber" emptyTitle="Sin categorias" emptyDetail="No hay categorias suficientes para mostrar." />
              </div>
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Voz</p>
                <BarList items={activeData?.voiceDistribution || []} tone="blue" emptyTitle="Sin perfiles vocales" emptyDetail="No hay datos vocales para mostrar." />
              </div>
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Tema</p>
                <BarList items={activeData?.themeDistribution || []} tone="emerald" emptyTitle="Sin temas" emptyDetail="No hay temas suficientes para mostrar." />
              </div>
            </div>
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'equipo' && activeSubtab === 'carga' ? (
        <div className="mt-4">
          <PanelCard title="Carga por miembro" subtitle="Quien esta sosteniendo mas servicios en la ventana actual.">
            <WorkloadList items={activeData?.workload || []} />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'equipo' && activeSubtab === 'roles' ? (
        <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_0.95fr]">
          <PanelCard title="Cobertura por rol" subtitle="Cuantas personas hay disponibles para cada rol.">
            <RoleCoverageList items={activeData?.roleCoverage || []} tone="blue" emptyTitle="Sin roles cargados" emptyDetail="No hay roles suficientes para medir cobertura." />
          </PanelCard>
          <PanelCard title="Roles con baja cobertura" subtitle="Puntos fragiles del equipo para reforzar.">
            <RoleRiskList items={activeData?.lowCoverageRoles || []} />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'equipo' && activeSubtab === 'ausencias' ? (
        <div className="mt-4">
          <PanelCard title="Conflictos por ausencias" subtitle="Cruces reales entre disponibilidad y servicios proximos.">
            <SimpleList
              items={activeData?.conflicts || []}
              emptyTitle="Sin conflictos detectados"
              emptyDetail="No hay ausencias que choquen con eventos visibles."
              renderItem={(item) => (
                <div key={item.id} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.name}</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{item.serviceTitle} | {formatShortDate(item.dateIso)} | {item.detail}</p>
                </div>
              )}
            />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'equipo' && activeSubtab === 'disponibles' ? (
        <div className="mt-4">
          <PanelCard title="Personas sin asignacion proxima" subtitle="Buen lugar para repartir mejor la carga.">
            <SimpleList
              items={activeData?.idleProfiles || []}
              emptyTitle="Todos estan sirviendo"
              emptyDetail="No hay perfiles ociosos en la ventana actual."
              renderItem={(item) => (
                <div key={item.id} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/65">
                  <AvatarCell name={item.name} avatarUrl={item.avatarUrl} subtitle={(item.roles || []).join(' | ') || 'Sin roles'} />
                </div>
              )}
            />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'sistema' && activeSubtab === 'eventos' ? (
        <div className="mt-4">
          <PanelCard title="Eventos con huecos" subtitle="Servicios que aun no llegan a un estado sano.">
            <SimpleList
              items={activeData?.eventGaps || []}
              emptyTitle="Eventos sanos"
              emptyDetail="No hay huecos importantes en la ventana actual."
              renderItem={(item) => (
                <div key={item.id} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{formatDateTime(item.dateIso)}</p>
                    </div>
                    <CalendarClock className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{item.detail}</p>
                </div>
              )}
            />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'sistema' && activeSubtab === 'catalogo' ? (
        <div className="mt-4">
          <PanelCard title="Huecos del catalogo" subtitle="Canciones que siguen incompletas dentro del sistema.">
            <SimpleList
              items={activeData?.songGaps || []}
              emptyTitle="Catalogo sano"
              emptyDetail="No hay huecos relevantes detectados en canciones."
              renderItem={(item) => (
                <div key={item.title} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</p>
                    <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white dark:bg-white dark:text-zinc-950">{item.count}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(item.items || []).map((name) => (
                      <span key={`${item.title}-${name}`} className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{name}</span>
                    ))}
                  </div>
                </div>
              )}
            />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'sistema' && activeSubtab === 'perfiles' ? (
        <div className="mt-4">
          <PanelCard title="Perfiles incompletos" subtitle="Personas a las que todavia les falta informacion basica.">
            <SimpleList
              items={activeData?.profileGaps || []}
              emptyTitle="Perfiles completos"
              emptyDetail="Todos los perfiles visibles ya tienen lo basico."
              renderItem={(item) => (
                <div key={item.id} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/65">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.name}</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Falta: {item.missing.join(' | ')}</p>
                </div>
              )}
            />
          </PanelCard>
        </div>
      ) : null}

      {activeTab === 'sistema' && activeSubtab === 'tecnico' ? (
        <div className="mt-4">
          <PanelCard title="Warnings tecnicos" subtitle="Problemas de consulta o fallbacks que conviene vigilar.">
            <SimpleList
              items={activeData?.warnings || []}
              emptyTitle="Sin warnings"
              emptyDetail="Las consultas principales respondieron sin alertas."
              renderItem={(item, index) => (
                <div key={`${item}-${index}`} className="rounded-[20px] border border-amber-200 bg-amber-50/80 p-4 text-sm leading-6 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
                  {item}
                </div>
              )}
            />
          </PanelCard>
        </div>
      ) : null}
    </div>
  );
}
